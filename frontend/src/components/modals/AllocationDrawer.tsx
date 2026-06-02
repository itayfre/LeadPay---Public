import { useState, useEffect } from 'react';
import { statementsAPI } from '../../services/api';
import DescriptionCell from '../shared/DescriptionCell';
import Modal from '../ui/Modal';
import type { ReviewTransaction, MatchSuggestion, AllocationItem, AllocationMode } from '../../types';

interface PropsWithData {
  tx: ReviewTransaction;
  allTenants: MatchSuggestion[];
  transactionId?: undefined;
  onClose: () => void;
  onSaved: () => void;
}

interface PropsWithId {
  transactionId: string;
  tx?: undefined;
  allTenants?: undefined;
  onClose: () => void;
  onSaved: () => void;
}

type Props = PropsWithData | PropsWithId;

function formatAmount(amount?: number | null) {
  if (amount == null) return '—';
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 0 })}`;
}

// ── Inline SVG icons (matches UploadReviewModal.tsx pattern) ──
function TrashSmIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

// ── Row types ──

interface SplitRow {
  tenant_id: string;
  amount: string;
  period_month: string;
  period_year: string;
}

interface MultiMonthRow {
  period_month: string;
  period_year: string;
  amount: string;
}

// ── Period helpers ──

function currentYearMonth(): { month: string; year: string } {
  const now = new Date();
  return { month: String(now.getMonth() + 1).padStart(2, '0'), year: String(now.getFullYear()) };
}

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function monthOptions(): { value: string; label: string }[] {
  // Generate options for current year ± 1 (covers past debts and forward-dated allocations).
  // Returns 36 entries: 12 months × 3 years. value format: "YYYY-MM" (zero-padded month).
  const now = new Date();
  const currentYear = now.getFullYear();
  const opts: { value: string; label: string }[] = [];
  for (let year = currentYear - 1; year <= currentYear + 1; year++) {
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      opts.push({ value: `${year}-${mm}`, label: `${HEBREW_MONTHS[m - 1]} ${year}` });
    }
  }
  return opts;
}

// Hoisted to module scope so the 36-entry list is computed once per session
// instead of once per row per render. Worst case: drawer opened 366 days after
// session start sees a slightly stale year ± 1 — acceptable.
const MONTH_OPTIONS = monthOptions();

// If the row's saved period is outside the standard ± 1 range (e.g. a legacy
// 2024 allocation viewed in 2026), prepend a synthetic option so the <select>
// still shows the value instead of rendering blank.
function optionsForRow(rowYear: string, rowMonth: string): { value: string; label: string }[] {
  const rowValue = `${rowYear}-${String(rowMonth).padStart(2, '0')}`;
  if (MONTH_OPTIONS.some(o => o.value === rowValue)) return MONTH_OPTIONS;
  const y = parseInt(rowYear);
  const m = parseInt(rowMonth);
  const hebMonth = HEBREW_MONTHS[m - 1] ?? rowMonth;
  return [
    { value: rowValue, label: `${hebMonth} ${y} (תקופה ישנה)` },
    ...MONTH_OPTIONS,
  ];
}

export default function AllocationDrawer(props: Props) {
  // If only a transactionId is provided, fetch the data first.
  if ('transactionId' in props && props.transactionId) {
    return (
      <AllocationDrawerLoader
        transactionId={props.transactionId}
        onClose={props.onClose}
        onSaved={props.onSaved}
      />
    );
  }
  return (
    <AllocationDrawerInner
      tx={(props as PropsWithData).tx}
      allTenants={(props as PropsWithData).allTenants}
      onClose={props.onClose}
      onSaved={props.onSaved}
    />
  );
}

function AllocationDrawerLoader({
  transactionId,
  onClose,
  onSaved,
}: {
  transactionId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<{ tx: ReviewTransaction; allTenants: MatchSuggestion[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await statementsAPI.getTransactionReviewForm(transactionId);
        if (!cancelled) setData({ tx: res.tx, allTenants: res.all_tenants });
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message || 'שגיאה בטעינה');
      }
    })();
    return () => { cancelled = true; };
  }, [transactionId]);

  if (loadError) {
    return (
      <Modal open onClose={onClose} variant="drawer" srTitle="הגדרת הקצאה" hideClose className="flex flex-col items-center justify-center p-6">
          <p className="text-danger-600 mb-4">{loadError}</p>
          <button onClick={onClose} className="px-4 py-2 bg-ink-200 rounded">סגור</button>
      </Modal>
    );
  }

  if (!data) {
    return (
      <Modal open onClose={onClose} variant="drawer" srTitle="הגדרת הקצאה" hideClose className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700" />
      </Modal>
    );
  }

  return (
    <AllocationDrawerInner
      tx={data.tx}
      allTenants={data.allTenants}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function AllocationDrawerInner({
  tx,
  allTenants,
  onClose,
  onSaved,
}: {
  tx: ReviewTransaction;
  allTenants: MatchSuggestion[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const headline = tx.credit_amount ?? tx.debit_amount ?? 0;
  const { month: nowMonth, year: nowYear } = currentYearMonth();

  const [mode, setMode] = useState<AllocationMode>('split');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Split mode state ──
  const [splitRows, setSplitRows] = useState<SplitRow[]>([
    { tenant_id: '', amount: String(headline), period_month: nowMonth, period_year: nowYear },
  ]);

  // ── Multi-month mode state ──
  const [mmTenantId, setMmTenantId] = useState('');
  const [mmRows, setMmRows] = useState<MultiMonthRow[]>([
    { period_month: nowMonth, period_year: nowYear, amount: String(headline) },
  ]);

  // ── Non-tenant mode state ──
  const [ntLabel, setNtLabel] = useState('');
  const [ntAmount, setNtAmount] = useState(String(headline));

  // ── Matrix mode state ──
  // Cell key format: `${tenant_id}|${YYYY-MM}` → amount string.
  const [matrixTenants, setMatrixTenants] = useState<string[]>([]);
  const [matrixMonths, setMatrixMonths] = useState<string[]>([]); // YYYY-MM values
  const [matrixCells, setMatrixCells] = useState<Record<string, string>>({});

  function matrixCellKey(tenantId: string, monthValue: string): string {
    return `${tenantId}|${monthValue}`;
  }
  function setMatrixCell(tenantId: string, monthValue: string, amount: string) {
    const key = matrixCellKey(tenantId, monthValue);
    setMatrixCells(prev => ({ ...prev, [key]: amount }));
  }
  function getMatrixCell(tenantId: string, monthValue: string): string {
    return matrixCells[matrixCellKey(tenantId, monthValue)] ?? '';
  }

  // Pre-fill from existing allocations if any
  useEffect(() => {
    const existing = tx.allocations;
    if (!existing || existing.length === 0) return;

    const tenantRows = existing.filter(a => a.tenant_id);
    const labelRows = existing.filter(a => !a.tenant_id && a.label);

    if (labelRows.length > 0 && tenantRows.length === 0) {
      setMode('non_tenant');
      setNtLabel(labelRows[0].label ?? '');
      setNtAmount(String(labelRows[0].amount));
    } else if (tenantRows.length > 0) {
      const tenantIds = new Set(tenantRows.map(r => r.tenant_id));
      const periods = new Set(
        tenantRows
          .filter(r => r.period_year && r.period_month)
          .map(r => `${r.period_year}-${String(r.period_month).padStart(2, '0')}`),
      );
      if (tenantIds.size === 1) {
        const tid = [...tenantIds][0]!;
        if (periods.size > 1) {
          // Same tenant, multiple periods → multi-month
          setMode('multi_month');
          setMmTenantId(tid);
          setMmRows(tenantRows.map(r => ({
            period_month: String(r.period_month ?? nowMonth).padStart(2, '0'),
            period_year: String(r.period_year ?? nowYear),
            amount: String(r.amount),
          })));
          return;
        }
      } else if (tenantIds.size > 1 && periods.size > 1) {
        // Multiple tenants × multiple periods → matrix
        setMode('matrix');
        const tenantsArr: string[] = [];
        const monthsSet = new Set<string>();
        const cells: Record<string, string> = {};
        for (const r of tenantRows) {
          if (!r.tenant_id || !r.period_year || !r.period_month) continue;
          const monthValue = `${r.period_year}-${String(r.period_month).padStart(2, '0')}`;
          if (!tenantsArr.includes(r.tenant_id)) tenantsArr.push(r.tenant_id);
          monthsSet.add(monthValue);
          cells[`${r.tenant_id}|${monthValue}`] = String(r.amount);
        }
        setMatrixTenants(tenantsArr);
        setMatrixMonths([...monthsSet].sort());
        setMatrixCells(cells);
        return;
      }
      // Multiple tenants or single tenant single period → split
      setMode('split');
      setSplitRows(tenantRows.map(r => ({
        tenant_id: r.tenant_id ?? '',
        amount: String(r.amount),
        period_month: String(r.period_month ?? nowMonth).padStart(2, '0'),
        period_year: String(r.period_year ?? nowYear),
      })));
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sum helpers ──

  function splitSum(): number {
    return splitRows.reduce((acc, r) => acc + (parseFloat(r.amount) || 0), 0);
  }

  function mmSum(): number {
    return mmRows.reduce((acc, r) => acc + (parseFloat(r.amount) || 0), 0);
  }

  function ntSum(): number {
    return parseFloat(ntAmount) || 0;
  }

  function matrixTotalAllocated(): number {
    let sum = 0;
    for (const t of matrixTenants) {
      for (const m of matrixMonths) {
        const amt = parseFloat(getMatrixCell(t, m));
        if (Number.isFinite(amt)) sum += amt;
      }
    }
    return sum;
  }

  function currentSum(): number {
    if (mode === 'split') return splitSum();
    if (mode === 'multi_month') return mmSum();
    if (mode === 'matrix') return matrixTotalAllocated();
    return ntSum();
  }

  const sumOk = Math.abs(currentSum() - headline) <= 0.01;

  // ── Build payload ──

  function buildPayload(): AllocationItem[] {
    if (mode === 'split') {
      return splitRows.map(r => ({
        tenant_id: r.tenant_id || undefined,
        amount: parseFloat(r.amount),
        period_month: parseInt(r.period_month) || undefined,
        period_year: parseInt(r.period_year) || undefined,
      }));
    }
    if (mode === 'multi_month') {
      return mmRows.map(r => ({
        tenant_id: mmTenantId || undefined,
        amount: parseFloat(r.amount),
        period_month: parseInt(r.period_month) || undefined,
        period_year: parseInt(r.period_year) || undefined,
      }));
    }
    if (mode === 'matrix') {
      const items: AllocationItem[] = [];
      for (const tenantId of matrixTenants) {
        for (const monthValue of matrixMonths) {
          const amt = parseFloat(getMatrixCell(tenantId, monthValue));
          if (!Number.isFinite(amt) || amt <= 0) continue;
          const [yearStr, monthStr] = monthValue.split('-');
          items.push({
            tenant_id: tenantId,
            amount: amt,
            period_year: parseInt(yearStr),
            period_month: parseInt(monthStr),
          });
        }
      }
      return items;
    }
    // non_tenant
    return [{
      label: ntLabel,
      amount: parseFloat(ntAmount),
    }];
  }

  const canSave =
    sumOk &&
    !busy &&
    (mode === 'split'
      ? splitRows.every(r => r.tenant_id && parseFloat(r.amount) > 0)
      : mode === 'multi_month'
      ? mmTenantId && mmRows.every(r => parseFloat(r.amount) > 0)
      : mode === 'matrix'
      ? matrixTenants.length > 0 && matrixMonths.length > 0 && matrixTotalAllocated() > 0
      : ntLabel.trim() && parseFloat(ntAmount) > 0);

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await statementsAPI.setAllocations(tx.id, { allocations: buildPayload() });
      // Show inline confirmation INSIDE the drawer before closing, so the user
      // gets clear acknowledgement that the save was registered.
      setSaved(true);
      setBusy(false);
      setTimeout(() => {
        onSaved();
      }, 750);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  // ── Split row helpers ──

  const addSplitRow = () =>
    setSplitRows(prev => [...prev, { tenant_id: '', amount: '', period_month: nowMonth, period_year: nowYear }]);

  const removeSplitRow = (i: number) =>
    setSplitRows(prev => prev.filter((_, idx) => idx !== i));

  const updateSplitRow = (i: number, field: keyof SplitRow, val: string) =>
    setSplitRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));

  // ── Multi-month row helpers ──

  const addMmRow = () =>
    setMmRows(prev => [...prev, { period_month: nowMonth, period_year: nowYear, amount: '' }]);

  const removeMmRow = (i: number) =>
    setMmRows(prev => prev.filter((_, idx) => idx !== i));

  const updateMmRow = (i: number, field: keyof MultiMonthRow, val: string) =>
    setMmRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));

  // ── Preset handlers ──

  // Distribute headline evenly across existing split rows. Floor each to 2 decimals,
  // assign any leftover cents to row 0 to keep the sum exact.
  const distributeEvenly = () => {
    const n = splitRows.length;
    if (n === 0 || headline <= 0) return;
    const per = Math.floor((headline / n) * 100) / 100;
    const remainder = Math.round((headline - per * n) * 100) / 100;
    setSplitRows(prev => prev.map((r, idx) => ({
      ...r,
      amount: (idx === 0 ? (per + remainder) : per).toFixed(2),
    })));
  };

  // Replace split rows with one row per active tenant, evenly divided.
  const fillAllActiveTenants = () => {
    const n = allTenants.length;
    if (n === 0) return;
    const per = headline > 0 ? Math.floor((headline / n) * 100) / 100 : 0;
    const remainder = headline > 0 ? Math.round((headline - per * n) * 100) / 100 : 0;
    setSplitRows(allTenants.map((t, idx) => ({
      tenant_id: t.tenant_id,
      amount: (idx === 0 ? (per + remainder) : per).toFixed(2),
      period_month: nowMonth,
      period_year: nowYear,
    })));
  };

  // Replace multi-month rows with the current month and the 3 prior months,
  // each row given headline/4.
  const fillBackwards = () => {
    const per = headline > 0 ? Math.floor((headline / 4) * 100) / 100 : 0;
    const remainder = headline > 0 ? Math.round((headline - per * 4) * 100) / 100 : 0;
    const now = new Date();
    const rows: MultiMonthRow[] = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      rows.push({
        period_month: String(d.getMonth() + 1).padStart(2, '0'),
        period_year: String(d.getFullYear()),
        amount: (i === 0 ? (per + remainder) : per).toFixed(2),
      });
    }
    setMmRows(rows);
  };

  // ── Remainder bar ──

  const allocated = currentSum();
  const remainder = headline - allocated;
  const pct = headline > 0 ? Math.min(100, (allocated / headline) * 100) : 0;
  const isBalanced = Math.abs(remainder) < 0.01;

  function addRemainderToFirstRow() {
    if (mode === 'split') {
      setSplitRows(prev => {
        if (prev.length === 0) return prev;
        const first = prev[0];
        const newAmt = (parseFloat(first.amount) || 0) + remainder;
        return [
          { ...first, amount: newAmt.toFixed(2) },
          ...prev.slice(1),
        ];
      });
    } else if (mode === 'multi_month') {
      setMmRows(prev => {
        if (prev.length === 0) return prev;
        const first = prev[0];
        const newAmt = (parseFloat(first.amount) || 0) + remainder;
        return [
          { ...first, amount: newAmt.toFixed(2) },
          ...prev.slice(1),
        ];
      });
    }
  }

  return (
    <Modal open onClose={onClose} variant="drawer" srTitle="הגדרת הקצאה" hideClose className="flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-l from-primary-700 to-primary-800 px-5 py-4 flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-bold text-base">הגדרת הקצאה</h3>
            <p className="text-primary-200 text-sm truncate mt-0.5">
              {tx.payer_name || '—'} · {formatAmount(headline)}
            </p>
            <div className="mt-0.5">
              <DescriptionCell
                extended={tx.extended_description}
                short={tx.description}
                compact
                onDark
              />
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white text-xl leading-none hover:text-primary-200 transition-colors mr-3 mt-0.5 flex-shrink-0"
            aria-label="סגור"
          >
            ×
          </button>
        </div>

        {/* Mode selector */}
        <div className="px-5 py-3 border-b border-ink-200 bg-ink-50">
          <p className="text-xs text-ink-500 mb-2">סוג הקצאה</p>
          <div className="flex gap-1 flex-wrap">
            {([
              ['split', 'פיצול לדיירים'],
              ['multi_month', 'ריבוי חודשים'],
              ['non_tenant', 'הכנסה אחרת'],
              ['matrix', '🧩 מתקדם'],
            ] as [AllocationMode, string][]).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                  mode === m
                    ? 'bg-primary-700 text-white'
                    : 'bg-white text-ink-700 border border-ink-300 hover:bg-ink-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

          {/* ── Split mode ── */}
          {mode === 'split' && (
            <>
              <div className="bg-primary-50/40 border border-primary-100 rounded-md px-3 py-2 flex items-center gap-2 text-xs flex-wrap">
                <span className="text-ink-500">קיצור:</span>
                <button
                  type="button"
                  onClick={distributeEvenly}
                  className="px-2 py-1 rounded bg-white border border-primary-200 text-primary-700 hover:bg-primary-100"
                >
                  חלק שווה
                </button>
                <button
                  type="button"
                  onClick={fillAllActiveTenants}
                  className="px-2 py-1 rounded bg-white border border-primary-200 text-primary-700 hover:bg-primary-100"
                >
                  לכל הדיירים
                </button>
              </div>
              <div className="grid grid-cols-[1fr_6rem_8rem_1.5rem] gap-2 text-xs text-ink-500 font-medium pb-1">
                <span>דייר</span>
                <span>סכום</span>
                <span>תקופה</span>
                <span />
              </div>
              {splitRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_6rem_8rem_1.5rem] gap-2 items-center">
                  <select
                    value={row.tenant_id}
                    onChange={e => updateSplitRow(i, 'tenant_id', e.target.value)}
                    className="border border-ink-300 rounded px-2 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="">בחר דייר</option>
                    {allTenants.map(t => (
                      <option key={t.tenant_id} value={t.tenant_id}>{t.tenant_name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.amount}
                    onChange={e => updateSplitRow(i, 'amount', e.target.value)}
                    placeholder="סכום"
                    className="border border-ink-300 rounded px-2 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                  <select
                    value={`${row.period_year}-${row.period_month.padStart(2, '0')}`}
                    onChange={e => {
                      const [y, m] = e.target.value.split('-');
                      updateSplitRow(i, 'period_month', m);
                      updateSplitRow(i, 'period_year', y);
                    }}
                    className="border border-ink-300 rounded px-2 py-1.5 text-sm w-full bg-white focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    {optionsForRow(row.period_year, row.period_month).map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeSplitRow(i)}
                    disabled={splitRows.length === 1}
                    className="text-ink-500 hover:text-danger-500 disabled:opacity-20 transition-colors"
                    title="הסר שורה"
                  >
                    <TrashSmIcon />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addSplitRow}
                className="flex items-center gap-1 text-primary-700 text-sm hover:text-primary-800 transition-colors"
              >
                <PlusIcon /> הוסף שורה
              </button>
            </>
          )}

          {/* ── Multi-month mode ── */}
          {mode === 'multi_month' && (
            <>
              <div>
                <label className="block text-xs text-ink-500 font-medium mb-1">דייר</label>
                <select
                  value={mmTenantId}
                  onChange={e => setMmTenantId(e.target.value)}
                  className="border border-ink-300 rounded px-2 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">בחר דייר</option>
                  {allTenants.map(t => (
                    <option key={t.tenant_id} value={t.tenant_id}>{t.tenant_name}</option>
                  ))}
                </select>
              </div>
              <div className="bg-primary-50/40 border border-primary-100 rounded-md px-3 py-2 flex items-center gap-2 text-xs flex-wrap mt-2">
                <span className="text-ink-500">קיצור:</span>
                <button
                  type="button"
                  onClick={fillBackwards}
                  className="px-2 py-1 rounded bg-white border border-primary-200 text-primary-700 hover:bg-primary-100"
                >
                  4 חודשים אחורה
                </button>
              </div>
              <div className="grid grid-cols-[8rem_1fr_1.5rem] gap-2 text-xs text-ink-500 font-medium pb-1 mt-2">
                <span>חודש / שנה</span>
                <span>סכום</span>
                <span />
              </div>
              {mmRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[8rem_1fr_1.5rem] gap-2 items-center">
                  <select
                    value={`${row.period_year}-${row.period_month.padStart(2, '0')}`}
                    onChange={e => {
                      const [y, m] = e.target.value.split('-');
                      updateMmRow(i, 'period_month', m);
                      updateMmRow(i, 'period_year', y);
                    }}
                    className="border border-ink-300 rounded px-2 py-1.5 text-sm w-full bg-white focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    {optionsForRow(row.period_year, row.period_month).map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.amount}
                    onChange={e => updateMmRow(i, 'amount', e.target.value)}
                    placeholder="סכום"
                    className="border border-ink-300 rounded px-2 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                  <button
                    type="button"
                    onClick={() => removeMmRow(i)}
                    disabled={mmRows.length === 1}
                    className="text-ink-500 hover:text-danger-500 disabled:opacity-20 transition-colors"
                    title="הסר שורה"
                  >
                    <TrashSmIcon />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addMmRow}
                className="flex items-center gap-1 text-primary-700 text-sm hover:text-primary-800 transition-colors"
              >
                <PlusIcon /> הוסף חודש
              </button>
            </>
          )}

          {/* ── Matrix mode ── */}
          {mode === 'matrix' && (
            <div className="space-y-3">
              {/* Tenant + month picker controls */}
              <div className="bg-primary-50/40 border border-primary-100 rounded-md px-3 py-2 space-y-2">
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <span className="text-ink-500 w-12 shrink-0">דיירים:</span>
                  <select
                    className="flex-1 border border-ink-300 rounded px-2 py-1.5 text-sm bg-white"
                    value=""
                    onChange={e => {
                      const id = e.target.value;
                      if (id && !matrixTenants.includes(id)) {
                        setMatrixTenants([...matrixTenants, id]);
                      }
                    }}
                  >
                    <option value="">+ הוסף דייר...</option>
                    {allTenants
                      .filter(t => !matrixTenants.includes(t.tenant_id))
                      .map(t => (
                        <option key={t.tenant_id} value={t.tenant_id}>{t.tenant_name}</option>
                      ))}
                  </select>
                </div>
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <span className="text-ink-500 w-12 shrink-0">חודשים:</span>
                  <select
                    className="flex-1 border border-ink-300 rounded px-2 py-1.5 text-sm bg-white"
                    value=""
                    onChange={e => {
                      const v = e.target.value;
                      if (v && !matrixMonths.includes(v)) {
                        setMatrixMonths([...matrixMonths, v].sort());
                      }
                    }}
                  >
                    <option value="">+ הוסף חודש...</option>
                    {MONTH_OPTIONS
                      .filter(o => !matrixMonths.includes(o.value))
                      .map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Matrix grid */}
              {matrixTenants.length > 0 && matrixMonths.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className="text-right py-2 pr-2 pl-3 text-xs text-ink-500 font-medium bg-ink-50 sticky top-0 right-0 z-20">
                          דייר
                        </th>
                        {matrixMonths.map(mVal => {
                          const opt = MONTH_OPTIONS.find(o => o.value === mVal);
                          return (
                            <th key={mVal} className="text-center py-2 px-2 text-xs text-ink-500 font-medium border-b border-ink-200 sticky top-0 z-10 bg-ink-50">
                              <div className="flex items-center justify-center gap-1">
                                <span>{opt?.label ?? mVal}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMatrixMonths(matrixMonths.filter(m => m !== mVal));
                                    setMatrixCells(prev => {
                                      const next = { ...prev };
                                      matrixTenants.forEach(t => delete next[matrixCellKey(t, mVal)]);
                                      return next;
                                    });
                                  }}
                                  className="text-ink-300 hover:text-danger-500"
                                  aria-label="הסר חודש"
                                >
                                  ×
                                </button>
                              </div>
                            </th>
                          );
                        })}
                        <th className="text-center py-2 px-2 text-xs text-ink-500 font-medium bg-ink-50 border-b sticky top-0 z-10">סה"כ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrixTenants.map(tId => {
                        const tenant = allTenants.find(t => t.tenant_id === tId);
                        const rowSum = matrixMonths.reduce(
                          (s, m) => s + (parseFloat(getMatrixCell(tId, m)) || 0),
                          0,
                        );
                        return (
                          <tr key={tId} className="border-b border-ink-100">
                            <td className="py-2 pr-2 pl-3 font-medium text-ink-900 sticky right-0 bg-white z-10">
                              <div className="flex items-center justify-between gap-2">
                                <span>{tenant?.tenant_name ?? tId}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMatrixTenants(matrixTenants.filter(x => x !== tId));
                                    setMatrixCells(prev => {
                                      const next = { ...prev };
                                      matrixMonths.forEach(m => delete next[matrixCellKey(tId, m)]);
                                      return next;
                                    });
                                  }}
                                  className="text-ink-300 hover:text-danger-500"
                                  aria-label="הסר דייר"
                                >
                                  ×
                                </button>
                              </div>
                            </td>
                            {matrixMonths.map(mVal => (
                              <td key={mVal} className="text-center px-1">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={getMatrixCell(tId, mVal)}
                                  onChange={e => setMatrixCell(tId, mVal, e.target.value)}
                                  placeholder="0"
                                  className="border border-ink-300 rounded px-2 py-1 text-sm w-20 text-center focus:outline-none focus:ring-1 focus:ring-primary-500"
                                />
                              </td>
                            ))}
                            <td className="text-center font-semibold text-accent-700 bg-ink-50">
                              ₪{rowSum.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Column totals row */}
                      <tr className="bg-ink-50 font-semibold border-t border-ink-300">
                        <td className="sticky right-0 z-10 bg-ink-50 py-2 pr-2 pl-3 text-ink-700">סה"כ עמודה</td>
                        {matrixMonths.map(mVal => {
                          const colSum = matrixTenants.reduce(
                            (s, t) => s + (parseFloat(getMatrixCell(t, mVal)) || 0),
                            0,
                          );
                          return (
                            <td key={mVal} className="text-center text-ink-700">
                              ₪{colSum.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          );
                        })}
                        <td className="text-center text-accent-700">
                          ₪{matrixTotalAllocated().toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {(() => {
                    const nonZero = matrixTenants.reduce((count, t) => {
                      return count + matrixMonths.filter(m => (parseFloat(getMatrixCell(t, m)) || 0) > 0).length;
                    }, 0);
                    if (nonZero > 0) {
                      return (
                        <p className="text-xs text-ink-500 mt-2">
                          ייווצרו {nonZero} הקצאות (תאים שאינם 0).
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>
              ) : (
                <div className="text-center text-sm text-ink-500 py-8 bg-ink-50 rounded-md">
                  הוסף דיירים וחודשים כדי לבנות את המטריצה.
                </div>
              )}
            </div>
          )}

          {/* ── Non-tenant mode ── */}
          {mode === 'non_tenant' && (
            <>
              <div>
                <label className="block text-xs text-ink-500 font-medium mb-1">תיאור</label>
                <input
                  type="text"
                  value={ntLabel}
                  onChange={e => setNtLabel(e.target.value)}
                  placeholder="לדוגמה: החזר ביטוח"
                  className="border border-ink-300 rounded px-3 py-2 text-sm w-full focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-500 font-medium mb-1">סכום</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={ntAmount}
                  onChange={e => setNtAmount(e.target.value)}
                  className="border border-ink-300 rounded px-3 py-2 text-sm w-full focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
            </>
          )}
        </div>

        {/* Remainder bar (split + multi_month + matrix) */}
        {(mode === 'split' || mode === 'multi_month' || mode === 'matrix') && (
          <div className="px-5 py-3 border-t bg-ink-50">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="text-ink-700">חולק:</span>
              <span className={`font-semibold ${isBalanced ? 'text-accent-700' : remainder < -0.01 ? 'text-danger-600' : 'text-warn-600'}`}>
                ₪{allocated.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                {' / '}
                ₪{headline.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="h-2 bg-ink-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${isBalanced ? 'bg-accent-500' : remainder < -0.01 ? 'bg-danger-500' : 'bg-warn-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {!isBalanced && remainder > 0 && mode !== 'matrix' && (
              <button
                type="button"
                onClick={addRemainderToFirstRow}
                className="text-warn-600 text-xs font-medium hover:underline mt-1.5"
              >
                הוסף ₪{remainder.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} לשורה הראשונה ↑
              </button>
            )}
            {isBalanced && allocated > 0 && (
              <p className="text-xs text-accent-700 font-medium mt-1.5">✓ הסכום מאוזן</p>
            )}
            {remainder < -0.01 && (
              <p className="text-xs text-danger-600 font-medium mt-1.5">
                ⚠ חרגת מהסכום ב-₪{Math.abs(remainder).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-ink-200 px-5 py-4 bg-ink-50">
          {/* Non-tenant mode keeps the compact sum indicator */}
          {mode === 'non_tenant' && (
            <div className="text-sm mb-3">
              {sumOk
                ? <span className="text-accent-600 font-medium">✓ {formatAmount(currentSum())} / {formatAmount(headline)}</span>
                : <span className="text-danger-600 font-medium">⚠ {formatAmount(currentSum())} / {formatAmount(headline)} (חסרים {formatAmount(parseFloat((headline - currentSum()).toFixed(2)))})</span>}
            </div>
          )}

          {error && <p className="text-danger-600 text-xs mb-2">{error}</p>}

          {saved && (
            <div className="mb-3 bg-accent-50 border border-accent-300 rounded-lg px-3 py-2 text-accent-700 text-sm font-medium flex items-center gap-2">
              <span className="text-base">✓</span>
              <span>ההקצאה נשמרה</span>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saved}
              className="px-4 py-2 text-sm font-medium text-ink-700 bg-white border border-ink-300 hover:bg-ink-100 rounded-lg transition-colors disabled:opacity-50"
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || busy || saved}
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
                saved
                  ? 'bg-accent-600'
                  : 'bg-primary-700 hover:bg-primary-700 disabled:bg-primary-300'
              }`}
            >
              {saved ? '✓ נשמר!' : busy ? 'שומר...' : 'שמור הקצאה ✓'}
            </button>
          </div>
        </div>
    </Modal>
  );
}
