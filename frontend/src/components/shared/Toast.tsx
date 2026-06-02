import { useToast } from '../../hooks/useToast';

export default function ToastContainer() {
  const { toasts, dismissToast } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed top-4 left-4 z-[70] flex flex-col gap-2 pointer-events-none"
      dir="rtl"
    >
      {toasts.map(t => {
        const variantClass =
          t.variant === 'error'
            ? 'border-danger-300 bg-danger-50'
            : t.variant === 'info'
            ? 'border-primary-300 bg-primary-50'
            : 'border-accent-300 bg-accent-50';
        const iconBg =
          t.variant === 'error'
            ? 'bg-danger-500'
            : t.variant === 'info'
            ? 'bg-primary-500'
            : 'bg-accent-500';
        const icon = t.variant === 'error' ? '✕' : t.variant === 'info' ? 'ℹ' : '✓';
        return (
          <div
            key={t.id}
            className={`pointer-events-auto bg-white border rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 max-w-md ${variantClass}`}
          >
            <span
              className={`w-7 h-7 rounded-full ${iconBg} text-white flex items-center justify-center font-bold flex-shrink-0`}
            >
              {icon}
            </span>
            <div className="text-sm flex-1 min-w-0">
              <div className="font-medium text-ink-900 truncate">{t.title}</div>
              {t.subtitle && (
                <div className="text-xs text-ink-500 truncate">{t.subtitle}</div>
              )}
            </div>
            {t.undo && (
              <button
                type="button"
                onClick={async () => {
                  await t.undo!();
                  dismissToast(t.id);
                }}
                className="text-xs text-primary-700 hover:text-primary-800 font-semibold mr-2 flex-shrink-0"
              >
                ↶ בטל
              </button>
            )}
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="text-ink-500 hover:text-ink-700 flex-shrink-0"
              aria-label="סגור"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
