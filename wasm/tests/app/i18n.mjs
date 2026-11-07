#!/usr/bin/env node
/** Browser test of localization:
 * - Language picker lists all 23 languages with native names.
 * - Changing language loads catalog dynamically and updates UI (de, ja, zh_CN, pt_BR).
 * - Missing keys fall back to English.
 * - Selection survives page reload.
 * - Screenshot of CJK/Thai characters rendering.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const PORT = parseInt(process.env.PORT || '5160', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const defaultDist = path.resolve(repoRoot, 'wasm/build/agent-i18n-dist');
process.env.APP_TEST_DIST = process.env.APP_TEST_DIST || defaultDist;

async function runSuite(browserType, name) {
  let browser;
  try {
    browser = await browserType.launch({
      headless: true,
      timeout: 30000,
      args: ['--enable-features=SharedArrayBuffer', `--explicitly-allowed-ports=${PORT}`],
      ...(name === 'firefox' ? {
        firefoxUserPrefs: {
          'network.security.ports.banned.override': String(PORT)
        }
      } : {})
    });
  } catch (err) {
    if (name === 'firefox' && process.env.SKIP_FIREFOX === '1') {
      console.warn(`[${name}] Browser launch skipped/failed on this host environment: ${err.message}`);
      return;
    }
    throw err;
  }

  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__prefsStore), null, { timeout: 30000 });

    log('1. Open preferences dialog and verify all 23 languages');
    await page.evaluate(() => window.__prefsStore.getState().openDialog('general'));
    const langSelect = page.locator('#pref-language');
    await langSelect.waitFor();

    const options = await langSelect.locator('option').all();
    assert.equal(options.length, 23, `Expected 23 language options, found ${options.length}`);

    const expectedSample = [
      { code: 'en', name: 'English' },
      { code: 'de', name: 'Deutsch' },
      { code: 'fr', name: 'Français' },
      { code: 'ja', name: '日本語' },
      { code: 'ko', name: '한국어' },
      { code: 'zh_CN', name: '简体中文' },
      { code: 'zh_TW', name: '繁體中文' },
      { code: 'pt_BR', name: 'Português (Brasil)' },
      { code: 'th', name: 'ไทย' },
    ];

    for (const item of expectedSample) {
      const opt = langSelect.locator(`option[value="${item.code}"]`);
      assert.equal(await opt.count(), 1, `Option for ${item.code} missing`);
      assert.equal((await opt.textContent())?.trim(), item.name, `Native name mismatch for ${item.code}`);
    }

    log('2. Switch to German (de) and verify UI updates & fallback');
    await page.selectOption('#pref-language', 'de');
    await page.waitForFunction(
      () => document.querySelector('label[for="pref-language"]')?.textContent === 'Sprache',
      null,
      { timeout: 15000 }
    );
    const deAutoOption = await page.locator('#pref-slicing-threads option[value="auto"]').textContent();
    assert.equal(deAutoOption?.trim(), 'Automatisch');
    // Verify missing key falls back to English: "Slicing threads" has no PO translation in de
    const deFallbackLabel = await page.locator('label[for="pref-slicing-threads"]').textContent();
    assert.equal(deFallbackLabel?.trim(), 'Slicing threads');

    log('3. Switch to Japanese (ja) and verify UI updates & fallback');
    await page.selectOption('#pref-language', 'ja');
    await page.waitForFunction(
      () => document.querySelector('label[for="pref-language"]')?.textContent === '言語',
      null,
      { timeout: 15000 }
    );
    const jaAutoOption = await page.locator('#pref-slicing-threads option[value="auto"]').textContent();
    assert.equal(jaAutoOption?.trim(), '自動');
    const jaFallbackLabel = await page.locator('label[for="pref-slicing-threads"]').textContent();
    assert.equal(jaFallbackLabel?.trim(), 'Slicing threads');

    log('4. Switch to Simplified Chinese (zh_CN) and verify UI updates & fallback');
    await page.selectOption('#pref-language', 'zh_CN');
    await page.waitForFunction(
      () => document.querySelector('label[for="pref-language"]')?.textContent === '语言',
      null,
      { timeout: 15000 }
    );
    const zhAutoOption = await page.locator('#pref-slicing-threads option[value="auto"]').textContent();
    assert.equal(zhAutoOption?.trim(), '自动');
    const zhFallbackLabel = await page.locator('label[for="pref-slicing-threads"]').textContent();
    assert.equal(zhFallbackLabel?.trim(), 'Slicing threads');

    log('5. Switch to Brazilian Portuguese (pt_BR) and verify UI updates & fallback');
    await page.selectOption('#pref-language', 'pt_BR');
    await page.waitForFunction(
      () => document.querySelector('label[for="pref-language"]')?.textContent === 'Idioma',
      null,
      { timeout: 15000 }
    );
    const ptFallbackLabel = await page.locator('label[for="pref-slicing-threads"]').textContent();
    assert.equal(ptFallbackLabel?.trim(), 'Slicing threads');

    log('6. Switch to Thai (th) and capture font rendering screenshot');
    await page.selectOption('#pref-language', 'th');
    await page.waitForFunction(
      () => document.querySelector('label[for="pref-language"]')?.textContent === 'ภาษา',
      null,
      { timeout: 15000 }
    );
    await page.screenshot({ path: path.resolve(repoRoot, `docs/superpowers/thai-render-${name}.png`) });

    // Switch to zh_CN to capture CJK render screenshot
    await page.selectOption('#pref-language', 'zh_CN');
    await page.waitForFunction(
      () => document.querySelector('label[for="pref-language"]')?.textContent === '语言',
      null,
      { timeout: 15000 }
    );
    await page.screenshot({ path: path.resolve(repoRoot, `docs/superpowers/cjk-render-${name}.png`) });

    log('7. Verify language choice survives reload');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__prefsStore), null, { timeout: 30000 });

    const persistedLang = await page.evaluate(() => window.__prefsStore.getState().general.language);
    assert.equal(persistedLang, 'zh_CN', `Expected persisted language zh_CN, got ${persistedLang}`);

    await page.evaluate(() => window.__prefsStore.getState().openDialog('general'));
    await page.waitForFunction(
      () => document.querySelector('label[for="pref-language"]')?.textContent === '语言',
      null,
      { timeout: 15000 }
    );
    assert.equal(await page.locator('#pref-language').inputValue(), 'zh_CN');

    // Reset back to English for cleanup
    await page.selectOption('#pref-language', 'en');
    await page.waitForFunction(
      () => document.querySelector('label[for="pref-language"]')?.textContent === 'Language',
      null,
      { timeout: 15000 }
    );

    log('All assertions passed successfully');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'i18n');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All i18n tests completed.');
} catch (err) {
  console.error('i18n tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
