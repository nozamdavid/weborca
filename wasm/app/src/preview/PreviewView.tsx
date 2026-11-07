/**
 * @file PreviewView.tsx
 * OrcaSlicer Web G-code Preview Screen.
 * Renders toolpaths via libvgcode WebGL2 with orbit/pan/zoom camera,
 * vertical layer slider, horizontal move slider, legend, and statistics.
 */

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { bindCanvasTouch } from '../components/canvasTouch';
import { useAppStore } from '../store/appStore';
import { usePrefsStore } from '../prefs/prefsStore';
import { usePreviewStore } from './previewStore';
import * as previewModule from './orcaPreviewModule';
import { LayerSlider } from './LayerSlider';
import { MoveSlider } from './MoveSlider';
import { ViewTypeLegend } from './ViewTypeLegend';
import { SliceStatsPanel } from './SliceStatsPanel';
import { CustomGcodeDialog } from './CustomGcodeDialog';
import { PlateSelectorBar } from '../plates/PlateSelectorBar';
import { GCodeWindow } from './GCodeWindow';
import { resolveBedAssets } from '../plate/bedAssets';
import { displayBedOutline, loadBedModelOutline } from '../plate/bedModelOutline';
import { useTranslation } from "../i18n";
import { useMobile } from '../mobile/useMobile';
import { MobilePreview } from './MobilePreview';
import { Icon } from '../shell/Icon';
import './PreviewPerformance.css';

