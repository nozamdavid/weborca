#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { seedAddedPrinters } from './lib/printer.mjs';

const PORT = parseInt(process.env.PORT || '5225', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const VORON = 'Voron 2.4 300 0.4 nozzle';
const BBL_DEFAULT = 'Bambu Lab X1 Carbon 0.4 nozzle';
const BBL_TARGET = 'Bambu Lab X1 Carbon 0.6 nozzle';
const dev = (id, name, presets, colors) => ({
  id, name, preset: VORON, vendor: 'Voron', host_type: 'moonraker', print_host: '127.0.0.1:1', use_gateway: false,
  filamentPresets: presets, filamentColors: colors
});

async function runSuite(browserType, bName) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  await ctx.addInitScript((seed) => {
    if (!localStorage.getItem('orca-printers')) localStorage.setItem('orca-printers', JSON.stringify(seed));
    localStorage.setItem('orcaslicer_preferences_v1', JSON.stringify({ general: { autosave: false } }));
  }, {
    version: 1,
    state: {
      printers: [
        dev('a', 'Dev A', ['Generic PLA @System', 'Generic PETG @System'], ['#112233', '#445566']),
        dev('b', 'Dev B'),
        dev('c', 'Dev C', ['Missing User Filament 0', 'Generic PETG @System'], ['#111111', '#222222'])
      ],
      selectedPrinterId: 'a'
    }
  });

  const page = await ctx.newPage();
  await seedAddedPrinters(ctx, [VORON, 'Voron 2.4 350 0.4 nozzle', BBL_TARGET]);
  const native = () => page.evaluate(() => window.__orcaEngine.getConfig());
  const waitReady = async () => {
    await page.goto(BASE);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  };

  try {
    await waitReady();
    // Real picker chain: chooseVendor selects the BBL default before the requested 0.6 profile.
    // Pause after that default, then change the selected device during the async pick.
    const raceDevices = [
      { ...dev('race-a', 'Race A', ['Bambu PLA Basic @BBL X1C'], ['#135790']), preset: BBL_DEFAULT, vendor: 'BBL' },
      { ...dev('race-b', 'Race B', ['Bambu PETG Basic @BBL X1C'], ['#246801']), preset: BBL_DEFAULT, vendor: 'BBL' }
    ];
    await page.evaluate(async (devices) => {
      for (const device of devices) window.__printerStore.getState().savePrinter(device);
      // A project/profile can differ from the saved physical-device binding.
      // Select the device while the engine is unavailable, then retain the Voron project.
      window.__appStore.setState({ isEngineReady: false });
      window.__printerStore.getState().selectPrinter('race-a');
      await new Promise((resolve) => setTimeout(resolve, 0));
      window.__appStore.setState({ isEngineReady: true });
    }, raceDevices);
    await page.evaluate(async () => {
      await window.__appStore.getState().chooseVendor('Voron');
      const original = window.__appStore.getState().choosePrinter;
      window.__appStore.setState({ choosePrinter: async (name) => {
        await original(name);
        if (name === 'Bambu Lab X1 Carbon 0.4 nozzle' && !window.__defaultPaused) {
          window.__defaultPaused = true;
          await new Promise((resolve) => { window.__releaseDefault = resolve; });
        }
      } });
      window.__originalChoosePrinter = original;
    });
    const snapshots = () => page.evaluate(() => window.__printerStore.getState().printers.filter((p) => p.id.startsWith('race-')));
    const beforeDefault = await snapshots();
    await page.selectOption('#printer-select', BBL_TARGET);
    await page.waitForFunction(() => window.__defaultPaused);
    const duringDefault = await snapshots();
    try {
      assert.deepEqual(duringDefault, beforeDefault, 'intermediate brand default must preserve both saved device snapshots');
    } catch (error) {
      await page.evaluate(() => window.__releaseDefault());
      throw error;
    }
    await page.evaluate(() => window.__printerStore.getState().selectPrinter('race-b'));
    await page.evaluate(() => window.__releaseDefault());
    await page.waitForFunction(() => !window.__appStore.getState().isSelectingPreset && window.__appStore.getState().isEngineReady && window.__appStore.getState().currentConfig.filament_colour.toLowerCase() === '#246801', null, { timeout: 60000 });
    assert.deepEqual(await snapshots(), beforeDefault, 'selection changes during the pick must preserve both devices and skip rebinding');
    assert.equal(await page.evaluate(() => window.__appStore.getState().selectedPrinter), BBL_DEFAULT);
    const raceConfig = await native();
    assert.equal(raceConfig.filament_colour.toLowerCase(), '#246801');
    assert.equal(raceConfig.nozzle_diameter, '0.4', 'native profile follows the final selected device');
    console.log(`[${bName}] intermediate default and async device switch preserved`, JSON.stringify(await snapshots()));
    await page.evaluate(() => {
      window.__appStore.setState({ choosePrinter: window.__originalChoosePrinter });
      window.__printerStore.getState().selectPrinter('a');
    });
    await page.waitForFunction(() => window.__appStore.getState().isEngineReady && window.__appStore.getState().currentConfig.filament_colour.toLowerCase() === '#112233;#445566');
    // 1. Seeded Device A: 2 filaments, verify dropdowns and native colors
    await page.waitForFunction(() => window.__appStore.getState().selectedFilaments.length === 2);
    let cfg = await native();
    assert.equal(await page.locator('#device-select').inputValue(), 'a');
    assert.equal(cfg.filament_colour.toLowerCase(), '#112233;#445566');

    // 2. Switch to Device B (same Voron preset, no saved spools): must reset to fresh default, no leak from A
    await page.selectOption('#device-select', 'b');
    await page.waitForFunction(() => window.__printerStore.getState().selectedPrinterId === 'b' && window.__appStore.getState().isEngineReady);
    await page.waitForFunction(() => window.__appStore.getState().selectedFilaments.length === 1);
    cfg = await native();
    assert.equal(await page.locator('#filament-select-2').count(), 0);
    assert.equal(cfg.filament_colour.split(';').length, 1);
    assert.ok(!cfg.filament_colour.toLowerCase().includes('#445566'));

    // 3. Switch to Device C (deleted slot 0, valid slot 1): color #222222 must stick to valid preset, not shift
    await page.selectOption('#device-select', 'c');
    await page.waitForFunction(() => window.__printerStore.getState().selectedPrinterId === 'c' && window.__appStore.getState().isEngineReady);
    await page.waitForFunction(() => window.__appStore.getState().selectedFilaments.some((f) => f.includes('PETG')));
    const petgIdx = await page.evaluate(() => window.__appStore.getState().selectedFilaments.findIndex((f) => f.includes('PETG')));
    assert.ok(petgIdx >= 0);
    const petgColorInput = await page.locator(`#filament-color-input-${petgIdx + 1}`).inputValue();
    assert.equal(petgColorInput.toLowerCase(), '#222222');
    cfg = await native();
    assert.equal(cfg.filament_colour.split(';')[petgIdx].toLowerCase(), '#222222');

    // 4. Multi-slot user/system dropdown mapping and reverse
    await page.evaluate(async () => {
      const s = window.__appStore.getState();
      await s.importPresetBundleAction({
        format: 'orcaslicer-web-preset-bundle', version: 1, exportedAt: new Date().toISOString(),
        presets: [
          { kind: 'filament', name: 'User PLA 210', inherits: 'Generic PLA @System', values: { nozzle_temperature: '210', filament_type: 'PLA' } },
          { kind: 'filament', name: 'User PETG 237', inherits: 'Generic PETG @System', values: { nozzle_temperature: '237', filament_type: 'PETG' } }
        ]
      });
      if (s.selectedFilaments.length < 2) await s.addFilamentSlot();
    });
    await page.waitForFunction(() => window.__appStore.getState().selectedFilaments.length === 2);

    // Slot 0 user, Slot 1 system
    await page.selectOption('#filament-select', 'user:User PLA 210');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.nozzle_temperature?.startsWith('210'));
    await page.waitForFunction(() => !document.querySelector('#filament-select-2').disabled);
    await page.selectOption('#filament-select-2', 'Generic PETG @System');
    await page.waitForFunction(() => !document.querySelector('#filament-select-2').disabled);
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.nozzle_temperature?.startsWith('210'));
    assert.equal(await page.locator('#filament-select').inputValue(), 'user:User PLA 210');
    assert.equal(await page.locator('#filament-select-2').inputValue(), 'Generic PETG @System');
    cfg = await native();
    assert.equal(cfg.nozzle_temperature.split(',')[0], '210');
    assert.equal(cfg.filament_type.split(';')[0], 'PLA');
    assert.equal(cfg.filament_type.split(';')[1], 'PETG');

    // Reverse: Slot 0 system, Slot 1 user
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.waitForFunction(() => window.__appStore.getState().activeUserPreset.filament === null);
    await page.waitForFunction(() => !document.querySelector('#filament-select').disabled);
    const systemTemp = (await native()).nozzle_temperature.split(',')[0];
    await page.waitForFunction(() => !document.querySelector('#filament-select-2').disabled);
    await page.selectOption('#filament-select-2', 'user:User PETG 237');
    await page.waitForFunction(() => !document.querySelector('#filament-select-2').disabled);
    await page.waitForFunction((temp) => window.__appStore.getState().currentConfig.nozzle_temperature === `${temp},237`, systemTemp);
    assert.equal(await page.locator('#filament-select').inputValue(), 'Generic PLA @System');
    assert.equal(await page.locator('#filament-select-2').inputValue(), 'user:User PETG 237');
    cfg = await native();
    assert.equal(cfg.nozzle_temperature, `${systemTemp},237`);
    assert.equal(cfg.filament_type.split(';')[0], 'PLA');
    assert.equal(cfg.filament_type.split(';')[1], 'PETG');

    // 5. Secondary row Save button click without first opening editor -> saves 237 vs 210
    await page.click('#save-filament-btn-2');
    await page.waitForSelector('[data-testid="save-preset-dialog"]');
    assert.equal(await page.locator('.preset-dialog-hint strong').textContent(), 'User PETG 237');
    await page.fill('#preset-name-input', 'Saved Sec 237');
    await page.click('[data-testid="save-preset-confirm-btn"]');
    await page.waitForSelector('[data-testid="save-preset-dialog"]', { state: 'detached' });

    assert.equal(await page.locator('#filament-select-2').inputValue(), 'user:Saved Sec 237');
    const savedTemp = await page.evaluate(() => window.__appStore.getState().userPresets.find((p) => p.name === 'Saved Sec 237')?.values.nozzle_temperature);
    assert.equal(savedTemp, '237');
    cfg = await native();
    assert.equal(cfg.nozzle_temperature, `${systemTemp},237`);

    // 6. Resaving existing secondary with same name allowed in UI without collision error
    await page.click('#save-filament-btn-2');
    await page.waitForSelector('[data-testid="save-preset-dialog"]');
    await page.fill('#preset-name-input', 'Saved Sec 237');
    await page.click('[data-testid="save-preset-confirm-btn"]');
    await page.waitForSelector('[data-testid="save-preset-dialog"]', { state: 'detached' });
    assert.equal(await page.locator('[data-testid="preset-error-msg"]').count(), 0);
    assert.equal(await page.locator('#filament-select-2').inputValue(), 'user:Saved Sec 237');

    await page.reload();
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    assert.equal(await page.evaluate(() => window.__prefsStore.getState().general.autosave), false);
    assert.equal(await page.locator('#filament-select-2').inputValue(), 'user:Saved Sec 237');
    cfg = await native();
    assert.equal(cfg.nozzle_temperature, `${systemTemp},237`);
    assert.equal(cfg.filament_colour.split(';')[1].toLowerCase(), '#222222');

    // 7. UI changePreset sets shared isSelectingPreset flag immediately and clears after completion
    assert.equal(await page.evaluate(() => window.__appStore.getState().isSelectingPreset), false);
    const loading = await page.locator('#filament-select-2').evaluate(async (el) => {
      el.value = 'Generic PETG @System';
      el.dispatchEvent(new Event('change', { bubbles: true }));
      const busy = window.__appStore.getState().isSelectingPreset;
      const backupWritten = await window.__autosave.writeAutosave();
      return { busy, backupWritten };
    });
    assert.equal(loading.busy, true);
    assert.equal(loading.backupWritten, false, 'autosave skips intermediate native preset state');
    await page.waitForFunction(() => !window.__appStore.getState().isSelectingPreset);
    assert.equal(await page.evaluate(() => window.__appStore.getState().isSelectingPreset), false);
    assert.equal(await page.locator('#filament-select-2').inputValue(), 'Generic PETG @System');
    cfg = await native();
    assert.equal(cfg.nozzle_temperature, `${systemTemp},255`);
    assert.equal(cfg.filament_type.split(';')[1], 'PETG');

    // 8. Explicit UI dropdown selection on unbound device: binds profile + vendor + filaments, survives refresh
    await page.evaluate(() => {
      window.__printerStore.getState().savePrinter({
        id: 'unbound-1',
        name: 'Unbound Machine',
        host_type: 'moonraker',
        print_host: '127.0.0.1:7125',
        use_gateway: false
      });
      window.__printerStore.getState().selectPrinter('unbound-1');
    });
    await page.waitForFunction(() => window.__printerStore.getState().selectedPrinterId === 'unbound-1' && window.__appStore.getState().isEngineReady);
    assert.equal(await page.evaluate(() => window.__printerStore.getState().printers.find((p) => p.id === 'unbound-1')?.preset), undefined);

    const beforeBinding = await native();
    await page.click('#bind-device-profile');
    await page.waitForFunction(() => !window.__appStore.getState().isSelectingPreset);
    assert.deepEqual(await native(), beforeBinding, 'binding current profile preserves native settings and spools');

    await page.waitForFunction(() => {
      const dev = window.__printerStore.getState().printers.find((p) => p.id === 'unbound-1');
      return dev?.preset === 'Voron 2.4 300 0.4 nozzle' && dev?.vendor === 'Voron';
    });

    await page.locator('#filament-color-input-1').fill('#123456');
    await page.locator('#filament-color-input-1').dispatchEvent('change');
    await page.waitForFunction(() => {
      const dev = window.__printerStore.getState().printers.find((p) => p.id === 'unbound-1');
      return dev?.filamentColors?.[0]?.toLowerCase() === '#123456';
    });

    await page.reload();
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    assert.equal(await page.locator('#device-select').inputValue(), 'unbound-1');
    assert.equal(await page.locator('#printer-select').inputValue(), 'Voron 2.4 300 0.4 nozzle');
    cfg = await native();
    assert.equal(cfg.filament_colour.split(';')[0].toLowerCase(), '#123456');

    // 9. Explicit UI dropdown selection on mismatch/previously-bound device updates profile and survives refresh
    await page.selectOption('#device-select', 'b');
    await page.waitForFunction(() => window.__printerStore.getState().selectedPrinterId === 'b' && window.__appStore.getState().isEngineReady);
    assert.equal(await page.evaluate(() => window.__printerStore.getState().printers.find((p) => p.id === 'b')?.preset), 'Voron 2.4 300 0.4 nozzle');

    await page.selectOption('#printer-select', 'Voron 2.4 350 0.4 nozzle');
    await page.waitForFunction(() => window.__appStore.getState().selectedPrinter === 'Voron 2.4 350 0.4 nozzle' && !window.__appStore.getState().isSelectingPreset);

    await page.waitForFunction(() => {
      const dev = window.__printerStore.getState().printers.find((p) => p.id === 'b');
      return dev?.preset === 'Voron 2.4 350 0.4 nozzle';
    });

    await page.locator('#filament-color-input-1').evaluate((input) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#654321');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const dev = window.__printerStore.getState().printers.find((p) => p.id === 'b');
      return dev?.filamentColors?.[0]?.toLowerCase() === '#654321';
    });

    await page.reload();
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    assert.equal(await page.locator('#device-select').inputValue(), 'b');
    assert.equal(await page.locator('#printer-select').inputValue(), 'Voron 2.4 350 0.4 nozzle');
    cfg = await native();
    assert.equal(cfg.filament_colour.split(';')[0].toLowerCase(), '#654321');

    // 10. User printer preset brand inference from inherits parent without merging to arbitrary first vendor
    await page.evaluate(async () => {
      const s = window.__appStore.getState();
      await s.importPresetBundleAction({
        format: 'orcaslicer-web-preset-bundle', version: 1, exportedAt: new Date().toISOString(),
        presets: [
          { kind: 'printer', name: 'Custom Voron 300 Fast', inherits: 'Voron 2.4 300 0.4 nozzle', values: { printable_height: '333' } }
        ]
      });
      window.__printerStore.getState().savePrinter({
        id: 'dev-user-preset',
        name: 'Custom Voron Machine',
        preset: 'Custom Voron 300 Fast',
        host_type: 'moonraker',
        print_host: '127.0.0.1:7126',
        use_gateway: false
      });
      window.__printerStore.getState().selectPrinter('dev-user-preset');
    });

    await page.reload();
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    assert.equal(await page.locator('#device-select').inputValue(), 'dev-user-preset');
    assert.equal(await page.locator('#printer-select').inputValue(), 'user:Custom Voron 300 Fast');
    assert.equal(await page.evaluate(() => window.__appStore.getState().selectedVendor), 'Voron');
    assert.equal(await page.evaluate(() => window.__printerStore.getState().printers.find((p) => p.id === 'dev-user-preset')?.vendor), 'Voron');
    assert.equal((await native()).printable_height, '333', 'saved user printer values are applied natively on startup');
    await page.selectOption('#device-select', 'b');
    await page.waitForFunction(() => window.__appStore.getState().isEngineReady && window.__appStore.getState().selectedPrinter === 'Voron 2.4 350 0.4 nozzle');
    await page.evaluate(async () => {
      const app = window.__appStore.getState();
      await app.addFilamentSlot();
      await app.chooseFilament('Generic PETG @System', 1);
    });
    await page.selectOption('#device-select', 'dev-user-preset');
    await page.waitForFunction(() => window.__appStore.getState().isEngineReady && window.__appStore.getState().selectedPrinter === 'Custom Voron 300 Fast');
    assert.equal((await native()).printable_height, '333', 'device switching applies user printer values');
    assert.equal(await page.evaluate(() => window.__appStore.getState().selectedFilaments.length), 1, 'an unconfigured device uses defaults instead of sibling spools');


    // 11. Programmatic choosePrinter / project load must NOT rebind active device
    await page.evaluate(async () => {
      await window.__appStore.getState().choosePrinter('Voron 2.4 250 0.4 nozzle');
    });
    await page.waitForFunction(() => window.__appStore.getState().selectedPrinter === 'Voron 2.4 250 0.4 nozzle');
    assert.equal(await page.evaluate(() => window.__printerStore.getState().printers.find((p) => p.id === 'dev-user-preset')?.preset), 'Custom Voron 300 Fast');
    const beforeProject = await page.evaluate(() => window.__printerStore.getState().printers.find(p => p.id === 'dev-user-preset'));
    const cube = Array.from(fs.readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url)));
    await page.evaluate(async (cube) => {
      const app = window.__appStore.getState();
      await app.importModelFile(new File([new Uint8Array(cube)], 'cube.obj'));
      const bytes = await app.saveProjectFile('Different profile.3mf');
      if (!bytes) throw new Error(window.__appStore.getState().engineError || 'Project export failed');
      await app.openProjectFile(new File([bytes], 'Different profile.3mf'));
      if (window.__appStore.getState().engineError) throw new Error(window.__appStore.getState().engineError);
    }, cube);
    assert.deepEqual(await page.evaluate(() => window.__printerStore.getState().printers.find(p => p.id === 'dev-user-preset')), beforeProject);


    console.log(`[${bName}] all regression tests passed`);
  } catch (err) {
    console.error(`[${bName}] device regression state`, await page.evaluate(() => ({
      error: window.__appStore?.getState().engineError,
      filaments: window.__appStore?.getState().selectedFilaments,
      temperature: window.__appStore?.getState().currentConfig.nozzle_temperature,
      active: window.__appStore?.getState().activeUserPreset,
      colors: window.__appStore?.getState().currentConfig.filament_colour,
      selected: window.__printerStore?.getState().selectedPrinterId,
      devices: window.__printerStore?.getState().printers,
      busy: window.__appStore?.getState().isSelectingPreset
    })));
    throw err;
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'device-filament-regressions', { frozenDist: true });
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('device-filament-regressions passed on Chromium and Firefox');
} finally {
  await stopServer(PORT);
}
