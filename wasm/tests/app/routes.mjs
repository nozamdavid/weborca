#!/usr/bin/env node
/** Browser test of the tab address: each tab has a path, reloads and Back/Forward keep it, unknown paths open Prepare. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5132', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const ready = () => page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  const visible = async () => page.evaluate(() => [...document.querySelectorAll('.tab-page')].findIndex((e) => !e.hidden));
  const path = () => page.evaluate(() => window.location.pathname);

  try {
    await page.goto(BASE_URL);
    await ready();
    assert.equal(await visible(), 0);

    log('clicking a tab puts it in the address');
    await page.locator('.tab', { hasText: 'Device' }).first().click().catch(async () => page.getByText('Device', { exact: true }).first().click());
    assert.equal(await path(), '/device');
    assert.equal(await visible(), 2);

    log('a reload stays on the tab');
    await page.reload();
    await ready();
    assert.equal(await path(), '/device');
    assert.equal(await visible(), 2);

    log('Back returns to the previous tab');
    await page.goBack();
    await page.waitForFunction(() => window.location.pathname !== '/device');
    assert.equal(await visible(), 0);

    log('each path opens its tab directly, and an unknown path opens Prepare');
    for (const [p, index] of [['/calibration', 0], ['/preview', 1], ['/nothing-here', 0]]) {
      await page.goto(`${BASE_URL}${p}`);
      await ready();
      assert.equal(await visible(), index, p);
      if (p === '/calibration') assert.equal(await path(), '/prepare');
    }
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'routes');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All route tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Route tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
