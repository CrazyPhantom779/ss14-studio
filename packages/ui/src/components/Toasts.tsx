import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { ToastItem } from '../lib/host';

export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`studio-toast ${toast.level}`} key={toast.id}>
          <span className="toast-icon">
            {toast.level === 'success' ? (
              <CircleCheck size={16} aria-hidden />
            ) : toast.level === 'error' ? (
              <CircleAlert size={16} aria-hidden />
            ) : toast.level === 'warn' ? (
              <TriangleAlert size={16} aria-hidden />
            ) : (
              <Info size={16} aria-hidden />
            )}
          </span>
          <span className="toast-message">{toast.message}</span>
          <button type="button" className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
            <X size={12} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
