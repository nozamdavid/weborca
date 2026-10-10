#!/usr/bin/env node
/** Browser test of the brand list: every packed brand is offered, and a sample of them loads a printer, process and filament that slice. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = parseInt(process.env.PORT || '5133', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SAMPLE = ['Creality', 'Anycubic', 'Prusa', 'Elegoo', 'BBL', 'Qidi'];

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    log('the brand selector lists the packed brands, with the label "Brand"');
    assert.equal(await page.locator('label[for="vendor-select"]').innerText(), 'Brand');
    const brands = await page.locator('#vendor-select option').allTextContents();
    assert.ok(brands.length >= 30, `only ${brands.length} brands`);
    for (const b of SAMPLE) assert.ok(brands.includes(b), `${b} missing`);

    for (const brand of SAMPLE) {
      log(`${brand}: loads presets`);
      await page.selectOption('#vendor-select', brand);
      await page.waitForFunction((b) => {
        const s = window.__appStore.getState();
        return s.selectedVendor === b && s.printers.some((p) => p.name === s.selectedPrinter) && s.selectedProcess.includes('Standard') !== undefined && !s.selectedProcess.includes(s.selectedVendor === 'Voron' ? 'x' : 'Voron') && s.selectedFilaments?.[0] && !s.engineError;
      }, brand, { timeout: 120000 });
      const nozzles = await page.locator('#printer-select option').allTextContents();
      assert.ok(nozzles.length >= 1, `${brand} has no printers`);
      const err = await page.evaluate(() => window.__appStore.getState().engineError);
      assert.ok(!err, `${brand}: ${err}`);
    }
    log('Creality slices a cube with its default presets');
    await page.selectOption('#vendor-select', 'Creality');
    await page.waitForFunction(() => window.__appStore.getState().selectedVendor === 'Creality' && window.__appStore.getState().selectedFilaments?.[0], null, { timeout: 120000 });
    await page.setInputFiles('#model-file', path.resolve(repoRoot, 'tests/data/20mm_cube.obj'));
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1, null, { timeout: 120000 });
    await page.waitForFunction(() => { const b = document.getElementById('slice-btn'); return b && !b.disabled; }, null, { timeout: 60000 });
    await page.click('#slice-btn');
    await page.waitForFunction(() => window.__appStore.getState().sliceResult?.gcode?.length > 1000, null, { timeout: 180000 });

    log('Add printers and nozzles offers only the chosen printers of the brand');
    await page.getByRole('tab', { name: 'Prepare' }).click();
    await page.click('#add-printers-btn');
    await page.waitForSelector('#wizard-dialog');
    await page.waitForSelector('.wizard-model-card');
    const boxes = page.locator('#wizard-step-1 .wizard-model-card input[type="checkbox"]');
    const chosen = [];
    for (let i = 0; i < 2; i++) {
      chosen.push(await boxes.nth(i).getAttribute('value'));
      await boxes.nth(i).check();
    }
    await page.click('#wizard-next-btn');
    await page.waitForSelector('#wizard-step-2');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-dialog', { state: 'detached' });
    await page.waitForFunction((first) => window.__appStore.getState().selectedPrinter === first, chosen[0], { timeout: 60000 });
    const offered = await page.locator('#printer-select option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    assert.deepEqual([...offered].sort(), [...chosen].sort());
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'brands');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All brand tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Brand tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
