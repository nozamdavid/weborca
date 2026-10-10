#!/usr/bin/env node
/**
 * Browser test of the numeric transform fields in the selection panel, Chromium then Firefox: position, rotation,
 * scale and size are typed in, the engine applies them, and proportions stay locked unless unticked.
 */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5114', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const instance = () => page.evaluate(() => { const o = window.__plateStore.getState().objects[0]; return { ...o.instances[0], size: o.size }; });
  const type = async (id, value) => {
    await page.fill(`#${id}`, value);
    await page.press(`#${id}`, 'Enter');
  };

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.mouse.click(1000, 300, { button: 'right' });
    await page.hover('#plate-menu-primitive');
    await page.click('#plate-menu-cube');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1, null, { timeout: 120000 });
    await page.evaluate(() => { const s = window.__plateStore.getState(); s.selectObject(s.objects[0].id, s.objects[0].instances[0].id); });
    await page.waitForSelector('#numeric-transform');

    log('position is applied');
    await type('nt-pos-x', '60');
    await page.waitForFunction(() => Math.abs(window.__plateStore.getState().objects[0].instances[0].offset[0] - 60) < 0.01);
    assert.equal(await page.inputValue('#nt-pos-x'), '60');

    log('rotation is typed in degrees');
    await type('nt-rot-z', '90');
    await page.waitForFunction(() => Math.abs(window.__plateStore.getState().objects[0].instances[0].rotation[2] - Math.PI / 2) < 1e-3);
    assert.equal(await page.inputValue('#nt-rot-z'), '90');

    log('scale locks proportions by default');
    const before = await instance();
    await type('nt-scale-x', '200');
    await page.waitForFunction((s) => window.__plateStore.getState().objects[0].instances[0].scale[1] > s * 1.9, before.scale[1]);
    const doubled = await instance();
    assert.ok(Math.abs(doubled.scale[0] / before.scale[0] - 2) < 0.01 && Math.abs(doubled.scale[2] / before.scale[2] - 2) < 0.01);

    log('with the lock off only the typed axis changes');
    await page.uncheck('#nt-lock');
    await type('nt-scale-z', '50');
    await page.waitForFunction((z) => window.__plateStore.getState().objects[0].instances[0].scale[2] < z * 0.6, doubled.scale[2]);
    const flat = await instance();
    assert.ok(Math.abs(flat.scale[0] - doubled.scale[0]) < 1e-6, 'x is untouched');

    log('an invalid entry is ignored');
    await type('nt-scale-x', 'abc');
    assert.equal(await page.inputValue('#nt-scale-x'), '200');
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'transform');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All transform tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Transform tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
