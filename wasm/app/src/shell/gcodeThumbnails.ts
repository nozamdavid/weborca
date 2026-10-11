export interface ThumbnailSpec {
  width: number;
  height: number;
  format: 'PNG' | 'JPG' | 'QOI';
}

/**
 * Encodes RGBA pixels into native QOI (Quite OK Image) format.
 * Header: 'qoif' (4 bytes), width (uint32 BE), height (uint32 BE), channels (4), colorspace (0).
 */
export function encodeQoi(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  // Max possible size: 14 byte header + width * height * 5 (worst-case RGBA) + 8 byte end marker
  const maxSize = 14 + width * height * 5 + 8;
  const out = new Uint8Array(maxSize);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  // 14-byte Header
  out[0] = 0x71; // 'q'
  out[1] = 0x6f; // 'o'
  out[2] = 0x69; // 'i'
  out[3] = 0x66; // 'f'
  view.setUint32(4, width, false); // big-endian width
  view.setUint32(8, height, false); // big-endian height
  out[12] = 4; // channels: 4 (RGBA)
  out[13] = 0; // colorspace: 0 (sRGB with linear alpha)

  let p = 14;

  // Running array of 64 pixels (r, g, b, a), initialized to zeros
  const index = new Uint8Array(64 * 4);

  let pr = 0, pg = 0, pb = 0, pa = 255;
  let run = 0;

  const totalPixels = width * height;
  const pixelLen = totalPixels * 4;

  for (let pxPos = 0; pxPos < pixelLen; pxPos += 4) {
    const r = pixels[pxPos];
    const g = pixels[pxPos + 1];
    const b = pixels[pxPos + 2];
    const a = pixels[pxPos + 3];

    if (r === pr && g === pg && b === pb && a === pa) {
      run++;
      if (run === 62) {
        out[p++] = 0xc0 | (run - 1); // QOI_OP_RUN: 0b11xxxxxx
        run = 0;
      }
    } else {
      if (run > 0) {
        out[p++] = 0xc0 | (run - 1);
        run = 0;
      }

      const indexPos = ((r * 3 + g * 5 + b * 7 + a * 11) & 63) * 4;

      if (
        index[indexPos] === r &&
        index[indexPos + 1] === g &&
        index[indexPos + 2] === b &&
        index[indexPos + 3] === a
      ) {
        out[p++] = (indexPos / 4) & 0x3f; // QOI_OP_INDEX: 0b00xxxxxx
      } else {
        index[indexPos] = r;
        index[indexPos + 1] = g;
        index[indexPos + 2] = b;
        index[indexPos + 3] = a;

        if (a === pa) {
          const vr = (r - pr) | 0;
          const vg = (g - pg) | 0;
          const vb = (b - pb) | 0;

          const vg_r = (vr - vg) | 0;
          const vg_b = (vb - vg) | 0;

          if (vr >= -2 && vr <= 1 && vg >= -2 && vg <= 1 && vb >= -2 && vb <= 1) {
            // QOI_OP_DIFF: 0b01xxxxxx
            out[p++] = 0x40 | ((vr + 2) << 4) | ((vg + 2) << 2) | (vb + 2);
          } else if (
            vg >= -32 && vg <= 31 &&
            vg_r >= -8 && vg_r <= 7 &&
            vg_b >= -8 && vg_b <= 7
          ) {
            // QOI_OP_LUMA: 0b10xxxxxx
            out[p++] = 0x80 | (vg + 32);
            out[p++] = ((vg_r + 8) << 4) | (vg_b + 8);
          } else {
            // QOI_OP_RGB: 0xfe
            out[p++] = 0xfe;
            out[p++] = r;
            out[p++] = g;
            out[p++] = b;
          }
        } else {
          // QOI_OP_RGBA: 0xff
          out[p++] = 0xff;
          out[p++] = r;
          out[p++] = g;
          out[p++] = b;
          out[p++] = a;
        }
      }

      pr = r;
      pg = g;
      pb = b;
      pa = a;
    }
  }

  if (run > 0) {
    out[p++] = 0xc0 | (run - 1);
    run = 0;
  }

  // End marker: 7 x 0x00 + 0x01
  out[p++] = 0;
  out[p++] = 0;
  out[p++] = 0;
  out[p++] = 0;
  out[p++] = 0;
  out[p++] = 0;
  out[p++] = 0;
  out[p++] = 1;

  return out.subarray(0, p);
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + chunkSize, len))));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Parses OrcaSlicer thumbnail configuration string or array.
 * Native format: "48x48/PNG,300x300/PNG" or ["272x272", "96x96"] or "300x300".
 * Default if omitted or empty: "48x48/PNG,300x300/PNG".
 */
