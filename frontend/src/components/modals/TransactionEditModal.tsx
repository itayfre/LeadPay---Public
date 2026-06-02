import { useState } from 'react';
import Modal from '../ui/Modal';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { statementsAPI } from '../../services/api';
import type { SplitAllocationError, TransactionPatchPayload } from '../../types';

interface Props {
  transaction: {
    id: string;
    date: string;        // yyyy-mm-dd
    description: string;
    amount: number;      // signed: positive = credit, negative = debit
  };
  tenantId: string;
  buildingId: string;
  onClose: () => void;
  onOpenAllocationEditor: (txId: string) => void;
}

export default function TransactionEditModal({
  transaction,
  tenantId,
  buildingId,
  onClose,
  onOpenAllocationEditor,
}: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    date: transaction.date,
    description: transaction.description,
    amount: transaction.amount,
  });
  const [splitError, setSplitError] = useState<SplitAllocationError | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: TransactionPatchPayload = {};
      if (form.date !== transaction.date) payload.activity_date = form.date;
      if (form.description !== transaction.description) payload.description = form.description;
      if (form.amount !== transaction.amount) {
        // Preserve credit vs debit by which one was originally set
        if (transaction.amount >= 0) payload.credit_amount = form.amount;
        else payload.debit_amount = Math.abs(form.amount);
      }
      await statementsAPI.patchTransaction(transaction.id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenantHistory', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['paymentStatus', buildingId] });
      onClose();
    },
    onError: (err: unknown) => {
      if (
        err && typeof err === 'object' && 'code' in err &&
        (err as SplitAllocationError).code === 'split_allocation_requires_resplit'
      ) {
        setSplitError(err as SplitAllocationError);
      }
    },
  });

  return (
    <Modal open onClose={onClose} srTitle={t('transaction.edit.title')} size="md" hideClose preventClose={mutation.isPending}>
        <div className="flex justify-between items-center px-6 py-4 border-b border-ink-200">
          <h3 className="font-bold text-ink-900">{t('transaction.edit.title')}</h3>
          <button onClick={onClose} aria-label="סגור חלון" className="text-ink-500 hover:text-ink-700">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {splitError && (
            <div className="bg-warn-50 border border-warn-300 rounded-lg p-4 text-sm">
              <p className="font-bold text-warn-900 mb-2">
                ⚠️ {t('transaction.edit.splitError.title')}
              </p>
              <p className="text-warn-600 whitespace-pre-line">
                {t('transaction.edit.splitError.body', { count: splitError.allocation_count })}
              </p>
              <button
                onClick={() => onOpenAllocationEditor(transaction.id)}
                className="mt-3 px-3 py-1.5 bg-warn-600 text-white rounded hover:bg-warn-600 text-xs"
              >
                {t('transaction.edit.splitError.cta')}
              </button>
            </div>
          )}

          <label className="block text-sm">
            <span className="text-ink-700">{t('transaction.edit.fields.date')}</span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="mt-1 w-full border border-ink-300 rounded px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-700">{t('transaction.edit.fields.desc')}</span>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 w-full border border-ink-300 rounded px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-700">{t('transaction.edit.fields.amount')}</span>
            <input
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              className="mt-1 w-full border border-ink-300 rounded px-3 py-2"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-ink-50">
          <button onClick={onClose} className="px-4 py-2 text-ink-700 hover:bg-ink-100 rounded">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => { setSplitError(null); mutation.mutate(); }}
            disabled={mutation.isPending}
            className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
          >
            {t('common.save')}
          </button>
        </div>
    </Modal>
  );
}
