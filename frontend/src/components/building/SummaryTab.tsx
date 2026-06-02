import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useBuildingSummary } from '../../hooks/useBuildingSummary';
import type { DateRange } from '../../hooks/useBuildingPeriodRange';
import SummaryKPIs from './SummaryKPIs';
import CollectionTrendLine from './charts/CollectionTrendLine';
import ExpensesPie from './charts/ExpensesPie';
import DebtAgingBar from './charts/DebtAgingBar';
import WorstPayersList from './charts/WorstPayersList';

// ─── Error boundary ────────────────────────────────────────────────────────────
interface EBState { hasError: boolean }
class ChartErrorBoundary extends Component<{ children: ReactNode; label: string }, EBState> {
  state: EBState = { hasError: false };
  static getDerivedStateFromError(): EBState { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full text-xs text-ink-500 p-4 text-center" dir="rtl">
          שגיאה בטעינת {this.props.label}
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────
function CardSkeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-ink-100 animate-pulse rounded-xl ${className}`} />;
}

// ─── Chart card wrapper ────────────────────────────────────────────────────────
function ChartCard({
  title,
  children,
  label,
  className = '',
}: {
  title: string;
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-xl border border-ink-200 shadow-sm p-5 ${className}`} dir="rtl">
      <h3 className="text-sm font-semibold text-ink-700 mb-4">{title}</h3>
      <ChartErrorBoundary label={label}>{children}</ChartErrorBoundary>
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  buildingId: string;
  range: DateRange;
  onGoToExpenses?: () => void;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
const PROJECTION_MONTHS = 6;

export default function SummaryTab({ buildingId, range, onGoToExpenses }: Props) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useBuildingSummary(buildingId, range.from, range.to, PROJECTION_MONTHS);

  if (isLoading) {
    return (
      <div className="space-y-5" dir="rtl">
        {/* KPI skeletons */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <CardSkeleton key={i} className="h-28" />)}
        </div>
        {/* Chart skeletons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <CardSkeleton className="h-64" />
          <CardSkeleton className="h-64" />
          <CardSkeleton className="h-56" />
          <CardSkeleton className="h-56" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-danger-50 border border-danger-50 rounded-xl p-6 text-center" dir="rtl">
        <p className="text-danger-600 text-sm font-medium">{t('common.error')}: {(error as Error).message}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-5" dir="rtl">
      {/* KPI row */}
      <SummaryKPIs kpis={data.kpis} trend={data.trend} />

      {/* 2×2 chart grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Trend line */}
        <ChartCard title={t('summary.chart.trend_title')} label="מגמת גבייה">
          <CollectionTrendLine trend={data.trend} />
        </ChartCard>

        {/* Expenses pie */}
        <ChartCard title={t('summary.chart.expenses_title')} label="הוצאות">
          <ExpensesPie
            expensesByCategory={data.expenses_by_category}
            totalExpenses={data.kpis.expenses}
            onGoToExpenses={onGoToExpenses}
          />
        </ChartCard>

        {/* Debt aging */}
        <ChartCard title={t('summary.chart.aging_title')} label="זמן גבייה">
          <DebtAgingBar debtAging={data.debt_aging} />
        </ChartCard>

        {/* Worst payers */}
        <ChartCard title={t('summary.chart.worst_payers_title')} label="שלמו הכי פחות">
          <WorstPayersList worstPayers={data.worst_payers} />
        </ChartCard>
      </div>
    </div>
  );
}
