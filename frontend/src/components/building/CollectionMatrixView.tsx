import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaymentStatus } from '../../types';
import type { MonthYear } from '../../hooks/useBuildingPeriodRange';

export interface MatrixTenant {
  tenant_id: string;
  tenant_name: string;
  apartment_number: number;
  apartment_id: string;
  phone?: string;
  language: 'he' | 'en';
  total_expected: number;
  total_paid: number;
  total_debt: number;
  status: 'paid' | 'partial' | 'unpaid';
  months: Array<PaymentStatus & { period_label: string }>;
}

interface Props {
  tenants: MatrixTenant[];
  monthList: MonthYear[];
  todayMonth: MonthYear;
  moveInByApartment: Record<string, { year: number; month: number } | null>;
  onCellClick: (tenant: MatrixTenant, month: MonthYear, monthData: PaymentStatus | null) => void;
  onTenantClick: (tenant: MatrixTenant) => void;
  highlightCell?: { tenantId: string; month: number; year: number } | null;
}

const HE_MONTHS_SHORT = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

function isBefore(a: MonthYear, b: MonthYear): boolean {
  if (a.year !== b.year) return a.year < b.year;
  return a.month < b.month;
}

function fmt(n: number): string {
  return '₪' + Math.round(n).toLocaleString();
}

