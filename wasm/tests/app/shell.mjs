#!/usr/bin/env node
/**
 * Browser test of the desktop-style shell, Chromium then Firefox: top bar and tabs, no layout overflow at common
 * window sizes, collapsible sidebar sections, Calibration menu dialogs, and the camera view buttons and keys.
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

    log('light theme applies the palette to plate controls and their settings popup');
    await page.evaluate(() => window.__prefsStore.getState().setDisplayPref('theme', 'light'));
    const plateColors = await page.locator('#plate-selector-bar').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
    assert.equal(plateColors.background, 'rgb(246, 246, 247)');
    assert.equal(plateColors.color, 'rgb(37, 39, 42)');
    await page.click('#plate-settings-btn');
    assert.equal(await page.locator('#plate-settings-popover').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(246, 246, 247)');
    await page.click('#plate-settings-btn');
    await page.evaluate(() => window.__prefsStore.getState().setDisplayPref('theme', 'dark'));

    log('toolbar labels and tooltips follow the selected language');
    await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('language', 'es'));
    await page.getByRole('button', { name: 'Mover', exact: true }).waitFor();
    assert.equal(await page.locator('#tool-move-btn').getAttribute('aria-label'), 'Mover');
    assert.equal(await page.locator('#tool-move-btn').getAttribute('data-tip'), 'Mover (M)');
    await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('language', 'en'));
    await page.getByRole('button', { name: 'Move', exact: true }).waitFor();
    assert.equal(await page.locator('#tool-move-btn').getAttribute('aria-label'), 'Move');

    log('horizontal/vertical toolbar pref defaults vertical');
    const toolbar = page.locator('.canvas-toolbar');
    assert.equal(await toolbar.getAttribute('aria-orientation'), 'vertical');
    await page.evaluate(() => window.__prefsStore.getState().setDisplayPref('toolbarOrientation', 'horizontal'));
    assert.equal(await toolbar.getAttribute('aria-orientation'), 'horizontal');

    const blockedTools = await toolbar.locator('button').evaluateAll(buttons => buttons.filter(button => {
      const r = button.getBoundingClientRect();
      return !button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }).map(button => button.id));
    assert.deepEqual(blockedTools, [], 'camera controls must not intercept horizontal tools');

    log('keyboard resizing starts from the rendered width on narrower windows');
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.evaluate(() => window.__prefsStore.getState().setDisplayPref('sidebarWidth', 360));
    await page.locator('.sidebar-resizer').press('ArrowLeft');
    assert.equal(Math.round((await page.locator('aside.sidebar').boundingBox()).width), 290);
    await page.setViewportSize({ width: 820, height: 800 });
    await page.locator('.sidebar-resizer').press('ArrowLeft');
    assert.equal(Math.round((await page.locator('aside.sidebar').boundingBox()).width), 236,
      'narrow sidebar must remain resizable below the 30% cap');
    await page.setViewportSize({ width: 1280, height: 800 });

    log('resizing via drag <=30% and preference persistence');
    await page.evaluate(() => window.__prefsStore.getState().setDisplayPref('sidebarWidth', 250));
    await page.waitForTimeout(200); 
    const sidebar = page.locator('aside.sidebar');
    const resizer = page.locator('.sidebar-resizer');
    let bbox = await resizer.boundingBox();
    // Drag to 500 (should cap at 30% of 1280 = 384)
    await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(500, bbox.y + bbox.height / 2, { steps: 5 });
    await page.mouse.up();
    let wStr = await sidebar.evaluate(el => el.style.width);
    let wNum = parseFloat(wStr);
    assert.equal(Math.round(wNum), 384, 'sidebar width is capped at 30% of window (384 for 1280)');

    // Drag to 100 (should cap at min 220)
    bbox = await resizer.boundingBox();
    await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(100, bbox.y + bbox.height / 2, { steps: 5 });
    await page.mouse.up();
    wStr = await sidebar.evaluate(el => el.style.width);
    wNum = parseFloat(wStr);
    assert.equal(Math.round(wNum), 220, 'sidebar width is floored at 220');

    // check persistence
    const prefW = await page.evaluate(() => window.__prefsStore.getState().display.sidebarWidth);
    assert.equal(Math.round(prefW), 220, 'sidebar width is persisted to pref');
    // Reload page to ensure preference persistence
    await page.reload();
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    const prefAfterW = await page.evaluate(() => window.__prefsStore.getState().display.sidebarWidth);
    assert.equal(Math.round(prefAfterW), 220, 'sidebar width pref persists after reload');

    log('resetting preferences resizes the canvas to its new container');
    await page.evaluate(() => window.__prefsStore.getState().resetDefaults());
    await page.waitForFunction(() => {
      const scene = window.__plateScene;
      return scene?.renderer.domElement.clientWidth === scene?.container.clientWidth;
    });
    await page.evaluate(() => window.__prefsStore.getState().setDisplayPref('sidebarWidth', 220));

    log('the tabs switch screens');
    for (const tab of ['preview', 'device', 'prepare']) {
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

    log('the Calibration menu opens its dialogs');
    const more = page.locator('.topbar-menus > summary');
    if (await more.isVisible()) await more.click();
    await page.getByRole('button', { name: 'Calibration', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Flow rate...', exact: true }).click();
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

    log('automatic perspective switches fixed views and orbiting, while respecting manual projection');
    const projection = () => page.evaluate(() => window.__plateScene.getCameraType());
    assert.equal(await page.evaluate(() => window.__prefsStore.getState().display.autoPerspective), false);
    await page.evaluate(() => window.__prefsStore.getState().setDisplayPref('autoPerspective', true));
    await page.click('#view-top');
    assert.equal(await projection(), 'orthographic');
    assert.equal(await page.evaluate(() => window.__prefsStore.getState().display.cameraType), 'orthographic');
    const canvas = await page.locator('.plate-view canvas').first().boundingBox();
    assert.ok(canvas);
    const orbit = async () => {
      const x = canvas.x + canvas.width * 0.9, y = canvas.y + canvas.height * 0.8;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 60, y - 30, { steps: 5 });
      await page.mouse.up();
    };
    await orbit();
    assert.equal(await projection(), 'perspective');
    await page.click('#view-top');
    await page.evaluate(() => window.__plateScene.toggleCameraType());
    await page.evaluate(() => window.__plateScene.toggleCameraType());
    assert.equal(await projection(), 'orthographic');
    await orbit();
    assert.equal(await projection(), 'orthographic', 'manual projection remains until another fixed view is selected');
    await page.click('#view-iso');
    assert.equal(await projection(), 'perspective');
    await page.evaluate(() => window.__prefsStore.getState().setDisplayPref('autoPerspective', false));
    await page.click('#view-top');
    assert.equal(await projection(), 'perspective', 'disabled preference preserves the selected projection');

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
