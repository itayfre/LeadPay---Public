import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Building, BuildingPaymentSummary } from '../../types';
import { buildingStatus, STATUS_VISUALS } from '../../lib/buildingStatus';
import { useRiskThresholds } from '../../context/ConfigContext';
import StatusBadge from './StatusBadge';
import Sparkline from './Sparkline';

interface Props {
  building: Building;
  summary?: BuildingPaymentSummary;
  trend?: number[];
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function fmtIls(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—';
  return `₪${Math.round(n).toLocaleString('en-US')}`;
}

export default function BuildingCardV2({ building, summary, trend, onClick, onEdit, onDelete }: Props) {
  const { t } = useTranslation();
  const thresholds = useRiskThresholds();
  const [menuOpen, setMenuOpen] = useState(false);

  const monthlyTarget =
    building.total_expected_monthly ??
    (building.expected_monthly_payment != null
      ? building.expected_monthly_payment * (building.total_tenants || 0)
      : undefined);
  const hasRate = monthlyTarget !== undefined && monthlyTarget > 0;

  const collected = summary?.total_collected ?? 0;
  const expected = summary?.total_expected ?? monthlyTarget ?? 0;
  const overdue = expected > 0 ? Math.max(expected - collected, 0) : 0;
  const rate = summary?.collection_rate ?? 0;
  const paid = summary?.paid ?? 0;
  const unpaid = summary?.unpaid ?? 0;
  const totalTenants = summary?.total_tenants ?? building.total_tenants ?? 0;

  const status = buildingStatus(hasRate, summary?.collection_rate, thresholds);
  const v = STATUS_VISUALS[status];

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
    setMenuOpen(false);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      className="group bg-white rounded-xl ring-1 ring-ink-200 shadow-sm hover:shadow-md transition p-5 flex flex-col gap-4 relative cursor-pointer focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <button
        onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
        className="absolute top-3 left-3 z-10 p-1.5 rounded-md text-ink-400 hover:text-ink-900 hover:bg-ink-100 opacity-0 group-hover:opacity-100 transition"
        aria-label="actions"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>
      {menuOpen && (
        <div className="absolute top-10 left-3 z-20 bg-white rounded-md ring-1 ring-ink-200 shadow-lg py-1 min-w-[150px]">
          <button onClick={stop(onEdit)} className="w-full px-3 py-1.5 text-right text-[13px] hover:bg-ink-100">
            {t('buildings.editDetails')}
          </button>
          <button onClick={stop(onDelete)} className="w-full px-3 py-1.5 text-right text-[13px] text-danger-600 hover:bg-danger-50">
            {t('buildings.deleteBuilding')}
          </button>
        </div>
      )}

      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold tracking-tight leading-tight truncate">{building.name}</div>
          <div className="text-[12px] text-ink-500 mt-1 truncate">
            {building.address}{building.city ? ` · ${building.city}` : ''} · {t('buildings.card.units', { count: totalTenants })}
          </div>
        </div>
        <StatusBadge status={status} />
      </header>

      <div className="grid grid-cols-3 gap-3 text-right">
        <div>
          <div className="text-[10.5px] uppercase tracking-[.12em] text-ink-500 font-semibold">{t('buildings.card.target')}</div>
          <div className="text-[15px] font-semibold tabular-nums mt-1">{fmtIls(hasRate ? expected : null)}</div>
        </div>
        <div>
          <div className="text-[10.5px] uppercase tracking-[.12em] text-ink-500 font-semibold">{t('buildings.card.collected')}</div>
          <div className={`text-[15px] font-semibold tabular-nums mt-1 ${collected > 0 ? 'text-accent-700' : 'text-ink-500'}`}>
            {fmtIls(hasRate ? collected : null)}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] uppercase tracking-[.12em] text-ink-500 font-semibold">{t('buildings.card.overdue')}</div>
          <div className={`text-[15px] font-semibold tabular-nums mt-1 ${overdue > 0 ? 'text-danger-600' : 'text-ink-500'}`}>
            {fmtIls(hasRate ? overdue : null)}
          </div>
        </div>
      </div>

      {hasRate ? (
        <div>
          <div className="flex items-center justify-between text-[12px] mb-1.5">
            <span className="text-ink-500">{t('buildings.card.paidOfTotal', { paid, total: totalTenants })}</span>
            <span className={`font-semibold tabular-nums ${v.textClass}`}>{rate.toFixed(0)}%</span>
          </div>
          <div className="h-1 bg-ink-200 rounded-full overflow-hidden">
            <div className={`h-full ${v.barClass}`} style={{ width: `${Math.max(rate, 2)}%` }} />
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-ink-500">{t('buildings.card.noMonthlyRate')}</div>
      )}

      <footer className="flex items-center justify-between pt-3 border-t border-ink-100">
        <div className="text-[11px] text-ink-500">{t('buildings.card.trend13m')}</div>
        {trend && trend.length > 0 ? (
          <Sparkline data={trend} color={v.sparkColor} width={120} height={28} />
        ) : (
          <span className="text-[11px] text-ink-500">{t('buildings.card.noTrend')}</span>
        )}
      </footer>

      <span className="sr-only">{unpaid} {t('dashboard.unpaid')}</span>
    </div>
  );
}
