#!/usr/bin/env node
/** Browser test of the flushing volumes dialog: it needs two filaments, edits the matrix and multiplier, and can auto-calculate. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const PORT = parseInt(process.env.PORT || '5119', 10);
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

    log('the button needs more than one filament');
    assert.equal(await page.locator('#flush-open').count(), 0);
    await page.waitForTimeout(2000);
    await page.click('#add-filament-btn');
    await page.waitForFunction(() => window.__appStore.getState().selectedFilaments.length === 2, null, { timeout: 15000 });
    await page.waitForSelector('#flush-open');

    // Editing slot 2 must not make this project-wide matrix target slot 2.
    await page.click('#edit-filament-btn-2');
    await page.keyboard.press('Escape');
    log('edited volumes and the multiplier reach the config');
    await page.click('#flush-open');
    await page.waitForSelector('#flush-dialog');
    assert.equal(await page.locator('#flush-0-0').isDisabled(), true);
    await page.fill('#flush-0-1', '500');
    await page.fill('#flush-1-0', '350');
    await page.fill('#flush-multiplier', '0.5');
    await page.click('#flush-apply');
    await page.waitForSelector('#flush-dialog', { state: 'detached' });
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.flush_volumes_matrix?.startsWith('0,500,350,0'), null, { timeout: 10000 });
    assert.equal(parseFloat(await cfg('flush_multiplier')), 0.5);
    const native = await page.evaluate(() => window.__orcaEngine.getConfig());
    assert.equal(native.flush_volumes_matrix, '0,500,350,0');
    assert.equal(parseFloat(native.flush_multiplier), 0.5);
    assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);

    log('saving a filament excludes project-wide flushing settings');
    await page.evaluate(async () => {
      await window.__appStore.getState().applyOptionChange('nozzle_temperature', '237', 'filament', undefined, 1);
    });
    await page.click('#save-filament-btn-2');
    await page.fill('#preset-name-input', 'Flush test filament');
    await page.evaluate(() => {
      const engine = window.__orcaEngine;
      const original = engine.call.bind(engine);
      engine.call = async (op, args, ...rest) => {
        if (op === 'getConfig' && args?.filamentIndex === 1) {
          engine.call = original;
          window.__saveBlocked = true;
          await new Promise(resolve => { window.__releaseSave = resolve; });
        }
        return original(op, args, ...rest);
      };
    });
    await page.click('[data-testid="save-preset-confirm-btn"]');
    await page.waitForFunction(() => window.__saveBlocked);
    assert.equal(await page.evaluate(() => window.__appStore.getState().isSelectingPreset), true, 'saving pauses actions and autosave during native application');
    assert.equal(await page.evaluate(() => window.__autosave.writeAutosave()), false);
    await page.evaluate(() => window.__releaseSave());
    await page.waitForSelector('[data-testid="save-preset-dialog"]', { state: 'detached', timeout: 10000 });
    const saved = await page.evaluate(() => window.__appStore.getState().userPresets.find((p) => p.name === 'Flush test filament'));
    assert.equal(saved.values.nozzle_temperature, '237');
    assert.equal(saved.values.flush_volumes_matrix, undefined);
    assert.equal(saved.values.flush_multiplier, undefined);
    const afterSave = await page.evaluate(() => window.__orcaEngine.getConfig());
    assert.equal(afterSave.flush_volumes_matrix, '0,500,350,0');
    assert.equal(parseFloat(afterSave.flush_multiplier), 0.5);
    assert.equal(afterSave.nozzle_temperature.split(',')[1], '237');
    assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);

    log('the dialog shows what was applied, and auto-calculate replaces the values');
    await page.click('#flush-open');
    assert.equal(await page.inputValue('#flush-0-1'), '500');
    await page.click('#flush-auto');
    assert.notEqual(await page.inputValue('#flush-0-1'), '500');
    await page.click('#flush-cancel');
    await page.waitForSelector('#flush-dialog', { state: 'detached' });
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'flush');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All flush volume tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Flush volume tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
