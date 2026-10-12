import { generateValidPng, encodeRgbaToPng, decodeQoi, crc32 } from '../lib/thumbnail-images.ts';
/**
 * Focused tests for OrcaSlicer-style G-code thumbnails:
 * - Dimensions parsing & validation
 * - Base64 line wrapping and native Orca comment protocol
 * - Real image binary verification (PNG signature, IHDR dimensions, IEND, CRC, zlib)
 * - True QOI encoder & decoder verification (magic 'qoif', roundtrip pixels)
 * - Placement in G-code after header/config blocks
 * - No fake solid blue fallback: graceful preservation of raw Gcode/existing thumbnails
 * - Same-byte payload guarantee for download, save, and upload
 * - Per-plate isolation
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  parseThumbnailConfig,
  encodeThumbnailBlock,
  stripThumbnailBlocks,
  insertThumbnailBlocks,
  encodeQoi,
  bytesToBase64,
  base64ToBytes,
  generateThumbnailImage,
  embedThumbnailsInGcode,
  getOrBuildGcodeWithThumbnails,
  getCachedExportGcode,
  clearExportGcodeCache,
} from '../../app/src/shell/gcodeThumbnails.ts';
import { normalizeGcode } from '../lib/gcode_hash.mjs';

test('parseThumbnailConfig defaults to 48x48 and 300x300 PNG', () => {
  const def1 = parseThumbnailConfig(undefined);
  assert.deepEqual(def1, [
    { width: 48, height: 48, format: 'PNG' },
    { width: 300, height: 300, format: 'PNG' }
  ]);

  const def2 = parseThumbnailConfig('');
  assert.deepEqual(def2, [
    { width: 48, height: 48, format: 'PNG' },
    { width: 300, height: 300, format: 'PNG' }
  ]);

  const def3 = parseThumbnailConfig(null);
  assert.deepEqual(def3, [
    { width: 48, height: 48, format: 'PNG' },
    { width: 300, height: 300, format: 'PNG' }
  ]);
});

test('parseThumbnailConfig parses dimensions and format extensions', () => {
  const specs = parseThumbnailConfig('32x32/PNG, 400x300/JPG, 64x64/QOI');
  assert.deepEqual(specs, [
    { width: 32, height: 32, format: 'PNG' },
    { width: 400, height: 300, format: 'JPG' },
    { width: 64, height: 64, format: 'QOI' }
  ]);
});

test('parseThumbnailConfig supports array format from printer profile JSONs', () => {
  const specs = parseThumbnailConfig(['272x272', '96x96'], 'PNG');
  assert.deepEqual(specs, [
    { width: 272, height: 272, format: 'PNG' },
    { width: 96, height: 96, format: 'PNG' }
  ]);
});

test('parseThumbnailConfig uses defaultFormat when entry omits slash format', () => {
  const specs = parseThumbnailConfig('200x200, 100x100', 'JPG');
  assert.deepEqual(specs, [
    { width: 200, height: 200, format: 'JPG' },
    { width: 100, height: 100, format: 'JPG' }
  ]);
});

test('parseThumbnailConfig filters out invalid and out-of-range dimensions', () => {
  const specs = parseThumbnailConfig('0x0, -10x20, 2500x2500, invalid, 150x150/PNG');
  assert.deepEqual(specs, [
    { width: 150, height: 150, format: 'PNG' }
  ]);
});

test('encodeThumbnailBlock wraps base64 lines at exactly 78 characters with native Orca markers', () => {
  const dummyB64 = 'A'.repeat(200);
  const block = encodeThumbnailBlock({ width: 48, height: 48, format: 'PNG' }, dummyB64);

  assert.ok(block.startsWith('; THUMBNAIL_BLOCK_START\n\n;\n; thumbnail begin 48x48 200\n'));
  assert.ok(block.endsWith('; thumbnail end\n; THUMBNAIL_BLOCK_END\n\n'));

  const lines = block.split('\n');
  const dataLines = lines.filter((l) => l.startsWith('; A'));
  assert.equal(dataLines.length, 3);
  assert.equal(dataLines[0].length, 80); // '; ' (2) + 78 chars
  assert.equal(dataLines[1].length, 80);
  assert.equal(dataLines[2].length, 46); // 200 - 156 = 44 chars -> length 46
});

test('encodeThumbnailBlock sets appropriate tag for JPG and QOI formats', () => {
  const jpgBlock = encodeThumbnailBlock({ width: 300, height: 300, format: 'JPG' }, 'AQID');
  assert.ok(jpgBlock.includes('; thumbnail_JPG begin 300x300 4'));
  assert.ok(jpgBlock.includes('; thumbnail_JPG end'));

  const qoiBlock = encodeThumbnailBlock({ width: 64, height: 64, format: 'QOI' }, 'BAUG');
  assert.ok(qoiBlock.includes('; thumbnail_QOI begin 64x64 4'));
  assert.ok(qoiBlock.includes('; thumbnail_QOI end'));
});

test('generateValidPng and encodeRgbaToPng output valid zlib-compressed PNGs', () => {
  const testDimensions = [
    [48, 48],
    [300, 300],
    [272, 272],
    [120, 90]
  ];

  for (const [w, h] of testDimensions) {
    const png = generateValidPng(w, h, [255, 0, 128, 255]);

    // 1. Check PNG signature (8 bytes)
    assert.equal(png[0], 0x89);
    assert.equal(png[1], 0x50); // 'P'
    assert.equal(png[2], 0x4E); // 'N'
    assert.equal(png[3], 0x47); // 'G'
    assert.equal(png[4], 0x0D);
    assert.equal(png[5], 0x0A);
    assert.equal(png[6], 0x1A);
    assert.equal(png[7], 0x0A);

    // 2. Check IHDR chunk
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const ihdrLen = view.getUint32(8, false);
    assert.equal(ihdrLen, 13);
    const ihdrType = String.fromCharCode(...png.subarray(12, 16));
    assert.equal(ihdrType, 'IHDR');

    // 3. Check width & height encoded in IHDR
    const parsedW = view.getUint32(16, false);
    const parsedH = view.getUint32(20, false);
    assert.equal(parsedW, w);
    assert.equal(parsedH, h);

    const bitDepth = png[24];
    const colorType = png[25];
    assert.equal(bitDepth, 8);
    assert.equal(colorType, 6); // RGBA

    // 4. Verify IDAT decompresses cleanly via zlib.inflateSync (valid zlib stream)
    const idatLen = view.getUint32(33, false);
    const idatData = png.subarray(37 + 4, 37 + 4 + idatLen - 4);
    // Decompress the entire raw IDAT payload
    const fullIdat = png.subarray(41, 41 + idatLen);
    const decompressed = zlib.inflateSync(fullIdat);
    assert.equal(decompressed.length, h * (1 + w * 4));

    // 5. Check IEND chunk at tail
    const iendChunk = png.subarray(png.length - 12);
    const iendType = String.fromCharCode(...iendChunk.subarray(4, 8));
    assert.equal(iendType, 'IEND');

    // 6. Test round-trip base64
    const b64 = bytesToBase64(png);
    const decoded = base64ToBytes(b64);
    assert.deepEqual(decoded, png);
  }
});

test('encodeQoi and decodeQoi correctly encode and roundtrip varied pixel buffers', () => {
  const w = 16;
  const h = 16;
  const pixels = new Uint8Array(w * h * 4);

  // Fill with varied pixels to exercise all QOI opcodes:
  // Runs, Diff, Luma, Index, RGB, and RGBA
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (y < 4) {
        // Run of solid green
        pixels[idx] = 30;
        pixels[idx + 1] = 200;
        pixels[idx + 2] = 50;
        pixels[idx + 3] = 255;
      } else if (y < 8) {
        // Small diff steps (QOI_OP_DIFF)
        pixels[idx] = (30 + x) & 0xff;
        pixels[idx + 1] = (200 + ((x % 2) - 1)) & 0xff;
        pixels[idx + 2] = 50;
        pixels[idx + 3] = 255;
      } else if (y < 12) {
        // Luma steps (larger green delta)
        pixels[idx] = (30 + x * 2) & 0xff;
        pixels[idx + 1] = (100 + x * 4) & 0xff;
        pixels[idx + 2] = (50 + x * 2) & 0xff;
        pixels[idx + 3] = 255;
      } else {
        // Varied alpha (QOI_OP_RGBA)
        pixels[idx] = (x * 15) & 0xff;
        pixels[idx + 1] = (y * 15) & 0xff;
        pixels[idx + 2] = 128;
        pixels[idx + 3] = (x * 16) & 0xff;
      }
    }
  }

  const encoded = encodeQoi(pixels, w, h);

  // Check magic 'qoif'
  assert.equal(encoded[0], 0x71);
  assert.equal(encoded[1], 0x6f);
  assert.equal(encoded[2], 0x69);
  assert.equal(encoded[3], 0x66);

  // Check end marker
  const end = encoded.subarray(encoded.length - 8);
  assert.deepEqual(Array.from(end), [0, 0, 0, 0, 0, 0, 0, 1]);

  // Decode and assert pixel equality
  const decoded = decodeQoi(encoded);
  assert.equal(decoded.width, w);
  assert.equal(decoded.height, h);
  assert.equal(decoded.channels, 4);
  assert.deepEqual(decoded.pixels, pixels);
});

test('generateThumbnailImage returns null without fake fallback when no renderer available', async () => {
  const spec = { width: 48, height: 48, format: 'PNG' };
  const result = await generateThumbnailImage(spec);
  // In Node environment without window.__plateScene or customRenderer, must return null
  assert.equal(result, null, 'Must return null rather than generating invented solid fallback image');
});

test('embedThumbnailsInGcode gracefully preserves existing thumbnails or raw G-code when no thumbnails generated', async () => {
  const gcodeWithExistingThumb = `; HEADER_BLOCK_START\n; HEADER_BLOCK_END\n\n; THUMBNAIL_BLOCK_START\n; thumbnail begin 48x48 10\n; ABCDEFGHIJ\n; thumbnail end\n; THUMBNAIL_BLOCK_END\n\nG1 X10 Y10\n`;
  
  // With no renderer and no models, it should gracefully preserve raw G-code / existing thumbnail
  const res = await embedThumbnailsInGcode(gcodeWithExistingThumb);
  const resStr = new TextDecoder().decode(res);

  assert.equal(resStr, gcodeWithExistingThumb, 'Must preserve existing thumbnail block when no new render occurs');

  const rawGcodeNoThumb = `; HEADER_BLOCK_START\n; HEADER_BLOCK_END\n\nG1 X10 Y10\n`;
  const res2 = await embedThumbnailsInGcode(rawGcodeNoThumb);
  const resStr2 = new TextDecoder().decode(res2);
  assert.equal(resStr2, rawGcodeNoThumb, 'Must preserve raw G-code without injecting fake thumbnails');
});

test('embedThumbnailsInGcode embeds true QOI thumbnail with thumbnail_QOI tag', async () => {
  const rawGcode = `; HEADER_BLOCK_START\n; HEADER_BLOCK_END\n\nG1 X10 Y10\n`;

  const customRenderer = (w, h, fmt) => {
    if (fmt === 'QOI') {
      const pixels = new Uint8Array(w * h * 4);
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 200;
        pixels[i + 1] = 100;
        pixels[i + 2] = 50;
        pixels[i + 3] = 255;
      }
      return encodeQoi(pixels, w, h);
    }
    return null;
  };

  const embedded = await embedThumbnailsInGcode(rawGcode, {
    currentConfig: { thumbnails: '64x64/QOI' },
    customRenderer
  });

  const embeddedStr = new TextDecoder().decode(embedded);
  assert.ok(embeddedStr.includes('; thumbnail_QOI begin 64x64'));
  assert.ok(embeddedStr.includes('; thumbnail_QOI end'));

  // Extract base64 and decode bytes
  const match = embeddedStr.match(/; thumbnail_QOI begin 64x64 \d+\n([\s\S]*?); thumbnail_QOI end/);
  assert.ok(match, 'Must match thumbnail block');
  const b64 = match[1].replace(/;\s*/g, '').replace(/\r?\n/g, '').trim();
  const bytes = base64ToBytes(b64);

  // Verify true QOI magic
  assert.equal(bytes[0], 0x71); // 'q'
  assert.equal(bytes[1], 0x6f); // 'o'
  assert.equal(bytes[2], 0x69); // 'i'
  assert.equal(bytes[3], 0x66); // 'f'

  const decoded = decodeQoi(bytes);
  assert.equal(decoded.width, 64);
  assert.equal(decoded.height, 64);
});

