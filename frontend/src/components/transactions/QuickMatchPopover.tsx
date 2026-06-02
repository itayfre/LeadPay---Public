import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { statementsAPI } from '../../services/api';
import DescriptionCell from '../shared/DescriptionCell';
import Modal from '../ui/Modal';
import { useToast } from '../../hooks/useToast';
import type { MatchSuggestion, TransactionRow, TransactionsListResponse } from '../../types';

interface Props {
  row: TransactionRow;
  onClose: () => void;
  onOpenSplit: () => void;
  onMatched?: () => void;
}

/**
 * Inline single-tenant match for an unmatched transaction. Loads the same
 * suggestion data the upload-review screen uses, lets the user pick a tenant
 * in one click, and optionally teaches the engine via `remember`.
 *
 * For multi-tenant splits or monthly periods, the user clicks "פיצול" which
 * hands control to the existing AllocationDrawer (handled by the parent).
 */
export default function QuickMatchPopover({ row, onClose, onOpenSplit, onMatched }: Props) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [remember, setRemember] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ['reviewForm', row.id],
    queryFn: () => statementsAPI.getTransactionReviewForm(row.id),
  });

  const suggestions: MatchSuggestion[] = data?.tx?.suggestions ?? [];
  const allTenants: MatchSuggestion[] = data?.all_tenants ?? [];

  const suggestionIds = useMemo(() => new Set(suggestions.map(s => s.tenant_id)), [suggestions]);
  const filteredTenants = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allTenants
      .filter(t => !suggestionIds.has(t.tenant_id))
      .filter(t => !q || t.tenant_name.toLowerCase().includes(q));
  }, [allTenants, suggestionIds, search]);

  const matchMutation = useMutation({
    mutationFn: (tenantId: string) => statementsAPI.manualMatch(row.id, tenantId, remember),
    onMutate: async (tenantId: string) => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] });
      const tenant = allTenants.find(t => t.tenant_id === tenantId);
      const previousData = queryClient.getQueriesData<TransactionsListResponse>({
        queryKey: ['transactions'],
      });
      queryClient.setQueriesData<TransactionsListResponse>(
        { queryKey: ['transactions'] },
        old => {
          if (!old || !old.items) return old;
          return {
            ...old,
            items: old.items.map(r =>
              r.id === row.id
                ? {
                    ...r,
                    matched_tenant_id: tenantId,
                    matched_tenant_name: tenant?.tenant_name ?? null,
                  }
                : r
            ),
          };
        }
      );
      return { previousData, tenant };
    },
    onError: (err, _tenantId, ctx) => {
      ctx?.previousData?.forEach(([key, data]) => {
        if (data !== undefined) queryClient.setQueryData(key, data);
      });
      showToast({
        title: 'ההתאמה נכשלה. נסה שוב.',
        subtitle: (err as Error)?.message,
        variant: 'error',
        durationMs: 4000,
      });
    },
    onSuccess: (_data, tenantId, ctx) => {
      const tenant = ctx?.tenant || allTenants.find(t => t.tenant_id === tenantId);
      const amount = row.credit_amount ?? row.debit_amount ?? 0;
      showToast({
        title: `"${row.payer_name || row.description}" שובץ ל-"${tenant?.tenant_name || 'דייר'}"`,
        subtitle: amount ? `₪${amount.toLocaleString('he-IL')}` : undefined,
        variant: 'success',
        undo: async () => {
          await statementsAPI.unmatchTransaction(row.id);
          queryClient.invalidateQueries({ queryKey: ['transactions'] });
        },
        durationMs: 6000,
      });
      onMatched?.();
      onClose();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const handlePick = (tenantId: string) => {
    if (matchMutation.isPending) return;
    matchMutation.mutate(tenantId);
  };

  return (
    <Modal open onClose={onClose} srTitle="התאמת תנועה לדייר" size="md" hideClose className="max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b border-ink-200">
          <h3 className="text-base font-bold text-ink-900">התאמת תנועה לדייר</h3>
          <div className="mt-0.5 text-xs text-ink-500 flex items-baseline gap-1 min-w-0">
            <div className="flex-1 min-w-0">
              <DescriptionCell
                extended={row.extended_description}
                short={row.description}
                compact
              />
            </div>
            <span className="flex-shrink-0">· ₪{(row.credit_amount ?? row.debit_amount ?? 0).toLocaleString()}</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {suggestions.length > 0 && (
              <div className="px-5 pt-4">
                <div className="text-xs font-medium text-ink-500 mb-2">💡 הצעות המערכת</div>
                <div className="space-y-1">
                  {suggestions.map(s => (
                    <button
                      key={s.tenant_id}
                      onClick={() => handlePick(s.tenant_id)}
                      disabled={matchMutation.isPending}
                      className="w-full text-right px-3 py-2 rounded-lg border border-ink-200 hover:border-primary-400 hover:bg-primary-50 disabled:opacity-50 transition-colors flex items-center justify-between"
                    >
                      <span className="text-xs text-ink-500">{Math.round(s.score * 100)}%</span>
                      <span className="font-medium text-ink-900">{s.tenant_name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="px-5 py-4">
              <div className="text-xs font-medium text-ink-500 mb-2">כל הדיירים</div>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="חיפוש דייר..."
                className="w-full border border-ink-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 mb-2"
              />
              <div className="max-h-64 overflow-y-auto space-y-1">
                {filteredTenants.length === 0 ? (
                  <div className="text-xs text-ink-500 text-center py-4">אין דיירים תואמים</div>
                ) : (
                  filteredTenants.map(t => (
                    <button
                      key={t.tenant_id}
                      onClick={() => handlePick(t.tenant_id)}
                      disabled={matchMutation.isPending}
                      className="w-full text-right px-3 py-1.5 rounded text-sm text-ink-700 hover:bg-ink-100 disabled:opacity-50 transition-colors"
                    >
                      {t.tenant_name}
                    </button>
                  ))
                )}
              </div>
            </div>

            {matchMutation.isError && (
              <div className="mx-5 mb-3 bg-danger-50 border border-danger-50 rounded-lg p-2 text-xs text-danger-600">
                {(matchMutation.error as Error).message}
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-3 border-t border-ink-200 bg-ink-50 rounded-b-xl">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs text-ink-700 cursor-pointer">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
                className="rounded border-ink-300"
              />
              למד את ההתאמה הזו
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onOpenSplit}
                className="text-xs px-3 py-1.5 text-purple-700 hover:bg-purple-50 rounded font-medium"
              >
                ✂️ פיצול לכמה דיירים / חודשים
              </button>
              <button
                type="button"
                onClick={onClose}
                className="text-xs px-3 py-1.5 text-ink-700 hover:bg-ink-100 rounded"
              >
                ביטול
              </button>
            </div>
          </div>
          {remember && row.payer_name && (
            <div className="bg-accent-50 border border-accent-200 rounded-md px-3 py-2 text-xs text-accent-800 mt-2">
              ✱ המערכת תזכור את <strong>"{row.payer_name}"</strong> לזיהוי אוטומטי בעתיד.
            </div>
          )}
        </div>
    </Modal>
  );
}
