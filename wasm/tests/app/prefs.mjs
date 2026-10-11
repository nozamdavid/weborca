#!/usr/bin/env node
/**
 * Browser test of OrcaSlicer Preferences and View menu features, Chromium then Firefox:
 * - Scene defaults unchanged
 * - Preferences dialog (Ctrl+P / menu) with General, Camera, Display tabs
 * - Toggling grid / axes / labels updates scene state on window.__plateScene
 * - Wheel inversion flips camera distance change direction for the same wheel event
 * - Preferences persist across page reload
 * - Key 'K' toggles perspective vs orthographic camera
 * - Reset to defaults restores default behavior
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5124;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch({
    headless: true,
    args: ['--enable-features=SharedArrayBuffer']
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  try {
    log('Step 1: Navigating to page and waiting for engine and scene ready...');
    await page.goto(BASE_URL);
    await page.waitForFunction(
      () => window.__appStore?.getState().isEngineReady && window.__plateScene,
      null,
      { timeout: 90000 }
    );

    log('Step 2: Verifying defaults remain inert and unchanged...');
    const defaults = await page.evaluate(() => {
      const s = window.__plateScene;
      return {
        showGrid: s.showGrid,
        showAxes: s.showAxes,
        showLabels: s.showLabels,
        showBuildVolume: s.showBuildVolume,
        showWireframe: s.showWireframe,
        cameraType: s.cameraType,
        invertMouseWheelZoom: s.invertMouseWheelZoom
      };
    });
    assert.equal(defaults.showGrid, true, 'bed grid is visible by default');
    assert.equal(defaults.showAxes, true, 'origin axes are visible by default');
    assert.equal(defaults.showLabels, false, 'object labels are off by default');
    assert.equal(defaults.showBuildVolume, true, 'build volume wireframe is visible by default');
    assert.equal(defaults.showWireframe, false, 'wireframe objects is off by default');
    assert.equal(defaults.cameraType, 'perspective', 'camera is perspective by default');
    assert.equal(defaults.invertMouseWheelZoom, false, 'mouse wheel zoom is not inverted by default');

    log('Step 3: Opening Preferences dialog via Ctrl+P shortcut...');
    await page.keyboard.press('Control+p');
    await page.waitForSelector('.modal-content', { state: 'visible' });
    const dialog = page.locator('.modal-content');
    assert.match(await dialog.locator('h2').innerText(), /Preferences/i);

    log('Step 4: Navigating Preferences tabs...');
    // General tab is active by default
    assert.equal(await dialog.locator('#pref-tab-general').getAttribute('aria-selected'), 'true');
    assert.equal(await dialog.locator('#pref-language').inputValue(), 'en');
    assert.equal(await dialog.locator('#pref-remember-recent-files').isChecked(), true);
    assert.equal(await dialog.locator('#pref-auto-arrange-on-import').isChecked(), false);
    assert.equal(await dialog.locator('#pref-auto-slice-after-change').isChecked(), false);

    // Switch to Camera tab
    await dialog.locator('#pref-tab-camera').click();
    assert.equal(await dialog.locator('#pref-tab-camera').getAttribute('aria-selected'), 'true');
    assert.equal(await dialog.locator('#pref-invert-mouse-wheel-zoom').isChecked(), false);
    assert.equal(await dialog.locator('#pref-invert-orbit-horizontal').isChecked(), false);
    assert.equal(await dialog.locator('#pref-invert-orbit-vertical').isChecked(), false);

    // Switch to Display tab
    await dialog.locator('#pref-tab-display').click();
    assert.equal(await dialog.locator('#pref-tab-display').getAttribute('aria-selected'), 'true');
    assert.equal(await dialog.locator('#pref-show-grid').isChecked(), true);
    assert.equal(await dialog.locator('#pref-show-axes').isChecked(), true);
    assert.equal(await dialog.locator('#pref-show-labels').isChecked(), false);

    // Toggle grid and labels in Display tab
    log('Step 5: Toggling settings in Preferences dialog and checking scene updates...');
    await dialog.locator('#pref-show-grid').click();
    await dialog.locator('#pref-show-labels').click();

    const sceneAfterToggle = await page.evaluate(() => ({
      showGrid: window.__plateScene.showGrid,
      showLabels: window.__plateScene.showLabels
    }));
    assert.equal(sceneAfterToggle.showGrid, false, 'scene showGrid updated to false');
    assert.equal(sceneAfterToggle.showLabels, true, 'scene showLabels updated to true');

    assert.equal(await dialog.locator('.close-btn').innerText(), '×');
    await page.evaluate(() => window.__prefsStore.getState().setCameraPref('defaultCameraType', 'orthographic'));
    assert.equal(await page.evaluate(() => window.__plateScene.cameraType), 'orthographic', 'default camera selection applies to the scene');
    await page.evaluate(() => window.__prefsStore.getState().setCameraPref('defaultCameraType', 'perspective'));

    // Close Preferences dialog
    await dialog.locator('#pref-close-btn').click();
    await page.waitForSelector('.modal-content', { state: 'detached' });

    log('Step 6: Toggling axes and camera type via View menu and keyboard shortcuts...');
    // View menu toggles
    await page.click('button.menu-label:has-text("View")');
    await page.waitForSelector('.menu-popup', { state: 'visible' });
    await page.click('.menu-item:has-text("Axes")');

    const sceneAfterAxesToggle = await page.evaluate(() => window.__plateScene.showAxes);
    assert.equal(sceneAfterAxesToggle, false, 'scene showAxes updated to false via View menu');

    // Toggle camera type with key K
    await page.keyboard.press('k');
    const camType1 = await page.evaluate(() => window.__plateScene.cameraType);
    assert.equal(camType1, 'orthographic', 'key K toggles camera to orthographic');

    await page.keyboard.press('k');
    const camType2 = await page.evaluate(() => window.__plateScene.cameraType);
    assert.equal(camType2, 'perspective', 'key K toggles camera back to perspective');

    log('Step 7: Testing mouse wheel zoom inversion on 3D canvas...');
    const getCameraDist = () =>
      page.evaluate(() => {
        const s = window.__plateScene;
        return s.camera.position.distanceTo(s.orbitControls.target);
      });

    // Ensure wheel inversion is OFF
    await page.evaluate(() => window.__prefsStore.getState().setCameraPref('invertMouseWheelZoom', false));
    const distBeforeNormal = await getCameraDist();
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 150, bubbles: true, cancelable: true }));
    });
    const distAfterNormal = await getCameraDist();
    const diffNormal = distAfterNormal - distBeforeNormal;
    assert.ok(diffNormal > 0, `normal wheel zoom moves camera away (dolly out), diff was ${diffNormal}`);

    // Set wheel inversion to ON
    await page.evaluate(() => window.__prefsStore.getState().setCameraPref('invertMouseWheelZoom', true));
    const distBeforeInverted = await getCameraDist();
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 150, bubbles: true, cancelable: true }));
    });
    const distAfterInverted = await getCameraDist();
    const diffInverted = distAfterInverted - distBeforeInverted;
    assert.ok(diffInverted < 0, `inverted wheel zoom moves camera closer (dolly in), diff was ${diffInverted}`);
    assert.ok(diffNormal * diffInverted < 0, 'wheel inversion successfully flipped the zoom direction');

    log('Step 8: Testing preferences persistence across reload...');
    // A newly chosen default projection also survives startup.
    await page.evaluate(() => window.__prefsStore.getState().setCameraPref('defaultCameraType', 'orthographic'));
    await page.reload();
    await page.waitForFunction(
      () => window.__appStore?.getState().isEngineReady && window.__plateScene,
      null,
      { timeout: 90000 }
    );

    assert.equal(await page.evaluate(() => window.__plateScene.cameraType), 'orthographic');
    const reloadedState = await page.evaluate(() => {
      const s = window.__plateScene;
      const p = window.__prefsStore.getState();
      return {
        sceneGrid: s.showGrid,
        sceneAxes: s.showAxes,
        sceneLabels: s.showLabels,
        sceneWheelInvert: s.invertMouseWheelZoom,
        storeGrid: p.display.showGrid,
        storeAxes: p.display.showAxes,
        storeLabels: p.display.showLabels,
        storeWheelInvert: p.camera.invertMouseWheelZoom
      };
    });
    assert.equal(reloadedState.sceneGrid, false, 'grid=false persisted in scene across reload');
    assert.equal(reloadedState.sceneAxes, false, 'axes=false persisted in scene across reload');
    assert.equal(reloadedState.sceneLabels, true, 'labels=true persisted in scene across reload');
    assert.equal(reloadedState.sceneWheelInvert, true, 'wheelInvert=true persisted in scene across reload');

    log('Step 9: Reset to defaults...');
    await page.evaluate(() => window.__prefsStore.getState().resetDefaults());
    const resetState = await page.evaluate(() => ({
      showGrid: window.__plateScene.showGrid,
      showAxes: window.__plateScene.showAxes,
      showLabels: window.__plateScene.showLabels,
      invertMouseWheelZoom: window.__plateScene.invertMouseWheelZoom
    }));
    assert.equal(resetState.showGrid, true, 'reset restored showGrid to true');
    assert.equal(resetState.showAxes, true, 'reset restored showAxes to true');
    assert.equal(resetState.showLabels, false, 'reset restored showLabels to false');
    assert.equal(resetState.invertMouseWheelZoom, false, 'reset restored wheel invert to false');

    log('Step 10: Verifying Help menu and About dialog info...');
    await page.click('button.menu-label:has-text("Help")');
    await page.waitForSelector('.menu-popup', { state: 'visible' });
    await page.click('.menu-item:has-text("About OrcaSlicer Web")');
    await page.waitForSelector('.modal-content', { state: 'visible' });

    const aboutText = await page.locator('.modal-content').innerText();
    assert.match(aboutText, /App Version:\s*0\.1\.0/);
    assert.match(aboutText, /Engine:\s*OrcaSlicer 02\.08\.01\.55/);
    await page.click('.modal-content .btn-primary:has-text("Close")');

    log(`All checks passed on ${name}!`);
  } finally {
    await browser.close();
  }
}

console.log(`Starting server on port ${PORT}...`);
await startServer(PORT, 'prefs');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All preferences tests PASSED on Chromium and Firefox!');
} catch (err) {
  console.error('Preferences tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