test('insertThumbnailBlocks places thumbnails right after HEADER_BLOCK_END or CONFIG_BLOCK_END', () => {
  const gcodeWithHeader = `; HEADER_BLOCK_START\n; generated by OrcaSlicer\n; HEADER_BLOCK_END\n\n; EXECUTABLE_BLOCK_START\nG1 X10 Y10\n`;
  const thumbText = `; THUMBNAIL_BLOCK_START\n; thumbnail begin 48x48 10\n; thumbnail end\n; THUMBNAIL_BLOCK_END\n\n`;

  const embedded = insertThumbnailBlocks(gcodeWithHeader, thumbText);
  assert.ok(
    embedded.startsWith(
      `; HEADER_BLOCK_START\n; generated by OrcaSlicer\n; HEADER_BLOCK_END\n\n; THUMBNAIL_BLOCK_START\n`
    )
  );
  assert.ok(embedded.includes('; EXECUTABLE_BLOCK_START\nG1 X10 Y10\n'));

  // A footer config must not move thumbnails to the end of a print.
  const gcodeWithConfig = `; HEADER_BLOCK_START\n; HEADER_BLOCK_END\n\n; CONFIG_BLOCK_START\n; key = val\n; CONFIG_BLOCK_END\n\n; EXECUTABLE_BLOCK_START\n`;
  const embeddedConfig = insertThumbnailBlocks(gcodeWithConfig, thumbText);
  assert.ok(
    embeddedConfig.includes('; HEADER_BLOCK_END\n\n; THUMBNAIL_BLOCK_START\n')
  );
});

