#!/usr/bin/env node
/**
 * @file object-merge-convert.mjs
 * Browser end-to-end fixture for normal UI multipart merge, Change Type submenu,
 * last-solid refusal, and undo/redo lifecycle.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../node_modules/playwright/index.mjs');
}
const { chromium } = playwright;

import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const PORT = parseInt(process.env.APP_TEST_PORT || process.env.PORT || '5140', 10);
const BASE_URL = process.env.APP_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;

async function runTest() {
  if (!process.env.APP_TEST_BASE_URL) {
    await startServer(PORT, 'object-merge-convert');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await context.newPage();

  page.on('pageerror', (err) => console.error('[pageerror]', err));

  try {
    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await selectAddedPrinter(page, 'Voron');

    // Load initial 20mm cube
    const cubePath = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
    await page.setInputFiles('#model-file', cubePath);
    await page.waitForFunction(() => window.__plateStore.getState().objects.length >= 1, null, { timeout: 60000 });

    // Add a second object by adding a primitive cube or duplicating
    const firstObjId = await page.evaluate(() => window.__plateStore.getState().objects[0].id);
    await page.evaluate(async (id) => {
      const plate = window.__plateStore.getState();
      const obj = plate.objects.find((o) => o.id === id);
      plate.selectObject(id, obj.instances[0].id);
      await plate.duplicateSelected();
    }, firstObjId);

    await page.waitForFunction(
      () => {
        const s = window.__plateStore.getState();
        return s.objects.length >= 2 || (s.objects.length === 1 && s.objects[0].instances.length >= 2);
      },
      null,
      { timeout: 30000 }
    );

    // Multi-select all instances across the plate
    await page.evaluate(() => {
      window.__plateStore.getState().selectAll();
    });

    const isMultiSelected = await page.evaluate(() => {
      const s = window.__plateStore.getState();
      return s.selectedObjectId !== null && s.extraSelection.length > 0;
    });
    assert.ok(isMultiSelected, 'Multiple instances should be selected');

    // Right-click the first object row in the object tree to open context menu
    const targetObjId = await page.evaluate(() => window.__plateStore.getState().selectedObjectId);
    const objectMoreBtn = page.locator(`[data-testid="object-more-btn-${targetObjId}"]`).first();
    await objectMoreBtn.click();

    const menu = page.locator('#object-list-context-menu');
    await menu.waitFor({ timeout: 10000 });

    // Verify "Merge to multipart object" item exists and is enabled
    const mergeItem = page.locator('#menu-action-merge');
    await mergeItem.waitFor({ timeout: 5000 });
    const cursor = await mergeItem.evaluate((el) => window.getComputedStyle(el).cursor);
    assert.equal(cursor, 'pointer', 'Merge item should be clickable');

    // Click Merge
    await mergeItem.click();

    // Wait for merge mutation: objects merged into single multipart object with multiple volumes
    await page.waitForFunction(
      () => {
        const s = window.__plateStore.getState();
        return s.objects.length === 1 && (s.objects[0].volumes >= 2 || s.objects[0].volumesCount >= 2);
      },
      null,
      { timeout: 30000 }
    );

    const mergedTreeObj = await page.evaluate(() => window.__objectListStore.getState().objects[0]);
    assert.ok(mergedTreeObj, 'Merged object should be present in object tree');
    assert.ok(mergedTreeObj.volumes.length >= 2, 'Merged object should have at least 2 separate volumes');

    const vol0 = mergedTreeObj.volumes[0];
    const vol1 = mergedTreeObj.volumes[1];
    assert.equal(vol0.type, 'part');
    assert.equal(vol1.type, 'part');
    console.log('PASS normal UI merge into multipart object with separate volumes');

    // Test Change Type submenu on volume 1 (convert part -> negative)
    const vol1MoreBtn = page.locator(`[data-testid="volume-more-btn-${vol1.id}"]`).first();
    await vol1MoreBtn.click();
    await page.locator('#object-list-context-menu').waitFor();

    const changeTypeItem = page.locator('#menu-item-change-type');
    await changeTypeItem.waitFor();
    await changeTypeItem.hover();

    const changeTypeSubmenu = page.locator('#submenu-change-type');
    await changeTypeSubmenu.waitFor({ timeout: 5000 });

    const negTypeAction = page.locator('#menu-action-type-negative');
    await negTypeAction.waitFor();
    await negTypeAction.click();

    // Verify volume 1 type changed to 'negative'
    await page.waitForFunction(
      (id) => {
        const obj = window.__objectListStore.getState().objects[0];
        return obj?.volumes?.find((v) => v.id === id)?.type === 'negative';
      },
      vol1.id,
      { timeout: 15000 }
    );
    console.log('PASS Change Type submenu converted volume to negative');

    // Test refusal on last solid part (volume 0 is now the only solid 'part')
    const vol0MoreBtn = page.locator(`[data-testid="volume-more-btn-${vol0.id}"]`).first();
    await vol0MoreBtn.click();
    await page.locator('#object-list-context-menu').waitFor();

    await page.locator('#menu-item-change-type').hover();
    await page.locator('#submenu-change-type').waitFor({ timeout: 5000 });

    const disabledNegAction = page.locator('#menu-action-type-negative');
    const disabledCursor = await disabledNegAction.evaluate((el) => window.getComputedStyle(el).cursor);
    const disabledTitle = await disabledNegAction.getAttribute('title');
    assert.equal(disabledCursor, 'not-allowed', 'Converting last solid part must be disabled');
    assert.ok(
      disabledTitle && disabledTitle.includes('last solid object part cannot be changed'),
      'Must provide refusal reason on last solid part'
    );

    // Clicking disabled option must not change type
    await disabledNegAction.click({ force: true });
    const vol0TypeAfter = await page.evaluate(() => window.__objectListStore.getState().objects[0]?.volumes[0]?.type);
    assert.equal(vol0TypeAfter, 'part', 'Last solid part must remain a part');
    await page.keyboard.press('Escape');
    console.log('PASS last solid part refusal with reason');

    // Test Undo volume type conversion
    await page.evaluate(async () => {
      await window.__historyStore.getState().undo();
    });
    await page.waitForFunction(
      (id) => {
        const obj = window.__objectListStore.getState().objects[0];
        const v = obj?.volumes?.find((vol) => vol.id === id) || obj?.volumes?.[1]; return v?.type === "part";
      },
      vol1.id,
      { timeout: 15000 }
    );
    console.log('PASS undo reverted volume type to part');

    // Test Undo merge
    await page.evaluate(async () => {
      await window.__historyStore.getState().undo();
    });
    await page.waitForFunction(
      () => {
        const s = window.__plateStore.getState();
        return s.objects.length >= 2 || (s.objects.length === 1 && s.objects[0].instances.length >= 2);
      },
      null,
      { timeout: 15000 }
    );
    console.log('PASS undo unmerged objects back to original separate state');

    // Test Redo merge
    await page.evaluate(async () => {
      await window.__historyStore.getState().redo();
    });
    await page.waitForFunction(
      () => {
        const s = window.__plateStore.getState();
        return s.objects.length === 1 && (s.objects[0].volumes >= 2 || s.objects[0].volumesCount >= 2);
      },
      null,
      { timeout: 15000 }
    );
    console.log('PASS redo restored merged multipart object');
  } finally {
    await browser.close();
    if (!process.env.APP_TEST_BASE_URL) {
      await stopServer(PORT);
    }
  }
}

// When invoked directly via CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runTest().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

export { runTest };