export function parseThumbnailConfig(
  thumbnailsConfig?: string | string[] | null,
  defaultFormat: string = 'PNG'
): ThumbnailSpec[] {
  let rawStr = '';
  if (Array.isArray(thumbnailsConfig)) {
    rawStr = thumbnailsConfig.join(',');
  } else if (typeof thumbnailsConfig === 'string') {
    rawStr = thumbnailsConfig.trim();
  }

  if (!rawStr) {
    rawStr = '48x48/PNG,300x300/PNG';
  }

  const defFmtUpper = (defaultFormat || 'PNG').toUpperCase();
  const fallbackFormat: 'PNG' | 'JPG' | 'QOI' =
    defFmtUpper === 'JPG' || defFmtUpper === 'JPEG' ? 'JPG' : defFmtUpper === 'QOI' ? 'QOI' : 'PNG';

  const specs: ThumbnailSpec[] = [];
  const entries = rawStr.split(',');

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    // Pattern: <width>x<height>[/<format>]
    const match = trimmed.match(/^(\d+)\s*x\s*(\d+)(?:\s*\/\s*([A-Za-z_-]+))?$/i);
    if (!match) continue;

    const width = parseInt(match[1], 10);
    const height = parseInt(match[2], 10);
    if (isNaN(width) || isNaN(height) || width <= 0 || width > 2000 || height <= 0 || height > 2000) {
      continue;
    }

    let format: 'PNG' | 'JPG' | 'QOI' = fallbackFormat;
    if (match[3]) {
      const fmtUpper = match[3].toUpperCase();
      if (fmtUpper === 'JPG' || fmtUpper === 'JPEG') {
        format = 'JPG';
      } else if (fmtUpper === 'QOI') {
        format = 'QOI';
      } else {
        format = 'PNG';
      }
    }

    specs.push({ width, height, format });
  }

  if (specs.length === 0) {
    specs.push({ width: 48, height: 48, format: 'PNG' });
    specs.push({ width: 300, height: 300, format: 'PNG' });
  }

  return specs;
}

/**
 * Formats a thumbnail into the exact OrcaSlicer native comment block:
 * ; THUMBNAIL_BLOCK_START
 *
 * ;
 * ; thumbnail begin 48x48 1234
 * ; <lines wrapped at 78 characters>
 * ; thumbnail end
 * ; THUMBNAIL_BLOCK_END
 */
export function encodeThumbnailBlock(
  spec: ThumbnailSpec,
  base64Data: string
): string {
  const maxRowLength = 78;
  const tag = spec.format === 'JPG' ? 'thumbnail_JPG' : spec.format === 'QOI' ? 'thumbnail_QOI' : 'thumbnail';

  let lines = '';
  let remaining = base64Data;
  while (remaining.length > maxRowLength) {
    lines += `; ${remaining.substring(0, maxRowLength)}\n`;
    remaining = remaining.substring(maxRowLength);
  }
  if (remaining.length > 0) {
    lines += `; ${remaining}\n`;
  }

  return (
    `; THUMBNAIL_BLOCK_START\n\n` +
    `;\n` +
    `; ${tag} begin ${spec.width}x${spec.height} ${base64Data.length}\n` +
    lines +
    `; ${tag} end\n` +
    `; THUMBNAIL_BLOCK_END\n\n`
  );
}

/**
 * Strips existing thumbnail blocks from G-code content.
 */
export function stripThumbnailBlocks(gcode: string): string {
  let text = gcode.replace(
    /;[ \t]*THUMBNAIL_BLOCK_START[\s\S]*?;[ \t]*THUMBNAIL_BLOCK_END(?:\r?\n)*/g,
    ''
  );
  text = text.replace(
    /;[ \t]*thumbnail(?:_[A-Z]+)?[ \t]+begin[\s\S]*?;[ \t]*thumbnail(?:_[A-Z]+)?[ \t]+end(?:\r?\n)*/g,
    ''
  );
  text = text.replace(
    /;[0-9a-fA-F]{8}[\s\S]*?;[ \t]*bigtree thumbnail end(?:\r?\n)*/g,
    ''
  );
  return text;
}

/**
 * Inserts thumbnail blocks right after ; HEADER_BLOCK_END (or ; CONFIG_BLOCK_END), matching OrcaSlicer.
 */
export function insertThumbnailBlocks(gcode: string, thumbnailBlock: string): string {
  const stripped = stripThumbnailBlocks(gcode);
  if (!thumbnailBlock.trim()) return stripped;

  // Orca writes the full config at the end of a file. Put images by the
  // header so printer thumbnail readers can find them without reading the print.
  const header = stripped.match(/(;[ \t]*HEADER_BLOCK_END(?:\r?\n)+)/);
  if (header?.index !== undefined) {
    const pos = header.index + header[0].length;
    return stripped.slice(0, pos) + thumbnailBlock + stripped.slice(pos);
  }
  return thumbnailBlock + stripped;
}

/**
 * Generates thumbnail image base64 and bytes from renderer.
 * Returns null if no custom renderer or PlateScene is available, or if the plate has no models.
 * Never invents fake solid-color fallback images.
 */
