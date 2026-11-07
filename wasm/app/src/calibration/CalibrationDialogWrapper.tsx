import { useEffect, useId, useState, type ReactNode } from 'react';
import { Dialog } from '../components/Dialog';
import { useTranslation } from "../i18n";
import './CalibrationDialogs.css';

/** Field associations stay local to calibration's existing validation branches. */
export function useCalibrationError() {
  const id = useId();
  const [issue, setIssue] = useState<{ message: string; fields: string[] } | null>(null);
  useEffect(() => {
    if (issue?.fields[0]) document.getElementById(`${id}-${issue.fields[0]}`)?.focus();
  }, [id, issue]);
  return {
    error: issue?.message ?? null,
    errorId: `${id}-error`,
    setError: (message: string | null, fields: string[] = []) => setIssue(message ? { message, fields } : null),
    clearError: () => setIssue(null),
    field: (name: string, unitId?: string) => ({
      id: `${id}-${name}`,
      'aria-invalid': issue?.fields.includes(name) || undefined,
      'aria-describedby': [issue?.fields.includes(name) ? `${id}-error` : '', unitId].filter(Boolean).join(' ') || undefined
    })
  };
}

/** Shared frame of the calibration dialogs. */
export function CalibrationDialogWrapper({ title, onClose, onOk, children, error, errorId, onEdit, isLoading }: {
  title: string;
  onClose: () => void;
  onOk: () => void;
  children: ReactNode;
  error?: string | null;
  errorId?: string;
  onEdit?: () => void;
  isLoading?: boolean;
}) {
    const { t } = useTranslation();
  return (
    <Dialog onClose={() => { if (!isLoading) onClose(); }}>
      <div className="modal-content ds-dialog calibration-dialog">
        <div className="modal-header ds-dialog__head">
          <h2>{title}</h2>
          <button className="close-btn" aria-label={t("Close Calibration dialog")} onClick={onClose} disabled={isLoading}>×</button>
        </div>
        <div className="modal-body ds-dialog__body" onChangeCapture={onEdit}>
          {children}
          {error && <div id={errorId} role="alert" className="error-message">{error}</div>}
        </div>
        <div className="modal-footer ds-dialog__foot">
          <button className="ds-btn" onClick={onClose} disabled={isLoading}>{t("Cancel")}</button>
          <button className="ds-btn ds-btn--primary" onClick={onOk} disabled={isLoading} aria-busy={isLoading || undefined}>
            {isLoading ? t('Loading...') : t('Generate Calibration Plate')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
