import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { statementsAPI } from '../../services/api';
import type { TransactionRow, SplitAllocationError, TransactionPatchPayload } from '../../types';

interface Props {
  row: TransactionRow;
  onClose: () => void;
}

// Compact edit dialog for the global transactions list. Edits date / description /
// amount via PATCH. If the row has split allocations, the backend returns 409 and
// we surface a clear message — splits must be re-edited in the statement Review UI.
export default function TransactionEditDialog({ row, onClose }: Props) {
  const queryClient = useQueryClient();
  const initialAmount =
    row.credit_amount != null ? row.credit_amount : row.debit_amount != null ? -row.debit_amount : 0;
  const direction: 'credit' | 'debit' = initialAmount >= 0 ? 'credit' : 'debit';

  const [date, setDate] = useState(row.activity_date.slice(0, 10));
  const [description, setDescription] = useState(row.description);
  const [amount, setAmount] = useState<string>(String(Math.abs(initialAmount)));
  const [splitError, setSplitError] = useState<SplitAllocationError | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: TransactionPatchPayload = {};
      if (date !== row.activity_date.slice(0, 10)) payload.activity_date = date;
      if (description !== row.description) payload.description = description;
      const parsed = parseFloat(amount);
      if (!isNaN(parsed) && parsed !== Math.abs(initialAmount)) {
        if (direction === 'credit') payload.credit_amount = parsed;
        else payload.debit_amount = parsed;
      }
      if (Object.keys(payload).length === 0) {
        onClose();
        return;
      }
      await statementsAPI.patchTransaction(row.id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
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
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-ink-200">
          <h3 className="text-lg font-bold text-ink-900">עריכת תנועה</h3>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="ted-date" className="block text-sm font-medium text-ink-700 mb-1">תאריך</label>
            <input
              id="ted-date"
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full border border-ink-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label htmlFor="ted-description" className="block text-sm font-medium text-ink-700 mb-1">תיאור</label>
            <input
              id="ted-description"
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full border border-ink-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1">
              סכום ({direction === 'credit' ? 'זכות' : 'חובה'})
            </label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full border border-ink-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {splitError && (
            <div className="bg-warn-50 border border-warn-50 rounded-lg p-3 text-sm text-warn-600">
              לתנועה זו יש {splitError.allocation_count} הקצאות מפוצלות. ערוך את ההקצאות במסך
              סקירת דף החשבון לפני שינוי הסכום.
            </div>
          )}
          {mutation.isError && !splitError && (
            <div className="bg-danger-50 border border-danger-50 rounded-lg p-3 text-sm text-danger-600">
              {(mutation.error as Error).message}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-ink-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-ink-700 rounded-lg hover:bg-ink-100 font-medium text-sm"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium text-sm disabled:opacity-50"
          >
            {mutation.isPending ? 'שומר...' : 'שמור'}
          </button>
        </div>
      </div>
    </div>
  );
}
