#!/usr/bin/env node
/** Invalid imported presets preserve native settings, selection and saved baselines. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5225);
async function run(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  const state = () => page.evaluate(async () => {
    const s = window.__appStore.getState();
    return {
      native: await window.__orcaEngine.getConfig(), current: s.currentConfig,
      baseline: s.presetConfig, printer: s.selectedPrinter, process: s.selectedProcess,
      filaments: s.selectedFilaments, active: s.activeUserPreset, error: s.engineError
    };
  });
  const select = (kind, preset) => page.evaluate(async ({ kind, preset }) => {
    await window.__appStore.getState().selectUserPreset(kind, preset);
  }, { kind, preset });
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    const imported = await page.evaluate(async () => {
      const s = window.__appStore.getState();
      window.__prefsStore.getState().setGeneralPref('autosave', false);
      await s.chooseVendor('Voron');
      await s.choosePrinter('Voron 2.4 300 0.4 nozzle');
      await s.chooseProcess('0.20mm Standard @Voron');
      return s.importPresetBundleAction({
        format: 'orcaslicer-web-preset-bundle', version: 1,
        presets: [
          { kind: 'process', name: 'Malformed Process', inherits: '0.20mm Standard @Voron', values: { initial_layer_print_height: 'bad_float', layer_height: '0.28' } },
          { kind: 'printer', name: 'Malformed Printer', inherits: 'Voron 2.4 300 0.4 nozzle', values: { printable_height: 'bad_float' } },
          { kind: 'filament', name: 'Malformed Filament', inherits: 'Generic PLA @System', values: { nozzle_temperature: 'bad_int' } },
          { kind: 'process', name: 'Future Process', inherits: '0.20mm Standard @Voron', values: { layer_height: '0.28', unknown_future_setting: 'true' } },
          { kind: 'process', name: 'Valid Process', inherits: '0.20mm Standard @Voron', values: { layer_height: '0.24' } }
        ]
      });
    });
    assert.equal(imported.success, true);
    for (const [kind, preset, key] of [
      ['process', 'Malformed Process', 'initial_layer_print_height'],
      ['printer', 'Malformed Printer', 'printable_height'],
      ['filament', 'Malformed Filament', 'nozzle_temperature']
    ]) {
      const before = await state();
      await select(kind, preset);
      const after = await state();
      assert.ok(after.error, preset);
      assert.deepEqual(after.native, before.native, preset);
      assert.deepEqual(after.current, before.current, preset);
      assert.deepEqual(after.baseline, before.baseline, preset);
      assert.deepEqual(after.filaments, before.filaments, preset);
      assert.deepEqual(after.active, before.active, preset);
      assert.equal(after.printer, before.printer, preset);
      assert.equal(after.process, before.process, preset);
      assert.ok((await page.textContent('#error-message')).includes(key), preset);
    }
    await select('process', 'Future Process');
    let result = await state();
    assert.equal(result.error, null);
    assert.equal(result.native.layer_height, '0.28');
    assert.equal(result.baseline.layer_height, '0.28');
    assert.equal(result.baseline.unknown_future_setting, undefined);
    await select('process', 'Valid Process');
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('layer_height', '0.32', 'print'));
    result = await state();
    assert.equal(result.native.layer_height, '0.32');
    assert.equal(result.baseline.layer_height, '0.24');
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('layer_height', '0.28junk', 'print'));
    result = await state();
    assert.ok(result.error);
    assert.equal(result.native.layer_height, '0.32');
    assert.equal(result.current.layer_height, '0.32');
    await page.evaluate(() => window.__appStore.getState().resetOption('layer_height', 'print'));
    result = await state();
    assert.equal(result.native.layer_height, '0.24');
    assert.equal(result.current.layer_height, '0.24');
    assert.equal(result.baseline.layer_height, '0.24');
    console.log(`${name}: malformed presets, forward compatibility, edit and reset pass.`);
  } finally { await browser.close(); }
}
await startServer(port, 'preset-error-rollback');
try {
  await run(chromium, 'chromium');
  await run(firefox, 'firefox');
} finally { await stopServer(port); }