export async function generateThumbnailImage(
  spec: ThumbnailSpec,
  options?: {
    plateIndex?: number;
    customRenderer?: (width: number, height: number, format: string, plateIndex?: number) => Promise<string | Uint8Array | null> | string | Uint8Array | null;
  }
): Promise<{ base64: string; bytes: Uint8Array } | null> {
  const plateIndex = options?.plateIndex;

  if (options?.customRenderer) {
    const res = await options.customRenderer(spec.width, spec.height, spec.format, plateIndex);
    if (!res) return null;
    if (typeof res === 'string') {
      const b64 = res.includes(',') ? res.split(',')[1] : res;
      if (!b64) return null;
      return { base64: b64, bytes: base64ToBytes(b64) };
    } else if (res instanceof Uint8Array && res.length > 0) {
      return { base64: bytesToBase64(res), bytes: res };
    }
    return null;
  }

  if (typeof window !== 'undefined') {
    const plateScene = (window as any).__plateScene;
    if (plateScene && typeof plateScene.renderThumbnail === 'function') {
      const dataUrl = plateScene.renderThumbnail({
        width: spec.width,
        height: spec.height,
        plateIndex,
        format: spec.format
      });
      if (typeof dataUrl === 'string' && dataUrl.length > 0) {
        const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        if (!b64) return null;
        return { base64: b64, bytes: base64ToBytes(b64) };
      }
    }
  }

  // No renderer available or plate is empty - return null gracefully (never embed fake images)
  return null;
}

/**
 * Embeds OrcaSlicer thumbnails into G-code bytes or string.
 * If no renderer or models are available, preserves the existing thumbnail/raw G-code gracefully.
 */
export async function embedThumbnailsInGcode(
  gcode: Uint8Array | string,
  options?: {
    plateIndex?: number;
    currentConfig?: Record<string, any>;
    customRenderer?: (width: number, height: number, format: string, plateIndex?: number) => Promise<string | Uint8Array | null> | string | Uint8Array | null;
  }
): Promise<Uint8Array> {
  const gcodeStr = typeof gcode === 'string' ? gcode : new TextDecoder('utf-8').decode(gcode);

  const thumbCfg = options?.currentConfig?.thumbnails;
  const thumbFmt = options?.currentConfig?.thumbnails_format || 'PNG';
  const specs = parseThumbnailConfig(thumbCfg, thumbFmt);

  let allThumbnailBlocks = '';
  for (const spec of specs) {
    const thumb = await generateThumbnailImage(spec, {
      plateIndex: options?.plateIndex,
      customRenderer: options?.customRenderer
    });
    if (thumb && thumb.base64) {
      allThumbnailBlocks += encodeThumbnailBlock(spec, thumb.base64);
    }
  }

  if (!allThumbnailBlocks.trim()) {
    // Gracefully preserve existing thumbnail/raw G-code if no models or renderer rendered thumbnails
    return typeof gcode === 'string' ? new TextEncoder().encode(gcode) : gcode;
  }

  const finalGcodeStr = insertThumbnailBlocks(gcodeStr, allThumbnailBlocks);
  return new TextEncoder().encode(finalGcodeStr);
}

/**
 * Cache for ensuring exact same-byte payload across download, save, and upload.
 */
interface CacheEntry {
  rawGcode: Uint8Array;
  plateIndex: number;
  finalGcode: Uint8Array;
}
let cachedPayload: CacheEntry | null = null;

export function getCachedExportGcode(plateIndex?: number, rawGcode?: Uint8Array): Uint8Array | null {
  if (!cachedPayload) return null;
  if (rawGcode !== undefined && cachedPayload.rawGcode !== rawGcode) return null;
  if (plateIndex !== undefined && cachedPayload.plateIndex !== plateIndex) return null;
  return cachedPayload.finalGcode;
}

export function setCachedExportGcode(rawGcode: Uint8Array, plateIndex: number, finalGcode: Uint8Array): void {
  cachedPayload = { rawGcode, plateIndex, finalGcode };
}

export function clearExportGcodeCache(): void {
  cachedPayload = null;
}

/**
 * Returns existing cached thumbnail G-code or builds and caches it.
 */
export async function getOrBuildGcodeWithThumbnails(
  rawGcode: Uint8Array,
  options?: {
    plateIndex?: number;
    currentConfig?: Record<string, any>;
    customRenderer?: (width: number, height: number, format: string, plateIndex?: number) => Promise<string | Uint8Array | null> | string | Uint8Array | null;
  }
): Promise<Uint8Array> {
  const pIdx = options?.plateIndex ?? 0;
  if (cachedPayload && cachedPayload.rawGcode === rawGcode && cachedPayload.plateIndex === pIdx) {
    return cachedPayload.finalGcode;
  }

  const finalGcode = await embedThumbnailsInGcode(rawGcode, options);
  setCachedExportGcode(rawGcode, pIdx, finalGcode);
  return finalGcode;
}
