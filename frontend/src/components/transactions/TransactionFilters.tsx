import { useQuery } from '@tanstack/react-query';
import { buildingsAPI } from '../../services/api';
import type {
  TransactionsListParams,
  TransactionMatchStatus,
  TransactionDirection,
  TransactionSource,
} from '../../types';

interface Props {
  filters: TransactionsListParams;
  onChange: (next: TransactionsListParams) => void;
  onReset: () => void;
}

const MATCH_STATUS_OPTIONS: { value: TransactionMatchStatus; label: string; dot: string }[] = [
  { value: 'confirmed', label: 'אושר', dot: 'bg-accent-500' },
  { value: 'split', label: 'פיצול', dot: 'bg-primary-500' },
  { value: 'auto', label: 'התאמה אוטומטית', dot: 'bg-warn-500' },
  { value: 'unmatched', label: 'לא מותאם', dot: 'bg-ink-400' },
  { value: 'ignored', label: 'מתעלם', dot: 'bg-ink-300' },
];

const TYPE_OPTIONS = [
  { value: 'payment', label: 'תשלום' },
  { value: 'fee', label: 'עמלה' },
  { value: 'transfer', label: 'העברה' },
  { value: 'other', label: 'אחר' },
];

export default function TransactionFilters({ filters, onChange, onReset }: Props) {
  const { data: buildings } = useQuery({
    queryKey: ['buildings'],
    queryFn: () => buildingsAPI.list(),
  });

  const toggleArray = <T extends string>(arr: T[] | undefined, value: T): T[] | undefined => {
    const set = new Set(arr ?? []);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    const next = Array.from(set);
    return next.length === 0 ? undefined : next;
  };

  const update = (patch: Partial<TransactionsListParams>) => {
    onChange({ ...filters, ...patch, page: 1 });
  };

  return (
    <div className="bg-white rounded-xl ring-1 ring-ink-200 p-4 space-y-3" dir="rtl">
      {/* Row 1: Search + date range + reset */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="tf-q" className="block text-xs font-medium text-ink-500 mb-1">חיפוש חופשי</label>
          <input
            id="tf-q"
            type="text"
            value={filters.q ?? ''}
            onChange={e => update({ q: e.target.value || undefined })}
            placeholder="תיאור, משלם, או אסמכתא..."
            className="w-full rounded-lg ring-1 ring-ink-200 px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label htmlFor="tf-date-from" className="block text-xs font-medium text-ink-500 mb-1">מתאריך</label>
          <input
            id="tf-date-from"
            type="date"
            value={filters.date_from ?? ''}
            onChange={e => update({ date_from: e.target.value || undefined })}
            className="rounded-lg ring-1 ring-ink-200 px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label htmlFor="tf-date-to" className="block text-xs font-medium text-ink-500 mb-1">עד תאריך</label>
          <input
            id="tf-date-to"
            type="date"
            value={filters.date_to ?? ''}
            onChange={e => update({ date_to: e.target.value || undefined })}
            className="rounded-lg ring-1 ring-ink-200 px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label htmlFor="tf-amount-min" className="block text-xs font-medium text-ink-500 mb-1">סכום מ-</label>
          <input
            id="tf-amount-min"
            type="number"
            value={filters.amount_min ?? ''}
            onChange={e => update({ amount_min: e.target.value ? parseFloat(e.target.value) : undefined })}
            className="w-24 rounded-lg ring-1 ring-ink-200 px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label htmlFor="tf-amount-max" className="block text-xs font-medium text-ink-500 mb-1">עד</label>
          <input
            id="tf-amount-max"
            type="number"
            value={filters.amount_max ?? ''}
            onChange={e => update({ amount_max: e.target.value ? parseFloat(e.target.value) : undefined })}
            className="w-24 rounded-lg ring-1 ring-ink-200 px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <button
          onClick={onReset}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-ink-700 hover:text-ink-900 hover:bg-ink-100 rounded-lg"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          איפוס
        </button>
      </div>

      {/* Row 2: Selects + chip groups */}
      <div className="flex flex-wrap gap-3 items-start">
        {/* Building multi-select */}
        <div>
          <label htmlFor="tf-building" className="block text-xs font-medium text-ink-500 mb-1">בניין</label>
          <select
            id="tf-building"
            multiple
            value={filters.building_id ?? []}
            onChange={e =>
              update({
                building_id: Array.from(e.target.selectedOptions).map(o => o.value),
              })
            }
            className="min-w-[160px] max-w-[200px] rounded-lg ring-1 ring-ink-200 px-2 py-1 text-sm h-20"
          >
            {(buildings ?? []).map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        {/* Direction */}
        <div>
          <label htmlFor="tf-direction" className="block text-xs font-medium text-ink-500 mb-1">כיוון</label>
          <select
            id="tf-direction"
            value={filters.direction ?? ''}
            onChange={e => update({ direction: (e.target.value || undefined) as TransactionDirection | undefined })}
            className="rounded-lg ring-1 ring-ink-200 px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500"
          >
            <option value="">הכל</option>
            <option value="credit">זכות בלבד</option>
            <option value="debit">חובה בלבד</option>
          </select>
        </div>

        {/* Source */}
        <div>
          <label htmlFor="tf-source" className="block text-xs font-medium text-ink-500 mb-1">מקור</label>
          <select
            id="tf-source"
            value={filters.source ?? ''}
            onChange={e => update({ source: (e.target.value || undefined) as TransactionSource | undefined })}
            className="rounded-lg ring-1 ring-ink-200 px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500"
          >
            <option value="">הכל</option>
            <option value="bank">בנק</option>
            <option value="manual">ידני</option>
          </select>
        </div>

        {/* Match status chip toggles */}
        <div>
          <span id="tf-match-label" className="block text-xs font-medium text-ink-500 mb-1">סטטוס התאמה</span>
          <div role="group" aria-labelledby="tf-match-label" className="flex flex-wrap gap-1.5">
            {MATCH_STATUS_OPTIONS.map(opt => {
              const active = (filters.match_status ?? []).includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update({ match_status: toggleArray(filters.match_status, opt.value) })}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 transition-colors ${
                    active
                      ? 'bg-primary-50 ring-primary-300 text-primary-700'
                      : 'bg-white ring-ink-200 text-ink-700 hover:bg-ink-50'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${opt.dot}`} />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Type chip toggles */}
        <div>
          <span id="tf-type-label" className="block text-xs font-medium text-ink-500 mb-1">סוג</span>
          <div role="group" aria-labelledby="tf-type-label" className="flex flex-wrap gap-1.5">
            {TYPE_OPTIONS.map(opt => {
              const active = (filters.type ?? []).includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update({ type: toggleArray(filters.type, opt.value) })}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium ring-1 transition-colors ${
                    active
                      ? 'bg-purple-50 ring-purple-300 text-purple-700'
                      : 'bg-white ring-ink-200 text-ink-700 hover:bg-ink-50'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
