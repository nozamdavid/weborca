#!/usr/bin/env node
/**
 * @file calibration.mjs
 * End-to-end browser test for OrcaSlicer Web Flow Rate Calibration (Pass 1 & Pass 2).
 *
 * Verifies sequentially across Chromium and Firefox:
 * 1. Initial configuration and model import (20mm cube).
 * 2. Cancellation preserving the original project untouched on the build plate.
 * 3. Injected saveProject failure before model replacement: fail-closed preserves project & loadModel not called.
 * 4. Rollback on failure after model replacement restoring original objects and config.
 * 5. Flow rate Pass 1 generation and per-object modifiers/config readback:
 *    - 9 chips (-20% to +20% in steps of 5%)
 *    - print_flow_ratio = 1.0 + modifier / 100
 *    - wall_loops = 1, sparse_infill_density = 35%
 *    - native speed override readback (internal_solid_infill_speed, top_surface_speed)
 *    - app currentConfig synchronized and not stale
 * 6. Undo restoring the original project untouched.
 * 7. Flow rate Pass 2 generation and per-object modifiers/config readback:
 *    - 10 chips (0% to -9% in steps of 1%)
 *    - print_flow_ratio = 1.0 + modifier / 100
 *    - native speed overrides and config agreement
 * 8. Flow rate calculator evaluation & validation:
 *    - range checks guarding invalid modifiers and non-positive flow
 *    - formula: oldFlow * (100 + modifier) / 100
 *    - applying calculated ratio without mutating system presets
 * 9. Successful calibration plate slicing producing real G-code with expected 10 layers.
 * 10. Non-0.4 nozzle scaling and preserved first-layer settings:
 *    - 0.6 nozzle with custom preserved first layer yields scaling and exactly 10 layers
 *    - 0.8 large nozzle enlarges XY (> 1.2 threshold) and scales Z
 */

import http from 'node:http';
import path from 'node:path';
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

