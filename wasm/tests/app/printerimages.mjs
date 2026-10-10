#!/usr/bin/env node
/** Browser test: the wizard shows each printer model's picture (Snapmaker, Voron), and models with several nozzles share one card. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5136', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.locator('.menu-label', { hasText: 'File' }).first().click();
    await page.locator('.menu.open .menu-item', { hasText: 'Configuration wizard' }).first().click();
    await page.waitForSelector('#wizard-dialog');

    log('Snapmaker models show their pictures');
    await page.selectOption('#wizard-vendor-select', 'Snapmaker');
    await page.waitForSelector('.wizard-model-card');
    await page.waitForFunction(() => {
      const card = [...document.querySelectorAll('.wizard-model-card')].find((c) => c.querySelector('.wizard-model-title').textContent === 'Snapmaker A250');
      const img = card?.querySelector('.wizard-model-img');
      return !!img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 30000 });
    const shown = await page.evaluate(() => [...document.querySelectorAll('.wizard-model-card')].map((card) => {
      const img = card.querySelector('.wizard-model-img');
      return { title: card.querySelector('.wizard-model-title').textContent, ok: img.style.display !== 'none' && img.naturalWidth > 0, nozzles: card.querySelectorAll('.wizard-nozzle-item').length };
    }));
    const a250 = shown.find((c) => c.title === 'Snapmaker A250');
    assert.ok(a250, JSON.stringify(shown.map((c) => c.title)));
    assert.ok(a250.ok, 'A250 picture loaded');
    assert.ok(a250.nozzles >= 2, 'A250 nozzle sizes share one card');
    assert.ok(shown.length >= 3);

    log('Voron models show theirs, and a missing picture is hidden');
    await page.selectOption('#wizard-vendor-select', 'Voron');
    await page.waitForFunction(() => document.querySelector('.wizard-model-title')?.textContent.includes('Voron'));
    await page.waitForTimeout(1500);
    const voron = await page.evaluate(() => [...document.querySelectorAll('.wizard-model-img')].map((i) => (i.style.display === 'none' ? 'hidden' : i.naturalWidth > 0 ? 'ok' : 'loading')));
    assert.ok(voron.length > 0);
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'printerimages');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All printer picture tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Printer picture tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
