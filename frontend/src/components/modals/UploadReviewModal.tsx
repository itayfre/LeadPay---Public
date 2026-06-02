import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { statementsAPI, expensesAPI } from '../../services/api';
import type { StatementReview, ReviewTransaction, MatchSuggestion, ExpenseRow, UploadResult, ExpenseCategory } from '../../types';
import ConfirmDialog from './ConfirmDialog';
import AllocationDrawer from './AllocationDrawer';
import CategoryManagerModal from '../building/CategoryManagerModal';
import Modal from '../ui/Modal';
import DescriptionCell from '../shared/DescriptionCell';
import TabCount from '../shared/TabCount';
import CategorizeFormFields from '../shared/CategorizeFormFields';

interface Props {
  statementId: string;
  buildingId: string;
  uploadResult?: UploadResult;
  onClose: () => void;
}

type Tab = 'unmatched' | 'matched' | 'expenses';

type AllocationKind = 'single' | 'split' | 'multi_month' | 'non_tenant';

// Precedence: non_tenant > multi_month > split > single.
// A 2-tenant × 2-month allocation falls through to 'split' (the tenant
// breakdown is shown; month detail collapses) — intentional, since
// "who paid" is usually more salient than "for which months" when both vary.
function classifyAllocations(tx: ReviewTransaction): AllocationKind | null {
  const allocs = tx.allocations || [];
  if (allocs.length === 0) return null;
  const tenantIds = new Set(
    allocs.map(a => a.tenant_id).filter((id): id is string => !!id),
  );
  const periods = new Set(allocs.map(a => `${a.period_year}-${a.period_month}`));
  if (allocs.every(a => !a.tenant_id)) return 'non_tenant';
  if (tenantIds.size === 1 && periods.size > 1) return 'multi_month';
  if (tenantIds.size > 1) return 'split';
  return 'single';
}

// Per-row state machine for the unmatched-tab approve flow.
// Allows multiple rows to be in different visual states simultaneously
// (e.g. one in success-fade while another is saving).
type ConfirmState =
  | { kind: 'idle' }
  | { kind: 'saving'; tenantName: string }
  | { kind: 'success'; tenantName: string; apartmentNumber?: number | null; periodLabel: string }
  | { kind: 'error'; message: string };

/** How long the green success card lingers before the row leaves the unmatched tab. */
const SUCCESS_FADE_MS = 1200;

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];
function periodLabelFromString(period: string): string {
  const [m, y] = period.split('/').map(Number);
  if (!m || !y) return period;
  return `${HEBREW_MONTHS[m - 1] ?? m} ${y}`;
}

// Legacy strings (kept for back-compat with rows categorized via the old system).
const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  routine_maintenance: 'אחזקה שוטפת',
  technical_maintenance: 'אחזקה טכנית',
  administrative: 'הוצאות הנהלה',
  extraordinary: 'תיקונים מיוחדים',
};

const METHOD_LABELS: Record<string, string> = {
  exact: 'התאמה מדויקת',
  reversed_name: 'שם הפוך',
  fuzzy: 'דמיון טקסט',
  token_based: 'מילים',
  family_name: 'שם משפחה',
  manual: 'ידני',
  amount: 'סכום',
  learned: '🔖 לומד',
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('he-IL');
  } catch {
    return iso;
  }
}

