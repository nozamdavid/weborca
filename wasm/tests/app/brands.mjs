#!/usr/bin/env node
/** Saved-printer workflow: packed brands in the wizard, added cross-brand profiles, custom profiles, and slicing. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = parseInt(process.env.PORT || '5133', 10);
const SAMPLE = ['Creality', 'Anycubic', 'Prusa', 'Elegoo', 'BBL', 'Qidi'];

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const ready = () => page.waitForFunction(() => window.__appStore?.getState().isEngineReady && !window.__appStore.getState().isSelectingPreset, null, { timeout: 90000 });
  const finish = async () => {
    await page.click('#wizard-next-btn');
    await page.waitForSelector('#wizard-step-2');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-dialog', { state: 'detached', timeout: 60000 });
    await ready();
  };
  try {
    await page.goto(`http://127.0.0.1:${PORT}`);
    await ready();
    assert.equal(await page.locator('#vendor-select').count(), 0);
    assert.equal(await page.locator('#add-printers-btn').count(), 0);
    assert.equal(await page.locator('#printer-select option').last().getAttribute('value'), '__add_printer__');
    await page.selectOption('#printer-select', '__add_printer__');
    await page.waitForSelector('#wizard-dialog');
    const brands = await page.locator('#wizard-vendor-select option').evaluateAll((os) => os.map((o) => o.value));
    assert.ok(brands.length >= 30, `only ${brands.length} packed brands`);
    const chosen = [];
    for (const vendor of SAMPLE) {
      assert.ok(brands.includes(vendor), `${vendor} missing`);
      await page.selectOption('#wizard-vendor-select', vendor);
      // Wait for the asynchronous model list to belong to this brand.
      await page.waitForFunction((v) => {
        const first = document.querySelector('.wizard-model-card input[type=checkbox]');
        return first && (v === 'BBL' ? first.value.startsWith('Bambu') : first.value.toLowerCase().startsWith(v.toLowerCase()));
      }, vendor, { timeout: 60000 });
      const box = page.locator('.wizard-model-card input[type=checkbox]').first();
      chosen.push({ vendor, preset: await box.getAttribute('value') });
      await box.check();
    }
    await page.selectOption('#wizard-vendor-select', 'Creality');
    await page.waitForFunction(() => document.querySelector('.wizard-model-card input')?.value.startsWith('Creality'));
    await finish();
    const offered = await page.locator('#printer-select option').evaluateAll((os) => os.map((o) => o.value).filter((v) => v !== '__add_printer__'));
    assert.deepEqual(offered.sort(), chosen.map((p) => p.preset).sort(), 'wizard saves all selected brands');
    for (const { vendor, preset } of chosen) {
      await page.selectOption('#printer-select', preset);
      await page.waitForFunction(({ vendor, preset }) => {
        const s = window.__appStore.getState();
        return s.selectedPrinter === preset && s.selectedVendor === vendor && s.selectedProcess && s.selectedFilaments[0] && !s.isSelectingPreset && !s.engineError;
      }, { vendor, preset }, { timeout: 90000 });
      console.log(`[${name}] ${vendor}: added printer selects coherent presets`);
    }
    await page.selectOption('#printer-select', chosen[0].preset);
    await ready();
    await page.setInputFiles('#model-file', path.resolve(repoRoot, 'tests/data/20mm_cube.obj'));
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1);
    await page.waitForFunction(() => !document.querySelector('#slice-btn').disabled);
    await page.click('#slice-btn');
    await page.waitForFunction(() => window.__appStore.getState().sliceResult?.gcode?.length > 1000, null, { timeout: 180000 });
    if (await page.locator('#slicing-warnings-close').isVisible()) await page.click('#slicing-warnings-close');
    await page.click('#tab-prepare');

    await page.selectOption('#printer-select', '__add_printer__');
    await page.waitForSelector('#wizard-dialog');
    await page.check('#wizard-custom-printer');
    await page.fill('#wizard-custom-name', 'Custom cross-brand printer');
    await page.fill('#wizard-custom-z', '333');
    await finish();
    assert.equal(await page.locator('#printer-select').inputValue(), 'user:Custom cross-brand printer');
    await page.selectOption('#printer-select', chosen[4].preset);
    await ready();
    await page.selectOption('#printer-select', 'user:Custom cross-brand printer');
    await ready();
    assert.equal(await page.evaluate(() => window.__appStore.getState().currentConfig.printable_height), '333');
    assert.equal(await page.evaluate(() => window.__orcaEngine.getConfig().then((c) => c.printable_height)), '333');
    await page.reload();
    await ready();
    assert.ok(await page.locator('#printer-select option[value="user:Custom cross-brand printer"]').count());
    for (const { preset } of chosen) assert.ok(await page.locator('#printer-select option').evaluateAll((options, p) => options.some((o) => o.value === p), preset));
    console.log(`[${name}] custom/user profile, persistence and cube slicing passed`);
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'brands', { frozenDist: true });
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
} finally {
  await stopServer(PORT);
}
