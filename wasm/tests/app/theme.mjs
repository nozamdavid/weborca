#!/usr/bin/env node
/** Browser test of the theme preference: Light uses its own palette, the choice persists, and Follow the system tracks the OS. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5128', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 }, colorScheme: 'dark' });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const setTheme = (value) => page.evaluate((v) => window.__prefsStore.getState().setDisplayPref('theme', v), value);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    assert.equal(await theme(), 'dark');

    log('checkboxes are drawn from the palette, not natively');
    const box = await page.evaluate(() => {
      const el = document.createElement('input');
      el.type = 'checkbox';
      document.body.appendChild(el);
      const un = getComputedStyle(el);
      const off = { appearance: un.appearance, bg: un.backgroundColor };
      el.checked = true;
      const on = getComputedStyle(el).backgroundColor;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
      el.remove();
      return { off, on, accent };
    });
    assert.equal(box.off.appearance, 'none');
    assert.notEqual(box.off.bg, box.on);
    assert.equal(box.on, 'rgb(0, 150, 136)');
    assert.equal(box.accent.toLowerCase(), '#009688');

    log('Light uses a real palette and a light bed without inversion');
    await setTheme('light');
    assert.equal(await theme(), 'light');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).filter), 'none');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).backgroundColor), 'rgb(246, 246, 247)');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('canvas')).filter), 'none');
    await page.waitForFunction(() => window.__plateScene?.scene.background.getHex() === 0xe7e9ec);
    assert.equal(await page.evaluate(() => { const material = window.__plateScene.bedFloorMaterial; return material.color.getHex() === (material.map ? 0xffffff : 0xd4d8dd); }), true);

    log('the choice survives a reload');
    await page.reload();
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    assert.equal(await theme(), 'light');

    log('Follow the system tracks the OS setting');
    await page.emulateMedia({ colorScheme: 'dark' });
    await setTheme('system');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'theme');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All theme tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Theme tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
