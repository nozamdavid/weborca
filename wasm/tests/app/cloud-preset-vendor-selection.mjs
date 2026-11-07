#!/usr/bin/env node
/** Saved cloud printer selection must load its system base across vendors. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5236);
const origin = process.env.APP_TEST_BASE_URL || `http://127.0.0.1:${port}`;
const evidence = path.resolve(process.env.APP_TEST_EVIDENCE || 'wasm/build/tests-cloud-preset-vendor/repro');
const preload = process.env.APP_TEST_PRELOAD_SNAPMAKER === '1';
const name = 'Snapmaker U1 (0.4 nozzle) Timelapse';
const inherits = 'Snapmaker U1 (0.4 nozzle)';
const values = {
  machine_start_gcode: '; cloud-vendor-regression start\nG28\nM117 Saved start',
  machine_end_gcode: '; cloud-vendor-regression end\nM104 S0\nM117 Saved end',
  layer_change_gcode: '; cloud-vendor-regression layer\nTIMELAPSE_TAKE_FRAME',
  z_offset: '0.125',
  print_host: 'http://saved-printer.invalid',
};

fs.mkdirSync(evidence, { recursive: true });
if (!process.env.APP_TEST_BASE_URL) await startServer(port, 'cloud-preset-vendor-selection', { frozenDist: true });
let browser;
try {
  const browserType = process.env.APP_TEST_BROWSER === 'firefox' ? firefox : chromium;
  browser = await browserType.launch({
    headless: process.env.APP_TEST_HEADED !== '1',
    ...(browserType === firefox ? { firefoxUserPrefs: {
      'dom.ipc.processCount': 1,
      'dom.ipc.processCount.webIsolated': 1,
      'dom.ipc.processPrelaunch.enabled': false,
      'dom.maxHardwareConcurrency': 2,
      'fission.autostart': false,
    } } : {}),
  });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
    localStorage.setItem('orcaslicer_preferences_v1', JSON.stringify({
      general: { slicingThreads: 2, autosave: false, autoSliceAfterChange: false, language: 'en' },
    }));
  });
  // Permit only the isolated fixture server; account and printer traffic is blocked.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin && !url.pathname.startsWith('/_')
      ? route.continue() : route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => window.__appStore?.getState().isEngineReady,
    null, { timeout: 90000 });
  const initial = await page.evaluate(() => {
    const s = window.__appStore.getState();
    return { vendor: s.selectedVendor, printer: s.selectedPrinter, error: s.engineError };
  });
  assert.equal(initial.error, null, 'engine initialization');
  assert.equal(initial.vendor, 'Voron', 'fresh context starts with default Voron');
  const imported = await page.evaluate(({ name, inherits, values }) =>
    window.__appStore.getState().importPresetBundleAction({
      format: 'orcaslicer-web-preset-bundle', version: 1,
      presets: [{ kind: 'printer', name, inherits, values }],
    }), { name, inherits, values });
  assert.equal(imported.success, true, 'synthetic saved cloud preset imports');
  if (preload) {
    await page.evaluate(() => window.__appStore.getState().chooseVendor('Snapmaker'));
    assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null,
      'explicit Snapmaker vendor load succeeds');
  }
  await page.evaluate(name => window.__appStore.getState().selectUserPreset('printer', name), name);
  const result = await page.evaluate(async name => {
    const s = window.__appStore.getState();
    const config = await window.__orcaEngine.getConfig();
    const keys = ['nozzle_diameter', 'printable_area', 'printable_height',
      'machine_start_gcode', 'machine_end_gcode', 'layer_change_gcode', 'z_offset', 'print_host'];
    return {
      error: s.engineError, vendor: s.selectedVendor, printer: s.selectedPrinter,
      active: s.activeUserPreset.printer,
      saved: s.userPresets.find(p => p.kind === 'printer' && p.name === name),
      native: Object.fromEntries(keys.map(key => [key, config[key]])),
    };
  }, name);
  const report = { dist: process.env.APP_TEST_DIST, preload, initial, imported, result };
  fs.writeFileSync(path.join(evidence, preload ? 'preloaded.json' : 'selection.json'),
    JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  assert.equal(result.error, null, 'selectUserPreset must resolve the saved printer base across vendors');
  assert.equal(result.printer, name, 'saved user printer is selected');
  assert.equal(result.active, name, 'saved user printer is active');
  assert.equal(result.vendor, 'Snapmaker', 'printer vendor follows resolved system parent');
  assert.ok(await page.evaluate(inherits => window.__appStore.getState().printers.some(p => p.name === inherits), inherits),
    'printer list includes newly loaded parent');
  assert.equal(result.native.nozzle_diameter, '0.4,0.4,0.4,0.4', 'four inherited Snapmaker nozzles');
  assert.equal(result.native.printable_area, '0.5x1,270.5x1,270.5x271,0.5x271', 'inherited Snapmaker bed');
  assert.equal(result.native.printable_height, '270.05', 'inherited Snapmaker height');
  for (const [key, value] of Object.entries(values)) {
    assert.equal(result.saved.values[key], value, `exact saved ${key} override is imported`);
    // Native getConfig uses Orca's escaped string serialization for G-code.
    const serialized = key.endsWith('_gcode') ? value.replaceAll('\n', '\\n') : value;
    assert.equal(result.native[key], serialized, `exact saved ${key} override reaches native config`);
  }
  console.log('PASS: saved printer inherits Snapmaker base and retains exact overrides');

  // The same loaded parent must work through another imported user preset.
  const chainName = 'Imported Timelapse child';
  await page.evaluate(({ name, chainName }) => window.__appStore.getState().importPresetBundleAction({
    format: 'orcaslicer-web-preset-bundle', version: 1,
    presets: [{ kind: 'printer', name: chainName, inherits: name, values: { z_offset: '0.25' } }],
  }), { name, chainName });
  await page.evaluate(chainName => window.__appStore.getState().selectUserPreset('printer', chainName), chainName);
  const chained = await page.evaluate(async () => ({
    error: window.__appStore.getState().engineError, config: await window.__orcaEngine.getConfig(),
  }));
  assert.equal(chained.error, null, 'imported user inheritance chain with already loaded parent');
  assert.equal(chained.config.z_offset, '0.25');
  assert.equal(chained.config.machine_start_gcode, result.native.machine_start_gcode);
  assert.equal(chained.config.nozzle_diameter, result.native.nozzle_diameter);
  console.log('PASS: already loaded parent and imported user inheritance chain');

  const snapshot = () => page.evaluate(async () => {
    const s = window.__appStore.getState();
    return { vendor: s.selectedVendor, printers: s.printers, printer: s.selectedPrinter,
      process: s.selectedProcess, filaments: s.selectedFilaments, active: s.activeUserPreset,
      current: s.currentConfig, baseline: s.presetConfig,
      overrides: [s.processOverrides, s.filamentOverrides, s.printerOverrides],
      native: await window.__orcaEngine.getConfig() };
  });
  for (const kind of ['printer', 'process', 'filament']) {
    const missing = 'Missing packaged system parent';
    const invalidName = `Unknown parent ${kind}`;
    await page.evaluate(({ kind, invalidName, missing }) => window.__appStore.getState().importPresetBundleAction({
      format: 'orcaslicer-web-preset-bundle', version: 1,
      presets: [{ kind, name: invalidName, inherits: missing, values: {} }],
    }), { kind, invalidName, missing });
    const before = await snapshot();
    await page.evaluate(({ kind, invalidName }) => window.__appStore.getState().selectUserPreset(kind, invalidName),
      { kind, invalidName });
    assert.match(await page.evaluate(() => window.__appStore.getState().engineError),
      new RegExp(`Unknown ${kind} preset: ${missing}`));
    assert.deepEqual(await snapshot(), before, `unknown ${kind} parent preserves selection/config/overrides`);
  }
  console.log('PASS: unknown printer/process/filament parents preserve previous native and store state');
} finally {
  await browser?.close();
  if (!process.env.APP_TEST_BASE_URL) await stopServer(port);
}
