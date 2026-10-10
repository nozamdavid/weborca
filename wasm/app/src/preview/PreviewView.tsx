/**
 * @file PreviewView.tsx
 * OrcaSlicer Web G-code Preview Screen.
 * Renders toolpaths via libvgcode WebGL2 with orbit/pan/zoom camera,
 * vertical layer slider, horizontal move slider, legend, and statistics.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { usePreviewStore } from './previewStore';
import * as previewModule from './orcaPreviewModule';
import { LayerSlider } from './LayerSlider';
import { MoveSlider } from './MoveSlider';
import { ViewTypeLegend } from './ViewTypeLegend';
import { SliceStatsPanel } from './SliceStatsPanel';
import { CustomGcodeDialog } from './CustomGcodeDialog';
import { PlateSelectorBar } from '../plates/PlateSelectorBar';

export const PreviewView: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // App store slice result
  const sliceResult = useAppStore((s) => s.sliceResult);
  const currentConfig = useAppStore((s) => s.currentConfig);
  const isSlicing = useAppStore((s) => s.isSlicing);
  const startSlice = useAppStore((s) => s.startSlice);

  // Preview store
  const isInitialized = usePreviewStore((s) => s.isInitialized);
  const setInitialized = usePreviewStore((s) => s.setInitialized);
  const loadGcodeBytes = usePreviewStore((s) => s.loadGcodeBytes);
  const layersCount = usePreviewStore((s) => s.layersCount);
  const resetCamera = usePreviewStore((s) => s.resetCameraAction);

  const [isLoadingModule, setIsLoadingModule] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const loadedGcodeRef = useRef<any>(null);

  // Handle canvas size and DPR
  const updateCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor((rect.width || 800) * dpr);
    const h = Math.floor((rect.height || 600) * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      previewModule.resize(w, h);
      previewModule.render();
    }
  }, []);

  // 1. Initialize Preview WebGL2 Context on Mount
  useEffect(() => {
    let mounted = true;
    const canvas = canvasRef.current;
    if (!canvas) return;

    async function init() {
      setIsLoadingModule(true);
      setInitError(null);
      try {
        await previewModule.getPreviewModule(canvas!);
        if (!mounted) return;
        await previewModule.initPreview(canvas!);
        if (!mounted) return;

        setInitialized(true);
        setIsLoadingModule(false);

        updateCanvasSize();
      } catch (err: any) {
        if (!mounted) return;
        setIsLoadingModule(false);
        setInitError(err.message || String(err));
        console.error('[OrcaPreview] Failed to initialize preview:', err);
      }
    }

    init();

    return () => {
      mounted = false;
      previewModule.disposePreview();
      setInitialized(false);
    };
  }, [setInitialized, updateCanvasSize]);

  // Update printable bed polygon from config
  useEffect(() => {
    if (!isInitialized || !currentConfig?.printable_area) return;
    const pairs = currentConfig.printable_area.split(',').map((pt: string) =>
      pt.trim().split('x').map(Number) as [number, number]);
    if (pairs.length >= 3 && pairs.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) {
      previewModule.setBedPolygon(pairs);
      previewModule.render();
    }
  }, [isInitialized, currentConfig?.printable_area]);

  // 2. Load G-code when slice result is available
  useEffect(() => {
    if (!isInitialized || !sliceResult?.gcode || isSlicing) return;
    if (loadedGcodeRef.current === sliceResult.gcode && previewModule.getLayersCount() > 0) {
      previewModule.render();
      return;
    }

    loadedGcodeRef.current = sliceResult.gcode;

    const tStart = performance.now();
    loadGcodeBytes(sliceResult.gcode, 'print.gcode')
      .then((stats) => {
        const elapsed = (performance.now() - tStart).toFixed(1);
        console.log(`[OrcaPreview] Loaded G-code in ${elapsed}ms:`, stats);
        updateCanvasSize();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const canvas = canvasRef.current;
          if (!canvas || loadedGcodeRef.current !== sliceResult.gcode) return;
          const sliceEnd = performance.getEntriesByName('orca-slice-end').at(-1);
          canvas.dataset.previewReady = 'true';
          const ms = sliceEnd ? (performance.now() - sliceEnd.startTime) : (performance.now() - tStart);
          canvas.dataset.sliceToFrameMs = String(ms);
          (window as any)._previewFirstFrameTime = performance.now();
        }));
      })
      .catch((err) => {
        setInitError(err.message || String(err));
        loadedGcodeRef.current = null;
        console.error('[OrcaPreview] Failed to load G-code data:', err);
      });
  }, [isInitialized, sliceResult, isSlicing, loadGcodeBytes, updateCanvasSize]);

  // 3. Resize listener
  useEffect(() => {
    const observer = new ResizeObserver(updateCanvasSize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateCanvasSize]);

  // 4. Mouse and pointer camera navigation (matching Prepare 3D view and desktop GLCanvas3D)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isDragging = false;
    let dragButton = 0;
    let lastX = 0;
    let lastY = 0;

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      dragButton = e.button;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (dragButton === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Orbit: Left drag without Shift. The module's yaw runs opposite to the Prepare view and desktop
        // (dragging right turns the model to the right), so the horizontal delta is negated.
        previewModule.orbit(-dx, dy);
      } else {
        // Pan: Right drag, Middle drag, or Shift + Left drag
        previewModule.pan(dx, dy);
      }
      previewModule.render();
    };

    const onPointerUp = (e: PointerEvent) => {
      isDragging = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
    };

    const onPointerCancel = () => {
      isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      previewModule.zoom(e.deltaY);
      previewModule.render();
    };

    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      id="orca-preview-view"
      className="preview-view"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#1e1e24'
      }}
    >
      {/* WebGL2 Preview Canvas - supports both #canvas and #preview-canvas selectors */}
      <canvas
        id="canvas"
        data-testid="preview-canvas"
        aria-label="G-code toolpaths"
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          outline: 'none',
          cursor: 'grab',
          touchAction: 'none'
        }}
      />

      {/* Floating Toolbar Controls (Top Center) */}
      <div
        id="preview-top-controls"
        style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 8,
          background: 'rgba(24, 24, 27, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 8,
          padding: '4px 8px',
          zIndex: 15
        }}
      >
        <button
          type="button"
          id="btn-reset-camera"
          onClick={resetCamera}
          title="Reset Camera View"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#e4e4e7',
            padding: '4px 8px',
            fontSize: '0.8rem',
            cursor: 'pointer',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          <span>🎯</span> Reset Camera
        </button>
      </div>

      {/* Outdated Slice Result Banner (prompting re-slice after layer events change) */}
      {sliceResult === null && layersCount > 0 && !isSlicing && (
        <div
          id="slice-outdated-banner"
          data-testid="slice-outdated-banner"
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'rgba(234, 88, 12, 0.92)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            borderRadius: 8,
            padding: '6px 14px',
            color: '#fff',
            zIndex: 25,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)'
          }}
        >
          <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
            ⚠️ Slice result is outdated. Please re-slice.
          </span>
          <button
            type="button"
            id="btn-reslice"
            data-testid="btn-reslice"
            onClick={() => startSlice()}
            style={{
              background: '#fff',
              color: '#ea580c',
              border: 'none',
              borderRadius: 4,
              padding: '4px 10px',
              fontWeight: 600,
              fontSize: '0.8rem',
              cursor: 'pointer'
            }}
          >
            Re-slice
          </button>
        </div>
      )}

      {/* Loading & Status Overlays */}
      {isLoadingModule && (
        <div
          id="preview-loading-overlay"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0, 0, 0, 0.8)',
            padding: '16px 24px',
            borderRadius: 8,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            zIndex: 30
          }}
        >
          <div className="spinner" style={{ width: 18, height: 18 }} />
          <span>Loading WebGL2 Preview Engine...</span>
        </div>
      )}

      {initError && (
        <div
          id="preview-error-overlay"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(185, 28, 28, 0.9)',
            padding: '16px 24px',
            borderRadius: 8,
            color: '#fff',
            maxWidth: 400,
            textAlign: 'center',
            zIndex: 30
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Preview Initialization Error</div>
          <div style={{ fontSize: '0.85rem' }}>{initError}</div>
        </div>
      )}

      {/* Empty State Prompt if not sliced yet */}
      {isInitialized && layersCount === 0 && !isLoadingModule && !initError && (
        <div
          id="preview-empty-prompt"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            color: '#94a3b8',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🧵</div>
          <p style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 500, color: '#e2e8f0' }}>
            No G-code toolpaths loaded
          </p>
          <span style={{ fontSize: '0.8rem' }}>Slice a model in Prepare screen to preview toolpaths</span>
        </div>
      )}

      {/* Interactive Controls & Panels */}
      {isInitialized && layersCount > 0 && (
        <>
          <ViewTypeLegend />
          <SliceStatsPanel />
          <MoveSlider />
          <PlateSelectorBar style={{ bottom: 68 }} />
          <LayerSlider />
        </>
      )}

      {/* Custom G-code Editor Dialog Modal */}
      <CustomGcodeDialog />
    </div>
  );
};
