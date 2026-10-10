import React from 'react';
import { usePlateStore } from './plateStore';
import { useTranslation } from "../i18n";

const fmt = (n: number) => n.toFixed(2);

/** Readout for the measure tool: the distance between the two picked surface points and its per-axis parts. */
export const MeasurePanel: React.FC = () => {
    const { t } = useTranslation();
  const active = usePlateStore((s) => s.measureActive);
  const points = usePlateStore((s) => s.measurePoints);
  const setActive = usePlateStore((s) => s.setMeasureActive);
  if (!active) return null;
  const [a, b] = points;
  const d = a && b ? [b[0] - a[0], b[1] - a[1], b[2] - a[2]] : null;
  return (
    <div id="measure-panel" className="canvas-panel" style={{ position: 'absolute', top: 24, right: 24, width: 260, background: 'var(--panel-bg)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 16, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)', zIndex: 100, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{t("Measure (U)")}</h3>
        <button className="icon-btn" id="measure-close" onClick={() => setActive(false)} aria-label={t("Close")}>✕</button>
      </div>
      {!a && <div style={{ fontSize: 12, opacity: 0.8 }}>{t("Click a point on the model.")}</div>}
      {a && !b && <div style={{ fontSize: 12, opacity: 0.8 }}>{t("Click a second point.")}</div>}
      {d && (
        <div id="measure-result" style={{ fontSize: 13, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px' }}>
          <span>{t("Distance")}</span><b id="measure-distance">{fmt(Math.hypot(...d))} {t("mm")}</b>
          <span>{t("ΔX")}</span><span id="measure-dx">{fmt(Math.abs(d[0]))} {t("mm")}</span>
          <span>{t("ΔY")}</span><span id="measure-dy">{fmt(Math.abs(d[1]))} {t("mm")}</span>
          <span>{t("ΔZ")}</span><span id="measure-dz">{fmt(Math.abs(d[2]))} {t("mm")}</span>
        </div>
      )}
    </div>
  );
};
