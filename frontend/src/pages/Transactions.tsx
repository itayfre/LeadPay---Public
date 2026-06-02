import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../hooks/useToast';
import Layout from '../components/layout/Layout';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import TransactionFilters from '../components/transactions/TransactionFilters';
import TransactionEditDialog from '../components/transactions/TransactionEditDialog';
import AddTransactionModal from '../components/transactions/AddTransactionModal';
import QuickMatchPopover from '../components/transactions/QuickMatchPopover';
import QuickExpensePopover from '../components/transactions/QuickExpensePopover';
import AllocationDrawer from '../components/modals/AllocationDrawer';
import DescriptionCell from '../components/shared/DescriptionCell';
import Badge from '../components/ui/Badge';
import { transactionsAPI, statementsAPI } from '../services/api';
import type { TransactionRow, TransactionsListParams } from '../types';

type ViewMode = 'compact' | 'detailed' | 'full';

const VIEW_STORAGE_KEY = 'transactions.view';

function loadInitialView(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    if (v === 'compact' || v === 'detailed' || v === 'full') return v;
  } catch {}
  return 'compact';
}

const SortIcon = ({
  col,
  active,
  desc,
}: {
  col: string;
  active: string;
  desc: boolean;
}) => {
  const isActive = active === col;
  return (
    <svg
      className={`inline-block w-3 h-3 mr-1 ${isActive ? 'text-primary-600' : 'text-ink-300'} ${isActive && !desc ? 'rotate-180' : ''}`}
      fill="currentColor"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path d="M10 13l-4-4h8l-4 4z" />
    </svg>
  );
};

function formatAmount(row: TransactionRow): { value: string; color: string } {
  if (row.credit_amount != null && row.credit_amount !== 0) {
    return { value: `₪${row.credit_amount.toLocaleString()}`, color: 'text-accent-700' };
  }
  if (row.debit_amount != null && row.debit_amount !== 0) {
    return { value: `−₪${row.debit_amount.toLocaleString()}`, color: 'text-danger-600' };
  }
  return { value: '—', color: 'text-ink-500' };
}

function MatchStatusBadge({ row }: { row: TransactionRow }) {
  // Split: confirmed but no single matched_tenant_id — the allocations table holds multiple tenants
  if (row.is_confirmed && !row.matched_tenant_id && row.allocations_summary.count >= 2) {
    return <Badge tone="primary">פיצול · {row.allocations_summary.count}</Badge>;
  }
  if (row.is_confirmed && row.matched_tenant_id) {
    return <Badge tone="accent">אושר</Badge>;
  }
  // Non-tenant labeled allocation (confirmed, no tenant, single row)
  if (row.is_confirmed && !row.matched_tenant_id && row.allocations_summary.count >= 1) {
    const label = row.allocations_summary.top_label ?? 'הכנסה אחרת';
    return <Badge tone="primary" className="max-w-[140px]"><span className="truncate" title={label}>{label}</span></Badge>;
  }
  if (row.matched_tenant_id) {
    const conf = row.match_confidence ? Math.round(row.match_confidence * 100) : null;
    return (
      <span title={row.match_method ? `שיטה: ${row.match_method}` : ''}>
        <Badge tone="warn">אוטומטי{conf != null ? ` ${conf}%` : ''}</Badge>
      </span>
    );
  }
  if (row.transaction_type === 'other') {
    return <Badge tone="neutral">מתעלם</Badge>;
  }
  return <Badge tone="danger">לא מותאם</Badge>;
}

