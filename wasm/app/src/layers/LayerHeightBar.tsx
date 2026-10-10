/**
 * @file LayerHeightBar.tsx
 * Vertical profile bar and control panel for the Variable Layer Height tool.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useLayersStore } from './layersStore';
import type { LayerEditAction } from './types';
import { useTranslation } from "../i18n";

export const LayerHeightBar: React.FC = () => {
    const { t } = useTranslation();
  const isLayersActive = useLayersStore((s) => s.isLayersActive);
  const profileData = useLayersStore((s) => s.profileData);
  const quality = useLayersStore((s) => s.quality);
  const radius = useLayersStore((s) => s.radius);
  const keepMin = useLayersStore((s) => s.keepMin);
  const bandWidth = useLayersStore((s) => s.bandWidth);
  const cursorZ = useLayersStore((s) => s.cursorZ);
  const isLoading = useLayersStore((s) => s.isLoading);
  const error = useLayersStore((s) => s.error);

  const setQuality = useLayersStore((s) => s.setQuality);
  const setRadius = useLayersStore((s) => s.setRadius);
  const setKeepMin = useLayersStore((s) => s.setKeepMin);
  const setBandWidth = useLayersStore((s) => s.setBandWidth);
  const setCursorZ = useLayersStore((s) => s.setCursorZ);
  const applyAdaptive = useLayersStore((s) => s.applyAdaptive);
  const applySmooth = useLayersStore((s) => s.applySmooth);
  const applyAdjust = useLayersStore((s) => s.applyAdjust);
  const applyReset = useLayersStore((s) => s.applyReset);
  const stopEditing = useLayersStore((s) => s.stopEditing);

  const barCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragAction, setDragAction] = useState<LayerEditAction>('increase');

  const canvasHeight = 360;
  const canvasWidth = 140;

  // Render profile bar canvas
  useEffect(() => {
    const canvas = barCanvasRef.current;
    if (!canvas || !profileData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const {
      profile,
      minLayerHeight,
      maxLayerHeight,
      layerHeight: nominalHeight,
      objectHeight
    } = profileData;

    const margin = { top: 16, bottom: 16, left: 30, right: 12 };
    const plotW = canvasWidth - margin.left - margin.right;
    const plotH = canvasHeight - margin.top - margin.bottom;

    // Background
    ctx.fillStyle = 'var(--canvas-bg)';
    ctx.fillRect(margin.left, margin.top, plotW, plotH);
    ctx.strokeStyle = 'var(--control-bg)';
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);

    const zToY = (z: number) => {
      const clampedZ = Math.max(0, Math.min(objectHeight, z));
      return margin.top + plotH - (clampedZ / objectHeight) * plotH;
    };

    const hToX = (h: number) => {
      const clampedH = Math.max(minLayerHeight, Math.min(maxLayerHeight, h));
      const span = Math.max(1e-4, maxLayerHeight - minLayerHeight);
      return margin.left + ((clampedH - minLayerHeight) / span) * plotW;
    };

    // Reference nominal line
    const nomX = hToX(nominalHeight);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(nomX, margin.top);
    ctx.lineTo(nomX, margin.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Min / max labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${minLayerHeight.toFixed(2)}`, margin.left, margin.top + plotH + 12);
    ctx.fillText(`${maxLayerHeight.toFixed(2)}`, margin.left + plotW, margin.top + plotH + 12);

    // Height ticks on left
    ctx.textAlign = 'right';
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const zVal = (objectHeight / ticks) * i;
      const yVal = zToY(zVal);
      ctx.fillStyle = 'var(--text-muted)';
      ctx.fillText(`${zVal.toFixed(0)}`, margin.left - 4, yVal + 3);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.moveTo(margin.left, yVal);
      ctx.lineTo(margin.left + plotW, yVal);
      ctx.stroke();
    }

    // Brush highlight
    if (cursorZ !== null) {
      const halfBw = bandWidth / 2;
      const topY = zToY(Math.min(objectHeight, cursorZ + halfBw));
      const botY = zToY(Math.max(0, cursorZ - halfBw));
      const bandH = Math.max(2, botY - topY);

      ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
      ctx.fillRect(margin.left, topY, plotW, bandH);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin.left, zToY(cursorZ));
      ctx.lineTo(margin.left + plotW, zToY(cursorZ));
      ctx.stroke();
    }

    // Draw profile curve
    if (profile && profile.length >= 4) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();

      for (let i = 0; i + 1 < profile.length; i += 2) {
        const pz = profile[i];
        const ph = profile[i + 1];
        const px = hToX(ph);
        const py = zToY(pz);
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();

      // Draw points along the curve
      ctx.fillStyle = '#4ade80';
      for (let i = 0; i + 1 < profile.length; i += 2) {
        const px = hToX(profile[i + 1]);
        const py = zToY(profile[i]);
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [profileData, cursorZ, bandWidth, canvasWidth, canvasHeight]);

  // Convert mouse Y coordinate to Z height
  const getZFromEvent = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): number | null => {
      const canvas = barCanvasRef.current;
      if (!canvas || !profileData) return null;
      const rect = canvas.getBoundingClientRect();
      const clientY = e.clientY - rect.top;
      const margin = { top: 16, bottom: 16 };
      const plotH = canvasHeight - margin.top - margin.bottom;
      const relY = clientY - margin.top;
      const t = 1 - Math.max(0, Math.min(plotH, relY)) / plotH;
      return t * profileData.objectHeight;
    },
    [profileData, canvasHeight]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const z = getZFromEvent(e);
    if (z === null) return;

    let action: LayerEditAction = 'increase';
    if (e.shiftKey) {
      action = 'smooth';
    } else if (e.button === 2) {
      action = 'decrease';
    } else {
      action = 'increase';
    }

    setIsDragging(true);
    setDragAction(action);
    setCursorZ(z);
    applyAdjust(z, action, undefined, bandWidth);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const z = getZFromEvent(e);
    if (z === null) return;
    setCursorZ(z);

    if (isDragging) {
      applyAdjust(z, dragAction, undefined, bandWidth);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.5 : -0.5;
    setBandWidth(bandWidth + delta);
  };

  if (!isLayersActive || !profileData) {
    return null;
  }

  return (
    <div
      id="layer-height-tool"
      className="layer-height-tool"
      style={{
        position: 'fixed',
        top: 120,
        right: 16,
        background: 'rgba(24, 24, 27, 0.95)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: 10,
        padding: '12px 14px',
        color: 'var(--text-color)',
        width: 250,
        maxHeight: 'calc(100vh - 136px)',
        overflowY: 'auto',
        fontSize: '0.82rem',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)',
        zIndex: 40,
        userSelect: 'none'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '1.1rem' }}>{t("📏")}</span>
          <strong id="layers-panel-title" style={{ fontSize: '0.92rem', color: '#38bdf8' }}>
            {t("Variable Layer Height")}</strong>
        </div>
        <button
          id="layers-close-btn"
          onClick={stopEditing}
          title={t("Close tool")}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: '1rem',
            padding: '2px 6px'
          }}
        >
          ✕
        </button>
      </div>

      {/* Layer Stats */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          background: 'rgba(255, 255, 255, 0.05)',
          padding: '6px 8px',
          borderRadius: 6,
          marginBottom: 10,
          fontSize: '0.78rem'
        }}
      >
        <div>
          {t("Layers:")}<strong id="layers-count">{profileData.layerCount}</strong>
        </div>
        <div>
          {t("Height:")}<strong>{profileData.objectHeight.toFixed(1)}{t("mm")}</strong>
        </div>
        <div>
          {t("Nominal:")}<strong>{profileData.layerHeight.toFixed(2)}{t("mm")}</strong>
        </div>
      </div>

      {/* Adaptive Controls */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <button
            id="layers-adaptive-btn"
            disabled={isLoading}
            onClick={() => applyAdaptive()}
            style={{
              flex: 1,
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              padding: '5px 8px',
              fontSize: '0.8rem',
              fontWeight: 500,
              cursor: isLoading ? 'wait' : 'pointer'
            }}
          >
            {t("Adaptive")}</button>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            {t("Q:")}{(quality * 100).toFixed(0)}%
          </span>
        </div>
        <input
          id="layers-quality-slider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={quality}
          onChange={(e) => setQuality(parseFloat(e.target.value))}
          style={{ width: '100%', cursor: 'pointer' }}
        />
      </div>

      {/* Smooth Controls */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <button
            id="layers-smooth-btn"
            disabled={isLoading}
            onClick={() => applySmooth()}
            style={{
              flex: 1,
              background: '#475569',
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              padding: '5px 8px',
              fontSize: '0.8rem',
              fontWeight: 500,
              cursor: isLoading ? 'wait' : 'pointer'
            }}
          >
            {t("Smooth")}</button>
          <button
            id="layers-reset-btn"
            disabled={isLoading}
            onClick={() => applyReset()}
            style={{
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              padding: '5px 8px',
              fontSize: '0.8rem',
              fontWeight: 500,
              cursor: isLoading ? 'wait' : 'pointer'
            }}
          >
            {t("Reset")}</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{t("Radius:")}</span>
            <input
              id="layers-radius-input"
              type="number"
              min="1"
              max="20"
              value={radius}
              onChange={(e) => setRadius(parseInt(e.target.value, 10) || 5)}
              style={{
                width: 44,
                background: 'var(--panel-bg)',
                border: '1px solid var(--control-bg)',
                borderRadius: 4,
                color: '#fff',
                padding: '2px 4px',
                fontSize: '0.75rem'
              }}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: '0.75rem' }}>
            <input
              id="layers-keepmin-check"
              type="checkbox"
              checked={keepMin}
              onChange={(e) => setKeepMin(e.target.checked)}
            />
            {t("Keep Min")}</label>
        </div>
      </div>

      {/* Band Width Control */}
      <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
          {t("Brush Band:")}<strong id="layers-bandwidth-val">{bandWidth.toFixed(1)}{t("mm")}</strong>
        </span>
        <input
          id="layers-bandwidth-slider"
          type="range"
          min="0.5"
          max="10"
          step="0.5"
          value={bandWidth}
          onChange={(e) => setBandWidth(parseFloat(e.target.value))}
          style={{ width: 110, cursor: 'pointer' }}
        />
      </div>

      {/* Profile Bar Canvas */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
        <canvas
          id="layer-profile-canvas"
          ref={barCanvasRef}
          width={canvasWidth}
          height={canvasHeight}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            background: 'var(--canvas-bg)',
            borderRadius: 6,
            cursor: 'ns-resize',
            touchAction: 'none'
          }}
        />
      </div>

      {/* Brush Help Hint */}
      <div
        style={{
          marginTop: 8,
          fontSize: '0.7rem',
          color: '#94a3b8',
          textAlign: 'center',
          lineHeight: '1.3'
        }}
      >
        {t("Left drag: raise • Right drag: lower")}<br />
        {t("Shift drag: smooth • Wheel: band size")}</div>

      {error && (
        <div style={{ marginTop: 6, color: '#ef4444', fontSize: '0.72rem', textAlign: 'center' }}>
          {error}
        </div>
      )}
    </div>
  );
};
