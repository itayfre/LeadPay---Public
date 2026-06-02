import type { ExpenseCategory } from '../../types';

export interface CategorizeFormValue {
  vendor_label: string;
  category_id: string;
  notes: string;
  remember: boolean;
}

interface CategorizeFormFieldsProps {
  value: CategorizeFormValue;
  onChange: (next: CategorizeFormValue) => void;
  categories: ExpenseCategory[];
  onOpenCategoryManager: () => void;
  notesPlaceholder?: string;
  /** Optional context for the "זכור" preview hint.
   * - `single`: shows the literal description excerpt that will become the
   *   match rule (the engine stores `description → vendor_label`).
   * - `bulk`: shows the count of selected rows — each becomes its own rule.
   */
  rememberHint?:
    | { kind: 'single'; descriptionSample: string }
    | { kind: 'bulk'; count: number };
}

/**
 * Shared form fields used by both the single-row expense edit popover
 * and the bulk categorize dialog. Renders ONLY the inputs (vendor,
 * category select, notes, remember checkbox) — wrapper containers,
 * titles, summary blocks, and action buttons stay in the host dialog.
 */
export default function CategorizeFormFields({
  value,
  onChange,
  categories,
  onOpenCategoryManager,
  notesPlaceholder = 'פרטים נוספים על ההוצאה...',
  rememberHint,
}: CategorizeFormFieldsProps) {
  const descriptionExcerpt =
    rememberHint?.kind === 'single' && rememberHint.descriptionSample
      ? rememberHint.descriptionSample.length > 40
        ? `${rememberHint.descriptionSample.slice(0, 40)}…`
        : rememberHint.descriptionSample
      : '';
  const categoryName = value.category_id
    ? categories.find(c => c.id === value.category_id)?.name
    : undefined;

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="cff-vendor" className="text-sm text-ink-700 block mb-1">שם ספק</label>
        <input
          id="cff-vendor"
          type="text"
          className="w-full border border-ink-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
          value={value.vendor_label}
          onChange={e => onChange({ ...value, vendor_label: e.target.value })}
          placeholder="לדוגמה: חברת החשמל"
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="cff-category" className="text-sm text-ink-700">קטגוריה</label>
          <button
            type="button"
            onClick={onOpenCategoryManager}
            className="text-xs text-primary-700 hover:text-primary-800 hover:underline"
          >
            ⚙️ ניהול קטגוריות
          </button>
        </div>
        <select
          id="cff-category"
          className="w-full border border-ink-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 bg-white"
          value={value.category_id}
          onChange={e => onChange({ ...value, category_id: e.target.value })}
        >
          <option value="">ללא קטגוריה</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {categories.length === 0 && (
          <p className="text-xs text-ink-500 mt-1">
            אין קטגוריות מוגדרות. לחץ "ניהול קטגוריות" להוספה.
          </p>
        )}
      </div>
      <div>
        <label htmlFor="cff-notes" className="text-sm text-ink-700 block mb-1">הערות (אופציונלי)</label>
        <textarea
          id="cff-notes"
          className="w-full border border-ink-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none"
          rows={2}
          value={value.notes}
          onChange={e => onChange({ ...value, notes: e.target.value })}
          placeholder={notesPlaceholder}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={value.remember}
          onChange={e => onChange({ ...value, remember: e.target.checked })}
          className="rounded"
        />
        זכור עבור הבא
      </label>
      {value.remember && value.vendor_label && rememberHint?.kind === 'single' && descriptionExcerpt && (
        <div className="bg-accent-50 border border-accent-200 rounded-md px-3 py-2 text-xs text-accent-800 mt-2">
          ✱ פעם הבאה: <strong>"{descriptionExcerpt}"</strong>
          {categoryName && (
            <> → קטגוריה: <strong>{categoryName}</strong></>
          )}
        </div>
      )}
      {value.remember && value.vendor_label && rememberHint?.kind === 'bulk' && rememberHint.count > 0 && (
        <div className="bg-accent-50 border border-accent-200 rounded-md px-3 py-2 text-xs text-accent-800 mt-2">
          ✱ המערכת תזכור את <strong>{rememberHint.count} ההעברות הללו</strong> וכל אחת תזוהה אוטומטית בעתיד
          {categoryName ? <> כ-<strong>{categoryName}</strong></> : null}.
        </div>
      )}
    </div>
  );
}
