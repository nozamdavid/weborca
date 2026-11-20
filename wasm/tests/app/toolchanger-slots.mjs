#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5225);
const externalUrl = process.env.APP_TEST_URL;
if (!externalUrl) await startServer(port, 'toolchanger-slots');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(externalUrl || `http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  await page.evaluate(async () => {
    await window.__appStore.getState().chooseVendor('Snapmaker');
    await window.__appStore.getState().choosePrinter('Snapmaker U1 (0.4 nozzle)');
  });
  const state = () => page.evaluate(() => {
    const s = window.__appStore.getState();
    return { slots: s.selectedFilaments.length, error: s.engineError };
  });
  assert.deepEqual(await state(), { slots: 4, error: null }, 'U1 selection exposes all four native slots');
  assert.equal(await page.locator('#remove-filament-btn').isDisabled(), true);
  await page.evaluate(() => window.__appStore.getState().removeFilamentSlot());
  assert.deepEqual(await state(), { slots: 4, error: null }, 'direct removal respects the physical nozzle minimum');
  await page.evaluate(() => window.__appStore.getState().saveCurrentUserPreset('printer', 'U1 slot regression'));
  await page.evaluate(async () => {
    await window.__appStore.getState().chooseVendor('Voron');
    await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
    await window.__appStore.getState().selectUserPreset('printer', 'U1 slot regression');
  });
  assert.deepEqual(await state(), { slots: 4, error: null }, 'user printer selection restores the physical slot minimum');
  assert.equal(await page.locator('#remove-filament-btn').isDisabled(), true);
  // Single nozzle printers still permit adding and removing material slots.
  await page.evaluate(async () => {
    await window.__appStore.getState().chooseVendor('Voron');
    await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
    await window.__appStore.getState().addFilamentSlot();
  });
  assert.deepEqual(await state(), { slots: 2, error: null });
  await page.click('#remove-filament-btn');
  await page.waitForFunction(() => window.__appStore.getState().selectedFilaments.length === 1);
  assert.deepEqual(await state(), { slots: 1, error: null });
  console.log('Toolchanger slot regression passed');
} finally {
  await browser.close();
  if (!externalUrl) await stopServer(port);
}
