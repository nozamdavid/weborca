import React from 'react';
import { usePlateStore } from './plateStore';
import { useTranslation } from "../i18n";
import './ExplodePanel.css';

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
      className="canvas-panel explode-panel"
    >
      <div className="explode-panel__head">
        <h3 className="explode-panel__title">{t("Explode view")}</h3>
        <button
          className="icon-btn"
          id="explode-close"
          onClick={() => setActive(false)}
          aria-label={t("Close")}
        >
          ✕
        </button>
      </div>
      <div className="explode-panel__field">
        <div className="explode-panel__meta">
          <label htmlFor="explode-slider">{t("Explode")}</label>
          <span id="explode-value">{Math.round(factor)}%</span>
        </div>
        <input
          id="explode-slider"
          type="range"
          min="0"
          max="100"
          value={factor}
          onChange={(e) => setFactor(parseFloat(e.target.value) || 0)}
        />
      </div>
    </div>
  );
};
