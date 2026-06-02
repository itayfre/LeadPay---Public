import { useTranslation } from 'react-i18next';

export type SizeFilter = '' | 'small' | 'medium' | 'large';
export type StatusFilter = '' | 'all_paid' | 'partial' | 'none_paid';

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  city: string;
  onCityChange: (v: string) => void;
  cities: string[];
  size: SizeFilter;
  onSizeChange: (v: SizeFilter) => void;
  status: StatusFilter;
  onStatusChange: (v: StatusFilter) => void;
}

export default function FilterBar({
  search, onSearchChange,
  city, onCityChange, cities,
  size, onSizeChange,
  status, onStatusChange,
}: Props) {
  const { t } = useTranslation();

  const sizeOptions: { v: SizeFilter; key: string }[] = [
    { v: '',       key: 'buildings.all' },
    { v: 'small',  key: 'buildings.small' },
    { v: 'medium', key: 'buildings.medium' },
    { v: 'large',  key: 'buildings.large' },
  ];

  // Status chips carry a status dot, mirroring the dashboard/transactions language.
  const statusOptions: { v: StatusFilter; key: string; dot: string }[] = [
    { v: '',          key: 'buildings.all',         dot: 'bg-ink-300' },
    { v: 'all_paid',  key: 'buildings.allPaid',     dot: 'bg-accent-500' },
    { v: 'partial',   key: 'buildings.partialPaid', dot: 'bg-warn-500' },
    { v: 'none_paid', key: 'buildings.nonePaid',    dot: 'bg-danger-500' },
  ];

  const isDirty = !!(search || city || status || size);
  const reset = () => {
    onSearchChange('');
    onCityChange('');
    onStatusChange('');
    onSizeChange('');
  };

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-xs font-medium ring-1 transition-colors ${
      active
        ? 'bg-primary-50 ring-primary-300 text-primary-700'
        : 'bg-white ring-ink-200 text-ink-700 hover:bg-ink-50'
    }`;

  return (
    <div className="bg-white rounded-xl ring-1 ring-ink-200 p-4 space-y-3" dir="rtl">
      {/* Row 1: search + city + reset */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-ink-500 mb-1">{t('buildings.searchLabel', { defaultValue: 'חיפוש' })}</label>
          <input
            type="text"
            placeholder={t('buildings.searchPlaceholder')}
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full rounded-lg ring-1 ring-ink-200 px-3 py-1.5 text-sm placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-500 mb-1">{t('buildings.cityLabel', { defaultValue: 'עיר' })}</label>
          <select
            value={city}
            onChange={e => onCityChange(e.target.value)}
            className="rounded-lg ring-1 ring-ink-200 px-3 py-1.5 text-sm text-ink-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">{t('buildings.allCities')}</option>
            {cities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {isDirty && (
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-ink-700 hover:text-ink-900 hover:bg-ink-100 rounded-lg"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            {t('common.reset', { defaultValue: 'איפוס' })}
          </button>
        )}
      </div>

      {/* Row 2: status + size chip toggles */}
      <div className="flex flex-wrap gap-x-6 gap-y-3 items-start">
        <div>
          <label className="block text-xs font-medium text-ink-500 mb-1">{t('buildings.statusLabel', { defaultValue: 'סטטוס גבייה' })}</label>
          <div className="flex flex-wrap gap-1.5">
            {statusOptions.map(opt => (
              <button key={opt.v} type="button" onClick={() => onStatusChange(opt.v)} className={`inline-flex items-center gap-1.5 ${chip(status === opt.v)}`}>
                {opt.v !== '' && <span className={`w-1.5 h-1.5 rounded-full ${opt.dot}`} />}
                {t(opt.key)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-500 mb-1">{t('buildings.filterSize')}</label>
          <div className="flex flex-wrap gap-1.5">
            {sizeOptions.map(opt => (
              <button key={opt.v} type="button" onClick={() => onSizeChange(opt.v)} className={chip(size === opt.v)}>
                {t(opt.key)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
