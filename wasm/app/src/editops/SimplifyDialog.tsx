import React from 'react';
import { useEditOpsStore } from './editOpsStore';
import { ModalBackdrop } from '../components/ModalBackdrop';

export const SimplifyDialog: React.FC = () => {
  const activeDialog = useEditOpsStore((s) => s.activeDialog);
  const simplifyMethod = useEditOpsStore((s) => s.simplifyMethod);
  const simplifyRatio = useEditOpsStore((s) => s.simplifyRatio);
  const simplifyTargetCount = useEditOpsStore((s) => s.simplifyTargetCount);
  const simplifyKeepPainting = useEditOpsStore((s) => s.simplifyKeepPainting);
  const currentTriangleCount = useEditOpsStore((s) => s.currentTriangleCount);
  const isOperating = useEditOpsStore((s) => s.isOperating);
  const error = useEditOpsStore((s) => s.error);

  const setSimplifyMethod = useEditOpsStore((s) => s.setSimplifyMethod);
  const setSimplifyRatio = useEditOpsStore((s) => s.setSimplifyRatio);
  const setSimplifyTargetCount = useEditOpsStore((s) => s.setSimplifyTargetCount);
  const setSimplifyKeepPainting = useEditOpsStore((s) => s.setSimplifyKeepPainting);
  const applySimplify = useEditOpsStore((s) => s.applySimplify);
  const closeSimplifyDialog = useEditOpsStore((s) => s.closeSimplifyDialog);

  if (activeDialog !== 'simplify') return null;

  return (
    <ModalBackdrop onClose={closeSimplifyDialog} role="dialog" aria-label="Simplify Mesh">
      <div
        className="modal-content"
        id="simplify-dialog"
        data-testid="simplify-dialog"
        style={{ width: 'min(450px, 92vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Simplify Mesh</h2>
          <button className="icon-btn" onClick={closeSimplifyDialog} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {error && <div className="error-message" style={{ color: 'var(--danger-color)', fontSize: 12 }}>{error}</div>}

          <div style={{ padding: '8px 12px', background: 'var(--control-bg)', borderRadius: 4 }}>
            <span style={{ color: 'var(--text-muted)' }}>Current Triangles: </span>
            <strong id="simplify-current-count">{currentTriangleCount}</strong>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Simplification Method</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="simplify-method"
                  value="ratio"
                  checked={simplifyMethod === 'ratio'}
                  onChange={() => setSimplifyMethod('ratio')}
                />
                <span>Ratio (% of original triangles)</span>
              </label>

              {simplifyMethod === 'ratio' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 24 }}>
                  <input
                    type="range"
                    min="0.05"
                    max="0.95"
                    step="0.05"
                    value={simplifyRatio}
                    onChange={(e) => setSimplifyRatio(parseFloat(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="number"
                    aria-label="Ratio"
                    id="simplify-ratio-input"
                    data-testid="simplify-ratio-input"
                    min="5"
                    max="95"
                    value={Math.round(simplifyRatio * 100)}
                    onChange={(e) => setSimplifyRatio(Math.max(0.05, Math.min(0.95, parseInt(e.target.value, 10) / 100)))}
                    style={{ width: 60, padding: '4px 6px' }}
                  />
                  <span>%</span>
                </div>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="simplify-method"
                  value="target"
                  checked={simplifyMethod === 'target'}
                  onChange={() => setSimplifyMethod('target')}
                />
                <span>Target Triangle Count</span>
              </label>

              {simplifyMethod === 'target' && (
                <div style={{ marginLeft: 24 }}>
                  <input
                    type="number"
                    aria-label="Target Triangles"
                    id="simplify-target-input"
                    data-testid="simplify-target-input"
                    min="4"
                    max={currentTriangleCount > 0 ? currentTriangleCount : 1000000}
                    value={simplifyTargetCount}
                    onChange={(e) => setSimplifyTargetCount(Math.max(4, parseInt(e.target.value, 10) || 4))}
                    style={{ width: 120, padding: '4px 6px' }}
                  />
                </div>
              )}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 6 }}>
            <input
              type="checkbox"
              checked={simplifyKeepPainting}
              onChange={(e) => setSimplifyKeepPainting(e.target.checked)}
            />
            <span>Preserve multi-material & support painting</span>
          </label>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={closeSimplifyDialog} disabled={isOperating}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            id="simplify-apply-btn"
            data-testid="simplify-apply-btn"
            onClick={() => void applySimplify()}
            disabled={isOperating}
          >
            {isOperating ? 'Simplifying...' : 'Simplify'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
};
