import { useParams, useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo } from 'react';

export interface MonthYear {
  month: number; // 1-12
  year: number;
}

export interface DateRange {
  from: MonthYear;
  to: MonthYear;
}

function parseYYYYMM(s: string | null): MonthYear | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function toYYYYMM({ year, month }: MonthYear): string {
  return year + '-' + String(month).padStart(2, '0');
}

function monthDiff(from: MonthYear, to: MonthYear): number {
  return (to.year - from.year) * 12 + (to.month - from.month);
}

function addMonths(m: MonthYear, delta: number): MonthYear {
  const total = m.year * 12 + (m.month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function expandRange(from: MonthYear, to: MonthYear): MonthYear[] {
  const diff = monthDiff(from, to);
  if (diff < 0) return [];
  const result: MonthYear[] = [];
  let cur = { ...from };
  for (let i = 0; i <= Math.min(diff, 23); i++) {
    result.push({ ...cur });
    if (cur.month === 12) {
      cur = { month: 1, year: cur.year + 1 };
    } else {
      cur = { month: cur.month + 1, year: cur.year };
    }
  }
  return result;
}

const FILTER_TTL_MS = 60 * 60 * 1000; // 1 hour
const filterKey = (buildingId: string) => `lp:buildingFilter:${buildingId}`;

interface SavedFilter {
  from: string;
  to: string;
  savedAt: number;
}

function loadSavedRange(buildingId: string | undefined): DateRange | null {
  if (!buildingId) return null;
  try {
    const raw = localStorage.getItem(filterKey(buildingId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedFilter;
    if (!parsed.from || !parsed.to || !parsed.savedAt) return null;
    if (Date.now() - parsed.savedAt > FILTER_TTL_MS) return null;
    const from = parseYYYYMM(parsed.from);
    const to = parseYYYYMM(parsed.to);
    if (!from || !to) return null;
    return { from, to };
  } catch {
    return null;
  }
}

function saveRange(buildingId: string | undefined, range: DateRange) {
  if (!buildingId) return;
  try {
    const payload: SavedFilter = {
      from: toYYYYMM(range.from),
      to: toYYYYMM(range.to),
      savedAt: Date.now(),
    };
    localStorage.setItem(filterKey(buildingId), JSON.stringify(payload));
  } catch {
    // ignore quota errors
  }
}

export function useBuildingPeriodRange() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { buildingId } = useParams<{ buildingId: string }>();

  const now = new Date();
  const currentMonth: MonthYear = { month: now.getMonth() + 1, year: now.getFullYear() };

  // Default preset: last 3 months ending in current month
  const defaultRange: DateRange = {
    from: addMonths(currentMonth, -2),
    to: currentMonth,
  };

  const urlFrom = searchParams.get('from');
  const urlTo = searchParams.get('to');

  const range = useMemo((): DateRange => {
    const fromParam = parseYYYYMM(urlFrom);
    const toParam = parseYYYYMM(urlTo);

    if (fromParam && toParam) {
      const diff = monthDiff(fromParam, toParam);
      if (diff >= 0 && diff <= 23) {
        return { from: fromParam, to: toParam };
      }
    }

    const saved = loadSavedRange(buildingId);
    if (saved) return saved;

    return defaultRange;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlFrom, urlTo, buildingId]);

  // Persist the active range whenever it changes (covers URL-driven changes too).
  // Refreshes the savedAt timestamp so active browsing extends the 1-hour TTL.
  useEffect(() => {
    saveRange(buildingId, range);
  }, [buildingId, range]);

  const setRange = useCallback(
    (newRange: DateRange) => {
      saveRange(buildingId, newRange);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('from', toYYYYMM(newRange.from));
          next.set('to', toYYYYMM(newRange.to));
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams, buildingId]
  );

  const isSingleMonth =
    range.from.year === range.to.year && range.from.month === range.to.month;

  const months = useMemo(() => expandRange(range.from, range.to), [range]);

  return { range, setRange, isSingleMonth, months };
}