export default function CollectionMatrixView({
  tenants,
  monthList,
  todayMonth,
  moveInByApartment,
  onCellClick,
  onTenantClick,
  highlightCell,
}: Props) {
  const { t } = useTranslation();

  const byMonth = useMemo(() => {
    const map = new Map<string, Map<string, PaymentStatus>>();
    for (const ten of tenants) {
      const m = new Map<string, PaymentStatus>();
      for (const mo of ten.months) {
        m.set(`${mo.expected_amount},${mo.paid_amount}`, mo); // placeholder, real key below
      }
      // Build by period using period_label match against monthList
      const realMap = new Map<string, PaymentStatus>();
      for (const mo of ten.months) {
        // The PaymentStatus object doesn't carry month/year directly — period_label is e.g. "מאי 2026"
        realMap.set(mo.period_label, mo);
      }
      map.set(ten.tenant_id, realMap);
    }
    return map;
  }, [tenants]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden" dir="rtl">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-3 text-right font-semibold sticky right-0 bg-slate-50 z-10">#</th>
              <th className="px-3 py-3 text-right font-semibold sticky right-10 bg-slate-50 z-10 min-w-[180px]">
                {t('payment.tenant')}
              </th>
              <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">{t('payment.monthlyExpected')}</th>
              {monthList.map((m) => {
                const isCurrent = m.month === todayMonth.month && m.year === todayMonth.year;
                return (
                  <th
                    key={`${m.year}-${m.month}`}
                    className={`px-2 py-3 text-center font-semibold ${isCurrent ? 'bg-primary-50 text-primary-700' : ''}`}
                  >
                    {HE_MONTHS_SHORT[m.month - 1]}
                  </th>
                );
              })}
              <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">{t('payment.currentDebt')}</th>
              <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">{t('payment.totalPaid')}</th>
              <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">{t('payment.balance')}</th>
              <th className="px-3 py-3 text-center font-semibold whitespace-nowrap">{t('payment.annualExpected')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tenants.length === 0 ? (
              <tr>
                <td colSpan={monthList.length + 7} className="px-6 py-12 text-center text-slate-500">
                  אין נתוני תשלומים לתקופה זו
                </td>
              </tr>
            ) : (
              tenants.map((ten) => {
                const moveIn = moveInByApartment[ten.apartment_id] ?? null;
                const monthsMap = byMonth.get(ten.tenant_id) ?? new Map();
                const annualExpected = ten.months.reduce((s, m) => s + m.expected_amount, 0);
                const annualPaid = ten.months.reduce((s, m) => s + m.paid_amount, 0);
                const annualBalance = annualExpected - annualPaid;

                return (
                  <tr key={ten.tenant_id} className="hover:bg-slate-50">
                    <td className="px-3 py-3 sticky right-0 bg-white font-medium text-slate-700">
                      {ten.apartment_number}
                    </td>
                    <td className="px-3 py-3 sticky right-10 bg-white">
                      <button
                        onClick={() => onTenantClick(ten)}
                        className="text-slate-900 font-medium hover:text-primary-600 hover:underline text-right"
                      >
                        {ten.tenant_name}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-slate-600 tabular-nums">
                      {ten.months[0] ? fmt(ten.months[0].expected_amount) : '—'}
                    </td>

                    {monthList.map((m) => {
                      const label = `${[
                        'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
                        'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
                      ][m.month - 1]} ${m.year}`;
                      const data = monthsMap.get(label) ?? null;
                      const moveInMY: MonthYear | null = moveIn ? { month: moveIn.month, year: moveIn.year } : null;
                      const beforeMoveIn = moveInMY ? isBefore(m, moveInMY) : false;
                      const isFuture = isBefore(todayMonth, m);
                      const hasStandingOrder = !!data?.has_standing_order;
                      const standingOrderAmount = data?.standing_order_amount ?? null;
                      const expected = data?.expected_amount ?? 0;
                      const paid = data?.paid_amount ?? 0;
                      const cellStatus: 'paid' | 'partial' | 'unpaid' | 'empty' =
                        beforeMoveIn || expected === 0
                          ? 'empty'
                          : data?.status ?? 'unpaid';

                      const isHighlighted =
                        highlightCell &&
                        highlightCell.tenantId === ten.tenant_id &&
                        highlightCell.month === m.month &&
                        highlightCell.year === m.year;

                      let cellClass = 'mx-auto w-12 h-12 rounded-lg flex flex-col items-center justify-center transition focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none';
                      let icon: string = '';
                      let iconClass = '';
                      let amountText = '';
                      let amountClass = 'text-[10px] mt-0.5 font-medium';
                      let title = '';

                      if (cellStatus === 'empty') {
                        cellClass += ' text-slate-300';
                        icon = '—';
                        iconClass = 'text-lg leading-none';
                        title = beforeMoveIn ? 'לפני מועד הכניסה' : 'אין ציפייה';
                      } else if (cellStatus === 'paid') {
                        cellClass += ' bg-accent-50 border border-accent-200 cursor-pointer hover:scale-105';
                        icon = '✓';
                        iconClass = 'text-accent-700 leading-none';
                        amountText = fmt(paid);
                        amountClass += ' text-slate-600';
                        title = t('collection.cell.editPayment');
                      } else if (cellStatus === 'partial') {
                        cellClass += ' bg-warn-50 border border-warn-200 cursor-pointer hover:scale-105';
                        icon = '◐';
                        iconClass = 'text-warn-600 leading-none';
                        amountText = fmt(paid);
                        amountClass += ' text-warn-600';
                        title = t('collection.cell.completePartial');
                      } else if (hasStandingOrder) {
                        cellClass += ' border border-sky-200 bg-sky-50 cursor-pointer hover:bg-sky-100';
                        icon = '↻';
                        iconClass = 'text-sky-600 leading-none';
                        amountText = fmt(standingOrderAmount ?? expected);
                        amountClass += ' text-sky-700';
                        title = t('collection.standingOrder.expectedTooltip');
                      } else if (isFuture) {
                        cellClass += ' border border-slate-200 opacity-40 cursor-pointer hover:opacity-100';
                        icon = '○';
                        iconClass = 'text-slate-400 text-lg leading-none';
                        amountText = fmt(0);
                        amountClass += ' text-slate-500';
                        title = t('collection.cell.prepay');
                      } else {
                        cellClass += ' ring-1 ring-rose-200 bg-rose-50/40 cursor-pointer hover:ring-rose-400';
                        icon = '○';
                        iconClass = 'text-rose-400 text-lg leading-none';
                        amountText = fmt(0);
                        amountClass += ' text-rose-600';
                        title = t('collection.cell.addPayment');
                      }

                      if (isHighlighted) cellClass += ' ring-2 ring-primary-500';

                      const isClickable = cellStatus !== 'empty';

                      return (
                        <td key={`${m.year}-${m.month}`} className="px-1 py-2">
                          {isClickable ? (
                            <button
                              type="button"
                              onClick={() => onCellClick(ten, m, data)}
                              title={title}
                              aria-label={`${label} — ${ten.tenant_name} — ${title}`}
                              className={cellClass}
                            >
                              <span className={iconClass}>{icon}</span>
                              {amountText && <span className={amountClass}>{amountText}</span>}
                            </button>
                          ) : (
                            <div className={cellClass} title={title} aria-label={`${label} — ${title}`}>
                              <span className={iconClass}>{icon}</span>
                            </div>
                          )}
                        </td>
                      );
                    })}

                    <td className="px-3 py-3 text-center text-sm tabular-nums">
                      {ten.total_debt > 0 ? (
                        <span className="text-rose-600 font-semibold">{fmt(ten.total_debt)}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center text-sm text-slate-900 font-medium tabular-nums">{fmt(annualPaid)}</td>
                    <td className={`px-3 py-3 text-center text-sm font-semibold tabular-nums ${annualBalance > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                      {annualBalance > 0 ? fmt(annualBalance) : '—'}
                    </td>
                    <td className="px-3 py-3 text-center text-sm text-slate-900 font-bold tabular-nums">{fmt(annualExpected)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="border-t border-slate-200 px-4 py-3 bg-slate-50/50">
        <p className="text-xs font-semibold text-slate-600 mb-2">{t('collection.matrixLegend.title')}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-slate-600">
          <LegendDot bg="bg-accent-50 border border-accent-200" iconClass="text-accent-700" icon="✓" label={t('collection.matrixLegend.paid')} />
          <LegendDot bg="bg-warn-50 border border-warn-200" iconClass="text-warn-600" icon="◐" label={t('collection.matrixLegend.partial')} />
          <LegendDot bg="ring-1 ring-rose-200 bg-rose-50/40" iconClass="text-rose-400" icon="○" label={t('collection.matrixLegend.overdue')} />
          <LegendDot bg="border border-slate-200 opacity-40" iconClass="text-slate-400" icon="○" label={t('collection.matrixLegend.future')} />
          <LegendDot bg="border border-sky-200 bg-sky-50" iconClass="text-sky-600" icon="↻" label={t('collection.matrixLegend.standingOrder')} />
          <LegendDot bg="" iconClass="text-slate-300" icon="—" label={t('collection.matrixLegend.empty')} />
        </div>
      </div>
    </div>
  );
}

function LegendDot({ bg, iconClass, icon, label }: { bg: string; iconClass: string; icon: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-5 h-5 rounded flex items-center justify-center ${bg}`}>
        <span className={`${iconClass} text-xs leading-none`}>{icon}</span>
      </span>
      <span>{label}</span>
    </div>
  );
}
