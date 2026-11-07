#!/usr/bin/env node
/** Browser test of setting documentation links: finds a '?' link and asserts href starts with wiki URL and target=_blank. */
import assert from 'node:assert/strict';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../node_modules/playwright/index.mjs');
}
const { chromium, firefox } = playwright;

const PORT = 5143;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const launchOptions = {
    headless: true,
    args: ['--enable-features=SharedArrayBuffer', `--explicitly-allowed-ports=${PORT}`],
  };
  if (name === 'firefox') {
    launchOptions.firefoxUserPrefs = {
      'network.security.ports.banned.override': `${PORT}`,
    };
  }
  const browser = await browserType.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await selectAddedPrinter(page, 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.waitForTimeout(1000);

    log('opens settings and finds a "?" help link in setting rows');
    await page.waitForSelector('.setting-row .setting-help-link, .setting-row a:has-text("?")', { timeout: 15000 });

    const helpLinks = page.locator('.setting-row .setting-help-link, .setting-row a:has-text("?")');
    const count = await helpLinks.count();
    assert.ok(count > 0, `Expected at least one '?' help link in setting rows, found ${count}`);

    const firstLink = helpLinks.first();
    const href = await firstLink.getAttribute('href');
    const target = await firstLink.getAttribute('target');
    const rel = await firstLink.getAttribute('rel');

    log(`Found help link: href=${href}, target=${target}, rel=${rel}`);
    assert.ok(
      href && href.startsWith('https://www.orcaslicer.com/wiki'),
      `Expected href to start with https://www.orcaslicer.com/wiki, got ${href}`
    );
    assert.equal(target, '_blank', `Expected target=_blank, got ${target}`);
    assert.ok(rel && rel.includes('noopener'), `Expected rel to contain noopener, got ${rel}`);

    // Check row on Quality page (layer_height)
    const layerHeightRowLink = page.locator('#setting-row-layer_height .setting-help-link');
    await layerHeightRowLink.waitFor({ state: 'visible', timeout: 5000 });
    const lhHref = await layerHeightRowLink.getAttribute('href');
    assert.ok(
      lhHref && lhHref.startsWith('https://www.orcaslicer.com/wiki'),
      `Expected layer_height link to start with wiki URL, got ${lhHref}`
    );

    assert.equal(lhHref, 'https://www.orcaslicer.com/wiki/quality_settings_layer_height');
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'settingdocs');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All setting docs tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Setting docs tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
