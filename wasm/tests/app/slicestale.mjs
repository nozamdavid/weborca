#!/usr/bin/env node
/** Browser test: changing a setting drops a finished slice, and cancels one in progress, so the user has to slice again. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5142', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/data/20mm_cube.obj');

async function runSuite(browserType, name) {
  const browser = await browserType.launch({ args: ['--enable-features=SharedArrayBuffer'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const state = () => page.evaluate(() => { const s = window.__appStore.getState(); return { sliced: !!s.sliceResult, slicing: s.isSlicing }; });

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.waitForFunction(() => document.getElementById('vendor-select')?.options.length > 1);
    await page.selectOption('#vendor-select', 'Voron');
    await page.waitForFunction(() => Array.from(document.getElementById('printer-select')?.options ?? []).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle'));
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.waitForFunction(() => Array.from(document.getElementById('process-select')?.options ?? []).some((o) => o.value === '0.20mm Standard @Voron'));
    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.setInputFiles('#model-file', CUBE);
    await page.waitForFunction(() => document.getElementById('slice-btn') && !document.getElementById('slice-btn').disabled);

    log('a finished slice is dropped when a process setting changes');
    await page.click('#slice-btn');
    await page.waitForFunction(() => !window.__appStore.getState().isSlicing && window.__appStore.getState().sliceResult, null, { timeout: 180000 });
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('layer_height', '0.16', 'print'));
    await page.waitForFunction(() => !window.__appStore.getState().sliceResult);
    assert.deepEqual(await state(), { sliced: false, slicing: false });

    log('a slice in progress is cancelled by a setting change');
    await page.click('#tab-prepare').catch(() => {});
    await page.click('#slice-btn');
    await page.waitForFunction(() => window.__appStore.getState().isSlicing);
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('layer_height', '0.12', 'print'));
    await page.waitForFunction(() => !window.__appStore.getState().isSlicing, null, { timeout: 60000 });
    assert.equal((await state()).sliced, false);
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'slicestale');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All slice staleness tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Slice staleness tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
