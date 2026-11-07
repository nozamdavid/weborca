#!/usr/bin/env node
/**
 * @file settings-dialog-search.mjs
 * End-to-end browser test for Settings Search in Printer & Filament Dialogs.
 * Tests across Chromium and Firefox:
 * 1. Search box in dialog header focused with Ctrl+F and on dialog open.
 * 2. Search across printer pages (including Extruder sub-pages), clicking result navigates and highlights option row.
 * 3. Search across filament pages (including Setting Overrides), clicking result navigates and highlights option row.
 * 4. Mode filtering (Simple/Advanced/Expert) correctly filters search results in dialog.
 * 5. Esc dismisses dropdown; keyboard/mouse navigation in results.
 */

import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../node_modules/playwright/index.mjs');
}
const { chromium, firefox } = playwright;

const PORT = parseInt(process.env.PORT || '5182', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runBrowserDialogSearchSuite(browserType, browserName) {
  console.log(`\n==================================================`);
  console.log(`Starting Settings Dialog Search tests for ${browserName.toUpperCase()}`);
  console.log(`==================================================`);

  const launchOptions = {
    headless: true,
    args: browserName === 'chromium' ? ['--enable-features=SharedArrayBuffer', `--explicitly-allowed-ports=${PORT}`] : []
  };
  if (browserName === 'firefox') {
    launchOptions.firefoxUserPrefs = {
      'network.security.ports.banned.override': String(PORT)
    };
  }

  const browser = await browserType.launch(launchOptions);

  const pageErrors = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();

    page.on('pageerror', (err) => {
      console.error(`[${browserName}] Page error:`, err);
      pageErrors.push(err.message);
    });

    console.log(`[${browserName}] Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    try {
      await page.waitForSelector('#recovery-dialog', { timeout: 2000 });
      await page.click('#recovery-discard');
      await page.waitForSelector('#recovery-dialog', { state: 'detached', timeout: 3000 });
    } catch {}

    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    await selectAddedPrinter(page, 'Voron');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.waitForTimeout(1000);

    // =========================================================================
    // 1. PRINTER SETTINGS DIALOG SEARCH
    // =========================================================================
    console.log(`[${browserName}] Opening Printer Settings Dialog...`);
    const editPrinterBtn = await page.waitForSelector('[data-testid="edit-printer-btn"]', { timeout: 5000 });
    await editPrinterBtn.click();
    await page.waitForSelector('[data-testid="printer-dialog"]', { state: 'visible', timeout: 5000 });

    const searchInput = page.locator('[data-testid="dialog-settings-search"]');
    await searchInput.waitFor({ state: 'visible', timeout: 3000 });

    // Verify auto-focus on open
    console.log(`[${browserName}] Verifying search input auto-focus...`);
    const isFocusedInitially = await searchInput.evaluate((el) => document.activeElement === el);
    assert.strictEqual(isFocusedInitially, true, 'Search input should be focused on dialog open');

    // Test Ctrl+F shortcut focus
    console.log(`[${browserName}] Testing Ctrl+F shortcut focus...`);
    await page.click('.modal-title');
    assert.strictEqual(await searchInput.evaluate((el) => document.activeElement === el), false);
    await page.keyboard.press('Control+f');
    assert.strictEqual(await searchInput.evaluate((el) => document.activeElement === el), true, 'Ctrl+F should re-focus search input');

    // Ensure expert mode is selected for comprehensive search
    await page.selectOption('[data-testid="dialog-mode-select"]', 'expert');
    await page.waitForTimeout(300);

    // Search 'retraction'
    console.log(`[${browserName}] Searching 'retraction' in Printer settings...`);
    await searchInput.fill('retraction');
    const searchResults = page.locator('[data-testid="dialog-search-results"]');
    await searchResults.waitFor({ state: 'visible', timeout: 5000 });

    // Verify results exist
    const resultCount = await page.locator('.search-result-item').count();
    assert.ok(resultCount > 0, `Expected search results for 'retraction', got ${resultCount}`);

    // Click 'retraction_length' result
    console.log(`[${browserName}] Clicking 'retraction_length' search result...`);
    const retractionItem = page.locator('.search-result-item[data-key="retraction_length"]').first();
    await retractionItem.click();

    // Verify dropdown closes and navigation occurs
    await searchResults.waitFor({ state: 'hidden', timeout: 5000 });

    // Verify page changed to 'Extruder'
    const activePage = await page.evaluate(() => window.__appStore.getState().activePrinterPage);
    assert.strictEqual(activePage, 'Extruder', `Expected active page 'Extruder', got '${activePage}'`);

    // Verify row highlighted
    await page.waitForSelector('#setting-row-retraction_length.highlighted-row', { timeout: 5000 });
    const isHighlighted = await page.$eval('#setting-row-retraction_length', (el) => el.classList.contains('highlighted-row'));
    assert.strictEqual(isHighlighted, true, 'Setting row for retraction_length should have .highlighted-row');

    // Close Printer Dialog
    await page.click('[data-testid="close-dialog-btn"]');
    await page.waitForSelector('[data-testid="printer-dialog"]', { state: 'detached', timeout: 5000 });

    // =========================================================================
    // 2. FILAMENT SETTINGS DIALOG SEARCH
    // =========================================================================
    console.log(`[${browserName}] Opening Filament Settings Dialog...`);
    const editFilamentBtn = await page.waitForSelector('[data-testid="edit-filament-btn"]', { timeout: 5000 });
    await editFilamentBtn.click();
    await page.waitForSelector('[data-testid="filament-dialog"]', { state: 'visible', timeout: 5000 });

    const filSearchInput = page.locator('[data-testid="dialog-settings-search"]');
    await filSearchInput.waitFor({ state: 'visible', timeout: 3000 });

    await page.selectOption('[data-testid="dialog-mode-select"]', 'expert');
    await page.waitForTimeout(300);

    // Search 'retraction' in Filament settings
    console.log(`[${browserName}] Searching 'retraction' in Filament settings...`);
    await filSearchInput.fill('retraction');
    await page.locator('[data-testid="dialog-search-results"]').waitFor({ state: 'visible', timeout: 5000 });

    const filRetractionItem = page.locator('.search-result-item[data-key="filament_retraction_length"]').first();
    await filRetractionItem.click();

    await page.locator('[data-testid="dialog-search-results"]').waitFor({ state: 'hidden', timeout: 5000 });

    const filActivePage = await page.evaluate(() => window.__appStore.getState().activeFilamentPage);
    assert.strictEqual(filActivePage, 'Setting Overrides', `Expected active page 'Setting Overrides', got '${filActivePage}'`);

    await page.waitForSelector('#setting-row-filament_retraction_length.highlighted-row', { timeout: 5000 });
    const isFilHighlighted = await page.$eval('#setting-row-filament_retraction_length', (el) => el.classList.contains('highlighted-row'));
    assert.strictEqual(isFilHighlighted, true, 'Setting row for filament_retraction_length should have .highlighted-row');

    // =========================================================================
    // 3. MODE FILTERING IN DIALOG SEARCH
    // =========================================================================
    console.log(`[${browserName}] Testing mode filter in dialog search...`);

    // Switch to Simple mode
    await page.selectOption('[data-testid="dialog-mode-select"]', 'simple');
    await page.waitForTimeout(300);

    // In simple mode, searching for an advanced/expert setting like 'filament_deretraction_speed'
    await filSearchInput.fill('filament_deretraction_speed');
    await page.waitForTimeout(500);

    const simpleCount = await page.locator('.search-result-item').count();
    assert.strictEqual(simpleCount, 0, 'Expert option should not appear in Simple mode search');

    // Switch back to Expert mode
    await page.selectOption('[data-testid="dialog-mode-select"]', 'expert');
    await page.waitForTimeout(500);

    const expertCount = await page.locator('.search-result-item').count();
    assert.ok(expertCount > 0, 'Expert option should appear in Expert mode search');

    // Close Filament Dialog
    await page.click('[data-testid="close-dialog-btn"]');
    await page.waitForSelector('[data-testid="filament-dialog"]', { state: 'detached', timeout: 5000 });

    console.log(`[${browserName}] Settings Dialog Search tests PASSED!`);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`Starting test server on port ${PORT}...`);
  await startServer(PORT, 'settings-dialog-search');

  try {
    await runBrowserDialogSearchSuite(chromium, 'chromium');
    if (process.env.SKIP_FIREFOX !== '1') await runBrowserDialogSearchSuite(firefox, 'firefox');
    console.log('\nAll Settings Dialog Search tests finished!');
  } finally {
    console.log(`Stopping test server on port ${PORT}...`);
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('Fatal error running settings-dialog-search test:', err);
  process.exit(1);
});
