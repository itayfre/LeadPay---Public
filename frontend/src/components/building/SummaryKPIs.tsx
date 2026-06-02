import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import type { BuildingSummaryStats } from '../../types';

interface Props {
  kpis: BuildingSummaryStats['kpis'];
  trend: BuildingSummaryStats['trend'];
}

// Tiny sparkline — 40px tall, no axes, pure indicator
function Sparkline({ data }: { data: { rate: number | null }[] }) {
  if (!data || data.length < 2) return null;
  // Sparkline only renders historical rate; future entries (rate=null) are skipped
  const historical = data.filter((d): d is { rate: number } => d.rate !== null);
  if (historical.length < 2) return null;
  return (
    <div className="w-16 h-8 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={historical} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line
            type="monotone"
            dataKey="rate"
            stroke="#22C55E"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface KpiCardProps {
  label: string;
  children: React.ReactNode;
  accent: string; // tailwind bg class e.g. "bg-accent-50"
  border: string; // tailwind border class
}

function KpiCard({ label, children, accent, border }: KpiCardProps) {
  return (
    <div className={`rounded-xl border ${border} ${accent} p-5 shadow-sm`} dir="rtl">
      <p className="text-xs font-medium text-ink-500 mb-2">{label}</p>
      {children}
    </div>
  );
}

export default function SummaryKPIs({ kpis, trend }: Props) {
  const { t } = useTranslation();
  const rate = kpis.avg_collection_rate ?? 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* 1 – Average collection rate + sparkline */}
      <KpiCard
        label={t('summary.kpi.avg_rate')}
        accent="bg-accent-50"
        border="border-accent-200"
      >
        <div className="flex items-end justify-between gap-2">
          <p
            className="text-3xl font-bold"
            style={{ color: rate >= 95 ? '#16A34A' : rate >= 60 ? '#EA580C' : '#DC2626' }}
          >
            {rate.toFixed(1)}%
          </p>
          <Sparkline data={trend} />
        </div>
      </KpiCard>

      {/* 2 – Open AR */}
      <KpiCard
        label={t('summary.kpi.open_ar')}
        accent={kpis.open_ar > 0 ? 'bg-danger-50' : 'bg-ink-50'}
        border={kpis.open_ar > 0 ? 'border-danger-50' : 'border-ink-200'}
      >
        <p
          className={`text-3xl font-bold ${kpis.open_ar > 0 ? 'text-danger-600' : 'text-ink-500'}`}
        >
          ₪{Math.round(kpis.open_ar).toLocaleString('he-IL')}
        </p>
        <p className="text-xs text-ink-500 mt-1">{t('summary.kpi.open_ar_hint')}</p>
      </KpiCard>

      {/* 3 – Avg days to pay */}
      <KpiCard
        label={t('summary.kpi.avg_days')}
        accent="bg-primary-50"
        border="border-primary-200"
      >
        <div className="flex items-baseline gap-1">
          <p className="text-3xl font-bold text-primary-700">
            {kpis.avg_days_to_pay > 0 ? kpis.avg_days_to_pay.toFixed(1) : '—'}
          </p>
          {kpis.avg_days_to_pay > 0 && (
            <span className="text-sm text-primary-500">{t('summary.kpi.days')}</span>
          )}
        </div>
      </KpiCard>

      {/* 4 – Expenses vs Income */}
      <KpiCard
        label={t('summary.kpi.exp_vs_income')}
        accent="bg-purple-50"
        border="border-purple-200"
      >
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-500">{t('summary.kpi.income')}</span>
            <span className="text-sm font-semibold text-accent-600">
              ₪{Math.round(kpis.income).toLocaleString('he-IL')}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-500">{t('summary.kpi.expenses')}</span>
            <span className="text-sm font-semibold text-danger-500">
              ₪{Math.round(kpis.expenses).toLocaleString('he-IL')}
            </span>
          </div>
          {kpis.income > 0 && (
            <div className="pt-1">
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  kpis.expenses / kpis.income < 0.5
                    ? 'bg-accent-100 text-accent-700'
                    : kpis.expenses / kpis.income < 0.8
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-danger-50 text-danger-600'
                }`}
              >
                {((kpis.expenses / kpis.income) * 100).toFixed(0)}% {t('summary.kpi.expense_ratio')}
              </span>
            </div>
          )}
        </div>
      </KpiCard>
    </div>
  );
}
