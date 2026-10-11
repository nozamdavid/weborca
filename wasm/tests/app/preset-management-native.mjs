#!/usr/bin/env node
/** Preset management must keep selected names, saved values and native settings consistent. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5233);
async function run(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  const native = () => page.evaluate(() => window.__orcaEngine.getConfig());
  const duplicate = async (kind, source, copy) => {
    await page.evaluate(({ kind, source }) => window.__appStore.getState().openManagePresetsDialog(kind, 'duplicate', source), { kind, source });
    await page.fill('[data-testid="duplicate-preset-input"]', copy);
    await page.click('[data-testid="duplicate-preset-confirm-btn"]');
    await page.waitForFunction((copy) => document.querySelector('[data-testid="preset-success-msg"]')?.textContent.includes(copy), copy);
    await page.keyboard.press('Escape');
  };
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(async () => {
      const s = window.__appStore.getState();
      window.__prefsStore.getState().setGeneralPref('autosave', false);
      await s.chooseVendor('Voron');
      await s.choosePrinter('Voron 2.4 300 0.4 nozzle');
      await s.chooseProcess('0.20mm Standard @Voron');
      await s.importPresetBundleAction({
        format: 'orcaslicer-web-preset-bundle', version: 1,
        presets: [{ kind: 'process', name: 'Inactive 0.30', inherits: '0.20mm Standard @Voron', values: { layer_height: '0.3' } }]
      });
    });
    assert.equal((await native()).layer_height, '0.2');
    await duplicate('process', 'Inactive 0.30', 'Copied 0.30');
    assert.equal(await page.evaluate(() => window.__appStore.getState().selectedProcess), 'Copied 0.30');
    assert.equal((await native()).layer_height, '0.3', 'duplicating an inactive preset applies the copy natively');
    assert.equal(await page.evaluate(() => window.__appStore.getState().presetConfig.layer_height), '0.3');

    await page.evaluate(async () => {
      const s = window.__appStore.getState();
      await s.chooseFilament('Generic PLA @System', 0);
      await s.addFilamentSlot();
      await s.chooseFilament('Generic PETG @System', 1);
      await s.applyOptionChange('nozzle_temperature', '211', 'filament', undefined, 0);
      await s.applyOptionChange('nozzle_temperature', '237', 'filament', undefined, 1);
      await s.applyOptionChange('flush_volumes_matrix', '0,500,350,0', 'filament', undefined, null);
      window.__appStore.setState({ activeFilamentSlot: 1 });
    });
    await duplicate('filament', 'Generic PETG @System', 'Copied PETG 237');
    const state = await page.evaluate(() => {
      const s = window.__appStore.getState();
      return { selected: s.selectedFilaments, saved: s.userPresets.find(p => p.name === 'Copied PETG 237')?.values, error: s.engineError };
    });
    assert.deepEqual(state.selected, ['Generic PLA @System', 'Copied PETG 237']);
    assert.equal(state.saved.nozzle_temperature, '237', 'the copied preset contains only its own slot');
    assert.equal(state.saved.flush_volumes_matrix, undefined);
    assert.equal(state.error, null);
    assert.equal((await native()).nozzle_temperature, '211,237');
    assert.equal((await native()).flush_volumes_matrix, '0,500,350,0');

    await page.evaluate(async () => {
      const s = window.__appStore.getState();
      await s.chooseProcess('0.20mm Standard @Voron');
      await s.applyOptionChange('layer_height', '0.25', 'print');
      await s.deleteUserPresetAction('process', 'Inactive 0.30');
    });
    assert.equal((await native()).layer_height, '0.25', 'deleting an inactive preset preserves current manual settings');
    await page.evaluate(() => window.__appStore.getState().deleteUserPresetAction('filament', 'Copied PETG 237'));
    assert.deepEqual(await page.evaluate(() => window.__appStore.getState().selectedFilaments), ['Generic PLA @System', 'Generic PETG @System'], 'deleting slot 2 preset replaces only slot 2');
    assert.equal((await native()).nozzle_temperature.split(',')[0], '211');
    console.log(`[${name}] preset management native checks passed`);
  } finally { await browser.close(); }
}
await startServer(port, 'preset-management-native');
try {
  await run(chromium, 'chromium');
  await run(firefox, 'firefox');
} finally { await stopServer(port); }
