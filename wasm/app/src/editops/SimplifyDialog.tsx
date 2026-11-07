import React from 'react';
import { useEditOpsStore } from './editOpsStore';
import { Dialog } from '../components/Dialog';
import { useTranslation } from "../i18n";

export const SimplifyDialog: React.FC = () => {
    const { t } = useTranslation();
  const activeDialog = useEditOpsStore((s) => s.activeDialog);
  const simplifyMethod = useEditOpsStore((s) => s.simplifyMethod);
  const simplifyRatio = useEditOpsStore((s) => s.simplifyRatio);
  const simplifyTargetCount = useEditOpsStore((s) => s.simplifyTargetCount);
  const simplifyKeepPainting = useEditOpsStore((s) => s.simplifyKeepPainting);
  const currentTriangleCount = useEditOpsStore((s) => s.currentTriangleCount);
  const isOperating = useEditOpsStore((s) => s.isOperating);
  const error = useEditOpsStore((s) => s.error);
  const importedMeshes = useEditOpsStore((s) => s.importedMeshes);
  const objectId = useEditOpsStore((s) => s.simplifyObjectId);
  const volumeId = useEditOpsStore((s) => s.simplifyVolumeId);
  const chooseImportedMesh = useEditOpsStore((s) => s.chooseImportedMesh);
  const keepImportedMesh = useEditOpsStore((s) => s.keepImportedMesh);
  const importOffer = importedMeshes.length > 0;

  const setSimplifyMethod = useEditOpsStore((s) => s.setSimplifyMethod);
  const setSimplifyRatio = useEditOpsStore((s) => s.setSimplifyRatio);
  const setSimplifyTargetCount = useEditOpsStore((s) => s.setSimplifyTargetCount);
  const setSimplifyKeepPainting = useEditOpsStore((s) => s.setSimplifyKeepPainting);
  const applySimplify = useEditOpsStore((s) => s.applySimplify);
  const closeSimplifyDialog = useEditOpsStore((s) => s.closeSimplifyDialog);

  if (activeDialog !== 'simplify') return null;

  return (
    <Dialog onClose={closeSimplifyDialog} role="dialog" aria-label={t("Simplify Mesh")}>
      <div
        className="modal-content ds-dialog simplify-dialog"
        id="simplify-dialog"
        data-testid="simplify-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header ds-dialog__head">
          <h2>{t("Simplify Mesh")}</h2>
          <button className="icon-btn" onClick={closeSimplifyDialog} disabled={isOperating} aria-label={t("Close")}>✕</button>
        </div>

        <div className="modal-body ds-dialog__body">
          {importOffer && <>
            <p>{t("This imported mesh has many triangles. Reducing the polygon count can improve performance, but may remove fine detail. Keep the original or choose a simplification target below.")}</p>
            <label htmlFor="import-simplify-mesh">{t("Imported mesh")}</label>
            <select id="import-simplify-mesh" value={`${objectId}:${volumeId}`} disabled={isOperating}
              onChange={e => { const [object, volume] = e.target.value.split(':').map(Number); chooseImportedMesh(object, volume); }}>
              {importedMeshes.map(mesh => <option key={`${mesh.objectId}:${mesh.volumeId}`} value={`${mesh.objectId}:${mesh.volumeId}`}>
                {mesh.name} ({mesh.triangleCount.toLocaleString()})
              </option>)}
            </select>
          </>}
          {error && <div className="error-message" style={{ color: 'var(--danger-color)', fontSize: '0.75rem' }}>{error}</div>}

          <div style={{ padding: '8px 12px', background: 'var(--control-bg)', borderRadius: 4 }}>
            <span style={{ color: 'var(--text-muted)' }}>{t("Current Triangles:")}</span>
            <strong id="simplify-current-count">{currentTriangleCount}</strong>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>{t("Simplification Method")}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="simplify-method"
                  value="ratio"
                  checked={simplifyMethod === 'ratio'}
                  onChange={() => setSimplifyMethod('ratio')}
                />
                <span>{t("Ratio (% of original triangles)")}</span>
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
                    aria-label={t("Ratio")}
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
                <span>{t("Target Triangle Count")}</span>
              </label>

              {simplifyMethod === 'target' && (
                <div style={{ marginLeft: 24 }}>
                  <input
                    type="number"
                    aria-label={t("Target Triangles")}
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
            <span>{t("Preserve multi-material & support painting")}</span>
          </label>
          <p id="simplify-reduction-target">{t("Target triangles:")} {Math.round(simplifyMethod === 'ratio' ? currentTriangleCount * simplifyRatio : simplifyTargetCount).toLocaleString()}</p>
        </div>

        <div className="modal-footer ds-dialog__foot">
          <button id="simplify-keep-original" className="ds-btn" onClick={importOffer ? keepImportedMesh : closeSimplifyDialog} disabled={isOperating}>
            {t(importOffer ? "Keep original" : "Cancel")}</button>
          <button
            className="ds-btn ds-btn--primary"
            id="simplify-apply-btn"
            data-testid="simplify-apply-btn"
            onClick={() => void applySimplify()}
            disabled={isOperating}
          >
            {t(isOperating ? 'Simplifying...' : 'Simplify')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};
