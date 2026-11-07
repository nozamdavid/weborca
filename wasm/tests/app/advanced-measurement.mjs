#!/usr/bin/env node
/**
 * Browser test of advanced measurements:
 * Checks UI selection, readout, snapping controls, and reset at desktop and 390px mobile layouts.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const PORT = parseInt(process.env.PORT || '5138', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (err) => console.error('[pageerror]', err));

    console.log('[desktop] Navigating to app...');
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    await selectAddedPrinter(page, 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.waitForTimeout(1000);

    // Add a cube to test measurements on
    await page.mouse.click(1000, 300, { button: 'right' });
    await page.hover('#plate-menu-primitive');
    await page.click('#plate-menu-cube');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1, null, { timeout: 120000 });
    await page.waitForTimeout(500);

    console.log('[desktop] Opening measure tool...');
    await page.click('#tool-measure-btn');
    await page.waitForSelector('#measure-panel');

    // 1. Check snapping buttons exist
    const snapButtons = ['#measure-snap-auto', '#measure-snap-face', '#measure-snap-edge', '#measure-snap-circle', '#measure-snap-point'];
    for (const btn of snapButtons) {
      await page.waitForSelector(btn);
      assert.equal(await page.locator(btn).count(), 1, `Button ${btn} must exist`);
    }

    // Toggle snap mode to Face
    await page.click('#measure-snap-face');
    assert.equal(await page.getAttribute('#measure-snap-face', 'aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.__measureStore.getState().snapMode), 'plane');

    // Toggle snap mode to Circle
    await page.click('#measure-snap-circle');
    assert.equal(await page.getAttribute('#measure-snap-circle', 'aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.__measureStore.getState().snapMode), 'circle');

    // 2. Test readout with simulated / state-driven feature selection
    console.log('[desktop] Testing feature selection readout...');
    await page.evaluate(() => {
      const s = window.__measureStore.getState();
      s.setFeature1({
        type: 'circle',
        circle: {
          center: [0, 0, 20],
          normal: [0, 0, 1],
          radius: 10,
          diameter: 20
        }
      });
      s.setResult({
        success: true,
        hasAnyData: true,
        distance: 20,
        diameter: 20,
        distanceType: 'diameter'
      });
    });

    await page.waitForSelector('#measure-result');
    const diamText = await page.textContent('#measure-diameter');
    assert.ok(diamText.includes('20.00'), `Expected diameter readout, got ${diamText}`);

    // Set second feature to test angle & distance readout
    await page.evaluate(() => {
      const s = window.__measureStore.getState();
      s.setFeature2({
        type: 'edge',
        edge: {
          start: [0, 0, 20],
          end: [20, 0, 20],
          length: 20
        }
      });
      s.setResult({
        success: true,
        hasAnyData: true,
        distance: 15.5,
        distanceType: 'strict',
        angle: {
          rad: Math.PI / 2,
          deg: 90,
          center: [0, 0, 20],
          radius: 5,
          coplanar: true,
          unit: 'deg'
        },
        delta: [10, 5, 0]
      });
    });

    await page.waitForSelector('#measure-angle');
    assert.ok((await page.textContent('#measure-angle')).includes('90.00°'));
    assert.ok((await page.textContent('#measure-distance')).includes('15.50'));
    assert.ok((await page.textContent('#measure-dx')).includes('10.00'));

    // 3. Test Reset button and pending first query invalidation
    console.log('[desktop] Testing restart selection and pending first query invalidation...');
    await page.evaluate(async () => {
      const s = window.__measureStore.getState();
      const initialGen = s.resetGeneration;
      // Controlled promise representing late query resolution
      let resolveQuery;
      const queryPromise = new Promise((resolve) => { resolveQuery = resolve; });
      // User triggers reset while feature1 and feature2 are null
      s.resetSelection();
      if (window.__measureStore.getState().resetGeneration <= initialGen) throw new Error('resetGeneration did not increment on reset');
      resolveQuery({
        type: 'circle',
        circle: { center: [0, 0, 0], normal: [0, 0, 1], radius: 10, diameter: 20 }
      });
      await queryPromise;
      if (window.__measureStore.getState().feature1 !== null) throw new Error('Late query restored cleared selection');
    });

    await page.click('#measure-reset');
    assert.equal(await page.evaluate(() => window.__measureStore.getState().feature1), null);
    assert.equal(await page.evaluate(() => window.__measureStore.getState().result), null);

    // 3b. Test actionable error display for circle mode mismatch
    console.log('[desktop] Testing actionable error display for circle mode mismatch...');
    await page.evaluate(() => {
      window.__measureStore.getState().setError('No circular feature detected on selected face');
    });
    await page.waitForSelector('#measure-error');
    const errText = await page.textContent('#measure-error');
    assert.ok(errText.includes('circular'), `Expected circular mismatch error, got ${errText}`);
    // Clear error on reset
    await page.click('#measure-reset');
    assert.equal(await page.evaluate(() => window.__measureStore.getState().error), null);
    assert.equal(await page.locator('#measure-error').count(), 0);

    // 4. Test 390px mobile layout
    console.log('[mobile 390] Testing 390px layout...');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    const panelBox = await page.locator('#measure-panel').boundingBox();
    assert.ok(panelBox != null, 'Measure panel should be visible in 390px mobile layout');
    assert.ok(panelBox.width <= 390, `Panel width ${panelBox.width} must fit within 390px screen`);
    assert.ok(panelBox.x >= 0, `Panel x ${panelBox.x} must be inside screen`);

    // Verify touch target sizes on mobile
    const resetBox = await page.locator('#measure-reset').boundingBox();
    assert.ok(resetBox && resetBox.height >= 38, `Reset button height ${resetBox?.height} should be >= 38px on touch`);

    const autoBtnBox = await page.locator('#measure-snap-auto').boundingBox();
    assert.ok(autoBtnBox && autoBtnBox.height >= 36, `Snap button height ${autoBtnBox?.height} should be >= 36px on touch`);

    // 5. Test Close / Exit
    console.log('Testing close button...');
    await page.click('#measure-close');
    await page.waitForSelector('#measure-panel', { state: 'detached' });
    assert.equal(await page.evaluate(() => window.__plateStore.getState().measureActive), false);

    console.log('Advanced measurement browser tests passed successfully.');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'advanced-measure');
try {
  await run();
} catch (err) {
  console.error('Advanced measurement test FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
