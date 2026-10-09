/**
 * @file textApi.ts
 * Typed client module for 3D Text & Emboss engine operations.
 * Communicates with the OrcaSlicer WebAssembly engine via generic call().
 */

import { getEngine } from '../engine/orcaEngine';
import type { AddTextParams, UpdateTextParams, GetTextParams, TextResult, GetTextResult, FontItem } from './types';

/**
 * In-memory font bytes cache indexed by font ID, fileName, and fontName.
 */
const fontBytesCache = new Map<string, Uint8Array>();

export function getCachedFont(key: string): Uint8Array | undefined {
  if (!key) return undefined;
  return fontBytesCache.get(key) || fontBytesCache.get(key.toLowerCase());
}

export function setCachedFont(key: string, bytes: Uint8Array): void {
  if (!key) return;
  fontBytesCache.set(key, bytes);
  fontBytesCache.set(key.toLowerCase(), bytes);
}

/**
 * Resolves a static asset URL with respect to the app base URL.
 */
export function resolveAssetUrl(relOrAbsUrl: string): string {
  if (
    !relOrAbsUrl ||
    relOrAbsUrl.startsWith('http://') ||
    relOrAbsUrl.startsWith('https://') ||
    relOrAbsUrl.startsWith('blob:') ||
    relOrAbsUrl.startsWith('data:')
  ) {
    return relOrAbsUrl;
  }
  const base = (typeof import.meta !== 'undefined' && (import.meta as any).env?.BASE_URL) || '/';
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const cleanPath = relOrAbsUrl.startsWith('/') ? relOrAbsUrl : `/${relOrAbsUrl}`;
  return `${cleanBase}${cleanPath}`;
}

/**
 * Converts a Uint8Array of font binary bytes into a base64 encoded string.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Adds text to an object or as a new object on the bed.
 */
export async function addText(params: AddTextParams): Promise<TextResult> {
  const engine = await getEngine();
  if (typeof (engine as any).addText === 'function') {
    return (await (engine as any).addText(params)) as TextResult;
  }
  const res = await (engine as any).call('addText', params);
  return res as TextResult;
}

/**
 * Updates an existing text volume and regenerates its mesh.
 */
export async function updateText(params: UpdateTextParams): Promise<TextResult> {
  const engine = await getEngine();
  if (typeof (engine as any).updateText === 'function') {
    return (await (engine as any).updateText(params)) as TextResult;
  }
  const res = await (engine as any).call('updateText', params);
  return res as TextResult;
}

/**
 * Reads stored text configuration for an existing text volume.
 */
export async function getText(params: GetTextParams): Promise<GetTextResult> {
  const engine = await getEngine();
  if (typeof (engine as any).getText === 'function') {
    return (await (engine as any).getText(params)) as GetTextResult;
  }
  const res = await (engine as any).call('getText', params);
  return res as GetTextResult;
}

/**
 * Ensures the given font exists in engine MEMFS or has cached bytes/base64 data.
 * Returns the virtual MEMFS path and optional base64 fontData.
 * Avoids unnecessary writeFile RPC if fontData suffices.
 * Never attempts to fetch fake paths like "<embedded_font>".
 */
export async function ensureFontLoaded(
  font: FontItem
): Promise<{ memfsPath: string; fontData?: string }> {
  const engine = await getEngine();
  const memfsPath = font.fileName.startsWith('/') ? font.fileName : `/fonts/${font.fileName}`;

  let bytes =
    font.bytes ||
    getCachedFont(font.id) ||
    getCachedFont(font.fileName) ||
    getCachedFont(font.name);

  // Guard: do not fetch fake or placeholder paths like "<embedded_font>"
  const isFakePath = !font.url || font.url.startsWith('<') || font.url.includes('embedded_font');

  if (!bytes && !isFakePath) {
    try {
      const targetUrl = resolveAssetUrl(font.url);
      const resp = await fetch(targetUrl);
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        bytes = new Uint8Array(buf);
        font.bytes = bytes;
        setCachedFont(font.id, bytes);
        setCachedFont(font.fileName, bytes);
        setCachedFont(font.name, bytes);
      } else {
        console.warn(`Failed to fetch font at ${targetUrl}: ${resp.statusText}`);
      }
    } catch (fetchErr) {
      console.warn(`Network error fetching font at ${font.url}:`, fetchErr);
    }
  }

  let fontData: string | undefined;
  if (bytes) {
    font.bytes = bytes;
    setCachedFont(font.id, bytes);
    setCachedFont(font.fileName, bytes);
    setCachedFont(font.name, bytes);
    try {
      fontData = uint8ArrayToBase64(bytes);
    } catch (b64Err) {
      console.warn(`Could not base64-encode font ${font.fileName}:`, b64Err);
    }

    // Avoid unnecessary writeFile RPC if in-memory fontData suffices
    if (!fontData) {
      try {
        if (typeof (engine as any).writeFile === 'function') {
          await (engine as any).writeFile(memfsPath, bytes);
        } else {
          await (engine as any).call('writeFile', { path: memfsPath, bytes });
        }
      } catch (_) {
        // op writeFile may not be exposed by worker RPC
      }
    }
  }

  return { memfsPath, fontData };
}
