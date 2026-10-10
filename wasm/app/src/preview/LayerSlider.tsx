/**
 * @file LayerSlider.tsx
 * Vertical layer range slider on the right matching OrcaSlicer desktop behavior.
 * Displays layer number, Z height in mm, and allows scrubbing through layers with
 * both upper handle (max visible layer) and lower handle (min visible layer).
 * Supports desktop-style per-layer events (pause, custom G-code) and tick marks.
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { usePreviewStore } from './previewStore';
import { usePlatesStore } from '../plates/platesStore';
import {
  useLayerEventsStore,
  findLayerForZ,
  getZForLayer
} from './layerEventsStore';
import './PreviewControls.css';
import { useTranslation } from "../i18n";

export const LayerSlider: React.FC = () => {
    const { t } = useTranslation();
  const layersCount = usePreviewStore((s) => s.layersCount);
  const layersZs = usePreviewStore((s) => s.layersZs);
  const minLayer = usePreviewStore((s) => s.minLayer);
  const maxLayer = usePreviewStore((s) => s.maxLayer);
  const setLayerRange = usePreviewStore((s) => s.setLayerRangeAction);
  const resetLayers = usePreviewStore((s) => s.resetLayersAction);

  // Per-plate layer events store
  const activePlateIndex = usePlatesStore((s) => s.activePlateIndex);
  const eventsByPlate = useLayerEventsStore((s) => s.eventsByPlate);
  const loadEventsForPlate = useLayerEventsStore((s) => s.loadEventsForPlate);
  const addPause = useLayerEventsStore((s) => s.addPause);
  const deleteEvent = useLayerEventsStore((s) => s.deleteEvent);
  const openCustomGcodeDialog = useLayerEventsStore((s) => s.openCustomGcodeDialog);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const dragEndTimeRef = useRef<number>(0);
  const activeGestureCleanupRef = useRef<(() => void) | null>(null);

  const maxPossible = Math.max(0, layersCount - 1);

  // Ensure layer events for active plate are loaded
  useEffect(() => {
    loadEventsForPlate(activePlateIndex);
  }, [activePlateIndex, loadEventsForPlate]);

  // Close menu on click outside
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#layer-event-menu') && !target.closest('#btn-add-layer-event')) {
        setIsMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handleClickOutside);
    return () => window.removeEventListener('pointerdown', handleClickOutside);
  }, [isMenuOpen]);

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

  // Current plate's events
  const plateEvents = eventsByPlate[activePlateIndex] || [];
  const currentZNum = layersZs[maxLayer] !== undefined ? layersZs[maxLayer] : (maxLayer + 1) * 0.2;
  const currentEvent = plateEvents.find((e) => {
    const l = findLayerForZ(e.printZ, layersZs);
    return l === maxLayer || Math.abs(e.printZ - currentZNum) < 1e-4;
  });
  const hasEventAtCurrent = !!currentEvent;

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
    if (
      target.closest('#layer-handle-max') ||
      target.closest('#layer-handle-min') ||
      target.closest('#btn-add-layer-event') ||
      target.closest('#layer-event-menu') ||
      target.closest('.layer-event-tick')
    ) {
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

  // Layer event handlers
  const handleAddPause = async () => {
    setIsMenuOpen(false);
    const z = getZForLayer(maxLayer, layersZs);
    await addPause(activePlateIndex, z, 'Pause print');
  };

  const handleOpenAddCustomGcode = () => {
    setIsMenuOpen(false);
    const z = getZForLayer(maxLayer, layersZs);
    openCustomGcodeDialog(activePlateIndex, z, maxLayer, '', false);
  };

  const handleOpenEditCustomGcode = () => {
    setIsMenuOpen(false);
    if (!currentEvent) return;
    openCustomGcodeDialog(
      activePlateIndex,
      currentEvent.printZ,
      maxLayer,
      currentEvent.gcode || currentEvent.extra || '',
      true
    );
  };

  const handleDeleteCurrentEvent = async () => {
    setIsMenuOpen(false);
    if (!currentEvent) return;
    await deleteEvent(activePlateIndex, currentEvent.printZ);
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
        zIndex: isMenuOpen ? 60 : 30,
        userSelect: 'none',
        width: 86,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)'
      }}
    >
      {/* Top Layer & Z Height Indicator Badge */}
      <div
        id="layer-indicator-top"
        title={t("Top visible layer")}
        style={{
          textAlign: 'center',
          marginBottom: 6,
          fontSize: '0.75rem',
          color: 'var(--text-color)'
        }}
      >
        <div style={{ fontWeight: 600, color: '#38bdf8' }} id="layer-current-number">
          L{maxLayer + 1}
        </div>
        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }} id="layer-current-z">
          {currentZ}{t("mm")}</div>
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
          width: 44,
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

        {/* Layer Event Tick Marks on the Rail */}
        {plateEvents.map((evt) => {
          const evtLayer = findLayerForZ(evt.printZ, layersZs);
          const evtPercent = maxPossible > 0 ? (evtLayer / maxPossible) * 100 : 0;

          return (
            <div
              key={`tick-${evt.printZ}`}
              id={`layer-tick-${evtLayer}`}
              data-testid={`layer-tick-${evtLayer}`}
              data-layer={evtLayer}
              data-type={evt.type}
              className={`layer-event-tick layer-event-tick-${evt.type}`}
              title={`${evt.type === 'pause' ? 'Pause' : 'Custom G-code'} at Layer ${evtLayer + 1} (${evt.printZ.toFixed(2)}mm)`}
              onClick={(e) => {
                e.stopPropagation();
                setLayerRange(minLayer, evtLayer);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setLayerRange(minLayer, evtLayer);
                setIsMenuOpen(true);
              }}
              style={{
                position: 'absolute',
                bottom: `calc(${evtPercent}% - 6px)`,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 36,
                height: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                zIndex: 6
              }}
            >
              {/* Tick horizontal line */}
              <div
                style={{
                  width: 14,
                  height: 3,
                  background: evt.type === 'pause' ? '#f97316' : '#8b5cf6',
                  borderRadius: 2,
                  boxShadow: evt.type === 'pause' ? '0 0 4px #f97316' : '0 0 4px #8b5cf6'
                }}
              />
              {/* Event Badge Icon on the left */}
              <span
                style={{
                  position: 'absolute',
                  left: -8,
                  fontSize: '0.65rem',
                  lineHeight: 1
                }}
              >
                {evt.type === 'pause' ? '⏸' : '⚙'}
              </span>

              {/* Direct Delete button on hover/focus */}
              <button
                type="button"
                id={`btn-delete-tick-${evtLayer}`}
                data-testid={`btn-delete-tick-${evtLayer}`}
                className="tick-action-btn"
                title={`Delete ${evt.type === 'pause' ? 'pause' : 'custom G-code'} at L${evtLayer + 1}`}
                style={{ position: 'absolute', right: -12 }}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteEvent(activePlateIndex, evt.printZ);
                }}
              >
                {t("&times;")}</button>

              {/* Direct Edit button on hover if custom G-code */}
              {evt.type === 'custom' && (
                <button
                  type="button"
                  id={`btn-edit-tick-${evtLayer}`}
                  data-testid={`btn-edit-tick-${evtLayer}`}
                  className="tick-action-btn edit"
                  title={`Edit custom G-code at L${evtLayer + 1}`}
                  style={{ position: 'absolute', right: 4 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openCustomGcodeDialog(
                      activePlateIndex,
                      evt.printZ,
                      evtLayer,
                      evt.gcode || evt.extra || '',
                      true
                    );
                  }}
                >
                  ✎
                </button>
              )}
            </div>
          );
        })}

        {/* Upper Handle (controls max visible layer) */}
        <div
          id="layer-handle-max"
          data-testid="layer-handle-max"
          role="slider"
          tabIndex={0}
          aria-label={t("Top visible layer")}
          aria-orientation="vertical"
          aria-valuemin={minLayer + 1}
          aria-valuemax={layersCount}
          aria-valuenow={maxLayer + 1}
          aria-valuetext={`Layer ${maxLayer + 1}, ${currentZ}mm`}
          onKeyDown={handleKeyDownMax}
          onPointerDown={(e) => handlePointerDown('max', e)}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsMenuOpen(true);
          }}
          title={`Top layer ${maxLayer + 1} (${currentZ}mm) - Drag down to peel layers, right-click for events`}
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
            zIndex: 8,
            touchAction: 'none'
          }}
        >
          <div style={{ width: 8, height: 2, background: '#0f172a', borderRadius: 1 }} />
        </div>

        {/* Add Event / Action Control next to Upper Handle */}
        <button
          type="button"
          id="btn-add-layer-event"
          data-testid="btn-add-layer-event"
          aria-label={hasEventAtCurrent ? 'Manage layer event' : 'Add layer event'}
          title={
            hasEventAtCurrent
              ? `${currentEvent.type === 'pause' ? 'Pause' : 'Custom G-code'} at L${maxLayer + 1} - click for options`
              : `Add event at layer ${maxLayer + 1} (${currentZ}mm)`
          }
          onClick={(e) => {
            e.stopPropagation();
            setIsMenuOpen((prev) => !prev);
          }}
          style={{
            position: 'absolute',
            bottom: `calc(${topPercent}% - 9px)`,
            left: 'calc(50% + 15px)',
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: hasEventAtCurrent
              ? currentEvent?.type === 'pause'
                ? '#f97316'
                : '#8b5cf6'
              : '#009688',
            color: '#fff',
            border: '1px solid rgba(255, 255, 255, 0.5)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: hasEventAtCurrent ? '0.65rem' : '0.85rem',
            fontWeight: 'bold',
            zIndex: 10,
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.4)',
            padding: 0,
            lineHeight: 1
          }}
        >
          {hasEventAtCurrent ? (currentEvent?.type === 'pause' ? '⏸' : '⚙') : '+'}
        </button>

        {/* Context Menu Popup for Adding / Managing Events */}
        {isMenuOpen && (
          <div
            id="layer-event-menu"
            data-testid="layer-event-menu"
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              right: 'calc(100% + 8px)',
              bottom: `calc(${topPercent}% - 24px)`,
              background: 'var(--panel-bg)',
              border: '1px solid rgba(255, 255, 255, 0.18)',
              borderRadius: 6,
              padding: '4px 0',
              minWidth: 165,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
              zIndex: 50,
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {!hasEventAtCurrent ? (
              <>
                <div
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.7rem',
                    color: '#94a3b8',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
                  }}
                >
                  {t("Layer")}{maxLayer + 1} ({currentZ}{t("mm)")}</div>
                <button
                  type="button"
                  id="btn-add-pause"
                  data-testid="btn-add-pause"
                  className="layer-event-menu-item"
                  onClick={handleAddPause}
                >
                  <span style={{ marginRight: 6 }}>⏸</span> {t("Add pause")}</button>
                <button
                  type="button"
                  id="btn-add-custom-gcode"
                  data-testid="btn-add-custom-gcode"
                  className="layer-event-menu-item"
                  onClick={handleOpenAddCustomGcode}
                >
                  <span style={{ marginRight: 6 }}>⚙</span> {t("Add custom G-code")}</button>
                <button
                  type="button"
                  id="btn-add-color-change"
                  data-testid="btn-add-color-change"
                  className="layer-event-menu-item disabled"
                  disabled
                  title={t("Color change is not supported yet")}
                >
                  <span style={{ marginRight: 6 }}>{t("🎨")}</span> {t("Change filament")}</button>
              </>
            ) : (
              <>
                <div
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.7rem',
                    color: '#94a3b8',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
                  }}
                >
                  {t("Layer")}{maxLayer + 1}: {currentEvent.type === 'pause' ? 'Pause' : 'Custom G-code'}
                </div>
                {currentEvent.type === 'custom' && (
                  <button
                    type="button"
                    id="btn-edit-custom-gcode"
                    data-testid="btn-edit-custom-gcode"
                    className="layer-event-menu-item"
                    onClick={handleOpenEditCustomGcode}
                  >
                    <span style={{ marginRight: 6 }}>✎</span> {t("Edit custom G-code")}</button>
                )}
                <button
                  type="button"
                  id={currentEvent.type === 'pause' ? 'btn-delete-pause' : 'btn-delete-custom-gcode'}
                  data-testid={currentEvent.type === 'pause' ? 'btn-delete-pause' : 'btn-delete-custom-gcode'}
                  className="layer-event-menu-item delete"
                  onClick={handleDeleteCurrentEvent}
                >
                  <span style={{ marginRight: 6 }}>{t("🗑")}</span>{' '}
                  {currentEvent.type === 'pause' ? 'Delete pause' : 'Delete custom G-code'}
                </button>
              </>
            )}
          </div>
        )}

        {/* Lower Handle (controls min visible layer) */}
        <div
          id="layer-handle-min"
          data-testid="layer-handle-min"
          role="slider"
          tabIndex={0}
          aria-label={t("Bottom visible layer")}
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
          aria-label={t("Top visible layer")}
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
          aria-label={t("Bottom visible layer")}
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
        title={t("Bottom visible layer")}
        style={{
          textAlign: 'center',
          marginTop: 6,
          fontSize: '0.7rem',
          color: 'var(--text-muted)'
        }}
      >
        <div style={{ fontWeight: 500, color: '#f59e0b' }}>L{minLayer + 1}</div>
        <div>{minZ}{t("mm")}</div>
      </div>

      {/* Reset Layers Button */}
      <button
        type="button"
        id="btn-reset-layers"
        onClick={resetLayers}
        title={t("Reset layer range (All layers)")}
        style={{
          marginTop: 8,
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 4,
          color: 'var(--text-color)',
          padding: '3px 8px',
          fontSize: '0.7rem',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'center'
        }}
      >
        {t("All")}</button>

      {/* Total layers count label */}
      <div
        id="layer-total-count"
        style={{
          marginTop: 4,
          fontSize: '0.65rem',
          color: 'var(--text-dim)',
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
