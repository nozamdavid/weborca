import type { ReactNode } from 'react';
import { ModalBackdrop } from '../components/ModalBackdrop';
import { useTranslation } from "../i18n";

/** Shared frame of the calibration dialogs: title, body, error line and Cancel / OK. */
export function CalibrationDialogWrapper({ title, onClose, onOk, children, error, isLoading }: {
  title: string;
  onClose: () => void;
  onOk: () => void;
  children: ReactNode;
  error?: string | null;
  isLoading?: boolean;
}) {
    const { t } = useTranslation();
  return (
    <ModalBackdrop onClose={() => { if (!isLoading) onClose(); }} style={{ zIndex: 1000 }}>
      <div className="modal-content" style={{ maxWidth: '450px' }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="close-btn" onClick={onClose} disabled={isLoading}>×</button>
        </div>
        <div className="modal-body">
          {children}
          {error && <div className="error-message" style={{ color: 'red', marginTop: '10px', whiteSpace: 'pre-line' }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={isLoading}>{t("Cancel")}</button>
          <button className="btn btn-primary" onClick={onOk} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'OK'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
