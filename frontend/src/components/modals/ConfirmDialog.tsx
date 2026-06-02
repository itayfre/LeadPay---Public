import * as Dialog from '@radix-ui/react-dialog';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  type?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
}

/**
 * Accessible confirmation dialog built on Radix UI Dialog.
 * Radix provides focus trap, Esc-to-close, focus return, role="dialog",
 * aria-modal, and aria-labelledby/aria-describedby (via Title/Description).
 * Prop interface is unchanged so existing callers keep working.
 */
export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'אישור',
  cancelText = 'ביטול',
  onConfirm,
  onCancel,
  type = 'danger',
  isLoading = false,
}: ConfirmDialogProps) {
  const colors = {
    danger: { bg: 'bg-danger-50', border: 'border-danger-50', icon: 'text-danger-600', button: 'bg-danger-600 hover:bg-danger-600' },
    warning: { bg: 'bg-warn-50', border: 'border-warn-50', icon: 'text-warn-600', button: 'bg-warn-600 hover:bg-warn-600' },
    info: { bg: 'bg-primary-50', border: 'border-primary-200', icon: 'text-primary-600', button: 'bg-primary-600 hover:bg-primary-700' },
  };
  const style = colors[type];

  const handleOpenChange = (open: boolean) => {
    if (!open && !isLoading) onCancel();
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black bg-opacity-50 z-50" />
        <Dialog.Content
          dir="rtl"
          onEscapeKeyDown={(e) => isLoading && e.preventDefault()}
          onPointerDownOutside={(e) => isLoading && e.preventDefault()}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden focus:outline-none"
        >
          <div className={`${style.bg} border-b-2 ${style.border} p-6`}>
            <div className="flex items-center gap-4">
              <div className={`flex-shrink-0 w-12 h-12 rounded-full ${style.bg} flex items-center justify-center`}>
                <svg className={`w-6 h-6 ${style.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <Dialog.Title className="text-xl font-bold text-ink-900">{title}</Dialog.Title>
              </div>
            </div>
          </div>
          <div className="p-6">
            <Dialog.Description className="text-ink-700 leading-relaxed">{message}</Dialog.Description>
          </div>
          <div className="bg-ink-50 px-6 py-4 flex gap-3 justify-end">
            <button onClick={onCancel} disabled={isLoading} className="px-6 py-2 border-2 border-ink-300 text-ink-700 font-semibold rounded-lg hover:bg-ink-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent">
              {cancelText}
            </button>
            <button onClick={onConfirm} disabled={isLoading} className={`px-6 py-2 ${style.button} text-white font-semibold rounded-lg transition-colors shadow-md disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2`}>
              {isLoading && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              {confirmText}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
