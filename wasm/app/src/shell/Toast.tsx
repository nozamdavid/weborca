import React from 'react';
import { useToastStore, type ToastItem } from './toastStore';
import { useTranslation } from "../i18n";

export const ToastContainer: React.FC = () => {
    const { t } = useTranslation();
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" id="toast-container" role="region" aria-label={t("Notifications")}>
      {toasts.map((toast: ToastItem) => (
        <div
          key={toast.id}
          className={`toast-item toast-${toast.type}`}
          role="status"
          aria-live="polite"
          onClick={() => removeToast(toast.id)}
        >
          <span className="toast-icon">
            {toast.type === 'success' && '✓'}
            {toast.type === 'error' && '⚠'}
            {toast.type === 'info' && 'ℹ'}
          </span>
          <span className="toast-message">{toast.message}</span>
        </div>
      ))}
    </div>
  );
};
