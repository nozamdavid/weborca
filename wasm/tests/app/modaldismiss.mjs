#!/usr/bin/env node
/** Browser test of dialog dismissal: Escape and a click outside close a dialog, and unsaved edits ask first in an in-app modal. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5141', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  page.on('dialog', (d) => { throw new Error('browser dialog used: ' + d.message()); });
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const dlg = page.locator('#printer-connection-dialog');
  const confirm = page.locator('[data-testid=confirm-dialog]');
  const openPrinter = () => page.evaluate(() => window.__printerStore.getState().openDialog(null));
  const outside = () => page.mouse.click(5, 5);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    log('Escape closes an untouched dialog');
    await openPrinter();
    await dlg.waitFor();
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached' });

    log('a click outside closes it too');
    await openPrinter();
    await dlg.waitFor();
    await outside();
    await dlg.waitFor({ state: 'detached' });

    log('a click inside does not');
    await openPrinter();
    await dlg.waitFor();
    await dlg.locator('h3').click();
    assert.equal(await dlg.count(), 1);

    log('an edited dialog asks before closing; keeping it leaves the edit');
    await dlg.locator('input').first().fill('My printer');
    await page.keyboard.press('Escape');
    await confirm.waitFor();
    assert.equal(await dlg.count(), 1);
    await page.click('[data-testid=confirm-cancel]');
    await confirm.waitFor({ state: 'detached' });
    assert.equal(await dlg.locator('input').first().inputValue(), 'My printer');

    log('Escape on the question keeps editing as well');
    await outside();
    await confirm.waitFor();
    await page.keyboard.press('Escape');
    await confirm.waitFor({ state: 'detached' });
    assert.equal(await dlg.count(), 1);

    log('discarding closes the dialog');
    await outside();
    await confirm.waitFor();
    await page.click('[data-testid=confirm-ok]');
    await dlg.waitFor({ state: 'detached' });
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'modaldismiss');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All modal dismissal tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Modal dismissal tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