function formatAmount(amount?: number | null) {
  if (amount == null) return '—';
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 0 })}`;
}

// ── Inline SVG icons (matches ConfirmDialog.tsx pattern, avoids adding lucide-react dep) ──
function CheckIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function TrashIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
      />
    </svg>
  );
}

function GearIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function ChevronDownIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// Generic round icon button used for all per-row actions
interface IconActionProps {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant: 'approve' | 'reject' | 'delete' | 'settings';
  children: React.ReactNode;
}

function IconAction({ title, onClick, disabled, loading, variant, children }: IconActionProps) {
  const variantClass = {
    approve: 'text-ink-500 hover:text-accent-600 hover:bg-accent-50',
    reject: 'text-ink-500 hover:text-warn-600 hover:bg-warn-50',
    delete: 'text-ink-500 hover:text-danger-600 hover:bg-danger-50',
    settings: 'text-ink-500 hover:text-primary-700 hover:bg-primary-50',
  }[variant];

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled || loading}
      className={`p-1.5 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${variantClass}`}
    >
      {loading ? <span className="text-xs">…</span> : children}
    </button>
  );
}

export default function UploadReviewModal({ statementId, buildingId, uploadResult, onClose }: Props) {
  const queryClient = useQueryClient();

  const [review, setReview] = useState<StatementReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('unmatched');

  // Map transactionId → selected tenantId (manual matches not yet committed)
  const [pendingMatches, setPendingMatches] = useState<Record<string, string>>({});

  // Per-row spinners — `null` when no row action is in flight.
  // Used by reject / delete / categorize. Approve-row uses `rowState` below for
  // a richer state machine so the confirm UX can render selected/saving/success/error states.
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Approve-flow state machine, keyed by tx.id.
  const [rowState, setRowState] = useState<Record<string, ConfirmState>>({});
  const getRowState = (txId: string): ConfirmState => rowState[txId] ?? { kind: 'idle' };

  // Track pending success-fade timeouts so we can clear them on unmount
  // (prevents state-update-on-unmounted-component warnings + wasted refetches).
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current.clear();
    };
  }, []);

  // Confirm dialog state for delete
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Allocation drawer state — which transaction is open
  const [drawerTx, setDrawerTx] = useState<ReviewTransaction | null>(null);

  // Track rows the user just resolved via AllocationDrawer.
  // These stay visible in the unmatched tab as "resolved cards" until the modal closes.
  // No explicit clear needed — the Set dies with the component on unmount.
  const [recentlyResolvedIds, setRecentlyResolvedIds] = useState<Set<string>>(new Set());

  // Per-building expense categories (loaded on mount + refreshed when manager closes)
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  // Expense edit popover state
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editingExpenseRow, setEditingExpenseRow] = useState<ExpenseRow | null>(null);
  const [expenseEditForm, setExpenseEditForm] = useState<{
    vendor_label: string;
    category_id: string;
    notes: string;
    remember: boolean;
  }>({ vendor_label: '', category_id: '', notes: '', remember: false });

  // Bulk-categorize state (uncategorized expenses tab)
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkEditForm, setBulkEditForm] = useState<{
    vendor_label: string;
    category_id: string;
    notes: string;
    remember: boolean;
  }>({ vendor_label: '', category_id: '', notes: '', remember: false });

  function toggleExpense(id: string) {
    setSelectedExpenseIds(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clearExpenseSelection() {
    setSelectedExpenseIds(new Set());
  }

  const refreshReview = async () => {
    const updated = await statementsAPI.getReview(statementId);
    setReview(updated);
    queryClient.invalidateQueries({ queryKey: ['paymentStatus', buildingId] });
    return updated;
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    statementsAPI.getReview(statementId)
      .then(data => {
        setReview(data);
        if (data.unmatched.length === 0 && data.matched.length > 0) {
          setActiveTab('matched');
        }
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [statementId]);

  const reloadCategories = React.useCallback(() => {
    expensesAPI.listCategories(buildingId)
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [buildingId]);

  // Load building categories for the expense edit dropdown
  useEffect(() => { reloadCategories(); }, [reloadCategories]);

  const handleSelectTenant = (transactionId: string, tenantId: string) => {
    setPendingMatches(prev => {
      if (!tenantId) {
        const next = { ...prev };
        delete next[transactionId];
        return next;
      }
      return { ...prev, [transactionId]: tenantId };
    });
    // Clear any prior error for this row — fresh selection = fresh attempt
    setRowState(s => {
      if (s[transactionId]?.kind !== 'error') return s;
      const next = { ...s };
      delete next[transactionId];
      return next;
    });
  };

  const pendingCount = Object.keys(pendingMatches).length;

  // ── Per-row handlers ──

  const handleApproveRow = async (txId: string) => {
    const tenantId = pendingMatches[txId];
    if (!tenantId) return;
    const tenant = review!.all_tenants.find(t => t.tenant_id === tenantId);
    const tenantName = tenant?.tenant_name || '';

    setRowState(s => ({ ...s, [txId]: { kind: 'saving', tenantName } }));
    setConfirmError(null);

    try {
      await statementsAPI.manualMatch(txId, tenantId);
      setRowState(s => ({
        ...s,
        [txId]: {
          kind: 'success',
          tenantName,
          // MatchSuggestion type has no apartment_number — omit in display
          apartmentNumber: null,
          periodLabel: periodLabelFromString(review!.period),
        },
      }));
      // After SUCCESS_FADE_MS: refresh review data, clear this row's state + pending selection.
      // Tracked in timeoutsRef so it gets cleared if the modal closes first.
      const timeoutId = setTimeout(async () => {
        timeoutsRef.current.delete(timeoutId);
        try {
          await refreshReview();
        } finally {
          setRowState(s => {
            const n = { ...s };
            delete n[txId];
            return n;
          });
          setPendingMatches(p => {
            const n = { ...p };
            delete n[txId];
            return n;
          });
        }
      }, SUCCESS_FADE_MS);
      timeoutsRef.current.add(timeoutId);
    } catch (err) {
      setRowState(s => ({ ...s, [txId]: { kind: 'error', message: (err as Error).message } }));
    }
  };

  const handleRejectRow = async (txId: string, source: Tab) => {
    setBusyRow(txId);
    setConfirmError(null);
    try {
      // matched   → unmatch (sends back to unmatched tab)
      // unmatched → convert to uncategorized expense (moves to expenses tab)
      if (source === 'matched') {
        await statementsAPI.unmatchTransaction(txId);
      } else {
        await statementsAPI.ignoreTransaction(txId);
      }
      const updated = await refreshReview();
      // If the user is on a tab that just emptied, jump them to a populated one
      if (source === 'matched' && updated.unmatched.length > 0) {
        setActiveTab('unmatched');
      }
    } catch (err) {
      setConfirmError((err as Error).message);
    } finally {
      setBusyRow(null);
    }
  };

  // Undo a resolved-card allocation: unmatch on the server, drop from
  // recentlyResolvedIds so the row reverts to a normal unmatched row.
  const handleUndoResolved = async (txId: string) => {
    setBusyRow(txId);
    setConfirmError(null);
    try {
      await statementsAPI.unmatchTransaction(txId);
      setRecentlyResolvedIds(s => {
        const next = new Set(s);
        next.delete(txId);
        return next;
      });
      await refreshReview();
    } catch (err) {
      setConfirmError((err as Error).message);
    } finally {
      setBusyRow(null);
    }
  };

  const handleDeleteRow = async (txId: string) => {
    setBusyRow(txId);
    setConfirmError(null);
    try {
      await statementsAPI.deleteTransaction(txId);
      // Drop any local pending state for this row
      setPendingMatches(prev => {
        const next = { ...prev };
        delete next[txId];
        return next;
      });
      await refreshReview();
    } catch (err) {
      setConfirmError((err as Error).message);
    } finally {
      setBusyRow(null);
      setPendingDeleteId(null);
    }
  };

  // Bulk: confirm every row the engine auto-matched but hasn't been user-confirmed yet
  const unconfirmedMatched = review?.matched.filter(t => !t.is_confirmed) ?? [];

  const handleApproveAllSuggestions = async () => {
    if (unconfirmedMatched.length === 0) return;
    setBulkBusy(true);
    setConfirmError(null);
    try {
      // Re-issuing manualMatch with the already-matched tenant flips is_confirmed=true
      // and refreshes the NameMapping — same code path as a manual approval.
      await Promise.all(
        unconfirmedMatched
          .filter(t => t.tenant_id)
          .map(t => statementsAPI.manualMatch(t.id, t.tenant_id as string))
      );
      await refreshReview();
    } catch (err) {
      setConfirmError((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  // Bulk: commit every pending manual match in one go (replaces old "אשר התאמות ידניות")
  const handleCommitPending = async () => {
    if (pendingCount === 0) return;
    setBulkBusy(true);
    setConfirmError(null);
    try {
      await Promise.all(
        Object.entries(pendingMatches).map(([txId, tenantId]) =>
          statementsAPI.manualMatch(txId, tenantId)
        )
      );
      setPendingMatches({});
      const updated = await refreshReview();
      if (updated.unmatched.length === 0 && updated.matched.length > 0) {
        setActiveTab('matched');
      }
    } catch (err) {
      setConfirmError((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const openExpenseEdit = (row: ExpenseRow) => {
    setEditingExpenseId(row.id);
    setEditingExpenseRow(row);
    setExpenseEditForm({
      vendor_label: row.vendor_label ?? '',
      // Seed category from the row if it has one. Leave empty (= "ללא קטגוריה")
      // when uncategorized so the user makes an explicit choice.
      category_id: row.category_id ?? '',
      notes: row.notes ?? '',
      remember: false,
    });
  };

  const handleSaveExpense = async (txId: string) => {
    setBusyRow(txId);
    setConfirmError(null);
    try {
      await statementsAPI.categorizeTransaction(txId, {
        vendor_label: expenseEditForm.vendor_label,
        category_id: expenseEditForm.category_id || undefined,
        notes: expenseEditForm.notes.trim() || undefined,
        remember: expenseEditForm.remember,
      });
      setEditingExpenseId(null);
      setEditingExpenseRow(null);
      await refreshReview();
    } catch (err) {
      setConfirmError((err as Error).message);
    } finally {
      setBusyRow(null);
    }
  };

  const handleBulkCategorize = async () => {
    setBulkBusy(true);
    setConfirmError(null);
    try {
      await expensesAPI.bulkCategorize(buildingId, {
        transaction_ids: Array.from(selectedExpenseIds),
        category_id: bulkEditForm.category_id || null,
        vendor_label: bulkEditForm.vendor_label || undefined,
        notes: bulkEditForm.notes.trim() || undefined,
        remember: bulkEditForm.remember,
      });
      clearExpenseSelection();
      setBulkDialogOpen(false);
      await refreshReview();
    } catch (err) {
      setConfirmError((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleUncategorize = async (txId: string) => {
    setBusyRow(txId);
    setConfirmError(null);
    try {
      await statementsAPI.uncategorizeTransaction(txId);
      await refreshReview();
    } catch (err) {
      setConfirmError((err as Error).message);
    } finally {
      setBusyRow(null);
    }
  };

  const tabs: {
    id: Tab;
    label: string;
    current: number;
    legacy: number;
    resolved?: number;
    variant: 'unmatched' | 'matched' | 'expenses';
  }[] = review
    ? (() => {
        const unmatchedCurrent = review.unmatched.filter(
          t => t.is_from_current_statement !== false,
        ).length;
        const unmatchedLegacy = review.unmatched.filter(
          t => t.is_from_current_statement === false,
        ).length;
        const expensesUncatCurrent = (review.expenses ?? []).filter(
          e => !(e.category_id || e.category) && e.is_from_current_statement !== false,
        ).length;
        const expensesUncatLegacy = (review.expenses ?? []).filter(
          e => !(e.category_id || e.category) && e.is_from_current_statement === false,
        ).length;
        return [
          {
            id: 'unmatched' as Tab,
            label: 'לא הותאמו',
            current: unmatchedCurrent,
            legacy: unmatchedLegacy,
            resolved: recentlyResolvedIds.size,
            variant: 'unmatched' as const,
          },
          {
            id: 'matched' as Tab,
            label: 'הותאמו אוטומטית',
            current: review.matched.length,
            legacy: 0,
            variant: 'matched' as const,
          },
          {
            id: 'expenses' as Tab,
            label: 'הוצאות מזוהות',
            current: expensesUncatCurrent,
            legacy: expensesUncatLegacy,
            variant: 'expenses' as const,
          },
        ];
      })()
    : [];

  return (
    <>
      <Modal open onClose={onClose} srTitle="סקירת הדוח" size="4xl" hideClose className="max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="bg-gradient-to-l from-primary-600 to-primary-800 rounded-t-xl px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">סקירת הדוח</h2>
              {review && (
                <p className="text-primary-200 text-sm mt-0.5">
                  תקופה: {review.period}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-white text-2xl leading-none hover:text-primary-200 transition-colors"
              aria-label="סגור"
            >
              ×
            </button>
          </div>

          {/* Loading / Error */}
          {loading && (
            <div className="flex-1 flex items-center justify-center py-20">
              <div className="text-center text-ink-500">
                <div className="text-4xl mb-3">⏳</div>
                <p>טוען נתונים...</p>
              </div>
            </div>
          )}
          {error && (
            <div className="flex-1 flex items-center justify-center py-20">
              <div className="text-center text-danger-600">
                <div className="text-4xl mb-3">❌</div>
                <p>{error}</p>
              </div>
            </div>
          )}

          {review && !loading && (
            <>
              {/* Upload summary strip — only when opened right after an upload */}
              {uploadResult && (
                <div className="bg-ink-50 border-b border-ink-200 px-6 py-2.5 flex items-center gap-4 text-xs text-ink-700 flex-wrap">
                  <span className="font-medium text-ink-700">📄 {uploadResult.period.replace('/', '/')}</span>
                  <span>{uploadResult.total_transactions} עסקאות בקובץ</span>
                  <span className="text-accent-700 font-medium">✓ {uploadResult.matched} הותאמו</span>
                  {uploadResult.unmatched > 0 && (
                    <span className="text-orange-600 font-medium">? {uploadResult.unmatched} ממתינים לשיוך</span>
                  )}
                  {uploadResult.skipped_duplicates > 0 && (
                    <span className="text-ink-500">{uploadResult.skipped_duplicates} כפולים דולגו</span>
                  )}
                </div>
              )}

              {/* Duplicate period warning */}
              {uploadResult?.duplicate_warning && (
                <div className="mx-6 mt-3 flex items-start gap-2 text-sm text-warn-800 bg-warn-50 border border-warn-200 rounded-lg px-4 py-3">
                  <span className="flex-shrink-0 text-lg">⚠️</span>
                  <div>
                    <p className="font-semibold">דף בנק כפול</p>
                    <p className="text-warn-600 text-xs mt-0.5">{uploadResult.duplicate_warning} ייתכן שהעלת את אותו קובץ פעמיים.</p>
                  </div>
                </div>
              )}

              {/* High unmatched rate warning (>90% of payment transactions unmatched) */}
              {uploadResult && uploadResult.payment_transactions > 0 &&
               uploadResult.unmatched / uploadResult.payment_transactions > 0.9 && (
                <div className="mx-6 mt-3 flex items-start gap-2 text-sm text-danger-600 bg-danger-50 border border-danger-50 rounded-lg px-4 py-3">
                  <span className="flex-shrink-0 text-lg">🔴</span>
                  <div>
                    <p className="font-semibold">רוב התשלומים לא זוהו — ייתכן שהעלת קובץ של בניין אחר</p>
                    <p className="text-danger-600 text-xs mt-0.5">
                      {uploadResult.unmatched} מתוך {uploadResult.payment_transactions} תשלומים ({Math.round(uploadResult.unmatched / uploadResult.payment_transactions * 100)}%) לא הותאמו לאף דייר.
                      אם הקובץ שייך לבניין אחר, סגור את החלון והעלה מחדש מהבניין הנכון.
                    </p>
                  </div>
                </div>
              )}

              {/* Tabs */}
              <div className="border-b border-ink-200 px-6 flex gap-1 pt-2">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 ${
                      activeTab === tab.id
                        ? 'bg-white border border-b-white border-ink-200 text-primary-700 -mb-px'
                        : 'text-ink-500 hover:text-ink-700'
                    }`}
                  >
                    {tab.label}
                    <TabCount
                      current={tab.current}
                      legacy={tab.legacy}
                      resolved={tab.resolved}
                      variant={tab.variant}
                    />
                  </button>
                ))}
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6">
                {/* ── UNMATCHED TAB ── */}
                {activeTab === 'unmatched' && (() => {
                  // Rows explicitly marked as NOT from this statement are legacy orphans.
                  // Rows with undefined (older backend) default to current to avoid breaking existing data.
                  const current = review.unmatched.filter(t => t.is_from_current_statement !== false);
                  const legacy  = review.unmatched.filter(t => t.is_from_current_statement === false);
                  // Rows the user just resolved via AllocationDrawer — render as resolved cards
                  // at the top of this tab, instead of disappearing into the matched tab.
                  const resolvedHere = (review.matched ?? []).filter(t => recentlyResolvedIds.has(t.id));

                  if (review.unmatched.length === 0 && resolvedHere.length === 0) {
                    return (
                      <div className="text-center py-12 text-ink-500">
                        <div className="text-4xl mb-2">✅</div>
                        <p>כל העסקאות הותאמו!</p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-6">
                      {/* Resolved cards — rows just resolved via AllocationDrawer */}
                      {resolvedHere.length > 0 && (
                        <div className="space-y-3">
                          {resolvedHere.map(t => {
                            const kind = classifyAllocations(t) ?? 'single';
                            return (
                              <ResolvedCard
                                key={t.id}
                                tx={t}
                                kind={kind}
                                busy={busyRow === t.id}
                                onEdit={() => setDrawerTx(t)}
                                onUndo={() => handleUndoResolved(t.id)}
                              />
                            );
                          })}
                        </div>
                      )}

                      {/* Info banner — only when legacy rows exist */}
                      {legacy.length > 0 && (
                        <div className="flex items-start gap-2 text-xs text-ink-500 bg-primary-50/60 border border-primary-100 rounded-md px-3 py-2">
                          <span className="flex-shrink-0 mt-0.5 select-none">ℹ︎</span>
                          <span>
                            {legacy.length === 1
                              ? 'תשלום אחד שלא שובץ בהעלאות קודמות מופיע בהמשך, מתחת לתשלומים מהקובץ הנוכחי.'
                              : `${legacy.length} תשלומים שלא שובצו בהעלאות קודמות מופיעים בהמשך, מתחת לתשלומים מהקובץ הנוכחי.`}
                          </span>
                        </div>
                      )}

                      {/* Section 1: from the current uploaded statement */}
                      <div>
                        <div className="mb-3">
                          <h3 className="text-sm font-semibold text-ink-900">
                            מהקובץ שהעלית עכשיו
                            <span className="text-ink-500 font-normal mr-2">{current.length} תשלומים</span>
                          </h3>
                          <p className="text-xs text-ink-500 mt-0.5">
                            הקובץ שהעלית עתה: דף בנק {review.period}.
                          </p>
                        </div>
                        {current.length === 0 ? (
                          <div className="flex items-center gap-2 bg-teal-50 border border-teal-100 rounded-lg px-4 py-3 text-sm text-teal-700">
                            <span className="text-teal-500 font-semibold">✓</span>
                            כל התשלומים מהדף הזה שובצו לדיירים. אפשר לאשר את ההעלאה.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {current.map((tx: ReviewTransaction) => (
                              <UnmatchedRow
                                key={tx.id}
                                tx={tx}
                                allTenants={review.all_tenants}
                                selected={pendingMatches[tx.id] || ''}
                                onSelect={tenantId => handleSelectTenant(tx.id, tenantId)}
                                busy={busyRow === tx.id}
                                state={getRowState(tx.id)}
                                onApprove={() => handleApproveRow(tx.id)}
                                onReject={() => handleRejectRow(tx.id, 'unmatched')}
                                onDelete={() => setPendingDeleteId(tx.id)}
                                onOpenDrawer={() => setDrawerTx(tx)}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Section 2: orphans from previous uploads */}
                      {legacy.length > 0 && (
                        <LegacyUnmatchedSection
                          rows={legacy}
                          allTenants={review.all_tenants}
                          pendingMatches={pendingMatches}
                          busyRow={busyRow}
                          getRowState={getRowState}
                          onSelect={handleSelectTenant}
                          onApprove={handleApproveRow}
                          onReject={(txId) => handleRejectRow(txId, 'unmatched')}
                          onDelete={setPendingDeleteId}
                          onOpenDrawer={setDrawerTx}
                          defaultCollapsed={legacy.length > 3}
                        />
                      )}
                    </div>
                  );
                })()}

                {/* ── MATCHED TAB ── */}
                {activeTab === 'matched' && (
                  <div>
                    {review.matched.length === 0 ? (
                      <div className="text-center py-12 text-ink-500">
                        <div className="text-4xl mb-2">🔍</div>
                        <p>לא נמצאו התאמות אוטומטיות</p>
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-ink-500 border-b text-right">
                            <th className="pb-2 font-medium">שם המשלם</th>
                            <th className="pb-2 font-medium">תאריך</th>
                            <th className="pb-2 font-medium">סכום</th>
                            <th className="pb-2 font-medium">דייר מותאם</th>
                            <th className="pb-2 font-medium">ביטחון</th>
                            <th className="pb-2 font-medium">שיטה</th>
                            <th className="pb-2 font-medium text-left">פעולות</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-100">
                          {review.matched.map((tx: ReviewTransaction) => (
                            <tr key={tx.id} className="hover:bg-ink-50">
                              <td className="py-2.5 pr-0 font-medium text-ink-900">
                                {tx.payer_name || '—'}
                              </td>
                              <td className="py-2.5 text-ink-500">{formatDate(tx.activity_date)}</td>
                              <td className="py-2.5 text-accent-700 font-medium">
                                {formatAmount(tx.credit_amount)}
                              </td>
                              <td className="py-2.5 text-ink-900">
                                {(() => {
                                  // Single-tenant match: show tenant name as before.
                                  if (tx.tenant_name) return tx.tenant_name;
                                  // Split (2+ tenant allocations) or non-tenant labeled.
                                  const allocs = tx.allocations ?? [];
                                  const tenantAllocs = allocs.filter(a => a.tenant_id);
                                  if (tenantAllocs.length >= 2) {
                                    const first = tenantAllocs[0]?.tenant_name ?? '—';
                                    const extra = tenantAllocs.length - 1;
                                    return (
                                      <span className="text-purple-700" title={tenantAllocs.map(a => a.tenant_name).join(' · ')}>
                                        ✂️ {first}{extra > 0 ? ` +${extra}` : ''}
                                      </span>
                                    );
                                  }
                                  const label = allocs.find(a => a.label)?.label;
                                  if (label) {
                                    return <span className="text-primary-700" title={label}>🏷️ {label}</span>;
                                  }
                                  return '—';
                                })()}
                              </td>
                              <td className="py-2.5">
                                <ConfidenceBadge confidence={tx.match_confidence} />
                              </td>
                              <td className="py-2.5 text-ink-500 text-xs">
                                {tx.match_method ? (METHOD_LABELS[tx.match_method] || tx.match_method) : '—'}
                              </td>
                              <td className="py-2.5 text-left">
                                <div className="flex items-center gap-1 justify-end">
                                  <IconAction
                                    title="הגדרת הקצאה"
                                    variant="settings"
                                    onClick={() => setDrawerTx(tx)}
                                    disabled={busyRow === tx.id}
                                  >
                                    <GearIcon />
                                  </IconAction>
                                  <IconAction
                                    title="בטל התאמה (חזרה ל'לא הותאמו')"
                                    variant="reject"
                                    onClick={() => handleRejectRow(tx.id, 'matched')}
                                    loading={busyRow === tx.id}
                                  >
                                    <XIcon />
                                  </IconAction>
                                  <IconAction
                                    title="מחק עסקה"
                                    variant="delete"
                                    onClick={() => setPendingDeleteId(tx.id)}
                                    disabled={busyRow === tx.id}
                                  >
                                    <TrashIcon />
                                  </IconAction>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* ── EXPENSES TAB ── */}
                {activeTab === 'expenses' && (
                  <div>
                    <div className="flex justify-end mb-3">
                      <button
                        type="button"
                        onClick={() => setShowCategoryManager(true)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-ink-300 text-ink-700 bg-white hover:bg-ink-50 transition-colors font-medium"
                      >
                        ⚙️ ניהול קטגוריות
                      </button>
                    </div>
                    {(review.expenses?.length ?? 0) === 0 ? (
                      <div className="text-center py-12 text-ink-500">
                        <div className="text-4xl mb-2">💸</div>
                        <p>לא זוהו הוצאות בדוח זה</p>
                      </div>
                    ) : (() => {
                      const isCategorized = (e: ExpenseRow) => !!(e.category_id || e.category);
                      const uncategorized = (review.expenses ?? []).filter(e => !isCategorized(e));
                      const categorized = (review.expenses ?? []).filter(isCategorized);
                      return (
                        <div className="space-y-4">
                          {/* Uncategorized rows */}
                          {uncategorized.length > 0 && (
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-semibold text-warn-600 bg-warn-50 border border-warn-50 px-2 py-0.5 rounded-full">
                                  ⚠ ללא קטגוריה ({uncategorized.length})
                                </span>
                              </div>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-ink-500 border-b text-right">
                                    <th className="pb-2 font-medium w-8">
                                      <input
                                        type="checkbox"
                                        className="rounded"
                                        ref={el => {
                                          if (el) {
                                            const allSelected = uncategorized.length > 0 && uncategorized.every(r => selectedExpenseIds.has(r.id));
                                            const someSelected = uncategorized.some(r => selectedExpenseIds.has(r.id));
                                            el.indeterminate = someSelected && !allSelected;
                                          }
                                        }}
                                        checked={uncategorized.length > 0 && uncategorized.every(r => selectedExpenseIds.has(r.id))}
                                        onChange={e => {
                                          if (e.target.checked) setSelectedExpenseIds(new Set(uncategorized.map(r => r.id)));
                                          else clearExpenseSelection();
                                        }}
                                      />
                                    </th>
                                    <th className="pb-2 font-medium">תאריך</th>
                                    <th className="pb-2 font-medium">תיאור</th>
                                    <th className="pb-2 font-medium">סכום</th>
                                    <th className="pb-2 font-medium text-left">פעולה</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-warn-50">
                                  {uncategorized.map((row: ExpenseRow) => (
                                    <tr key={row.id} className="bg-warn-50 hover:bg-warn-50">
                                      <td className="py-2.5">
                                        <input
                                          type="checkbox"
                                          className="rounded"
                                          checked={selectedExpenseIds.has(row.id)}
                                          onChange={() => toggleExpense(row.id)}
                                        />
                                      </td>
                                      <td className="py-2.5 text-ink-500">{formatDate(row.activity_date)}</td>
                                      <td className="py-2.5 text-ink-700 max-w-xs">
                                        <DescriptionCell
                                          extended={row.extended_description}
                                          short={row.description}
                                          compact
                                        />
                                        {row.is_from_current_statement === false && (
                                          <span className="inline-block mt-1 text-[11px] font-medium tracking-wide px-2 py-0.5 rounded-full bg-warn-50 text-warn-600 border border-warn-200">
                                            {row.source_period_label ? `מדף ${row.source_period_label}` : 'מהעלאה קודמת'}
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-2.5 text-danger-600 font-medium">
                                        -{formatAmount(row.debit_amount)}
                                      </td>
                                      <td className="py-2.5 text-left">
                                        <IconAction
                                          title="קטגר הוצאה"
                                          variant="settings"
                                          onClick={() => openExpenseEdit(row)}
                                          disabled={busyRow === row.id}
                                        >
                                          <GearIcon />
                                        </IconAction>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Categorized rows */}
                          {categorized.length > 0 && (
                            <div>
                              {uncategorized.length > 0 && (
                                <div className="border-t border-ink-200 mt-4 mb-3" />
                              )}
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-ink-500 border-b text-right">
                                    <th className="pb-2 font-medium">תאריך</th>
                                    <th className="pb-2 font-medium">תיאור</th>
                                    <th className="pb-2 font-medium">ספק</th>
                                    <th className="pb-2 font-medium">קטגוריה</th>
                                    <th className="pb-2 font-medium">סכום</th>
                                    <th className="pb-2 font-medium text-left">פעולות</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-ink-100">
                                  {categorized.map((row: ExpenseRow) => {
                                    const displayName =
                                      row.category_name ??
                                      LEGACY_CATEGORY_LABELS[row.category ?? ''] ??
                                      row.category ??
                                      '—';
                                    const dotColor = row.category_color ?? '#6366f1';
                                    return (
                                    <tr key={row.id} className="hover:bg-ink-50">
                                      <td className="py-2.5 text-ink-500 align-top">{formatDate(row.activity_date)}</td>
                                      <td className="py-2.5 text-ink-700 max-w-[180px]">
                                        <DescriptionCell
                                          extended={row.extended_description}
                                          short={row.description}
                                          compact
                                        />
                                        {row.notes && (
                                          <div className="text-xs text-ink-500 italic mt-0.5 truncate" title={row.notes}>
                                            💬 {row.notes}
                                          </div>
                                        )}
                                      </td>
                                      <td className="py-2.5 text-ink-900 font-medium">
                                        {row.vendor_label ?? '—'}
                                      </td>
                                      <td className="py-2.5">
                                        <span
                                          className="inline-flex items-center gap-1.5 bg-primary-50 text-primary-700 text-xs px-2 py-0.5 rounded-full font-medium"
                                          style={row.category_color ? { backgroundColor: `${row.category_color}1a`, color: row.category_color } : undefined}
                                        >
                                          <span
                                            className="w-2 h-2 rounded-full"
                                            style={{ backgroundColor: dotColor }}
                                          />
                                          {displayName}
                                        </span>
                                      </td>
                                      <td className="py-2.5 text-danger-600 font-medium">
                                        -{formatAmount(row.debit_amount)}
                                      </td>
                                      <td className="py-2.5 text-left">
                                        <div className="flex items-center gap-1 justify-end">
                                          <IconAction
                                            title="ערוך קטגוריה"
                                            variant="settings"
                                            onClick={() => openExpenseEdit(row)}
                                            disabled={busyRow === row.id}
                                          >
                                            <GearIcon />
                                          </IconAction>
                                          <IconAction
                                            title="הסר קטגוריה"
                                            variant="delete"
                                            onClick={() => handleUncategorize(row.id)}
                                            loading={busyRow === row.id}
                                          >
                                            <TrashIcon />
                                          </IconAction>
                                        </div>
                                      </td>
                                    </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Footer — non-blocking. "סיום" always enabled. */}
              <div className="border-t border-ink-200 px-6 py-4 flex items-center justify-between bg-ink-50 rounded-b-xl gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  {confirmError && (
                    <p className="text-danger-600 text-sm">{confirmError}</p>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  {pendingCount > 0 && (
                    <button
                      onClick={handleCommitPending}
                      disabled={bulkBusy}
                      className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:bg-primary-300"
                    >
                      {bulkBusy ? 'שומר...' : `אשר התאמות נבחרות (${pendingCount})`}
                    </button>
                  )}
                  {unconfirmedMatched.length > 0 && (
                    <button
                      onClick={handleApproveAllSuggestions}
                      disabled={bulkBusy}
                      title="סמן את כל ההתאמות האוטומטיות כמאושרות"
                      className="px-4 py-2 text-sm font-medium text-accent-700 bg-accent-50 border border-accent-200 hover:bg-accent-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      אשר את כל ההצעות
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="px-5 py-2 text-sm font-medium text-white bg-primary-700 hover:bg-primary-800 rounded-lg transition-colors"
                  >
                    סיום
                  </button>
                </div>
              </div>
            </>
          )}
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={pendingDeleteId !== null}
        title="מחיקת עסקה"
        message="האם למחוק את העסקה לצמיתות? לא ניתן לבטל פעולה זו."
        confirmText="מחק"
        cancelText="ביטול"
        type="danger"
        onConfirm={() => pendingDeleteId && handleDeleteRow(pendingDeleteId)}
        onCancel={() => setPendingDeleteId(null)}
      />

      {/* Category manager modal — reuses the same component as the building expenses page */}
      {showCategoryManager && (
        <CategoryManagerModal
          buildingId={buildingId}
          onClose={() => {
            setShowCategoryManager(false);
            reloadCategories();
          }}
        />
      )}

      {/* Allocation drawer */}
      {drawerTx && review && (
        <AllocationDrawer
          tx={drawerTx}
          allTenants={review.all_tenants}
          onClose={() => setDrawerTx(null)}
          onSaved={async () => {
            if (drawerTx) {
              const id = drawerTx.id;
              setRecentlyResolvedIds(s => new Set([...s, id]));
            }
            setDrawerTx(null);
            await refreshReview();
          }}
        />
      )}

      {/* Expense edit dialog — centered, comfortable size, sits above the modal */}
      {editingExpenseId && (
        <Modal open onClose={() => { setEditingExpenseId(null); setEditingExpenseRow(null); }} srTitle="קטגור הוצאה" size="md" className="p-6">
            <h3 className="text-base font-semibold text-ink-900 mb-4">
              קטגור הוצאה
            </h3>
            {editingExpenseRow && (
              <div className="mb-4 rounded-md border border-ink-200 bg-ink-50 px-3 py-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-xs text-ink-500">{formatDate(editingExpenseRow.activity_date)}</span>
                  <span className="font-semibold text-danger-600">
                    -{formatAmount(editingExpenseRow.debit_amount)}
                  </span>
                </div>
                <div className="text-ink-900 break-words">
                  <DescriptionCell
                    extended={editingExpenseRow.extended_description}
                    short={editingExpenseRow.description}
                  />
                </div>
              </div>
            )}
            <CategorizeFormFields
              value={expenseEditForm}
              onChange={setExpenseEditForm}
              categories={categories}
              onOpenCategoryManager={() => setShowCategoryManager(true)}
              notesPlaceholder="פרטים נוספים על ההוצאה..."
              rememberHint={
                editingExpenseRow
                  ? {
                      kind: 'single',
                      descriptionSample:
                        editingExpenseRow.extended_description ||
                        editingExpenseRow.description,
                    }
                  : undefined
              }
            />
            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => { setEditingExpenseId(null); setEditingExpenseRow(null); }}
                className="px-4 py-2 text-sm text-ink-700 border border-ink-300 rounded-md hover:bg-ink-50"
              >
                ביטול
              </button>
              <button
                onClick={() => editingExpenseId && handleSaveExpense(editingExpenseId)}
                disabled={!!busyRow || !expenseEditForm.vendor_label}
                className="px-4 py-2 text-sm text-white bg-primary-700 hover:bg-primary-700 rounded-md disabled:opacity-50"
              >
                {busyRow ? '...' : 'שמור'}
              </button>
            </div>
        </Modal>
      )}

      {/* Floating action bar — visible when any uncategorized expense is selected */}
      {selectedExpenseIds.size > 0 && !editingExpenseId && !bulkDialogOpen && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-ink-900 text-white rounded-full shadow-2xl px-5 py-3 flex items-center gap-4 text-sm z-[55]">
          <span className="font-semibold">{selectedExpenseIds.size} נבחרו</span>
          <button
            onClick={() => {
              setBulkEditForm({ vendor_label: '', category_id: '', notes: '', remember: false });
              setConfirmError(null);
              setBulkDialogOpen(true);
            }}
            className="bg-primary-500 hover:bg-primary-400 px-4 py-1.5 rounded-full font-medium"
          >
            קטגר נבחרים
          </button>
          <button onClick={clearExpenseSelection} className="text-ink-300 hover:text-white">
            נקה בחירה
          </button>
        </div>
      )}

      {/* Bulk categorize dialog */}
      {bulkDialogOpen && (
        <Modal open onClose={() => setBulkDialogOpen(false)} srTitle="קטגור הוצאות" size="md" className="p-6">
            <h3 className="text-base font-semibold text-ink-900 mb-4">
              קטגר {selectedExpenseIds.size} הוצאות
            </h3>
            <CategorizeFormFields
              value={bulkEditForm}
              onChange={setBulkEditForm}
              categories={categories}
              onOpenCategoryManager={() => setShowCategoryManager(true)}
              notesPlaceholder="פרטים נוספים על ההוצאות..."
              rememberHint={{ kind: 'bulk', count: selectedExpenseIds.size }}
            />
            {confirmError && <p className="text-danger-600 text-sm mt-3">{confirmError}</p>}
            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => setBulkDialogOpen(false)}
                className="px-4 py-2 text-sm text-ink-700 border border-ink-300 rounded-md hover:bg-ink-50"
              >
                ביטול
              </button>
              <button
                onClick={handleBulkCategorize}
                disabled={bulkBusy || (!bulkEditForm.category_id && !bulkEditForm.vendor_label)}
                className="px-4 py-2 text-sm text-white bg-primary-700 hover:bg-primary-700 rounded-md disabled:opacity-50"
              >
                {bulkBusy ? '...' : 'שמור'}
              </button>
            </div>
        </Modal>
      )}
    </>
  );
}

// ── Sub-components ──

interface UnmatchedRowProps {
  tx: ReviewTransaction;
  allTenants: MatchSuggestion[];
  selected: string;
  onSelect: (tenantId: string) => void;
  busy: boolean;
  state: ConfirmState;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  onOpenDrawer: () => void;
  meta?: React.ReactNode;
}

function UnmatchedRow({
  tx, allTenants, selected, onSelect, busy, state, onApprove, onReject, onDelete, onOpenDrawer, meta,
}: UnmatchedRowProps) {
  const suggestions = tx.suggestions || [];
  const suggestionIds = new Set(suggestions.map(s => s.tenant_id));
  const otherTenants = allTenants
    .filter(t => !suggestionIds.has(t.tenant_id))
    .sort((a, b) => a.tenant_name.localeCompare(b.tenant_name, 'he'));

  // Visual chrome varies by state. busy (used by reject/delete) keeps the existing dim/spinner UX.
  const isSaving = state.kind === 'saving';
  const isSuccess = state.kind === 'success';
  const isError = state.kind === 'error';
  const isSelected = !!selected && state.kind === 'idle';

  // Outer card classes pick up state colors + transition for the leaving fade
  const cardClasses = [
    'rounded-lg p-4 flex items-center gap-4 shadow-sm border transition-all duration-300',
    isSuccess
      ? 'bg-accent-50 border-accent-300'
      : isError
      ? 'bg-danger-50 border-danger-300'
      : isSelected
      ? 'bg-white border-primary-500 border-2'
      : 'bg-white border-ink-200',
  ].join(' ');

  // Payer name dims out in success state to signal the row is leaving
  const payerClasses = [
    'font-medium truncate',
    isSuccess ? 'text-ink-500 line-through opacity-50' : 'text-ink-900',
  ].join(' ');

  return (
    <div className={cardClasses}>
      {/* Transaction details */}
      <div className="flex-1 min-w-0">
        <p className={payerClasses}>
          {tx.payer_name || '—'}
        </p>
        <div className="mt-0.5">
          <DescriptionCell
            extended={tx.extended_description}
            short={tx.description}
            compact
          />
        </div>
        <p className="text-xs text-ink-500 mt-0.5">
          {formatDate(tx.activity_date)} · {formatAmount(tx.credit_amount)}
        </p>
        {meta && <div className="mt-1.5">{meta}</div>}

        {/* Success block — shown below the tx details once the API call resolves */}
        {isSuccess && (
          <div className="mt-2 space-y-1 text-sm">
            <p className="text-accent-700 font-medium">
              <span aria-hidden>✓ </span>
              שובץ ל-{state.tenantName}
              {state.apartmentNumber != null ? ` · דירה ${state.apartmentNumber}` : ''}
              {' · '}{formatAmount(tx.credit_amount)} ל{state.periodLabel}
            </p>
            <p className="text-accent-600 text-xs">
              <span aria-hidden>🧠 </span>
              המערכת תזהה "{tx.payer_name || '—'}" אוטומטית בעתיד
            </p>
          </div>
        )}

        {/* Error block */}
        {isError && (
          <p className="mt-2 text-sm text-danger-600">
            <span aria-hidden>⚠ </span>
            {state.message || 'אירעה שגיאה. נסה שוב.'}
          </p>
        )}
      </div>

      {/* Arrow — hide in success/error to make room for the wider message column */}
      {!isSuccess && !isError && (
        <span className="text-ink-500 text-lg flex-shrink-0">←</span>
      )}

      {/* Tenant selector — replaced by an inline spinner while saving, hidden on success */}
      {!isSuccess && (
        <div className="flex-1 min-w-0">
          {isSaving ? (
            <div className="flex items-center gap-2 text-sm text-ink-700 px-3 py-2 bg-primary-50 border border-primary-200 rounded-lg">
              <span
                className="inline-block w-3.5 h-3.5 border-2 border-primary-400 border-t-transparent rounded-full animate-spin"
                aria-hidden
              />
              <span>שומר את ההתאמה ל-{state.tenantName}...</span>
            </div>
          ) : (
            <select
              value={selected}
              onChange={e => onSelect(e.target.value)}
              disabled={isError ? false : busy}
              className="w-full border border-ink-300 rounded-lg px-3 py-2 text-sm text-ink-900 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-ink-50 disabled:text-ink-500"
              dir="rtl"
            >
              <option value="">-- בחר דייר --</option>

              {/* Top suggestions first */}
              {suggestions.length > 0 && (
                <>
                  <option disabled>── הצעות המערכת ──</option>
                  {suggestions.map(s => (
                    <option key={s.tenant_id} value={s.tenant_id}>
                      ★ {s.tenant_name} ({Math.round(s.score * 100)}%)
                    </option>
                  ))}
                </>
              )}

              {/* All other tenants */}
              {otherTenants.length > 0 && (
                <>
                  <option disabled>── כל הדיירים ──</option>
                  {otherTenants.map(t => (
                    <option key={t.tenant_id} value={t.tenant_id}>
                      {t.tenant_name}
                    </option>
                  ))}
                </>
              )}
            </select>
          )}
        </div>
      )}

      {/* Per-row actions — hidden in success state (the row is leaving) */}
      {!isSuccess && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <IconAction
            title={
              isError
                ? 'נסה שוב'
                : selected
                ? 'אשר התאמה'
                : 'בחר דייר תחילה'
            }
            variant="approve"
            onClick={onApprove}
            disabled={!selected || isSaving}
            loading={isSaving}
          >
            {isError ? (
              // Retry affordance: rotating arrow icon
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            ) : (
              <CheckIcon
                className={
                  isSelected
                    ? 'w-4 h-4 text-accent-600 animate-pulse'
                    : 'w-4 h-4'
                }
              />
            )}
          </IconAction>
          <IconAction
            title="הגדרת הקצאה"
            variant="settings"
            onClick={onOpenDrawer}
            disabled={busy || isSaving}
          >
            <GearIcon />
          </IconAction>
          <IconAction
            title="סמן כהוצאה (העבר ל'הוצאות מזוהות')"
            variant="reject"
            onClick={onReject}
            loading={busy}
            disabled={isSaving}
          >
            <XIcon />
          </IconAction>
          <IconAction
            title="מחק עסקה"
            variant="delete"
            onClick={onDelete}
            disabled={busy || isSaving}
          >
            <TrashIcon />
          </IconAction>
        </div>
      )}
    </div>
  );
}

interface LegacyUnmatchedSectionProps {
  rows: ReviewTransaction[];
  allTenants: MatchSuggestion[];
  pendingMatches: Record<string, string>;
  busyRow: string | null;
  getRowState: (txId: string) => ConfirmState;
  onSelect: (txId: string, tenantId: string) => void;
  onApprove: (txId: string) => void;
  onReject: (txId: string) => void;
  onDelete: (txId: string) => void;
  onOpenDrawer: (tx: ReviewTransaction) => void;
  defaultCollapsed: boolean;
}

function LegacyUnmatchedSection({
  rows, allTenants, pendingMatches, busyRow, getRowState,
  onSelect, onApprove, onReject, onDelete, onOpenDrawer,
  defaultCollapsed,
}: LegacyUnmatchedSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-3 text-right hover:bg-ink-100/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink-700">תשלומים מהעלאות קודמות</span>
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-warn-50 text-warn-600 border border-warn-200">
            {rows.length}
          </span>
        </div>
        <ChevronDownIcon
          className={`w-4 h-4 text-ink-500 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
        />
      </button>

      {!collapsed && (
        <div className="px-4 pb-4">
          <p className="text-xs text-ink-500 mb-3 pt-2 border-t border-ink-200">
            תשלומים מדפי בנק שהעלית בעבר ועדיין לא שובצו לדייר. אינם חלק מהדף הנוכחי, אך מומלץ לטפל בהם.
          </p>
          <div className="space-y-2 border-r-2 border-warn-300 pr-3">
            {rows.map((tx: ReviewTransaction) => (
              <UnmatchedRow
                key={tx.id}
                tx={tx}
                allTenants={allTenants}
                selected={pendingMatches[tx.id] || ''}
                onSelect={tenantId => onSelect(tx.id, tenantId)}
                busy={busyRow === tx.id}
                state={getRowState(tx.id)}
                onApprove={() => onApprove(tx.id)}
                onReject={() => onReject(tx.id)}
                onDelete={() => onDelete(tx.id)}
                onOpenDrawer={() => onOpenDrawer(tx)}
                meta={
                  tx.source_period_label ? (
                    <span className="inline-block text-[11px] font-medium tracking-wide px-2 py-0.5 rounded-full bg-ink-100 text-ink-700 border border-ink-200">
                      מדף {tx.source_period_label}
                    </span>
                  ) : undefined
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ConfidenceBadgeProps {
  confidence?: number | null;
}

function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  if (confidence == null) return <span className="text-ink-500">—</span>;
  const pct = Math.round(confidence * 100);
  const colorClass =
    pct >= 90
      ? 'bg-accent-100 text-accent-700'
      : pct >= 70
      ? 'bg-warn-50 text-warn-600'
      : 'bg-danger-50 text-danger-600';
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colorClass}`}>
      {pct}%
    </span>
  );
}

// ── ResolvedCard ──
// Renders a row the user just resolved via AllocationDrawer.
// Styled per-kind (single / split / multi_month / non_tenant) per mockup section 13.
interface ResolvedCardProps {
  tx: ReviewTransaction;
  kind: AllocationKind;
  busy: boolean;
  onEdit: () => void;
  onUndo: () => void;
}

function ResolvedCard({ tx, kind, busy, onEdit, onUndo }: ResolvedCardProps) {
  // Tailwind static class lookups (so JIT picks them up)
  const palette = {
    single:       { card: 'bg-accent-50 border-accent-200', badge: 'bg-accent-100 text-accent-700 border-accent-200' },
    split:        { card: 'bg-accent-50 border-accent-200', badge: 'bg-accent-100 text-accent-700 border-accent-200' },
    multi_month:  { card: 'bg-violet-50 border-violet-200',   badge: 'bg-violet-100 text-violet-700 border-violet-200' },
    non_tenant:   { card: 'bg-warn-50 border-warn-200',     badge: 'bg-warn-50 text-warn-600 border-warn-200' },
  }[kind];

  const allocs = tx.allocations ?? [];
  const total = allocs.reduce((sum, a) => sum + (a.amount ?? 0), 0) || tx.credit_amount || 0;

  // Kind-specific badge label
  const badgeLabel = (() => {
    if (kind === 'split') {
      const tenantCount = new Set(allocs.map(a => a.tenant_id).filter(Boolean)).size;
      return `✂️ פיצול ${tenantCount} דיירים`;
    }
    if (kind === 'multi_month') {
      const periods = new Set(allocs.map(a => `${a.period_year}-${a.period_month}`));
      return `📅 ${periods.size} חודשים`;
    }
    if (kind === 'non_tenant') {
      return '🏷️ הכנסה אחרת';
    }
    return '✓ נפתר';
  })();

  // Kind-specific breakdown block
  const breakdown = (() => {
    if (kind === 'split') {
      return (
        <div className="mt-2 space-y-0.5 text-xs text-ink-700">
          {allocs.filter(a => a.tenant_id).map(a => (
            <div key={a.id} className="flex justify-between gap-3">
              <span className="truncate">· {a.tenant_name || '—'}</span>
              <span className="font-medium tabular-nums">{formatAmount(a.amount)}</span>
            </div>
          ))}
        </div>
      );
    }
    if (kind === 'multi_month') {
      const tenantName = allocs.find(a => a.tenant_name)?.tenant_name;
      return (
        <div className="mt-2 text-xs text-ink-700">
          {tenantName && <div className="mb-1">דייר: <span className="font-medium">{tenantName}</span></div>}
          <div className="flex flex-wrap gap-1">
            {allocs.map(a => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 bg-white border border-violet-200 text-violet-700 px-2 py-0.5 rounded-full text-[11px]"
              >
                {a.period_month && a.period_year
                  ? `${HEBREW_MONTHS[a.period_month - 1]} ${a.period_year}`
                  : '—'}
                <span className="text-ink-500 font-medium">· {formatAmount(a.amount)}</span>
              </span>
            ))}
          </div>
        </div>
      );
    }
    if (kind === 'non_tenant') {
      const label = allocs.find(a => a.label)?.label;
      const category = allocs.find(a => a.category)?.category;
      return (
        <div className="mt-2 text-xs text-ink-700">
          {label && <div>תווית: <span className="font-medium">{label}</span></div>}
          {category && <div>קטגוריה: <span className="font-medium">{category}</span></div>}
        </div>
      );
    }
    // single
    const a = allocs[0];
    if (!a) return null;
    return (
      <div className="mt-2 text-xs text-ink-700">
        שובץ ל-<span className="font-medium">{a.tenant_name || '—'}</span>
        {a.period_month && a.period_year
          ? ` · ${HEBREW_MONTHS[a.period_month - 1]} ${a.period_year}`
          : ''}
      </div>
    );
  })();

  return (
    <div className={`rounded-lg p-4 border shadow-sm transition-all ${palette.card}`}>
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-ink-500 line-through opacity-50 truncate">
            {tx.payer_name || '—'}
          </p>
          <div className="mt-0.5">
            <DescriptionCell
              extended={tx.extended_description}
              short={tx.description}
              compact
            />
          </div>
          <p className="text-xs text-ink-500 mt-0.5">
            {formatDate(tx.activity_date)} · <span className="font-medium">{formatAmount(total)}</span>
          </p>
          {breakdown}
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${palette.badge}`}>
            {badgeLabel}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              disabled={busy}
              className="text-xs px-2 py-1 rounded-md text-ink-700 hover:text-primary-700 hover:bg-white/60 transition-colors disabled:opacity-50"
              title="ערוך הקצאה"
            >
              ערוך הקצאה
            </button>
            <button
              type="button"
              onClick={onUndo}
              disabled={busy}
              className="text-xs px-2 py-1 rounded-md text-ink-700 hover:text-danger-600 hover:bg-white/60 transition-colors disabled:opacity-50"
              title="בטל הקצאה"
            >
              {busy ? '…' : '↶ בטל'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
