interface Props {
  current: number;
  legacy?: number;
  resolved?: number;
  variant: 'unmatched' | 'matched' | 'expenses';
}

export default function TabCount({ current, legacy = 0, resolved = 0, variant }: Props) {
  const currentClass = {
    unmatched: current > 0 ? 'bg-danger-50 text-danger-600' : 'bg-ink-100 text-ink-700',
    matched: 'bg-accent-100 text-accent-700',
    expenses: current > 0 ? 'bg-orange-100 text-orange-700' : 'bg-ink-100 text-ink-700',
  }[variant];
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${currentClass}`}>{current}</span>
      {legacy > 0 && (
        <>
          <span className="text-ink-300">·</span>
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-warn-50 text-warn-600"
            title="מהעלאות קודמות"
          >
            +{legacy}
          </span>
        </>
      )}
      {resolved > 0 && (
        <>
          <span className="text-ink-300">·</span>
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-700"
            title="נפתרו עכשיו"
          >
            ✓ {resolved}
          </span>
        </>
      )}
    </span>
  );
}
