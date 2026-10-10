#!/usr/bin/env node
/** Browser test of the 3D navigator cube: it follows the camera, a click on a face selects that view, and the View menu hides it. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5124', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  /** The part of a face's normal that points at the viewer (CSS z of its matrix). */
  const facing = (id) => page.evaluate((i) => {
    const m = new DOMMatrix(getComputedStyle(document.getElementById(i)).transform);
    return m.m33;
  }, id);
  // Faces overlap in 3D, so a pointer click may land on a neighbour; the handler is what is under test.
  const clickFace = (id) => page.evaluate((i) => document.getElementById(i).click(), id);
  const lookDirection = () => page.evaluate(() => {
    const v = new window.__plateScene.camera.position.constructor();
    window.__plateScene.camera.getWorldDirection(v);
    return [v.x, v.y, v.z];
  });

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.waitForSelector('#view-cube');

    log('a click on Top looks down and turns the Top face toward the viewer');
    await clickFace('view-cube-top');
    await page.waitForTimeout(800);
    assert.ok((await lookDirection())[2] < -0.95, 'the camera looks down');
    assert.ok((await facing('view-cube-top')) > 0.95, 'the Top face faces the viewer');

    log('Front');
    await clickFace('view-cube-front');
    await page.waitForTimeout(800);
    const dir = await lookDirection();
    assert.ok(dir[1] > 0.8 && Math.abs(dir[2]) < 0.3, `the camera looks along +y (${dir})`);
    assert.ok((await facing('view-cube-front')) > 0.8, 'the Front face faces the viewer');

    log('Left and Right swap with the camera side');
    await clickFace('view-cube-left');
    await page.waitForTimeout(800);
    assert.ok((await lookDirection())[0] > 0.8, 'looking from the left means looking along +x');
    assert.ok((await facing('view-cube-left')) > 0.8);

    log('the View menu hides it');
    await page.locator('.menu-label', { hasText: 'View' }).first().click();
    await page.locator('.menu.open .menu-item', { hasText: '3D navigator' }).first().click();
    await page.waitForSelector('#view-cube', { state: 'detached' });
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'viewcube');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All view cube tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('View cube tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
