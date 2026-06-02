import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/**
 * The single primary-action button for the whole app. Replaces the old split
 * between two different blues. Built on the ink/accent/danger token system.
 * Min height 40px (md) keeps touch targets accessible.
 */
const VARIANTS: Record<Variant, string> = {
  primary:   'bg-primary-600 text-white hover:bg-primary-700 focus-visible:ring-primary-500',
  secondary: 'bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-100 focus-visible:ring-primary-500',
  danger:    'bg-danger-600 text-white hover:bg-danger-500 focus-visible:ring-danger-500',
  ghost:     'text-ink-500 hover:bg-ink-100 hover:text-ink-900 focus-visible:ring-primary-500',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: Props) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}
