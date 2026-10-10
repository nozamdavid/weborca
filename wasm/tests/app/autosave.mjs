#!/usr/bin/env node
/** Browser test of autosave and recovery: a backup is offered after a reload, restores the objects, and Discard drops it. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5118', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const ready = async () => {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  };

  try {
    await ready();
    assert.equal(await page.locator('#recovery-dialog').count(), 0, 'nothing to recover on a fresh start');

    log('an empty plate writes no backup');
    assert.equal(await page.evaluate(() => window.__autosave.writeAutosave()), false);

    log('a plate with an object is backed up');
    await page.mouse.click(1000, 300, { button: 'right' });
    await page.hover('#plate-menu-primitive');
    await page.click('#plate-menu-cube');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1, null, { timeout: 120000 });
    assert.equal(await page.evaluate(() => window.__autosave.writeAutosave()), true);

    log('after a reload the backup is offered and restores the object');
    await ready();
    await page.waitForSelector('#recovery-dialog');
    assert.match(await page.locator('#recovery-dialog').innerText(), /1 object/);
    await page.click('#recovery-restore');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1, null, { timeout: 60000 });
    await page.waitForSelector('#recovery-dialog', { state: 'detached' });

    log('Discard removes the backup');
    assert.equal(await page.evaluate(() => window.__autosave.writeAutosave()), true);
    await ready();
    await page.waitForSelector('#recovery-dialog');
    await page.click('#recovery-discard');
    await page.waitForSelector('#recovery-dialog', { state: 'detached' });
    assert.equal(await page.evaluate(() => window.__autosave.readAutosave()), undefined);
    await ready();
    assert.equal(await page.locator('#recovery-dialog').count(), 0);
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'autosave');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All autosave tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Autosave tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
