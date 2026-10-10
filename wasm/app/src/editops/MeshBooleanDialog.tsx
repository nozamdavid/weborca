import React from 'react';
import { useEditOpsStore } from './editOpsStore';
import { usePlateStore } from '../plate/plateStore';
import type { MeshBooleanMode } from './types';
import { ModalBackdrop } from '../components/ModalBackdrop';
import { useTranslation } from "../i18n";

export const MeshBooleanDialog: React.FC = () => {
    const { t } = useTranslation();
  const activeDialog = useEditOpsStore((s) => s.activeDialog);
  const booleanMode = useEditOpsStore((s) => s.booleanMode);
  const booleanTargetObjectId = useEditOpsStore((s) => s.booleanTargetObjectId);
  const booleanToolObjectIds = useEditOpsStore((s) => s.booleanToolObjectIds);
  const booleanKeepTools = useEditOpsStore((s) => s.booleanKeepTools);
  const isOperating = useEditOpsStore((s) => s.isOperating);
  const error = useEditOpsStore((s) => s.error);

  const setBooleanMode = useEditOpsStore((s) => s.setBooleanMode);
  const setBooleanTargetObjectId = useEditOpsStore((s) => s.setBooleanTargetObjectId);
  const toggleBooleanToolObjectId = useEditOpsStore((s) => s.toggleBooleanToolObjectId);
  const setBooleanKeepTools = useEditOpsStore((s) => s.setBooleanKeepTools);
  const applyMeshBoolean = useEditOpsStore((s) => s.applyMeshBoolean);
  const closeBooleanDialog = useEditOpsStore((s) => s.closeBooleanDialog);

  const objects = usePlateStore((s) => s.objects);

  if (activeDialog !== 'boolean') return null;

  const toolCandidates = objects.filter((o) => o.id !== booleanTargetObjectId);

  return (
    <ModalBackdrop onClose={closeBooleanDialog} role="dialog" aria-label={t("Mesh Boolean")}>
      <div
        className="modal-content"
        id="mesh-boolean-dialog"
        data-testid="mesh-boolean-dialog"
        style={{ width: 'min(480px, 92vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{t("Mesh Boolean")}</h2>
          <button className="icon-btn" onClick={closeBooleanDialog} aria-label={t("Close")}>✕</button>
        </div>

        <div className="modal-body">
          {error && <div className="error-message" style={{ color: 'var(--danger-color)', fontSize: 12 }}>{error}</div>}

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>{t("Operation Mode")}</label>
            <div style={{ display: 'flex', gap: 16 }}>
              {(['union', 'difference', 'intersection'] as MeshBooleanMode[]).map((mode) => (
                <label key={mode} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="boolean-mode"
                    value={mode}
                    checked={booleanMode === mode}
                    onChange={() => setBooleanMode(mode)}
                  />
                  <span style={{ textTransform: 'capitalize' }}>{mode}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="boolean-target-select" style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
              {t("Target Object")}</label>
            <select
              id="boolean-target-select"
              data-testid="boolean-target-select"
              value={booleanTargetObjectId ?? ''}
              onChange={(e) => setBooleanTargetObjectId(Number(e.target.value))}
              style={{ width: '100%', padding: '6px 8px' }}
            >
              {objects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} {t("(id:")}{o.id})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
              {t("Tool Objects (to apply to target)")}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 4, padding: 8 }}>
              {toolCandidates.length === 0 ? (
                <span style={{ color: 'var(--text-muted)' }}>{t("No other objects available")}</span>
              ) : (
                toolCandidates.map((o) => (
                  <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={booleanToolObjectIds.includes(o.id)}
                      onChange={() => toggleBooleanToolObjectId(o.id)}
                    />
                    <span>{o.name} {t("(id:")}{o.id})</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 4 }}>
            <input
              type="checkbox"
              id="boolean-keep-tools-checkbox"
              checked={booleanKeepTools}
              onChange={(e) => setBooleanKeepTools(e.target.checked)}
            />
            <span>{t("Keep tool objects after operation")}</span>
          </label>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={closeBooleanDialog} disabled={isOperating}>
            {t("Cancel")}</button>
          <button
            className="btn btn-primary"
            id="boolean-apply-btn"
            data-testid="boolean-apply-btn"
            onClick={() => void applyMeshBoolean()}
            disabled={isOperating || booleanToolObjectIds.length === 0}
          >
            {isOperating ? 'Applying...' : 'Apply Boolean'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
};
