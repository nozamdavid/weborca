#!/usr/bin/env node
/** Browser test of the preset compare dialog: two process presets list their differing settings. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const PORT = parseInt(process.env.PORT || '5130', 10);
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
    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.waitForTimeout(2000);

    log('File > Compare presets opens with the active process preset on the left');
    await page.locator('.menu-label', { hasText: 'File' }).first().click();
    await page.locator('.menu.open .menu-item', { hasText: 'Compare presets' }).first().click();
    await page.waitForSelector('#compare-dialog');
    await page.waitForFunction(() => document.querySelector('#compare-left')?.value === '0.20mm Standard @Voron');

    log('choosing a second preset lists the settings that differ, layer height among them');
    await page.selectOption('#compare-right', '0.12mm Fine @Voron');
    await page.waitForSelector('.compare-row');
    const rows = await page.locator('.compare-row').allTextContents();
    assert.ok(rows.some((r) => /layer height/i.test(r) && r.includes('0.2') && r.includes('0.12')), rows.join(' | '));

    log('the same preset on both sides shows no differences, and the active selection is unchanged');
    await page.selectOption('#compare-right', '0.20mm Standard @Voron');
    await page.waitForSelector('#compare-same');
    assert.equal(await page.evaluate(() => window.__appStore.getState().selectedProcess), '0.20mm Standard @Voron');
    await page.click('#compare-close');
    await page.waitForSelector('#compare-dialog', { state: 'detached' });
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'compare');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All compare tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Compare tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
