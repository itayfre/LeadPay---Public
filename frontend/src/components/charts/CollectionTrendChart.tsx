import { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ReferenceLine,
} from 'recharts';
import type { PortfolioTrendMonth } from '../../types';

// ── Hebrew month abbreviations ──────────────────────────────────────────────
const HE_MONTHS = [
  'ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני',
  'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ',
];

// ── Per-rate colour coding ───────────────────────────────────────────────────
function getRateColor(rate: number | undefined): string {
  if (rate === undefined || rate === null) return '#E5E7EB'; // no data → light gray
  if (rate > 100) return '#6366F1';  // overpaid → indigo
  if (rate >= 95) return '#22C55E';  // green
  if (rate >= 60) return '#F97316';  // orange
  return '#EF4444';                  // red
}

// ── Chart data shape ─────────────────────────────────────────────────────────
interface ChartBuilding {
  name: string;
  rate: number;
  collected: number;
  expected: number;
}

interface ChartDataPoint {
  period: string;
  label: string;
  portfolioRate: number;
  portfolioExpected: number;
  portfolioCollected: number;
  isEmpty: boolean;
  // Dynamic keys: b0, b1, ..., b0_meta, b1_meta, ...
  [key: string]: unknown;
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
interface TooltipPayloadEntry {
  payload: ChartDataPoint;
}
interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  maxBuildings: number;
}

function CustomTooltip({ active, payload, maxBuildings }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  if (point.isEmpty) {
    return (
      <div
        className="bg-white border border-ink-200 rounded-lg shadow-lg p-3 text-right"
        dir="rtl"
      >
        <p className="text-sm font-semibold text-ink-700">{point.label}</p>
        <p className="text-xs text-ink-500 mt-1">אין נתונים</p>
      </div>
    );
  }

  // Collect buildings from dynamic keys
  const buildings: ChartBuilding[] = [];
  for (let i = 0; i < maxBuildings; i++) {
    const meta = point[`b${i}_meta`] as ChartBuilding | undefined;
    if (!meta) continue;
    buildings.push(meta);
  }
  // Sort worst → best so worst payers appear first in tooltip
  buildings.sort((a, b) => a.rate - b.rate);

  return (
    <div
      className="bg-white border border-ink-200 rounded-lg shadow-lg p-3 text-right max-w-xs max-h-64 overflow-y-auto"
      dir="rtl"
    >
      <p className="text-sm font-bold text-ink-900 mb-2 border-b border-ink-100 pb-1">
        {point.label} —{' '}
        <span style={{ color: getRateColor(point.portfolioRate) }}>
          {point.portfolioRate.toFixed(1)}%
        </span>
      </p>
      <div className="space-y-1">
        {buildings.map((b) => (
          <div key={b.name} className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-700 truncate max-w-[8rem]">{b.name}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-ink-500">
                ₪{b.collected.toLocaleString('he-IL')}
              </span>
              <span
                className="text-xs font-bold w-10 text-left tabular-nums"
                style={{ color: getRateColor(b.rate) }}
              >
                {b.rate.toFixed(0)}%
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-ink-100 mt-2 pt-1">
        <div className="flex items-center justify-between text-xs font-semibold text-ink-700">
          <span>סה״כ</span>
          <span>₪{point.portfolioCollected.toLocaleString('he-IL')}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  data: PortfolioTrendMonth[];
}

export default function CollectionTrendChart({ data }: Props) {
  const { chartData, maxBuildings } = useMemo(() => {
    if (!data || data.length === 0) return { chartData: [], maxBuildings: 0 };

    let maxB = 0;

    const chartData: ChartDataPoint[] = data.map((month) => {
      const hasData = month.portfolio_expected > 0;
      const portfolioRate = hasData
        ? (month.portfolio_collected / month.portfolio_expected) * 100
        : 0;

      // Sort buildings worst → best (bottom of stack = worst)
      const sorted = [...month.buildings].sort((a, b) => a.rate - b.rate);
      maxB = Math.max(maxB, sorted.length);

      const point: ChartDataPoint = {
        period: month.period,
        label: `${HE_MONTHS[month.month - 1]} ${String(month.year).slice(2)}`,
        portfolioRate,
        portfolioExpected: month.portfolio_expected,
        portfolioCollected: month.portfolio_collected,
        isEmpty: !hasData,
      };

      if (hasData) {
        sorted.forEach((b, i) => {
          // Each segment height = building's share of portfolio expected, in %
          const contribution = (b.collected / month.portfolio_expected) * 100;
          point[`b${i}`] = contribution;
          point[`b${i}_meta`] = {
            name: b.name,
            rate: b.rate,
            collected: b.collected,
            expected: b.expected,
          } satisfies ChartBuilding;
        });
      } else {
        // Empty month placeholder: a short grey stub
        point['b0'] = 3;
        point['b0_meta'] = undefined;
      }

      return point;
    });

    return { chartData, maxBuildings: Math.max(maxB, 1) };
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-ink-500 text-sm" dir="rtl">
        אין נתונים לגרף
      </div>
    );
  }

  const maxRate = Math.max(...chartData.map((d) => d.portfolioRate as number), 100);
  const yMax = Math.ceil(maxRate / 10) * 10;

  return (
    <div className="w-full overflow-x-auto">
      {/* min-width ensures bars are readable even with many months */}
      <div style={{ minWidth: Math.max(chartData.length * 56, 420), height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
            barCategoryGap="22%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#F3F4F6"
            />

            {/* X axis – reversed so newest month is on the right in LTR render,
                which reads naturally left-to-right as oldest→newest */}
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
            />

            {/* Y axis – percentage */}
            <YAxis
              domain={[0, yMax]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
              width={38}
            />

            <Tooltip
              content={(props) => (
                <CustomTooltip
                  active={props.active}
                  payload={props.payload as TooltipPayloadEntry[] | undefined}
                  maxBuildings={maxBuildings}
                />
              )}
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
            />

            {/* 100% reference line */}
            <ReferenceLine
              y={100}
              stroke="#9CA3AF"
              strokeDasharray="4 2"
              strokeWidth={1}
            />

            {/* One <Bar> per synthetic slot (b0…bN) */}
            {Array.from({ length: maxBuildings }, (_, i) => (
              <Bar
                key={`b${i}`}
                dataKey={`b${i}`}
                stackId="stack"
                isAnimationActive={false}
                radius={i === maxBuildings - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
              >
                {chartData.map((point, idx) => (
                  <Cell
                    key={`cell-${idx}`}
                    fill={getRateColor((point[`b${i}_meta`] as ChartBuilding | undefined)?.rate)}
                    opacity={point.isEmpty ? 0.3 : 1}
                  />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-4 mt-2 px-2 text-xs text-ink-500" dir="rtl">
        {[
          { color: '#EF4444', label: '0–60%' },
          { color: '#F97316', label: '60–95%' },
          { color: '#22C55E', label: '95–100%' },
          { color: '#6366F1', label: '>100%' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
