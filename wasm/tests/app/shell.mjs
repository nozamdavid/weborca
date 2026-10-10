#!/usr/bin/env node
/**
 * Browser test of the desktop-style shell, Chromium then Firefox: top bar and tabs, no layout overflow at common
 * window sizes, collapsible sidebar sections, the Calibration page tiles, and the camera view buttons and keys.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const CUBE = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/data/20mm_cube.obj'));
const PORT = parseInt(process.env.PORT || '5085', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const overflows = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth
    || document.documentElement.scrollHeight > document.documentElement.clientHeight);
  const cameraPosition = () => page.evaluate(() => window.__plateScene.camera.position.toArray().map((v) => Math.round(v)));

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.waitForSelector('.topbar');

    log('the page never scrolls, at any common window size');
    for (const [width, height] of [[1280, 720], [1400, 850], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await overflows(), false, `no overflow at ${width}x${height}`);
    }
    await page.setViewportSize({ width: 1280, height: 720 });

    log('the tabs switch screens');
    for (const tab of ['preview', 'device', 'calibration', 'prepare']) {
      await page.click(`#tab-${tab}`);
      assert.ok(await page.locator(`#tab-${tab}`).evaluate((el) => el.classList.contains('active')), `${tab} tab is active`);
    }

    log('sidebar sections collapse and expand');
    const header = page.locator('.sb-head', { hasText: 'Printer' }).first();
    await page.locator('#printer-select').waitFor({ state: 'visible' });
    await header.click();
    await page.locator('#printer-select').waitFor({ state: 'detached' });
    await header.click();
    await page.locator('#printer-select').waitFor({ state: 'visible' });

    await page.evaluate(async (bytes) => {
      await window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], 'cube.obj'));
    }, Array.from(CUBE));
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1);

    log('the Calibration page tiles open their dialogs');
    await page.click('#tab-calibration');
    await page.click('#calibration-btn');
    await page.waitForSelector('#calibration-dialog');
    await page.click('[aria-label="Close Calibration dialog"]');
    await page.waitForSelector('#calibration-dialog', { state: 'detached' });
    await page.click('#tab-prepare');

    log('camera view buttons and number keys move the camera');
    await page.waitForFunction(() => window.__plateScene);
    await page.click('#view-top');
    const top = await cameraPosition();
    await page.click('#view-front');
    const front = await cameraPosition();
    assert.notDeepEqual(top, front, 'Top and Front are different views');
    await page.mouse.move(800, 400);
    await page.keyboard.press('1');
    assert.deepEqual(await cameraPosition(), top, 'key 1 selects the Top view, like desktop');

    log('opening Preview with nothing sliced starts the slice');
    assert.equal(await page.evaluate(() => window.__appStore.getState().sliceResult), null);
    await page.click('#tab-preview');
    await page.waitForSelector('#preview-slicing-overlay');
    assert.match(await page.locator('#preview-slicing-status').innerText(), /Slic|Starting/, 'progress is shown on the Preview tab');
    await page.waitForFunction(() => window.__appStore.getState().sliceResult?.gcode, null, { timeout: 120000 });
    await page.waitForSelector('#preview-slicing-overlay', { state: 'detached' });
    await page.click('#tab-prepare');

    log('the plate turns see-through when seen from below');
    const plateOpacity = () => page.evaluate(() => window.__plateScene.bedFloorMaterial.opacity);
    assert.equal(await plateOpacity(), 1, 'opaque from above');
    await page.keyboard.press('2');
    await page.waitForFunction(() => window.__plateScene.camera.position.z < 0);
    await page.waitForFunction(() => window.__plateScene.bedFloorMaterial.opacity < 1);
    await page.keyboard.press('1');
    await page.waitForFunction(() => window.__plateScene.bedFloorMaterial.opacity === 1);

    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'shell');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All shell tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Shell tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
