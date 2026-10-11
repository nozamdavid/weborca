import { deflateSync as zlibSync } from 'node:zlib';

/**
 * Standard IEEE 802.3 32-bit Cyclic Redundancy Check.
 */
export function crc32(buf: Uint8Array): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Builds a valid PNG chunk (Length + Type + Data + CRC).
 */
function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const chunk = new Uint8Array(4 + 4 + len + 4);
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  view.setUint32(0, len, false); // Big-endian length
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }
  chunk.set(data, 8);
  const crcVal = crc32(chunk.subarray(4, 8 + len));
  view.setUint32(8 + len, crcVal, false);
  return chunk;
}

/**
 * Encodes RGBA pixels into a valid PNG byte stream using zlibSync.
 */
export function encodeRgbaToPng(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const rowLen = 1 + width * 4;
  const raw = new Uint8Array(height * rowLen);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLen;
    raw[rowOffset] = 0; // Filter byte: None
    const srcOffset = y * width * 4;
    raw.set(pixels.subarray(srcOffset, srcOffset + width * 4), rowOffset + 1);
  }

  // PNG IDAT requires zlib-wrapped deflate with header and Adler32 checksum
  const idatData = zlibSync(raw);

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', idatData);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const totalLen = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(totalLen);
  let offset = 0;
  out.set(sig, offset); offset += sig.length;
  out.set(ihdrChunk, offset); offset += ihdrChunk.length;
  out.set(idatChunk, offset); offset += idatChunk.length;
  out.set(iendChunk, offset);
  return out;
}

/**
 * Creates a valid standalone PNG image file with RGBA fill.
 */
export function generateValidPng(
  width: number,
  height: number,
  rgbaFill?: [number, number, number, number]
): Uint8Array {
  const [r, g, b, a] = rgbaFill ?? [59, 130, 246, 255];
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const px = i * 4;
    pixels[px] = r;
    pixels[px + 1] = g;
    pixels[px + 2] = b;
    pixels[px + 3] = a;
  }
  return encodeRgbaToPng(pixels, width, height);
}

/**
 * Decodes native QOI image bytes into RGBA pixels.
 */
export function decodeQoi(bytes: Uint8Array): {
  width: number;
  height: number;
  channels: number;
  colorspace: number;
  pixels: Uint8Array;
} {
  if (bytes.length < 22) throw new Error('QOI data too small');
  if (
    bytes[0] !== 0x71 ||
    bytes[1] !== 0x6f ||
    bytes[2] !== 0x69 ||
    bytes[3] !== 0x66
  ) {
    throw new Error('Invalid QOI magic header');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(4, false);
  const height = view.getUint32(8, false);
  const channels = bytes[12];
  const colorspace = bytes[13];

  const totalPixels = width * height;
  const out = new Uint8Array(totalPixels * 4);

  const index = new Uint8Array(64 * 4);
  let pr = 0, pg = 0, pb = 0, pa = 255;

  let p = 14;
  let pxPos = 0;
  const end = bytes.length - 8;

  while (pxPos < totalPixels * 4 && p < end) {
    const b1 = bytes[p++];

    if (b1 === 0xfe) { // QOI_OP_RGB
      pr = bytes[p++];
      pg = bytes[p++];
      pb = bytes[p++];
    } else if (b1 === 0xff) { // QOI_OP_RGBA
      pr = bytes[p++];
      pg = bytes[p++];
      pb = bytes[p++];
      pa = bytes[p++];
    } else if ((b1 & 0xc0) === 0x00) { // QOI_OP_INDEX
      const idx = (b1 & 0x3f) * 4;
      pr = index[idx];
      pg = index[idx + 1];
      pb = index[idx + 2];
      pa = index[idx + 3];
    } else if ((b1 & 0xc0) === 0x40) { // QOI_OP_DIFF
      pr = (pr + ((b1 >> 4) & 0x03) - 2) & 0xff;
      pg = (pg + ((b1 >> 2) & 0x03) - 2) & 0xff;
      pb = (pb + (b1 & 0x03) - 2) & 0xff;
    } else if ((b1 & 0xc0) === 0x80) { // QOI_OP_LUMA
      const b2 = bytes[p++];
      const vg = (b1 & 0x3f) - 32;
      pr = (pr + vg - 8 + ((b2 >> 4) & 0x0f)) & 0xff;
      pg = (pg + vg) & 0xff;
      pb = (pb + vg - 8 + (b2 & 0x0f)) & 0xff;
    } else if ((b1 & 0xc0) === 0xc0) { // QOI_OP_RUN
      const run = (b1 & 0x3f) + 1;
      for (let i = 0; i < run; i++) {
        out[pxPos++] = pr;
        out[pxPos++] = pg;
        out[pxPos++] = pb;
        out[pxPos++] = pa;
      }
      continue;
    }

    const indexPos = ((pr * 3 + pg * 5 + pb * 7 + pa * 11) & 63) * 4;
    index[indexPos] = pr;
    index[indexPos + 1] = pg;
    index[indexPos + 2] = pb;
    index[indexPos + 3] = pa;

    out[pxPos++] = pr;
    out[pxPos++] = pg;
    out[pxPos++] = pb;
    out[pxPos++] = pa;
  }

  return { width, height, channels, colorspace, pixels: out };
}

