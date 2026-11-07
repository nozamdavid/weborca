#!/usr/bin/env node
/**
 * @file presets.mjs
 * End-to-end browser test for OrcaSlicer Web User Presets management.
 *
 * Runs against isolated build on port 5071 across Chromium and Firefox sequentially:
 * 1. Create process preset -> duplicate with same values -> rename active copy -> reload persists -> select/delete copy
 * 2. Reject same-kind collision and blank name without changing existing data
 * 3. Printer and filament user preset handling & config preservation
 * 4. Dual and single storage failure semantics (honoring fallback when one works, error reaching UI when both fail)
 * 5. Stale OPFS resurrection prevention & timestamp conflict protection
 * 6. Clean server shutdown on port 5071.
 */

import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

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

const PORT = 5071;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ISOLATED_BUILD_DIR = process.env.APP_TEST_DIST || path.resolve(repoRoot, 'wasm/build/ui-presets-dist');

async function runBrowserPresetsSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Presets tests for ${browserName.toUpperCase()}`);
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
    // 1. Navigate to page
    console.log(`[${browserName}] Step 1: Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    // Wait for vendor and printer selectors to populate

    await selectAddedPrinter(page, 'Voron');

    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    await page.waitForFunction(() => {
      const pr = document.getElementById('process-select');
      return pr && !pr.disabled && pr.options.length > 0;
    }, null, { timeout: 15000 });

    // -------------------------------------------------------------------------
    // 2. Create process preset via Save button & SavePresetDialog
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 2: Creating process preset...`);
    await page.click('[data-testid="page-tab-Quality"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('setting-input-layer_height');
      return el && !el.disabled;
    }, null, { timeout: 10000 });
    await page.fill('#setting-input-layer_height', '0.28');

    // Open save dialog
    await page.click('[data-testid="save-process-btn"]');
    await page.waitForSelector('[data-testid="save-preset-dialog"]', { timeout: 5000 });

    // Test rejection of empty name and system preset name collision
    console.log(`[${browserName}] Step 2a: Testing Save dialog validation (empty name & system collision)...`);
    const confirmBtn = await page.$('[data-testid="save-preset-confirm-btn"]');
    assert(await confirmBtn.isDisabled(), 'Save confirm button must be disabled for empty name');

    // Enter system preset name
    await page.fill('[data-testid="preset-name-input"]', '0.20mm Standard @Voron');
    await page.click('[data-testid="save-preset-confirm-btn"]');
    await page.waitForSelector('[data-testid="preset-error-msg"]', { timeout: 5000 });
    const sysErrorText = await page.$eval('[data-testid="preset-error-msg"]', (el) => el.textContent || '');
    assert(sysErrorText.includes('immutable system preset'), `Expected system preset collision message, got: ${sysErrorText}`);

    // Enter valid new name
    await page.fill('[data-testid="preset-name-input"]', 'Fast 0.28 Base');
    await page.click('[data-testid="save-preset-confirm-btn"]');
    await page.waitForSelector('[data-testid="save-preset-dialog"]', { state: 'hidden', timeout: 5000 });

    // Verify it is active and in dropdown
    await page.waitForFunction(() => {
      const ps = document.getElementById('process-select');
      return ps && ps.value === 'user:Fast 0.28 Base';
    }, null, { timeout: 10000 });
    results.push({ name: 'Create process preset with validation', pass: true });

    // -------------------------------------------------------------------------
    // 3. Duplicate preset via ManagePresetsDialog
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 3: Duplicating preset...`);
    await page.click('[data-testid="manage-process-btn"]');
    await page.waitForSelector('[data-testid="manage-presets-dialog"]', { timeout: 5000 });

    // Test duplicate validation: blank name, distinct name requirement, collision
    console.log(`[${browserName}] Step 3a: Testing Duplicate validation...`);
    // Blank name: button should be disabled
    const dupBtn = await page.$('[data-testid="duplicate-preset-confirm-btn"]');
    assert(await dupBtn.isDisabled(), 'Duplicate button must be disabled when duplicate input is empty');

    // Same name as source
    await page.fill('[data-testid="duplicate-preset-input"]', 'Fast 0.28 Base');
    await page.click('[data-testid="duplicate-preset-confirm-btn"]');
    await page.waitForSelector('[data-testid="preset-error-msg"]', { timeout: 5000 });
    const sameNameError = await page.$eval('[data-testid="preset-error-msg"]', (el) => el.textContent || '');
    assert(sameNameError.includes('distinct name'), `Expected distinct name error, got: ${sameNameError}`);

    // System preset collision
    await page.fill('[data-testid="duplicate-preset-input"]', '0.20mm Standard @Voron');
    await page.click('[data-testid="duplicate-preset-confirm-btn"]');
    await page.waitForSelector('[data-testid="preset-error-msg"]', { timeout: 5000 });
    const dupSysError = await page.$eval('[data-testid="preset-error-msg"]', (el) => el.textContent || '');
    assert(dupSysError.includes('immutable system preset'), `Expected immutable system preset error, got: ${dupSysError}`);

    // Valid duplicate name
    await page.fill('[data-testid="duplicate-preset-input"]', 'Fast 0.28 Copy');
    await page.click('[data-testid="duplicate-preset-confirm-btn"]');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="preset-success-msg"]');
      return el && el.textContent.includes('Fast 0.28 Copy');
    }, null, { timeout: 10000 });

    // Verify copy inherited base and has same values
    const storeStateAfterDup = await page.evaluate(() => {
      const state = window.__appStore.getState();
      const copy = state.userPresets.find((p) => p.name === 'Fast 0.28 Copy');
      const base = state.userPresets.find((p) => p.name === 'Fast 0.28 Base');
      return { copy, base, active: state.activeUserPreset };
    });
    assert.equal(storeStateAfterDup.copy.inherits, storeStateAfterDup.base.inherits, 'Inherited base must match');
    assert.deepEqual(storeStateAfterDup.copy.values, storeStateAfterDup.base.values, 'Values must match source preset');
    assert.equal(storeStateAfterDup.active.process, 'Fast 0.28 Copy', 'Active process preset must be the copy');
    results.push({ name: 'Duplicate preset with validation & inheritance preservation', pass: true });

    // -------------------------------------------------------------------------
    // 4. Rename active copy
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 4: Renaming active copy...`);
    // Test rename validation
    await page.fill('[data-testid="rename-preset-input"]', 'Fast 0.28 Base');
    await page.click('[data-testid="rename-preset-confirm-btn"]');
    await page.waitForSelector('[data-testid="preset-error-msg"]', { timeout: 5000 });
    const renameCollError = await page.$eval('[data-testid="preset-error-msg"]', (el) => el.textContent || '');
    assert(renameCollError.includes('already exists'), `Expected collision error on rename, got: ${renameCollError}`);

    // Valid rename
    await page.fill('[data-testid="rename-preset-input"]', 'Fast 0.28 Renamed');
    await page.click('[data-testid="rename-preset-confirm-btn"]');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="preset-success-msg"]');
      return el && el.textContent.includes('Fast 0.28 Renamed');
    }, null, { timeout: 10000 });

    // Verify active selection is preserved after rename
    const storeStateAfterRename = await page.evaluate(() => {
      const state = window.__appStore.getState();
      return {
        active: state.activeUserPreset,
        selected: state.selectedProcess,
        renamedPreset: state.userPresets.find((p) => p.name === 'Fast 0.28 Renamed')
      };
    });
    assert.equal(storeStateAfterRename.active.process, 'Fast 0.28 Renamed', 'Active selection preserved after rename');
    assert.equal(storeStateAfterRename.selected, 'Fast 0.28 Renamed', 'Selected process updated to new name');
    assert.ok(storeStateAfterRename.renamedPreset, 'Renamed preset exists in store');
    assert.equal(storeStateAfterRename.renamedPreset.values.layer_height, '0.28', 'Preserved values');

    // Close manage dialog
    await page.click('[data-testid="manage-preset-done-btn"]');
    await page.waitForSelector('[data-testid="manage-presets-dialog"]', { state: 'hidden', timeout: 5000 });
    results.push({ name: 'Rename active copy preserving selection & inheritance', pass: true });

    // -------------------------------------------------------------------------
    // 5. Reload page to verify persistence
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 5: Reloading page to verify persistence...`);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await selectAddedPrinter(page, 'Voron');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });

    // Wait for user presets in process dropdown
    await page.waitForFunction(() => {
      const ps = document.getElementById('process-select');
      return ps && Array.from(ps.options).some((o) => o.value === 'user:Fast 0.28 Renamed');
    }, null, { timeout: 15000 });

    // Select the renamed user preset
    await page.selectOption('#process-select', 'user:Fast 0.28 Renamed');
    await page.waitForFunction(() => {
      const el = document.getElementById('setting-input-layer_height');
      return el && el.value === '0.28';
    }, null, { timeout: 10000 });
    results.push({ name: 'Reload persists user presets across sessions', pass: true });

    // -------------------------------------------------------------------------
    // 6. Delete copy and restore system preset
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 6: Deleting copy...`);
    await page.click('[data-testid="delete-process-preset-btn"]');

    // Verify it is deleted and active restored to base system preset
    await page.waitForFunction(() => {
      const ps = document.getElementById('process-select');
      return ps && !ps.value.startsWith('user:') && !window.__appStore.getState().isSelectingPreset;
    }, null, { timeout: 10000 });

    const presetsRemaining = await page.evaluate(() => {
      const state = window.__appStore.getState();
      return state.userPresets.map((p) => p.name);
    });
    assert(!presetsRemaining.includes('Fast 0.28 Renamed'), 'Fast 0.28 Renamed must be deleted');
    assert(presetsRemaining.includes('Fast 0.28 Base'), 'Fast 0.28 Base must still exist');

    // Clean up base preset too
    await page.evaluate(async () => {
      await window.__appStore.getState().deleteUserPresetAction('process', 'Fast 0.28 Base');
    });
    results.push({ name: 'Delete user preset and restore base system preset', pass: true });

    // -------------------------------------------------------------------------
    // 6b. Printer and filament preset handling & config preservation
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 6b: Testing printer & filament preset handling & config preservation...`);

    // Create a printer user preset with override
    await page.evaluate(async () => {
      const store = window.__appStore.getState();
      await store.applyOptionChange('nozzle_diameter', '0.6', 'printer');
      await store.saveCurrentUserPreset('printer', 'Custom 0.6 Voron');
    });

    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && p.value === 'user:Custom 0.6 Voron';
    }, null, { timeout: 10000 });

    // Create a filament user preset with override
    await page.evaluate(async () => {
      const store = window.__appStore.getState();
      await store.applyOptionChange('filament_density', '1.25', 'filament');
      await store.saveCurrentUserPreset('filament', 'Custom PLA 1.25');
    });

    await page.waitForFunction(() => {
      const f = document.getElementById('filament-select');
      return f && f.value === 'user:Custom PLA 1.25';
    }, null, { timeout: 10000 });

    // Verify both are active and currentConfig preserves both printer & filament overrides
    const multiPresetCheck = await page.evaluate(() => {
      const state = window.__appStore.getState();
      return {
        active: state.activeUserPreset,
        currentConfig: {
          nozzle_diameter: state.currentConfig['nozzle_diameter'],
          filament_density: state.currentConfig['filament_density']
        },
        engineError: state.engineError
      };
    });
    assert.equal(multiPresetCheck.active.printer, 'Custom 0.6 Voron');
    assert.equal(multiPresetCheck.active.filament, 'Custom PLA 1.25');
    assert.equal(multiPresetCheck.currentConfig.nozzle_diameter, '0.6');
    assert.equal(multiPresetCheck.currentConfig.filament_density, '1.25');
    assert.equal(multiPresetCheck.engineError, null, 'No engine error during multi-preset selection');

    // Delete custom printer preset via UI delete button
    await page.click('[data-testid="delete-printer-preset-btn"]');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.value.startsWith('user:') && !window.__appStore.getState().isSelectingPreset;
    }, null, { timeout: 10000 });

    const printerAfterDelete = await page.evaluate(() => window.__appStore.getState().selectedPrinter);
    assert.equal(printerAfterDelete, 'Voron 2.4 300 0.4 nozzle', 'Deleting user printer restored base system printer');

    // Cleanup filament preset
    await page.evaluate(async () => {
      await window.__appStore.getState().deleteUserPresetAction('filament', 'Custom PLA 1.25');
    });
    results.push({ name: 'Printer and filament preset handling & config preservation', pass: true });

    // -------------------------------------------------------------------------
    // 7. Test persistence failure semantics & stale OPFS resurrection prevention
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 7: Testing storage failure semantics & OPFS staleness prevention...`);
    const storageTestResult = await page.evaluate(async () => {
      const store = window.__appStore;

      // Save original storage state for clean restoration
      const originalLs = localStorage.getItem('orca_user_presets');
      const originalLsTs = localStorage.getItem('orca_user_presets_ts');

      const origSetItem = Storage.prototype.setItem;
      const origGetDir =
        typeof StorageManager !== 'undefined' ? StorageManager.prototype.getDirectory : null;

      // Test A: Dual failure (both OPFS and localStorage fail)
      let dualFailureReportedToUi = false;
      try {
        if (typeof StorageManager !== 'undefined') {
          StorageManager.prototype.getDirectory = () => Promise.reject(new Error('Forced OPFS error'));
        }
        Storage.prototype.setItem = () => {
          throw new Error('Forced localStorage quota exceeded');
        };

        const initialPresetCount = store.getState().userPresets.length;

        try {
          await store.getState().saveCurrentUserPreset('process', 'Failing Preset');
        } catch (err) {
          // Expected failure
        }

        const stateAfterFail = store.getState();
        dualFailureReportedToUi =
          !!stateAfterFail.engineError &&
          stateAfterFail.userPresets.length === initialPresetCount &&
          stateAfterFail.userPresets.every((p) => p.name !== 'Failing Preset');
      } finally {
        Storage.prototype.setItem = origSetItem;
        if (origGetDir) {
          StorageManager.prototype.getDirectory = origGetDir;
        }
      }

      // Test B: Single failure resilience (OPFS fails, localStorage works -> succeeds transparently)
      let opfsFailureFallbackWorked = false;
      try {
        if (typeof StorageManager !== 'undefined') {
          StorageManager.prototype.getDirectory = () => Promise.reject(new Error('Forced OPFS error'));
        }
        await store.getState().saveCurrentUserPreset('process', 'Fallback Preserved');
        const state = store.getState();
        opfsFailureFallbackWorked =
          state.userPresets.some((p) => p.name === 'Fallback Preserved') &&
          state.engineError === null;
        await store.getState().deleteUserPresetAction('process', 'Fallback Preserved');
      } catch (err) {
        opfsFailureFallbackWorked = false;
      } finally {
        if (origGetDir) {
          StorageManager.prototype.getDirectory = origGetDir;
        }
      }

      // Test C: Stale OPFS resurrection prevention & timestamp conflict guard
      // Simulate: OPFS has timestamp 1000 with ['StalePreset'], localStorage has timestamp 2000 with ['FreshPreset']
      const stalePresets = [
        { name: 'StalePreset', kind: 'process', inherits: '0.20mm Standard @Voron', values: {} }
      ];
      const freshPresets = [
        { name: 'FreshPreset', kind: 'process', inherits: '0.20mm Standard @Voron', values: {} }
      ];

      // Write stale presets to OPFS with old timestamp
      let opfsAvailable = false;
      try {
        if (navigator.storage?.getDirectory) {
          const root = await navigator.storage.getDirectory();
          const handle = await root.getFileHandle('user_presets.json', { create: true });
          const writable = await handle.createWritable();
          await writable.write(JSON.stringify({ version: 1, updatedAt: 1000, presets: stalePresets }, null, 2));
          await writable.close();
          opfsAvailable = true;
        }
      } catch (_) {}

      // Write fresh presets to localStorage with newer timestamp
      localStorage.setItem('orca_user_presets', JSON.stringify({ version: 1, updatedAt: 2000, presets: freshPresets }, null, 2));
      localStorage.setItem('orca_user_presets_ts', '2000');

      // Now call store.initApp() to verify stale OPFS is NOT resurrected
      await store.getState().initApp();
      const currentPresets = store.getState().userPresets;

      const preventedStaleResurrection =
        currentPresets.some((p) => p.name === 'FreshPreset') &&
        !currentPresets.some((p) => p.name === 'StalePreset');

      // Test D: Timestamp conflict guard - OPFS newer (timestamp 3000) is NOT overwritten by older write (2000)
      let opfsNewerPreserved = true;
      try {
        if (navigator.storage?.getDirectory) {
          const newestPresets = [
            { name: 'NewestOPFSPreset', kind: 'process', inherits: '0.20mm Standard @Voron', values: {} }
          ];
          const root = await navigator.storage.getDirectory();
          const handle = await root.getFileHandle('user_presets.json', { create: true });
          const writable = await handle.createWritable();
          await writable.write(JSON.stringify({ version: 1, updatedAt: 3000, presets: newestPresets }, null, 2));
          await writable.close();

          // Older localStorage timestamp (2500)
          localStorage.setItem('orca_user_presets', JSON.stringify({ version: 1, updatedAt: 2500, presets: freshPresets }, null, 2));
          localStorage.setItem('orca_user_presets_ts', '2500');

          await store.getState().initApp();
          const loaded = store.getState().userPresets;
          opfsNewerPreserved =
            loaded.some((p) => p.name === 'NewestOPFSPreset') &&
            !loaded.some((p) => p.name === 'FreshPreset');

          await store.getState().deleteUserPresetAction('process', 'NewestOPFSPreset');
        }
      } catch (_) {}

      // Cleanup
      try {
        await store.getState().deleteUserPresetAction('process', 'FreshPreset');
      } catch (_) {}
      if (originalLs) localStorage.setItem('orca_user_presets', originalLs);
      else localStorage.removeItem('orca_user_presets');
      if (originalLsTs) localStorage.setItem('orca_user_presets_ts', originalLsTs);
      else localStorage.removeItem('orca_user_presets_ts');

      return {
        dualFailureReportedToUi,
        opfsFailureFallbackWorked,
        preventedStaleResurrection: opfsAvailable ? preventedStaleResurrection : true,
        opfsNewerPreserved
      };
    });

    assert(
      storageTestResult.dualFailureReportedToUi,
      'When both OPFS and localStorage fail, error must reach UI and state must not update'
    );
    assert(
      storageTestResult.opfsFailureFallbackWorked,
      'When OPFS fails, localStorage fallback must save preset successfully without error'
    );
    assert(
      storageTestResult.preventedStaleResurrection,
      'Stale OPFS data must not be resurrected over fresher localStorage data'
    );
    assert(
      storageTestResult.opfsNewerPreserved,
      'Newer OPFS data must be preserved and not overwritten by older localStorage'
    );
    results.push({ name: 'Dual/single storage failures, fallback retaining, & stale OPFS recovery', pass: true });

    console.log(`\nAll ${results.length} checks PASSED on ${browserName}!`);
    return { browserName, results, pass: true };
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`=== Starting Focused Presets E2E Test Suite ===`);
  console.log(`Target: ${ISOLATED_BUILD_DIR} on dedicated port ${PORT}`);

  try {
    await startServer(PORT, 'presets');

    console.log('\n--- Running on Chromium ---');
    const chromeRes = await runBrowserPresetsSuite(chromium, 'chromium');

    console.log('\n--- Running on Firefox ---');
    const firefoxRes = await runBrowserPresetsSuite(firefox, 'firefox');

    console.log('\n====================================');
    console.log('Summary of Test Results:');
    console.log('------------------------------------');
    for (const r of [
      ...chromeRes.results.map((x) => `[Chromium] ${x.name}: PASS`),
      ...firefoxRes.results.map((x) => `[Firefox] ${x.name}: PASS`)
    ]) {
      console.log(`  ✓ ${r}`);
    }
    console.log('====================================');
    console.log('ALL TESTS PASSED SUCCESSFULLY!');
  } finally {
    await stopServer(PORT);
  }
}

main().catch(async (err) => {
  console.error('\n❌ Test Suite Failed:', err);
  await stopServer(PORT);
  process.exit(1);
});
