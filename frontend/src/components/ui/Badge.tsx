import { cn } from '../../lib/cn';

export type BadgeTone = 'accent' | 'warn' | 'danger' | 'primary' | 'neutral';

interface Props {
  tone?: BadgeTone;
  /** Show the leading status dot (default true). */
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Token-driven status pill — replaces ad-hoc emoji badges (✅ ⏳) and raw
 * one-off color classes scattered across the screens. Same visual language
 * as the Buildings dashboard StatusBadge.
 */
const TONES: Record<BadgeTone, { text: string; bg: string; dot: string }> = {
  accent:  { text: 'text-accent-700',  bg: 'bg-accent-50',  dot: 'bg-accent-500' },
  warn:    { text: 'text-warn-600',    bg: 'bg-warn-50',    dot: 'bg-warn-500' },
  danger:  { text: 'text-danger-600',  bg: 'bg-danger-50',  dot: 'bg-danger-500' },
  primary: { text: 'text-primary-700', bg: 'bg-primary-50', dot: 'bg-primary-600' },
  neutral: { text: 'text-ink-700',     bg: 'bg-ink-100',    dot: 'bg-ink-400' },
};

export default function Badge({ tone = 'neutral', dot = true, children, className }: Props) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap',
        t.text, t.bg, className,
      )}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full', t.dot)} />}
      {children}
    </span>
  );
}
