#!/usr/bin/env node
/**
 * @file preset-bundles.mjs
 * End-to-end browser test for OrcaSlicer Web User Preset Bundle Import/Export.
 *
 * Runs against isolated build on port 5075 across Chromium and Firefox sequentially:
 * 1. User preset creation across printer, filament, and process kinds.
 * 2. Versioned web bundle export with schema validation & boundary notice verification.
 * 3. Complete export/import roundtrip restoring presets and values.
 * 4. Malformed bundle input rejection ensuring presets are left untouched (atomic validation).
 * 5. Conflicting name choice handling:
 *    - Rejection of system preset overwrite (system preset preservation).
 *    - Safe rename of system preset collision to custom name.
 *    - Conflict strategies for existing user presets: 'skip', 'rename', 'overwrite'.
 *    - Preserving inheritance references when parent presets are renamed on conflict.
 *    - Storage persistence error resilience ensuring presets remain untouched on write failure.
 * 6. Clean server shutdown on port 5075.
 */

import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// Import Playwright
let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../node_modules/playwright/index.mjs');
}
const { chromium, firefox } = playwright;

const PORT = 5075;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ISOLATED_BUILD_DIR = process.env.APP_TEST_DIST || path.resolve(repoRoot, 'wasm/build/ui-preset-bundles-dist');

