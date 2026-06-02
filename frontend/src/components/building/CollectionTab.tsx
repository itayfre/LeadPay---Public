import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { paymentsAPI, tenantsAPI, messagesAPI, apartmentsAPI, statementsAPI, collectingAPI } from '../../services/api';
import type { PaymentStatus, WhatsAppMessage, TenantPaymentHistory, CollectingRow } from '../../types';
import type { DateRange, MonthYear } from '../../hooks/useBuildingPeriodRange';
import { expandRange } from '../../hooks/useBuildingPeriodRange';
import { useCollectionViewMode } from '../../hooks/useCollectionViewMode';
import { useAuth } from '../../context/AuthContext';
import TransactionEditModal from '../modals/TransactionEditModal';
import ConfirmDialog from '../modals/ConfirmDialog';
import AllocationDrawer from '../modals/AllocationDrawer';
import CollectionMatrixView from './CollectionMatrixView';
import SendRemindersModal from './SendRemindersModal';

// ─── Sub-types ────────────────────────────────────────────────────────────────

interface AggregatedTenant {
  tenant_id: string;
  tenant_name: string;
  apartment_number: number;
  phone?: string;
  language: 'he' | 'en';
  apartment_id: string;
  total_expected: number;
  total_paid: number;
  total_debt: number;
  status: 'paid' | 'partial' | 'unpaid';
  months: Array<PaymentStatus & { period_label: string }>;
  move_in_date?: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  buildingId: string;
  range: DateRange;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HE_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

function periodLabel({ month, year }: MonthYear): string {
  return HE_MONTHS[month - 1] + ' ' + year;
}

type SortCol =
  | 'apartment_number' | 'tenant_name' | 'total_expected'
  | 'total_paid' | 'total_debt' | 'status';

// ─── StatCard ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  title: string;
  value: string | number;
  total?: number;
  color: 'green' | 'red' | 'blue' | 'purple' | 'orange';
}

function StatCard({ title, value, total, color }: StatCardProps) {
  const cls: Record<string, { bg: string; dot: string; val: string }> = {
    green:  { bg: 'bg-accent-50 ring-accent-200',   dot: 'bg-accent-500', val: 'text-accent-700' },
    red:    { bg: 'bg-danger-50 ring-danger-200',   dot: 'bg-danger-500', val: 'text-danger-600' },
    blue:   { bg: 'bg-primary-50 ring-primary-200', dot: 'bg-primary-500', val: 'text-primary-800' },
    purple: { bg: 'bg-purple-50 ring-purple-200',   dot: 'bg-purple-500', val: 'text-purple-800' },
    orange: { bg: 'bg-warn-50 ring-warn-200',       dot: 'bg-warn-500',  val: 'text-warn-600' },
  };
  const c = cls[color];
  return (
    <div className={`rounded-xl ring-1 p-5 ${c.bg}`}>
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{title}</p>
      </div>
      <p className={`text-2xl font-bold mt-2 tabular-nums ${c.val}`}>
        {value}
        {total !== undefined && <span className="text-lg opacity-60">/{total}</span>}
      </p>
    </div>
  );
}

// ─── WhatsAppModal ────────────────────────────────────────────────────────────

