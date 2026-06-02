import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface ToastSpec {
  id: string;
  title: string;
  subtitle?: string;
  variant?: 'success' | 'error' | 'info';
  undo?: () => Promise<void> | void;
  durationMs?: number;
}

interface ToastContextValue {
  toasts: ToastSpec[];
  showToast: (spec: Omit<ToastSpec, 'id'>) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastSpec[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts(s => s.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback(
    (spec: Omit<ToastSpec, 'id'>) => {
      const id = Math.random().toString(36).slice(2);
      const duration = spec.durationMs ?? 6000;
      setToasts(s => [...s, { ...spec, id }]);
      if (duration > 0) {
        const timerId = setTimeout(() => {
          timersRef.current.delete(id);
          setToasts(s => s.filter(t => t.id !== id));
        }, duration);
        timersRef.current.set(id, timerId);
      }
      return id;
    },
    []
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
