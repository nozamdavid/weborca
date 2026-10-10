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
      className="paint-tools-panel"
      style={{
        position: 'fixed',
        top: 120,
        right: 16,
        background: 'rgba(24, 24, 27, 0.96)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: 10,
        padding: '12px 16px',
        color: 'var(--text-color)',
        width: 270,
        maxHeight: 'calc(100vh - 136px)',
        overflowY: 'auto',
        fontSize: '0.85rem',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.6)',
        zIndex: 45
      }}
    >
      {/* Panel Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '1.1rem' }}>{t("🖌️")}</span>
          <strong id="paint-tools-title" style={{ fontSize: '0.95rem', color: '#38bdf8' }}>
            {t("Painting Tools")}</strong>
        </div>
        <button
          type="button"
          onClick={stopPainting}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '1rem',
            padding: '2px 6px'
          }}
          title={t("Close painting tools")}
        >
          ✕
        </button>
      </div>

      {error && (
        <div
          id="paint-error-banner"
          style={{
            background: 'rgba(239, 68, 68, 0.2)',
            color: '#fca5a5',
            padding: '6px 8px',
            borderRadius: 6,
            marginBottom: 8,
            fontSize: '0.75rem'
          }}
        >
          {error}
        </div>
      )}

      {volumes.length > 1 && (
        <label style={{ display: 'block', marginBottom: 10, fontSize: '0.75rem' }}>
          {t("Volume")}<select id="paint-volume-select" value={selectedVolumeId ?? ''} onChange={(event) => setSelectedVolume(Number(event.target.value))}
            style={{ display: 'block', width: '100%', marginTop: 4, background: 'var(--panel-bg)', color: '#fff' }}>
            {volumes.map((volume) => <option key={volume.volumeId} value={volume.volumeId}>{`Volume ${volume.volumeId}`}</option>)}
          </select>
        </label>
      )}

      {/* Layer Tabs: Support / Seam / Color / Fuzzy */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 4 }}>{t("Layer")}</div>
        <div
          role="group"
          aria-label={t("Painting Layer")}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}
        >
          {layers.map((l) => (
            <button
              key={l.id}
              type="button"
              id={`paint-layer-${l.id}`}
              aria-pressed={layer === l.id}
              onClick={() => setLayer(l.id)}
              disabled={isLoading}
              style={{
                padding: '4px 2px',
                background: layer === l.id ? '#0284c7' : 'var(--panel-bg)',
                color: '#fff',
                border: layer === l.id ? '1px solid #38bdf8' : '1px solid var(--control-bg)',
                borderRadius: 6,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontSize: '0.72rem',
                fontWeight: 500,
                textAlign: 'center'
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filament Palette (Color layer only) */}
      {layer === 'color' && (
        <div style={{ marginBottom: 10, background: 'var(--canvas-bg)', padding: '8px', borderRadius: 8 }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 6 }}>
            {t("Filament Palette")}<span style={{ color: '#64748b' }}>{t("(Keys 1..9)")}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
                  title={`Filament ${slot}: ${col} (Key ${slot})`}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: col,
                    border: isSelected ? '3px solid #38bdf8' : '2px solid var(--border-color)',
                    boxShadow: isSelected ? '0 0 8px #38bdf8' : 'none',
                    cursor: 'pointer',
                    color: '#fff',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    textShadow: '0 0 3px #000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0
                  }}
                >
                  {slot}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tool Choices (Circle, Sphere, Smart fill, Bucket fill, Triangle) */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 4 }}>{t("Tool")}</div>
        <div
          role="group"
          aria-label={t("Painting Tool")}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}
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
              style={{
                padding: '6px 2px',
                background: tool === t.id ? 'rgba(56, 189, 248, 0.25)' : 'var(--panel-bg)',
                color: tool === t.id ? '#38bdf8' : 'var(--text-color)',
                border: tool === t.id ? '1px solid #38bdf8' : '1px solid var(--control-bg)',
                borderRadius: 6,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontSize: '0.7rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2
              }}
            >
              <span>{t.icon}</span>
              <span style={{ fontSize: '0.62rem' }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Brush Radius Slider (for Circle & Sphere) */}
      {(tool === 'circle' || tool === 'sphere') && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginBottom: 2 }}>
            <span>{t("Brush Size")}<span style={{ color: '#64748b' }}>{t("(Alt+wheel)")}</span></span>
            <span id="cursor-radius-value" style={{ color: 'var(--text-color)' }}>{cursorRadius.toFixed(2)} {t("mm")}</span>
          </div>
          <input
            type="range"
            id="cursor-radius-slider"
            min={CURSOR_RADIUS_MIN}
            max={CURSOR_RADIUS_MAX}
            step={CURSOR_RADIUS_STEP}
            value={cursorRadius}
            onChange={(e) => setCursorRadius(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
          />
        </div>
      )}

      {/* Smart Fill Angle Slider (for Smart fill & Bucket) */}
      {(tool === 'smart_fill' || tool === 'bucket') && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginBottom: 2 }}>
            <span>{t("Smart Fill Angle")}</span>
            <span id="smart-fill-angle-value" style={{ color: 'var(--text-color)' }}>{smartFillAngle}°</span>
          </div>
          <input
            type="range"
            id="smart-fill-angle-slider"
            min={SMART_FILL_ANGLE_MIN}
            max={SMART_FILL_ANGLE_MAX}
            step={SMART_FILL_ANGLE_STEP}
            value={smartFillAngle}
            onChange={(e) => setSmartFillAngle(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
          />
        </div>
      )}

      {/* Overhang Highlight Angle (Support layer only) */}
      {layer === 'support' && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginBottom: 2 }}>
            <span>{t("Highlight Overhangs")}</span>
            <span id="overhang-angle-value" style={{ color: 'var(--text-color)' }}>{overhangAngle}°</span>
          </div>
          <input
            type="range"
            id="overhang-angle-slider"
            min={OVERHANG_ANGLE_MIN}
            max={OVERHANG_ANGLE_MAX}
            step={OVERHANG_ANGLE_STEP}
            value={overhangAngle}
            onChange={(e) => setOverhangAngle(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
          />

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', marginTop: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              id="overhang-only-checkbox"
              checked={overhangOnly}
              onChange={(e) => setOverhangOnly(e.target.checked)}
              style={{ accentColor: '#38bdf8' }}
            />
            <span>{t("On highlighted overhangs only")}</span>
          </label>
        </div>
      )}

      {/* Triangle Splitting Toggle */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            id="triangle-splitting-checkbox"
            checked={triangleSplitting}
            onChange={(e) => setTriangleSplitting(e.target.checked)}
            style={{ accentColor: '#38bdf8' }}
          />
          <span>{t("Triangle splitting (adaptive mesh subdivision)")}</span>
        </label>
      </div>

      {/* Controls Hint / Desktop Mapping */}
      <div
        id="paint-shortcuts-hint"
        style={{
          background: 'rgba(39, 39, 42, 0.6)',
          borderRadius: 6,
          padding: '6px 8px',
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
          marginBottom: 10,
          lineHeight: '1.4'
        }}
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
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          id="paint-erase-all-btn"
          onClick={clearCurrentPaint}
          disabled={isLoading}
          style={{
            flex: 1,
            padding: '6px 8px',
            background: 'rgba(239, 68, 68, 0.2)',
            color: '#fca5a5',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 6,
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontSize: '0.75rem',
            fontWeight: 500
          }}
        >
          {t("Erase All")}</button>
        <button
          type="button"
          id="paint-done-btn"
          onClick={stopPainting}
          style={{
            flex: 1,
            padding: '6px 8px',
            background: '#0284c7',
            color: '#fff',
            border: '1px solid #38bdf8',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontWeight: 500
          }}
        >
          {t("Done")}</button>
      </div>
    </div>
  );
};
