import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { controlOptions, selectControl } from './mobile-setting-coverage.mjs';

// Starts on enable_support. Walk real controls in any configured order.
export async function conditionalSupport(page, out) {
  const nativeType = () => page.evaluate(async () => (await window.__orcaEngine.call('getOption', { key: 'support_type' })).value);
  const settled = () => page.waitForFunction(() => !Object.keys(window.__appStore.getState().pendingOptions).length);
  const navigate = async id => {
    const before = await page.evaluate(() => document.querySelector('[data-mobile-key]')?.getAttribute('data-mobile-key') ?? 'review');
    await page.click(id);
    await page.waitForFunction(before => (document.querySelector('[data-mobile-key]')?.getAttribute('data-mobile-key') ?? 'review') !== before, before).catch(async error => {
      console.error('Navigation failure', { id, before, text: await page.locator('.mobile-flow').innerText() });
      await page.screenshot({ path: path.join(out, 'navigation-failure.png') });
      throw error;
    });
  };
  const review = async () => {
    for (let i = 0; i < 10 && !await page.locator('#mobile-slice').count(); i++) await navigate('#mobile-next');
    await page.waitForSelector('#mobile-slice');
  };
  const support = async () => {
    for (let i = 0; i < 10 && !await page.locator('[data-mobile-key=enable_support]').count(); i++) await navigate('#mobile-back');
    await page.waitForSelector('#setting-input-enable_support');
  };
  await page.uncheck('#setting-input-enable_support'); await settled();
  const original = await nativeType();
  await review();
  assert.equal(await page.locator('.mobile-flow code').filter({ hasText: /^support_type$/ }).count(), 0);
  assert.equal(await nativeType(), original, 'skipping support type preserves native value');
  await support();
  await page.check('#setting-input-enable_support'); await settled();
  await page.click('#mobile-next');
  const input = page.locator('#setting-input-support_type');
  await input.waitFor();
  const replacement = (await controlOptions(input)).find(value => value !== original);
  assert.ok(replacement);
  await selectControl(input, replacement); await settled();
  assert.equal(await nativeType(), replacement);
  await page.screenshot({ path: path.join(out, 'support-enabled-390.png') });
  await review();
  await support();
  await page.uncheck('#setting-input-enable_support'); await settled();
  await review();
  assert.equal(await page.locator('.mobile-flow code').filter({ hasText: /^support_type$/ }).count(), 0);
  assert.equal(await nativeType(), replacement, 'hiding selected support type never mutates it');
  await page.screenshot({ path: path.join(out, 'support-disabled-review-390.png') });
  await support();
  assert.equal(await page.isChecked('#setting-input-enable_support'), false);
  console.log('PASS conditional support: skip/review/Back/enable/select/disable/native preservation');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = path.resolve(process.env.APP_TEST_OUTPUT ?? 'wasm/build/tests-app/mobile-default-steps');
  fs.mkdirSync(out, { recursive: true });
  let browser;
  try {
    await startServer(5168, 'mobile-default-steps', { frozenDist: true });
    browser = await chromium.launch({ headless: true });
    for (const custom of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://127.0.0.1:5168' || /^\/(api|gateway|printer|cloud|device|_printer|_gw|_cloud|_orca-cloud)(\/|$)/.test(url.pathname)) return route.abort();
        if (custom && url.pathname === '/app-config.json') return route.fulfill({ json: { mobileSliceSteps: 'enable_support,support_type,infill_pattern' } });
        return route.continue();
      });
      await page.goto('http://127.0.0.1:5168');
      await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 120000 });
      await page.evaluate(async () => {
        window.__prefsStore.getState().setGeneralPref('autosave', false);
        window.__prefsStore.getState().setGeneralPref('autoSliceAfterChange', false);
        await window.__appStore.getState().chooseVendor('Voron');
        await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
      });
      await page.setInputFiles('#mobile-import', path.resolve('tests/data/20mm_cube.obj'));
      await page.waitForFunction(() => window.__appStore.getState().modelFile && !window.__appStore.getState().isModelLoading);
      await page.click('#mobile-choose-settings'); await page.click('#mobile-next');
      await page.click('#mobile-advanced-mode'); await page.click('#mobile-next'); await page.click('#mobile-next');
      if (!custom) for (const key of ['layer_height', 'wall_loops', 'sparse_infill_density', 'sparse_infill_pattern']) {
        await page.waitForSelector(`[data-mobile-key=${key}]`); await page.click('#mobile-next');
      }
      await page.waitForSelector('#setting-input-enable_support');
      const capture = path.join(out, custom ? 'custom' : 'default'); fs.mkdirSync(capture, { recursive: true });
      await conditionalSupport(page, capture);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('PASS default pattern/order and custom alias/order');
  } finally { await browser?.close(); await stopServer(5168); }
}
