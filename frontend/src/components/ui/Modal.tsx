import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '../../lib/cn';

const sizeClass = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
} as const;

interface ModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the user dismisses (Esc, outside click, or close button). */
  onClose: () => void;
  /**
   * Accessible name for the dialog (required by WCAG 4.1.2 / Radix).
   * Rendered visually-hidden — the modal keeps its own visible header markup,
   * so this avoids changing the design while still labelling the dialog.
   */
  srTitle: string;
  /** Max width. Default 'md'. */
  size?: keyof typeof sizeClass;
  /** Block Esc / outside-click dismissal (e.g. while a request is in flight). */
  preventClose?: boolean;
  /** Hide the built-in top-start close button (use when the modal renders its own). */
  hideClose?: boolean;
  /** Slide-in side panel instead of a centered card. */
  variant?: 'center' | 'drawer';
  /** Extra classes on the Radix Content (e.g. 'max-h-[90vh] overflow-y-auto'). */
  className?: string;
  children: React.ReactNode;
}

/**
 * Accessible modal shell built on Radix UI Dialog.
 * Provides focus trap, Esc-to-close, focus return to trigger, role="dialog",
 * and aria-modal for free. Recolor/layout of inner content is the caller's job;
 * this only owns the overlay, positioning, and dismissal behavior.
 */
export default function Modal({
  open,
  onClose,
  srTitle,
  size = 'md',
  preventClose = false,
  hideClose = false,
  variant = 'center',
  className,
  children,
}: ModalProps) {
  const guard = (e: Event) => {
    if (preventClose) e.preventDefault();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o && !preventClose) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          dir="rtl"
          aria-describedby={undefined}
          onEscapeKeyDown={guard}
          onPointerDownOutside={guard}
          onInteractOutside={guard}
          className={cn(
            'fixed z-50 bg-white shadow-2xl focus:outline-none',
            variant === 'drawer'
              ? 'top-0 bottom-0 h-full w-full max-w-md ltr:left-0 rtl:right-0'
              : cn(
                  'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] rounded-2xl overflow-hidden',
                  sizeClass[size],
                ),
            className,
          )}
        >
          {/* Visually-hidden accessible name (modal keeps its own visible header). */}
          <Dialog.Title className="sr-only">{srTitle}</Dialog.Title>

          {!hideClose && (
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="סגור חלון"
                className="absolute top-3 inset-inline-start-3 z-10 w-9 h-9 grid place-items-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </Dialog.Close>
          )}

          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
