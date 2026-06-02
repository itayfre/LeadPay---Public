import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceDot,
} from 'recharts';
import type { BuildingSummaryStats } from '../../../types';

const HE_MONTHS = [
  'ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני',
  'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ',
];

function shortLabel(period: string): string {
  // period = "YYYY-MM"
  const parts = period.split('-');
  if (parts.length !== 2) return period;
  const mo = parseInt(parts[1], 10);
  return HE_MONTHS[mo - 1] + ' ' + parts[0].slice(2);
}

interface TrendPoint {
  period: string;
  rate: number | null;
  collected: number | null;
  expected: number;
  projected_standing_order_income?: number | null;
  is_future?: boolean;
}

interface TooltipPayload {
  payload?: TrendPoint;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  if (d.is_future) {
    return (
      <div className="bg-white border border-sky-200 rounded-lg shadow-lg px-3 py-2 text-right" dir="rtl">
        <p className="text-xs font-semibold text-sky-800">
          {shortLabel(d.period)} — צפי הוראת קבע
        </p>
        <p className="text-xs text-sky-600 mt-0.5">
          ₪{(d.projected_standing_order_income ?? 0).toLocaleString('he-IL')}
        </p>
      </div>
    );
  }
  const rate = d.rate ?? 0;
  const collected = d.collected ?? 0;
  return (
    <div className="bg-white border border-ink-200 rounded-lg shadow-lg px-3 py-2 text-right" dir="rtl">
      <p className="text-xs font-semibold text-ink-900">
        {shortLabel(d.period)} — {rate.toFixed(1)}%
      </p>
      <p className="text-xs text-ink-500 mt-0.5">
        ₪{collected.toLocaleString('he-IL')} / ₪{d.expected.toLocaleString('he-IL')}
      </p>
    </div>
  );
}

interface Props {
  trend: BuildingSummaryStats['trend'];
}

export default function CollectionTrendLine({ trend }: Props) {
  const { t } = useTranslation();

  if (!trend || trend.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-ink-500 text-sm" dir="rtl">
        {t('summary.chart.no_data')}
      </div>
    );
  }

  const chartData = trend.map((d) => ({ ...d, label: shortLabel(d.period) }));
  const historical = chartData.filter((d) => !d.is_future);
  const projections = chartData.filter((d) => d.is_future);
  const maxRate = Math.max(100, ...historical.map((d) => d.rate ?? 0));
  const yMax = Math.ceil(maxRate / 10) * 10;

  // Worst month over historical only (future entries have rate=null)
  const worst = historical.length
    ? historical.reduce((min, d) => ((d.rate ?? 0) < (min.rate ?? 0) ? d : min), historical[0])
    : null;

  const maxProjection = Math.max(
    0,
    ...projections.map((d) => d.projected_standing_order_income ?? 0)
  );

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={chartData} margin={{ top: 16, right: 36, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22C55E" stopOpacity={0.08} />
            <stop offset="95%" stopColor="#22C55E" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="projectionFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.18} />
            <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />

        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: '#9CA3AF' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="rate"
          domain={[0, yMax]}
          tickFormatter={(v: number) => v + '%'}
          tick={{ fontSize: 11, fill: '#9CA3AF' }}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        {maxProjection > 0 && (
          <YAxis
            yAxisId="amount"
            orientation="right"
            domain={[0, Math.ceil(maxProjection / 1000) * 1000]}
            tickFormatter={(v: number) => '₪' + (v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v))}
            tick={{ fontSize: 10, fill: '#0EA5E9' }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
        )}

        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#E5E7EB', strokeWidth: 1 }} />

        <Area
          yAxisId="rate"
          type="monotone"
          dataKey="rate"
          fill="url(#trendFill)"
          stroke="none"
          isAnimationActive={false}
          connectNulls={false}
        />
        <Line
          yAxisId="rate"
          type="monotone"
          dataKey="rate"
          stroke="#22C55E"
          strokeWidth={2}
          dot={{ r: 3, fill: '#22C55E', strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
          connectNulls={false}
        />

        {maxProjection > 0 && (
          <>
            <Area
              yAxisId="amount"
              type="monotone"
              dataKey="projected_standing_order_income"
              fill="url(#projectionFill)"
              stroke="none"
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line
              yAxisId="amount"
              type="monotone"
              dataKey="projected_standing_order_income"
              stroke="#0284C7"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={{ r: 3, fill: '#0EA5E9', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          </>
        )}

        {/* Annotate worst month (historical only) */}
        {worst && worst.rate !== null && worst.rate < 90 && (
          <ReferenceDot
            yAxisId="rate"
            x={worst.label}
            y={worst.rate}
            r={5}
            fill="#EF4444"
            stroke="#fff"
            strokeWidth={2}
            label={{
              value: worst.rate.toFixed(0) + '%',
              position: 'top',
              fontSize: 10,
              fill: '#EF4444',
            }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
