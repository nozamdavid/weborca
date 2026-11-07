import './PaintToolsPanel.css';
import React, { useEffect } from 'react';
import {
  usePaintToolsStore,
  CURSOR_RADIUS_MIN,
  CURSOR_RADIUS_MAX,
  CURSOR_RADIUS_STEP,
  SMART_FILL_ANGLE_MIN,
  SMART_FILL_ANGLE_MAX,
  SMART_FILL_ANGLE_STEP,
  OVERHANG_ANGLE_MIN,
  OVERHANG_ANGLE_MAX,
  OVERHANG_ANGLE_STEP
} from './paintToolsStore';
import type { PaintLayer, PaintTool } from './types';
import { usePlateStore } from '../plate/plateStore';
import { useTranslation } from "../i18n";

export const PaintToolsPanel: React.FC = () => {
    const { t } = useTranslation();
  const isActive = usePaintToolsStore((s) => s.isActive);
  const layer = usePaintToolsStore((s) => s.layer);
  const setLayer = usePaintToolsStore((s) => s.setLayer);
  const tool = usePaintToolsStore((s) => s.tool);
  const setTool = usePaintToolsStore((s) => s.setTool);
  const cursorRadius = usePaintToolsStore((s) => s.cursorRadius);
  const setCursorRadius = usePaintToolsStore((s) => s.setCursorRadius);
  const adjustCursorRadius = usePaintToolsStore((s) => s.adjustCursorRadius);
  const smartFillAngle = usePaintToolsStore((s) => s.smartFillAngle);
  const setSmartFillAngle = usePaintToolsStore((s) => s.setSmartFillAngle);
  const overhangAngle = usePaintToolsStore((s) => s.overhangAngle);
  const setOverhangAngle = usePaintToolsStore((s) => s.setOverhangAngle);
  const overhangOnly = usePaintToolsStore((s) => s.overhangOnly);
  const setOverhangOnly = usePaintToolsStore((s) => s.setOverhangOnly);
  const triangleSplitting = usePaintToolsStore((s) => s.triangleSplitting);
  const setTriangleSplitting = usePaintToolsStore((s) => s.setTriangleSplitting);
  const activeFilament = usePaintToolsStore((s) => s.activeFilament);
  const setActiveFilament = usePaintToolsStore((s) => s.setActiveFilament);
  const filamentColors = usePaintToolsStore((s) => s.filamentColors);
  const clearCurrentPaint = usePaintToolsStore((s) => s.clearCurrentPaint);
  const stopPainting = usePaintToolsStore((s) => s.stopPainting);
  const isLoading = usePaintToolsStore((s) => s.isLoading);
  const error = usePaintToolsStore((s) => s.error);
  const selectedObjectId = usePaintToolsStore((s) => s.selectedObjectId);
  const selectedVolumeId = usePaintToolsStore((s) => s.selectedVolumeId);
  const setSelectedVolume = usePaintToolsStore((s) => s.setSelectedVolume);
  const meshCache = usePlateStore((s) => s.meshCache);
  const volumes = selectedObjectId === null ? [] : meshCache.get(selectedObjectId)?.volumes ?? [];

  // Keyboard shortcut 1..9 for filaments in Color mode
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (layer === 'color') {
        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= 9) {
          setActiveFilament(num);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, layer, setActiveFilament]);

  // Alt + Mouse wheel to change cursor size anywhere
  useEffect(() => {
    if (!isActive) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.altKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? CURSOR_RADIUS_STEP : -CURSOR_RADIUS_STEP;
        adjustCursorRadius(delta);
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [isActive, adjustCursorRadius]);

  if (!isActive) {
    return null;
  }

  const layers: Array<{ id: PaintLayer; label: string }> = [
    { id: 'support', label: t("Support") },
    { id: 'seam', label: t("Seam") },
    { id: 'color', label: t("Color") },
    { id: 'fuzzy', label: t("Fuzzy") }
  ];

  // Tool choices based on desktop gizmos
  const tools: Array<{ id: PaintTool; label: string; icon: string }> = [
    { id: 'circle', label: t("Circle"), icon: '⭕' },
    { id: 'sphere', label: t("Sphere"), icon: '🌐' },
    { id: 'smart_fill', label: t("Smart fill"), icon: '🪣' },
    { id: 'bucket', label: t("Bucket"), icon: '🎨' },
    { id: 'triangle', label: t("Triangle"), icon: '🔺' }
  ];

  return (
    <div
      id="paint-tools-panel"
      className="paint-tools-panel ds-float paint-tools-panel"
    >
      {/* Panel Header */}
      <div className="paint-tools-panel__head">
        <div className="painttools-panel__row-42">
          <span className="painttools-panel__span-41">{t("🖌️")}</span>
          <strong id="paint-tools-title" className="ds-title ds-title--panel paint-tools-panel__title">
            {t("Painting Tools")}</strong>
        </div>
        <button
          type="button"
          onClick={stopPainting}
          className="ds-btn painttools-panel__button-39"
          title={t("Close painting tools")}
        >
          ✕
        </button>
      </div>

      {error && (
        <div
          id="paint-error-banner"
          className="painttools-panel__card-38"
        >
          {t(error)}
        </div>
      )}

      {volumes.length > 1 && (
        <label className="painttools-panel__label-37">
          {t("Volume")}<select id="paint-volume-select" value={selectedVolumeId ?? ''} onChange={(event) => setSelectedVolume(Number(event.target.value))}
            className="ds-input painttools-panel__select-36">
            {volumes.map((volume) => <option key={volume.volumeId} value={volume.volumeId}>{`${t('Volume')} ${volume.volumeId}`}</option>)}
          </select>
        </label>
      )}

      {/* Layer Tabs: Support / Seam / Color / Fuzzy */}
      <div className="painttools-panel__div-9">
        <div className="painttools-panel__div-23">{t("Layer")}</div>
        <div
          role="group"
          aria-label={t("Painting Layer")}
          className="painttools-panel__grid-35"
        >
          {layers.map((l) => (
            <button
              key={l.id}
              type="button"
              id={`paint-layer-${l.id}`}
              aria-pressed={layer === l.id}
              onClick={() => setLayer(l.id)}
              disabled={isLoading}
              className={["ds-btn painttools-panel__button-34", (layer === l.id  ? "painttools-panel__state-32" : "painttools-panel__state-17"), (layer === l.id  ? "painttools-panel__state-33" : "painttools-panel__span-12"), (layer === l.id  ? "painttools-panel__state-19" : "painttools-panel__state-20"), (isLoading  ? "painttools-panel__state-2" : "painttools-panel__state-3")].join(" ")}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filament Palette (Color layer only) */}
      {layer === 'color' && (
        <div className="painttools-panel__card-31">
          <div className="painttools-panel__div-30">
            {t("Filament Palette")}<span className="painttools-panel__span-14">{t("(Keys 1..9)")}</span>
          </div>
          <div className="painttools-panel__row-29">
            {filamentColors.map((col, idx) => {
              const slot = idx + 1;
              const isSelected = activeFilament === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  id={`filament-slot-${slot}`}
                  aria-pressed={isSelected}
                  onClick={() => setActiveFilament(slot)}
                  title={ `${t('Filament')} ${slot}: ${col} (${t('(Keys 1..9)')})` }
                  className={["ds-btn painttools-panel__button-28", (isSelected  ? "painttools-panel__state-24" : "painttools-panel__state-25"), (isSelected  ? "painttools-panel__state-26" : "painttools-panel__state-27")].join(" ")} style={{ background: col }}
                >
                  {slot}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tool Choices (Circle, Sphere, Smart fill, Bucket fill, Triangle) */}
      <div className="painttools-panel__div-9">
        <div className="painttools-panel__div-23">{t("Tool")}</div>
        <div
          role="group"
          aria-label={t("Painting Tool")}
          className="painttools-panel__grid-22"
        >
          {tools.map((t) => (
            <button
              key={t.id}
              type="button"
              id={`paint-tool-${t.id}`}
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
              disabled={isLoading}
              title={t.label}
              className={["ds-btn painttools-panel__button-21", (tool === t.id  ? "painttools-panel__state-16" : "painttools-panel__state-17"), (tool === t.id  ? "painttools-panel__state-18" : "painttools-panel__span-12"), (tool === t.id  ? "painttools-panel__state-19" : "painttools-panel__state-20"), (isLoading  ? "painttools-panel__state-2" : "painttools-panel__state-3")].join(" ")}
            >
              <span>{t.icon}</span>
              <span className="painttools-panel__span-15">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Brush Radius Slider (for Circle & Sphere) */}
      {(tool === 'circle' || tool === 'sphere') && (
        <div className="painttools-panel__div-9">
          <div className="painttools-panel__row-13">
            <span>{t("Brush Size")}<span className="painttools-panel__span-14">{t("(Alt+wheel)")}</span></span>
            <span id="cursor-radius-value" className="painttools-panel__span-12">{cursorRadius.toFixed(2)} {t("mm")}</span>
          </div>
          <input
            type="range"
            id="cursor-radius-slider"
            min={CURSOR_RADIUS_MIN}
            max={CURSOR_RADIUS_MAX}
            step={CURSOR_RADIUS_STEP}
            value={cursorRadius}
            onChange={(e) => setCursorRadius(parseFloat(e.target.value))}
            className="painttools-panel__input-11"
          />
        </div>
      )}

      {/* Smart Fill Angle Slider (for Smart fill & Bucket) */}
      {(tool === 'smart_fill' || tool === 'bucket') && (
        <div className="painttools-panel__div-9">
          <div className="painttools-panel__row-13">
            <span>{t("Smart Fill Angle")}</span>
            <span id="smart-fill-angle-value" className="painttools-panel__span-12">{smartFillAngle}°</span>
          </div>
          <input
            type="range"
            id="smart-fill-angle-slider"
            min={SMART_FILL_ANGLE_MIN}
            max={SMART_FILL_ANGLE_MAX}
            step={SMART_FILL_ANGLE_STEP}
            value={smartFillAngle}
            onChange={(e) => setSmartFillAngle(parseFloat(e.target.value))}
            className="painttools-panel__input-11"
          />
        </div>
      )}

      {/* Overhang Highlight Angle (Support layer only) */}
      {layer === 'support' && (
        <div className="painttools-panel__div-9">
          <div className="painttools-panel__row-13">
            <span>{t("Highlight Overhangs")}</span>
            <span id="overhang-angle-value" className="painttools-panel__span-12">{overhangAngle}°</span>
          </div>
          <input
            type="range"
            id="overhang-angle-slider"
            min={OVERHANG_ANGLE_MIN}
            max={OVERHANG_ANGLE_MAX}
            step={OVERHANG_ANGLE_STEP}
            value={overhangAngle}
            onChange={(e) => setOverhangAngle(parseFloat(e.target.value))}
            className="painttools-panel__input-11"
          />

          <label className="painttools-panel__label-10">
            <input
              type="checkbox"
              id="overhang-only-checkbox"
              checked={overhangOnly}
              onChange={(e) => setOverhangOnly(e.target.checked)}
              className="painttools-panel__input-7"
            />
            <span>{t("On highlighted overhangs only")}</span>
          </label>
        </div>
      )}

      {/* Triangle Splitting Toggle */}
      <div className="painttools-panel__div-9">
        <label className="painttools-panel__label-8">
          <input
            type="checkbox"
            id="triangle-splitting-checkbox"
            checked={triangleSplitting}
            onChange={(e) => setTriangleSplitting(e.target.checked)}
            className="painttools-panel__input-7"
          />
          <span>{t("Triangle splitting (adaptive mesh subdivision)")}</span>
        </label>
      </div>

      {/* Controls Hint / Desktop Mapping */}
      <div
        id="paint-shortcuts-hint"
        className="painttools-panel__card-6"
      >
        {layer === 'support' && (
          <>
            <div><strong>{t("Left button:")}</strong> {t("Enforce support (Green)")}</div>
            <div><strong>{t("Right button:")}</strong> {t("Block support (Red)")}</div>
            <div><strong>{t("Shift + Left:")}</strong> {t("Erase")}</div>
          </>
        )}
        {layer === 'seam' && (
          <>
            <div><strong>{t("Left button:")}</strong> {t("Enforce seam (Green)")}</div>
            <div><strong>{t("Right button:")}</strong> {t("Block seam (Red)")}</div>
            <div><strong>{t("Shift + Left:")}</strong> {t("Erase")}</div>
          </>
        )}
        {layer === 'color' && (
          <>
            <div><strong>{t("Left button:")}</strong> {t("Paint Filament #")}{activeFilament}</div>
            <div><strong>{t("Right button / Shift:")}</strong> {t("Erase")}</div>
          </>
        )}
        {layer === 'fuzzy' && (
          <>
            <div><strong>{t("Left button:")}</strong> {t("Paint Fuzzy Skin")}</div>
            <div><strong>{t("Right button / Shift:")}</strong> {t("Erase")}</div>
          </>
        )}
      </div>

      {/* Erase All & Done Buttons */}
      <div className="painttools-panel__row-5">
        <button
          type="button"
          id="paint-erase-all-btn"
          onClick={clearCurrentPaint}
          disabled={isLoading}
          className={["ds-btn painttools-panel__button-4", (isLoading  ? "painttools-panel__state-2" : "painttools-panel__state-3")].join(" ")}
        >
          {t("Erase All")}</button>
        <button
          type="button"
          id="paint-done-btn"
          onClick={stopPainting}
          className="ds-btn painttools-panel__button-1"
        >
          {t("Done")}</button>
      </div>
    </div>
  );
};