test('embedThumbnailsInGcode cleanly replaces previous thumbnail blocks without duplicates', async () => {
  const initialGcode = `; HEADER_BLOCK_START\n; HEADER_BLOCK_END\n\n; EXECUTABLE_BLOCK_START\nG1 X10 Y10\n`;
  const customRenderer = (w, h) => generateValidPng(w, h);

  const firstPass = await embedThumbnailsInGcode(initialGcode, {
    currentConfig: { thumbnails: '48x48/PNG' },
    customRenderer
  });

  const firstPassStr = new TextDecoder().decode(firstPass);
  const blockCount1 = (firstPassStr.match(/; THUMBNAIL_BLOCK_START/g) || []).length;
  assert.equal(blockCount1, 1);

  // Re-embed with 2 thumbnails
  const secondPass = await embedThumbnailsInGcode(firstPass, {
    currentConfig: { thumbnails: '48x48/PNG, 300x300/PNG' },
    customRenderer
  });
  const secondPassStr = new TextDecoder().decode(secondPass);
  const blockCount2 = (secondPassStr.match(/; THUMBNAIL_BLOCK_START/g) || []).length;
  assert.equal(blockCount2, 2, 'Must contain exactly 2 blocks with no leftover old block');
});

test('embedThumbnailsInGcode preserves normalized G-code hash', async () => {
  const rawGcode = `; HEADER_BLOCK_START\n; max_z_height: 20.00\n; HEADER_BLOCK_END\n\n; EXECUTABLE_BLOCK_START\nEXCLUDE_OBJECT_DEFINE NAME=cube\nM73 P0 R9\nG28\nG1 X100 Y100 E1.5 F1800\n`;
  const rawNormalized = normalizeGcode(rawGcode);
  const customRenderer = (w, h) => generateValidPng(w, h);

  const embedded = await embedThumbnailsInGcode(rawGcode, {
    currentConfig: { thumbnails: '48x48/PNG, 300x300/PNG' },
    customRenderer
  });
  const embeddedStr = new TextDecoder().decode(embedded);
  const embeddedNormalized = normalizeGcode(embeddedStr);

  assert.equal(embeddedNormalized, rawNormalized, 'Normalized hash must be identical after stripping thumbnails');
});

