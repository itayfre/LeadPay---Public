import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import Modal from '../ui/Modal';
import PeriodRangePicker from '../building/PeriodRangePicker';
import TenantReportPanel from './TenantReportPanel';
import { reportsAPI } from '../../services/api';
import { toYYYYMM } from '../../hooks/useBuildingPeriodRange';
import type { DateRange, MonthYear } from '../../hooks/useBuildingPeriodRange';
import type { ReportFormat } from '../../types';

interface Props {
  buildingId: string;
  isOpen: boolean;
  onClose: () => void;
}

function addMonths(m: MonthYear, delta: number): MonthYear {
  const total = m.year * 12 + (m.month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function defaultRange(): DateRange {
  const now = new Date();
  const to: MonthYear = { month: now.getMonth() + 1, year: now.getFullYear() };
  return { from: addMonths(to, -2), to };
}

const shekel = (n: number | null | undefined) =>
  n == null ? '—' : `₪${Math.round(n).toLocaleString('he-IL')}`;

export default function ExportReportDialog({ buildingId, isOpen, onClose }: Props) {
  const [mode, setMode] = useState<'building' | 'tenant'>('building');
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [downloading, setDownloading] = useState<ReportFormat | null>(null);

  const fromStr = toYYYYMM(range.from);
  const toStr = toYYYYMM(range.to);

  const { data: payload, isLoading, isError } = useQuery({
    queryKey: ['report-preview', buildingId, fromStr, toStr],
    queryFn: () => reportsAPI.getPayload(buildingId, fromStr, toStr),
    enabled: isOpen && mode === 'building',
  });

  const handleDownload = useCallback(async (format: ReportFormat) => {
    setDownloading(format);
    try {
      const { blob, filename } = await reportsAPI.download(buildingId, fromStr, toStr, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Report download failed:', err);
    } finally {
      setDownloading(null);
    }
  }, [buildingId, fromStr, toStr]);


  return (
    <Modal open={isOpen} onClose={onClose} srTitle="ייצוא דוח" size="5xl" hideClose className="max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-200">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-ink-900">📄 ייצוא דוח</h2>
            <div className="flex rounded-lg bg-ink-100 p-1 text-xs">
              <button
                onClick={() => setMode('building')}
                className={`px-3 py-1.5 rounded-md font-medium ${mode === 'building' ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}
              >🏢 בניין</button>
              <button
                onClick={() => setMode('tenant')}
                className={`px-3 py-1.5 rounded-md font-medium ${mode === 'tenant' ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}
              >👤 דיירים</button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-ink-500 hover:text-ink-700 text-2xl leading-none"
            aria-label="סגור"
          >
            &times;
          </button>
        </div>

        {mode === 'tenant' ? (
          <TenantReportPanel buildingId={buildingId} />
        ) : (
          <>
        {/* Period picker */}
        <div className="px-6 py-4 border-b border-ink-100">
          <PeriodRangePicker range={range} onChange={setRange} />
        </div>

        {/* Preview area */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          {isLoading && (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-primary-200 border-t-primary-600" />
            </div>
          )}

          {isError && (
            <div className="text-center text-danger-500 py-10">שגיאה בטעינת הדוח</div>
          )}

          {payload && (
            <div className="space-y-6 text-sm">
              {/* Report title */}
              <div className="text-center pb-4 border-b border-ink-100">
                <h3 className="text-lg font-bold text-ink-900">{payload.building.name}</h3>
                <p className="text-ink-500 text-xs mt-1">
                  {payload.building.address}, {payload.building.city}
                </p>
                <p className="text-ink-700 font-medium mt-1">{payload.period.label}</p>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-accent-50 rounded-xl p-4 border border-accent-200 text-center">
                  <p className="text-xs text-accent-700 font-semibold mb-1">סה״כ הכנסות</p>
                  <p className="text-xl font-bold text-accent-900">{shekel(payload.summary.total_income)}</p>
                </div>
                <div className="bg-danger-50 rounded-xl p-4 border border-danger-50 text-center">
                  <p className="text-xs text-danger-600 font-semibold mb-1">סה״כ הוצאות</p>
                  <p className="text-xl font-bold text-danger-900">{shekel(payload.summary.total_expenses)}</p>
                </div>
                <div className={`rounded-xl p-4 border text-center ${
                  payload.summary.net_balance >= 0
                    ? 'bg-primary-50 border-primary-200'
                    : 'bg-orange-50 border-orange-200'
                }`}>
                  <p className={`text-xs font-semibold mb-1 ${
                    payload.summary.net_balance >= 0 ? 'text-primary-700' : 'text-orange-700'
                  }`}>מאזן</p>
                  <p className={`text-xl font-bold ${
                    payload.summary.net_balance >= 0 ? 'text-primary-900' : 'text-orange-900'
                  }`}>{shekel(payload.summary.net_balance)}</p>
                </div>
              </div>

              {/* Income table */}
              <div>
                <h4 className="font-semibold text-ink-900 mb-2">הכנסות לפי דייר</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-ink-100">
                        <th className="border border-ink-200 px-3 py-2 text-right font-semibold">דירה</th>
                        <th className="border border-ink-200 px-3 py-2 text-right font-semibold">שם דייר</th>
                        {payload.period.columns.map(col => (
                          <th key={col.key} className="border border-ink-200 px-3 py-2 text-right font-semibold whitespace-nowrap">
                            {col.label}
                          </th>
                        ))}
                        <th className="border border-ink-200 px-3 py-2 text-right font-semibold">שולם</th>
                        <th className="border border-ink-200 px-3 py-2 text-right font-semibold">לתשלום</th>
                        <th className="border border-ink-200 px-3 py-2 text-right font-semibold">יתרה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.income_by_tenant.map((row, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-ink-50'}>
                          <td className="border border-ink-200 px-3 py-1.5">{row.apartment_number}</td>
                          <td className="border border-ink-200 px-3 py-1.5">{row.tenant_name}</td>
                          {row.cells.map(cell => (
                            <td key={cell.key} className="border border-ink-200 px-3 py-1.5">
                              {cell.amount ? shekel(cell.amount) : '—'}
                            </td>
                          ))}
                          <td className="border border-ink-200 px-3 py-1.5">{shekel(row.paid_total)}</td>
                          <td className="border border-ink-200 px-3 py-1.5">{shekel(row.expected_total)}</td>
                          <td className={`border border-ink-200 px-3 py-1.5 font-medium ${
                            row.balance > 0 ? 'text-danger-600' : 'text-ink-500'
                          }`}>
                            {row.balance > 0 ? shekel(row.balance) : '—'}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-ink-100 font-semibold">
                        <td className="border border-ink-200 px-3 py-2" colSpan={2}>סה״כ</td>
                        {payload.income_totals_row.cells.map(cell => (
                          <td key={cell.key} className="border border-ink-200 px-3 py-2">
                            {cell.amount ? shekel(cell.amount) : '—'}
                          </td>
                        ))}
                        <td className="border border-ink-200 px-3 py-2">
                          {shekel(payload.income_totals_row.paid_total)}
                        </td>
                        <td className="border border-ink-200 px-3 py-2">
                          {shekel(payload.income_totals_row.expected_total)}
                        </td>
                        <td className="border border-ink-200 px-3 py-2">
                          {payload.income_totals_row.balance > 0
                            ? shekel(payload.income_totals_row.balance)
                            : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Expenses */}
              {payload.expenses_by_month.length > 0 && (
                <div>
                  <h4 className="font-semibold text-ink-900 mb-2">
                    הוצאות — {shekel(payload.expenses_grand_total)}
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-ink-100">
                          <th className="border border-ink-200 px-3 py-2 text-right font-semibold">חודש</th>
                          <th className="border border-ink-200 px-3 py-2 text-right font-semibold">תיאור</th>
                          <th className="border border-ink-200 px-3 py-2 text-right font-semibold">קטגוריה</th>
                          <th className="border border-ink-200 px-3 py-2 text-right font-semibold">סכום</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payload.expenses_by_month.flatMap((g, gi) =>
                          g.rows.map((row, ri) => (
                            <tr key={`${gi}-${ri}`} className={(gi + ri) % 2 === 0 ? 'bg-white' : 'bg-ink-50'}>
                              <td className="border border-ink-200 px-3 py-1.5 whitespace-nowrap">
                                {ri === 0 ? g.month_label : ''}
                              </td>
                              <td className="border border-ink-200 px-3 py-1.5">{row.description}</td>
                              <td className="border border-ink-200 px-3 py-1.5">{row.category || '—'}</td>
                              <td className="border border-ink-200 px-3 py-1.5">{shekel(row.amount)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Debtors */}
              {(payload.debtors_period.length > 0 || payload.debtors_lifetime.length > 0) && (
                <div>
                  <h4 className="font-semibold text-ink-900 mb-2">חייבים – יתרת חוב פתוח</h4>
                  {payload.debtors_period.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs font-medium text-ink-700 mb-1.5">חוב לתקופה זו</p>
                      <div className="flex flex-wrap gap-2">
                        {payload.debtors_period.map((d, i) => (
                          <div key={i} className="bg-danger-50 border border-danger-50 rounded-lg px-3 py-1.5 text-xs flex gap-2">
                            <span className="font-medium">{d.tenant_name}</span>
                            <span className="text-danger-600">{shekel(d.debt)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {payload.debtors_lifetime.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-ink-700 mb-1.5">יתרת חוב כוללת</p>
                      <div className="flex flex-wrap gap-2">
                        {payload.debtors_lifetime.map((d, i) => (
                          <div key={i} className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 text-xs flex gap-2">
                            <span className="font-medium">{d.tenant_name}</span>
                            <span className="text-orange-700">{shekel(d.debt)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-ink-200 flex items-center justify-between">
          <button
            onClick={onClose}
            className="text-ink-500 hover:text-ink-700 font-medium"
          >
            ביטול
          </button>
          <div className="flex gap-3">
            <button
              onClick={() => handleDownload('docx')}
              disabled={!payload || downloading !== null}
              className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
            >
              {downloading === 'docx' ? (
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
              ) : '📝'}
              הורד Word
            </button>
            <button
              onClick={() => handleDownload('pdf')}
              disabled={!payload || downloading !== null}
              className="bg-danger-600 hover:bg-danger-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
            >
              {downloading === 'pdf' ? (
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
              ) : '📄'}
              הורד PDF
            </button>
          </div>
        </div>
          </>
        )}

    </Modal>
  );
}
