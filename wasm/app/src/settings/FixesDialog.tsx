import React from 'react';
import { useAppStore } from '../store/appStore';

export const FixesDialog: React.FC = () => {
  const { pendingFixes, pendingFixReason, applyFixes, closeFixesDialog } = useAppStore();

  if (!pendingFixes || pendingFixes.length === 0) return null;

  return (
    <div className="modal-backdrop" data-testid="fixes-dialog">
      <div className="modal-box fixes-modal">
        <div className="modal-header">
          <div className="modal-title">⚙️ Setting Conflict / Recommendation</div>
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
            <h4>Proposed adjustments:</h4>
            <ul>
              {pendingFixes
                .filter((f) => !f.reason.includes('[No:'))
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
            No / Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="fix-yes-btn"
            onClick={() => applyFixes('yes')}
          >
            Yes / Apply
          </button>
        </div>
      </div>
    </div>
  );
};