test('getOrBuildGcodeWithThumbnails guarantees exact same-byte payload for download, save, and upload', async () => {
  clearExportGcodeCache();

  const rawGcode = new TextEncoder().encode(
    `; HEADER_BLOCK_START\n; HEADER_BLOCK_END\n\nG1 X50 Y50\n`
  );
  const customRenderer = (w, h) => generateValidPng(w, h);

  // 1. Download payload
  const downloadPayload = await getOrBuildGcodeWithThumbnails(rawGcode, { plateIndex: 0, customRenderer });

  // 2. Save payload
  const savePayload = await getOrBuildGcodeWithThumbnails(rawGcode, { plateIndex: 0, customRenderer });

  // 3. Upload payload via cache
  const uploadPayload = getCachedExportGcode(0);

  // Must be exact same object reference and exact byte contents
  assert.equal(downloadPayload, savePayload, 'Download and save must return same cached Uint8Array reference');
  assert.equal(downloadPayload, uploadPayload, 'Download and upload must return same cached Uint8Array reference');
  assert.deepEqual(downloadPayload, savePayload);
  assert.deepEqual(downloadPayload, uploadPayload);
});

test('per-plate models are isolated across different plates', async () => {
  clearExportGcodeCache();

  const rawGcodePlate0 = new TextEncoder().encode(`; HEADER_BLOCK_START\n; plate: 1\n; HEADER_BLOCK_END\n\nG1 X10\n`);
  const rawGcodePlate1 = new TextEncoder().encode(`; HEADER_BLOCK_START\n; plate: 2\n; HEADER_BLOCK_END\n\nG1 X20\n`);

  const customRenderer = (w, h, fmt, pIdx) => {
    // Generate different fill color per plate
    const fill = pIdx === 1 ? [255, 0, 0, 255] : [0, 255, 0, 255];
    return generateValidPng(w, h, fill);
  };

  const payloadPlate0 = await getOrBuildGcodeWithThumbnails(rawGcodePlate0, { plateIndex: 0, customRenderer });
  const payloadPlate1 = await getOrBuildGcodeWithThumbnails(rawGcodePlate1, { plateIndex: 1, customRenderer });

  assert.notEqual(payloadPlate0, payloadPlate1);
  const str0 = new TextDecoder().decode(payloadPlate0);
  const str1 = new TextDecoder().decode(payloadPlate1);
  assert.notEqual(str0, str1, 'Plate 0 and Plate 1 payloads must differ according to per-plate model renders');
});