function WhatsAppModal({
  messages,
  onClose,
}: {
  messages: WhatsAppMessage[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [sent, setSent] = useState<Set<string>>(new Set());

  const handleSend = async (msg: WhatsAppMessage) => {
    window.open(msg.whatsapp_link, '_blank');
    const id = msg.message_id || msg.tenant_id;
    setSent((prev) => new Set(prev).add(id));
    if (msg.message_id) {
      try { await messagesAPI.markSent(msg.message_id); } catch { /* ignore */ }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="p-6 border-b border-ink-200 flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold text-ink-900">{t('whatsapp.title')}</h3>
            <p className="text-sm text-ink-500 mt-1">{t('whatsapp.ready')}: {messages.length}</p>
          </div>
          <button onClick={onClose} className="text-ink-500 hover:text-ink-700 text-2xl">×</button>
        </div>
        <div className="overflow-y-auto max-h-[60vh] p-6 space-y-4">
          {messages.map((msg) => {
            const id = msg.message_id || msg.tenant_id;
            return (
              <div key={id} className="border border-ink-200 rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-medium text-ink-900">{msg.tenant_name}</p>
                    <p className="text-sm text-ink-500">{msg.phone}</p>
                  </div>
                  <button
                    onClick={() => handleSend(msg)}
                    disabled={sent.has(id)}
                    className={`px-4 py-2 rounded-md font-medium transition-colors ${
                      sent.has(id)
                        ? 'bg-ink-100 text-ink-500 cursor-not-allowed'
                        : 'bg-accent-600 text-white hover:bg-accent-700'
                    }`}
                  >
                    {sent.has(id) ? t('whatsapp.sent') : t('whatsapp.click')}
                  </button>
                </div>
                <div className="bg-ink-50 rounded p-3 text-sm text-ink-700 whitespace-pre-wrap" dir="auto">
                  {msg.message_preview}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── PaymentHistoryModal ──────────────────────────────────────────────────────

function PaymentHistoryModal({
  tenantHistory,
  isLoading,
  selectedMonthData,
  onSelectMonth,
  onClose,
  buildingId,
  onOpenAllocationEditor,
}: {
  tenantHistory: TenantPaymentHistory | undefined;
  isLoading: boolean;
  selectedMonthData: { month: number; year: number } | null;
  onSelectMonth: (m: { month: number; year: number }) => void;
  onClose: () => void;
  buildingId: string;
  onOpenAllocationEditor: (txId: string) => void;
}) {
  const activeMonth = selectedMonthData
    ? tenantHistory?.months.find(
        (m) => m.month === selectedMonthData.month && m.year === selectedMonthData.year
      )
    : tenantHistory?.months[tenantHistory.months.length - 1];

  const { user } = useAuth();
  const canEdit = user?.role === 'manager' || user?.role === 'worker';
  const canDelete = user?.role === 'manager';
  const [editingTx, setEditingTx] = useState<{ id: string; date: string; description: string; amount: number } | null>(null);
  const [deletingTx, setDeletingTx] = useState<{ id: string; description: string; amount: number; date: string } | null>(null);
  const [addPaymentFor, setAddPaymentFor] = useState<{ month: number; year: number; period: string } | null>(null);
  const [newPaymentAmount, setNewPaymentAmount] = useState('');
  const [newPaymentNote, setNewPaymentNote] = useState('');
  const queryClient = useQueryClient();

  const invalidateAfterChange = () => {
    if (tenantHistory?.tenant_id) {
      queryClient.invalidateQueries({ queryKey: ['tenantHistory', tenantHistory.tenant_id] });
    } else {
      queryClient.invalidateQueries({ queryKey: ['tenantHistory'] });
    }
    queryClient.invalidateQueries({ queryKey: ['paymentStatus', buildingId] });
  };

  const deleteMutation = useMutation({
    mutationFn: (txId: string) => statementsAPI.deleteTransaction(txId),
    onSuccess: () => {
      invalidateAfterChange();
      setDeletingTx(null);
    },
  });

  const addPaymentMutation = useMutation({
    mutationFn: (input: { amount: number; month: number; year: number; note?: string }) =>
      paymentsAPI.postManualPayment({
        building_id: buildingId,
        tenant_id: tenantHistory!.tenant_id,
        amount: input.amount,
        month: input.month,
        year: input.year,
        note: input.note,
      }),
    onSuccess: () => {
      invalidateAfterChange();
      setAddPaymentFor(null);
      setNewPaymentAmount('');
      setNewPaymentNote('');
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="p-6 border-b border-ink-200 flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold text-ink-900">
              היסטוריית תשלומים — {tenantHistory?.tenant_name}
            </h3>
            <p className="text-sm text-ink-500">
              דירה {tenantHistory?.apartment_number} • מאז {tenantHistory?.move_in_date ?? '—'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-ink-100 rounded-lg text-ink-500 hover:text-ink-700"
          >
            ✕
          </button>
        </div>
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
          </div>
        ) : !tenantHistory ? (
          <div className="flex-1 flex items-center justify-center p-12 text-ink-500">אין נתונים</div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Month list */}
            <div className="w-1/2 overflow-y-auto border-l border-ink-200">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 sticky top-0">
                  <tr>
                    {['תקופה', 'צפוי', 'שולם', 'הפרש', 'סטטוס'].map((h) => (
                      <th key={h} className="px-4 py-2 text-right text-xs text-ink-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {[...tenantHistory.months].reverse().map((m) => {
                    const isActive =
                      activeMonth?.month === m.month && activeMonth?.year === m.year;
                    return (
                      <tr
                        key={`${m.year}-${m.month}`}
                        onClick={() => onSelectMonth({ month: m.month, year: m.year })}
                        className={`cursor-pointer hover:bg-primary-50 transition-colors ${
                          isActive ? 'bg-primary-50 font-medium' : ''
                        }`}
                      >
                        <td className="px-4 py-2 text-ink-700">{m.period}</td>
                        <td className="px-4 py-2 text-ink-700">₪{m.expected.toLocaleString()}</td>
                        <td className="px-4 py-2 text-ink-900">₪{m.paid.toLocaleString()}</td>
                        <td className={`px-4 py-2 ${m.difference < 0 ? 'text-danger-600' : 'text-accent-600'}`}>
                          {m.difference >= 0 ? '+' : ''}₪{m.difference.toLocaleString()}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1 flex-wrap">
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded-full ${
                                m.status === 'paid'
                                  ? 'bg-accent-100 text-accent-700'
                                  : m.status === 'partial'
                                  ? 'bg-warn-50 text-warn-600'
                                  : 'bg-danger-50 text-danger-600'
                              }`}
                            >
                              {m.status === 'paid' ? 'שולם' : m.status === 'partial' ? 'חלקי' : 'לא שולם'}
                            </span>
                            {m.soft_covered_by && m.soft_covered_by.length > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const first = m.soft_covered_by![0];
                                  const [sm, sy] = first.source_period.split('/').map(Number);
                                  if (sm && sy) onSelectMonth({ month: sm, year: sy });
                                }}
                                title={m.soft_covered_by
                                  .map((s) => `ייתכן ששולם ${s.applied.toLocaleString()}₪ מתוך עסקה של ${s.source_tx_amount.toLocaleString()}₪ ב-${s.source_period} (${s.source_tx_date})`)
                                  .join('\n')}
                                className="text-xs px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700 hover:bg-primary-200"
                              >
                                ייתכן ששולם{m.soft_covered_fully ? '' : ' חלקית'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Transaction detail */}
            <div className="w-1/2 overflow-y-auto p-6">
              {activeMonth ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-semibold text-ink-900">
                      {activeMonth.period} — ₪{activeMonth.paid.toLocaleString()} / ₪{activeMonth.expected.toLocaleString()}
                    </h4>
                    {canEdit && (
                      <button
                        onClick={() => {
                          setAddPaymentFor({ month: activeMonth.month, year: activeMonth.year, period: activeMonth.period });
                          const remaining = Math.max(0, activeMonth.expected - activeMonth.paid);
                          setNewPaymentAmount(remaining > 0 ? String(remaining) : '');
                          setNewPaymentNote('');
                        }}
                        className="text-sm px-3 py-1.5 bg-accent-600 text-white rounded-lg hover:bg-accent-700 font-medium"
                      >
                        + הוסף תשלום
                      </button>
                    )}
                  </div>
                  {activeMonth.transactions.length === 0 ? (
                    <p className="text-sm text-ink-500">אין עסקאות לחודש זה</p>
                  ) : (
                    <div className="space-y-2">
                      {activeMonth.transactions.map((tx) => (
                        <div key={tx.id} className="flex justify-between items-center py-2 border-b border-ink-100 text-sm group">
                          <div className="flex-1 min-w-0">
                            <p className="text-ink-700 truncate">{tx.description}</p>
                            <p className="text-xs text-ink-500">{tx.date}</p>
                          </div>
                          <span className={`font-medium ${tx.is_manual ? 'text-primary-600' : 'text-accent-600'}`}>
                            ₪{tx.amount.toLocaleString()}
                            {tx.is_manual && <span className="text-xs text-ink-500 mr-1"> (ידני)</span>}
                          </span>
                          <div className="flex items-center gap-1 mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {canEdit && (
                              <button
                                onClick={() => setEditingTx({ id: tx.id, date: tx.date, description: tx.description, amount: tx.amount })}
                                className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-ink-100 text-ink-700"
                                title="ערוך"
                                aria-label="ערוך"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => setDeletingTx({ id: tx.id, description: tx.description, amount: tx.amount, date: tx.date })}
                                className="w-8 h-8 inline-flex items-center justify-center rounded-lg hover:bg-danger-50 text-danger-600"
                                title="מחק"
                                aria-label="מחק"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-ink-500">בחר חודש לצפייה בפרטים</p>
              )}
            </div>
          </div>
        )}
      </div>

      {editingTx && tenantHistory && (
        <TransactionEditModal
          transaction={editingTx}
          tenantId={tenantHistory.tenant_id}
          buildingId={buildingId}
          onClose={() => setEditingTx(null)}
          onOpenAllocationEditor={(txId) => {
            setEditingTx(null);
            onClose();
            onOpenAllocationEditor(txId);
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deletingTx}
        title="מחיקת עסקה"
        message={deletingTx ? `האם למחוק את העסקה "${deletingTx.description}" בסך ₪${deletingTx.amount.toLocaleString()} מתאריך ${deletingTx.date}? פעולה זו תסיר את העסקה ואת התשלום המקושר אליה לדייר. לא ניתן לשחזר.` : ''}
        confirmText="מחק"
        type="danger"
        onCancel={() => setDeletingTx(null)}
        onConfirm={() => deletingTx && deleteMutation.mutate(deletingTx.id)}
      />

      {addPaymentFor && tenantHistory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" dir="rtl">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-ink-900">
              הוספת תשלום — {tenantHistory.tenant_name}
            </h3>
            <p className="text-sm text-ink-500">
              דירה {tenantHistory.apartment_number} • {addPaymentFor.period}
            </p>
            <div>
              <label htmlFor="ct-new-amount" className="block text-sm font-medium text-ink-700 mb-1">סכום (₪)</label>
              <input
                id="ct-new-amount"
                type="number"
                value={newPaymentAmount}
                onChange={(e) => setNewPaymentAmount(e.target.value)}
                className="w-full rounded-lg ring-1 ring-ink-200 px-3 py-2 focus:ring-2 focus:ring-primary-500"
                placeholder="500"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="ct-new-note" className="block text-sm font-medium text-ink-700 mb-1">הערה (אופציונלי)</label>
              <input
                id="ct-new-note"
                type="text"
                value={newPaymentNote}
                onChange={(e) => setNewPaymentNote(e.target.value)}
                className="w-full rounded-lg ring-1 ring-ink-200 px-3 py-2 focus:ring-2 focus:ring-primary-500"
                placeholder="תשלום במזומן"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setAddPaymentFor(null);
                  setNewPaymentAmount('');
                  setNewPaymentNote('');
                }}
                className="flex-1 px-4 py-2 border border-ink-300 text-ink-700 rounded-lg hover:bg-ink-50"
              >
                ביטול
              </button>
              <button
                onClick={() => {
                  const amt = parseFloat(newPaymentAmount);
                  if (!isNaN(amt) && amt > 0) {
                    addPaymentMutation.mutate({
                      amount: amt,
                      month: addPaymentFor.month,
                      year: addPaymentFor.year,
                      note: newPaymentNote || undefined,
                    });
                  }
                }}
                disabled={
                  !newPaymentAmount ||
                  isNaN(parseFloat(newPaymentAmount)) ||
                  parseFloat(newPaymentAmount) <= 0 ||
                  addPaymentMutation.isPending
                }
                className="flex-1 px-4 py-2 bg-accent-600 text-white rounded-lg hover:bg-accent-700 disabled:opacity-50 font-semibold"
              >
                {addPaymentMutation.isPending ? 'שומר...' : 'אשר תשלום'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function CollectionTab({ buildingId, range }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // ── State ──────────────────────────────────────────────────────────────────
  const [togglingLanguage, setTogglingLanguage] = useState<string | null>(null);
  const [editingExpectedId, setEditingExpectedId] = useState<string | null>(null);
  const [editingExpectedValue, setEditingExpectedValue] = useState<string>('');
  const [savingExpected, setSavingExpected] = useState(false);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [whatsappMessages, setWhatsappMessages] = useState<WhatsAppMessage[]>([]);
  const [showSendRemindersModal, setShowSendRemindersModal] = useState(false);
  const [manualPaymentFor, setManualPaymentFor] = useState<AggregatedTenant | null>(null);
  const [manualAmount, setManualAmount] = useState<string>('');
  const [manualNote, setManualNote] = useState<string>('');
  const [savingManual, setSavingManual] = useState(false);
  const [revertConfirm, setRevertConfirm] = useState<AggregatedTenant | null>(null);
  const [historyTenantId, setHistoryTenantId] = useState<string | null>(null);
  const [selectedHistoryMonth, setSelectedHistoryMonth] = useState<{ month: number; year: number } | null>(null);
  const [allocationEditorTxId, setAllocationEditorTxId] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<SortCol>('apartment_number');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Matrix view state
  const [viewMode, setViewMode] = useCollectionViewMode();
  const [matrixYear, setMatrixYear] = useState<number>(range.to.year);
  const [targetPaymentMonth, setTargetPaymentMonth] = useState<MonthYear | null>(null);
  const [pendingEditCell, setPendingEditCell] = useState<{ tenantId: string; month: number; year: number } | null>(null);
  // ── Derived range info ─────────────────────────────────────────────────────
  const effectiveRange: DateRange = useMemo(() => {
    if (viewMode === 'matrix') {
      return {
        from: { month: 1, year: matrixYear },
        to: { month: 12, year: matrixYear },
      };
    }
    return range;
  }, [viewMode, matrixYear, range]);

  const monthList = useMemo(
    () => expandRange(effectiveRange.from, effectiveRange.to),
    [effectiveRange]
  );
  const isSingle = monthList.length === 1;

  // For manual payment modal, use targetPaymentMonth if set (matrix cell click), else last month in range
  const paymentMonth: MonthYear = targetPaymentMonth ?? effectiveRange.to;

  const todayMonth: MonthYear = useMemo(() => {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
  }, []);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: allMonthsData, isLoading } = useQuery({
    queryKey: ['paymentStatus', buildingId, effectiveRange.from, effectiveRange.to],
    queryFn: () =>
      Promise.all(monthList.map((m) => paymentsAPI.getStatus(buildingId, m.month, m.year))),
    enabled: !!buildingId,
  });

  const { data: tenantHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['tenantHistory', historyTenantId],
    queryFn: () => paymentsAPI.getTenantHistory(historyTenantId!),
    enabled: !!historyTenantId,
  });

  // Per-apartment context (active payer, sub-tenants, role labels) — read
  // from the same endpoint the new model uses elsewhere. Keyed on apt id
  // so the table can decorate each row with the apt's main payer + role
  // + sub-tenants without a per-row roundtrip.
  const { data: collectingData } = useQuery({
    queryKey: ['collecting', buildingId],
    queryFn: () => collectingAPI.get(buildingId),
    enabled: !!buildingId,
  });
  const apartmentContextById = useMemo(() => {
    const map = new Map<string, CollectingRow>();
    for (const row of collectingData?.rows ?? []) {
      map.set(row.apartment_id, row);
    }
    return map;
  }, [collectingData]);

  // ── Aggregate across months ────────────────────────────────────────────────
  const aggregated = useMemo((): AggregatedTenant[] => {
    if (!allMonthsData || allMonthsData.length === 0) return [];

    const byId = new Map<string, AggregatedTenant>();

    allMonthsData.forEach((monthData, idx) => {
      const m = monthList[idx];
      const label = periodLabel(m);
      (monthData.tenants || []).forEach((p) => {
        if (!byId.has(p.tenant_id)) {
          byId.set(p.tenant_id, {
            tenant_id: p.tenant_id,
            tenant_name: p.tenant_name,
            apartment_number: p.apartment_number,
            phone: p.phone,
            language: p.language,
            apartment_id: p.apartment_id,
            total_expected: 0,
            total_paid: 0,
            total_debt: 0,
            status: 'unpaid',
            months: [],
            move_in_date: p.move_in_date,
          });
        }
        const agg = byId.get(p.tenant_id)!;
        agg.total_expected += p.expected_amount;
        agg.total_paid += p.paid_amount;
        agg.total_debt = p.total_debt; // always overwrite with latest
        agg.months.push({ ...p, period_label: label });
      });
    });

    return Array.from(byId.values()).map((agg) => ({
      ...agg,
      status:
        agg.total_paid >= agg.total_expected && agg.total_expected > 0
          ? 'paid'
          : agg.total_paid > 0
          ? 'partial'
          : 'unpaid',
    }));
  }, [allMonthsData, monthList]);

  // Summary totals
  const summary = useMemo(() => {
    const firstMonthSummary = allMonthsData?.[0]?.summary;
    if (isSingle && firstMonthSummary) return firstMonthSummary;
    const total_tenants = aggregated.length;
    const paid = aggregated.filter((a) => a.status === 'paid').length;
    const partial = aggregated.filter((a) => a.status === 'partial').length;
    const unpaid = aggregated.filter((a) => a.status === 'unpaid').length;
    const total_expected = aggregated.reduce((s, a) => s + a.total_expected, 0);
    const total_collected = aggregated.reduce((s, a) => s + a.total_paid, 0);
    const rate = total_expected > 0 ? (total_collected / total_expected) * 100 : 0;
    return {
      total_tenants,
      paid,
      partial,
      unpaid,
      total_expected,
      total_collected,
      collection_rate: rate.toFixed(1) + '%',
      amount_rate: rate.toFixed(1) + '%',
    };
  }, [allMonthsData, aggregated, isSingle]);

  // ── Sorting ────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...aggregated].sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      switch (sortColumn) {
        case 'apartment_number': return (a.apartment_number - b.apartment_number) * dir;
        case 'tenant_name': return a.tenant_name.localeCompare(b.tenant_name, 'he') * dir;
        case 'total_expected': return (a.total_expected - b.total_expected) * dir;
        case 'total_paid': return (a.total_paid - b.total_paid) * dir;
        case 'total_debt': return (a.total_debt - b.total_debt) * dir;
        case 'status': {
          const order = { paid: 0, partial: 1, unpaid: 2 };
          return (order[a.status] - order[b.status]) * dir;
        }
        default: return 0;
      }
    });
  }, [aggregated, sortColumn, sortDirection]);

  const handleSort = (col: SortCol) => {
    if (sortColumn === col) setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortColumn(col); setSortDirection('asc'); }
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    const active = sortColumn === col;
    return (
      <svg className={`inline-block w-3 h-3 ml-1 ${active ? 'text-primary-600' : 'text-ink-300'} ${active && sortDirection === 'asc' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 13l-4-4h8l-4 4z" />
      </svg>
    );
  };

  // ── Handlers ───────────────────────────────────────────────────────────────
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['paymentStatus', buildingId] });
    queryClient.invalidateQueries({ queryKey: ['tenantHistory'] });
  };

  const handleMatrixCellClick = (
    tenant: AggregatedTenant,
    month: MonthYear,
    monthData: PaymentStatus | null,
  ) => {
    setTargetPaymentMonth(month);
    if (monthData && monthData.status === 'paid') {
      // Open AllocationDrawer for the transaction(s) that paid this cell
      setPendingEditCell({ tenantId: tenant.tenant_id, month: month.month, year: month.year });
      setHistoryTenantId(tenant.tenant_id);
      return;
    }
    const expected = monthData?.expected_amount ?? (tenant.months[0]?.expected_amount ?? 0);
    const paid = monthData?.paid_amount ?? 0;
    const remaining = Math.max(expected - paid, 0);
    setManualPaymentFor(tenant);
    setManualAmount(String(remaining || expected || 0));
    setManualNote('');
  };

  // When tenant history loads for a matrix-edit click, find the matching tx and open AllocationDrawer
  useEffect(() => {
    if (!pendingEditCell) return;
    if (!tenantHistory || tenantHistory.tenant_id !== pendingEditCell.tenantId) return;
    const m = tenantHistory.months.find(
      (x) => x.month === pendingEditCell.month && x.year === pendingEditCell.year
    );
    const firstTx = m?.transactions?.find((t) => !!t.id);
    if (firstTx?.id) {
      setAllocationEditorTxId(firstTx.id);
    }
    // Clear history modal trigger so it doesn't pop up
    setHistoryTenantId(null);
    setPendingEditCell(null);
  }, [pendingEditCell, tenantHistory]);

  const handleToggleLanguage = async (tenant: AggregatedTenant) => {
    if (togglingLanguage === tenant.tenant_id) return;
    setTogglingLanguage(tenant.tenant_id);
    const newLang: 'he' | 'en' = tenant.language === 'he' ? 'en' : 'he';
    try {
      await tenantsAPI.update(tenant.tenant_id, { language: newLang });
      invalidate();
    } catch { /* ignore */ }
    finally { setTogglingLanguage(null); }
  };

  const handleSaveExpected = async (tenant: AggregatedTenant) => {
    setSavingExpected(true);
    try {
      const val = editingExpectedValue === '' ? null : parseFloat(editingExpectedValue);
      await apartmentsAPI.patch(tenant.apartment_id, { expected_payment: val });
      invalidate();
      setEditingExpectedId(null);
    } catch { /* ignore */ }
    finally { setSavingExpected(false); }
  };

  // Opens the new multi-channel SendRemindersModal. The legacy single-tenant
  // wa.me modal is still used by the per-row "📱 Send" button below.
  const handleGenerateReminders = () => {
    setShowSendRemindersModal(true);
  };

  const handleStatusPillClick = (tenant: AggregatedTenant) => {
    if (tenant.status === 'paid') {
      setRevertConfirm(tenant);
    } else {
      // unpaid → pre-fill with expected; partial → pre-fill with remaining balance
      const remaining = tenant.total_expected - tenant.total_paid;
      const prefill = remaining > 0 ? remaining : (isSingle ? (tenant.months[0]?.expected_amount ?? 0) : 0);
      setManualPaymentFor(tenant);
      setManualAmount(String(prefill));
      setManualNote('');
    }
  };

  const handleRevert = async () => {
    if (!revertConfirm) return;
    setSavingManual(true);
    try {
      await paymentsAPI.postManualPayment({
        building_id: buildingId,
        tenant_id: revertConfirm.tenant_id,
        amount: -revertConfirm.total_paid,
        month: paymentMonth.month,
        year: paymentMonth.year,
        note: 'ביטול תשלום',
      });
      invalidate();
      setRevertConfirm(null);
      setTargetPaymentMonth(null);
    } catch { /* ignore */ }
    finally { setSavingManual(false); }
  };

  const handleManualPayment = async () => {
    if (!manualPaymentFor) return;
    setSavingManual(true);
    try {
      await paymentsAPI.postManualPayment({
        building_id: buildingId,
        tenant_id: manualPaymentFor.tenant_id,
        amount: parseFloat(manualAmount),
        month: paymentMonth.month,
        year: paymentMonth.year,
        note: manualNote || undefined,
      });
      invalidate();
      setManualPaymentFor(null);
      setManualAmount('');
      setManualNote('');
      setTargetPaymentMonth(null);
    } catch { /* ignore */ }
    finally { setSavingManual(false); }
  };

  const toggleRow = (id: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const collectionRateNum = parseFloat(summary.collection_rate) || 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  if ((summary.total_tenants || 0) === 0) {
    return (
      <div className="bg-primary-50 ring-1 ring-primary-200 rounded-xl p-8 text-center" dir="rtl">
        <svg className="w-12 h-12 mx-auto mb-3 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <h3 className="text-xl font-bold text-ink-900 mb-2">{t('dashboard.noTenants')}</h3>
        <p className="text-ink-700 mb-5">{t('dashboard.noTenantsHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Toolbar: view toggle + (matrix year stepper) + send reminders */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex bg-ink-100 rounded-lg p-1 text-sm font-medium">
          <button
            type="button"
            aria-pressed={viewMode === 'table'}
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              viewMode === 'table'
                ? 'bg-white text-ink-900 shadow-sm'
                : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {t('collection.viewTable')}
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'matrix'}
            onClick={() => setViewMode('matrix')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              viewMode === 'matrix'
                ? 'bg-white text-ink-900 shadow-sm'
                : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {t('collection.viewMatrix')}
          </button>
        </div>

        {viewMode === 'matrix' && (
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => setMatrixYear((y) => y - 1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg ring-1 ring-ink-200 hover:bg-ink-100 text-ink-500"
              aria-label={t('collection.matrix.prevYear')}
            >
              <svg className="w-4 h-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
            <span className="font-semibold text-ink-900 tabular-nums">
              {t('collection.matrixShowingYear', { year: matrixYear })}
            </span>
            <button
              type="button"
              onClick={() => setMatrixYear((y) => y + 1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg ring-1 ring-ink-200 hover:bg-ink-100 text-ink-500"
              aria-label={t('collection.matrix.nextYear')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        )}

        <button
          onClick={handleGenerateReminders}
          className="inline-flex items-center gap-2 h-10 bg-accent-600 text-white px-4 rounded-lg hover:bg-accent-700 transition-colors font-medium text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {t('dashboard.sendReminders')}
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard title={t('dashboard.paid')} value={summary.paid} total={summary.total_tenants} color="green" />
        {(summary.partial ?? 0) > 0 && (
          <StatCard title={t('dashboard.partial')} value={summary.partial ?? 0} total={summary.total_tenants} color="orange" />
        )}
        <StatCard title={t('dashboard.unpaid')} value={summary.unpaid} total={summary.total_tenants} color="red" />
        <StatCard title={t('dashboard.totalExpected')} value={'₪' + summary.total_expected.toLocaleString()} color="blue" />
        <StatCard title={t('dashboard.collectionRate')} value={Math.round(collectionRateNum) + '%'} color="purple" />
      </div>

      {/* Matrix view */}
      {viewMode === 'matrix' && (
        <CollectionMatrixView
          tenants={sorted}
          monthList={monthList}
          todayMonth={todayMonth}
          moveInByApartment={Object.fromEntries(
            sorted.map((t) => {
              if (!t.move_in_date) return [t.apartment_id, null];
              const d = new Date(t.move_in_date);
              return [t.apartment_id, { year: d.getFullYear(), month: d.getMonth() + 1 }];
            })
          )}
          onCellClick={handleMatrixCellClick}
          onTenantClick={(t) => { setHistoryTenantId(t.tenant_id); setSelectedHistoryMonth(null); }}
          highlightCell={targetPaymentMonth ? { tenantId: manualPaymentFor?.tenant_id ?? '', month: targetPaymentMonth.month, year: targetPaymentMonth.year } : null}
        />
      )}

      {/* Payment table */}
      {viewMode === 'table' && (
      <div className="bg-white rounded-xl ring-1 ring-ink-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-ink-200">
            <thead className="bg-ink-50">
              <tr>
                {!isSingle && <th className="w-8 px-2 py-3" />}
                <th onClick={() => handleSort('apartment_number')} className="px-6 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                  {t('payment.apartment')}<SortIcon col="apartment_number" />
                </th>
                <th onClick={() => handleSort('tenant_name')} className="px-6 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                  {t('payment.tenant')}<SortIcon col="tenant_name" />
                </th>
                <th onClick={() => handleSort('total_expected')} className="px-6 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                  {t('payment.expected')}<SortIcon col="total_expected" />
                </th>
                <th onClick={() => handleSort('total_paid')} className="px-6 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                  {t('payment.paid')}<SortIcon col="total_paid" />
                </th>
                <th onClick={() => handleSort('total_debt')} className="px-6 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                  חוב כולל<SortIcon col="total_debt" />
                </th>
                <th onClick={() => handleSort('status')} className="px-6 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                  {t('payment.status')}<SortIcon col="status" />
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">שפה</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">{t('payment.actions')}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-ink-200">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-ink-500">אין נתוני תשלומים לתקופה זו</td>
                </tr>
              ) : (
                sorted.map((tenant) => {
                  const isExpanded = expandedRows.has(tenant.tenant_id);
                  return (
                    <>
                      <tr key={tenant.tenant_id} className="hover:bg-ink-50">
                        {/* Expand chevron (multi-month only) */}
                        {!isSingle && (
                          <td className="px-2 py-4 text-center">
                            <button
                              onClick={() => toggleRow(tenant.tenant_id)}
                              aria-label={isExpanded ? 'כווץ' : 'הרחב'}
                              className="text-ink-400 hover:text-ink-700 transition-transform duration-150 inline-flex"
                              style={{ transform: isExpanded ? 'rotate(90deg)' : undefined }}
                            >
                              <svg className="w-3.5 h-3.5 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                            </button>
                          </td>
                        )}
                        <td
                          className="px-6 py-4 whitespace-nowrap text-sm font-medium text-primary-600 cursor-pointer hover:underline"
                          onClick={() => { setHistoryTenantId(tenant.tenant_id); setSelectedHistoryMonth(null); }}
                        >
                          {tenant.apartment_number}
                        </td>
                        <td
                          className="px-6 py-4 whitespace-nowrap text-sm text-ink-900 cursor-pointer hover:text-primary-600"
                          onClick={() => { setHistoryTenantId(tenant.tenant_id); setSelectedHistoryMonth(null); }}
                        >
                          <TenantNameCell
                            tenantName={tenant.tenant_name}
                            tenantId={tenant.tenant_id}
                            apartmentContext={apartmentContextById.get(tenant.apartment_id)}
                          />
                        </td>
                        {/* Expected – editable only for single month */}
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {isSingle && editingExpectedId === tenant.tenant_id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                value={editingExpectedValue}
                                onChange={(e) => setEditingExpectedValue(e.target.value)}
                                className="w-24 rounded ring-1 ring-ink-200 px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveExpected(tenant);
                                  if (e.key === 'Escape') setEditingExpectedId(null);
                                }}
                              />
                              <button onClick={() => handleSaveExpected(tenant)} disabled={savingExpected} aria-label="שמור" className="text-accent-600 px-1 inline-flex"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></button>
                              <button onClick={() => setEditingExpectedId(null)} aria-label="בטל" className="text-ink-500 px-1 inline-flex"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                            </div>
                          ) : (
                            <button
                              onClick={isSingle ? () => { setEditingExpectedId(tenant.tenant_id); const first = tenant.months[0]; setEditingExpectedValue(String(first?.expected_amount ?? '')); } : undefined}
                              className={isSingle ? 'hover:text-primary-600 hover:underline cursor-pointer font-medium' : 'cursor-default font-medium'}
                            >
                              ₪{tenant.total_expected.toLocaleString()}
                            </button>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => {
                              setManualPaymentFor(tenant);
                              setManualAmount(String(isSingle ? (tenant.months[0]?.expected_amount ?? 0) : 0));
                              setManualNote('');
                            }}
                            className="text-ink-900 hover:text-accent-600 hover:underline cursor-pointer"
                          >
                            ₪{tenant.total_paid.toLocaleString()}
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <span className={tenant.total_debt > 0 ? 'text-danger-600' : 'text-ink-500'}>
                            {tenant.total_debt > 0 ? '₪' + Math.round(tenant.total_debt).toLocaleString() : '—'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => handleStatusPillClick(tenant)}
                            title={tenant.status === 'paid' ? 'לחץ לביטול תשלום' : 'לחץ לרישום תשלום'}
                            className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-full cursor-pointer transition-opacity hover:opacity-75 ${
                              tenant.status === 'paid'
                                ? 'bg-accent-50 text-accent-700'
                                : tenant.status === 'partial'
                                ? 'bg-warn-50 text-warn-600'
                                : 'bg-danger-50 text-danger-600'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${tenant.status === 'paid' ? 'bg-accent-500' : tenant.status === 'partial' ? 'bg-warn-500' : 'bg-danger-500'}`} />
                            {tenant.status === 'paid' ? t('dashboard.paid') : tenant.status === 'partial' ? t('dashboard.partial') : t('dashboard.unpaid')}
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => handleToggleLanguage(tenant)}
                            disabled={togglingLanguage === tenant.tenant_id}
                            className={`inline-flex px-2 py-0.5 text-xs rounded font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                              tenant.language === 'he' ? 'bg-primary-50 text-primary-700 hover:bg-primary-100' : 'bg-ink-100 text-ink-700 hover:bg-ink-200'
                            }`}
                          >
                            {togglingLanguage === tenant.tenant_id ? '...' : tenant.language === 'he' ? 'עב' : 'EN'}
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {tenant.status !== 'paid' && tenant.phone && (
                            <button
                              onClick={async () => {
                                let msgs = whatsappMessages;
                                if (msgs.length === 0) {
                                  const res = await messagesAPI.generateReminders(buildingId, true);
                                  msgs = res.messages;
                                  setWhatsappMessages(msgs);
                                }
                                const found = msgs.find((m) => m.tenant_id === tenant.tenant_id);
                                if (found) window.open(found.whatsapp_link, '_blank');
                              }}
                              className="inline-flex items-center gap-1 text-accent-600 hover:text-accent-700 font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                              {t('payment.sendWhatsApp')}
                            </button>
                          )}
                        </td>
                      </tr>

                      {/* Per-month expansion rows */}
                      {!isSingle && isExpanded && tenant.months.map((m) => (
                        <tr key={tenant.tenant_id + '-' + m.period_label} className="bg-ink-50/70 text-xs">
                          <td />
                          <td className="px-6 py-2 text-ink-500">{m.period_label}</td>
                          <td className="px-6 py-2 text-ink-500">{m.tenant_name}</td>
                          <td className="px-6 py-2 text-ink-700">₪{m.expected_amount.toLocaleString()}</td>
                          <td className="px-6 py-2 text-ink-700">₪{m.paid_amount.toLocaleString()}</td>
                          <td className="px-6 py-2 text-ink-500">{m.total_debt > 0 ? '₪' + Math.round(m.total_debt).toLocaleString() : '—'}</td>
                          <td className="px-6 py-2">
                            <span className={`inline-flex px-1.5 py-0.5 text-xs rounded-full ${
                              m.status === 'paid' ? 'bg-accent-50 text-accent-700' : m.status === 'partial' ? 'bg-orange-50 text-orange-700' : 'bg-danger-50 text-danger-600'
                            }`}>
                              {m.status === 'paid' ? 'שולם' : m.status === 'partial' ? 'חלקי' : 'לא שולם'}
                            </span>
                          </td>
                          <td /><td />
                        </tr>
                      ))}
                    </>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Manual Payment Modal */}
      {manualPaymentFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir="rtl">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-ink-900">
              {manualPaymentFor.status === 'partial' ? 'ערוך תשלום' : 'סמן כשולם'} — {manualPaymentFor.tenant_name}
            </h3>
            <p className="text-sm text-ink-500">
              דירה {manualPaymentFor.apartment_number} • {String(paymentMonth.month).padStart(2, '0')}/{paymentMonth.year}
            </p>
            <div>
              <label htmlFor="ct-manual-amount" className="block text-sm font-medium text-ink-700 mb-1">סכום (₪)</label>
              <input
                id="ct-manual-amount"
                type="number"
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
                className="w-full rounded-lg ring-1 ring-ink-200 px-3 py-2 focus:ring-2 focus:ring-primary-500"
                placeholder="500"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="ct-manual-note" className="block text-sm font-medium text-ink-700 mb-1">הערה (אופציונלי)</label>
              <input
                id="ct-manual-note"
                type="text"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                className="w-full rounded-lg ring-1 ring-ink-200 px-3 py-2 focus:ring-2 focus:ring-primary-500"
                placeholder="תשלום במזומן"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setManualPaymentFor(null); setTargetPaymentMonth(null); }} className="flex-1 px-4 py-2 border border-ink-300 text-ink-700 rounded-lg hover:bg-ink-50">ביטול</button>
              <button
                onClick={handleManualPayment}
                disabled={!manualAmount || isNaN(parseFloat(manualAmount)) || parseFloat(manualAmount) <= 0 || savingManual}
                className="flex-1 px-4 py-2 bg-accent-600 text-white rounded-lg hover:bg-accent-700 disabled:opacity-50 font-semibold"
              >
                {savingManual ? 'שומר...' : 'אשר תשלום'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revert Payment Confirm Modal */}
      {revertConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir="rtl">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-ink-900">ביטול תשלום</h3>
            <p className="text-sm text-ink-700">
              האם לבטל את התשלום של <strong>{revertConfirm.tenant_name}</strong>?
              <br />
              סכום לביטול: ₪{revertConfirm.total_paid.toLocaleString()}
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setRevertConfirm(null); setTargetPaymentMonth(null); }}
                className="flex-1 px-4 py-2 border border-ink-300 text-ink-700 rounded-lg hover:bg-ink-50"
              >
                ביטול
              </button>
              <button
                onClick={handleRevert}
                disabled={savingManual}
                className="flex-1 px-4 py-2 bg-danger-600 text-white rounded-lg hover:bg-danger-600 disabled:opacity-50 font-semibold"
              >
                {savingManual ? 'מבטל...' : 'בטל תשלום'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showWhatsAppModal && (
        <WhatsAppModal messages={whatsappMessages} onClose={() => setShowWhatsAppModal(false)} />
      )}

      {showSendRemindersModal && (
        <SendRemindersModal
          buildingId={buildingId}
          periodMonth={range.to.month}
          periodYear={range.to.year}
          onClose={() => setShowSendRemindersModal(false)}
        />
      )}

      {historyTenantId && (
        <PaymentHistoryModal
          tenantHistory={tenantHistory}
          isLoading={historyLoading}
          selectedMonthData={selectedHistoryMonth}
          onSelectMonth={setSelectedHistoryMonth}
          onClose={() => { setHistoryTenantId(null); setSelectedHistoryMonth(null); }}
          buildingId={buildingId}
          onOpenAllocationEditor={(txId) => setAllocationEditorTxId(txId)}
        />
      )}

      {allocationEditorTxId && (
        <AllocationDrawer
          transactionId={allocationEditorTxId}
          onClose={() => setAllocationEditorTxId(null)}
          onSaved={() => {
            setAllocationEditorTxId(null);
            queryClient.invalidateQueries({ queryKey: ['paymentStatus', buildingId] });
            queryClient.invalidateQueries({ queryKey: ['tenantHistory'] });
          }}
        />
      )}
    </div>
  );
}


// ─── TenantNameCell ──────────────────────────────────────────────────────────
// Decorates the tenant cell with the apartment's role label, primary-payer
// badge, and (if any) other tenants on the same apt shown muted.

interface TenantNameCellProps {
  tenantName: string;
  tenantId: string;
  apartmentContext?: CollectingRow;
}

function TenantNameCell({ tenantName, tenantId, apartmentContext }: TenantNameCellProps) {
  // Active tenant for this apt (will be us in most cases post-cleanup).
  const me = apartmentContext?.apartment_tenants.find((x) => x.id === tenantId);
  const isPrimary = me?.is_primary_payer === true;
  const role = me?.ownership_type ?? null;
  const others = (apartmentContext?.apartment_tenants ?? []).filter(
    (x) => x.id !== tenantId,
  );

  return (
    <div className="leading-tight">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-ink-900 truncate">{tenantName}</span>
        {isPrimary && (
          <span className="text-[10px] uppercase tracking-wide text-slate-500 border border-slate-200 rounded px-1.5 py-0.5">
            משלם ראשי
          </span>
        )}
        {role && <span className="text-xs text-slate-500">({role})</span>}
      </div>
      {others.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0">
          {others.map((other) => (
            <span key={other.id} className="text-[11px] text-slate-400">
              {other.name}
              {other.ownership_type && ` (${other.ownership_type})`}
              {!other.is_active && (
                <span className="text-slate-300 mx-1">·לא פעיל</span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
