import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  LabelList,
  Tooltip,
} from 'recharts';
import type { BuildingSummaryStats } from '../../../types';

// Urgency: 0-7 (freshest/best) → 60+ and unpaid (worst)
const BUCKET_COLORS = [
  '#22C55E', // 0-7 days — green
  '#86EFAC', // 8-30 — light green
  '#FCD34D', // 31-60 — yellow
  '#F97316', // 60+   — orange
  '#EF4444', // unpaid — red
];

interface Props {
  debtAging: BuildingSummaryStats['debt_aging'];
}

export default function DebtAgingBar({ debtAging }: Props) {
  const { t } = useTranslation();

  const total =
    debtAging['0-7'] +
    debtAging['8-30'] +
    debtAging['31-60'] +
    debtAging['60+'] +
    debtAging['unpaid'];

  const chartData = [
    { name: t('summary.aging.days_0_7'), value: debtAging['0-7'], color: BUCKET_COLORS[0] },
    { name: t('summary.aging.days_8_30'), value: debtAging['8-30'], color: BUCKET_COLORS[1] },
    { name: t('summary.aging.days_31_60'), value: debtAging['31-60'], color: BUCKET_COLORS[2] },
    { name: t('summary.aging.days_60plus'), value: debtAging['60+'], color: BUCKET_COLORS[3] },
    { name: t('summary.aging.unpaid'), value: debtAging['unpaid'], color: BUCKET_COLORS[4] },
  ];

  if (total === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-ink-500 text-sm" dir="rtl">
        {t('summary.chart.no_data')}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 0, right: 60, left: 0, bottom: 0 }}
        barCategoryGap="20%"
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11, fill: '#6B7280' }}
          axisLine={false}
          tickLine={false}
          width={90}
          mirror
        />
        <Tooltip
          cursor={{ fill: 'rgba(0,0,0,0.04)' }}
          formatter={(value: number | undefined) => {
            const v = value ?? 0;
            return [
              v + ' ' + t('summary.aging.payments') + ' (' + (total > 0 ? ((v / total) * 100).toFixed(0) : 0) + '%)',
              '',
            ] as [string, string];
          }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(value: unknown) => {
              const v = Number(value ?? 0);
              return v > 0
                ? v + ' (' + (total > 0 ? ((v / total) * 100).toFixed(0) : 0) + '%)'
                : '';
            }}
            style={{ fontSize: 11, fill: '#6B7280' }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
