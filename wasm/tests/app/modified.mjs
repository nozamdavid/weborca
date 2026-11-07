#!/usr/bin/env node
/** Browser test of the modified settings list: a changed option appears, can be reset, and the button goes away. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const PORT = parseInt(process.env.PORT || '5121', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await selectAddedPrinter(page, 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.enable_support !== undefined, null, { timeout: 60000 });
    await page.waitForTimeout(1500);

    log('an untouched preset has nothing modified');
    assert.equal(await page.locator('#modified-open').count(), 0);

    log('a changed option is listed and can be reset');
    await page.click('#quick-support');
    await page.waitForSelector('#modified-open');
    assert.match(await page.locator('#modified-open').innerText(), /1 modified/);
    await page.click('#modified-open');
    await page.waitForSelector('#modified-dialog');
    assert.equal(await page.locator('.modified-row').count(), 1);
    await page.locator('.modified-row button').click();
    await page.waitForSelector('#modified-dialog', { state: 'detached' });
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.enable_support === '0');
    assert.equal(await page.locator('#modified-open').count(), 0);
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'modified');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All modified settings tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Modified settings tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
