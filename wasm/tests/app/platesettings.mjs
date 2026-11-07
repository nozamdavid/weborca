#!/usr/bin/env node
/** Browser test of the per-plate settings popover: bed type, print sequence and spiral vase reach the engine's plate config. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const PORT = parseInt(process.env.PORT || '5115', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const config = (i) => page.evaluate((index) => window.__platesStore.getState().plates[index]?.config ?? {}, i);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await selectAddedPrinter(page, 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.waitForFunction(() => !window.__appStore.getState().isLoadingPresets, null, { timeout: 60000 }).catch(() => {});
    await page.waitForSelector('#plate-settings-btn');

    log('the popover sets the bed type, print sequence and spiral vase of the plate');
    await page.click('#plate-settings-btn');
    await page.selectOption('#plate-bed-type', 'Textured PEI Plate');
    await page.waitForFunction(() => window.__platesStore.getState().plates[0]?.config.curr_bed_type === 'Textured PEI Plate', null, { timeout: 10000 });
    await page.selectOption('#plate-print-sequence', 'by object');
    await page.click('#plate-spiral-mode');
    await page.waitForFunction(() => window.__platesStore.getState().plates[0]?.config.spiral_mode === '1');
    const cfg = await config(0);
    assert.equal(cfg.print_sequence, 'by object');

    log('a second plate has its own settings');
    await page.click('#add-plate-btn');
    await page.waitForSelector('#plate-tab-1');
    await page.click('#plate-tab-1');
    await page.waitForFunction(() => window.__platesStore.getState().activePlateIndex === 1);
    assert.equal(await page.locator('#plate-spiral-mode').isChecked(), false);
    assert.equal((await config(1)).curr_bed_type, undefined);
    await page.selectOption('#plate-bed-type', 'Engineering Plate');
    await page.waitForFunction(() => window.__platesStore.getState().plates[1]?.config.curr_bed_type === 'Engineering Plate');
    assert.equal((await config(0)).curr_bed_type, 'Textured PEI Plate');
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'platesettings');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All plate settings tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Plate settings tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
