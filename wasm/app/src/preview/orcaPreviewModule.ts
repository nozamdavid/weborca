/**
 * @file orcaPreviewModule.ts
 * Lazy-loaded WebAssembly wrapper for OrcaSlicer's libvgcode WebGL2 preview renderer.
 */

import type { PreviewStatistics, LegendData } from './types';
import { preparePreview, cancelPreviewWorker } from './previewWorkerClient';

let previewModulePromise: Promise<any> | null = null;
let previewModule: any = null;
let previewInstance: any = null;
let previewGeneration = 0;
let pendingFrame: number | null = null;
let lowQuality = false;
let lightingEnabled = true;

export interface PreviewPerformance {
  idle: boolean;
  fps: number | null;
  cpuMs: number | null;
}
const performanceListeners = new Set<(sample: PreviewPerformance) => void>();
let performanceSample: PreviewPerformance = { idle: true, fps: null, cpuMs: null };
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let burstStart = 0;
let lastDraw: number | null = null;
let drawCount = 0;
let cpuTotal = 0;
let lastPublication = 0;
const idleDelay = 1200;

function publishPerformance(sample: PreviewPerformance): void {
  performanceSample = sample;
  performanceListeners.forEach(listener => listener(sample));
}

function resetPerformance(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  lastDraw = null;
  drawCount = 0;
  cpuTotal = 0;
  publishPerformance({ idle: true, fps: null, cpuMs: null });
}

/** Observation only: subscribing never requests a draw. The last observer owns cleanup. */
export function subscribePerformance(listener: (sample: PreviewPerformance) => void): () => void {
  performanceListeners.add(listener);
  listener(performanceSample);
  return () => {
    performanceListeners.delete(listener);
    if (!performanceListeners.size) resetPerformance();
  };
}

export function getPerformanceSnapshot(): PreviewPerformance {
  return performanceSample;
}

function settlePerformance(): void {
  idleTimer = null;
  if (lastDraw === null) return;
  const remaining = idleDelay - (performance.now() - lastDraw);
  if (remaining > 0) {
    idleTimer = setTimeout(settlePerformance, remaining);
    return;
  }
  lastDraw = null;
  publishPerformance({ idle: true, fps: null, cpuMs: drawCount ? cpuTotal / drawCount : performanceSample.cpuMs });
}

function completedDraw(start: number, end: number): void {
  // A gap above one second starts a fresh burst; sparse draws must not suggest peak refresh.
  if (lastDraw === null || end - lastDraw > 1000) {
    burstStart = end;
    drawCount = 0;
    cpuTotal = 0;
  }
  lastDraw = end;
  drawCount++;
  cpuTotal += end - start;
  if (performanceSample.idle || end - lastPublication >= 1000) {
    publishPerformance({ idle: false,
      fps: drawCount > 1 && end > burstStart ? (drawCount - 1) * 1000 / (end - burstStart) : null,
      cpuMs: cpuTotal / drawCount });
    lastPublication = end;
    // Keep both metrics local to the latest publication window.
    burstStart = end;
    drawCount = 1;
    cpuTotal = end - start;
  }
  if (idleTimer === null) idleTimer = setTimeout(settlePerformance, idleDelay);
}
// This is a parse identity marker, not an owner of the potentially large source.
let loadedGcode: WeakRef<Uint8Array> | null = null;
let bedPolygon: [number, number][] | null = null;
let prepared: { source: WeakRef<Uint8Array>; packet: Uint8Array; stats: PreviewStatistics } | null = null;
let pendingPrepare: { source: WeakRef<Uint8Array>; promise: Promise<{ stats: PreviewStatistics; packet: Uint8Array }> } | null = null;
let appliedViewType: string | null = null;
let loadGeneration = 0;

export async function getPreviewModule(canvas?: HTMLCanvasElement): Promise<any> {
  if (previewModule) return previewModule;
  if (previewModulePromise) return previewModulePromise;

  previewModulePromise = (async () => {
    let createOrcaPreview: any;

    try {
      const runtimeUrl = '/preview/orca_preview.js';
      const mod = await import(/* @vite-ignore */ runtimeUrl);
      createOrcaPreview = mod.default || mod;
    } catch (_) {
      try {
        const runtimeUrl = '/orca_preview.js';
        const mod = await import(/* @vite-ignore */ runtimeUrl);
        createOrcaPreview = mod.default || mod;
      } catch (err) {
        console.error('[OrcaPreview] Failed to import orca_preview.js:', err);
        throw err;
      }
    }

    const instance = await createOrcaPreview({
      canvas: canvas,
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) {
          return '/preview/orca_preview.wasm';
        }
        return path;
      }
    });

    // The preview is a separate WASM filesystem from the slicing worker. Its G-code processor
    // needs the same nozzle/filament metadata, including non-default nozzle hardness values.
    try {
      const response = await fetch('/profiles/resources.json');
      if (!response.ok) throw new Error('Preview runtime resources are unavailable');
      const bundle = await response.json() as { files: Record<string, string> };
      instance.FS.mkdirTree('/resources/info');
      for (const [path, contents] of Object.entries(bundle.files)) {
        if (path.startsWith('info/') && !path.includes('..')) instance.FS.writeFile(`/resources/${path}`, contents);
      }
    } catch (error) { console.warn('[OrcaPreview] Could not load runtime resources:', error); }
    previewModule = instance;
    return instance;
  })();

  try {
    return await previewModulePromise;
  } catch (error) {
    previewModulePromise = null;
    throw error;
  }
}

