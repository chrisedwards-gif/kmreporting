"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

export type ToastVariant = "success" | "error" | "warning" | "info";

type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  persistent?: boolean;
};

type ToastRecord = Required<Pick<ToastInput, "title" | "variant" | "persistent">> & {
  id: string;
  description?: string;
};

type ToastContextValue = {
  pushToast: (toast: ToastInput) => string;
  dismissToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const iconByVariant = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((input: ToastInput) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const toast: ToastRecord = {
      id,
      title: input.title,
      description: input.description,
      variant: input.variant ?? "info",
      persistent: input.persistent ?? input.variant === "error",
    };
    setToasts((current) => [...current.slice(-3), toast]);
    if (!toast.persistent) {
      timers.current.set(id, setTimeout(() => dismissToast(id), 4_500));
    }
    return id;
  }, [dismissToast]);

  const value = useMemo(() => ({ pushToast, dismissToast }), [dismissToast, pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-atomic="false" aria-live="polite" className="toast-viewport">
        {toasts.map((toast) => {
          const Icon = iconByVariant[toast.variant];
          return (
            <article className={`toast toast--${toast.variant}`} key={toast.id} role={toast.variant === "error" ? "alert" : "status"}>
              <Icon aria-hidden="true" className="toast__icon" size={19} />
              <div className="toast__copy">
                <strong>{toast.title}</strong>
                {toast.description ? <p>{toast.description}</p> : null}
              </div>
              <button aria-label="Dismiss notification" className="toast__dismiss" onClick={() => dismissToast(toast.id)} type="button"><X aria-hidden="true" size={16} /></button>
            </article>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider.");
  return context;
}
