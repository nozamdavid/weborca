#!/usr/bin/env node
/**
 * @file settings.mjs
 * End-to-end Playwright test suite for OrcaSlicer Web Settings UI.
 *
 * Runs against `vite preview` on port 5060 across Chromium and Firefox:
 * (a) print tab shows 6 pages and Quality groups in desktop order (layout.json);
 * (b) unchecking enable_support disables support_base_pattern, checking enables it;
 * (c) setting layer_height to 0.3 marks modified, slicing gives < 100 layers, reset restores 0.2 and 100 layers;
 * (d) turning on spiral vase shows fixes dialog, accepting applies wall_loops 1 and sparse_infill_density 0%;
 * (e) Bambu Lab X1 Carbon: scan_first_layer is visible in printer dialog, and hidden for Voron;
 * (f) save user process preset with layer_height 0.3, reload, select it, slice gives < 100 layers; delete it;
 * (g) mode switch hides advanced option in Simple mode;
 * (h) screenshots saved to wasm/build/tests-app/settings-*.png;
 * (i) settings search: whitespace closed, no-match feedback, unique keys, keyboard/mouse selection, Escape, clear.
 * Always shuts down preview server and ensures port 5060 is freed.
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

const PORT = 5060;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_MODEL_PATH = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const SCREENSHOT_DIR = path.resolve(repoRoot, 'wasm/build/tests-app');
const LAYOUT_PATH = path.resolve(repoRoot, 'wasm/build/settings/layout.json');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runBrowserSettingsSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting settings tests for ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const launchOptions = {
    headless: true,
    args: ['--enable-features=SharedArrayBuffer', '--explicitly-allowed-ports=5060']
  };
  if (browserName === 'firefox') {
    launchOptions.firefoxUserPrefs = {
      'network.security.ports.banned.override': '5060'
    };
  }
  const browser = await browserType.launch(launchOptions);

  const context = await browser.newContext();
  const page = await context.newPage();

  const results = [];

  try {
    // Navigate to page
    console.log(`[${browserName}] Step 1: Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForSelector('#recovery-dialog', { timeout: 2000 });
      await page.click('#recovery-discard');
      await page.waitForSelector('#recovery-dialog', { state: 'detached' });
    } catch {}

    // Wait for app ready

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
    // (a) Desktop order of pages and groups
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] (a) Checking print pages and Quality groups order vs layout.json...`);
    const layout = JSON.parse(fs.readFileSync(LAYOUT_PATH, 'utf8'));
    const printTab = layout.tabs.find((t) => t.id === 'print');
    const expectedPages = printTab.pages.map((p) => p.title);
    const qualityPage = printTab.pages.find((p) => p.title === 'Quality');
    const expectedQualityGroups = qualityPage.groups.map((g) => g.title);

    await page.selectOption('[data-testid="mode-select"]', 'expert');

    await page.selectOption('[data-testid="mode-select"]', 'expert');
    await page.waitForSelector('[data-testid^="page-tab-"]');
    const renderedPages = await page.$$eval('[data-testid^="page-tab-"]', (els) =>
      els.map((e) => e.querySelector('.tab-title')?.textContent?.trim() || e.textContent?.trim())
    );
    assert.deepStrictEqual(renderedPages, expectedPages, 'Print pages must match desktop layout.json');

    await page.click('[data-testid="page-tab-Quality"]');
    const renderedQualityGroups = await page.$$eval('.settings-group .group-title', (els) =>
      els.map((e) => e.textContent?.trim())
    );
    assert.deepStrictEqual(renderedQualityGroups, expectedQualityGroups, 'Quality groups must match desktop layout.json order');
    results.push({ name: '(a) Desktop Order of Pages & Groups', pass: true });

    // -------------------------------------------------------------------------
    // (b) Enable support rule toggling support_base_pattern
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] (b) Checking enable_support rule toggling support_base_pattern...`);
    await page.click('[data-testid="page-tab-Support"]');
    await page.waitForSelector('#setting-input-enable_support');

    const patternInput = await page.$('#setting-input-support_base_pattern');
    assert(patternInput, 'support_base_pattern input exists');
    let isPatternDisabled = await patternInput.isDisabled();
    assert.strictEqual(isPatternDisabled, true, 'support_base_pattern must be disabled when enable_support is 0');

    // Enable support
    await page.click('#setting-input-enable_support');
    await page.waitForFunction(() => {
      const el = document.getElementById('setting-input-support_base_pattern');
      return el && !el.disabled;
    }, null, { timeout: 5000 });
    isPatternDisabled = await patternInput.isDisabled();
    assert.strictEqual(isPatternDisabled, false, 'support_base_pattern must be enabled when enable_support is 1');

    // Disable support again
    await page.click('#setting-input-enable_support');
    await page.waitForFunction(() => {
      const el = document.getElementById('setting-input-support_base_pattern');
      return el && el.disabled;
    }, null, { timeout: 5000 });
    isPatternDisabled = await patternInput.isDisabled();
    assert.strictEqual(isPatternDisabled, true, 'support_base_pattern must be disabled when enable_support is 0 again');
    results.push({ name: '(b) Rule Toggling on enable_support', pass: true });

    // -------------------------------------------------------------------------
    // (c) Modified marker, slicing with 0.3, reset arrow restores 0.2 and 100 layers
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] (c) Testing layer_height modification, slicing, and reset arrow...`);
    await page.click('[data-testid="page-tab-Quality"]');
    await page.waitForSelector('#setting-input-layer_height');

    // Load cube model
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);
    await page.waitForFunction(() => {
      const btn = document.getElementById('slice-btn');
      return btn && !btn.disabled;
    }, null, { timeout: 15000 });

    // Set layer_height to 0.3
    await page.fill('#setting-input-layer_height', '0.3');
    await page.waitForSelector('[data-testid="reset-btn-layer_height"]', { timeout: 5000 });

    const modBadge = await page.waitForSelector('[data-testid="mod-count-Quality"]');
    assert(modBadge, 'Quality tab should display modified count badge');

    // Slice cube with 0.3 layer height
    await page.click('#slice-btn');
    await page.waitForSelector('#stat-layers', { state: 'attached', timeout: 30000 });
    const layersValModified = await page.$eval(
      '#stat-layers',
      (el) => parseInt(el.textContent?.trim() || '0', 10)
    );
    assert(layersValModified < 100, `Expected < 100 layers with 0.3mm height, got ${layersValModified}`);

    // Restore 0.2 via reset arrow
    const prepTab1 = await page.$('#tab-prepare');
    if (prepTab1) await prepTab1.click();
    await page.click('[data-testid="reset-btn-layer_height"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('setting-input-layer_height');
      return el && el.value === '0.2';
    }, null, { timeout: 5000 });

    const resetBtnAfter = await page.$('[data-testid="reset-btn-layer_height"]');
    assert.strictEqual(resetBtnAfter, null, 'Reset button must disappear once restored');

    // Slice cube again with restored 0.2
    await page.click('#slice-btn');
    await page.waitForFunction(() => { const el = document.getElementById('stat-layers'); const btn = document.getElementById('slice-btn'); return el && el.textContent?.trim() === '100' && btn && !btn.disabled; }, null, { timeout: 30000 });
    const prepTab2 = await page.$('#tab-prepare');
    if (prepTab2) await prepTab2.click();
    results.push({ name: '(c) Modified Marker, Slicing & Reset Arrow', pass: true });

    // -------------------------------------------------------------------------
    // (d) Spiral vase rule dialog & fixes application
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] (d) Testing spiral vase fixes dialog...`);
    await page.click('[data-testid="page-tab-Others"]');
    await page.waitForSelector('#setting-input-spiral_mode');

    // Enable spiral_mode
    await page.click('#setting-input-spiral_mode');
    await page.waitForSelector('[data-testid="fixes-dialog"]', { timeout: 5000 });
    const reasonText = await page.$eval('[data-testid="fix-reason"]', (el) => el.textContent);
    assert(reasonText.includes('Spiral mode only works'), 'Reason must explain spiral mode');

    // Accept fixes
    await page.click('[data-testid="fix-yes-btn"]');
    await page.waitForSelector('[data-testid="fixes-dialog"]', { state: 'hidden', timeout: 5000 });

    // Verify wall_loops applied as 1 (in Strength tab under Walls)
    await page.click('[data-testid="page-tab-Strength"]');
    await page.waitForSelector('#setting-input-wall_loops');
    await page.waitForFunction(() => {
      const el = document.getElementById('setting-input-wall_loops');
      return el && el.value === '1';
    }, null, { timeout: 10000 });
    const wallVal = await page.$eval('#setting-input-wall_loops', (el) => el.value);
    assert.strictEqual(wallVal, '1', 'wall_loops must be fixed to 1');

    // Verify sparse_infill_density applied as 0% (in Strength tab under Infill)
    await page.waitForSelector('#setting-input-sparse_infill_density');
    await page.waitForFunction(() => {
      const el = document.getElementById('setting-input-sparse_infill_density');
      return el && (el.value === '0%' || el.value === '0');
    }, null, { timeout: 10000 });
    const infillVal = await page.$eval('#setting-input-sparse_infill_density', (el) => el.value);
    assert(infillVal === '0%' || infillVal === '0', `sparse_infill_density must be fixed to 0%, got ${infillVal}`);

    // Revert spiral mode for clean state
    await page.click('[data-testid="page-tab-Others"]');
    await page.click('#setting-input-spiral_mode');
    await page.click('[data-testid="page-tab-Strength"]');
    const resetWall = await page.$('[data-testid="reset-btn-wall_loops"]');
    if (resetWall) await resetWall.click();
    const resetInfill = await page.$('[data-testid="reset-btn-sparse_infill_density"]');
    if (resetInfill) await resetInfill.click();
    results.push({ name: '(d) Spiral Vase Dialog & Fixes', pass: true });

    // -------------------------------------------------------------------------
    console.log(`[${browserName}] alternate-wall recommendations apply only the chosen branch...`);
    await page.evaluate(async () => {
      await window.__appStore.getState().applyOptionChange('spiral_mode', '0', 'print');
      await window.__appStore.getState().applyOptionChange('alternate_extra_wall', '1', 'print');
    });
    await page.click('[data-testid="fix-yes-btn"]');
    await page.waitForSelector('[data-testid="fixes-dialog"]', { state: 'detached' });
    let alternate = await page.evaluate(() => window.__orcaEngine.getConfig());
    assert.equal(alternate.ensure_vertical_shell_thickness, 'ensure_moderate');
    assert.equal(alternate.alternate_extra_wall, '1');
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('ensure_vertical_shell_thickness', 'ensure_all', 'print'));
    await page.click('[data-testid="fix-no-btn"]');
    await page.waitForSelector('[data-testid="fixes-dialog"]', { state: 'detached' });
    alternate = await page.evaluate(() => window.__orcaEngine.getConfig());
    assert.equal(alternate.ensure_vertical_shell_thickness, 'ensure_all');
    assert.equal(alternate.alternate_extra_wall, '0');
    assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);

    // (e) Bambu Lab X1 Carbon vs Voron scan_first_layer visibility in printer dialog
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] (e) Checking scan_first_layer visibility in printer dialog...`);
    // 1. Voron: scan_first_layer hidden
    await page.click('[data-testid="edit-printer-btn"]');
    await page.waitForSelector('[data-testid="printer-dialog"]', { timeout: 5000 });
    await page.click('[data-testid="dialog-tab-Basic information"]');
    const scanFirstVoron = await page.$('#setting-row-scan_first_layer');
    assert.strictEqual(scanFirstVoron, null, 'scan_first_layer must be hidden for Voron printer');
    await page.click('[data-testid="close-dialog-btn"]');
    await page.waitForSelector('[data-testid="printer-dialog"]', { state: 'hidden', timeout: 5000 });

    // 2. Bambu Lab X1 Carbon: scan_first_layer visible
    await selectAddedPrinter(page, 'BBL');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Bambu Lab X1 Carbon 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Bambu Lab X1 Carbon 0.4 nozzle');
    await page.waitForTimeout(500);

    await page.click('[data-testid="edit-printer-btn"]');
    await page.waitForSelector('[data-testid="printer-dialog"]', { timeout: 5000 });
    await page.click('[data-testid="dialog-tab-Basic information"]');
    await page.waitForSelector('#setting-row-scan_first_layer', { timeout: 5000 });
    const isScanVisible = await page.$eval('#setting-row-scan_first_layer', (el) => el !== null);
    assert.strictEqual(isScanVisible, true, 'scan_first_layer must be visible for Bambu Lab printer');

    // Save screenshot of printer dialog for (h)
    await page.locator('[data-testid="printer-dialog"]').screenshot({
      path: path.join(SCREENSHOT_DIR, 'settings-printer-dialog.png')
    });
    await page.click('[data-testid="close-dialog-btn"]');
    await page.waitForSelector('[data-testid="printer-dialog"]', { state: 'hidden', timeout: 5000 });

    // Switch back to Voron
    await selectAddedPrinter(page, 'Voron');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.waitForFunction(() => {
      const ps = document.getElementById('process-select');
      return ps && !ps.disabled && ps.value.includes('@Voron');
    }, null, { timeout: 15000 });
    results.push({ name: '(e) scan_first_layer Visibility in Printer Dialog', pass: true });

    // -------------------------------------------------------------------------
    // (f) User process preset: Save, Reload, Select, Slice < 100 layers, Delete
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] (f) Testing User Presets lifecycle...`);
    await page.click('[data-testid="page-tab-Quality"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('setting-input-layer_height');
      return el && el.value === '0.2';
    }, null, { timeout: 10000 });
    await page.fill('#setting-input-layer_height', '0.3');
    await page.waitForSelector('[data-testid="reset-btn-layer_height"]', { timeout: 5000 });

    // Open save preset dialog
    await page.click('[data-testid="save-process-btn"]');
    await page.waitForSelector('[data-testid="save-preset-dialog"]', { timeout: 5000 });
    await page.fill('[data-testid="preset-name-input"]', 'Fast 0.3 User');
    await page.click('[data-testid="save-preset-confirm-btn"]');
    await page.waitForSelector('[data-testid="save-preset-dialog"]', { state: 'hidden', timeout: 5000 });

    // Reload page
    console.log(`[${browserName}] Reloading page to verify persistence...`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    try {
      await page.waitForSelector('#recovery-dialog', { timeout: 3000 });
      await page.click('#recovery-discard');
      await page.waitForSelector('#recovery-dialog', { state: 'detached' });
    } catch {}
    await selectAddedPrinter(page, 'Voron');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });

    // Wait for user preset in process selector
    await page.waitForFunction(() => {
      const ps = document.getElementById('process-select');
      return ps && Array.from(ps.options).some((o) => o.value === 'user:Fast 0.3 User');
    }, null, { timeout: 15000 });

    // Select the user preset
    await page.selectOption('#process-select', 'user:Fast 0.3 User');
    await page.waitForFunction(() => {
      const el = document.getElementById('setting-input-layer_height');
      return el && el.value === '0.3';
    }, null, { timeout: 10000 });

    // Re-import cube model
    await page.setInputFiles('#model-file', CUBE_MODEL_PATH);
    await page.waitForFunction(() => {
      const btn = document.getElementById('slice-btn');
      return btn && !btn.disabled;
    }, null, { timeout: 15000 });

    // Slice cube with user preset
    await page.click('#slice-btn');
    await page.waitForSelector('#stat-layers', { state: 'attached', timeout: 30000 });
    await page.waitForFunction(() => !window.__appStore?.getState().isSlicing, null, { timeout: 30000 });
    const layersValUser = await page.$eval(
      '#stat-layers',
      (el) => parseInt(el.textContent?.trim() || '0', 10)
    );
    assert(layersValUser < 100, `Expected < 100 layers with user preset 0.3mm, got ${layersValUser}`);

    // Switch back to prepare and delete user preset
    await page.click('#tab-prepare');
    await page.waitForFunction(() => !document.querySelector('.tab-page.prepare-page')?.hidden, null, { timeout: 10000 });
    if (await page.evaluate(() => window.__appStore?.getState().activeUserPreset.process !== 'Fast 0.3 User')) {
      await page.selectOption('#process-select', 'user:Fast 0.3 User');
    }
    await page.waitForSelector('[data-testid="delete-process-preset-btn"]', { timeout: 10000 });
    await page.click('[data-testid="delete-process-preset-btn"]');
    await page.waitForFunction(() => {
      const ps = document.getElementById('process-select');
      return ps && !Array.from(ps.options).some((o) => o.value === 'user:Fast 0.3 User');
    }, null, { timeout: 5000 });
    results.push({ name: '(f) User Preset Persistence & Slicing', pass: true });

    // -------------------------------------------------------------------------
    // (g) Mode switch: Simple mode hides advanced option
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] (g) Testing Mode Switch (Simple / Advanced / Expert)...`);
    await page.click('[data-testid="page-tab-Quality"]');
    await page.selectOption('[data-testid="mode-select"]', 'advanced');
    await page.waitForSelector('#setting-row-initial_layer_line_width', { timeout: 5000 });

    assert.equal(await page.locator('[data-testid="settings-group-Ironing"]').count(), 1,
      'Ironing group exists before checking its removal');
    await page.selectOption('[data-testid="mode-select"]', 'expert');
    await page.waitForSelector('[data-testid="settings-group-Z contouring"]');
    assert.equal(await page.locator('[data-testid="settings-group-Z contouring"]').count(), 1,
      'Z contouring group exists before checking its removal');

    // Switch to Simple mode
    await page.selectOption('[data-testid="mode-select"]', 'simple');
    await page.waitForSelector('#setting-row-initial_layer_line_width', { state: 'detached', timeout: 5000 });
    const simpleAdvOption = await page.$('#setting-row-initial_layer_line_width');
    assert.strictEqual(simpleAdvOption, null, 'initial_layer_line_width must be hidden in Simple mode');


    // Check that empty groups are hidden in simple mode
    // (Ironing / Z contouring)
    await page.waitForSelector('[data-testid="settings-group-Ironing"]', { state: 'detached', timeout: 5000 });
    await page.waitForSelector('[data-testid="settings-group-Z contouring"]', { state: 'detached', timeout: 5000 });
    await page.click('[data-testid="page-tab-Speed"]');
    assert.equal(await page.locator('[data-testid="settings-content"]').innerText(), 'No settings available in this mode.');


    // Switch back to Advanced mode
    await page.click('[data-testid="page-tab-Quality"]');
    await page.selectOption('[data-testid="mode-select"]', 'advanced');
    await page.waitForSelector('#setting-row-initial_layer_line_width', { timeout: 5000 });
    results.push({ name: '(g) Mode Switch Filtering', pass: true });

    // -------------------------------------------------------------------------
    // (h) Screenshots
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] (h) Saving settings sidebar screenshot...`);
    await page.locator('.settings-panel').screenshot({
      path: path.join(SCREENSHOT_DIR, 'settings-sidebar.png')
    });
    results.push({ name: '(h) Screenshots Generation', pass: true });

    // -------------------------------------------------------------------------
    // (i) Search: Whitespace, no-match feedback, unique keys, keyboard/mouse selection, Escape, clear
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] (i) Testing settings search, keyboard navigation, and clear...`);
    await page.mouse.move(0, 0);
    const searchInput = page.locator('[data-testid="settings-search"]');
    const searchResults = page.locator('[data-testid="search-results"]');
    const noResults = page.locator('[data-testid="search-no-results"]');

    // 1. Whitespace search closed
    await searchInput.fill('   ');
    const isResultsVisibleWhitespace = await searchResults.isVisible().catch(() => false);
    assert.strictEqual(isResultsVisibleWhitespace, false, 'Whitespace-only search must keep dropdown closed');
    const expandedWhitespace = await searchInput.getAttribute('aria-expanded');
    assert.strictEqual(expandedWhitespace, 'false', 'aria-expanded must be false for whitespace-only query');

    // 2. No-match feedback
    await searchInput.fill('xyz_nonexistent_token');
    await searchResults.waitFor({ state: 'visible', timeout: 5000 });
    const noResultsText = await noResults.textContent();
    assert(noResultsText && noResultsText.includes('No settings found'), 'Must display no-results feedback');
    const noResultsRole = await noResults.getAttribute('role');
    assert.strictEqual(noResultsRole, 'status', 'No-results element must have role=status');

    // 3. Unique result keys
    await searchInput.fill('layer');
    await page.waitForSelector('.search-result-item', { timeout: 5000 });
    const resultItemKeys = await page.$$eval('.search-result-item', (items) =>
      items.map((it) => it.id)
    );
    assert(resultItemKeys.length > 0, 'Must have at least one search result for "layer"');
    const uniqueKeysSet = new Set(resultItemKeys);
    assert.strictEqual(uniqueKeysSet.size, resultItemKeys.length, 'Search result option IDs must be unique');

    // 4. ArrowDown / ArrowUp first/last navigation
    const count = resultItemKeys.length;
    // Press ArrowDown to select first item
    await searchInput.press('ArrowDown');
    let activeId = await searchInput.getAttribute('aria-activedescendant');
    assert.strictEqual(activeId, 'search-result-option-0', 'ArrowDown from unselected must activate first item (index 0)');

    // Press ArrowUp to wrap to last item
    await searchInput.press('ArrowUp');
    activeId = await searchInput.getAttribute('aria-activedescendant');
    assert.strictEqual(activeId, `search-result-option-${count - 1}`, 'ArrowUp from first item must wrap to last item');

    // Press ArrowDown to wrap back to first item
    await searchInput.press('ArrowDown');
    activeId = await searchInput.getAttribute('aria-activedescendant');
    assert.strictEqual(activeId, 'search-result-option-0', 'ArrowDown from last item must wrap to first item');

    // 5. Escape dismisses, then typing reopens
    await searchInput.press('Escape');
    const isVisibleAfterEsc = await searchResults.isVisible().catch(() => false);
    assert.strictEqual(isVisibleAfterEsc, false, 'Escape must dismiss search dropdown');

    await searchInput.fill('speed');
    await searchResults.waitFor({ state: 'visible', timeout: 5000 });
    const isVisibleAfterTyping = await searchResults.isVisible();
    assert.strictEqual(isVisibleAfterTyping, true, 'Typing after Escape must reopen search dropdown');

    // 6. Enter reveals target option
    await searchInput.press('ArrowDown');
    await searchInput.press('Enter');
    await searchResults.waitFor({ state: 'hidden', timeout: 5000 });
    const queryAfterEnter = await searchInput.inputValue();
    assert.strictEqual(queryAfterEnter, '', 'Enter selection must clear search input query');

    // 7. Mouse selection
    await searchInput.fill('support');
    await page.waitForSelector('.search-result-item', { timeout: 5000 });
    await page.click('.search-result-item:first-child');
    await searchResults.waitFor({ state: 'hidden', timeout: 5000 });
    const queryAfterMouse = await searchInput.inputValue();
    assert.strictEqual(queryAfterMouse, '', 'Mouse selection must clear search input query');

    // 8. Clear button preserves behavior
    await searchInput.fill('infill');
    const clearBtn = page.locator('[data-testid="search-clear-btn"]');
    await clearBtn.waitFor({ state: 'visible', timeout: 5000 });
    await clearBtn.click();
    const queryAfterClear = await searchInput.inputValue();
    assert.strictEqual(queryAfterClear, '', 'Clear button must clear search input query');
    const isResultsVisibleAfterClear = await searchResults.isVisible().catch(() => false);
    assert.strictEqual(isResultsVisibleAfterClear, false, 'Clear button must close search dropdown');
    const isInputFocused = await searchInput.evaluate((el) => el === document.activeElement);
    assert.strictEqual(isInputFocused, true, 'Clear button must return focus to search input');

    results.push({ name: '(i) Search: Whitespace, No-Match, Keys & Nav', pass: true });

  } finally {
    await browser.close();
  }

  return results;
}

async function main() {
  console.log('================================================================================');
  console.log('OrcaSlicer Web Settings Test Suite');
  console.log(`Target: Vite Preview on Port ${PORT}`);
  console.log('================================================================================\n');

  try {
    await startServer(PORT, 'settings', { frozenDist: true });

    const chromiumResults = await runBrowserSettingsSuite(chromium, 'chromium');
    const firefoxResults = await runBrowserSettingsSuite(firefox, 'firefox');

    console.log('\n================================================================================');
    console.log('SETTINGS TEST EXECUTION SUMMARY');
    console.log('================================================================================\n');

    console.log('Browser: CHROMIUM');
    for (const r of chromiumResults) {
      console.log(`  - ${r.name.padEnd(55)}: ${r.pass ? 'PASS' : 'FAIL'}`);
    }

    console.log('\nBrowser: FIREFOX');
    for (const r of firefoxResults) {
      console.log(`  - ${r.name.padEnd(55)}: ${r.pass ? 'PASS' : 'FAIL'}`);
    }

    console.log('\n================================================================================');
    console.log('All settings tests passed successfully!');
    console.log('================================================================================\n');
  } finally {
    await stopServer(PORT);
    const portCheck = execSync(`ss -ltnp | grep ${PORT} || true`).toString().trim();
    if (portCheck) {
      console.warn(`[Warning] Port ${PORT} still in use: ${portCheck}`);
    } else {
      console.log(`[Server] Confirmed port ${PORT} is completely freed.`);
    }
  }
}

main().catch((err) => {
  console.error('\nFatal error in settings test runner:', err);
  stopServer().finally(() => process.exit(1));
});