/** Renders the "Matched tenant" cell — handles single match, split, and unmatched. */
function TenantCell({ row }: { row: TransactionRow }) {
  if (row.matched_tenant_name) {
    return <span className="text-sm text-ink-700">{row.matched_tenant_name}</span>;
  }
  if (row.is_confirmed && row.allocations_summary.count >= 2) {
    const labels = row.allocations_summary.labels;
    const first = labels[0] ?? '—';
    const extra = labels.length - 1;
    return (
      <span
        className="text-sm text-purple-700"
        title={labels.join(' · ')}
      >
        {first}{extra > 0 ? ` +${extra}` : ''}
      </span>
    );
  }
  if (row.is_confirmed && !row.matched_tenant_id && row.allocations_summary.top_label) {
    return <span className="text-sm text-primary-700">{row.allocations_summary.top_label}</span>;
  }
  return <span className="text-sm text-ink-500">—</span>;
}

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-ink-500">—</span>;
  const styles: Record<string, string> = {
    payment: 'bg-primary-50 text-primary-700',
    fee: 'bg-orange-50 text-orange-700',
    transfer: 'bg-purple-50 text-purple-700',
    other: 'bg-ink-100 text-ink-700',
  };
  const labels: Record<string, string> = {
    payment: 'תשלום',
    fee: 'עמלה',
    transfer: 'העברה',
    other: 'אחר',
  };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${styles[type] ?? 'bg-ink-100 text-ink-700'}`}>{labels[type] ?? type}</span>;
}

export default function Transactions() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [filters, setFilters] = useState<TransactionsListParams>({
    page: 1,
    page_size: 50,
    sort: '-activity_date',
  });
  const [view, setView] = useState<ViewMode>(loadInitialView);
  const [editRow, setEditRow] = useState<TransactionRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<TransactionRow | null>(null);
  const [matchRow, setMatchRow] = useState<TransactionRow | null>(null);
  const [expenseRow, setExpenseRow] = useState<TransactionRow | null>(null);
  const [splitTxId, setSplitTxId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch {}
  }, [view]);

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', filters],
    queryFn: () => transactionsAPI.list(filters),
  });

  const handleSort = (col: string) => {
    const current = filters.sort ?? '-activity_date';
    const desc = current.startsWith('-');
    const key = desc ? current.slice(1) : current;
    let next: string;
    if (key === col) next = desc ? col : `-${col}`;
    else next = `-${col}`;
    setFilters(f => ({ ...f, sort: next, page: 1 }));
  };

  const activeSort = (filters.sort ?? '-activity_date').replace(/^-/, '');
  const sortDesc = (filters.sort ?? '-activity_date').startsWith('-');

  const unmatchMutation = useMutation({
    mutationFn: (txId: string) => statementsAPI.unmatchTransaction(txId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      showToast({ title: '✓ ההתאמה בוטלה', variant: 'success', durationMs: 4000 });
    },
  });

  const handleDelete = async () => {
    if (!deleteRow) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await statementsAPI.deleteTransaction(deleteRow.id);
      setDeleteRow(null);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const total = data?.total ?? 0;
  const pageSize = filters.page_size ?? 50;
  const page = filters.page ?? 1;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  const showDetailedCols = view === 'detailed' || view === 'full';
  const showFullCols = view === 'full';

  return (
    <Layout>
      <div className="space-y-4" dir="rtl">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-ink-900">תנועות</h2>
            <p className="text-sm text-ink-500">{total.toLocaleString()} תנועות בסך הכל</p>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex bg-ink-100 rounded-lg p-0.5 text-xs">
              {(['compact', 'detailed', 'full'] as ViewMode[]).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                    view === v ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
                  }`}
                >
                  {v === 'compact' ? 'מצומצם' : v === 'detailed' ? 'מפורט' : 'מלא'}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium text-sm transition-colors"
            >
              + הוסף תנועה
            </button>
          </div>
        </div>

        <TransactionFilters
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters({ page: 1, page_size: 50, sort: '-activity_date' })}
        />

        {/* Table */}
        <div className="bg-white rounded-xl border border-ink-200 overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : (data?.items.length ?? 0) === 0 ? (
            <div className="text-center py-16">
              <svg className="w-12 h-12 mx-auto mb-4 text-ink-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-xl font-bold text-ink-900 mb-2">לא נמצאו תנועות</h3>
              <p className="text-ink-500">נסה לשנות את הסינון או להעלות דף חשבון.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-200">
                <thead className="bg-ink-50">
                  <tr>
                    <th
                      onClick={() => handleSort('activity_date')}
                      className="px-3 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none"
                    >
                      תאריך<SortIcon col="activity_date" active={activeSort} desc={sortDesc} />
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">בניין</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">תיאור</th>
                    {showDetailedCols && (
                      <th className="px-3 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">משלם</th>
                    )}
                    <th
                      onClick={() => handleSort('amount')}
                      className="px-3 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none"
                    >
                      סכום<SortIcon col="amount" active={activeSort} desc={sortDesc} />
                    </th>
                    {showDetailedCols && (
                      <th className="px-3 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">סוג</th>
                    )}
                    <th className="px-3 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">דייר</th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">סטטוס</th>
                    {showDetailedCols && (
                      <>
                        <th className="px-3 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">הקצאות</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">מקור</th>
                      </>
                    )}
                    {showFullCols && (
                      <>
                        <th className="px-3 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">אסמכתא</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">יתרה</th>
                      </>
                    )}
                    <th className="px-3 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">פעולות</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-ink-100">
                  {data!.items.map(row => {
                    const amt = formatAmount(row);
                    const rowHighlight =
                      !row.matched_tenant_id && row.transaction_type !== 'other'
                        ? 'bg-danger-50/30'
                        : row.matched_tenant_id && !row.is_confirmed
                          ? 'bg-warn-50/30'
                          : '';
                    return (
                      <tr key={row.id} className={`hover:bg-ink-50 transition-colors ${rowHighlight}`}>
                        <td className="px-3 py-2.5 text-sm text-ink-700 whitespace-nowrap">
                          {new Date(row.activity_date).toLocaleDateString('he-IL')}
                        </td>
                        <td className="px-3 py-2.5 text-sm text-ink-700">{row.building_name ?? '—'}</td>
                        <td className="px-3 py-2.5 text-sm text-ink-900 max-w-xs">
                          <DescriptionCell
                            extended={row.extended_description}
                            short={row.description}
                            compact
                          />
                        </td>
                        {showDetailedCols && (
                          <td className="px-3 py-2.5 text-sm text-ink-700">{row.payer_name ?? '—'}</td>
                        )}
                        <td className={`px-3 py-2.5 text-sm font-medium whitespace-nowrap ${amt.color}`}>{amt.value}</td>
                        {showDetailedCols && (
                          <td className="px-3 py-2.5"><TypeBadge type={row.transaction_type} /></td>
                        )}
                        <td className="px-3 py-2.5"><TenantCell row={row} /></td>
                        <td className="px-3 py-2.5"><MatchStatusBadge row={row} /></td>
                        {showDetailedCols && (
                          <>
                            <td className="px-3 py-2.5 text-sm">
                              {row.allocations_summary.count === 0 ? (
                                <span className="text-ink-300">—</span>
                              ) : row.allocations_summary.count === 1 ? (
                                <span className="text-ink-700 text-xs">{row.allocations_summary.top_label ?? '—'}</span>
                              ) : (
                                <span className="text-xs text-ink-700">{row.allocations_summary.top_label} +{row.allocations_summary.count - 1}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              {row.is_manual ? (
                                <span className="inline-block px-2 py-0.5 rounded text-xs bg-primary-50 text-primary-700">ידני</span>
                              ) : (
                                <span className="inline-block px-2 py-0.5 rounded text-xs bg-ink-50 text-ink-700">בנק</span>
                              )}
                            </td>
                          </>
                        )}
                        {showFullCols && (
                          <>
                            <td className="px-3 py-2.5 text-xs text-ink-500" dir="ltr">{row.reference_number ?? '—'}</td>
                            <td className="px-3 py-2.5 text-xs text-ink-500">
                              {row.balance != null ? `₪${row.balance.toLocaleString()}` : '—'}
                            </td>
                          </>
                        )}
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1.5">
                            {/* Match action: unmatched payments AND non-tenant labeled rows (so user can reassign to a tenant) */}
                            {((!row.matched_tenant_id && !row.is_confirmed) ||
                              (row.is_confirmed && !row.matched_tenant_id && row.allocations_summary.count < 2)) &&
                              row.transaction_type !== 'other' && (
                              <button
                                onClick={() => {
                                  const isExpense = row.debit_amount != null && row.debit_amount !== 0;
                                  if (isExpense) setExpenseRow(row);
                                  else setMatchRow(row);
                                }}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-500 hover:text-primary-600 hover:bg-ink-100 transition-colors"
                                title={row.debit_amount != null && row.debit_amount !== 0 ? 'קטגור הוצאה' : 'התאם לדייר'}
                                aria-label={row.debit_amount != null && row.debit_amount !== 0 ? 'קטגור הוצאה' : 'התאם לדייר'}
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                              </button>
                            )}
                            {/* Split editor: any row already resolved as a split, lets the user re-balance */}
                            {row.is_confirmed && row.allocations_summary.count >= 2 && (
                              <button
                                onClick={() => setSplitTxId(row.id)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-500 hover:text-primary-600 hover:bg-ink-100 transition-colors"
                                title="עריכת פיצול"
                                aria-label="עריכת פיצול"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                                </svg>
                              </button>
                            )}
                            <button
                              onClick={() => setEditRow(row)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-500 hover:text-primary-600 hover:bg-ink-100 transition-colors"
                              title="עריכה"
                              aria-label="עריכה"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            {(row.matched_tenant_id || row.is_confirmed) && (
                              <button
                                onClick={() => unmatchMutation.mutate(row.id)}
                                disabled={unmatchMutation.isPending}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-500 hover:text-warn-600 hover:bg-ink-100 transition-colors"
                                title="בטל התאמה"
                                aria-label="בטל התאמה"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 018 0m-4 7v3m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                </svg>
                              </button>
                            )}
                            <button
                              onClick={() => { setDeleteRow(row); setDeleteError(null); }}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-500 hover:text-danger-600 hover:bg-danger-50 transition-colors"
                              title="מחיקה"
                              aria-label="מחיקה"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination footer */}
          {!isLoading && (data?.items.length ?? 0) > 0 && (
            <div className="px-4 py-3 border-t border-ink-200 flex justify-between items-center text-sm text-ink-700">
              <div>
                מציג {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} מתוך {total.toLocaleString()}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={pageSize}
                  onChange={e => setFilters(f => ({ ...f, page_size: parseInt(e.target.value), page: 1 }))}
                  className="border border-ink-300 rounded px-2 py-1 text-sm"
                >
                  {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / עמוד</option>)}
                </select>
                <button
                  onClick={() => setFilters(f => ({ ...f, page: Math.max(1, (f.page ?? 1) - 1) }))}
                  disabled={page <= 1}
                  className="px-3 py-1 border border-ink-300 rounded hover:bg-ink-50 disabled:opacity-40"
                >
                  ‹ הקודם
                </button>
                <span className="px-2">{page} / {lastPage}</span>
                <button
                  onClick={() => setFilters(f => ({ ...f, page: Math.min(lastPage, (f.page ?? 1) + 1) }))}
                  disabled={page >= lastPage}
                  className="px-3 py-1 border border-ink-300 rounded hover:bg-ink-50 disabled:opacity-40"
                >
                  הבא ›
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {editRow && (
        <TransactionEditDialog row={editRow} onClose={() => setEditRow(null)} />
      )}

      {expenseRow && (
        <QuickExpensePopover
          row={expenseRow}
          onClose={() => setExpenseRow(null)}
          onSaved={() => showToast({ title: '✓ ההוצאה נשמרה', variant: 'success', durationMs: 4000 })}
        />
      )}

      {matchRow && (
        <QuickMatchPopover
          row={matchRow}
          onClose={() => setMatchRow(null)}
          onMatched={() => showToast({ title: '✓ ההתאמה נשמרה', variant: 'success', durationMs: 4000 })}
          onOpenSplit={() => {
            setSplitTxId(matchRow.id);
            setMatchRow(null);
          }}
        />
      )}

      {splitTxId && (
        <AllocationDrawer
          transactionId={splitTxId}
          onClose={() => setSplitTxId(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['transactions'] });
            setSplitTxId(null);
            showToast({ title: '✓ ההקצאה נשמרה', variant: 'success', durationMs: 4000 });
          }}
        />
      )}

      {showAdd && (
        <AddTransactionModal onClose={() => setShowAdd(false)} />
      )}

      {deleteError && deleteRow && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-danger-50 border border-danger-50 rounded-lg px-4 py-3 text-danger-600 text-sm shadow-lg">
          {deleteError}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteRow}
        title="מחיקת תנועה"
        message={
          deleteRow
            ? `האם למחוק את התנועה "${deleteRow.description}"? פעולה זו אינה ניתנת לביטול.`
            : ''
        }
        confirmText={deleting ? 'מוחק...' : 'מחק'}
        cancelText="ביטול"
        type="danger"
        onConfirm={handleDelete}
        onCancel={() => { setDeleteRow(null); setDeleteError(null); }}
      />
    </Layout>
  );
}
