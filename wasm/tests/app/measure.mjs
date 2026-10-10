#!/usr/bin/env node
/** Browser test of the measure tool: two clicks on the model give the distance and per-axis deltas. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5127', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  /** Screen position of a point on the top face, `dx` mm from the cube's centre. */
  const topPoint = (dx) => page.evaluate((d) => {
    const o = window.__plateStore.getState().objects[0];
    const V = window.__plateScene.camera.position.constructor;
    const v = new V(o.instances[0].offset[0] + d, o.instances[0].offset[1], o.size[2]).project(window.__plateScene.camera);
    const r = window.__plateScene.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, dx);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.selectOption('#vendor-select', 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.waitForTimeout(2000);
    await page.mouse.click(1000, 300, { button: 'right' });
    await page.hover('#plate-menu-primitive');
    await page.click('#plate-menu-cube');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1, null, { timeout: 120000 });
    await page.waitForTimeout(1000);

    log('the tool opens from the toolbar and asks for a point');
    await page.click('#tool-measure-btn');
    await page.waitForSelector('#measure-panel');
    assert.equal(await page.locator('#measure-result').count(), 0);

    log('two clicks 8 mm apart on the top face measure 8 mm along X');
    for (const dx of [-4, 4]) {
      const p = await topPoint(dx);
      await page.mouse.click(p.x, p.y);
    }
    await page.waitForSelector('#measure-result');
    const num = async (id) => parseFloat(await page.textContent(id));
    assert.ok(Math.abs((await num('#measure-distance')) - 8) < 0.3, await page.textContent('#measure-distance'));
    assert.ok(Math.abs((await num('#measure-dx')) - 8) < 0.3);
    assert.ok((await num('#measure-dz')) < 0.3);

    log('a third click starts a new measurement, and closing the panel leaves the tool');
    const p = await topPoint(0);
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(() => window.__plateStore.getState().measurePoints.length === 1);
    await page.keyboard.press('u');
    await page.waitForSelector('#measure-panel', { state: 'detached' });
    assert.equal(await page.evaluate(() => window.__plateStore.getState().measurePoints.length), 0);
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'measure');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All measure tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Measure tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
