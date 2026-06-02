import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { statementsAPI, expensesAPI } from '../../services/api';
import Modal from '../ui/Modal';
import type { TransactionRow } from '../../types';

interface Props {
  row: TransactionRow;
  onClose: () => void;
  onSaved?: () => void;
}

/**
 * Inline categorize-as-expense popover for an unmatched debit transaction.
 * Mirrors the expense edit dialog inside UploadReviewModal so the same
 * vendor_label / category / notes / remember flow is available from the
 * global Transactions page.
 */
export default function QuickExpensePopover({ row, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();

  const [vendorLabel, setVendorLabel] = useState(row.payer_name ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [remember, setRemember] = useState(true);

  const { data: categories = [] } = useQuery({
    queryKey: ['expenseCategories', row.building_id],
    queryFn: () =>
      row.building_id ? expensesAPI.listCategories(row.building_id) : Promise.resolve([]),
    enabled: !!row.building_id,
  });

  // If the user hasn't picked a vendor name yet, seed from description after
  // stripping the bank prefix ("[bank] - [payer]").
  useEffect(() => {
    if (!vendorLabel && row.description) {
      const m = row.description.match(/-\s*(.+)$/);
      if (m) setVendorLabel(m[1].trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveMutation = useMutation({
    mutationFn: () =>
      statementsAPI.categorizeTransaction(row.id, {
        vendor_label: vendorLabel.trim(),
        category_id: categoryId || undefined,
        notes: notes.trim() || undefined,
        remember,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      onSaved?.();
      onClose();
    },
  });

  const amount = row.debit_amount ?? 0;

  return (
    <Modal open onClose={onClose} srTitle="קטגור הוצאה" size="md" hideClose preventClose={saveMutation.isPending} className="p-6">
        <div className="border-b border-ink-200 pb-3 mb-4">
          <h3 className="text-base font-bold text-ink-900">קטגור הוצאה</h3>
          <p className="text-xs text-ink-500 mt-0.5 truncate" title={row.description}>
            {row.description} · −₪{amount.toLocaleString()}
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="qe-vendor" className="text-sm text-ink-700 block mb-1">שם ספק</label>
            <input
              id="qe-vendor"
              type="text"
              className="w-full border border-ink-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
              value={vendorLabel}
              onChange={e => setVendorLabel(e.target.value)}
              placeholder="לדוגמה: חברת החשמל"
            />
          </div>

          <div>
            <label htmlFor="qe-category" className="text-sm text-ink-700 block mb-1">קטגוריה</label>
            <select
              id="qe-category"
              className="w-full border border-ink-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 bg-white"
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
            >
              <option value="">ללא קטגוריה</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {categories.length === 0 && row.building_id && (
              <p className="text-xs text-ink-500 mt-1">
                אין קטגוריות מוגדרות עבור בניין זה. ניתן להוסיף מתוך עמוד הבניין.
              </p>
            )}
            {!row.building_id && (
              <p className="text-xs text-warn-600 mt-1">
                לתנועה זו אין בניין משויך — בחר בניין כדי לקטלג.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="qe-notes" className="text-sm text-ink-700 block mb-1">הערות (אופציונלי)</label>
            <textarea
              id="qe-notes"
              className="w-full border border-ink-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none"
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="פרטים נוספים על ההוצאה..."
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              className="rounded"
            />
            זכור עבור הבא
          </label>
        </div>

        {saveMutation.isError && (
          <div className="mt-3 bg-danger-50 border border-danger-50 rounded-lg p-2 text-xs text-danger-600">
            {(saveMutation.error as Error).message}
          </div>
        )}

        <div className="flex gap-2 mt-5 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-ink-700 border border-ink-300 rounded-md hover:bg-ink-50"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !vendorLabel.trim()}
            className="px-4 py-2 text-sm text-white bg-primary-700 hover:bg-primary-700 rounded-md disabled:opacity-50"
          >
            {saveMutation.isPending ? '...' : 'שמור'}
          </button>
        </div>
    </Modal>
  );
}
