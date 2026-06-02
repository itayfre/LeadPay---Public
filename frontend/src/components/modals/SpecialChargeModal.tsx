import { useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { collectingAPI, specialChargesAPI } from '../../services/api';
import type { SplitMethod } from '../../types';

interface Props {
  isOpen: boolean;
  buildingId: string;
  onClose: () => void;
  onSaved?: () => void;
}

/**
 * Create a one-off special charge across selected apartments in the building.
 *
 * Uses the per-apartment collecting endpoint to load the apartment list
 * (one source of truth; same data the user is staring at in the new view).
 */
export default function SpecialChargeModal({ isOpen, buildingId, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: collecting, isLoading: loadingApts } = useQuery({
    queryKey: ['collecting', buildingId],
    queryFn: () => collectingAPI.get(buildingId),
    enabled: isOpen && !!buildingId,
  });

  const allAptIds = useMemo(
    () => (collecting?.rows.map((r) => r.apartment_id) ?? []),
    [collecting],
  );

  // ─── Form state ─────────────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [splitMethod, setSplitMethod] = useState<SplitMethod>('equal');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [dueDate, setDueDate] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset on open.
  useMemo(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setTotalAmount('');
      setSplitMethod('equal');
      setSelectedIds(new Set());
      setCustomAmounts({});
      setDueDate('');
      setErrorMessage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const toggleApt = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set(allAptIds));
  const selectNone = () => setSelectedIds(new Set());

  // ─── Preview ────────────────────────────────────────────────────────────
  const selectedCount = selectedIds.size;
  const previewTotal = useMemo(() => {
    if (splitMethod === 'flat') {
      const per = parseFloat(totalAmount) || 0;
      return per * selectedCount;
    }
    if (splitMethod === 'custom') {
      return Object.values(customAmounts).reduce(
        (s, v) => s + (parseFloat(v) || 0), 0,
      );
    }
    return parseFloat(totalAmount) || 0;
  }, [splitMethod, totalAmount, selectedCount, customAmounts]);

  // ─── Submit ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: specialChargesAPI.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collecting', buildingId] });
      queryClient.invalidateQueries({ queryKey: ['special-charges', buildingId] });
      onSaved?.();
      onClose();
    },
    onError: (err: Error) => {
      setErrorMessage(err.message || 'Unknown error');
    },
  });

  const handleSubmit = () => {
    setErrorMessage(null);

    if (!title.trim()) return setErrorMessage(t('specialCharge.titleRequired'));
    if (selectedIds.size === 0) return setErrorMessage(t('specialCharge.noApartmentsError'));
    if (splitMethod !== 'custom' && !totalAmount.trim()) {
      return setErrorMessage(t('specialCharge.amountRequired'));
    }

    const aptIdsInOrder = allAptIds.filter((id) => selectedIds.has(id));
    let customList: string[] | undefined;

    if (splitMethod === 'custom') {
      customList = aptIdsInOrder.map((id) => customAmounts[id] ?? '0');
      const sum = customList.reduce((s, v) => s + (parseFloat(v) || 0), 0);
      const expected = parseFloat(totalAmount) || 0;
      if (expected > 0 && Math.abs(sum - expected) > 0.01) {
        return setErrorMessage(t('specialCharge.customSumMismatch', {
          actual: sum.toFixed(2), expected: expected.toFixed(2),
        }));
      }
    }

    createMutation.mutate({
      building_id: buildingId,
      title: title.trim(),
      description: description.trim() || null,
      total_amount: totalAmount || '0',
      split_method: splitMethod,
      apartment_ids: aptIdsInOrder,
      due_date: dueDate || null,
      custom_amounts: customList,
    });
  };

  return (
    <Modal open={isOpen} onClose={onClose} srTitle={t('specialCharge.modalTitle')} size="2xl" hideClose preventClose={createMutation.isPending} className="max-h-[90vh] flex flex-col">
        {/* Header */}
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{t('specialCharge.modalTitle')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="סגור חלון">×</button>
        </header>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('specialCharge.titleLabel')}</label>
            <input
              type="text"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('specialCharge.titlePlaceholder')}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('specialCharge.descriptionLabel')}</label>
            <textarea
              rows={2}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('specialCharge.descriptionPlaceholder')}
            />
          </div>

          {/* Amount + Split method (side by side) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {splitMethod === 'flat'
                  ? t('specialCharge.perApartmentAmountLabel')
                  : t('specialCharge.totalAmountLabel')}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm tabular-nums focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                disabled={splitMethod === 'custom'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('specialCharge.dueDateLabel')}</label>
              <input
                type="date"
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {/* Split method radio */}
          <fieldset>
            <legend className="block text-sm font-medium text-slate-700 mb-2">{t('specialCharge.splitMethodLabel')}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(['equal', 'custom', 'weight', 'flat'] as const).map((m) => (
                <label
                  key={m}
                  className={`flex items-start gap-2 border rounded-md p-2 cursor-pointer transition-colors ${
                    splitMethod === m ? 'border-primary-500 bg-primary-50' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input type="radio" name="split-method" checked={splitMethod === m} onChange={() => setSplitMethod(m)} className="mt-1" />
                  <div>
                    <div className="text-sm font-medium text-slate-900">{t(`specialCharge.split${m.charAt(0).toUpperCase() + m.slice(1)}`)}</div>
                    <div className="text-xs text-slate-500">{t(`specialCharge.split${m.charAt(0).toUpperCase() + m.slice(1)}Help`)}</div>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Apartment picker */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-700">
                {t('specialCharge.apartmentsLabel')}
              </label>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={selectAll} className="text-primary-600 hover:text-primary-700">{t('specialCharge.selectAll')}</button>
                <span className="text-slate-300">·</span>
                <button type="button" onClick={selectNone} className="text-slate-600 hover:text-slate-800">{t('specialCharge.selectNone')}</button>
              </div>
            </div>
            {loadingApts ? (
              <div className="text-sm text-slate-500 py-4 text-center">...</div>
            ) : (
              <div className="border border-slate-200 rounded-md max-h-48 overflow-y-auto divide-y divide-slate-100">
                {collecting?.rows.map((row) => (
                  <label key={row.apartment_id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.apartment_id)}
                      onChange={() => toggleApt(row.apartment_id)}
                    />
                    <span className="font-medium text-slate-900 tabular-nums w-10 text-center">{row.apartment_number}</span>
                    <span className="flex-1 text-slate-700 truncate">
                      {row.active_tenant?.name ?? row.fallback_owner?.name ?? '—'}
                    </span>
                    {splitMethod === 'custom' && selectedIds.has(row.apartment_id) && (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-24 border border-slate-300 rounded-md px-2 py-1 text-xs tabular-nums"
                        placeholder="₪"
                        value={customAmounts[row.apartment_id] ?? ''}
                        onChange={(e) => setCustomAmounts((prev) => ({ ...prev, [row.apartment_id]: e.target.value }))}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </label>
                ))}
              </div>
            )}
            <div className="text-xs text-slate-500 mt-1">
              {t('specialCharge.apartmentsSelected', { n: selectedCount })}
            </div>
          </div>

          {/* Preview */}
          {selectedCount > 0 && previewTotal > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm">
              <div className="font-medium text-slate-700 mb-0.5">{t('specialCharge.previewTitle')}</div>
              <div className="text-slate-600 tabular-nums">
                {t('specialCharge.previewRowsTotal', { n: selectedCount, amount: previewTotal.toFixed(2) })}
              </div>
            </div>
          )}

          {/* Error */}
          {errorMessage && (
            <div className="bg-rose-50 border border-rose-200 rounded-md px-3 py-2 text-sm text-rose-800" role="alert">
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={createMutation.isPending}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            {t('specialCharge.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? t('specialCharge.submitting') : t('specialCharge.submitLabel')}
          </button>
        </footer>
    </Modal>
  );
}
