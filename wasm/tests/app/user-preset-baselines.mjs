#!/usr/bin/env node
/** Saved preset reset targets must survive slot changes, empty recovery and Undo. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5220);
const processName = 'Voron 0.30 Quality';
const printerName = 'Voron 2.4 350 Custom';
const filamentName = 'Saved PETG 237';

async function run(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  const verify = async (layer = '0.3', height = '350') => {
    const actual = await page.evaluate(async () => {
      const s = window.__appStore.getState();
      const native = await window.__orcaEngine.getConfig();
      return {
        error: s.engineError,
        current: [s.currentConfig.layer_height, s.currentConfig.printable_height],
        native: [native.layer_height, native.printable_height],
        baseline: [s.presetConfig.layer_height, s.presetConfig.printable_height],
        overrides: [s.processOverrides.layer_height, s.printerOverrides.printable_height]
      };
    });
    assert.equal(actual.error, null);
    assert.deepEqual(actual.current, [layer, height], 'web values');
    assert.deepEqual(actual.native, [layer, height], 'actual native values');
    assert.deepEqual(actual.baseline, ['0.3', '350'], 'saved reset targets');
    assert.deepEqual(actual.overrides, [layer, height], 'effective values retained for native reload');
  };
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(async () => {
      window.__prefsStore.getState().setGeneralPref('autosave', false);
      await window.__appStore.getState().chooseVendor('Voron');
      await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
    });
    const imported = await page.evaluate(async ({ processName, printerName, filamentName }) => {
      const s = window.__appStore.getState();
      return s.importPresetBundleAction({
        format: 'orcaslicer-web-preset-bundle', version: 1, exportedAt: new Date().toISOString(),
        presets: [
          { kind: 'process', name: processName, inherits: s.selectedProcess, values: { layer_height: '0.3' } },
          { kind: 'printer', name: printerName, inherits: s.selectedPrinter, values: { printable_height: '350' } },
          { kind: 'filament', name: filamentName, inherits: 'Generic PETG @System', values: { nozzle_temperature: '237' } }
        ]
      });
    }, { processName, printerName, filamentName });
    assert.equal(imported.success, true);
    await page.evaluate(async ({ processName, printerName }) => {
      await window.__appStore.getState().selectUserPreset('process', processName);
      await window.__appStore.getState().selectUserPreset('printer', printerName);
    }, { processName, printerName });
    await verify();
    await page.evaluate(async () => {
      await window.__appStore.getState().applyOptionChange('layer_height', '0.35', 'print');
      await window.__appStore.getState().applyOptionChange('printable_height', '360', 'printer');
    });
    await verify('0.35', '360');
    await page.evaluate(async () => {
      await window.__appStore.getState().resetOption('layer_height', 'print');
      await window.__appStore.getState().resetOption('printable_height', 'printer');
    });
    await verify();
    await page.evaluate(async () => {
      await window.__appStore.getState().chooseFilament('Generic PETG @System', 0);
      await window.__appStore.getState().addFilamentSlot();
      await window.__appStore.getState().removeFilamentSlot(1);
    });
    await verify();
    await page.evaluate(async ({ processName, printerName }) => {
      await window.__appStore.getState().saveCurrentUserPreset('process', processName);
      await window.__appStore.getState().saveCurrentUserPreset('printer', printerName);
    }, { processName, printerName });
    const saved = await page.evaluate(({ processName, printerName }) => {
      const presets = window.__appStore.getState().userPresets;
      return [presets.find(p => p.name === processName)?.values.layer_height,
        presets.find(p => p.name === printerName)?.values.printable_height];
    }, { processName, printerName });
    assert.deepEqual(saved, ['0.3', '350'], 'resaving after Reset retains saved values');
    await verify();
    await page.evaluate(async filamentName => {
      await window.__appStore.getState().addFilamentSlot();
      await window.__appStore.getState().selectUserPreset('filament', filamentName, 1);
    }, filamentName);
    assert.equal(await page.evaluate(async () => (await window.__orcaEngine.getConfig()).nozzle_temperature.split(',')[1]), '237');
    assert.equal(await page.evaluate(() => window.__autosave.writeAutosave()), true);
    await page.reload();
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.waitForSelector('#recovery-dialog');
    await page.click('#recovery-restore');
    await page.waitForFunction(() => !document.querySelector('#recovery-dialog') || document.querySelector('#recovery-dialog [role="alert"]'), null, { timeout: 60000 });
    assert.equal(await page.locator('#recovery-dialog').count(), 0, 'recovery completes');
    await verify();
    assert.deepEqual(await page.evaluate(() => [window.__appStore.getState().selectedProcess, window.__appStore.getState().selectedPrinter]), [processName, printerName]);
    assert.equal(await page.evaluate(async () => (await window.__orcaEngine.getConfig()).nozzle_temperature.split(',')[1]), '237', 'empty recovery retains the second user filament');
    await page.evaluate(async () => {
      await window.__historyStore.getState().initHistory();
      await window.__appStore.getState().chooseProcess('0.20mm Standard @Voron');
      await window.__historyStore.getState().commitTransaction('System process');
      await window.__historyStore.getState().undo();
    });
    await verify();
    assert.equal(await page.evaluate(async () => (await window.__orcaEngine.getConfig()).nozzle_temperature.split(',')[1]), '237', 'empty Undo reapplies user filament values after resetting native overrides');
    await page.evaluate(() => window.__historyStore.getState().redo());
    assert.equal(await page.evaluate(async () => (await window.__orcaEngine.getConfig()).layer_height), '0.2', 'Redo restores the system process');
    await page.evaluate(() => window.__historyStore.getState().undo());
    await verify();
    console.log(`[${name}] saved reset targets, slot changes, resaving, empty recovery and Undo/Redo passed`);
  } catch (error) {
    console.error(await page.evaluate(() => ({ error: window.__appStore?.getState().engineError,
      recoveryError: document.querySelector('#recovery-dialog [role="alert"]')?.textContent })));
    throw error;
  } finally {
    await browser.close();
  }
}

await startServer(port, 'user-preset-baselines');
try {
  await run(chromium, 'chromium');
  await run(firefox, 'firefox');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stopServer(port);
}
