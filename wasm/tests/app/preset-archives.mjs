#!/usr/bin/env node
/**
 * @file preset-archives.mjs
 * End-to-end browser test for OrcaSlicer Web Native Preset Archive Import & Export.
 *
 * Runs against isolated build on port 5088 across Chromium and Firefox sequentially:
 * 1. Initial page load & engine initialization.
 * 2. Import desktop-made archives (.orca_printer bundle, .orca_filament bundle).
 * 3. Import desktop single preset files (.json and .ini).
 * 4. Verify legacy-key migration and obsolete key sanitization.
 * 5. Native export & complete roundtrip (printer bundle, filament bundle, full zip archive)
 *    verifying desktop layout, bundle_structure.json, and sensitive key sanitization.
 * 6. Name collisions & system preset preservation:
 *    - Strict rejection of system preset overwrites.
 *    - 'skip', 'rename' (with child inheritance re-linking), and 'overwrite' strategies.
 * 7. Malformed and corrupted archives atomic error handling leaving store untouched.
 * 8. UI controls & ManagePresetsDialog integration.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// Import fflate for desktop archive format inspection
let fflate;
try {
  fflate = await import(path.resolve(repoRoot, 'wasm/app/node_modules/fflate/esm/index.mjs'));
} catch {
  fflate = await import('fflate');
}
const { unzipSync, strFromU8 } = fflate;

// Import Playwright
let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../node_modules/playwright/index.mjs');
}
const { chromium, firefox } = playwright;

const PORT = 5088;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ISOLATED_BUILD_DIR = process.env.APP_TEST_DIST || path.resolve(repoRoot, 'wasm/build/ui-preset-archives-dist');
const fixturesDir = path.resolve(repoRoot, 'wasm/tests/fixtures');

async function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(BASE_URL, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerRunning()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

let serverProcess = null;

async function startServer() {
  if (await isServerRunning()) {
    throw new Error(`Port ${PORT} is occupied by an unrelated server; failing per test isolation requirements`);
  }

  console.log(`[Server] Launching 'vite preview' from ${ISOLATED_BUILD_DIR} on port ${PORT}...`);
  serverProcess = spawn(
    'npx',
    [
      'vite',
      'preview',
      '--outDir',
      ISOLATED_BUILD_DIR,
      '--port',
      String(PORT),
      '--host',
      '127.0.0.1'
    ],
    {
      cwd: path.resolve(repoRoot, 'wasm/app'),
      stdio: 'ignore',
      detached: true
    }
  );

  const ready = await waitForServer();
  if (!ready) {
    throw new Error(`Server failed to respond on port ${PORT} within timeout`);
  }
  console.log(`[Server] Vite preview server ready at ${BASE_URL}`);
}

async function stopServer() {
  console.log(`[Server] Terminating server on port ${PORT}...`);
  if (serverProcess && serverProcess.pid) {
    try {
      process.kill(-serverProcess.pid, 'SIGTERM');
    } catch (_) {
      try {
        process.kill(serverProcess.pid, 'SIGTERM');
      } catch (_) {}
    }
    serverProcess = null;
  }
  await new Promise((r) => setTimeout(r, 500));
}

process.on('exit', () => {
  if (serverProcess && serverProcess.pid) {
    try {
      process.kill(-serverProcess.pid, 'SIGKILL');
    } catch (_) {
      try {
        process.kill(serverProcess.pid, 'SIGKILL');
      } catch (_) {}
    }
  }
});

async function runBrowserArchiveSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Preset Archive tests for ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const launchOptions = {
    headless: true,
    args: ['--enable-features=SharedArrayBuffer', `--explicitly-allowed-ports=${PORT}`]
  };
  if (browserName === 'firefox') {
    launchOptions.firefoxUserPrefs = {
      'network.security.ports.banned.override': String(PORT)
    };
  }
  const browser = await browserType.launch(launchOptions);
  const context = await browser.newContext();
  const page = await context.newPage();

  const results = [];

  try {
    // 1. Initial Page Load & Engine Initialization
    console.log(`[${browserName}] Step 1: Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => {
      const v = document.getElementById('vendor-select');
      return v && v.options.length > 1;
    }, null, { timeout: 15000 });

    await page.selectOption('#vendor-select', 'Voron');

    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    await page.waitForFunction(() => {
      const pr = document.getElementById('process-select');
      return pr && !pr.disabled && pr.options.length > 0;
    }, null, { timeout: 15000 });

    results.push({ name: 'Page loaded & engine initialized', pass: true });

    // Helper to clear user presets
    const clearPresets = async () => {
      await page.evaluate(async () => {
        const store = window.__appStore.getState();
        for (const p of [...store.userPresets]) {
          await store.deleteUserPresetAction(p.kind, p.name);
        }
      });
    };

    // Helper to import binary fixture
    const importBinaryFixture = async (fixtureFilename, strategy = 'overwrite') => {
      const filePath = path.join(fixturesDir, fixtureFilename);
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');
      return await page.evaluate(async ({ b64, strat }) => {
        const binStr = atob(b64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        return await window.__appStore.getState().importPresetBundleAction(bytes, strat);
      }, { b64: base64Data, strat: strategy });
    };

    // Helper to import text fixture
    const importTextFixture = async (fixtureFilename, strategy = 'overwrite') => {
      const filePath = path.join(fixturesDir, fixtureFilename);
      const textContent = fs.readFileSync(filePath, 'utf-8');
      return await page.evaluate(async ({ text, strat }) => {
        return await window.__appStore.getState().importPresetBundleAction(text, strat);
      }, { text: textContent, strat: strategy });
    };

    // 2. Import desktop-made .orca_printer archive
    console.log(`[${browserName}] Step 2: Importing desktop-made .orca_printer archive...`);
    await clearPresets();
    const printerRes = await importBinaryFixture('desktop_bundle.orca_printer');
    assert.equal(printerRes.success, true, 'Desktop .orca_printer import must succeed');
    assert.equal(printerRes.importedCount, 3, 'Desktop .orca_printer must import 3 presets');

    const presetsAfterPrinter = await page.evaluate(() => window.__appStore.getState().userPresets);
    const printerPreset = presetsAfterPrinter.find((p) => p.name === 'Desktop Fixture Printer' && p.kind === 'printer');
    const filamentPreset = presetsAfterPrinter.find((p) => p.name === 'Desktop Fixture Filament' && p.kind === 'filament');
    const processPreset = presetsAfterPrinter.find((p) => p.name === 'Desktop Fixture Process' && p.kind === 'process');

    assert.ok(printerPreset, 'Printer preset must exist');
    assert.equal(printerPreset.inherits, 'Voron 2.4 300 0.4 nozzle');
    assert.equal(printerPreset.values.printable_height, '280');

    assert.ok(filamentPreset, 'Filament preset must exist');
    assert.equal(filamentPreset.inherits, 'Generic PLA @Voron');
    assert.equal(filamentPreset.values.nozzle_temperature, '215');
    assert.equal(filamentPreset.values.filament_flow_ratio, '0.98');

    assert.ok(processPreset, 'Process preset must exist');
    assert.equal(processPreset.inherits, '0.20mm Standard @Voron');
    assert.equal(processPreset.values.layer_height, '0.18');
    assert.equal(processPreset.values.wall_loops, '4');
    results.push({ name: 'Import desktop-made .orca_printer bundle (printer, filament, process)', pass: true });

    // 3. Import desktop-made .orca_filament archive
    console.log(`[${browserName}] Step 3: Importing desktop-made .orca_filament archive...`);
    const filamentRes = await importBinaryFixture('desktop_filament_bundle.orca_filament');
    assert.equal(filamentRes.success, true, 'Desktop .orca_filament import must succeed');
    assert.equal(filamentRes.importedCount, 1, 'Desktop .orca_filament must import 1 preset');

    const absPreset = await page.evaluate(() =>
      window.__appStore.getState().userPresets.find((p) => p.name === 'Desktop Fixture ABS' && p.kind === 'filament')
    );
    assert.ok(absPreset, 'Desktop Fixture ABS filament preset must exist');
    assert.equal(absPreset.inherits, 'Generic ABS @Voron');
    assert.equal(absPreset.values.nozzle_temperature, '245');
    assert.equal(absPreset.values.hot_plate_temp, '105');
    results.push({ name: 'Import desktop-made .orca_filament bundle with vendor layout', pass: true });

    // 4. Import desktop single preset files (.json and .ini)
    console.log(`[${browserName}] Step 4: Importing desktop single preset .json and .ini...`);
    // Single JSON
    const jsonRes = await importTextFixture('single_preset.json');
    assert.equal(jsonRes.success, true, 'Single preset .json import must succeed');
    const singleJsonPreset = await page.evaluate(() =>
      window.__appStore.getState().userPresets.find((p) => p.name === 'Single JSON Process')
    );
    assert.ok(singleJsonPreset, 'Single JSON preset must exist');
    assert.equal(singleJsonPreset.kind, 'process');
    assert.equal(singleJsonPreset.values.layer_height, '0.22');
    assert.equal(singleJsonPreset.values.top_shell_layers, '5');

    // Single INI
    const iniRes = await importTextFixture('single_preset.ini');
    assert.equal(iniRes.success, true, 'Single preset .ini import must succeed');
    const singleIniPreset = await page.evaluate(() =>
      window.__appStore.getState().userPresets.find((p) => p.name === 'Single INI Process')
    );
    assert.ok(singleIniPreset, 'Single INI preset must exist');
    assert.equal(singleIniPreset.kind, 'process');
    assert.equal(singleIniPreset.values.layer_height, '0.24');
    assert.equal(singleIniPreset.values.wall_loops, '3');
    // Legacy migration in INI: enable_wipe_tower -> enable_prime_tower, bridge_fan_speed -> overhang_fan_speed
    assert.equal(singleIniPreset.values.enable_prime_tower, '1');
    assert.equal(singleIniPreset.values.overhang_fan_speed, '75');
    assert.equal(singleIniPreset.values.enable_wipe_tower, undefined);
    assert.equal(singleIniPreset.values.bridge_fan_speed, undefined);
    results.push({ name: 'Import single preset .json and .ini formats', pass: true });

    // 5. Legacy-key and value migration verification
    console.log(`[${browserName}] Step 5: Testing desktop legacy key & value migration...`);
    await clearPresets();
    const legacyRes = await importBinaryFixture('desktop_legacy.orca_printer');
    assert.equal(legacyRes.success, true, 'Desktop legacy bundle import must succeed');

    const legacyPresets = await page.evaluate(() => window.__appStore.getState().userPresets);
    const legacyProcess = legacyPresets.find((p) => p.name === 'Legacy Fixture Process');
    const legacyPrinter = legacyPresets.find((p) => p.name === 'Legacy Fixture Printer');

    assert.ok(legacyProcess, 'Legacy process preset must exist');
    // Key rename checks:
    assert.equal(legacyProcess.values.enable_prime_tower, '1', 'enable_wipe_tower migrated to enable_prime_tower');
    assert.equal(legacyProcess.values.prime_tower_width, '18', 'wipe_tower_width migrated to prime_tower_width');
    assert.equal(legacyProcess.values.overhang_fan_speed, '80', 'bridge_fan_speed migrated to overhang_fan_speed');
    assert.equal(legacyProcess.values.sparse_infill_filament_id, '0', 'sparse_infill_filament: 1 migrated to filament id: 0');
    assert.equal(legacyProcess.values.counterbore_hole_bridging, 'partiallybridge', 'counterbole spelling corrected to counterbore');
    assert.equal(legacyProcess.values.initial_layer_speed, undefined, 'percentage speed option erased to inherit system default');
    // Ensure old keys were removed:
    assert.equal(legacyProcess.values.enable_wipe_tower, undefined);
    assert.equal(legacyProcess.values.wipe_tower_width, undefined);
    assert.equal(legacyProcess.values.bridge_fan_speed, undefined);
    assert.equal(legacyProcess.values.sparse_infill_filament, undefined);
    assert.equal(legacyProcess.values.counterbole_hole_bridging, undefined);

    // Obsolete key filtering on printer:
    assert.ok(legacyPrinter, 'Legacy printer preset must exist');
    assert.equal(legacyPrinter.values.machine_switch_extruder_time, undefined, 'Obsolete key filtered out');
    results.push({ name: 'Legacy keys, values, and obsolete fields migrated accurately', pass: true });

    // 6. Native Export & Roundtrip Verification
    console.log(`[${browserName}] Step 6: Testing native archive export & roundtrip...`);
    await clearPresets();
    // Create known user presets including sensitive printer keys
    await page.evaluate(async () => {
      const store = window.__appStore.getState();
      await store.importPresetBundleAction({
        format: 'orcaslicer-web-preset-bundle',
        version: 1,
        presets: [
          {
            name: 'Exported Printer Custom',
            kind: 'printer',
            inherits: 'Voron 2.4 300 0.4 nozzle',
            values: {
              printable_height: '350',
              print_host: '192.168.1.100',
              printhost_apikey: 'SUPER_SECRET_KEY_123',
              printhost_cafile: '/certs/myca.crt'
            }
          },
          {
            name: 'Exported Filament Custom',
            kind: 'filament',
            inherits: 'Generic PLA @Voron',
            values: {
              nozzle_temperature: '220',
              hot_plate_temp: '65'
            }
          },
          {
            name: 'Exported Process Custom',
            kind: 'process',
            inherits: '0.20mm Standard @Voron',
            values: {
              layer_height: '0.14',
              wall_loops: '5'
            }
          }
        ]
      }, 'overwrite');
    });

    // 6a. Export printer bundle
    const exportedPrinterArchiveB64 = await page.evaluate(() => {
      const bytes = window.__appStore.getState().exportDesktopArchiveAction('printer', 'Exported Printer Custom');
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    });

    const printerArchiveBuf = Buffer.from(exportedPrinterArchiveB64, 'base64');
    const printerZipEntries = unzipSync(new Uint8Array(printerArchiveBuf));

    assert.ok(printerZipEntries['bundle_structure.json'], 'bundle_structure.json must be present');
    const bundleStructure = JSON.parse(strFromU8(printerZipEntries['bundle_structure.json']));
    assert.equal(bundleStructure.bundle_type, 'printer config bundle');
    assert.equal(bundleStructure.printer_preset_name, 'Exported Printer Custom');
    assert.ok(bundleStructure.printer_config.includes('printer/Exported Printer Custom.json'));

    assert.ok(printerZipEntries['printer/Exported Printer Custom.json'], 'printer config file must exist in zip');
    const exportedPrinterJson = JSON.parse(strFromU8(printerZipEntries['printer/Exported Printer Custom.json']));
    assert.equal(exportedPrinterJson.printable_height, '350');
    // Ensure sensitive keys are stripped per desktop ExportConfigsDialog::earse_preset_fields_for_safe
    assert.equal(exportedPrinterJson.print_host, undefined, 'Sensitive print_host stripped');
    assert.equal(exportedPrinterJson.printhost_apikey, undefined, 'Sensitive printhost_apikey stripped');
    assert.equal(exportedPrinterJson.printhost_cafile, undefined, 'Sensitive printhost_cafile stripped');

    // 6b. Roundtrip: Clear presets and re-import exported archive
    await clearPresets();
    assert.equal(await page.evaluate(() => window.__appStore.getState().userPresets.length), 0);

    const reimportedRes = await page.evaluate(async (b64) => {
      const binStr = atob(b64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) {
        bytes[i] = binStr.charCodeAt(i);
      }
      return await window.__appStore.getState().importPresetBundleAction(bytes, 'overwrite');
    }, exportedPrinterArchiveB64);

    assert.equal(reimportedRes.success, true);
    assert.equal(reimportedRes.importedCount, 3);

    const restoredPresets = await page.evaluate(() => window.__appStore.getState().userPresets);
    const restoredPrinter = restoredPresets.find((p) => p.name === 'Exported Printer Custom');
    const restoredProcess = restoredPresets.find((p) => p.name === 'Exported Process Custom');
    assert.ok(restoredPrinter, 'Exported printer restored');
    assert.equal(restoredPrinter.values.printable_height, '350');
    assert.ok(restoredProcess, 'Exported process restored');
    assert.equal(restoredProcess.values.layer_height, '0.14');
    assert.equal(restoredProcess.values.wall_loops, '5');

    // 6c. Export filament bundle
    const exportedFilamentArchiveB64 = await page.evaluate(() => {
      const bytes = window.__appStore.getState().exportDesktopArchiveAction('filament', 'Exported Filament Custom');
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    });
    const filamentArchiveBuf = Buffer.from(exportedFilamentArchiveB64, 'base64');
    const filamentZipEntries = unzipSync(new Uint8Array(filamentArchiveBuf));
    assert.ok(filamentZipEntries['bundle_structure.json']);
    const filBundleStruct = JSON.parse(strFromU8(filamentZipEntries['bundle_structure.json']));
    assert.equal(filBundleStruct.bundle_type, 'filament config bundle');
    assert.equal(filBundleStruct.filament_name, 'Exported Filament Custom');
    assert.ok(Array.isArray(filBundleStruct.printer_vendor));

    // 6d. Export all presets as full .zip archive
    const exportedZipB64 = await page.evaluate(() => {
      const bytes = window.__appStore.getState().exportDesktopArchiveAction('all');
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    });
    const zipArchiveBuf = Buffer.from(exportedZipB64, 'base64');
    const fullZipEntries = unzipSync(new Uint8Array(zipArchiveBuf));
    assert.ok(fullZipEntries['Exported Printer Custom.json'], 'Exported printer json exists in zip');
    assert.ok(fullZipEntries['Exported Filament Custom.json'], 'Exported filament json exists in zip');
    assert.ok(fullZipEntries['Exported Process Custom.json'], 'Exported process json exists in zip');

    results.push({ name: 'Export native archives & complete roundtrip restoration', pass: true });

    // 7. Conflicting Name Choice Handling & System Preset Preservation
    console.log(`[${browserName}] Step 7: Testing conflicting name choices...`);
    // 7a. Rejection of system preset overwrite
    let errorCaught = false;
    try {
      await page.evaluate(async () => {
        const fakeSysPreset = {
          name: '0.20mm Standard @Voron',
          type: 'process',
          from: 'User',
          inherits: '0.20mm Standard @Voron',
          layer_height: '0.99'
        };
        await window.__appStore.getState().importPresetBundleAction(JSON.stringify(fakeSysPreset), 'overwrite');
      });
    } catch (_) {
      errorCaught = true;
    }
    assert.ok(errorCaught, 'System preset overwrite attempt must be rejected');

    // 7b. Conflict Strategy 'skip'
    const conflictPresetName = 'Conflict Archive Preset';
    await page.evaluate(async (pName) => {
      await window.__appStore.getState().saveCurrentUserPreset('process', pName);
    }, conflictPresetName);

    const conflictingSingleJson = JSON.stringify({
      name: conflictPresetName,
      type: 'process',
      from: 'User',
      inherits: '0.20mm Standard @Voron',
      layer_height: '0.40'
    });

    const skipRes = await page.evaluate(async ({ json, strat }) => {
      return await window.__appStore.getState().importPresetBundleAction(json, strat);
    }, { json: conflictingSingleJson, strat: 'skip' });
    assert.equal(skipRes.skippedCount, 1, 'Should report 1 skipped');
    const valAfterSkip = await page.evaluate((pName) => {
      return window.__appStore.getState().userPresets.find((p) => p.name === pName)?.values?.layer_height;
    }, conflictPresetName);
    assert.notEqual(valAfterSkip, '0.40', 'Skipped preset must not have new value');

    // 7c. Conflict Strategy 'rename' and child inheritance re-link
    const parentName = 'Conflict Parent Preset';
    const childName = 'Conflict Child Preset';
    await page.evaluate(async (pName) => {
      await window.__appStore.getState().saveCurrentUserPreset('process', pName);
    }, parentName);

    // Bundle with parent and child
    const renameBundleJson = JSON.stringify({
      format: 'orcaslicer-web-preset-bundle',
      version: 1,
      presets: [
        { name: parentName, kind: 'process', inherits: '0.20mm Standard @Voron', values: { layer_height: '0.32' } },
        { name: childName, kind: 'process', inherits: parentName, values: { top_shell_layers: '7' } }
      ]
    });

    const renameRes = await page.evaluate(async ({ json, strat }) => {
      return await window.__appStore.getState().importPresetBundleAction(json, strat);
    }, { json: renameBundleJson, strat: 'rename' });
    assert.equal(renameRes.renamedCount, 1, 'Parent preset renamed on collision');

    const presetsAfterRename = await page.evaluate(() => window.__appStore.getState().userPresets);
    const renamedParent = presetsAfterRename.find((p) => p.name === `${parentName} (Copy)`);
    const childPreset = presetsAfterRename.find((p) => p.name === childName);
    assert.ok(renamedParent, 'Renamed parent copy must exist');
    assert.ok(childPreset, 'Child preset must exist');
    assert.equal(childPreset.inherits, `${parentName} (Copy)`, 'Child must inherit from renamed parent');

    // 7d. Conflict Strategy 'overwrite'
    const overwriteRes = await page.evaluate(async ({ json, strat }) => {
      return await window.__appStore.getState().importPresetBundleAction(json, strat);
    }, { json: conflictingSingleJson, strat: 'overwrite' });
    assert.equal(overwriteRes.overwrittenCount, 1, 'Overwritten preset counted');
    const valAfterOverwrite = await page.evaluate((pName) => {
      return window.__appStore.getState().userPresets.find((p) => p.name === pName)?.values?.layer_height;
    }, conflictPresetName);
    assert.equal(valAfterOverwrite, '0.4', 'Overwritten preset received new value');

    results.push({ name: 'System preset preservation & collision choices (skip, rename, overwrite)', pass: true });

    // 8. Malformed Archives Leave State Untouched
    console.log(`[${browserName}] Step 8: Testing malformed inputs leave presets untouched...`);
    const presetsBeforeMalformed = await page.evaluate(() => window.__appStore.getState().userPresets);

    // 8a. Corrupted archive fixture
    errorCaught = false;
    try {
      await importBinaryFixture('corrupted_archive.orca_printer');
    } catch (_) {
      errorCaught = true;
    }
    assert.ok(errorCaught, 'Corrupted archive must throw error');
    const presetsAfterCorrupt = await page.evaluate(() => window.__appStore.getState().userPresets);
    assert.deepEqual(presetsAfterCorrupt, presetsBeforeMalformed, 'Corrupted archive leaves state untouched');

    // 8b. Junk binary array
    errorCaught = false;
    try {
      await page.evaluate(async () => {
        const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        await window.__appStore.getState().importPresetBundleAction(junk, 'overwrite');
      });
    } catch (_) {
      errorCaught = true;
    }
    assert.ok(errorCaught, 'Junk binary must throw error');
    const presetsAfterJunk = await page.evaluate(() => window.__appStore.getState().userPresets);
    assert.deepEqual(presetsAfterJunk, presetsBeforeMalformed, 'Junk binary leaves state untouched');

    // 8c. Malformed INI text
    errorCaught = false;
    try {
      await page.evaluate(async () => {
        await window.__appStore.getState().importPresetBundleAction('random garbage text that has no preset', 'overwrite');
      });
    } catch (_) {
      errorCaught = true;
    }
    assert.ok(errorCaught, 'Unrecognized plain text must throw error');
    const presetsAfterGarbage = await page.evaluate(() => window.__appStore.getState().userPresets);
    assert.deepEqual(presetsAfterGarbage, presetsBeforeMalformed, 'Garbage text leaves state untouched');

    results.push({ name: 'Malformed archives and corrupt inputs leave state untouched (atomic)', pass: true });

    // 9. UI Controls in ManagePresetsDialog
    console.log(`[${browserName}] Step 9: Testing UI controls in ManagePresetsDialog...`);
    await page.click('[data-testid="manage-process-btn"]');
    await page.waitForSelector('[data-testid="manage-presets-dialog"]', { timeout: 5000 });

    // Verify native export buttons exist
    const printerExportBtn = await page.$('[data-testid="export-desktop-printer-btn"]');
    const filamentExportBtn = await page.$('[data-testid="export-desktop-filament-btn"]');
    const zipExportBtn = await page.$('[data-testid="export-desktop-zip-btn"]');
    assert.ok(printerExportBtn, 'Export .orca_printer button exists');
    assert.ok(filamentExportBtn, 'Export .orca_filament button exists');
    assert.ok(zipExportBtn, 'Export .zip button exists');

    // Verify file input accepts archive formats
    const acceptAttr = await page.$eval('[data-testid="bundle-file-input"]', (el) => el.getAttribute('accept'));
    assert.ok(acceptAttr.includes('.orca_printer'), 'File input accepts .orca_printer');
    assert.ok(acceptAttr.includes('.orca_filament'), 'File input accepts .orca_filament');
    assert.ok(acceptAttr.includes('.zip'), 'File input accepts .zip');
    assert.ok(acceptAttr.includes('.ini'), 'File input accepts .ini');

    // Test pasting single preset INI into textarea
    const sampleIniText = `
[print:Pasted INI Preset]
inherits = 0.20mm Standard @Voron
layer_height = 0.15
wall_loops = 4
`;
    await page.fill('[data-testid="bundle-json-textarea"]', sampleIniText);
    await page.click('[data-testid="import-bundle-json-btn"]');

    await page.waitForSelector('[data-testid="preset-success-msg"]', { timeout: 5000 });
    const successText = await page.$eval('[data-testid="preset-success-msg"]', (el) => el.textContent || '');
    assert.ok(successText.includes('imported') || successText.includes('Preset'), 'Success message displayed for pasted INI');

    const pastedIniPreset = await page.evaluate(() =>
      window.__appStore.getState().userPresets.find((p) => p.name === 'Pasted INI Preset')
    );
    assert.ok(pastedIniPreset, 'Pasted INI preset must exist in store');
    assert.equal(pastedIniPreset.values.layer_height, '0.15');

    // Close dialog
    await page.click('[data-testid="manage-preset-done-btn"]');
    await page.waitForSelector('[data-testid="manage-presets-dialog"]', { state: 'hidden', timeout: 5000 });

    results.push({ name: 'ManagePresetsDialog native archive UI buttons & pasted input verified', pass: true });

  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  console.log(`\nResults for ${browserName.toUpperCase()}:`);
  for (const r of results) {
    console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.name}`);
  }
}

async function main() {
  console.log('Starting Preset Archives E2E test suite...');
  try {
    await startServer();
    // Run Chromium suite
    await runBrowserArchiveSuite(chromium, 'chromium');
    // Run Firefox suite
    await runBrowserArchiveSuite(firefox, 'firefox');
    console.log('\nAll Preset Archive tests passed successfully across Chromium and Firefox!');
  } catch (err) {
    console.error('\nTest suite failed with error:', err);
    process.exitCode = 1;
  } finally {
    await stopServer();
  }
}

main();
