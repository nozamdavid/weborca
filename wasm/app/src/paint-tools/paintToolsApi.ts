/**
 * @file paintToolsApi.ts
 * Typed client module for advanced painting engine operations.
 * Communicates with the OrcaSlicer WebAssembly engine via orcaEngine.call().
 */

import { getEngine } from '../engine/orcaEngine';
import type {
  PaintStrokeParams,
  PaintStrokeResult,
  GetPaintOverlayParams,
  GetPaintOverlayResult,
  ParsedPaintOverlay,
  GetPaintDataParams,
  GetPaintDataResult,
  SetPaintDataParams,
  SetPaintDataResult,
  ClearPaintParams,
  ClearPaintResult,
  PaintOverlayState
} from './types';

/**
 * Sends a batch of paint stroke points to the engine.
 */
export async function paintStroke(params: PaintStrokeParams): Promise<PaintStrokeResult> {
  const engine = await getEngine();
  const res = await (engine as any).call('paintStroke', params);
  return res as PaintStrokeResult;
}

/**
 * Requests the split-triangle overlay for a volume and layer.
 */
export async function getPaintOverlay(params: GetPaintOverlayParams): Promise<GetPaintOverlayResult> {
  const engine = await getEngine();
  const res = await (engine as any).call('getPaintOverlay', params);

  // If buffer is already returned by worker transfer or result property
  if (res && (res.buffer || res.data)) {
    return res as GetPaintOverlayResult;
  }

  // Fallback: If only path is returned, attempt to fetch the file from engine if readFile is supported
  if (res && res.path && !res.buffer) {
    try {
      const fileRes = await (engine as any).call('readFile', { path: res.path });
      if (fileRes && fileRes.buffer) {
        res.buffer = fileRes.buffer;
      } else if (fileRes instanceof Uint8Array || fileRes instanceof ArrayBuffer) {
        res.buffer = fileRes;
      }
    } catch (_) {
      // Worker will populate buffer when getPaintOverlay worker hook is in place
    }
  }

  return res as GetPaintOverlayResult;
}

/**
 * Parses binary split-triangle overlay data according to the "PNT1" specification:
 * Header: 4 bytes "PNT1"
 * uint32 vertexCount
 * uint32 triangleCount
 * Float32Array xyz positions (vertexCount * 3 floats)
 * Uint32Array triangle indices (triangleCount * 3 uint32s)
 */
export function parsePaintOverlayBinary(
  rawBuffer: ArrayBuffer | Uint8Array,
  states: PaintOverlayState[] = []
): ParsedPaintOverlay | null {
  const bytes = rawBuffer instanceof Uint8Array ? rawBuffer : new Uint8Array(rawBuffer);
  if (bytes.byteLength < 12) {
    return null;
  }

  // Verify header "PNT1" (0x50, 0x4e, 0x54, 0x31)
  if (
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4e ||
    bytes[2] !== 0x54 ||
    bytes[3] !== 0x31
  ) {
    console.warn('[paintToolsApi] Invalid overlay header; expected PNT1');
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertexCount = view.getUint32(4, true);
  const triangleCount = view.getUint32(8, true);

  const positionsByteOffset = bytes.byteOffset + 12;
  const positionsByteLength = vertexCount * 3 * 4;
  const indicesByteOffset = positionsByteOffset + positionsByteLength;
  const indicesByteLength = triangleCount * 3 * 4;

  if (bytes.byteLength < 12 + positionsByteLength + indicesByteLength) {
    console.warn('[paintToolsApi] Truncated overlay binary payload');
    return null;
  }

  // Create Float32Array and Uint32Array views (copying if unaligned)
  let positions: Float32Array;
  if (positionsByteOffset % 4 === 0) {
    positions = new Float32Array(bytes.buffer, positionsByteOffset, vertexCount * 3);
  } else {
    const copy = bytes.slice(12, 12 + positionsByteLength);
    positions = new Float32Array(copy.buffer, copy.byteOffset, vertexCount * 3);
  }

  let indices: Uint32Array;
  if (indicesByteOffset % 4 === 0) {
    indices = new Uint32Array(bytes.buffer, indicesByteOffset, triangleCount * 3);
  } else {
    const copy = bytes.slice(12 + positionsByteLength, 12 + positionsByteLength + indicesByteLength);
    indices = new Uint32Array(copy.buffer, copy.byteOffset, triangleCount * 3);
  }

  return {
    vertexCount,
    triangleCount,
    positions,
    indices,
    states
  };
}

/**
 * Retrieves the base64-serialized TriangleSplittingData for a volume and layer.
 */
export async function getPaintData(params: GetPaintDataParams): Promise<GetPaintDataResult> {
  const engine = await getEngine();
  const res = await (engine as any).call('getPaintData', params);
  return res as GetPaintDataResult;
}

/**
 * Restores serialized TriangleSplittingData for undo/redo.
 */
export async function setPaintData(params: SetPaintDataParams): Promise<SetPaintDataResult> {
  const engine = await getEngine();
  const res = await (engine as any).call('setPaintData', params);
  return res as SetPaintDataResult;
}

/**
 * Clears painted facets for a layer and volume.
 */
export async function clearPaint(params: ClearPaintParams): Promise<ClearPaintResult> {
  const engine = await getEngine();
  const res = await (engine as any).call('clearPaint', params);
  return res as ClearPaintResult;
}
