import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { buildingsAPI, transactionsAPI } from '../../services/api';
import type { TransactionCreatePayload } from '../../types';

interface Props {
  onClose: () => void;
}

type Direction = 'credit' | 'debit';

export default function AddTransactionModal({ onClose }: Props) {
  const queryClient = useQueryClient();
  const { data: buildings } = useQuery({
    queryKey: ['buildings'],
    queryFn: () => buildingsAPI.list(),
  });

  const [buildingId, setBuildingId] = useState<string>('');
  const [activityDate, setActivityDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [direction, setDirection] = useState<Direction>('credit');
  const [amount, setAmount] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [payerName, setPayerName] = useState<string>('');
  const [transactionType, setTransactionType] = useState<'payment' | 'fee' | 'transfer' | 'other'>('payment');
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!buildingId) throw new Error('יש לבחור בניין');
      const parsed = parseFloat(amount);
      if (isNaN(parsed) || parsed <= 0) throw new Error('יש להזין סכום חיובי');
      if (!description.trim()) throw new Error('יש להזין תיאור');

      const payload: TransactionCreatePayload = {
        building_id: buildingId,
        activity_date: activityDate,
        description: description.trim(),
        transaction_type: transactionType,
      };
      if (payerName.trim()) payload.payer_name = payerName.trim();
      if (direction === 'credit') payload.credit_amount = parsed;
      else payload.debit_amount = parsed;
      return transactionsAPI.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      onClose();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-ink-200">
          <h3 className="text-lg font-bold text-ink-900">הוספת תנועה ידנית</h3>
          <p className="text-xs text-ink-500 mt-0.5">תנועה ידנית תיווסף לתיק הבניין כמו תנועה שהועלתה מקובץ.</p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="atx-building" className="block text-sm font-medium text-ink-700 mb-1">בניין <span className="text-danger-500">*</span></label>
            <select
              id="atx-building"
              value={buildingId}
              onChange={e => setBuildingId(e.target.value)}
              className="w-full border border-ink-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500"
            >
              <option value="">— בחר בניין —</option>
              {(buildings ?? []).map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="atx-date" className="block text-sm font-medium text-ink-700 mb-1">תאריך</label>
              <input
                id="atx-date"
                type="date"
                value={activityDate}
                onChange={e => setActivityDate(e.target.value)}
                className="w-full border border-ink-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label htmlFor="atx-type" className="block text-sm font-medium text-ink-700 mb-1">סוג</label>
              <select
                id="atx-type"
                value={transactionType}
                onChange={e => setTransactionType(e.target.value as typeof transactionType)}
                className="w-full border border-ink-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500"
              >
                <option value="payment">תשלום</option>
                <option value="fee">עמלה</option>
                <option value="transfer">העברה</option>
                <option value="other">אחר</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span id="atx-direction" className="block text-sm font-medium text-ink-700 mb-1">כיוון</span>
              <div role="group" aria-labelledby="atx-direction" className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDirection('credit')}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${
                    direction === 'credit'
                      ? 'bg-accent-50 border-accent-300 text-accent-700'
                      : 'bg-white border-ink-300 text-ink-700'
                  }`}
                >
                  זכות (+)
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('debit')}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${
                    direction === 'debit'
                      ? 'bg-danger-50 border-danger-300 text-danger-600'
                      : 'bg-white border-ink-300 text-ink-700'
                  }`}
                >
                  חובה (−)
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="atx-amount" className="block text-sm font-medium text-ink-700 mb-1">סכום <span className="text-danger-500">*</span></label>
              <input
                id="atx-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full border border-ink-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="atx-description" className="block text-sm font-medium text-ink-700 mb-1">תיאור <span className="text-danger-500">*</span></label>
            <input
              id="atx-description"
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="לדוגמה: תשלום מזומן מאת..."
              className="w-full border border-ink-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label htmlFor="atx-payer" className="block text-sm font-medium text-ink-700 mb-1">שם משלם (אופציונלי)</label>
            <input
              id="atx-payer"
              type="text"
              value={payerName}
              onChange={e => setPayerName(e.target.value)}
              className="w-full border border-ink-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {formError && (
            <div className="bg-danger-50 border border-danger-50 rounded-lg p-3 text-sm text-danger-600">
              {formError}
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
            onClick={() => { setFormError(null); mutation.mutate(); }}
            disabled={mutation.isPending}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium text-sm disabled:opacity-50"
          >
            {mutation.isPending ? 'שומר...' : 'הוסף תנועה'}
          </button>
        </div>
      </div>
    </div>
  );
}