const PORT = parseInt(process.env.PORT || '5095', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ISOLATED_BUILD_DIR = process.env.APP_TEST_DIST || path.resolve(repoRoot, 'wasm/build/ui-calibration-dist');
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');

async function runCalibrationSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Flow Rate Calibration tests for ${browserName.toUpperCase()}`);
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
  page.on('console', (msg) => console.log(`[${browserName} console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => console.error(`[${browserName} error]`, err));

  const results = [];

  try {
    // -------------------------------------------------------------------------
    // Step 1: Navigate to page and initialize engine
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 1: Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });
    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    console.log(`[${browserName}] window.crossOriginIsolated = ${isIsolated}`);
    if (!isIsolated) {
      console.log(`[${browserName}] Body HTML:`, await page.evaluate(() => document.body.innerHTML));
    }

    await selectAddedPrinter(page, 'Voron');

    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    await page.waitForFunction(() => {
      const proc = document.getElementById('process-select');
      const fil = document.getElementById('filament-select');
      return proc && !proc.disabled && proc.options.length > 0 &&
             fil && !fil.disabled && fil.options.length > 0;
    }, null, { timeout: 15000 });

    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.selectOption('#filament-select', 'Generic PLA @System');

    results.push({ name: 'Page loaded & engine initialized', pass: true });

    // -------------------------------------------------------------------------
    // Step 2: Import baseline model (20mm cube)
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 2: Importing initial model (20mm_cube.obj)...`);
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);

    await page.waitForFunction(() => {
      const plate = window.__plateStore?.getState();
      return plate && plate.objects.length === 1;
    }, null, { timeout: 15000 });

    const initialObjName = await page.evaluate(() => window.__plateStore?.getState().objects[0].name);
    console.log(`[${browserName}] Baseline object on plate: "${initialObjName}"`);
    assert.ok(initialObjName.includes('cube'), 'Initial object must be the loaded cube');
    results.push({ name: 'Baseline model loaded onto plate', pass: true });

    // -------------------------------------------------------------------------
    // Step 3: Cancellation preserving original project
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 3: Verifying cancellation preserves original project...`);
    await page.click('#tab-calibration'); await page.click('#calibration-btn');
    await page.waitForSelector('#calibration-dialog', { state: 'visible', timeout: 5000 });

    // Click Generate -> triggers confirmation prompt because plate has objects
    await page.click('#calib-generate-btn');
    await page.waitForSelector('#calib-confirm-proceed', { state: 'visible', timeout: 5000 });

    // Click Cancel on replacement confirmation
    await page.click('#calib-confirm-cancel');
    await page.waitForTimeout(300);

    // Verify plate still has exactly the original cube
    const cancelObjCount = await page.evaluate(() => window.__plateStore?.getState().objects.length);
    const cancelObjName = await page.evaluate(() => window.__plateStore?.getState().objects[0]?.name);
    assert.equal(cancelObjCount, 1, 'Plate object count must remain 1 after cancellation');
    assert.equal(cancelObjName, initialObjName, 'Plate object must remain the original cube after cancellation');

    // Close calibration dialog
    await page.click('[data-testid="calib-close-btn"]');
    await page.waitForSelector('#calibration-dialog', { state: 'hidden', timeout: 5000 });
    results.push({ name: 'Cancellation preserved original project', pass: true });

    // -------------------------------------------------------------------------
    // Step 3a: Injected saveProject failure before model replacement (fail-closed)
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 3a: Verifying fail-closed check on saveProject snapshot failure...`);
    const preSaveFailConfig = await page.evaluate(() => ({ ...window.__appStore?.getState().currentConfig }));
    const preSaveFailProcessOverrides = await page.evaluate(() => ({ ...window.__appStore?.getState().processOverrides }));
    const preSaveFailObjs = await page.evaluate(() => window.__plateStore?.getState().objects);
    assert.equal(preSaveFailObjs.length, 1, 'Plate should have 1 object before failed snapshot attempt');

    // Open calibration dialog
    await page.click('#tab-calibration'); await page.click('#calibration-btn');
    await page.waitForSelector('#calibration-dialog', { state: 'visible', timeout: 5000 });

    // Inject temporary failure into engine saveProject and monitor loadModel
    await page.evaluate(() => {
      window.__loadModelCalled = false;
      const origLoadModel = window.__orcaEngine.loadModel;
      window.__orcaEngine.__origLoadModel = origLoadModel;
      window.__orcaEngine.loadModel = async (...args) => {
        window.__loadModelCalled = true;
        return origLoadModel.apply(window.__orcaEngine, args);
      };

      const origCall = window.__orcaEngine.call;
      window.__orcaEngine.__origCall = origCall;
      window.__orcaEngine.call = async (method, params) => {
        if (method === 'saveProject') {
          throw new Error('Simulated saveProject snapshot failure before calibration');
        }
        return origCall.call(window.__orcaEngine, method, params);
      };
    });

    // Attempt generation
    await page.click('#calib-generate-btn');
    await page.waitForSelector('#calib-confirm-proceed', { state: 'visible', timeout: 5000 });
    await page.click('#calib-confirm-proceed');

    // Wait for error banner in modal
    await page.waitForSelector('[data-testid="calib-error-message"]', { state: 'visible', timeout: 15000 });
    const saveFailErrorMsg = await page.textContent('[data-testid="calib-error-message"]');
    console.log(`[${browserName}] Fail-closed triggered with error: "${saveFailErrorMsg?.trim()}"`);
    assert.ok(
      saveFailErrorMsg?.includes('Failed to create project snapshot backup') ||
      saveFailErrorMsg?.includes('Simulated saveProject snapshot failure'),
      'Must display failure message explaining project backup failure'
    );

    // Verify loadModel was NOT called
    const loadModelCalled = await page.evaluate(() => window.__loadModelCalled);
    assert.equal(loadModelCalled, false, 'loadModel must NOT be called when project snapshot fails');

    // Restore engine methods
    await page.evaluate(() => {
      window.__orcaEngine.call = window.__orcaEngine.__origCall;
      delete window.__orcaEngine.__origCall;
      window.__orcaEngine.loadModel = window.__orcaEngine.__origLoadModel;
      delete window.__orcaEngine.__origLoadModel;
      delete window.__loadModelCalled;
    });

    // Close dialog
    await page.click('[data-testid="calib-close-btn"]');
    await page.waitForSelector('#calibration-dialog', { state: 'hidden', timeout: 5000 });

    // Prove original objects and config retained untouched
    const postSaveFailPlateObjs = await page.evaluate(() => window.__plateStore?.getState().objects);
    const postSaveFailEngineObjs = await page.evaluate(async () => await window.__orcaEngine.listObjects());
    assert.equal(postSaveFailPlateObjs.length, 1, 'Plate objects must remain 1');
    assert.equal(postSaveFailEngineObjs.length, 1, 'Engine objects must remain 1');
    assert.equal(postSaveFailPlateObjs[0].name, initialObjName, 'Plate object must remain the original cube');
    assert.equal(postSaveFailEngineObjs[0].name, initialObjName, 'Engine object must remain the original cube');

    const postSaveFailConfig = await page.evaluate(() => window.__appStore?.getState().currentConfig);
    const postSaveFailEngineConfig = await page.evaluate(async () => await window.__orcaEngine.getConfig());
    assert.equal(
      postSaveFailConfig['layer_height'],
      preSaveFailConfig['layer_height'],
      'App config layer_height must remain untouched'
    );
    assert.equal(
      postSaveFailEngineConfig['layer_height'],
      preSaveFailConfig['layer_height'],
      'Engine config layer_height must remain untouched'
    );

    const postSaveFailProcessOverrides = await page.evaluate(() => window.__appStore?.getState().processOverrides);
    assert.deepEqual(
      postSaveFailProcessOverrides,
      preSaveFailProcessOverrides,
      'App processOverrides must remain untouched'
    );

    results.push({ name: 'Fail-closed on saveProject snapshot failure: loadModel not called & project retained', pass: true });

    // -------------------------------------------------------------------------
    // Step 3b: Rollback on failure after model replacement
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 3b: Verifying rollback on failure after model replacement...`);
    const preFailConfig = await page.evaluate(() => ({ ...window.__appStore?.getState().currentConfig }));
    const preFailProcessOverrides = await page.evaluate(() => ({ ...window.__appStore?.getState().processOverrides }));
    const preFailObjs = await page.evaluate(() => window.__plateStore?.getState().objects);
    assert.equal(preFailObjs.length, 1, 'Plate should have 1 object before failed calibration');

    // Open calibration dialog
    await page.click('#tab-calibration'); await page.click('#calibration-btn');
    await page.waitForSelector('#calibration-dialog', { state: 'visible', timeout: 5000 });

    // Inject temporary failure into engine setObjectConfig (triggers after loadModel replaces plate)
    await page.evaluate(() => {
      const orig = window.__orcaEngine.setObjectConfig;
      window.__orcaEngine.__origSetObjectConfig = orig;
      window.__orcaEngine.setObjectConfig = async () => {
        throw new Error('Simulated setObjectConfig failure after model replacement');
      };
    });

    // Attempt generation
    await page.click('#calib-generate-btn');
    await page.waitForSelector('#calib-confirm-proceed', { state: 'visible', timeout: 5000 });
    await page.click('#calib-confirm-proceed');

    // Wait for error banner in modal
    await page.waitForSelector('[data-testid="calib-error-message"]', { state: 'visible', timeout: 15000 });
    const errorMsg = await page.textContent('[data-testid="calib-error-message"]');
    console.log(`[${browserName}] Rollback triggered with error: "${errorMsg?.trim()}"`);
    assert.ok(errorMsg?.includes('Simulated setObjectConfig failure'), 'Must display the injected error message');

    // Restore engine method
    await page.evaluate(() => {
      window.__orcaEngine.setObjectConfig = window.__orcaEngine.__origSetObjectConfig;
      delete window.__orcaEngine.__origSetObjectConfig;
    });

    // Close dialog
    await page.click('[data-testid="calib-close-btn"]');
    await page.waitForSelector('#calibration-dialog', { state: 'hidden', timeout: 5000 });

    // Prove original objects and config restored, and app state & engine state agree
    const postFailPlateObjs = await page.evaluate(() => window.__plateStore?.getState().objects);
    const postFailEngineObjs = await page.evaluate(async () => await window.__orcaEngine.listObjects());
    assert.equal(postFailPlateObjs.length, 1, 'Plate objects must be restored to 1');
    assert.equal(postFailEngineObjs.length, 1, 'Engine objects must be restored to 1');
    assert.equal(postFailPlateObjs[0].name, initialObjName, 'Plate object must be the original cube');
    assert.equal(postFailEngineObjs[0].name, initialObjName, 'Engine object must be the original cube');

    const postFailConfig = await page.evaluate(() => window.__appStore?.getState().currentConfig);
    const postFailEngineConfig = await page.evaluate(async () => await window.__orcaEngine.getConfig());
    assert.equal(
      postFailConfig['layer_height'],
      preFailConfig['layer_height'],
      'App config layer_height must be restored after failed calibration'
    );
    assert.equal(
      postFailEngineConfig['layer_height'],
      preFailConfig['layer_height'],
      'Engine config layer_height must be restored after failed calibration'
    );

    const postFailProcessOverrides = await page.evaluate(() => window.__appStore?.getState().processOverrides);
    assert.deepEqual(
      postFailProcessOverrides,
      preFailProcessOverrides,
      'App processOverrides must be restored after failed calibration'
    );

    results.push({ name: 'Failure after model replacement rolled back project & config cleanly', pass: true });

    // -------------------------------------------------------------------------
    // Step 4: Pass 1 Calibration Generation & Config Readback
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 4: Generating Flow Rate Pass 1...`);
    await page.click('#tab-calibration'); await page.click('#calibration-btn');
    await page.waitForSelector('#calibration-dialog', { state: 'visible', timeout: 5000 });

    // Ensure Pass 1 is selected
    await page.click('[data-testid="calib-pass1-btn"]');
    await page.click('#calib-generate-btn');
    await page.waitForSelector('#calib-confirm-proceed', { state: 'visible', timeout: 5000 });

    // Confirm replacement
    await page.click('#calib-confirm-proceed');

    // Wait for Pass 1 calibration to complete and chips to load in plateStore (9 objects)
    await page.waitForFunction(() => {
      const calib = window.__calibrationStore?.getState();
      const plate = window.__plateStore?.getState();
      return calib && !calib.isCalibrating && !calib.isOpen && plate && plate.objects.length === 9;
    }, null, { timeout: 20000 });

    console.log(`[${browserName}] Pass 1 generated with 9 test chips.`);

    // Read back config overrides from engine object tree
    const pass1Tree = await page.evaluate(async () => {
      return await window.__orcaEngine.getObjectTree();
    });

    assert.equal(pass1Tree.objects.length, 9, 'Engine object tree must have 9 objects for Pass 1');

    const expectedPass1Modifiers = {
      flowrate_0: '1.0000',
      flowrate_5: '1.0500',
      flowrate_10: '1.1000',
      flowrate_15: '1.1500',
      flowrate_20: '1.2000',
      flowrate_m5: '0.9500',
      flowrate_m10: '0.9000',
      flowrate_m15: '0.8500',
      flowrate_m20: '0.8000'
    };

    for (const obj of pass1Tree.objects) {
      const expectedRatio = expectedPass1Modifiers[obj.name];
      assert.ok(expectedRatio, `Unknown Pass 1 object name: ${obj.name}`);
      assert.equal(
        obj.config?.print_flow_ratio ? parseFloat(obj.config.print_flow_ratio).toFixed(4) : undefined,
        expectedRatio,
        `Object ${obj.name} must have print_flow_ratio = ${expectedRatio}`
      );
      assert.equal(obj.config?.wall_loops, '1', `Object ${obj.name} must have wall_loops = 1`);
      assert.equal(obj.config?.sparse_infill_density, '35%', `Object ${obj.name} must have sparse_infill_density = 35%`);

      // Native speed override readback
      assert.ok(obj.config?.internal_solid_infill_speed, `Object ${obj.name} must have internal_solid_infill_speed override`);
      assert.ok(obj.config?.top_surface_speed, `Object ${obj.name} must have top_surface_speed override`);
      const internalSpeed = parseInt(obj.config.internal_solid_infill_speed, 10);
      const topSpeed = parseInt(obj.config.top_surface_speed, 10);
      assert.ok(internalSpeed > 0 && internalSpeed <= 200, `internal_solid_infill_speed must be positive <= 200, got ${internalSpeed}`);
      assert.ok(topSpeed > 0 && topSpeed <= 150, `top_surface_speed must be positive <= 150, got ${topSpeed}`);
    }

    // Verify appStore currentConfig was synchronized and matches engineConfig
    const appConfigPass1 = await page.evaluate(() => window.__appStore?.getState().currentConfig);
    const engineConfigPass1 = await page.evaluate(async () => await window.__orcaEngine.getConfig());
    assert.equal(parseFloat(appConfigPass1['layer_height']), 0.2, 'appStore currentConfig layer_height must be 0.2');
    assert.equal(appConfigPass1['layer_height'], engineConfigPass1['layer_height'], 'appConfig and engineConfig must match');
    assert.equal(parseFloat(appConfigPass1['initial_layer_print_height']), 0.2, 'initial_layer_print_height must match 0.2');

    console.log(`[${browserName}] Pass 1 modifier configs and speed overrides verified successfully.`);
    results.push({ name: 'Pass 1 modifiers, configs, and native speed overrides verified', pass: true });

    // -------------------------------------------------------------------------
    // Step 5: Undo restoring original project
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 5: Verifying Undo restores original project...`);
    const canUndo = await page.evaluate(() => window.__historyStore?.getState().canUndo);
    assert.ok(canUndo, 'canUndo must be true after calibration generation');

    await page.click('#undo-btn');

    // Wait for plate objects to restore back to 1
    await page.waitForFunction(() => {
      const plate = window.__plateStore?.getState();
      return plate && plate.objects.length === 1 && !plate.isLoading;
    }, null, { timeout: 15000 });

    const restoredObjName = await page.evaluate(() => window.__plateStore?.getState().objects[0]?.name);
    assert.equal(restoredObjName, initialObjName, 'Undo must restore original model onto the plate');
    console.log(`[${browserName}] Original project "${restoredObjName}" restored successfully via Undo.`);
    results.push({ name: 'Undo restored original project', pass: true });

    // -------------------------------------------------------------------------
    // Step 6: Pass 2 Calibration Generation & Config Readback
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 6: Generating Flow Rate Pass 2...`);
    await page.click('#tab-calibration'); await page.click('#calibration-btn');
    await page.waitForSelector('#calibration-dialog', { state: 'visible', timeout: 5000 });

    // Select Pass 2
    await page.click('[data-testid="calib-pass2-btn"]');
    await page.click('#calib-generate-btn');
    await page.waitForSelector('#calib-confirm-proceed', { state: 'visible', timeout: 5000 });
    await page.click('#calib-confirm-proceed');

    // Wait for Pass 2 calibration to complete and chips to load (10 objects)
    await page.waitForFunction(() => {
      const calib = window.__calibrationStore?.getState();
      const plate = window.__plateStore?.getState();
      return calib && !calib.isCalibrating && !calib.isOpen && plate && plate.objects.length === 10;
    }, null, { timeout: 20000 });

    console.log(`[${browserName}] Pass 2 generated with 10 test chips.`);

    const pass2Tree = await page.evaluate(async () => {
      return await window.__orcaEngine.getObjectTree();
    });

    assert.equal(pass2Tree.objects.length, 10, 'Engine object tree must have 10 objects for Pass 2');

    const expectedPass2Modifiers = {
      flowrate_0: '1.0000',
      flowrate_m1: '0.9900',
      flowrate_m2: '0.9800',
      flowrate_m3: '0.9700',
      flowrate_m4: '0.9600',
      flowrate_m5: '0.9500',
      flowrate_m6: '0.9400',
      flowrate_m7: '0.9300',
      flowrate_m8: '0.9200',
      flowrate_m9: '0.9100'
    };

    for (const obj of pass2Tree.objects) {
      const expectedRatio = expectedPass2Modifiers[obj.name];
      assert.ok(expectedRatio, `Unknown Pass 2 object name: ${obj.name}`);
      assert.equal(
        obj.config?.print_flow_ratio ? parseFloat(obj.config.print_flow_ratio).toFixed(4) : undefined,
        expectedRatio,
        `Object ${obj.name} must have print_flow_ratio = ${expectedRatio}`
      );
      assert.equal(obj.config?.wall_loops, '1', `Object ${obj.name} must have wall_loops = 1`);
      assert.equal(obj.config?.sparse_infill_density, '35%', `Object ${obj.name} must have sparse_infill_density = 35%`);

      // Speed overrides present
      assert.ok(obj.config?.internal_solid_infill_speed, `Object ${obj.name} must have internal_solid_infill_speed`);
      assert.ok(obj.config?.top_surface_speed, `Object ${obj.name} must have top_surface_speed`);
    }
    console.log(`[${browserName}] Pass 2 modifier configs verified successfully.`);
    results.push({ name: 'Pass 2 modifiers and configs readback verified', pass: true });

    // -------------------------------------------------------------------------
    // Step 7: Flow Rate Calculator Validation & System Preset Preservation
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 7: Testing Flow Rate Calculator...`);
    await page.click('#tab-calibration'); await page.click('#calibration-btn');
    await page.waitForSelector('#calibration-dialog', { state: 'visible', timeout: 5000 });

    await page.click('[data-testid="calib-tab-calculator"]');

    // Test input validation: Invalid modifier (+80, outside [-50, 50])
    await page.fill('#calib-calc-modifier', '80');
    await page.waitForFunction(() => {
      const res = document.getElementById('calib-calc-result');
      const applyBtn = document.getElementById('calib-calc-apply');
      return res && res.textContent?.trim() === '--' && applyBtn && applyBtn.disabled;
    }, null, { timeout: 5000 });

    // Test input validation: Non-positive base flow (-1.0)
    await page.fill('#calib-calc-modifier', '5');
    await page.fill('#calib-calc-current', '-1.0');
    await page.waitForFunction(() => {
      const res = document.getElementById('calib-calc-result');
      const applyBtn = document.getElementById('calib-calc-apply');
      return res && res.textContent?.trim() === '--' && applyBtn && applyBtn.disabled;
    }, null, { timeout: 5000 });

    // Test valid calculation: Base 1.0, Modifier +5 -> 1.0500
    await page.fill('#calib-calc-current', '1.0');
    await page.fill('#calib-calc-modifier', '5');
    await page.waitForFunction(() => {
      const res = document.getElementById('calib-calc-result');
      return res && res.textContent?.trim() === '1.0500';
    }, null, { timeout: 5000 });

    // Test valid calculation: Base 1.0, Modifier -5 -> 0.9500
    await page.fill('#calib-calc-modifier', '-5');
    await page.waitForFunction(() => {
      const res = document.getElementById('calib-calc-result');
      return res && res.textContent?.trim() === '0.9500';
    }, null, { timeout: 5000 });

    // Apply calculated flow ratio
    await page.click('#calib-calc-apply');
    await page.waitForSelector('[data-testid="calib-calc-message"]', { state: 'visible', timeout: 5000 });

    const calcMsg = await page.textContent('[data-testid="calib-calc-message"]');
    console.log(`[${browserName}] Calculator notice: "${calcMsg?.trim()}"`);
    assert.ok(
      calcMsg?.includes('System preset') && calcMsg?.includes('unaltered'),
      'Must protect system preset from mutation while applying to session'
    );

    // Verify session config was updated
    const sessionFlowRatio = await page.evaluate(() => {
      return window.__appStore?.getState().currentConfig['filament_flow_ratio'];
    });
    assert.equal(sessionFlowRatio ? parseFloat(sessionFlowRatio).toFixed(4) : undefined, '0.9500', 'Active session flow ratio must be updated to calculated 0.9500');

    // Close modal
    await page.click('[data-testid="calib-close-btn"]');
    await page.waitForSelector('#calibration-dialog', { state: 'hidden', timeout: 5000 });
    results.push({ name: 'Calculator logic, input validation, and system preset preservation verified', pass: true });

    // -------------------------------------------------------------------------
    // Step 8: Calibration Plate Slicing producing real G-code with expected 10 layers
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 8: Slicing calibration plate...`);
    await page.click('#tab-prepare');
    await page.click('#slice-btn');

    // Wait for slicing completion
    await page.waitForFunction(() => {
      const stats = document.getElementById('stats-section');
      const sliceBtn = document.getElementById('slice-btn');
      return stats !== null && sliceBtn && !sliceBtn.disabled;
    }, null, { timeout: 60000 });

    const sliceResult = await page.evaluate(() => window.__appStore?.getState().sliceResult);
    assert.ok(sliceResult, 'sliceResult must exist after calibration slice');
    assert.ok(sliceResult.gcodeBytes > 0, `G-code bytes must be positive, got ${sliceResult.gcodeBytes}`);
    assert.equal(sliceResult.layers, 10, `Pass 2 calibration plate must yield exactly 10 layers, got ${sliceResult.layers}`);
    console.log(
      `[${browserName}] Slicing completed successfully: ${sliceResult.layers} layers, ${sliceResult.gcodeBytes} bytes G-code.`
    );
    results.push({ name: 'Successful calibration slice producing G-code with expected 10 layers', pass: true });

    // -------------------------------------------------------------------------
    // Step 9: Non-0.4 nozzle scaling and preserved first layer (10 layers)
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Step 9: Testing non-0.4 nozzle scaling and preserved first layer...`);
    // Select 0.6mm nozzle printer
    await page.click('#tab-prepare');
    await selectAddedPrinter(page, 'Voron', 'Voron 2.4 300 0.6 nozzle');
    await page.waitForTimeout(500);

    // Apply custom initial_layer_print_height = 0.35 (greater than layer_height 0.30)
    await page.evaluate(async () => {
      await window.__appStore.getState().applyOptionChange('initial_layer_print_height', '0.35', 'print');
    });

    // Generate Pass 1
    await page.click('#tab-calibration'); await page.click('#calibration-btn');
    await page.waitForSelector('#calibration-dialog', { state: 'visible', timeout: 5000 });
    await page.click('[data-testid="calib-pass1-btn"]');
    await page.click('#calib-generate-btn');
    await page.waitForSelector('#calib-confirm-proceed', { state: 'visible', timeout: 5000 });
    await page.click('#calib-confirm-proceed');

    await page.waitForFunction(() => {
      const calib = window.__calibrationStore?.getState();
      const plate = window.__plateStore?.getState();
      return calib && !calib.isCalibrating && !calib.isOpen && plate && plate.objects.length === 9;
    }, null, { timeout: 20000 });

    // Verify instance scaling:
    // nozzle = 0.6, layer_height = 0.3, first_layer = 0.35 (preserved)
    // totalHeight = 0.35 + 9 * 0.3 = 3.05 -> sz = 3.05 / 2.0 = 1.525
    // xyScale = 0.6 / 0.6 = 1.0 <= 1.2 -> sx = 1.0, sy = 1.0
    const chipScale06 = await page.evaluate(() => window.__plateStore?.getState().objects[0].instances[0].scale);
    console.log(`[${browserName}] 0.6 nozzle chip scale:`, chipScale06);
    assert.equal(chipScale06[0], 1.0, '0.6 nozzle sx must be 1.0');
    assert.equal(chipScale06[1], 1.0, '0.6 nozzle sy must be 1.0');
    assert.ok(Math.abs(chipScale06[2] - 1.525) < 0.001, `0.6 nozzle sz must be ~1.525, got ${chipScale06[2]}`);

    // Verify preserved first layer in appStore config
    const config06 = await page.evaluate(() => window.__appStore?.getState().currentConfig);
    assert.equal(parseFloat(config06['initial_layer_print_height']), 0.35, 'First layer height 0.35 must be preserved');
    assert.equal(parseFloat(config06['layer_height']), 0.3, 'Layer height must be 0.30 for 0.6 nozzle');

    // Slice to prove 10 layers with non-0.4 nozzle and preserved first layer
    await page.click('#tab-prepare');
    await page.click('#slice-btn');
    await page.waitForFunction(() => {
      const sliceBtn = document.getElementById('slice-btn');
      const stats = document.getElementById('stats-section');
      return stats !== null && sliceBtn && !sliceBtn.disabled;
    }, null, { timeout: 60000 });

    const sliceRes06 = await page.evaluate(() => window.__appStore?.getState().sliceResult);
    assert.ok(sliceRes06, 'Slice result must exist for 0.6 nozzle calibration plate');
    assert.equal(sliceRes06.layers, 10, `Non-0.4 nozzle with preserved first layer must slice to exactly 10 layers, got ${sliceRes06.layers}`);
    console.log(`[${browserName}] Non-0.4 nozzle sliced to exactly ${sliceRes06.layers} layers.`);

    // Verify 0.8 nozzle large nozzle XY enlargement (xyScale = 0.8 / 0.6 = 1.3333 > 1.2)
    console.log(`[${browserName}] Testing large nozzle XY enlargement on 0.8 nozzle...`);
    await page.click('#tab-prepare');
    await selectAddedPrinter(page, 'Voron', 'Voron 2.4 300 0.8 nozzle');
    await page.waitForTimeout(500);

    await page.click('#tab-calibration'); await page.click('#calibration-btn');
    await page.waitForSelector('#calibration-dialog', { state: 'visible', timeout: 5000 });
    await page.click('#calib-generate-btn');
    await page.waitForSelector('#calib-confirm-proceed', { state: 'visible', timeout: 5000 });
    await page.click('#calib-confirm-proceed');

    await page.waitForFunction(() => {
      const calib = window.__calibrationStore?.getState();
      const plate = window.__plateStore?.getState();
      return calib && !calib.isCalibrating && !calib.isOpen && plate && plate.objects.length === 9;
    }, null, { timeout: 20000 });

    const chipScale08 = await page.evaluate(() => window.__plateStore?.getState().objects[0].instances[0].scale);
    console.log(`[${browserName}] 0.8 nozzle chip scale:`, chipScale08);
    const expectedXyScale = 0.8 / 0.6;
    assert.ok(Math.abs(chipScale08[0] - expectedXyScale) < 0.001, `0.8 nozzle sx must enlarge to ~${expectedXyScale.toFixed(4)}, got ${chipScale08[0]}`);
    assert.ok(Math.abs(chipScale08[1] - expectedXyScale) < 0.001, `0.8 nozzle sy must enlarge to ~${expectedXyScale.toFixed(4)}, got ${chipScale08[1]}`);
    assert.ok(Math.abs(chipScale08[2] - 2.0) < 0.001, `0.8 nozzle sz must be 2.0, got ${chipScale08[2]}`);
    results.push({ name: 'Non-0.4 nozzle scaling, XY enlargement, and preserved first layer 10 layers verified', pass: true });

    console.log(`\nAll checks passed on ${browserName.toUpperCase()}!`);
    for (const r of results) {
      console.log(`  ✓ ${r.name}`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`Starting calibration end-to-end tests across Chromium and Firefox...`);
  await startServer(PORT, 'calibration');

  try {
    for (const [name, browserType] of [
      ['chromium', chromium],
      ['firefox', firefox]
    ]) {
      await runCalibrationSuite(browserType, name);
    }
    console.log(`\n==================================================`);
    console.log(`All Flow Rate Calibration tests passed on all browsers!`);
    console.log(`==================================================`);
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('\nFatal test failure:', err);
  process.exit(1);
});
