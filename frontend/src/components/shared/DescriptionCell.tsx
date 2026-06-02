interface Props {
  extended?: string | null;
  short: string;
  /** When true, single-line truncation for tight cells (matched table). */
  compact?: boolean;
  /** When true, swaps text colors for use on dark backgrounds (e.g. gradient headers). */
  onDark?: boolean;
}

export default function DescriptionCell({ extended, short, compact = false, onDark = false }: Props) {
  const main = extended || short;
  const subtitle = extended ? short : null;
  const mainClass = onDark
    ? extended
      ? 'font-semibold text-white'
      : 'text-primary-100'
    : extended
      ? 'font-semibold text-ink-900'
      : 'text-ink-700';
  const subtitleClass = onDark
    ? 'text-xs text-primary-200/80 mt-0.5 truncate'
    : 'text-xs text-ink-500 mt-0.5 truncate';
  return (
    <div className={compact ? 'min-w-0' : ''}>
      <div className={mainClass} title={main}>
        <span className={compact ? 'truncate block' : ''}>{main}</span>
      </div>
      {subtitle && (
        <div className={subtitleClass} title={subtitle}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
