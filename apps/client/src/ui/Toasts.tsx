import { useEffect } from 'react';
import { useStore, type Toast } from '../store';

const LIFETIME_MS = 4500;

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useStore((s) => s.dismissToast);
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), toast.kind === 'error' ? LIFETIME_MS + 1500 : LIFETIME_MS);
    return () => clearTimeout(t);
  }, [toast.id, toast.kind, dismiss]);
  return (
    <button type="button" className={`toast toast-${toast.kind}`} onClick={() => dismiss(toast.id)} title="Clique para fechar">
      {toast.text}
    </button>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
    </div>
  );
}
