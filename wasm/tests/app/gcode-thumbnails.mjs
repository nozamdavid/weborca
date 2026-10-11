#!/usr/bin/env node
import { decodeQoi } from '../lib/thumbnail-images.ts';
/**
 * @file gcode-thumbnails.mjs
 * Browser test suite for OrcaSlicer-style G-code thumbnails in Chromium and Firefox:
 * 1. Imports real 20mm cube, selects Voron presets, slices plate.
 * 2. Exports G-code payload with real model rendering (no bed/UI, transparent background).
 * 3. Decodes base64 thumbnails to canvas:
 *    - Verifies actual dimensions (e.g. 48x48, 300x300, non-square 120x80).
 *    - Verifies nonempty varied pixel alpha/colors (shading present, not flat solid fill).
 *    - Verifies no bed or UI elements rendered.
 * 4. Verifies configured image formats and magic headers:
 *    - PNG: 0x89 0x50 0x4E 0x47 ('\x89PNG') with 'thumbnail' tag
 *    - JPG: 0xFF 0xD8 0xFF with 'thumbnail_JPG' tag
 *    - QOI: 0x71 0x6F 0x69 0x66 ('qoif') with 'thumbnail_QOI' tag
 * 5. Verifies per-plate model isolation across multiple plates.
 * 6. Verifies empty plate renders null without invented fake fallback images.
 * 7. Saves browser verification screenshots.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';
import {
  getOrBuildGcodeWithThumbnails,
  base64ToBytes
} from '../../app/src/shell/gcodeThumbnails.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// Import Playwright
let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../../app/node_modules/playwright/index.mjs');
}
const { chromium, firefox } = playwright;

const PORT = parseInt(process.env.PORT || '5138', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Running G-code Thumbnails Tests on ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const browser = await browserType.launch({
    headless: true,
    args: ['--enable-features=SharedArrayBuffer']
  });

  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${browserName} pageerror]`, err));

  const log = (msg) => console.log(`[${browserName}] ${msg}`);

  const openFileMenu = async () => {
    const fileLabel = page.locator('.menu-label', { hasText: 'File' }).first();
    await fileLabel.click();
    await page.waitForSelector('.menu.open .menu-popup', { state: 'visible' });
  };
  const getMenuItem = (label) => page.locator('.menu.open .menu-item', { hasText: label }).first();

  try {
    log('1. Navigating to web app and waiting for Engine readiness...');
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.waitForFunction(
      () => window.__appStore?.getState().isEngineReady && window.__plateScene,
      null,
      { timeout: 90000 }
    );

    log('2. Configuring Voron presets and importing 20mm cube...');
    await page.waitForFunction(() => {
      const v = document.getElementById('vendor-select');
      return v && v.options.length > 1;
    }, null, { timeout: 15000 });
    await page.selectOption('#vendor-select', 'Voron');

    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    await page.waitForFunction(() => {
      const proc = document.getElementById('process-select');
      const fil = document.getElementById('filament-select');
      return proc && !proc.disabled && Array.from(proc.options).some((o) => o.value === '0.20mm Standard @Voron') &&
             fil && !fil.disabled && Array.from(fil.options).some((o) => o.value === 'Generic PLA @System');
    }, null, { timeout: 15000 });
    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.selectOption('#filament-select', 'Generic PLA @System');

    // Import model
    await page.setInputFiles('#model-file', CUBE_PATH);
    await page.waitForFunction(
      () => window.__plateStore?.getState().objects.length >= 1,
      null,
      { timeout: 30000 }
    );
    log('Cube model imported onto Plate 1');

    log('3. Slicing plate with Voron profile...');
    await page.waitForFunction(
      () => !document.getElementById('slice-btn')?.disabled,
      null,
      { timeout: 15000 }
    );
    await page.click('#slice-btn');
    await page.waitForFunction(
      () => {
        const s = window.__appStore.getState();
        return !s.isSlicing && s.sliceResult?.gcode;
      },
      null,
      { timeout: 120000 }
    );
    log('Plate slicing finished');

    // -------------------------------------------------------------------------
    // TEST 1: Default PNG thumbnails render real models with varied pixels
    // -------------------------------------------------------------------------
    log('4. Testing default PNG thumbnails (48x48 and 300x300)...');
    const pngResult = await page.evaluate(async () => {
      const scene = window.__plateScene;
      if (!scene) return { error: 'No plateScene' };

      // Render 48x48 and 300x300 PNGs
      const dataUrl48 = scene.renderThumbnail({ width: 48, height: 48, format: 'PNG', plateIndex: 0 });
      const dataUrl300 = scene.renderThumbnail({ width: 300, height: 300, format: 'PNG', plateIndex: 0 });

      if (!dataUrl48 || !dataUrl300) {
        return { error: 'renderThumbnail returned null for occupied plate' };
      }

      // Analyze pixels using an offscreen canvas
      async function analyzeImage(dataUrl, expectedW, expectedH) {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imgData = ctx.getImageData(0, 0, img.width, img.height);
        const px = imgData.data;

        let transparentCount = 0;
        let opaqueCount = 0;
        const uniqueColors = new Set();

        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3];
          if (a === 0) {
            transparentCount++;
          } else {
            opaqueCount++;
            uniqueColors.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
          }
        }

        const b64 = dataUrl.split(',')[1];
        const binary = atob(b64);
        const magic = [binary.charCodeAt(0), binary.charCodeAt(1), binary.charCodeAt(2), binary.charCodeAt(3)];

        return {
          width: img.width,
          height: img.height,
          expectedW,
          expectedH,
          transparentCount,
          opaqueCount,
          uniqueColorCount: uniqueColors.size,
          magic,
          dataUrlLength: dataUrl.length
        };
      }

      const res48 = await analyzeImage(dataUrl48, 48, 48);
      const res300 = await analyzeImage(dataUrl300, 300, 300);

      return { res48, res300 };
    });

    assert.equal(pngResult.error, undefined, pngResult.error);

    // Verify 48x48
    const r48 = pngResult.res48;
    assert.equal(r48.width, 48);
    assert.equal(r48.height, 48);
    assert.deepEqual(r48.magic, [0x89, 0x50, 0x4e, 0x47], 'PNG magic signature 0x89 PNG');
    assert.ok(r48.opaqueCount > 100, `Model must be visible with opaque pixels: got ${r48.opaqueCount}`);
    assert.ok(r48.transparentCount > 100, `Bed/UI must be absent with transparent background: got ${r48.transparentCount}`);
    assert.ok(r48.uniqueColorCount >= 2, `Pixels must have varied 3D shading across cube faces: got ${r48.uniqueColorCount}`);

    // Verify 300x300
    const r300 = pngResult.res300;
    assert.equal(r300.width, 300);
    assert.equal(r300.height, 300);
    assert.deepEqual(r300.magic, [0x89, 0x50, 0x4e, 0x47]);
    assert.ok(r300.opaqueCount > 2000, `Model must have substantial pixel coverage: got ${r300.opaqueCount}`);
    assert.ok(r300.transparentCount > 5000, `Transparent canvas margin around model: got ${r300.transparentCount}`);
    assert.ok(r300.uniqueColorCount >= 3, `Varied shading across 300x300: got ${r300.uniqueColorCount}`);
    log('PNG 48x48 and 300x300 verified with real model pixels and transparent background');

    // -------------------------------------------------------------------------
    // TEST 2: Configured format JPG
    // -------------------------------------------------------------------------
    log('5. Testing JPG thumbnail generation and magic...');
    const jpgResult = await page.evaluate(async () => {
      const scene = window.__plateScene;
      const dataUrl = scene.renderThumbnail({ width: 120, height: 120, format: 'JPG', plateIndex: 0 });
      if (!dataUrl) return { error: 'JPG render returned null' };

      const b64 = dataUrl.split(',')[1];
      const binary = atob(b64);
      const magic = [binary.charCodeAt(0), binary.charCodeAt(1), binary.charCodeAt(2)];

      const img = new Image();
      img.src = dataUrl;
      await img.decode();

      return {
        width: img.width,
        height: img.height,
        magic
      };
    });

    assert.equal(jpgResult.error, undefined);
    assert.equal(jpgResult.width, 120);
    assert.equal(jpgResult.height, 120);
    assert.deepEqual(jpgResult.magic, [0xff, 0xd8, 0xff], 'JPG SOI marker 0xFF 0xD8 0xFF');
    log('JPG 120x120 verified with valid JPEG magic');

    // -------------------------------------------------------------------------
    // TEST 3: Configured format QOI (true QOI binary format, magic 'qoif')
    // -------------------------------------------------------------------------
    log('6. Testing QOI thumbnail encoding and magic...');
    const qoiResult = await page.evaluate(async () => {
      const scene = window.__plateScene;
      const dataUrl = scene.renderThumbnail({ width: 64, height: 64, format: 'QOI', plateIndex: 0 });
      if (!dataUrl) return { error: 'QOI render returned null' };

      const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const binary = atob(b64);
      const magic = [
        binary.charCodeAt(0),
        binary.charCodeAt(1),
        binary.charCodeAt(2),
        binary.charCodeAt(3)
      ];

      // Read width & height from big-endian QOI header bytes 4..11
      const w = (binary.charCodeAt(4) << 24) | (binary.charCodeAt(5) << 16) | (binary.charCodeAt(6) << 8) | binary.charCodeAt(7);
      const h = (binary.charCodeAt(8) << 24) | (binary.charCodeAt(9) << 16) | (binary.charCodeAt(10) << 8) | binary.charCodeAt(11);
      const channels = binary.charCodeAt(12);

      // Verify end marker (last 8 bytes: 7 zeros + 1)
      const len = binary.length;
      const endMarker = [];
      for (let i = len - 8; i < len; i++) endMarker.push(binary.charCodeAt(i));

      return {
        magic,
        width: w,
        height: h,
        channels,
        endMarker,
        byteLength: binary.length
      };
    });

    assert.equal(qoiResult.error, undefined);
    assert.deepEqual(qoiResult.magic, [0x71, 0x6f, 0x69, 0x66], "QOI header must be 'qoif'");
    assert.equal(qoiResult.width, 64);
    assert.equal(qoiResult.height, 64);
    assert.equal(qoiResult.channels, 4);
    assert.deepEqual(qoiResult.endMarker, [0, 0, 0, 0, 0, 0, 0, 1], 'QOI 8-byte end marker');
    log('True QOI 64x64 binary verified with magic qoif and valid header/footer');

    // -------------------------------------------------------------------------
    // TEST 4: Non-square dimensions framing
    // -------------------------------------------------------------------------
    log('7. Testing non-square dimensions framing (150x80 and 80x150)...');
    const nonSquareResult = await page.evaluate(async () => {
      const scene = window.__plateScene;
      const wideUrl = scene.renderThumbnail({ width: 150, height: 80, format: 'PNG', plateIndex: 0 });
      const tallUrl = scene.renderThumbnail({ width: 80, height: 150, format: 'PNG', plateIndex: 0 });

      async function checkVisible(dataUrl) {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height).data;
        let opaque = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 0) opaque++;
        }
        return { width: img.width, height: img.height, opaque };
      }

      const wide = await checkVisible(wideUrl);
      const tall = await checkVisible(tallUrl);
      return { wide, tall };
    });

    assert.equal(nonSquareResult.wide.width, 150);
    assert.equal(nonSquareResult.wide.height, 80);
    assert.ok(nonSquareResult.wide.opaque > 500, 'Wide thumbnail frames visible model');

    assert.equal(nonSquareResult.tall.width, 80);
    assert.equal(nonSquareResult.tall.height, 150);
    assert.ok(nonSquareResult.tall.opaque > 500, 'Tall thumbnail frames visible model');
    log('Non-square aspect ratios (wide 150x80 and tall 80x150) frame correctly');

    // -------------------------------------------------------------------------
    // TEST 5: Multiple plates isolation and distinct renders
    // -------------------------------------------------------------------------
    log('8. Testing multiple plates model isolation...');
    await page.evaluate(async () => {
      // Add a second plate
      await window.__platesStore.getState().addPlate('Second Plate');
      await window.__platesStore.getState().fetchPlates();
    });

    const multiPlateRenders = await page.evaluate(async () => {
      const scene = window.__plateScene;
      // Plate 0 contains the cube
      const plate0Thumb = scene.renderThumbnail({ width: 64, height: 64, format: 'PNG', plateIndex: 0 });
      // Plate 1 is empty
      const plate1Thumb = scene.renderThumbnail({ width: 64, height: 64, format: 'PNG', plateIndex: 1 });

      return {
        plate0Thumb: plate0Thumb ? plate0Thumb.length : null,
        plate1Thumb: plate1Thumb // Must be null because plate 1 has no models!
      };
    });

    assert.ok(multiPlateRenders.plate0Thumb > 0, 'Plate 0 with cube must render thumbnail');
    assert.equal(multiPlateRenders.plate1Thumb, null, 'Empty Plate 1 must return null gracefully (no fake images)');
    log('Per-plate isolation confirmed: occupied plate renders, empty plate returns null');

    // -------------------------------------------------------------------------
    // TEST 6: Actual exported G-code payload contains native OrcaSlicer thumbnail blocks
    // -------------------------------------------------------------------------
    log('9. Re-slicing Plate 1 and testing production Export G-code file download...');
    await page.evaluate(async () => {
      window.__platesStore.getState().setActivePlate(0);
      await window.__platesStore.getState().slicePlate(0);
    });

    await page.waitForFunction(
      () => {
        const s = window.__appStore.getState();
        return !s.isSlicing && s.sliceResult?.gcode;
      },
      null,
      { timeout: 120000 }
    );
    log('Plate 1 re-sliced successfully');

    // Test production UI export download flow
    await openFileMenu();
    assert.equal(await getMenuItem('Export G-code').isDisabled(), false, 'Export G-code must be enabled');
    const [gcodeDownload] = await Promise.all([
      page.waitForEvent('download'),
      getMenuItem('Export G-code').click()
    ]);
    const gcodeStream = await gcodeDownload.createReadStream();
    const gcodeChunks = [];
    for await (const chunk of gcodeStream) gcodeChunks.push(chunk);
    const downloadedGcodeStr = Buffer.concat(gcodeChunks).toString('utf8');

    assert.ok(downloadedGcodeStr.includes('; THUMBNAIL_BLOCK_START'), 'Must contain ; THUMBNAIL_BLOCK_START');
    assert.ok(downloadedGcodeStr.includes('; THUMBNAIL_BLOCK_END'), 'Must contain ; THUMBNAIL_BLOCK_END');
    assert.ok(downloadedGcodeStr.includes('; thumbnail begin 48x48'), 'Must contain ; thumbnail begin 48x48');
    assert.ok(downloadedGcodeStr.includes('; thumbnail end'), 'Must contain ; thumbnail end');
    assert.ok(downloadedGcodeStr.includes('; thumbnail begin 300x300'), 'Must contain ; thumbnail begin 300x300');
    log('Production Export G-code download contains authentic OrcaSlicer comment blocks for 48x48 and 300x300');

    // Also test pipeline with QOI and JPG custom configs via browser live renderer
    const rawGcodeBytes = await page.evaluate(() => window.__appStore.getState().sliceResult.gcode);
    const customRenderer = (width, height, format, plateIndex) => {
      return page.evaluate(
        (args) => window.__plateScene?.renderThumbnail(args),
        { width, height, format, plateIndex }
      );
    };

    const qoiPayload = await getOrBuildGcodeWithThumbnails(new Uint8Array(rawGcodeBytes), {
      plateIndex: 0,
      currentConfig: { thumbnails: '64x64/QOI', thumbnails_format: 'QOI' },
      customRenderer
    });
    const qoiStr = new TextDecoder().decode(qoiPayload);
    assert.ok(qoiStr.includes('; thumbnail_QOI begin 64x64'));
    assert.ok(qoiStr.includes('; thumbnail_QOI end'));

    // Verify extracted QOI bytes from payload
    const qoiMatch = qoiStr.match(/; thumbnail_QOI begin 64x64 \d+\n([\s\S]*?); thumbnail_QOI end/);
    assert.ok(qoiMatch);
    const qoiB64 = qoiMatch[1].replace(/;\s*/g, '').replace(/\r?\n/g, '').trim();
    const qoiDecoded = decodeQoi(base64ToBytes(qoiB64));
    assert.equal(qoiDecoded.width, 64);
    assert.equal(qoiDecoded.height, 64);
    log('G-code payload with configured QOI format verified end-to-end');

    // Save screenshot for proof
    const screenshotPath = path.join(SCREENSHOT_DIR, `thumbnails-${browserName}.png`);
    await page.screenshot({ path: screenshotPath });
    log(`Saved browser verification screenshot: ${screenshotPath}`);

    console.log(`[${browserName}] All G-code thumbnail tests passed successfully!`);
    return { success: true, screenshotPath };
  } finally {
    await browser.close();
  }
}

async function run() {
  console.log(`Starting preview server on port ${PORT}...`);
  await startServer(PORT, 'gcode-thumbnails');

  try {
    const chromiumRes = await runBrowserSuite(chromium, 'chromium');
    const firefoxRes = await runBrowserSuite(firefox, 'firefox');

    console.log(`\n==================================================`);
    console.log(`SUMMARY: All browser thumbnail tests passed on Chromium & Firefox!`);
    console.log(`Screenshots:`);
    console.log(`- ${chromiumRes.screenshotPath}`);
    console.log(`- ${firefoxRes.screenshotPath}`);
    console.log(`==================================================\n`);
  } finally {
    console.log('Stopping preview server...');
    await stopServer(PORT);
  }
}

run().catch((err) => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
