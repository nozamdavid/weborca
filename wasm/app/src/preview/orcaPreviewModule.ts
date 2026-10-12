/**
 * @file orcaPreviewModule.ts
 * Lazy-loaded WebAssembly wrapper for OrcaSlicer's libvgcode WebGL2 preview renderer.
 */

import type { PreviewStatistics, LegendData } from './types';

let previewModulePromise: Promise<any> | null = null;
let previewModule: any = null;
let previewInstance: any = null;
let pendingFrame: number | null = null;
let lowQuality = false;
// This is a parse identity marker, not an owner of the potentially large source.
let loadedGcode: WeakRef<Uint8Array> | null = null;
let bedPolygon: [number, number][] | null = null;

export async function getPreviewModule(canvas?: HTMLCanvasElement): Promise<any> {
  if (previewModule) return previewModule;
  if (previewModulePromise) return previewModulePromise;

  previewModulePromise = (async () => {
    let createOrcaPreview: any;

    try {
      const url1 = '/preview/orca_preview.js';
      const mod = await import(/* @vite-ignore */ url1);
      createOrcaPreview = mod.default || mod;
    } catch (_) {
      try {
        const url2 = '/orca_preview.js';
        const mod = await import(/* @vite-ignore */ url2);
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
  const mod = await getPreviewModule(canvas);
  mod.canvas = canvas;
  (window as any).Module = mod;

  if (previewInstance) {
    try {
      previewInstance.delete();
    } catch (_) {}
    previewInstance = null;
  }

  if (!canvas.id) {
    canvas.id = 'canvas';
  }

  loadedGcode = null;
  previewInstance = new mod.OrcaPreview();
  const selector = `#${canvas.id}`;
  const ok = previewInstance.init(selector);
  if (!ok) {
    throw new Error('Failed to initialize WebGL2 context on preview canvas');
  }

  // Layout may size the canvas before the asynchronous native instance exists.
  previewInstance.resize(canvas.width, canvas.height);
  previewInstance.setLowQuality?.(lowQuality);

  // Also expose on window for automated verification and debugging
  (window as any).preview = previewInstance;
  (window as any).previewModule = mod;

  return previewInstance;
}

export function disposePreview(): void {
  if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
  pendingFrame = null;
  previewInstance?.delete();
  previewInstance = null;
  bedPolygon = null;
  loadedGcode = null;
}

export function getPreviewInstance(): any {
  return previewInstance;
}

/** Discard a closed project's toolpaths while retaining the initialized viewer and bed. */
export function clearGcode(): void {
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

export function loadGcode(data: Uint8Array | ArrayBuffer | string, _name = 'print.gcode'): PreviewStatistics {
  if (!previewInstance || !previewModule) {
    throw new Error('Preview module not initialized');
  }

  let bytes: Uint8Array;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else {
    bytes = data;
  }

  const previousGcode = loadedGcode;
  const vfsPath = `/preview_${Date.now()}.gcode`;

  try {
    // The preview parser is read-only and unlinks this file below. Borrow the immutable
    // source bytes instead of allocating another full G-code copy in MEMFS.
    previewModule.FS.writeFile(vfsPath, bytes, { canOwn: true });
    loadedGcode = null;
    const resStr = previewInstance.loadGcode(vfsPath);
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
  if (previewInstance) {
    previewInstance.setViewType(viewType);
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

export function render(): void {
  if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
  pendingFrame = null;
  if (previewInstance) {
    previewInstance.setLightTheme?.(document.documentElement.dataset.theme === 'light');
    previewInstance.render();
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
