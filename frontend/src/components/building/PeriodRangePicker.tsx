import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DateRange, MonthYear } from '../../hooks/useBuildingPeriodRange';

interface Props {
  range: DateRange;
  onChange: (range: DateRange) => void;
}

function addMonths(m: MonthYear, delta: number): MonthYear {
  const totalMonths = (m.year * 12 + (m.month - 1)) + delta;
  return {
    year: Math.floor(totalMonths / 12),
    month: (totalMonths % 12) + 1,
  };
}

function toSelectValue(m: MonthYear): string {
  return m.year + '-' + String(m.month).padStart(2, '0');
}

function fromSelectValue(s: string): MonthYear {
  const [y, mo] = s.split('-');
  return { year: parseInt(y, 10), month: parseInt(mo, 10) };
}

const YEARS = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - 2 + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function monthDiff(from: MonthYear, to: MonthYear): number {
  return (to.year - from.year) * 12 + (to.month - from.month);
}

export default function PeriodRangePicker({ range, onChange }: Props) {
  const { t } = useTranslation();
  const now = new Date();
  const currentMonth: MonthYear = { month: now.getMonth() + 1, year: now.getFullYear() };
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');

  const diff = monthDiff(range.from, range.to);
  const activePreset =
    diff === 0 && range.to.year === currentMonth.year && range.to.month === currentMonth.month
      ? 1
      : diff === 2 && range.to.year === currentMonth.year && range.to.month === currentMonth.month
      ? 3
      : diff === 5 && range.to.year === currentMonth.year && range.to.month === currentMonth.month
      ? 6
      : diff === 11 && range.to.year === currentMonth.year && range.to.month === currentMonth.month
      ? 12
      : null;

  const presets: Array<{ months: number; label: string }> = [
    { months: 1, label: t('building.range.thisMonth') },
    { months: 3, label: t('building.range.3months') },
    { months: 6, label: t('building.range.6months') },
    { months: 12, label: t('building.range.12months') },
  ];

  const applyPreset = (months: number) => {
    setMode('preset');
    onChange({ from: addMonths(currentMonth, -(months - 1)), to: currentMonth });
  };

  const monthLabel = (m: number) =>
    new Date(2024, m - 1).toLocaleString('he-IL', { month: 'long' });

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-4" dir="rtl">
      <div className="flex flex-wrap items-center gap-3">
        {/* Preset pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {presets.map((p) => (
            <button
              key={p.months}
              onClick={() => applyPreset(p.months)}
              className={[
                'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                activePreset === p.months && mode !== 'custom'
                  ? 'bg-primary-600 text-white'
                  : 'bg-ink-100 text-ink-700 hover:bg-ink-200',
              ].join(' ')}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setMode('custom')}
            className={[
              'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              mode === 'custom' || (activePreset === null)
                ? 'bg-primary-600 text-white'
                : 'bg-ink-100 text-ink-700 hover:bg-ink-200',
            ].join(' ')}
          >
            {t('building.range.custom')}
          </button>
        </div>

        {/* Divider */}
        <span className="text-ink-300 text-sm hidden sm:inline">|</span>

        {/* From / To selectors (always visible; disabled summary when preset) */}
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span className="text-ink-500 font-medium">{t('building.range.from')}:</span>
          <select
            value={toSelectValue(range.from)}
            onChange={(e) => {
              const newFrom = fromSelectValue(e.target.value);
              const newTo = monthDiff(newFrom, range.to) >= 0 && monthDiff(newFrom, range.to) <= 23
                ? range.to
                : newFrom;
              setMode('custom');
              onChange({ from: newFrom, to: newTo });
            }}
            className="border border-ink-300 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 bg-white"
          >
            {YEARS.flatMap((y) =>
              MONTHS.map((mo) => (
                <option key={y + '-' + mo} value={y + '-' + String(mo).padStart(2, '0')}>
                  {monthLabel(mo)} {y}
                </option>
              ))
            )}
          </select>

          <span className="text-ink-500">—</span>
          <span className="text-ink-500 font-medium">{t('building.range.to')}:</span>

          <select
            value={toSelectValue(range.to)}
            onChange={(e) => {
              const newTo = fromSelectValue(e.target.value);
              const newFrom = monthDiff(range.from, newTo) >= 0 ? range.from : newTo;
              setMode('custom');
              onChange({ from: newFrom, to: newTo });
            }}
            className="border border-ink-300 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary-500 bg-white"
          >
            {YEARS.flatMap((y) =>
              MONTHS.map((mo) => (
                <option key={y + '-' + mo} value={y + '-' + String(mo).padStart(2, '0')}>
                  {monthLabel(mo)} {y}
                </option>
              ))
            )}
          </select>

          {/* Range summary */}
          {diff > 0 && (
            <span className="text-xs text-ink-500 mr-1">
              ({diff + 1} {t('building.range.months_count')})
            </span>
          )}
        </div>
      </div>

      {/* Validation warning */}
      {monthDiff(range.from, range.to) < 0 && (
        <p className="text-xs text-danger-500 mt-2">{t('building.range.error_order')}</p>
      )}
    </div>
  );
}