export async function initPreview(canvas: HTMLCanvasElement): Promise<any> {
  const generation = ++previewGeneration;
  const mod = await getPreviewModule(canvas);
  if (generation !== previewGeneration) {
    const error = new Error('Preview initialization canceled');
    error.name = 'AbortError';
    throw error;
  }
  resetPerformance();
  mod.canvas = canvas;
  (window as any).Module = mod;

  if (previewInstance) {
    try {
      previewInstance.delete();
    } catch (_) {}
    previewInstance = null;
  }
  (window as any).preview = null;

  if (!canvas.id) {
    canvas.id = 'canvas';
  }

  loadedGcode = null;
  const instance = new mod.OrcaPreview();
  try {
    instance.setLightingEnabled(lightingEnabled);
    const selector = `#${canvas.id}`;
    if (!instance.init(selector)) {
      throw new Error('Failed to initialize WebGL2 context on preview canvas');
    }

    // Layout may size the canvas before the asynchronous native instance exists.
    instance.resize(canvas.width, canvas.height);
    instance.setLowQuality?.(lowQuality);
  } catch (error) {
    instance.delete();
    throw error;
  }
  previewInstance = instance;
  appliedViewType = 'FeatureType';

  // Also expose on window for automated verification and debugging
  (window as any).preview = previewInstance;
  (window as any).previewModule = mod;

  return previewInstance;
}

export function disposePreview(): void {
  ++loadGeneration;
  pendingPrepare = null;
  cancelPreviewWorker(true);
  ++previewGeneration;
  resetPerformance();
  if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
  pendingFrame = null;
  previewInstance?.delete();
  previewInstance = null;
  appliedViewType = null;
  bedPolygon = null;
  loadedGcode = null;
  if (typeof window !== 'undefined') (window as any).preview = null;
}

export function getPreviewInstance(): any {
  return previewInstance;
}

/**
 * Invalidate an in-flight preparation at a new import's initiation. Pending
 * worker results become stale before any renderer or preview-store mutation,
 * while the currently rendered G-code and its prepared packet stay intact.
 */
export function cancelPendingGcodeLoad(): void {
  ++loadGeneration;
  pendingPrepare = null;
  cancelPreviewWorker();
}

/** Discard a closed project's toolpaths while retaining the initialized viewer and bed. */
export function clearGcode(): void {
  ++loadGeneration;
  pendingPrepare = null;
  cancelPreviewWorker();
  prepared = null;
  resetPerformance();
  if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
  pendingFrame = null;
  previewInstance?.clearGcode();
  loadedGcode = null;
  if (typeof window !== 'undefined') {
    (window as any).previewStats = null;
    (window as any).previewLoaded = false;
  }
  requestRender();
}

export async function loadGcode(data: Uint8Array | ArrayBuffer | string, _name = 'print.gcode'): Promise<PreviewStatistics> {
  let bytes: Uint8Array;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else {
    bytes = data;
  }

  const generation = ++loadGeneration;
  let result = prepared?.source.deref() === bytes ? prepared : null;
  if (!result) {
    const entry = pendingPrepare?.source.deref() === bytes
      ? pendingPrepare
      : (pendingPrepare = { source: new WeakRef(bytes), promise: preparePreview(bytes) });
    let converted: { stats: PreviewStatistics; packet: Uint8Array };
    try {
      converted = await entry.promise;
    } finally {
      if (pendingPrepare === entry) pendingPrepare = null;
    }
    if (generation !== loadGeneration) {
      const error = new Error('Preview preparation canceled'); error.name = 'AbortError'; throw error;
    }
    result = { source: new WeakRef(bytes), ...converted };
  }
  if (!previewInstance || !previewModule) { prepared = result; return result.stats; }
  const previousGcode = loadedGcode;
  const vfsPath = `/preview_${Date.now()}.packet`;

  try {
    // Stage the prepared packet, then release the temporary MEMFS file below.
    previewModule.FS.writeFile(vfsPath, result.packet);
    loadedGcode = null;
    const resStr = previewInstance.loadParsedGcode(vfsPath);
    const stats: PreviewStatistics = JSON.parse(resStr);
    if (stats.error) {
      // Native JSON errors are reported before replacing the old viewer. A thrown
      // native trap or malformed response may follow mutation, so keep those invalidated.
      loadedGcode = previousGcode;
      throw new Error(stats.error);
    }

    // The processor may fall back to default tool colors even though Orca's
    // footer contains the actual filament palette. Keep physical slot indices.
    const footer = new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 65536)));
    const palette = footer.match(/^;\s*filament_colour\s*=\s*(.+)$/m)?.[1].trim().split(';')
      .map(color => /^#?[\da-f]{6}([\da-f]{2})?$/i.test(color.trim()) ? `#${color.trim().replace(/^#/, '').slice(0, 6)}` : '');
    if (palette?.some(Boolean)) previewInstance.setToolColors(palette);

    // G-code metadata describes the printable area, not the decorative bed outline.
    if (bedPolygon) previewInstance.setBedPolygon(bedPolygon);

    loadedGcode = new WeakRef(bytes);
    prepared = result;

    // Expose stats globally for tests
    (window as any).previewStats = stats;
    (window as any).previewLoaded = true;

    return stats;
  } finally {
    try {
      previewModule.FS.unlink(vfsPath);
    } catch (_) {}
  }
}