export const PreviewView: React.FC<{ active?: boolean }> = ({ active = true }) => {
  const mobile = useMobile();
    const { t } = useTranslation();
  const lowQuality = usePrefsStore((s) => s.display.previewLowQuality);
  const lightingEnabled = usePrefsStore((s) => s.display.previewLighting);
  const showFps = usePrefsStore((s) => s.display.previewShowFps);
  const setDisplayPref = usePrefsStore((s) => s.setDisplayPref);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // App store slice result
  const sliceResult = useAppStore((s) => s.sliceResult);
  const currentConfig = useAppStore((s) => s.currentConfig);
  const vendor = useAppStore((s) => s.selectedVendor);
  const printer = useAppStore((s) => s.selectedPrinter);
  const userPresets = useAppStore((s) => s.userPresets);
  const bedConfigLoading = useAppStore((s) => !s.isEngineReady || s.isSelectingPreset || s.isModelLoading);
  const [bedReady, setBedReady] = useState(false);
  const isSlicing = useAppStore((s) => s.isSlicing);
  const startSlice = useAppStore((s) => s.startSlice);

  // Preview store
  const isInitialized = usePreviewStore((s) => s.isInitialized);
  const setInitialized = usePreviewStore((s) => s.setInitialized);
  const loadGcodeBytes = usePreviewStore((s) => s.loadGcodeBytes);
  const layersCount = usePreviewStore((s) => s.layersCount);
  const resetCameraAction = usePreviewStore((s) => s.resetCameraAction);
  const resetCamera = useCallback(() => {
    resetCameraAction();
    const rect = canvasRef.current?.getBoundingClientRect();
    // Native framing uses vertical FOV; a portrait canvas needs more distance
    // to keep the same bounds inside its narrower horizontal FOV.
    if (mobile && rect?.width && rect.height > rect.width) {
      previewModule.zoom(1000 * (rect.height / rect.width - 1));
      previewModule.requestRender();
    }
  }, [mobile, resetCameraAction]);
  const showGcodeWindow = usePreviewStore((s) => s.showGcodeWindow);
  const toggleGcodeWindow = usePreviewStore((s) => s.toggleGcodeWindowAction);
  const resetVersion = usePreviewStore((s) => s.resetVersion);

  const observePerformance = useCallback((notify: () => void) => {
    let unsubscribe: (() => void) | undefined;
    const observe = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      if (showFps && active && isInitialized && !document.hidden) {
        unsubscribe = previewModule.subscribePerformance(notify);
      }
    };
    observe();
    document.addEventListener('visibilitychange', observe);
    return () => {
      document.removeEventListener('visibilitychange', observe);
      unsubscribe?.();
    };
  }, [showFps, active, isInitialized, mobile]);
  const performanceSample = useSyncExternalStore(observePerformance, previewModule.getPerformanceSnapshot);

  const performanceOverlay = showFps && active && <div className="preview-performance" data-testid="preview-performance"
    title={t('Completed Preview draws per second and CPU render submission time; GPU time is not measured')}>
    <span>{performanceSample.idle ? t('Idle') : performanceSample.fps === null ? '— FPS' : `${performanceSample.fps.toFixed(0)} FPS`}</span>
    <span>CPU {performanceSample.cpuMs === null ? '—' : performanceSample.cpuMs.toFixed(1)} ms</span>
  </div>;

  const [isLoadingModule, setIsLoadingModule] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const loadedGcodeRef = useRef<WeakRef<Uint8Array> | null>(null);

  useEffect(() => {
    if (resetVersion === 0) return;
    loadedGcodeRef.current = null;
    // A successful empty-project reset clears load errors, while initialization
    // errors remain actionable if the WebGL module never initialized.
    if (isInitialized) setInitError(null);
    const canvas = canvasRef.current;
    if (canvas) {
      delete canvas.dataset.previewReady;
      delete canvas.dataset.sliceToFrameMs;
    }
  }, [resetVersion, isInitialized]);

  // Handle canvas size and DPR
  const updateCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = usePrefsStore.getState().display.previewLowQuality ? 1 : window.devicePixelRatio || 1;
    const w = Math.floor((rect.width || 800) * dpr);
    const h = Math.floor((rect.height || 600) * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      previewModule.resize(w, h);
      previewModule.requestRender();
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
        previewModule.setLowQuality(usePrefsStore.getState().display.previewLowQuality);
        previewModule.setLightingEnabled(usePrefsStore.getState().display.previewLighting);
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
      loadedGcodeRef.current = null;
      usePreviewStore.getState().resetGcodeAction();
      previewModule.disposePreview();
      setInitialized(false);
    };
  }, [setInitialized, updateCanvasSize, mobile]);

  useEffect(() => {
    previewModule.setLowQuality(lowQuality);
    if (!isInitialized) return;
    updateCanvasSize();
    usePreviewStore.setState({ legend: previewModule.getLegendData() });
    previewModule.requestRender();
  }, [lowQuality, isInitialized, updateCanvasSize]);

  useEffect(() => {
    previewModule.setLightingEnabled(lightingEnabled);
    if (isInitialized) previewModule.requestRender();
  }, [lightingEnabled, isInitialized]);

  // Resolve the same decorative footprint as Prepare before showing the bed.
  useLayoutEffect(() => {
    setBedReady(false);
  }, [bedConfigLoading, isInitialized, vendor, printer, userPresets, currentConfig?.printable_area, currentConfig?.bed_custom_model]);
  useEffect(() => {
    if (bedConfigLoading || !isInitialized || !currentConfig?.printable_area) return;
    let cancelled = false;
    setBedReady(false);
    const points = currentConfig.printable_area.split(',').map((pt: string) =>
      pt.trim().split('x').map(Number) as [number, number]);
    if (points.length < 3 || !points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return;
    const systemPrinter = userPresets.find(p => p.kind === 'printer' && p.name === printer)?.inherits || printer;
    async function updateBed() {
      let outline = points;
      try {
        const assets = await resolveBedAssets(vendor, systemPrinter, { model: currentConfig.bed_custom_model || undefined });
        if (assets.model) outline = displayBedOutline(points, await loadBedModelOutline(assets.model));
      } catch (error) { console.warn('[Bed assets]', error); }
      if (cancelled) return;
      previewModule.setBedPolygon(outline);
      previewModule.requestRender();
      setBedReady(true);
    }
    void updateBed();
    return () => { cancelled = true; };
  }, [bedConfigLoading, isInitialized, vendor, printer, userPresets, currentConfig?.printable_area, currentConfig?.bed_custom_model]);

  // 2. Load G-code when slice result is available
  useEffect(() => {
    if (!isInitialized || !sliceResult?.gcode || isSlicing || (mobile && !active)) return;
    setInitError(null);
    const tStart = performance.now();
    const markFrameReady = () => {
      updateCanvasSize();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        if (!canvas || loadedGcodeRef.current?.deref() !== sliceResult.gcode) return;
        const sliceEnd = performance.getEntriesByName('orca-slice-end').at(-1);
        canvas.dataset.previewReady = 'true';
        const ms = sliceEnd ? (performance.now() - sliceEnd.startTime) : (performance.now() - tStart);
        canvas.dataset.sliceToFrameMs = String(ms);
        (window as any)._previewFirstFrameTime = performance.now();
      }));
    };
    if ((loadedGcodeRef.current?.deref() === sliceResult.gcode || previewModule.isGcodeLoaded(sliceResult.gcode))
      && previewModule.getLayersCount() > 0) {
      if (mobile && loadedGcodeRef.current?.deref() !== sliceResult.gcode) resetCamera();
      loadedGcodeRef.current = new WeakRef(sliceResult.gcode);
      previewModule.requestRender();
      markFrameReady();
      return;
    }

    loadedGcodeRef.current = new WeakRef(sliceResult.gcode);

    loadGcodeBytes(sliceResult.gcode, 'print.gcode')
      .then((stats) => {
        const elapsed = (performance.now() - tStart).toFixed(1);
        console.log(`[OrcaPreview] Loaded G-code in ${elapsed}ms:`, stats);
        if (mobile) resetCamera();
        markFrameReady();
      })
      .catch((err) => {
        setInitError(err.message || String(err));
        loadedGcodeRef.current = null;
        console.error('[OrcaPreview] Failed to load G-code data:', err);
      });
  }, [isInitialized, sliceResult, isSlicing, loadGcodeBytes, updateCanvasSize, mobile, resetCamera, active]);

  // 3. Resize listener
  useLayoutEffect(() => {
    const view = containerRef.current;
    const controls = view?.querySelector<HTMLElement>('#preview-top-controls');
    if (!view || !controls) return;
    const reserveControls = () => view.style.setProperty('--preview-controls-clearance', `${controls.offsetTop + controls.offsetHeight + 12}px`);
    reserveControls();
    const observer = new ResizeObserver(reserveControls);
    observer.observe(controls);
    return () => { observer.disconnect(); view.style.removeProperty('--preview-controls-clearance'); };
  }, [mobile]);

  useEffect(() => {
    const observer = new ResizeObserver(updateCanvasSize);
    if (containerRef.current) observer.observe(containerRef.current);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [updateCanvasSize, mobile]);

  // Keyboard shortcut: 'C' toggles G-code window matching desktop OrcaSlicer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'c' || e.key === 'C') {
        if (layersCount > 0) {
          toggleGcodeWindow();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layersCount, toggleGcodeWindow]);

  // 4. Mouse and pointer camera navigation (matching Prepare 3D view and desktop GLCanvas3D)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isDragging = false;
    let dragButton = 0;
    let lastX = 0;
    let lastY = 0;
    const disposeTouch = bindCanvasTouch(canvas, {
      move: (dx, dy, ratio, fingers) => {
        if (fingers === 1) previewModule.orbit(-dx, dy);
        else {
          previewModule.zoom((1 / ratio - 1) * 1000);
          previewModule.pan(dx, dy);
        }
        previewModule.requestRender();
      }
    });

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      isDragging = true;
      dragButton = e.button;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
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
      previewModule.requestRender();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
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
      previewModule.requestRender();
    };

    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('lostpointercapture', onPointerCancel);
    window.addEventListener('blur', onPointerCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      disposeTouch();
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('lostpointercapture', onPointerCancel);
      window.removeEventListener('blur', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [mobile]);

  if (mobile) return <div ref={containerRef} id="orca-preview-view" className="preview-view mobile-preview mp-root">
    <MobilePreview active={active} loading={isLoadingModule} error={initError} resetCamera={resetCamera} canvas={
      <><canvas id="canvas" data-testid="preview-canvas" aria-label={t('G-code toolpaths')} ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', outline: 'none', visibility: bedReady || layersCount > 0 ? 'visible' : 'hidden', cursor: 'grab', touchAction: 'none' }} />
      {performanceOverlay}</>
    } />
    <CustomGcodeDialog />
  </div>;

  return (
    <div
      ref={containerRef}
      id="orca-preview-view"
      className={`preview-view ${mobile ? 'mobile-preview' : ''}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--canvas-bg)'
      }}
    >
      {/* WebGL2 Preview Canvas - supports both #canvas and #preview-canvas selectors */}
      <canvas
        id="canvas"
        data-testid="preview-canvas"
        aria-label={t("G-code toolpaths")}
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          outline: 'none',
          visibility: bedReady ? 'visible' : 'hidden',
          cursor: 'grab',
          touchAction: 'none'
        }}
      />

      {performanceOverlay}

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
          background: 'var(--surface-overlay)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          padding: '4px 8px',
          zIndex: 15
        }}
      >
        <button
          type="button"
          id="btn-reset-camera"
          onClick={resetCamera}
          title={t("Reset Camera View")}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-color)',
            padding: '4px 8px',
            fontSize: '0.8rem',
            cursor: 'pointer',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          <Icon name="toolbar_orient" size={16} /> {t("Reset Camera")}</button>
        <label
          title={t("Reduce preview detail and resolution for faster navigation")}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: '0.8rem', color: 'var(--text-color)', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          <input
            type="checkbox"
            id="preview-low-quality"
            data-testid="preview-low-quality"
            checked={lowQuality}
            onChange={(event) => setDisplayPref('previewLowQuality', event.target.checked)}
          />
          {t("Low quality")}
        </label>
        <label className="preview-lighting-toggle">
          <input
            type="checkbox"
            id="preview-lighting"
            checked={lightingEnabled}
            onChange={(event) => setDisplayPref('previewLighting', event.target.checked)}
          />
          {t("Lighting & shadows")}
        </label>
        <label className="preview-fps-toggle">
          <input type="checkbox" id="preview-show-fps" checked={showFps}
            onChange={event => setDisplayPref('previewShowFps', event.target.checked)} />
          {t('Show FPS')}
        </label>
        <button
          type="button"
          id="btn-toggle-gcode-window"
          data-testid="btn-toggle-gcode-window"
          onClick={toggleGcodeWindow}
          disabled={layersCount === 0}
          title={showGcodeWindow ? 'Hide G-code Window (C)' : 'Show G-code Window (C)'}
          style={{
            background: showGcodeWindow ? 'var(--accent-subtle)' : 'transparent',
            border: showGcodeWindow ? '1px solid var(--accent)' : 'none',
            color: layersCount === 0 ? 'var(--text-dim)' : 'var(--text-color)',
            padding: '4px 8px',
            fontSize: '0.8rem',
            cursor: layersCount === 0 ? 'not-allowed' : 'pointer',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            opacity: layersCount === 0 ? 0.6 : 1
          }}
        >
          <Icon name="save" size={16} /> {t("G-code")}</button>
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
            background: 'var(--warning-bg)',
            backdropFilter: 'blur(8px)',
            border: '1px solid var(--warning-border)',
            borderRadius: 8,
            padding: '6px 14px',
            color: 'var(--warning-fg)',
            zIndex: 25,
            boxShadow: 'var(--shadow-2)'
          }}
        >
          <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
            {t("⚠️ Slice result is outdated. Please re-slice.")}</span>
          <button
            type="button"
            id="btn-reslice"
            data-testid="btn-reslice"
            onClick={() => startSlice()}
            style={{
              background: 'var(--surface-1)',
              color: 'var(--text-primary)',
              border: 'none',
              borderRadius: 4,
              padding: '4px 10px',
              fontWeight: 600,
              fontSize: '0.8rem',
              cursor: 'pointer'
            }}
          >
            {t("Re-slice")}</button>
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
            background: 'var(--surface-overlay)',
            padding: '16px 24px',
            borderRadius: 8,
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            zIndex: 30
          }}
        >
          <div className="spinner" style={{ width: 18, height: 18 }} />
          <span>{t("Loading WebGL2 Preview Engine...")}</span>
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
            background: 'var(--danger-bg)',
            padding: '16px 24px',
            borderRadius: 8,
            color: 'var(--danger-fg)',
            maxWidth: 400,
            textAlign: 'center',
            zIndex: 30
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("Preview Initialization Error")}</div>
          <div style={{ fontSize: '0.85rem' }}>{initError}</div>
        </div>
      )}

      {/* Empty State Prompt if not sliced yet */}
      {isInitialized && layersCount === 0 && !isLoadingModule && !initError && (
        <div
          id="preview-empty-prompt"
          className="desktop-preview-empty"
        >
          <p>
            {t("No G-code toolpaths loaded")}</p>
          <span>{t("Slice a model in Prepare screen to preview toolpaths")}</span>
          <button className="ds-btn ds-btn--primary" onClick={() => document.getElementById('tab-prepare')?.click()}>{t('Go to Prepare')}</button>
        </div>
      )}

      {/* Interactive Controls & Panels */}
      {isInitialized && layersCount > 0 && (
        <>
          {!mobile && <ViewTypeLegend />}
          <div className="preview-detail-panels"><GCodeWindow /><SliceStatsPanel /></div>
          {!mobile && <MoveSlider active={active} />}
          {!mobile && <PlateSelectorBar style={{ bottom: 68 }} />}
          <LayerSlider />
        </>
      )}

      {/* Custom G-code Editor Dialog Modal */}
      <CustomGcodeDialog />
    </div>
  );
};