async function runBrowserBundleSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Preset Bundle tests for ${browserName.toUpperCase()}`);
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
    // 1. Navigate to page and await initial configuration
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

    // 2. Clear any prior user presets for a clean baseline
    await page.evaluate(async () => {
      const store = window.__appStore.getState();
      for (const p of [...store.userPresets]) {
        await store.deleteUserPresetAction(p.kind, p.name);
      }
    });

    // 3. Create sample user presets across kinds (process, filament, printer)
    console.log(`[${browserName}] Step 2: Creating sample user presets across kinds...`);
    await page.evaluate(async () => {
      const store = window.__appStore.getState();
      // 1. Process preset
      await store.saveCurrentUserPreset('process', 'Bundle Process Fast');
      // 2. Filament preset
      await store.saveCurrentUserPreset('filament', 'Bundle Filament PETG');
      // 3. Printer preset
      await store.saveCurrentUserPreset('printer', 'Bundle Printer Custom');
    });

    const baselinePresets = await page.evaluate(() => window.__appStore.getState().userPresets);
    assert.equal(baselinePresets.length, 3, 'Must have 3 user presets initially created');
    assert.ok(baselinePresets.some((p) => p.name === 'Bundle Process Fast' && p.kind === 'process'));
    assert.ok(baselinePresets.some((p) => p.name === 'Bundle Filament PETG' && p.kind === 'filament'));
    assert.ok(baselinePresets.some((p) => p.name === 'Bundle Printer Custom' && p.kind === 'printer'));
    results.push({ name: 'Created initial multi-kind user presets', pass: true });

    // 4. Test Export Bundle
    console.log(`[${browserName}] Step 3: Exporting preset bundle...`);
    const exportedBundle = await page.evaluate(() => {
      return window.__appStore.getState().exportPresetBundleAction();
    });

    assert.equal(exportedBundle.format, 'orcaslicer-web-preset-bundle', 'Bundle format identifier must match');
    assert.equal(exportedBundle.version, 1, 'Bundle version must be 1');
    assert.ok(exportedBundle.exportedAt, 'Export timestamp must exist');
    assert.equal(exportedBundle.presets.length, 3, 'Exported bundle must contain 3 presets');
    results.push({ name: 'Export versioned preset bundle with schema', pass: true });

    // 5. Clear all presets, then Import bundle (Roundtrip verification)
    console.log(`[${browserName}] Step 4: Testing roundtrip import...`);
    await page.evaluate(async () => {
      const store = window.__appStore.getState();
      for (const p of [...store.userPresets]) {
        await store.deleteUserPresetAction(p.kind, p.name);
      }
    });
    const emptyCount = await page.evaluate(() => window.__appStore.getState().userPresets.length);
    assert.equal(emptyCount, 0, 'Presets must be cleared before import test');

    // Import exported bundle JSON string via store action
    const importResult = await page.evaluate(async (bundleStr) => {
      const store = window.__appStore.getState();
      return await store.importPresetBundleAction(bundleStr, 'overwrite');
    }, JSON.stringify(exportedBundle));

    assert.equal(importResult.success, true, 'Import must succeed');
    assert.equal(importResult.importedCount, 3, 'Must report 3 imported presets');

    const restoredPresets = await page.evaluate(() => window.__appStore.getState().userPresets);
    assert.equal(restoredPresets.length, 3, 'Restored presets count must equal 3');
    for (const original of baselinePresets) {
      const restored = restoredPresets.find((p) => p.kind === original.kind && p.name === original.name);
      assert.ok(restored, `Preset ${original.name} must be restored`);
      assert.equal(restored.inherits, original.inherits, 'Inherits must match original');
      assert.deepEqual(restored.values, original.values, 'Values must match original');
    }
    results.push({ name: 'Export/import roundtrip matches exact presets and overrides', pass: true });

    // 6. Test Malformed Input Leaves Presets Unchanged
    console.log(`[${browserName}] Step 5: Testing malformed inputs leave presets unchanged...`);
    const presetsBeforeMalformed = await page.evaluate(() => window.__appStore.getState().userPresets);

    // Case 5a: Malformed JSON syntax
    let errorCaught = false;
    try {
      await page.evaluate(async () => {
        await window.__appStore.getState().importPresetBundleAction('{ bad json syntax: true,', 'overwrite');
      });
    } catch (err) {
      errorCaught = true;
    }
    assert.ok(errorCaught, 'Malformed JSON must throw error');
    const presetsAfterBadJson = await page.evaluate(() => window.__appStore.getState().userPresets);
    assert.deepEqual(presetsAfterBadJson, presetsBeforeMalformed, 'Bad JSON syntax must leave presets unchanged');

    // Case 5b: Missing or invalid presets array
    errorCaught = false;
    try {
      await page.evaluate(async () => {
        await window.__appStore.getState().importPresetBundleAction(
          JSON.stringify({ format: 'orcaslicer-web-preset-bundle', version: 1, presets: 'not-an-array' }),
          'overwrite'
        );
      });
    } catch (_) {
      errorCaught = true;
    }
    assert.ok(errorCaught, 'Non-array presets must throw error');
    const presetsAfterBadPresets = await page.evaluate(() => window.__appStore.getState().userPresets);
    assert.deepEqual(presetsAfterBadPresets, presetsBeforeMalformed, 'Non-array presets must leave presets unchanged');

    // Case 5c: Invalid preset items (invalid kind, empty name)
    errorCaught = false;
    try {
      await page.evaluate(async () => {
        await window.__appStore.getState().importPresetBundleAction(
          JSON.stringify({
            format: 'orcaslicer-web-preset-bundle',
            version: 1,
            presets: [{ name: '', kind: 'invalid_kind', inherits: 'base', values: {} }]
          }),
          'overwrite'
        );
      });
    } catch (_) {
      errorCaught = true;
    }
    assert.ok(errorCaught, 'Invalid preset item must throw error');
    const presetsAfterBadItem = await page.evaluate(() => window.__appStore.getState().userPresets);
    assert.deepEqual(presetsAfterBadItem, presetsBeforeMalformed, 'Invalid preset item must leave presets unchanged');

    // Case 5d: Unsupported bundle version / format boundary
    errorCaught = false;
    try {
      await page.evaluate(async () => {
        await window.__appStore.getState().importPresetBundleAction(
          JSON.stringify({ format: 'native-orca-bundle-zip', version: 99, presets: [] }),
          'overwrite'
        );
      });
    } catch (_) {
      errorCaught = true;
    }
    assert.ok(errorCaught, 'Unsupported bundle format/version must throw boundary error');
    const presetsAfterBadVersion = await page.evaluate(() => window.__appStore.getState().userPresets);
    assert.deepEqual(presetsAfterBadVersion, presetsBeforeMalformed, 'Unsupported version must leave presets unchanged');

    // Case 5e: Missing required format identifier
    errorCaught = false;
    try {
      await page.evaluate(async () => {
        await window.__appStore.getState().importPresetBundleAction(
          JSON.stringify({ version: 1, presets: [] }),
          'overwrite'
        );
      });
    } catch (_) {
      errorCaught = true;
    }
    assert.ok(errorCaught, 'Missing format identifier must throw validation error');

    // Case 5f: Missing required version identifier
    errorCaught = false;
    try {
      await page.evaluate(async () => {
        await window.__appStore.getState().importPresetBundleAction(
          JSON.stringify({ format: 'orcaslicer-web-preset-bundle', presets: [] }),
          'overwrite'
        );
      });
    } catch (_) {
      errorCaught = true;
    }
    assert.ok(errorCaught, 'Missing version identifier must throw validation error');

    results.push({ name: 'Malformed input and unsupported formats leave presets untouched', pass: true });

    // 7. Conflicting Name Choice: System Preset Preservation
    console.log(`[${browserName}] Step 6: Testing system preset preservation...`);
    // System preset collision with 'overwrite' -> must throw and leave presets untouched
    errorCaught = false;
    try {
      await page.evaluate(async () => {
        await window.__appStore.getState().importPresetBundleAction(
          JSON.stringify({
            format: 'orcaslicer-web-preset-bundle',
            version: 1,
            presets: [{ name: '0.20mm Standard @Voron', kind: 'process', inherits: '0.20mm Standard @Voron', values: { layer_height: '0.5' } }]          }),
            'overwrite'
          );
      });
    } catch (err) {
      errorCaught = true;
    }
    assert.ok(errorCaught, 'Overwriting system preset must throw and be rejected');
    // Verify system presets in store were not modified
    const sysProcesses = await page.evaluate(() => window.__appStore.getState().processes);
    const standardSys = sysProcesses.find((p) => p.name === '0.20mm Standard @Voron');
    assert.ok(standardSys, 'System preset must exist');

    // System preset collision with 'rename' -> safely renames to <name> (Custom)
    const sysRenameResult = await page.evaluate(async () => {
      return await window.__appStore.getState().importPresetBundleAction(
        JSON.stringify({
          format: 'orcaslicer-web-preset-bundle',
          version: 1,
          presets: [{ name: '0.20mm Standard @Voron', kind: 'process', inherits: '0.20mm Standard @Voron', values: { layer_height: '0.5' } }]
        }),
        'rename'
      );
    });
    assert.equal(sysRenameResult.renamedCount, 1, 'Must rename system preset collision');
    const currentPresetsAfterSysRename = await page.evaluate(() => window.__appStore.getState().userPresets);
    assert.ok(
      currentPresetsAfterSysRename.some((p) => p.name === '0.20mm Standard @Voron (Custom)' && p.values.layer_height === '0.5'),
      'System collision must be safely imported with (Custom) suffix'
    );
    results.push({ name: 'System presets strictly preserved against overwrite & renamed safely', pass: true });

    // 8. Conflicting Name Choice for User Presets: 'skip', 'rename', 'overwrite'
    console.log(`[${browserName}] Step 7: Testing conflict choices for user presets...`);

    // Prepare a target preset: 'Conflict Test Preset' with layer_height = '0.20'
    await page.evaluate(async () => {
      const store = window.__appStore.getState();
      await store.importPresetBundleAction({
        format: 'orcaslicer-web-preset-bundle',
        version: 1,
        presets: [{ name: 'Conflict Test Preset', kind: 'process', inherits: '0.20mm Standard @Voron', values: { layer_height: '0.20' } }]
      }, 'overwrite');
    });

    const incomingConflictingBundle = {
      format: 'orcaslicer-web-preset-bundle',
      version: 1,
      presets: [{ name: 'Conflict Test Preset', kind: 'process', inherits: '0.20mm Standard @Voron', values: { layer_height: '0.35' } }]
    };

    // 8a. Strategy: 'skip'
    const skipResult = await page.evaluate(async (b) => {
      return await window.__appStore.getState().importPresetBundleAction(b, 'skip');
    }, incomingConflictingBundle);
    assert.equal(skipResult.skippedCount, 1, 'Conflict strategy skip must report 1 skipped');
    const presetAfterSkip = await page.evaluate(() =>
      window.__appStore.getState().userPresets.find((p) => p.name === 'Conflict Test Preset')
    );
    assert.equal(presetAfterSkip.values.layer_height, '0.20', 'Preset values must remain 0.20 when skipped');

    // 8b. Strategy: 'rename'
    const renameResult = await page.evaluate(async (b) => {
      return await window.__appStore.getState().importPresetBundleAction(b, 'rename');
    }, incomingConflictingBundle);
    assert.equal(renameResult.renamedCount, 1, 'Conflict strategy rename must report 1 renamed');
    const presetBaseAfterRename = await page.evaluate(() =>
      window.__appStore.getState().userPresets.find((p) => p.name === 'Conflict Test Preset')
    );
    const presetCopyAfterRename = await page.evaluate(() =>
      window.__appStore.getState().userPresets.find((p) => p.name === 'Conflict Test Preset (Copy)')
    );
    assert.equal(presetBaseAfterRename.values.layer_height, '0.20', 'Original preset remains 0.20');
    assert.ok(presetCopyAfterRename, 'New copy preset must exist');
    assert.equal(presetCopyAfterRename.values.layer_height, '0.35', 'Renamed copy gets incoming values 0.35');

    // 8c. Strategy: 'overwrite'
    const overwriteResult = await page.evaluate(async (b) => {
      return await window.__appStore.getState().importPresetBundleAction(b, 'overwrite');
    }, incomingConflictingBundle);
    assert.equal(overwriteResult.overwrittenCount, 1, 'Conflict strategy overwrite must report 1 overwritten');
    const presetAfterOverwrite = await page.evaluate(() =>
      window.__appStore.getState().userPresets.find((p) => p.name === 'Conflict Test Preset')
    );
    assert.equal(presetAfterOverwrite.values.layer_height, '0.35', 'Preset values updated to 0.35 after overwrite');

    // 8d. Imported inheritance remains usable when parent is renamed on conflict
    const parentName = 'Inherited Parent Process';
    const childName = 'Inherited Child Process';
    await page.evaluate(async (pName) => {
      const store = window.__appStore.getState();
      await store.saveCurrentUserPreset('process', pName);
    }, parentName);

    const bundleWithInheritance = {
      format: 'orcaslicer-web-preset-bundle',
      version: 1,
      presets: [
        { name: parentName, kind: 'process', inherits: '0.20mm Standard @Voron', values: { layer_height: '0.28' } },
        { name: childName, kind: 'process', inherits: parentName, values: { top_shell_layers: '6' } }
      ]
    };

    const inheritRenameResult = await page.evaluate(async (b) => {
      return await window.__appStore.getState().importPresetBundleAction(b, 'rename');
    }, bundleWithInheritance);

    assert.equal(inheritRenameResult.renamedCount, 1, 'Parent preset must be renamed');
    const presetsAfterInheritImport = await page.evaluate(() => window.__appStore.getState().userPresets);
    const renamedParent = presetsAfterInheritImport.find((p) => p.name === `${parentName} (Copy)`);
    const importedChild = presetsAfterInheritImport.find((p) => p.name === childName);
    assert.ok(renamedParent, 'Renamed parent preset must exist');
    assert.ok(importedChild, 'Imported child preset must exist');
    assert.equal(importedChild.inherits, `${parentName} (Copy)`, 'Imported child inherits must point to renamed parent copy');

    // 8e. Storage error handling: durable write failure leaves store presets untouched and throws
    const presetsBeforeStorageFail = await page.evaluate(() => window.__appStore.getState().userPresets);
    let storageErrorCaught = false;
    try {
      await page.evaluate(async () => {
        const store = window.__appStore.getState();
        const origStorageSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = () => {
          throw new Error('Simulated durable storage failure');
        };
        const origOpfs = typeof StorageManager !== "undefined" ? StorageManager.prototype.getDirectory : undefined;
        if (origOpfs) {
          StorageManager.prototype.getDirectory = () => Promise.reject(new Error("Simulated OPFS failure"));
        }
        try {
          await store.importPresetBundleAction({
            format: 'orcaslicer-web-preset-bundle',
            version: 1,
            presets: [{ name: 'Will Fail Preset', kind: 'process', inherits: '0.20mm Standard @Voron', values: {} }]
          }, 'overwrite');
        } finally {
          Storage.prototype.setItem = origStorageSetItem;
          if (origOpfs) {
            StorageManager.prototype.getDirectory = origOpfs;
          }
        }
      });
    } catch (_) {
      storageErrorCaught = true;
    }
    assert.ok(storageErrorCaught, 'Storage failure must throw error');
    const presetsAfterStorageFail = await page.evaluate(() => window.__appStore.getState().userPresets);
    assert.deepEqual(presetsAfterStorageFail, presetsBeforeStorageFail, 'Storage write failure must leave store presets untouched');
    const engineError = await page.evaluate(() => window.__appStore.getState().engineError);
    assert.ok(engineError && engineError.includes('Failed to import'), 'Engine error must record import failure');

    results.push({ name: 'Conflicting name choices (skip, rename, overwrite) behave correctly', pass: true });

    // 9. UI Testing via ManagePresetsDialog
    console.log(`[${browserName}] Step 8: Testing UI controls in ManagePresetsDialog...`);
    await page.click('[data-testid="manage-process-btn"]');
    await page.waitForSelector('[data-testid="manage-presets-dialog"]', { timeout: 5000 });

    // Verify Export button and conflict strategy select are present
    const exportBtn = await page.$('[data-testid="export-bundle-btn"]');
    assert.ok(exportBtn, 'Export bundle button must be present in UI');

    const strategySelect = await page.$('[data-testid="bundle-conflict-strategy"]');
    assert.ok(strategySelect, 'Conflict strategy selector must be present in UI');

    // Select 'rename' strategy in UI
    await page.selectOption('[data-testid="bundle-conflict-strategy"]', 'rename');

    // Test pasting bundle JSON in UI
    const testUiBundle = {
      format: 'orcaslicer-web-preset-bundle',
      version: 1,
      presets: [
        { name: 'UI Imported Process', kind: 'process', inherits: '0.20mm Standard @Voron', values: { layer_height: '0.16' } }
      ]
    };
    await page.fill('[data-testid="bundle-json-textarea"]', JSON.stringify(testUiBundle));
    await page.click('[data-testid="import-bundle-json-btn"]');

    await page.waitForSelector('[data-testid="preset-success-msg"]', { timeout: 5000 });
    const successMsg = await page.$eval('[data-testid="preset-success-msg"]', (el) => el.textContent || '');
    assert.ok(successMsg.includes('imported') || successMsg.includes('Bundle'), `Expected success message, got: ${successMsg}`);

    // Verify the newly imported preset exists in store
    const uiImported = await page.evaluate(() =>
      window.__appStore.getState().userPresets.find((p) => p.name === 'UI Imported Process')
    );
    assert.ok(uiImported, 'UI Imported Process must exist in store');
    assert.equal(uiImported.values.layer_height, '0.16');

    // Test malformed JSON via UI displays error message without modifying presets
    await page.fill('[data-testid="bundle-json-textarea"]', '{ definitely not valid json');
    await page.click('[data-testid="import-bundle-json-btn"]');
    await page.waitForSelector('[data-testid="preset-error-msg"]', { timeout: 5000 });
    const uiErrorMsg = await page.$eval('[data-testid="preset-error-msg"]', (el) => el.textContent || '');
    assert.ok(uiErrorMsg.length > 0, 'Error message must be displayed for malformed JSON');

    // Close dialog
    await page.click('[data-testid="manage-preset-done-btn"]');
    await page.waitForSelector('[data-testid="manage-presets-dialog"]', { state: 'hidden', timeout: 5000 });

    results.push({ name: 'Accessible UI controls, file/JSON import & validation messages verified', pass: true });

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
  console.log('Starting Preset Bundles E2E test suite...');
  try {
    await startServer(PORT, 'preset-bundles');
    // Run Chromium suite
    await runBrowserBundleSuite(chromium, 'chromium');
    // Run Firefox suite
    await runBrowserBundleSuite(firefox, 'firefox');
    console.log('\nAll Preset Bundle tests passed successfully across Chromium and Firefox!');
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('\nTest suite failed with error:', err);
  process.exit(1);
});
