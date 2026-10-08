/**
 * @file LayerSlider.tsx
 * Vertical layer range slider on the right matching OrcaSlicer desktop behavior.
 * Displays layer number, Z height in mm, and allows scrubbing through layers with
 * both upper handle (max visible layer) and lower handle (min visible layer).
 */

import React, { useRef, useCallback, useEffect } from 'react';
import { usePreviewStore } from './previewStore';
import './PreviewControls.css';

export const LayerSlider: React.FC = () => {
  const layersCount = usePreviewStore((s) => s.layersCount);
  const layersZs = usePreviewStore((s) => s.layersZs);
  const minLayer = usePreviewStore((s) => s.minLayer);
  const maxLayer = usePreviewStore((s) => s.maxLayer);
  const setLayerRange = usePreviewStore((s) => s.setLayerRangeAction);
  const resetLayers = usePreviewStore((s) => s.resetLayersAction);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const dragEndTimeRef = useRef<number>(0);
  const activeGestureCleanupRef = useRef<(() => void) | null>(null);

  const maxPossible = Math.max(0, layersCount - 1);

  const getLayerFromPointerY = useCallback((clientY: number): number => {
    if (!trackRef.current || maxPossible <= 0) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    const fraction = 1 - Math.max(0, Math.min(1, relativeY / rect.height));
    return Math.round(fraction * maxPossible);
  }, [maxPossible]);

  // Teardown any active drag gesture on unmount or when layers reset
  useEffect(() => {
    if (layersCount <= 0 && activeGestureCleanupRef.current) {
      activeGestureCleanupRef.current();
    }
    return () => {
      if (activeGestureCleanupRef.current) {
        activeGestureCleanupRef.current();
      }
    };
  }, [layersCount]);

  // Hook ordering: ensure all hooks are called before early return for layersCount <= 0
  if (layersCount <= 0) return null;

  const currentZ = layersZs[maxLayer] !== undefined ? layersZs[maxLayer].toFixed(2) : '0.00';
  const minZ = layersZs[minLayer] !== undefined ? layersZs[minLayer].toFixed(2) : '0.00';

  // Handle position percentages: bottom is 0% (layer 0), top is 100% (layer maxPossible)
  const topPercent = maxPossible > 0 ? (maxLayer / maxPossible) * 100 : 100;
  const bottomPercent = maxPossible > 0 ? (minLayer / maxPossible) * 100 : 0;

  const handleMaxInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setLayerRange(Math.min(minLayer, val), val);
  };

  const handleMinInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setLayerRange(val, Math.max(val, maxLayer));
  };

  const handleKeyDownMax = (e: React.KeyboardEvent) => {
    let newMax = maxLayer;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      newMax = Math.min(maxPossible, maxLayer + 1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      newMax = Math.max(minLayer, maxLayer - 1);
    } else if (e.key === 'Home') {
      newMax = minLayer;
    } else if (e.key === 'End') {
      newMax = maxPossible;
    } else if (e.key === 'PageUp') {
      newMax = Math.min(maxPossible, maxLayer + 10);
    } else if (e.key === 'PageDown') {
      newMax = Math.max(minLayer, maxLayer - 10);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setLayerRange(minLayer, newMax);
  };

  const handleKeyDownMin = (e: React.KeyboardEvent) => {
    let newMin = minLayer;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      newMin = Math.min(maxLayer, minLayer + 1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      newMin = Math.max(0, minLayer - 1);
    } else if (e.key === 'Home') {
      newMin = 0;
    } else if (e.key === 'End') {
      newMin = maxLayer;
    } else if (e.key === 'PageUp') {
      newMin = Math.min(maxLayer, minLayer + 10);
    } else if (e.key === 'PageDown') {
      newMin = Math.max(0, minLayer - 10);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setLayerRange(newMin, maxLayer);
  };

  const handlePointerDown = (handleType: 'max' | 'min', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Clean up any existing active gesture first
    if (activeGestureCleanupRef.current) {
      activeGestureCleanupRef.current();
    }

    const target = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;

    try {
      target.setPointerCapture(pointerId);
    } catch (_) {}

    isDraggingRef.current = true;
    didDragRef.current = false;

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      didDragRef.current = true;
      const layer = getLayerFromPointerY(ev.clientY);
      const state = usePreviewStore.getState();
      if (handleType === 'max') {
        const newMax = Math.max(state.minLayer, layer);
        state.setLayerRangeAction(state.minLayer, newMax);
      } else {
        const newMin = Math.min(state.maxLayer, layer);
        state.setLayerRangeAction(newMin, state.maxLayer);
      }
    };

    const cleanup = () => {
      if (activeGestureCleanupRef.current === cleanup) {
        activeGestureCleanupRef.current = null;
      }
      isDraggingRef.current = false;
      if (didDragRef.current) {
        dragEndTimeRef.current = Date.now();
        didDragRef.current = false;
      }
      try {
        if (target.hasPointerCapture(pointerId)) {
          target.releasePointerCapture(pointerId);
        }
      } catch (_) {}
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      target.removeEventListener('lostpointercapture', onLostPointerCapture);
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
    };

    const onPointerCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
    };

    const onLostPointerCapture = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) {
        cleanup();
      }
    };

    activeGestureCleanupRef.current = cleanup;

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    target.addEventListener('lostpointercapture', onLostPointerCapture);
  };

  // Clicking on track jumps nearest handle, ignoring post-drag clicks
  const handleTrackClick = (e: React.MouseEvent) => {
    if (isDraggingRef.current || didDragRef.current || (dragEndTimeRef.current > 0 && Date.now() - dragEndTimeRef.current < 200)) {
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest('#layer-handle-max') || target.closest('#layer-handle-min')) {
      return;
    }
    const layer = getLayerFromPointerY(e.clientY);
    const distToMin = Math.abs(layer - minLayer);
    const distToMax = Math.abs(layer - maxLayer);
    if (layer < minLayer) {
      setLayerRange(layer, maxLayer);
    } else if (layer > maxLayer) {
      setLayerRange(minLayer, layer);
    } else if (distToMin < distToMax) {
      setLayerRange(layer, maxLayer);
    } else {
      setLayerRange(minLayer, layer);
    }
  };

  return (
    <div
      id="layer-slider-container"
      className="layer-slider-vertical"
      style={{
        position: 'absolute',
        top: 60,
        right: 16,
        bottom: 70,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'rgba(24, 24, 27, 0.88)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 8,
        padding: '10px 8px',
        zIndex: 20,
        userSelect: 'none',
        width: 76,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)'
      }}
    >
      {/* Top Layer & Z Height Indicator Badge */}
      <div
        id="layer-indicator-top"
        title="Top visible layer"
        style={{
          textAlign: 'center',
          marginBottom: 6,
          fontSize: '0.75rem',
          color: '#e4e4e7'
        }}
      >
        <div style={{ fontWeight: 600, color: '#38bdf8' }} id="layer-current-number">
          L{maxLayer + 1}
        </div>
        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }} id="layer-current-z">
          {currentZ}mm
        </div>
      </div>

      {/* Dual Handle Vertical Track Area */}
      <div
        ref={trackRef}
        id="layer-slider-track"
        data-testid="layer-slider-track"
        onClick={handleTrackClick}
        style={{
          position: 'relative',
          flex: 1,
          width: 32,
          display: 'flex',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: '8px 0'
        }}
      >
        {/* Background Rail Groove */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: 4,
            background: 'rgba(255, 255, 255, 0.15)',
            borderRadius: 2
          }}
        />

        {/* Active Range Bar (between minLayer and maxLayer) */}
        <div
          style={{
            position: 'absolute',
            bottom: `${bottomPercent}%`,
            height: `${Math.max(0, topPercent - bottomPercent)}%`,
            width: 6,
            background: '#009688',
            borderRadius: 3,
            boxShadow: '0 0 6px rgba(0, 150, 136, 0.5)'
          }}
        />

        {/* Upper Handle (controls max visible layer) */}
        <div
          id="layer-handle-max"
          data-testid="layer-handle-max"
          role="slider"
          tabIndex={0}
          aria-label="Top visible layer"
          aria-orientation="vertical"
          aria-valuemin={minLayer + 1}
          aria-valuemax={layersCount}
          aria-valuenow={maxLayer + 1}
          aria-valuetext={`Layer ${maxLayer + 1}, ${currentZ}mm`}
          onKeyDown={handleKeyDownMax}
          onPointerDown={(e) => handlePointerDown('max', e)}
          onClick={(e) => e.stopPropagation()}
          title={`Top layer ${maxLayer + 1} (${currentZ}mm) - Drag down to peel layers`}
          className="layer-handle"
          style={{
            position: 'absolute',
            bottom: `calc(${topPercent}% - 8px)`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 22,
            height: 16,
            background: '#38bdf8',
            border: '2px solid #ffffff',
            borderRadius: 4,
            cursor: 'ns-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.5)',
            zIndex: 5,
            touchAction: 'none'
          }}
        >
          <div style={{ width: 8, height: 2, background: '#0f172a', borderRadius: 1 }} />
        </div>

        {/* Lower Handle (controls min visible layer) */}
        <div
          id="layer-handle-min"
          data-testid="layer-handle-min"
          role="slider"
          tabIndex={0}
          aria-label="Bottom visible layer"
          aria-orientation="vertical"
          aria-valuemin={1}
          aria-valuemax={maxLayer + 1}
          aria-valuenow={minLayer + 1}
          aria-valuetext={`Layer ${minLayer + 1}, ${minZ}mm`}
          onKeyDown={handleKeyDownMin}
          onPointerDown={(e) => handlePointerDown('min', e)}
          onClick={(e) => e.stopPropagation()}
          title={`Bottom layer ${minLayer + 1} (${minZ}mm) - Drag up to peel from bottom`}
          className="layer-handle"
          style={{
            position: 'absolute',
            bottom: `calc(${bottomPercent}% - 8px)`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 22,
            height: 16,
            background: '#f59e0b',
            border: '2px solid #ffffff',
            borderRadius: 4,
            cursor: 'ns-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.5)',
            zIndex: 4,
            touchAction: 'none'
          }}
        >
          <div style={{ width: 8, height: 2, background: '#0f172a', borderRadius: 1 }} />
        </div>

        {/* Accessible hidden HTML range inputs for test compatibility */}
        <input
          type="range"
          id="layer-slider-max"
          data-testid="layer-slider-max"
          aria-label="Top visible layer"
          min={0}
          max={maxPossible}
          value={maxLayer}
          onChange={handleMaxInputChange}
          style={{
            position: 'absolute',
            opacity: 0,
            pointerEvents: 'none',
            width: 1,
            height: 1
          }}
        />
        <input
          type="range"
          id="layer-slider-min"
          data-testid="layer-slider-min"
          aria-label="Bottom visible layer"
          min={0}
          max={maxPossible}
          value={minLayer}
          onChange={handleMinInputChange}
          style={{
            position: 'absolute',
            opacity: 0,
            pointerEvents: 'none',
            width: 1,
            height: 1
          }}
        />
      </div>

      {/* Bottom Layer Indicator Badge */}
      <div
        id="layer-indicator-bottom"
        title="Bottom visible layer"
        style={{
          textAlign: 'center',
          marginTop: 6,
          fontSize: '0.7rem',
          color: '#a1a1aa'
        }}
      >
        <div style={{ fontWeight: 500, color: '#f59e0b' }}>L{minLayer + 1}</div>
        <div>{minZ}mm</div>
      </div>

      {/* Reset Layers Button */}
      <button
        type="button"
        id="btn-reset-layers"
        onClick={resetLayers}
        title="Reset layer range (All layers)"
        style={{
          marginTop: 8,
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 4,
          color: '#e4e4e7',
          padding: '3px 8px',
          fontSize: '0.7rem',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'center'
        }}
      >
        All
      </button>

      {/* Total layers count label */}
      <div
        id="layer-total-count"
        style={{
          marginTop: 4,
          fontSize: '0.65rem',
          color: '#71717a',
          textAlign: 'center'
        }}
      >
        /{layersCount}
      </div>
    </div>
  );
};

if (typeof window !== 'undefined') {
  (window as any).__previewStore = usePreviewStore;
}
