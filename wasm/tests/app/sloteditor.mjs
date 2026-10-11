#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5214);

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

    // Add a second filament slot
    await page.click('#add-filament-btn');
    await page.waitForFunction(() => window.__appStore.getState().selectedFilaments.length === 2);

    // Choose filament preset for slot 2 (index 1)
    await page.selectOption('#filament-select-2', { index: 1 });

    // Open filament dialog for slot 2
    await page.click('#edit-filament-btn-2');
    await page.waitForSelector('[data-testid="filament-dialog"]');
    await page.waitForTimeout(300);

    const titleText = await page.locator('.modal-title').textContent();
    assert.match(titleText, /Filament Settings -/, 'Dialog title should contain slot 2 filament name');

    // Edit nozzle temperature for slot 2
    await page.waitForSelector('#setting-input-nozzle_temperature');
    const initialTemperature = await page.inputValue('#setting-input-nozzle_temperature');
    assert.ok(initialTemperature !== '' && Number.isFinite(Number(initialTemperature)), 'Temperature must be prefilled with a scalar preset value');
    await page.fill('#setting-input-nozzle_temperature', '245');
    await page.waitForTimeout(200);

    // Edit string setting containing newline and semicolon (filament_start_gcode)
    await page.click('[data-testid="dialog-tab-Advanced"]');
    await page.waitForSelector('#setting-input-filament_start_gcode');
    const customGcode = 'M900 K0.05\n; some, comment';
    await page.fill('#setting-input-filament_start_gcode', customGcode);
    await page.waitForTimeout(200);
    await page.locator('#setting-input-filament_start_gcode').blur();
    await page.waitForTimeout(200);
    assert.equal(await page.inputValue('#setting-input-filament_start_gcode'), customGcode, 'Commas and newlines in G-code must survive native projection');

    // Save as user preset
    await page.click('[data-testid="save-dialog-preset-btn"]');
    await page.waitForSelector('#preset-name-input');
    await page.fill('#preset-name-input', 'My Slot 2 PETG');
    await page.click('[data-testid="save-preset-confirm-btn"]');
    await page.waitForSelector('#preset-name-input', { state: 'detached' });

    // Wait for the preset to be active in slot 2
    await page.waitForFunction(
      () => window.__appStore.getState().selectedFilaments[1]?.includes('My Slot 2 PETG'),
      null,
      { timeout: 10000 }
    );

    // Verify sibling slot 1 is unchanged while slot 2 has 245 and properly escaped custom gcode
    const fullConfig = await page.evaluate(() => window.__appStore.getState().currentConfig);
    const temperatures = fullConfig.nozzle_temperature.split(',').map(s => s.trim());
    assert.equal(temperatures[1], '245', 'Slot 2 temperature should be 245');
    assert.notEqual(temperatures[0], '245', 'Slot 1 temperature should remain unchanged');
    assert.equal(await page.evaluate(() => window.__appStore.getState().activeUserPreset.filament), null, 'saving slot 1 does not mark slot 0 as a user preset');
    await page.evaluate(async () => {
      const state = window.__appStore.getState();
      await state.chooseFilament(state.selectedFilaments[0], 0);
      await window.__appStore.getState().addFilamentSlot();
      await window.__appStore.getState().removeFilamentSlot(2);
      window.__appStore.setState({ activeFilamentSlot: 1 });
      await window.__appStore.getState().applyOptionChange('nozzle_temperature', '255', 'filament');
      await window.__appStore.getState().resetOption('nozzle_temperature', 'filament');
    });
    assert.equal(await page.evaluate(() => window.__appStore.getState().currentConfig.nozzle_temperature.split(',')[1]), '245', 'sibling changes and slot additions/removals retain the user reset baseline');
    assert.match(
      fullConfig.filament_start_gcode,
      /M900 K0\.05\\n; some, comment/,
      'Gcode with newline/semicolon should be properly escaped in the full serialized string'
    );

    // Verify process reselection retains filament overrides and sibling settings
    await page.evaluate(async () => {
      const processes = window.__appStore.getState().processes;
      const currentProcess = window.__appStore.getState().selectedProcess;
      const newProcess = processes.find(p => p.name !== currentProcess)?.name;
      if (newProcess) {
        await window.__appStore.getState().chooseProcess(newProcess);
      }
    });
    await page.waitForTimeout(300);

    const fullConfigAfter = await page.evaluate(() => window.__appStore.getState().currentConfig);
    const temperaturesAfter = fullConfigAfter.nozzle_temperature.split(',').map(s => s.trim());
    assert.equal(temperaturesAfter[1], '245', 'Slot 2 temperature should still be 245 after process change');
    assert.notEqual(temperaturesAfter[0], '245', 'Slot 1 temperature should remain unchanged');

    // Manual edit on slot 0 and targeted reset on slot 1
    await page.evaluate(async () => {
      window.__appStore.setState({ activeFilamentSlot: 0, activeDialog: 'filament' });
      await window.__appStore.getState().applyOptionChange('nozzle_temperature', '215', 'filament');
    });

    let cfg = await page.evaluate(() => window.__appStore.getState().currentConfig);
    let temps = cfg.nozzle_temperature.split(',').map(s => s.trim());
    assert.equal(temps[0], '215', 'Slot 0 temperature should be 215');
    assert.equal(temps[1], '245', 'Slot 1 temperature should be 245');

    // Manual edit on slot 1 to 255
    await page.evaluate(async () => {
      window.__appStore.setState({ activeFilamentSlot: 1, activeDialog: 'filament' });
      await window.__appStore.getState().applyOptionChange('nozzle_temperature', '255', 'filament');
    });

    cfg = await page.evaluate(() => window.__appStore.getState().currentConfig);
    temps = cfg.nozzle_temperature.split(',').map(s => s.trim());
    assert.equal(temps[0], '215', 'Slot 0 temperature should be 215');
    assert.equal(temps[1], '255', 'Slot 1 temperature should be 255');

    // Reset slot 1: resets slot 1 to its user preset baseline while slot 0 manual 215 remains untouched
    await page.evaluate(async () => {
      window.__appStore.setState({ activeFilamentSlot: 1, activeDialog: 'filament' });
      await window.__appStore.getState().resetOption('nozzle_temperature', 'filament');
    });

    cfg = await page.evaluate(() => window.__appStore.getState().currentConfig);
    temps = cfg.nozzle_temperature.split(',').map(s => s.trim());
    assert.equal(temps[0], '215', 'Slot 0 manual 215 must remain untouched when resetting slot 1');
    const baseCfg = await page.evaluate(() => window.__appStore.getState().presetConfig);
    const baseTemps = baseCfg.nozzle_temperature.split(',').map(s => s.trim());
    assert.equal(baseTemps[1], '245', 'process switching retains the saved user filament baseline');
    assert.equal(temps[1], baseTemps[1], 'Slot 1 should be reset to its baseline value (' + baseTemps[1] + ')');

    // Other-slot preset switching preserves manual edits
    const filamentsList = await page.evaluate(() => window.__appStore.getState().filaments.map(f => f.name));
    const plaFilament = filamentsList.find(f => f.includes('Generic PLA'));
    assert.ok(plaFilament, 'compatible Generic PLA preset exists');
    const altFilament = filamentsList.find(f => f !== 'Generic PLA' && f.includes('PETG')) || 'Generic PETG';
    await page.evaluate(async (fil) => {
      await window.__appStore.getState().chooseFilament(fil, 1);
    }, altFilament);

    cfg = await page.evaluate(() => window.__appStore.getState().currentConfig);
    temps = cfg.nozzle_temperature.split(',').map(s => s.trim());
    assert.equal(temps[0], '215', 'Slot 0 manual edit (215) must be preserved when choosing filament for slot 1');
    const petgBaseCfg = await page.evaluate(() => window.__appStore.getState().presetConfig);
    const petgBaseTemps = petgBaseCfg.nozzle_temperature.split(',').map(s => s.trim());
    assert.equal(temps[1], petgBaseTemps[1], 'Slot 1 should take new preset baseline');

    // Edit slot 1 to 235
    await page.evaluate(async () => {
      window.__appStore.setState({ activeFilamentSlot: 1, activeDialog: 'filament' });
      await window.__appStore.getState().applyOptionChange('nozzle_temperature', '235', 'filament');
    });

    // Switch slot 0 to Generic ABS or another preset
    const absFilament = filamentsList.find(f => f.includes('ABS')) || 'Generic ABS';
    await page.evaluate(async (fil) => {
      await window.__appStore.getState().chooseFilament(fil, 0);
    }, absFilament);

    cfg = await page.evaluate(() => window.__appStore.getState().currentConfig);
    temps = cfg.nozzle_temperature.split(',').map(s => s.trim());
    assert.equal(temps[1], '235', 'Slot 1 manual edit (235) must be preserved when choosing filament for slot 0');

    // Switch slot 0 back to Generic PLA: slot 1 manual edit 235 must still be preserved
    await page.evaluate(async (fil) => {
      await window.__appStore.getState().chooseFilament(fil, 0);
    }, plaFilament);
    assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);
    cfg = await page.evaluate(() => window.__appStore.getState().currentConfig);
    temps = cfg.nozzle_temperature.split(',').map(s => s.trim());
    assert.equal(temps[1], '235', 'Slot 1 manual edit (235) must be preserved when slot 0 switches to Generic PLA');

    // Reset slot 1 to baseline preserving slot 0
    await page.evaluate(async () => {
      window.__appStore.setState({ activeFilamentSlot: 1, activeDialog: 'filament' });
      await window.__appStore.getState().resetOption('nozzle_temperature', 'filament');
    });
    cfg = await page.evaluate(() => window.__appStore.getState().currentConfig);
    temps = cfg.nozzle_temperature.split(',').map(s => s.trim());
    const resetBaseCfg = await page.evaluate(() => window.__appStore.getState().presetConfig);
    const resetBaseTemps = resetBaseCfg.nozzle_temperature.split(',').map(s => s.trim());
    assert.equal(temps[1], resetBaseTemps[1], 'Slot 1 should reset to baseline');

    // An external preset change must not suppress repeating an earlier edit.
    await page.click('[data-testid="dialog-tab-Filament"]');
    await page.locator('#setting-input-nozzle_temperature').fill('245');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.nozzle_temperature.split(',')[1] === '245');
    await page.evaluate(async (fil) => window.__appStore.getState().chooseFilament(fil, 1), plaFilament);
    assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.nozzle_temperature.split(',')[1] !== '245');
    await page.locator('#setting-input-nozzle_temperature').fill('245');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.nozzle_temperature.split(',')[1] === '245');

    // Real keystrokes retain intermediate input while native updates are in flight.
    await page.locator('#setting-input-nozzle_temperature').fill('');
    await page.locator('#setting-input-nozzle_temperature').pressSequentially('237', { delay: 15 });
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.nozzle_temperature.split(',')[1] === '237');
    await page.waitForFunction(() => document.querySelector('#setting-input-nozzle_temperature')?.value === '237');
    assert.equal(await page.locator('#setting-input-nozzle_temperature').inputValue(), '237');

    await page.evaluate(async () => {
      window.__appStore.setState({ activeFilamentSlot: 0 });
      await window.__appStore.getState().applyOptionChange('filament_max_volumetric_speed', '17', 'filament');
      window.__appStore.setState({ activeFilamentSlot: 1 });
      await window.__appStore.getState().saveCurrentUserPreset('filament', 'Independent slot 1');
    });
    const saved = await page.evaluate(() => window.__appStore.getState().userPresets.find(p => p.name === 'Independent slot 1'));
    assert.equal(saved.values.filament_max_volumetric_speed, undefined, 'saving a slot does not freeze a sibling-only override');
    assert.equal(saved.values.nozzle_temperature, '237');
    // Saving an existing preset on a secondary slot is allowed without changing slot 0's label.
    await page.evaluate(async () => window.__appStore.getState().saveCurrentUserPreset('filament', 'Independent slot 1'));
    assert.equal(await page.evaluate(() => window.__appStore.getState().activeUserPreset.filament), null);

    console.log(`[${name}] Slot editor tests passed`);
  } catch (error) {
    console.error(`[${name}] slot editor state`, await page.evaluate(() => {
      const input = document.querySelector('#setting-input-nozzle_temperature');
      const state = window.__appStore?.getState();
      return { value: input?.value, type: input?.type, disabled: input?.disabled, focused: document.activeElement === input,
        slot: state?.activeFilamentSlot, temperatures: state?.currentConfig.nozzle_temperature, error: state?.engineError };
    }).catch(() => null));
    throw error;
  } finally {
    await browser.close();
  }
}

await startServer(port, 'sloteditor');
try {
  await run(chromium, 'chromium');
  await run(firefox, 'firefox');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stopServer(port);
}
