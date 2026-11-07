import React from 'react';
import { useEditOpsStore } from './editOpsStore';
import { useTranslation } from "../i18n";

export const BrimEarsPanel: React.FC = () => {
    const { t } = useTranslation();
  const activeTool = useEditOpsStore((s) => s.activeTool);
  const brimRadius = useEditOpsStore((s) => s.brimRadius);
  const brimPoints = useEditOpsStore((s) => s.brimPoints);
  const error = useEditOpsStore((s) => s.error);

  const setBrimRadius = useEditOpsStore((s) => s.setBrimRadius);
  const removeBrimEar = useEditOpsStore((s) => s.removeBrimEar);
  const clearBrimEars = useEditOpsStore((s) => s.clearBrimEars);
  const stopBrimEars = useEditOpsStore((s) => s.stopBrimEars);

  if (activeTool !== 'brimears') return null;

  return (
    <div
      id="brim-ears-panel"
      data-testid="brim-ears-panel"
      className="canvas-panel"
      style={{
        position: 'absolute',
        top: 'var(--tool-panel-top, 64px)',
        maxHeight: 'calc(100% - var(--tool-panel-top, 64px) - var(--plate-actions-clearance, 16px))',
        overflowY: 'auto',
        right: 24,
        width: 280,
        background: 'var(--panel-bg)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        padding: 16,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>{t("Brim Ears")}</h3>
        <button className="icon-btn" onClick={stopBrimEars} aria-label={t("Close")}>✕</button>
      </div>

      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        {t("Click near model corners on the bed to place mouse ear discs. Click an existing ear to remove it.")}</p>

      {error && <div style={{ color: 'var(--danger-color)', fontSize: '0.75rem' }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label htmlFor="brim-ear-radius-input" style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
          {t("Ear Radius (mm)")}</label>
        <input
          type="number"
          id="brim-ear-radius-input"
          data-testid="brim-ear-radius-input"
          aria-label={t("Ear Radius")}
          min="1"
          max="30"
          step="0.5"
          value={brimRadius}
          onChange={(e) => setBrimRadius(parseFloat(e.target.value) || 5.0)}
          style={{ width: 70, padding: '4px 6px' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {t("Ear Discs (")}{brimPoints.length})
        </span>
        <button
          className="btn btn-secondary"
          id="brim-ears-clear-btn"
          data-testid="brim-ears-clear-btn"
          onClick={() => void clearBrimEars()}
          disabled={brimPoints.length === 0}
          style={{ padding: '3px 8px', fontSize: '0.6875rem' }}
        >
          {t("Clear All")}</button>
      </div>

      {brimPoints.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
          {brimPoints.map((pt, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '4px 8px',
                background: 'var(--control-bg)',
                borderRadius: 4,
                fontSize: '0.6875rem'
              }}
            >
              <span>
                [{pt.position[0].toFixed(1)}, {pt.position[1].toFixed(1)}{t("] (r=")}{pt.radius}{t("mm)")}</span>
              <button
                className="icon-btn"
                onClick={() => void removeBrimEar(i)}
                style={{ padding: 2, fontSize: '0.6875rem' }}
                title={t("Remove ear")}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <button className="btn btn-primary" onClick={stopBrimEars} style={{ marginTop: 4 }}>
        {t("Done")}</button>
    </div>
  );
};
