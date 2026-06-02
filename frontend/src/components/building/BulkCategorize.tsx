import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { expensesAPI } from '../../services/api';
import Modal from '../ui/Modal';
import type { Expense, ExpenseCategory } from '../../types';

interface Props {
  buildingId: string;
  expenses: Expense[];           // pre-filtered to uncategorized only
  categories: ExpenseCategory[];
  onClose: () => void;
  onDone: () => void;
}

export default function BulkCategorize({ buildingId, expenses, categories, onClose, onDone }: Props) {
  const { t } = useTranslation();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickedCategoryId, setPickedCategoryId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = selected.size === expenses.length && expenses.length > 0;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(expenses.map((e) => e.transaction_id)));
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const handleApply = async () => {
    if (selected.size === 0 || !pickedCategoryId) return;
    setSaving(true);
    setError(null);
    try {
      await expensesAPI.bulkCategorize(buildingId, {
        transaction_ids: Array.from(selected),
        category_id: pickedCategoryId,
      });
      onDone();
    } catch {
      setError(t('building.expenses.bulk_error'));
    } finally {
      setSaving(false);
    }
  };

  const pickedCategory = categories.find((c) => c.id === pickedCategoryId);

  return (
    <Modal open onClose={onClose} srTitle={t('building.expenses.bulk_categorize_title')} size="2xl" hideClose preventClose={saving} className="max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-ink-200 flex justify-between items-start">
          <div>
            <h3 className="text-xl font-bold text-ink-900">
              {t('building.expenses.bulk_categorize_title')}
            </h3>
            <p className="text-sm text-ink-500 mt-1">
              {expenses.length} {t('building.expenses.uncategorized_items')}
            </p>
          </div>
          <button onClick={onClose} aria-label="סגור חלון" className="p-2 hover:bg-ink-100 rounded-lg text-ink-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Category picker */}
        <div className="px-6 py-4 border-b border-ink-100 bg-ink-50">
          <p className="text-sm font-medium text-ink-700 mb-3">
            {t('building.expenses.select_category_to_assign')}
          </p>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setPickedCategoryId(cat.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  pickedCategoryId === cat.id
                    ? 'text-white border-transparent shadow-sm'
                    : 'bg-white border-ink-200 text-ink-700 hover:border-ink-300'
                }`}
                style={pickedCategoryId === cat.id ? { backgroundColor: cat.color } : undefined}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: pickedCategoryId === cat.id ? 'rgba(255,255,255,0.7)' : cat.color }}
                />
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Expense list */}
        <div className="flex-1 overflow-y-auto">
          <table className="min-w-full divide-y divide-ink-100 text-sm">
            <thead className="bg-ink-50 sticky top-0">
              <tr>
                <th className="px-4 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-ink-300"
                  />
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-ink-500">{t('building.expenses.col_date')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-ink-500">{t('building.expenses.col_description')}</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-ink-500">{t('building.expenses.col_vendor')}</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-ink-500">{t('building.expenses.col_amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {expenses.map((expense) => (
                <tr
                  key={expense.allocation_id}
                  onClick={() => toggle(expense.transaction_id)}
                  className={`cursor-pointer hover:bg-primary-50 transition-colors ${
                    selected.has(expense.transaction_id) ? 'bg-primary-50' : ''
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(expense.transaction_id)}
                      onChange={() => toggle(expense.transaction_id)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-ink-300"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-ink-500 whitespace-nowrap text-xs">
                    {new Date(expense.date).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                  </td>
                  <td className="px-4 py-2.5 text-ink-900 max-w-xs truncate" title={expense.description}>
                    {expense.description}
                  </td>
                  <td className="px-4 py-2.5 text-ink-500 text-xs whitespace-nowrap">
                    {expense.vendor_label ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-left font-medium text-ink-900 whitespace-nowrap">
                    ₪{expense.amount.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-ink-200 bg-white flex items-center justify-between gap-4">
          <div className="text-sm text-ink-500">
            {selected.size > 0 ? (
              <span>
                {selected.size} {t('building.expenses.selected')}
                {pickedCategory && (
                  <span>
                    {' '}&rarr;{' '}
                    <span
                      className="font-medium px-1.5 py-0.5 rounded text-white text-xs"
                      style={{ backgroundColor: pickedCategory.color }}
                    >
                      {pickedCategory.name}
                    </span>
                  </span>
                )}
              </span>
            ) : (
              <span className="text-ink-500">{t('building.expenses.select_items')}</span>
            )}
          </div>
          {error && <p className="text-xs text-danger-500">{error}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 border border-ink-300 text-ink-700 rounded-lg hover:bg-ink-50 text-sm">
              {t('common.cancel')}
            </button>
            <button
              onClick={handleApply}
              disabled={selected.size === 0 || !pickedCategoryId || saving}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 font-medium text-sm"
            >
              {saving ? t('common.saving') : t('building.expenses.apply_category')}
            </button>
          </div>
        </div>
    </Modal>
  );
}
