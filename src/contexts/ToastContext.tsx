import React, {createContext, useCallback, useContext, useMemo, useState} from 'react';
import {AlertCircle, CheckCircle2, Info, X} from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({children}: {children: React.ReactNode}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-3), {id, kind, message}]);
      window.setTimeout(() => {
        dismiss(id);
      }, 3600);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast,
      success: (message: string) => showToast(message, 'success'),
      error: (message: string) => showToast(message, 'error'),
      info: (message: string) => showToast(message, 'info'),
    }),
    [showToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed top-20 right-3 sm:right-5 z-[60] flex flex-col gap-2 w-[calc(100vw-1.5rem)] max-w-sm pointer-events-none">
          {toasts.map((item) => {
            const tone =
              item.kind === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/95 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100'
                : item.kind === 'error'
                  ? 'bg-rose-50 dark:bg-rose-950/95 border-rose-300 dark:border-rose-700 text-rose-900 dark:text-rose-100'
                  : 'bg-white dark:bg-slate-900 border-cyan-300 dark:border-cyan-700 text-slate-900 dark:text-slate-100';

            const Icon =
              item.kind === 'success'
                ? CheckCircle2
                : item.kind === 'error'
                  ? AlertCircle
                  : Info;

            const iconColor =
              item.kind === 'success'
                ? 'text-emerald-600 dark:text-emerald-400'
                : item.kind === 'error'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-cyan-600 dark:text-cyan-400';

            return (
              <div
                key={item.id}
                role="status"
                className={`pointer-events-auto rounded-xl border-[1.5px] px-3.5 py-2.5 shadow-lg backdrop-blur-sm flex items-start gap-2.5 text-xs sm:text-sm font-medium transition-all ${tone}`}>
                <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} />
                <span className="flex-1 leading-snug">{item.message}</span>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  aria-label="Close notification"
                  className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 shrink-0 cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
