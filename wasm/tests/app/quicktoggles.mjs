#!/usr/bin/env node
/** Browser test of the sidebar quick toggles (support, brim, prime tower, ironing): they read and write the process settings. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const PORT = parseInt(process.env.PORT || '5116', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const cfg = (key) => page.evaluate((k) => window.__appStore.getState().currentConfig[k], key);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await selectAddedPrinter(page, 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.enable_support !== undefined, null, { timeout: 60000 });

    log('the toggles show the current settings');
    for (const [id, key, off] of [['support', 'enable_support', '0'], ['ironing', 'ironing_type', 'no ironing']]) {
      assert.equal(await page.locator(`#quick-${id}`).isChecked(), (await cfg(key)) !== off, `${id} matches ${key}`);
    }
    assert.equal(await page.locator('#quick-prime-tower').isDisabled(), true, 'the prime tower needs several filaments');

    log('support on and off');
    await page.click('#quick-support');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.enable_support === '1');
    assert.equal(await page.locator('#quick-support').isChecked(), true);
    await page.click('#quick-support');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.enable_support === '0');

    log('brim on and off');
    await page.click('#quick-brim');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.brim_type === 'auto_brim');
    await page.click('#quick-brim');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.brim_type === 'no_brim');

    log('ironing on and off');
    await page.click('#quick-ironing');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.ironing_type === 'top');
    await page.click('#quick-ironing');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.ironing_type === 'no ironing');
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'quicktoggles');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All quick toggle tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Quick toggle tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
