import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';
import type { BuildingSummaryStats } from '../../../types';

interface Props {
  expensesByCategory: BuildingSummaryStats['expenses_by_category'];
  totalExpenses: number;
  onGoToExpenses?: () => void;
}

interface TooltipPayload {
  name: string;
  value: number;
  payload: { color: string };
}

function CustomTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0';
  return (
    <div className="bg-white border border-ink-200 rounded-lg shadow-lg px-3 py-2 text-right" dir="rtl">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: d.payload.color }} />
        <span className="text-xs font-semibold text-ink-900">{d.name}</span>
      </div>
      <p className="text-xs text-ink-500 mt-0.5">
        ₪{d.value.toLocaleString('he-IL')} ({pct}%)
      </p>
    </div>
  );
}

// Center label rendered via custom label prop
function CenterLabel({
  cx,
  cy,
  total,
}: {
  cx: number;
  cy: number;
  total: number;
}) {
  return (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
      <tspan x={cx} dy="-0.6em" fontSize={11} fill="#9CA3AF">
        הוצאות
      </tspan>
      <tspan x={cx} dy="1.4em" fontSize={15} fontWeight={700} fill="#1F2937">
        ₪{Math.round(total).toLocaleString('he-IL')}
      </tspan>
    </text>
  );
}

export default function ExpensesPie({ expensesByCategory, totalExpenses, onGoToExpenses }: Props) {
  const { t } = useTranslation();

  // Separate categorized vs uncategorized
  const categorized = expensesByCategory.filter((c) => c.category_id !== null);
  const uncategorized = expensesByCategory.find((c) => c.category_id === null);
  const allUncategorized = categorized.length === 0 && (uncategorized?.amount ?? 0) > 0;

  if (totalExpenses === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-ink-500 text-sm" dir="rtl">
        {t('summary.chart.no_expenses')}
      </div>
    );
  }

  if (allUncategorized) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-center" dir="rtl">
        <p className="text-sm text-ink-500">{t('summary.expenses.uncategorized_prompt')}</p>
        {onGoToExpenses && (
          <button
            onClick={onGoToExpenses}
            className="px-4 py-2 bg-primary-600 text-white text-xs font-semibold rounded-lg hover:bg-primary-700 transition-colors"
          >
            {t('summary.expenses.go_categorize')}
          </button>
        )}
      </div>
    );
  }

  // Build pie data from categorized (add uncategorized slice if any)
  const pieData = [
    ...categorized,
    ...(uncategorized && uncategorized.amount > 0
      ? [{ ...uncategorized, name: t('summary.expenses.uncategorized') }]
      : []),
  ].map((c) => ({
    name: c.name,
    value: c.amount,
    color: c.color,
  }));

  return (
    <div className="flex items-center gap-4" dir="rtl">
      {/* Donut */}
      <div className="shrink-0" style={{ width: 140, height: 140 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius="62%"
              outerRadius="92%"
              dataKey="value"
              strokeWidth={2}
              stroke="#fff"
              isAnimationActive={false}
              labelLine={false}
              label={({ cx, cy }: { cx: number; cy: number }) => (
                <CenterLabel cx={cx} cy={cy} total={totalExpenses} />
              )}
            >
              {pieData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              content={(props) => (
                <CustomTooltip
                  active={props.active}
                  payload={props.payload as TooltipPayload[] | undefined}
                  total={totalExpenses}
                />
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex-1 min-w-0 space-y-1.5">
        {pieData.map((entry) => {
          const pct = totalExpenses > 0 ? ((entry.value / totalExpenses) * 100).toFixed(0) : '0';
          return (
            <div key={entry.name} className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: entry.color }}
                />
                <span className="text-ink-700 truncate">{entry.name}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 text-ink-500">
                <span>₪{Math.round(entry.value).toLocaleString('he-IL')}</span>
                <span className="text-ink-300">·</span>
                <span className="font-medium text-ink-700">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
