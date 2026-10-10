#!/usr/bin/env node
/**
 * @file preview.mjs
 * End-to-end Playwright test suite for OrcaSlicer Web Preview Screen.
 *
 * Runs against `vite preview` on port 5062 across Chromium and Firefox:
 * 1. Selects Voron presets, imports 20mm_cube.obj, slices.
 * 2. Verifies automatic switch to Preview screen.
 * 3. Checks WebGL2 canvas is not blank.
 * 4. Checks layer slider reports 100 layers and moving it alters canvas pixels.
 * 5. Changes view type to Speed and verifies legend changes to Speed ranges.
 * 6. Captures screenshots to wasm/build/tests-app/preview-<browser>.png.
 * 7. Measures and reports 3DBenchy time from slice end to first preview frame.
 * 8. Ensures port 5062 is cleanly released.
 */

import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// Import Playwright
let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import(path.resolve(repoRoot, 'wasm/tests/node_modules/playwright/index.mjs'));
}
const { chromium, firefox } = playwright;

const PORT = 5062;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const BENCHY_MODEL_PATH = path.resolve(repoRoot, 'wasm/build/models/3DBenchy.stl');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Running Preview Test Suite for ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const browser = await browserType.launch({
    headless: true,
    args: ['--enable-features=SharedArrayBuffer']
  });

  const pageErrors = [];
  const results = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    page.on('pageerror', (err) => {
      console.error(`[${browserName}] Page error:`, err);
      pageErrors.push(err.message);
    });

    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[OrcaPreview]') || text.includes('Error') || text.includes('error') || text.includes('Loaded G-code')) {
        console.log(`[${browserName} console] ${text}`);
      }
    });

    // 1. Page Load
    console.log(`[${browserName}] Step 1: Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    if (!isIsolated) {
      throw new Error(`crossOriginIsolated is false on ${browserName}`);
    }
    results.push({ name: 'Page Load & Cross-Origin Isolation', pass: true });

    // 2. Select Voron Presets
    console.log(`[${browserName}] Step 2: Selecting Voron presets...`);
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
      return (
        proc && !proc.disabled && Array.from(proc.options).some((o) => o.value === '0.20mm Standard @Voron') &&
        fil && !fil.disabled && Array.from(fil.options).some((o) => o.value === 'Generic PLA @System')
      );
    }, null, { timeout: 15000 });
    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.selectOption('#filament-select', 'Generic PLA @System');

    // 2b. Check Empty Preview State before Slicing
    console.log(`[${browserName}] Step 2b: Checking empty Preview screen state...`);
    const previewTabBtn = await page.$('#tab-preview');
    if (previewTabBtn) {
      await previewTabBtn.click();
      await page.waitForTimeout(100);
      const emptyText = await page.$eval('.orca-workspace', (el) => el.textContent);
      if (!emptyText.includes('No G-code toolpaths loaded')) {
        throw new Error('Expected "No G-code toolpaths loaded" placeholder in empty state');
      }
      const sliderBefore = await page.$('#layer-slider-container');
      if (sliderBefore !== null) {
        throw new Error('Layer slider should not be mounted when no G-code is loaded');
      }
      await page.click('#tab-prepare');
    }

    await page.evaluate(() => window.__appStore.getState().applyOptionChange('filament_cost', '25', 'filament'));

    // 3. Import 20mm_cube.obj and Slice
    console.log(`[${browserName}] Step 3: Importing 20mm_cube.obj and slicing...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    await page.waitForFunction(() => {
      const btn = document.getElementById('slice-btn');
      return btn && !btn.disabled;
    }, null, { timeout: 15000 });

    await page.click('#slice-btn');

    // 4. Wait for Slicing Completion & Switch to Preview Screen
    console.log(`[${browserName}] Step 4: Waiting for slice completion & Preview switch...`);
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#canvas');
      const previewStats = (window).previewStats;
      return canvas !== null && previewStats && previewStats.layers > 0;
    }, null, { timeout: 60000 });

    const stats = await page.evaluate(() => (window).previewStats);
    console.log(`[${browserName}] Preview loaded stats:`, JSON.stringify(stats));

    if (stats.layers !== 100) {
      throw new Error(`Expected 100 layers, got ${stats.layers}`);
    }
    results.push({ name: 'Voron Cube Slicing & Auto-Switch to Preview', pass: true });

    await page.waitForSelector('[data-testid="slice-stats-panel"] #stat-filament-cost', { timeout: 10000 });
    const costText = await page.$eval('#stat-filament-cost', (el) => el.textContent?.trim());
    if (!(parseFloat(costText) > 0)) throw new Error(`Filament cost not shown: "${costText}"`);
    console.log(`[${browserName}] Filament cost displayed: ${costText}`);

    // Verify Slicing Statistics panel filament length
    const filamentLengthText = await page.$eval('[data-testid=\"slice-stats-panel\"] #stat-filament-mm', (el) => el.textContent?.trim());
    console.log(`[${browserName}] Filament length displayed: \"${filamentLengthText}\"`);
    if (!filamentLengthText || filamentLengthText === '0.00 m' || filamentLengthText === '-') {
      throw new Error(`Filament length displayed invalid: \"${filamentLengthText}\"`);
    }
    const expectedMeters = (stats.filamentMm / 1000).toFixed(2) + ' m';
    if (filamentLengthText !== expectedMeters) {
      throw new Error(`Filament length displayed \"${filamentLengthText}\" does not match expected \"${expectedMeters}\"`);
    }
    results.push({ name: 'Slicing Statistics Filament Length (Non-Zero & Accurate)', pass: true });

    // 5. Canvas Blank Check (Inspect WebGL2 buffer)
    console.log(`[${browserName}] Step 5: Checking canvas is not blank...`);
    const canvasCheck = await page.evaluate(() => {
      const canvas = document.querySelector('#canvas');
      if (!canvas) return { isBlank: true, nonBgPixelCount: 0 };

      const c2 = document.createElement('canvas');
      c2.width = canvas.width;
      c2.height = canvas.height;
      const ctx2 = c2.getContext('2d');
      ctx2.drawImage(canvas, 0, 0);
      const img = ctx2.getImageData(0, 0, c2.width, c2.height);
      const data = img.data;

      let nonBgCount = 0;
      // Background color is ~(30, 30, 36)
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (Math.abs(r - 30) > 8 || Math.abs(g - 30) > 8 || Math.abs(b - 36) > 8) {
          nonBgCount++;
        }
      }
      return {
        width: canvas.width,
        height: canvas.height,
        nonBgPixelCount: nonBgCount,
        isBlank: nonBgCount === 0
      };
    });

    console.log(`[${browserName}] Canvas check:`, JSON.stringify(canvasCheck));
    if (canvasCheck.isBlank || canvasCheck.nonBgPixelCount === 0) {
      throw new Error('Preview canvas is blank!');
    }
    results.push({ name: 'Canvas Not Blank (Toolpaths Rendered)', pass: true });

    // 6. Test Layer Slider Scrubbing
    console.log(`[${browserName}] Step 6: Testing layer slider scrubbing (peeling to 10 layers)...`);
    const layerScrubResult = await page.evaluate(() => {
      if (window.preview) {
        window.preview.setLayerRange(0, window.previewStats.layers - 1);
        window.preview.render();
      }
      const c = document.querySelector('#canvas');
      const c2 = document.createElement('canvas');
      c2.width = c.width;
      c2.height = c.height;
      const ctx2 = c2.getContext('2d');
      ctx2.drawImage(c, 0, 0);
      const dataFull = ctx2.getImageData(0, 0, c2.width, c2.height).data;

      // Set layer range to [0, 10]
      if (window.preview) {
        window.preview.setLayerRange(0, 10);
        window.preview.render();
      }
      ctx2.clearRect(0, 0, c2.width, c2.height);
      ctx2.drawImage(c, 0, 0);
      const data10 = ctx2.getImageData(0, 0, c2.width, c2.height).data;

      let diffPixels = 0;
      for (let i = 0; i < dataFull.length; i += 4) {
        if (Math.abs(dataFull[i] - data10[i]) > 8 ||
            Math.abs(dataFull[i+1] - data10[i+1]) > 8 ||
            Math.abs(dataFull[i+2] - data10[i+2]) > 8) {
          diffPixels++;
        }
      }

      // Restore full range
      if (window.preview) {
        window.preview.setLayerRange(0, window.previewStats.layers - 1);
        window.preview.render();
      }

      return {
        diffPixels,
        changed: diffPixels > 500
      };
    });

    console.log(`[${browserName}] Layer scrub result:`, JSON.stringify(layerScrubResult));
    if (!layerScrubResult.changed) {
      throw new Error(`Layer slider change did not alter canvas image! diffPixels: ${layerScrubResult.diffPixels}`);
    }
    results.push({ name: 'Layer Slider Scrub Altered Image (100 Layers)', pass: true });

    // 6b. Focused Runtime Acceptance on Preview Controls
    console.log(`[${browserName}] Step 6b: Testing preview controls ARIA, keyboard bounds, drag release, and playback...`);

    // 1. ARIA Attributes on Dual Slider Handles
    const maxHandle = page.locator('#layer-handle-max');
    const minHandle = page.locator('#layer-handle-min');
    await maxHandle.waitFor({ state: 'visible', timeout: 5000 });
    await minHandle.waitFor({ state: 'visible', timeout: 5000 });

    const maxRole = await maxHandle.getAttribute('role');
    const maxOrient = await maxHandle.getAttribute('aria-orientation');
    const maxNow = await maxHandle.getAttribute('aria-valuenow');
    const maxText = await maxHandle.getAttribute('aria-valuetext');

    if (maxRole !== 'slider' || maxOrient !== 'vertical' || maxNow !== '100' || !maxText?.includes('Layer 100') || !maxText?.includes('mm')) {
      throw new Error(`Max handle ARIA mismatch: role=${maxRole}, orient=${maxOrient}, now=${maxNow}, text=${maxText}`);
    }

    const minRole = await minHandle.getAttribute('role');
    const minOrient = await minHandle.getAttribute('aria-orientation');
    const minNow = await minHandle.getAttribute('aria-valuenow');
    const minText = await minHandle.getAttribute('aria-valuetext');

    if (minRole !== 'slider' || minOrient !== 'vertical' || minNow !== '1' || !minText?.includes('Layer 1') || !minText?.includes('mm')) {
      throw new Error(`Min handle ARIA mismatch: role=${minRole}, orient=${minOrient}, now=${minNow}, text=${minText}`);
    }

    // 2. Visible Keyboard Focus
    await maxHandle.focus();
    const hasFocusMax = await maxHandle.evaluate((el) => el === document.activeElement);
    if (!hasFocusMax) throw new Error('Max handle could not receive focus');

    // 3. Keyboard Arrows / Home / End stay in bounds
    await maxHandle.press('ArrowUp');
    let maxValAfterUp = await maxHandle.getAttribute('aria-valuenow');
    if (maxValAfterUp !== '100') throw new Error(`Max handle exceeded 100 on ArrowUp: ${maxValAfterUp}`);

    await maxHandle.press('ArrowDown');
    let maxValAfterDown = await maxHandle.getAttribute('aria-valuenow');
    if (maxValAfterDown !== '99') throw new Error(`Max handle did not decrement on ArrowDown: ${maxValAfterDown}`);

    await maxHandle.press('Home');
    let maxValAfterHome = await maxHandle.getAttribute('aria-valuenow');
    if (maxValAfterHome !== '1') throw new Error(`Max handle did not jump to minLayer on Home: ${maxValAfterHome}`);

    await maxHandle.press('ArrowDown');
    let maxValBounded = await maxHandle.getAttribute('aria-valuenow');
    if (maxValBounded !== '1') throw new Error(`Max handle crossed below minLayer: ${maxValBounded}`);

    await maxHandle.press('End');
    let maxValAfterEnd = await maxHandle.getAttribute('aria-valuenow');
    if (maxValAfterEnd !== '100') throw new Error(`Max handle did not jump to 100 on End: ${maxValAfterEnd}`);

    await minHandle.focus();
    await minHandle.press('ArrowDown');
    let minValAfterDown = await minHandle.getAttribute('aria-valuenow');
    if (minValAfterDown !== '1') throw new Error(`Min handle crossed below 1 on ArrowDown: ${minValAfterDown}`);

    await minHandle.press('ArrowUp');
    let minValAfterUp = await minHandle.getAttribute('aria-valuenow');
    if (minValAfterUp !== '2') throw new Error(`Min handle did not increment on ArrowUp: ${minValAfterUp}`);

    await minHandle.press('End');
    let minValAfterEnd = await minHandle.getAttribute('aria-valuenow');
    if (minValAfterEnd !== '100') throw new Error(`Min handle did not jump to maxLayer on End: ${minValAfterEnd}`);

    await minHandle.press('ArrowUp');
    let minValBounded = await minHandle.getAttribute('aria-valuenow');
    if (minValBounded !== '100') throw new Error(`Min handle crossed above maxLayer: ${minValBounded}`);

    await minHandle.press('Home');
    let minValAfterHome = await minHandle.getAttribute('aria-valuenow');
    if (minValAfterHome !== '1') throw new Error(`Min handle did not jump to 1 on Home: ${minValAfterHome}`);

    // Single layer range test: set min=50, max=50
    await page.evaluate(() => {
      if (window.__previewStore) {
        window.__previewStore.getState().setLayerRangeAction(49, 49);
      }
    });
    await maxHandle.focus();
    await maxHandle.press('ArrowDown');
    const singleMaxDown = await maxHandle.getAttribute('aria-valuenow');
    if (singleMaxDown !== '50') throw new Error(`Single layer max crossed below min: ${singleMaxDown}`);

    await minHandle.focus();
    await minHandle.press('ArrowUp');
    const singleMinUp = await minHandle.getAttribute('aria-valuenow');
    if (singleMinUp !== '50') throw new Error(`Single layer min crossed above max: ${singleMinUp}`);

    await page.click('#btn-reset-layers');

    // 4. Dragging does not jump the other bound on release
    await page.evaluate(() => {
      const handle = document.getElementById('layer-handle-max');
      const track = document.getElementById('layer-slider-container');
      if (handle && track) {
        handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 100, pointerId: 1 }));
        handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 500, pointerId: 1 }));
        handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 500, pointerId: 1 }));
        track.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: 500 }));
      }
    });
    const minAfterDrag = await minHandle.getAttribute('aria-valuenow');
    if (minAfterDrag !== '1') {
      throw new Error(`Releasing max handle jumped min bound to: ${minAfterDrag}`);
    }
    await page.click('#btn-reset-layers');

    // 5. Playback stops on range change / unmount
    const playBtn = page.locator('#btn-play-moves');
    await playBtn.waitFor({ state: 'visible', timeout: 5000 });
    await playBtn.click();
    let playText = await playBtn.textContent();
    if (!playText?.includes('\u23f8')) {
      throw new Error(`Expected pause symbol \u23f8 when playing, got: ${playText}`);
    }

    await maxHandle.focus();
    await maxHandle.press('ArrowDown');
    await page.waitForTimeout(100);
    playText = await playBtn.textContent();
    if (!playText?.includes('\u25b6')) {
      throw new Error(`Playback should stop on layer range change, got: ${playText}`);
    }

    // Start playback again and verify unmount stops playback
    await playBtn.click();
    await page.evaluate(() => {
      if (window.__previewStore) {
        window.__previewStore.setState({ layersCount: 0 });
      }
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      if (window.__previewStore) {
        window.__previewStore.setState({ layersCount: 100, maxLayer: 99, minLayer: 0 });
      }
    });
    await page.waitForTimeout(50);
    const playBtnRemount = page.locator('#btn-play-moves');
    await playBtnRemount.waitFor({ state: 'visible', timeout: 5000 });
    playText = await playBtnRemount.textContent();
    if (!playText?.includes('\u25b6')) {
      throw new Error(`Playback should be stopped after unmount/remount, got: ${playText}`);
    }

    // 6. Preview empty -> loaded -> empty without React hook errors
    await page.evaluate(() => {
      if (window.__previewStore) {
        window.__previewStore.setState({ layersCount: 0 });
      }
    });
    await page.waitForTimeout(50);
    let isSliderPresent = await page.$('#layer-slider-container');
    if (isSliderPresent !== null) throw new Error('Slider should be unmounted when layersCount is 0');

    await page.evaluate(() => {
      if (window.__previewStore) {
        window.__previewStore.setState({ layersCount: 100, maxLayer: 99, minLayer: 0 });
      }
    });
    await page.waitForTimeout(50);
    isSliderPresent = await page.$('#layer-slider-container');
    if (isSliderPresent === null) throw new Error('Slider should be remounted when layersCount is 100');

    await page.evaluate(() => {
      if (window.__previewStore) {
        window.__previewStore.setState({ layersCount: 0 });
      }
    });
    await page.waitForTimeout(50);

    // Restore 100 layers
    await page.evaluate(() => {
      if (window.__previewStore) {
        window.__previewStore.setState({ layersCount: 100 });
        window.__previewStore.getState().resetLayersAction();
      }
    });
    await page.waitForTimeout(50);
    await page.waitForTimeout(100);

    // 7. Active drag teardown on unmount / preview reset and deliberate track click after drag
    await page.evaluate(() => {
      if (!window.__previewStore) {
        throw new Error('window.__previewStore is not exposed');
      }
    });

    // 7a. Interrupting active drag by actual unmount / preview reset then unrelated pointer movement not changing layer state
    await page.evaluate(() => {
      const store = window.__previewStore;
      store.getState().resetLayersAction();
      const handle = document.getElementById('layer-handle-max');
      if (!handle) throw new Error('layer-handle-max not found before drag interrupt');

      // Start active drag with pointerId 1
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 100, pointerId: 1 }));

      // Unrelated pointer ID movement during active drag should not change layer state
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 500, pointerId: 99 }));
      if (store.getState().maxLayer !== 99) {
        throw new Error(`Unrelated pointer ID modified maxLayer: ${store.getState().maxLayer}`);
      }

      // Interrupt active drag by resetting preview / unmounting LayerSlider
      store.setState({ layersCount: 0 });
    });
    await page.waitForTimeout(50);

    const sliderUnmounted = await page.$('#layer-slider-container');
    if (sliderUnmounted !== null) {
      throw new Error('LayerSlider should be unmounted when layersCount is 0');
    }

    // Unrelated pointer movement after unmount (both original and unrelated pointer IDs)
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 500, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 500, pointerId: 99 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 500, pointerId: 1 }));
    });

    // Remount slider and verify layer state was not mutated by orphaned listeners
    await page.evaluate(() => {
      const store = window.__previewStore;
      store.setState({ layersCount: 100, maxLayer: 99, minLayer: 0 });
      store.getState().resetLayersAction();
    });
    await page.waitForTimeout(50);

    const sliderRemounted = await page.$('#layer-slider-container');
    if (sliderRemounted === null) {
      throw new Error('LayerSlider should be remounted after resetting layersCount');
    }

    const stateAfterRemount = await page.evaluate(() => {
      const store = window.__previewStore;
      // Dispatch movement to confirm no orphaned listener lingering from unmounted instance
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 500, pointerId: 1 }));
      return { minLayer: store.getState().minLayer, maxLayer: store.getState().maxLayer };
    });
    if (stateAfterRemount.maxLayer !== 99 || stateAfterRemount.minLayer !== 0) {
      throw new Error(`Orphaned listener altered layer state: max=${stateAfterRemount.maxLayer}, min=${stateAfterRemount.minLayer}`);
    }

    // 7b. Ordinary drag then deliberate track click remains usable
    await page.evaluate(() => {
      const handle = document.getElementById('layer-handle-max');
      const track = document.getElementById('layer-slider-track') || handle?.parentElement;
      if (!handle || !track) throw new Error('Handle or track not found for deliberate track click test');

      const rect = track.getBoundingClientRect();
      const midY = rect.top + rect.height * 0.5;

      // Ordinary drag to mid-track
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: rect.top, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: midY, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: midY, pointerId: 1 }));
    });

    // Verify handle moved to approximately layer 50
    const maxValAfterOrdinaryDrag = await maxHandle.getAttribute('aria-valuenow');
    const dragLayerNum = parseInt(maxValAfterOrdinaryDrag || '0', 10);
    if (dragLayerNum < 35 || dragLayerNum > 65) {
      throw new Error(`Expected drag to reach mid-range (~50), got ${dragLayerNum}`);
    }

    // Wait past the post-drag suppression window (> 200ms)
    await page.waitForTimeout(250);

    // Deliberate track click near the top of track
    await page.evaluate(() => {
      const track = document.getElementById('layer-slider-track') || document.getElementById('layer-handle-max')?.parentElement;
      if (!track) throw new Error('Track element not found for deliberate click');
      const rect = track.getBoundingClientRect();
      const topY = rect.top + 4; // near top
      track.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: topY }));
    });

    const maxValAfterDeliberateClick = await maxHandle.getAttribute('aria-valuenow');
    const deliberateLayerNum = parseInt(maxValAfterDeliberateClick || '0', 10);
    if (deliberateLayerNum <= dragLayerNum) {
      throw new Error(`Deliberate track click did not jump handle: before=${dragLayerNum}, after=${deliberateLayerNum}`);
    }

    await page.click('#btn-reset-layers');

    if (pageErrors.length > 0) {
      throw new Error(`Page errors encountered during preview controls tests: ${pageErrors.join('; ')}`);
    }

    results.push({ name: 'Preview Controls: ARIA, Bounds, Drag, Playback & Empty', pass: true });

    // 7. Test Switching View Type to Speed
    console.log(`[${browserName}] Step 7: Switching view type to Speed and verifying legend...`);
    await page.selectOption('#view-type-select', 'Speed');

    await page.waitForFunction(() => {
      const legendTitle = document.getElementById('legend-title');
      const ranges = document.getElementById('legend-ranges-list');
      return legendTitle && legendTitle.textContent?.includes('Speed') && ranges !== null;
    }, null, { timeout: 10000 });

    const legendTitleText = await page.$eval('#legend-title', (el) => el.textContent?.trim());
    console.log(`[${browserName}] Switched view type to Speed. Legend title: \"${legendTitleText}\"`);
    results.push({ name: 'View Type Switch to Speed & Dynamic Legend', pass: true });

    // Verify Speed view legend ranges and cube multi-color rendering
    const speedLegendCheck = await page.evaluate(() => {
      const preview = window.preview;
      const legendRaw = preview ? JSON.parse(preview.getLegendData()) : null;
      if (!legendRaw || !legendRaw.ranges || legendRaw.ranges.length < 5) {
        return { ok: false, error: 'Legend ranges missing or empty' };
      }
      const vals = legendRaw.ranges.map((r) => r.value);
      const minVal = Math.min(...vals);
      const maxVal = Math.max(...vals);
      if (minVal < 40 || maxVal > 220 || minVal >= maxVal) {
        return { ok: false, error: `Invalid speed range bounds: [${minVal}, ${maxVal}]` };
      }

      // Normalized color directions for legend stops
      const legendDirs = legendRaw.ranges.map((r) => {
        const hex = r.color.replace('#', '');
        const rgb = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
        const len = Math.hypot(...rgb) || 1;
        return { color: r.color, norm: rgb.map((c) => c / len) };
      });

      const canvas = document.querySelector('#canvas');
      const c2 = document.createElement('canvas');
      c2.width = canvas.width;
      c2.height = canvas.height;
      const ctx2 = c2.getContext('2d');
      ctx2.drawImage(canvas, 0, 0);
      const img = ctx2.getImageData(
        Math.floor(canvas.width * 0.35),
        Math.floor(canvas.height * 0.35),
        Math.floor(canvas.width * 0.3),
        Math.floor(canvas.height * 0.3)
      );
      const data = img.data;

      const matchCounts = new Array(legendDirs.length).fill(0);

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // Filter out canvas background ~(30, 30, 36)
        if (Math.abs(r - 33) < 15 && Math.abs(g - 36) < 15 && Math.abs(b - 41) < 15) continue;
        const mag = Math.hypot(r, g, b);
        if (mag < 50) continue;
        // Filter out near-neutral bed grid / gray lines
        if (Math.max(r, g, b) - Math.min(r, g, b) < 15) continue;

        const pr = r / mag;
        const pg = g / mag;
        const pb = b / mag;

        let bestSim = -1;
        let bestIdx = -1;
        for (let j = 0; j < legendDirs.length; ++j) {
          const sim = pr * legendDirs[j].norm[0] + pg * legendDirs[j].norm[1] + pb * legendDirs[j].norm[2];
          if (sim > bestSim) {
            bestSim = sim;
            bestIdx = j;
          }
        }

        // Cosine similarity >= 0.94 accounts for lighting shading on toolpath surfaces
        if (bestSim >= 0.94 && bestIdx >= 0) {
          matchCounts[bestIdx]++;
        }
      }

      // Count distinct legend colors with substantial pixel coverage (>= 20 pixels)
      const matchedLegendColorsCount = matchCounts.filter((cnt) => cnt >= 20).length;

      return { ok: true, minVal, maxVal, matchedLegendColorsCount };
    });

    console.log(`[${browserName}] Speed legend check:`, JSON.stringify(speedLegendCheck));
    if (!speedLegendCheck.ok || speedLegendCheck.matchedLegendColorsCount < 3) {
      throw new Error(`Speed view check failed: ${JSON.stringify(speedLegendCheck)}`);
    }
    results.push({ name: 'Speed View Multi-Color Toolpaths & Range Validity', pass: true });
    // Verify TopBar layout at 1280x720 and 1920x1080 (no clipping)
    for (const [w, h] of [[1280, 720], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(100);
      const topbarCheck = await page.evaluate(() => {
        const topbar = document.querySelector('.topbar');
        const title = document.querySelector('.topbar-logo');
        if (!topbar || !title) return { ok: false, error: 'Elements not found' };
        const tbRect = topbar.getBoundingClientRect();
        const tRect = title.getBoundingClientRect();
        return {
          ok: tbRect.top >= 0 && tRect.top >= 0 && tbRect.height >= 36,
          tbTop: tbRect.top,
          tbHeight: tbRect.height,
          titleTop: tRect.top
        };
      });
      console.log(`[${browserName}] Topbar check at ${w}x${h}:`, JSON.stringify(topbarCheck));
      if (!topbarCheck.ok) {
        throw new Error(`TopBar clipped at ${w}x${h}: ${JSON.stringify(topbarCheck)}`);
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    results.push({ name: 'TopBar Unclipped at 1280x720 and 1920x1080', pass: true });

    // 8. Capture Screenshot
    const screenshotPath = path.resolve(SCREENSHOT_DIR, `preview-${browserName}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`[${browserName}] Saved screenshot to ${screenshotPath}`);

    // 9. Benchy Performance Measurement (Slice end to first preview frame)
    console.log(`[${browserName}] Step 9: Measuring Benchy preview load performance...`);
    if (!fs.existsSync(BENCHY_MODEL_PATH)) {
      console.log(`Fetching 3DBenchy model...`);
      execSync('bash wasm/tests/data/fetch_models.sh', { cwd: repoRoot, stdio: 'inherit' });
    }

    // Switch to Prepare tab if tabs exist
    const prepareTab = await page.$('#tab-prepare');
    if (prepareTab) {
      await prepareTab.click();
      await page.waitForSelector('#plate-canvas-container', { timeout: 5000 });
    }

    // Reset preview canvas dataset and window stats
    await page.evaluate(() => {
      const canvas = document.querySelector('#canvas');
      if (canvas) {
        delete canvas.dataset.previewReady;
        delete canvas.dataset.sliceToFrameMs;
      }
      (window).previewStats = null;
    });

    console.log(`[${browserName}] Importing 3DBenchy.stl...`);
    await page.setInputFiles('#model-file', BENCHY_MODEL_PATH);

    // Wait for model load & arrange to complete and Slice button to enable
    await page.waitForFunction(() => {
      const btn = document.getElementById('slice-btn');
      return btn && !btn.disabled && !btn.textContent?.includes('Slicing');
    }, null, { timeout: 20000 });

    console.log(`[${browserName}] 3DBenchy ready. Starting slice...`);
    await page.click('#slice-btn');

    await page.waitForFunction(() => {
      const btn = document.getElementById('slice-btn');
      return btn && btn.textContent?.includes('Slicing');
    }, null, { timeout: 15000 });

    console.log(`[${browserName}] Slicing active. Waiting for completion and first preview frame...`);

    await page.waitForFunction(() => {
      const canvas = document.querySelector('#canvas');
      const stats = (window).previewStats;
      return stats && stats.layers > 100 && canvas && canvas.dataset.previewReady === 'true';
    }, null, { timeout: 120000 });

    const benchyTiming = await page.evaluate(() => {
      const canvas = document.querySelector('#canvas');
      const sliceToFrameMs = canvas?.dataset.sliceToFrameMs
        ? parseFloat(canvas.dataset.sliceToFrameMs)
        : 0;
      return { diffMs: sliceToFrameMs };
    });

    console.log(`[${browserName}] 3DBenchy Time from slice end to first preview frame: ${benchyTiming.diffMs.toFixed(1)} ms`);
    results.push({
      name: `3DBenchy Preview First Frame (${benchyTiming.diffMs.toFixed(1)} ms)`,
      pass: true,
      diffMs: benchyTiming.diffMs
    });

    if (pageErrors.length > 0) {
      throw new Error(`Encountered page errors: ${pageErrors.join('; ')}`);
    }

    await browser.close();
    return { browserName, results, pass: true, benchyDiffMs: benchyTiming.diffMs };
  } catch (err) {
    await browser.close();
    console.error(`[${browserName}] Test failed:`, err);
    return { browserName, results, pass: false, error: err.message };
  }
}

async function main() {
  console.log('================================================================================');
  console.log('OrcaSlicer Web Preview Test Suite');
  console.log(`Target: Vite Preview on Port ${PORT}`);
  console.log('================================================================================\n');

  let allPass = true;
  const suiteResults = [];

  try {
    await startServer(PORT, 'preview');

    for (const [bType, bName] of [[chromium, 'chromium'], [firefox, 'firefox']]) {
      const res = await runBrowserSuite(bType, bName);
      suiteResults.push(res);
      if (!res.pass) {
        allPass = false;
      }
    }
  } finally {
    await stopServer(PORT);
  }

  console.log('\n================================================================================');
  console.log('PREVIEW TEST EXECUTION SUMMARY');
  console.log('================================================================================');
  for (const { browserName, results, pass, error, benchyDiffMs } of suiteResults) {
    console.log(`\nBrowser: ${browserName.toUpperCase()} [${pass ? 'PASS' : 'FAIL'}]`);
    for (const r of results) {
      console.log(`  - ${r.name.padEnd(55)}: ${r.pass ? 'PASS' : 'FAIL'}`);
    }
    if (benchyDiffMs !== undefined) {
      console.log(`  * Benchy slice-to-preview latency: ${benchyDiffMs.toFixed(1)} ms`);
    }
    if (error) {
      console.log(`  * ERROR: ${error}`);
    }
  }
  console.log('\n================================================================================');

  if (!allPass) {
    console.error('Preview tests failed!');
    process.exit(1);
  }

  console.log('All preview tests passed successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
