import { useEffect, useState, type ReactNode } from 'react';

type ToastKind = 'success' | 'encourage' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

let _id = 0;

/**
 * Singleton toast manager. Call `toast.push(text, kind)` from anywhere;
 * the <ToastHost/> rendered once in App listens and shows dismissible toasts.
 */
const listeners = new Set<(t: ToastItem) => void>();

export const toast = {
  push(text: string, kind: ToastKind = 'info') {
    const item: ToastItem = { id: ++_id, kind, text };
    listeners.forEach((fn) => fn(item));
  },
};

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const fn = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, 3200);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const dismiss = (id: number) =>
    setItems((prev) => prev.filter((x) => x.id !== id));

  return (
    <div className="toast-host">
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          onClick={() => dismiss(t.id)}
          role="status"
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function withToast<T extends unknown[]>(
  fn: (...args: T) => Promise<unknown>,
  msg: string,
  kind: ToastKind = 'success',
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    await fn(...args);
    toast.push(msg, kind);
  };
}

// Re-export ReactNode type alias for convenience
export type { ReactNode };