/** The file-open action can load the same bytes before React receives its slice result. */
export function isGcodeLoaded(bytes: Uint8Array): boolean {
  return previewInstance !== null && loadedGcode?.deref() === bytes;
}

export function setLayerRange(minLayer: number, maxLayer: number): void {
  if (previewInstance) {
    previewInstance.setLayerRange(minLayer, maxLayer);
  }
}

export function setMove(move: number): void {
  if (previewInstance) {
    previewInstance.setMove(move);
  }
}

export function getMoveRange(): { min: number; max: number; current: number } {
  if (!previewInstance) return { min: 0, max: 0, current: 0 };
  try {
    return JSON.parse(previewInstance.getMoveRange());
  } catch {
    return { min: 0, max: 0, current: 0 };
  }
}

export function getMoveGcodeLine(move: number): number {
  return previewInstance?.getMoveGcodeLine?.(move) ?? 0;
}

export function getLayersZs(): number[] {
  if (!previewInstance) return [];
  try {
    return JSON.parse(previewInstance.getLayersZs());
  } catch {
    return [];
  }
}

export function getLayerZ(layerIdx: number): number {
  if (!previewInstance) return 0;
  return previewInstance.getLayerZ(layerIdx);
}

export function setViewType(viewType: string): void {
  if (previewInstance && appliedViewType !== viewType) {
    previewInstance.setViewType(viewType);
    appliedViewType = viewType;
  }
}

export function getLegendData(): LegendData {
  if (!previewInstance) {
    return { viewType: 'FeatureType', title: 'Line Type', type: 'features', items: [], options: [] };
  }
  try {
    return JSON.parse(previewInstance.getLegendData());
  } catch {
    return { viewType: 'FeatureType', title: 'Line Type', type: 'features', items: [], options: [] };
  }
}

export function toggleExtrusionRole(roleId: number): void {
  if (previewInstance) {
    previewInstance.toggleExtrusionRole(roleId);
  }
}

export function toggleOption(optId: number): void {
  if (previewInstance) {
    previewInstance.toggleOption(optId);
  }
}

export function setBed(minX: number, minY: number, maxX: number, maxY: number): void {
  if (previewInstance) {
    previewInstance.setBed(minX, minY, maxX, maxY);
  }
}

export function setBedPolygon(points: [number, number][]): void {
  bedPolygon = points;
  if (previewInstance) {
    previewInstance.setBedPolygon(points);
  }
}

export function resize(width: number, height: number): void {
  if (previewInstance) {
    previewInstance.resize(width, height);
  }
}

/** Coalesce pointer, slider, resize and UI changes into the next browser frame. */
export function requestRender(): void {
  if (!previewInstance || pendingFrame !== null) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null;
    render();
  });
}

export function setLowQuality(enabled: boolean): void {
  lowQuality = enabled;
  previewInstance?.setLowQuality?.(enabled);
}

export function setLightingEnabled(enabled: boolean): void {
  lightingEnabled = enabled;
  previewInstance?.setLightingEnabled(enabled);
}

export function render(): void {
  if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
  pendingFrame = null;
  if (previewInstance) {
    previewInstance.setLightTheme?.(document.documentElement.dataset.theme === 'light');
    const measured = performanceListeners.size > 0;
    const start = measured ? performance.now() : 0;
    previewInstance.render();
    if (measured && performanceListeners.size > 0) completedDraw(start, performance.now());
  }
}

export function orbit(dx: number, dy: number): void {
  if (previewInstance) {
    previewInstance.orbit(dx, dy);
  }
}

export function pan(dx: number, dy: number): void {
  if (previewInstance) {
    previewInstance.pan(dx, dy);
  }
}

export function zoom(delta: number): void {
  if (previewInstance) {
    previewInstance.zoom(delta);
  }
}

export function resetCamera(): void {
  if (previewInstance) {
    previewInstance.resetCamera();
  }
}

export function getLayersCount(): number {
  return previewInstance ? previewInstance.getLayersCount() : 0;
}

export function getMovesCount(): number {
  return previewInstance ? previewInstance.getMovesCount() : 0;
}