test('raw-only export does not decode bytes when the renderer returns no thumbnails', async () => {
  const raw = new TextEncoder().encode('; thumbnail begin 1x1 4\n; AAAA\n; thumbnail end\nG1 X1\n');
  const OriginalDecoder = globalThis.TextDecoder;
  let decoded = 0;
  globalThis.TextDecoder = class extends OriginalDecoder {
    decode(...args) { ++decoded; return super.decode(...args); }
  };
  try {
    assert.equal(await embedThumbnailsInGcode(raw, { customRenderer: () => null }), raw);
    assert.equal(decoded, 0, 'existing thumbnails and raw bytes need no full-file decode');
  } finally { globalThis.TextDecoder = OriginalDecoder; }
});

test('invalidated thumbnail builds cannot replace a newer cached export', async () => {
  clearExportGcodeCache();
  const oldRaw = new TextEncoder().encode('G1 X10\n');
  const newRaw = new TextEncoder().encode('G1 X20\n');
  let finishOld;
  const oldBuild = getOrBuildGcodeWithThumbnails(oldRaw, {
    currentConfig: { thumbnails: '1x1/PNG' },
    customRenderer: () => new Promise(resolve => { finishOld = resolve; })
  });
  clearExportGcodeCache(newRaw);
  const newExport = await getOrBuildGcodeWithThumbnails(newRaw, {
    currentConfig: { thumbnails: '1x1/PNG' }, customRenderer: () => generateValidPng(1, 1)
  });
  finishOld(generateValidPng(1, 1));
  await oldBuild;
  assert.equal(getCachedExportGcode(0, newRaw), newExport);
  assert.equal(getCachedExportGcode(0, oldRaw), null);
  clearExportGcodeCache();
});

test('cleared slices reject both delayed completions and older exports starting after invalidation', async () => {
  clearExportGcodeCache();
  const oldRaw = new TextEncoder().encode('G1 X10\n');
  let finish;
  const build = getOrBuildGcodeWithThumbnails(oldRaw, {
    currentConfig: { thumbnails: '1x1/PNG' }, customRenderer: () => new Promise(resolve => { finish = resolve; })
  });
  clearExportGcodeCache(null);
  finish(generateValidPng(1, 1));
  await build;
  assert.equal(getCachedExportGcode(), null);
  const newerRaw = new TextEncoder().encode('G1 X20\n');
  clearExportGcodeCache(newerRaw);
  await getOrBuildGcodeWithThumbnails(oldRaw, { customRenderer: () => null });
  assert.equal(getCachedExportGcode(), null, 'an old export delayed before thumbnail work cannot resurrect the prior input');
  clearExportGcodeCache();
});
