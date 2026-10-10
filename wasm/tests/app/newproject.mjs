#!/usr/bin/env node
/** Browser test of File > New project: it asks first, then empties the plate and drops the extra plates. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5122', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const openFileMenu = async () => {
    await page.locator('.menu-label', { hasText: 'File' }).first().click();
    await page.waitForSelector('.menu.open .menu-popup', { state: 'visible' });
  };
  const newProject = () => page.locator('.menu.open .menu-item', { hasText: 'New project' }).first();

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    log('an empty plate has nothing to close');
    await openFileMenu();
    assert.equal(await newProject().isDisabled(), true);
    await page.keyboard.press('Escape');

    await page.mouse.click(1000, 300, { button: 'right' });
    await page.hover('#plate-menu-primitive');
    await page.click('#plate-menu-cube');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1, null, { timeout: 120000 });
    await page.click('#add-plate-btn');
    await page.waitForFunction(() => window.__platesStore.getState().plates.length === 2);

    log('declining the question keeps the project');
    await openFileMenu();
    await newProject().click();
    await page.click('[data-testid=confirm-cancel]');
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__plateStore.getState().objects.length), 1);

    log('accepting empties the plate and leaves one plate');
    await openFileMenu();
    await newProject().click();
    await page.click('[data-testid=confirm-ok]');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 0 && window.__platesStore.getState().plates.length === 1, null, { timeout: 30000 });
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'newproject');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All new project tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('New project tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
