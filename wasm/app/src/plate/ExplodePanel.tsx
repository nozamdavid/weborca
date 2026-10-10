import React from 'react';
import { usePlateStore } from './plateStore';
import { useTranslation } from "../i18n";

export const ExplodePanel: React.FC = () => {
    const { t } = useTranslation();
  const active = usePlateStore((s) => s.explodeActive);
  const factor = usePlateStore((s) => s.explodeFactor);
  const setActive = usePlateStore((s) => s.setExplodeActive);
  const setFactor = usePlateStore((s) => s.setExplodeFactor);

  if (!active) return null;

  return (
    <div
      id="explode-panel"
      className="canvas-panel"
      style={{
        position: 'absolute',
        top: 24,
        right: 24,
        width: 260,
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
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{t("Explode view")}</h3>
        <button
          className="icon-btn"
          id="explode-close"
          onClick={() => setActive(false)}
          aria-label={t("Close")}
        >
          ✕
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span>{t("Explode")}</span>
          <span id="explode-value">{Math.round(factor)}%</span>
        </div>
        <input
          id="explode-slider"
          type="range"
          min="0"
          max="100"
          value={factor}
          onChange={(e) => setFactor(parseFloat(e.target.value) || 0)}
          style={{ width: '100%', cursor: 'pointer' }}
        />
      </div>
    </div>
  );
};
