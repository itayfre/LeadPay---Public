import { useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import PeriodRangePicker from '../building/PeriodRangePicker';
import TenantReportPreview from './TenantReportPreview';
import { reportsAPI, tenantsAPI } from '../../services/api';
import { toYYYYMM } from '../../hooks/useBuildingPeriodRange';
import type { DateRange, MonthYear } from '../../hooks/useBuildingPeriodRange';
import type { ReportFormat, Tenant } from '../../types';

function addMonths(m: MonthYear, delta: number): MonthYear {
  const total = m.year * 12 + (m.month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}
function defaultRange(): DateRange {
  const now = new Date();
  const to: MonthYear = { month: now.getMonth() + 1, year: now.getFullYear() };
  return { from: addMonths(to, -2), to };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  buildingId: string;
}

export default function TenantReportPanel({ buildingId }: Props) {
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [downloading, setDownloading] = useState<ReportFormat | null>(null);

  const { data: tenants = [], isLoading: tenantsLoading } = useQuery({
    queryKey: ['tenants', buildingId],
    queryFn: () => tenantsAPI.list(buildingId),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter((t: Tenant) =>
      t.name.toLowerCase().includes(q) ||
      (t.full_name?.toLowerCase().includes(q) ?? false) ||
      String(t.apartment_number ?? '').includes(q)
    );
  }, [tenants, search]);

  const fromStr = toYYYYMM(range.from);
  const toStr = toYYYYMM(range.to);
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const singleId = selectedIds.length === 1 ? selectedIds[0] : null;

  const { data: previewPayload, isLoading: previewLoading } = useQuery({
    queryKey: ['tenant-report-preview', singleId, fromStr, toStr],
    queryFn: () => reportsAPI.getTenantPayload(singleId!, fromStr, toStr),
    enabled: !!singleId,
  });

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(filtered.filter(t => t.is_active).map(t => t.id)));
  const clearAll = () => setSelected(new Set());

  const handleDownload = useCallback(async (format: ReportFormat) => {
    setDownloading(format);
    try {
      if (selectedIds.length === 1) {
        const { blob, filename } = await reportsAPI.downloadTenant(selectedIds[0], fromStr, toStr, format);
        triggerDownload(blob, filename);
      } else {
        const { blob, filename } = await reportsAPI.downloadTenantBulk(selectedIds, fromStr, toStr, format);
        triggerDownload(blob, filename);
      }
    } catch (err) {
      console.error('Tenant report download failed:', err);
    } finally {
      setDownloading(null);
    }
  }, [selectedIds, fromStr, toStr]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-6 py-4 border-b border-ink-100">
        <PeriodRangePicker range={range} onChange={setRange} />
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Tenant list (right side in RTL) */}
        <div className="w-72 border-l border-ink-200 flex flex-col">
          <div className="p-3 border-b border-ink-100 space-y-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש דייר / דירה"
              className="w-full border border-ink-300 rounded-lg px-3 py-1.5 text-sm"
            />
            <div className="flex justify-between text-xs">
              <button onClick={selectAll} className="text-primary-600 hover:underline">בחר הכל</button>
              <span className="text-ink-500">{selected.size} נבחרו</span>
              <button onClick={clearAll} className="text-ink-500 hover:underline">נקה</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tenantsLoading && <p className="p-4 text-sm text-ink-500">טוען…</p>}
            {filtered.map((t: Tenant) => (
              <label
                key={t.id}
                className={`flex items-center gap-2 px-3 py-2 text-sm border-b border-ink-50 cursor-pointer hover:bg-ink-50 ${t.is_active ? '' : 'opacity-50'}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                  className="cursor-pointer"
                />
                <span className="text-ink-500 w-8">{t.apartment_number ?? '—'}</span>
                <span className="flex-1">{t.name}</span>
                {!t.is_active && <span className="text-xs text-ink-500">(לא פעיל)</span>}
              </label>
            ))}
          </div>
        </div>

        {/* Preview / summary */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          {selected.size === 0 && (
            <p className="text-center text-ink-500 mt-12">בחר לפחות דייר אחד מהרשימה</p>
          )}
          {selected.size === 1 && previewLoading && (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-primary-200 border-t-primary-600" />
            </div>
          )}
          {selected.size === 1 && previewPayload && (
            <TenantReportPreview payload={previewPayload} />
          )}
          {selected.size >= 2 && (
            <div className="text-center mt-12">
              <p className="text-lg font-medium text-ink-700">נבחרו {selected.size} דיירים</p>
              <p className="text-sm text-ink-500 mt-2">בלחיצה על "הורד" יישלח קובץ ZIP עם {selected.size} דוחות נפרדים.</p>
            </div>
          )}
        </div>
      </div>

      <div className="px-6 py-4 border-t border-ink-200 flex items-center justify-end gap-3">
        <button
          onClick={() => handleDownload('docx')}
          disabled={selected.size === 0 || downloading !== null}
          className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
        >
          {downloading === 'docx' ? '…' : '📝'}
          {selected.size > 1 ? 'הורד ZIP (Word)' : 'הורד Word'}
        </button>
        <button
          onClick={() => handleDownload('pdf')}
          disabled={selected.size === 0 || downloading !== null}
          className="bg-danger-600 hover:bg-danger-600 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
        >
          {downloading === 'pdf' ? '…' : '📄'}
          {selected.size > 1 ? 'הורד ZIP (PDF)' : 'הורד PDF'}
        </button>
      </div>
    </div>
  );
}
