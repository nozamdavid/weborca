import React from 'react';
import { usePlateStore } from '../plate/plateStore';
import { useTranslation } from '../i18n';
import { useMeasureStore } from './measureStore';
import { SnapMode } from './types';
import './MeasurePanel.css';

const fmt = (n: number | undefined | null): string =>
  typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '—';

export const MeasurePanel: React.FC = () => {
  const { t } = useTranslation();
  const active = usePlateStore((s) => s.measureActive);
  const setActive = usePlateStore((s) => s.setMeasureActive);
  const points = usePlateStore((s) => s.measurePoints);

  const snapMode = useMeasureStore((s) => s.snapMode);
  const setSnapMode = useMeasureStore((s) => s.setSnapMode);
  const feature1 = useMeasureStore((s) => s.feature1);
  const feature2 = useMeasureStore((s) => s.feature2);
  const result = useMeasureStore((s) => s.result);
  const error = useMeasureStore((s) => s.error);
  const resetSelection = useMeasureStore((s) => s.resetSelection);

  if (!active) return null;

  const handleReset = () => {
    resetSelection();
    usePlateStore.getState().setMeasurePoints([]);
  };

  // Determine fallback simple point measurement ONLY when in point mode
  const [pA, pB] = points;
  const isPointMode = snapMode === 'point';
  const pointDelta = isPointMode && pA && pB ? [pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]] : null;
  const pointDist = pointDelta ? Math.hypot(...pointDelta) : null;

  // Advanced measurement values
  const hasResult = !!result && result.success && (
    (typeof result.distance === 'number' && Number.isFinite(result.distance)) ||
    (typeof result.diameter === 'number' && Number.isFinite(result.diameter)) ||
    (typeof result.length === 'number' && Number.isFinite(result.length)) ||
    (typeof result.angle?.deg === 'number' && Number.isFinite(result.angle.deg))
  );

  const angleDeg = result?.angle?.deg;
  const distanceVal = typeof result?.distance === 'number' && Number.isFinite(result.distance)
    ? result.distance
    : (isPointMode ? pointDist : null);
  const isInfiniteDistance = result?.distanceType === 'infinite';
  const isStrictDistance = result?.distanceType === 'strict';

  const delta = (result?.delta && result.delta.every((d) => typeof d === 'number' && Number.isFinite(d)))
    ? result.delta
    : (pointDelta ? [Math.abs(pointDelta[0]), Math.abs(pointDelta[1]), Math.abs(pointDelta[2])] : null);

  const getDistanceLabel = () => {
    if (isInfiniteDistance) return t('Perpendicular distance');
    if (isStrictDistance && feature1 && feature2) return t('Clearance');
    return t('Distance');
  };

  const getFeatureTypeLabel = (type?: string) => {
    switch (type) {
      case 'circle': return t('Circle');
      case 'edge': return t('Edge');
      case 'plane': return t('Face');
      case 'point': return t('Point');
      default: return type ? t(type) : '—';
    }
  };

  return (
    <div id="measure-panel" className="measure-panel ds-float">
      <div className="measure-header">
        <h3 className="measure-title">{t('Measure (U)')}</h3>
        <button
          className="measure-close-btn"
          id="measure-close"
          onClick={() => setActive(false)}
          aria-label={t('Close')}
        >
          ✕
        </button>
      </div>

      {/* Snap Mode Selector */}
      <div className="measure-snap-bar" role="group" aria-label={t('Snap mode')}>
        {(['auto', 'plane', 'edge', 'circle', 'point'] as SnapMode[]).map((mode) => (
          <button
            key={mode}
            id={`measure-snap-${mode === 'plane' ? 'face' : mode}`}
            className="measure-snap-btn"
            aria-pressed={snapMode === mode}
            onClick={() => setSnapMode(mode)}
          >
            {mode === 'auto'
              ? t('Auto')
              : mode === 'plane'
              ? t('Face')
              : mode === 'edge'
              ? t('Edge')
              : mode === 'circle'
              ? t('Circle')
              : t('Point')}
          </button>
        ))}
      </div>

      {/* Actionable Error Display */}
      {error && (
        <div id="measure-error" className="measure-error" role="alert">
          {t(error)}
        </div>
      )}

      {/* Selection Status / Hints */}
      {!feature1 && !pA && !error && (
        <div className="measure-hint">{t('Click a face, edge, circle, or point.')}</div>
      )}
      {((feature1 && !feature2) || (pA && !pB && !feature1)) && !error && (
        <div className="measure-hint">{t('Click a second feature to measure.')}</div>
      )}

      {/* Feature 1 Information */}
      {feature1 && (
        <div className="measure-selection-card">
          <div className="measure-selection-row">
            <span>{t('Selection 1')}</span>
            <span className="measure-feature-tag">{getFeatureTypeLabel(feature1.type)}</span>
          </div>
          {feature1.type === 'circle' && typeof feature1.circle?.diameter === 'number' && Number.isFinite(feature1.circle.diameter) && (
            <div className="measure-selection-row">
              <span>{t('Diameter')}</span>
              <b id="measure-diameter">{fmt(feature1.circle.diameter)} {t('mm')}</b>
            </div>
          )}
          {feature1.type === 'edge' && typeof feature1.edge?.length === 'number' && Number.isFinite(feature1.edge.length) && (
            <div className="measure-selection-row">
              <span>{t('Length')}</span>
              <b>{fmt(feature1.edge.length)} {t('mm')}</b>
            </div>
          )}
        </div>
      )}

      {/* Feature 2 Information */}
      {feature2 && (
        <div className="measure-selection-card">
          <div className="measure-selection-row">
            <span>{t('Selection 2')}</span>
            <span className="measure-feature-tag">{getFeatureTypeLabel(feature2.type)}</span>
          </div>
          {feature2.type === 'circle' && typeof feature2.circle?.diameter === 'number' && Number.isFinite(feature2.circle.diameter) && (
            <div className="measure-selection-row">
              <span>{t('Diameter')}</span>
              <b>{fmt(feature2.circle.diameter)} {t('mm')}</b>
            </div>
          )}
          {feature2.type === 'edge' && typeof feature2.edge?.length === 'number' && Number.isFinite(feature2.edge.length) && (
            <div className="measure-selection-row">
              <span>{t('Length')}</span>
              <b>{fmt(feature2.edge.length)} {t('mm')}</b>
            </div>
          )}
        </div>
      )}

      {/* Measurement Readouts */}
      {(hasResult || (isPointMode && pointDelta)) && (
        <div id="measure-result" className="measure-result-grid">
          {typeof angleDeg === 'number' && Number.isFinite(angleDeg) && (
            <>
              <span>{t('Angle')}</span>
              <b id="measure-angle">{fmt(angleDeg)}°</b>
            </>
          )}

          {typeof distanceVal === 'number' && Number.isFinite(distanceVal) && (
            <>
              <span>{getDistanceLabel()}</span>
              <b id="measure-distance">
                {fmt(distanceVal)} {t('mm')}
              </b>
            </>
          )}

          {delta && delta.every((d) => typeof d === 'number' && Number.isFinite(d)) && (
            <>
              <span>{t('ΔX')}</span>
              <span id="measure-dx" className="measure-val">{fmt(delta[0])} {t('mm')}</span>
              <span>{t('ΔY')}</span>
              <span id="measure-dy" className="measure-val">{fmt(delta[1])} {t('mm')}</span>
              <span>{t('ΔZ')}</span>
              <span id="measure-dz" className="measure-val">{fmt(delta[2])} {t('mm')}</span>
            </>
          )}
        </div>
      )}

      <div className="measure-actions">
        <button
          id="measure-reset"
          className="measure-btn-reset"
          onClick={handleReset}
        >
          {t('Restart selection')}
        </button>
      </div>
    </div>
  );
};
