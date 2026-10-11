import React from 'react';
import { useAppStore } from '../store/appStore';
import { isNoRuleFix } from '../engine/ruleFixes';
import { ModalBackdrop } from '../components/ModalBackdrop';
import { useTranslation } from "../i18n";

export const FixesDialog: React.FC = () => {
    const { t } = useTranslation();
  const { pendingFixes, pendingFixReason, applyFixes, closeFixesDialog } = useAppStore();

  if (!pendingFixes || pendingFixes.length === 0) return null;

  return (
    <ModalBackdrop onClose={() => applyFixes('no')} data-testid="fixes-dialog">
      <div className="modal-box fixes-modal">
        <div className="modal-header">
          <div className="modal-title">{t("⚙️ Setting Conflict / Recommendation")}</div>
          <button
            type="button"
            className="modal-close-btn"
            data-testid="fix-close-btn"
            onClick={closeFixesDialog}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="fix-reason-text" data-testid="fix-reason">
            {pendingFixReason || 'The engine proposes adjusting dependent settings:'}
          </p>

          <div className="proposed-fixes-list">
            <h4>{t("Proposed adjustments:")}</h4>
            <ul>
              {pendingFixes
                .filter((f) => !isNoRuleFix(f))
                .map((f) => (
                  <li key={f.key}>
                    <strong>{f.key}</strong>: <code>{f.value}</code>
                  </li>
                ))}
            </ul>
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="fix-no-btn"
            onClick={() => applyFixes('no')}
          >
            {t("No / Cancel")}</button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="fix-yes-btn"
            onClick={() => applyFixes('yes')}
          >
            {t("Yes / Apply")}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
};
