import { useTranslation } from 'react-i18next';
import { useRiskThresholds } from '../../context/ConfigContext';

interface Props {
  collected: number;
  expected: number;
  atRiskCount: number;
  totalBuildings: number;
  unpaidTenants: number;
}

function fmtIls(n: number): string {
  return `₪${Math.round(n).toLocaleString('en-US')}`;
}

export default function PortfolioKpiStrip({
  collected,
  expected,
  atRiskCount,
  totalBuildings,
  unpaidTenants,
}: Props) {
  const { t } = useTranslation();
  const thresholds = useRiskThresholds();
  const rate = expected > 0 ? (collected / expected) * 100 : 0;
  const overdue = Math.max(expected - collected, 0);

  const barClass =
    rate >= thresholds.onTrack ? 'bg-accent-500'
    : rate >= thresholds.partial ? 'bg-warn-500'
    : 'bg-danger-500';

  return (
    <section
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-ink-200 rounded-xl overflow-hidden ring-1 ring-ink-200"
      dir="rtl"
    >
      <div className="bg-white p-5">
        <div className="text-[11px] uppercase tracking-[.12em] text-ink-500 font-semibold">
          {t('buildings.kpi.collectionRate')}
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <div className="text-[28px] font-semibold tabular-nums tracking-tight">
            {rate.toFixed(1)}%
          </div>
        </div>
        <div className="h-1 bg-ink-200 rounded-full overflow-hidden mt-3">
          <div className={`h-full ${barClass}`} style={{ width: `${Math.max(rate, 2)}%` }} />
        </div>
      </div>

      <div className="bg-white p-5">
        <div className="text-[11px] uppercase tracking-[.12em] text-ink-500 font-semibold">
          {t('buildings.kpi.collected')}
        </div>
        <div className="mt-3 text-[28px] font-semibold tabular-nums tracking-tight">
          {fmtIls(collected)}
        </div>
        <div className="text-[12px] text-ink-500 mt-1">
          {t('buildings.kpi.outOf')} {fmtIls(expected)}
        </div>
      </div>

      <div className="bg-white p-5">
        <div className="text-[11px] uppercase tracking-[.12em] text-ink-500 font-semibold">
          {t('buildings.kpi.overdue')}
        </div>
        <div className="mt-3 text-[28px] font-semibold tabular-nums tracking-tight text-danger-600">
          {fmtIls(overdue)}
        </div>
        <div className="text-[12px] text-ink-500 mt-1">
          {t('buildings.kpi.unpaidTenants', { count: unpaidTenants })}
        </div>
      </div>

      <div className="bg-white p-5">
        <div className="text-[11px] uppercase tracking-[.12em] text-ink-500 font-semibold">
          {t('buildings.kpi.atRisk')}
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <div className="text-[28px] font-semibold tabular-nums tracking-tight">{atRiskCount}</div>
          <span className="text-[12px] text-ink-500">
            {t('buildings.kpi.outOfTotal', { total: totalBuildings })}
          </span>
        </div>
        {atRiskCount > 0 && (
          <div className="text-[12px] text-warn-600 mt-1 font-medium">
            {t('buildings.kpi.needsAttention')}
          </div>
        )}
      </div>
    </section>
  );
}
