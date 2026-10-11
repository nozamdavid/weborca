#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5163);

async function run(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(async () => {
      await window.__appStore.getState().chooseVendor('Voron');
      await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
    });
    const base = await page.evaluate(() => window.__appStore.getState().selectedFilaments[0]);
    const imported = await page.evaluate(async (inherits) => window.__appStore.getState().importPresetBundleAction({
      format: 'orcaslicer-web-preset-bundle', version: 1, exportedAt: new Date().toISOString(),
      presets: [
        { kind: 'filament', name: 'Slot PLA 210', inherits, values: { nozzle_temperature: '210', filament_flow_ratio: '0.95', filament_type: 'PLA' } },
        { kind: 'filament', name: 'Slot PETG 240', inherits, values: { nozzle_temperature: '240', filament_flow_ratio: '1.05', filament_type: 'PETG' } }
      ]
    }), base);
    assert.equal(imported.success, true);
    await page.selectOption('#filament-select', 'user:Slot PLA 210');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.nozzle_temperature === '210');
    console.log(`[${name}] first user filament selected`);
    await page.click('#add-filament-btn');
    await page.waitForFunction(() => window.__appStore.getState().selectedFilaments.length === 2);
    await page.selectOption('#filament-select-2', 'user:Slot PETG 240');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.nozzle_temperature === '210,240');
    const config = () => page.evaluate(() => window.__appStore.getState().currentConfig);
    assert.equal((await config()).filament_flow_ratio, '0.95,1.05');
    assert.equal((await config()).filament_type, 'PLA;PETG');
    const saved = await page.evaluate(async () => {
      await window.__appStore.getState().saveCurrentUserPreset('filament', 'Saved first slot');
      return window.__appStore.getState().userPresets.find(p => p.name === 'Saved first slot');
    });
    assert.equal(saved.values.nozzle_temperature, '210');
    assert.equal(saved.values.filament_flow_ratio, '0.95');
    assert.equal(saved.values.filament_type, 'PLA');
    await page.evaluate(async () => {
      const state = window.__appStore.getState();
      await state.chooseProcess(state.selectedProcess);
    });
    assert.equal((await config()).nozzle_temperature, '210,240', 'changing process preserves both user filaments');
    await page.evaluate(async (preset) => window.__appStore.getState().chooseFilament(preset, 1), base);
    assert.equal((await config()).nozzle_temperature.split(',')[0], '210', 'a system preset in slot 2 preserves slot 1');
    await page.selectOption('#filament-select-2', 'user:Slot PETG 240');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.nozzle_temperature === '210,240');
    assert.equal((await config()).nozzle_temperature, '210,240');
    const model = fs.readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url));
    await page.evaluate(async (bytes) => {
      await window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], 'cube.obj'));
      window.__appStore.setState({ activeFilamentSlot: 1 });
      await window.__appStore.getState().applyOptionChange('nozzle_temperature', '245', 'filament');
      if (window.__appStore.getState().engineError) throw new Error(window.__appStore.getState().engineError);
      await window.__autosave.writeAutosave();
    }, [...model]);
    await page.reload();
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.waitForSelector('#recovery-dialog');
    await page.click('#recovery-restore');
    await page.waitForSelector('#recovery-dialog', { state: 'detached', timeout: 60000 });
    assert.equal((await config()).nozzle_temperature, '210,245');
    await page.evaluate(async () => {
      const state = window.__appStore.getState();
      await state.chooseProcess(state.selectedProcess);
    });
    assert.equal((await config()).nozzle_temperature, '210,245', 'process selection retains recovered manual overrides');
    assert.deepEqual(await page.evaluate(() => window.__appStore.getState().selectedFilaments), ['Saved first slot', 'Slot PETG 240']);
    console.log(`[${name}] independent user filament presets passed`);
  } finally {
    await browser.close();
  }
}

await startServer(port, 'filament-presets');
try {
  await run(chromium, 'chromium');
  await run(firefox, 'firefox');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stopServer(port);
}
