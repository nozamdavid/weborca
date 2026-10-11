import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5270);
const cube = readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');

async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(async () => {
      await window.__appStore.getState().chooseVendor('Snapmaker');
      await window.__appStore.getState().choosePrinter('Snapmaker U1 (0.4 nozzle)');
    });
    const chooser = page.getByTestId('bed-type-select');
    await chooser.waitFor();
    assert.equal(await chooser.inputValue(), 'Textured PEI Plate');
    assert.equal(await chooser.locator('option').count(), 6);
    assert.equal(await page.locator('#bed-type-icon').getAttribute('src'), '/icons/bed_pei.png');
    await page.waitForFunction(() => document.getElementById('bed-type-icon')?.naturalWidth > 0);
    await page.evaluate(async text => {
      const app = window.__appStore.getState();
      await app.importModelFile(new File([text], 'cube.obj'));
      await app.applyOptionChange('hot_plate_temp_initial_layer', '61', 'filament', undefined, 0);
      await app.applyOptionChange('textured_plate_temp_initial_layer', '73', 'filament', undefined, 0);
    }, cube);
    async function sliceAndCheck(temperature) {
      await page.evaluate(async () => window.__appStore.getState().startSlice());
      const result = await page.evaluate(() => {
        const app = window.__appStore.getState();
        return { error: app.engineError, gcode: app.sliceResult?.gcode ? new TextDecoder().decode(app.sliceResult.gcode) : '' };
      });
      assert.equal(result.error, null);
      assert.match(result.gcode, new RegExp(`^M140 S${temperature}(?:\\s|$)`, 'm'));
    }
    await sliceAndCheck(73);
    await page.getByRole('tab', { name: 'Prepare', exact: true }).click();
    await chooser.selectOption('High Temp Plate');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.curr_bed_type === 'High Temp Plate');
    assert.equal(await page.locator('#bed-type-icon').getAttribute('src'), '/icons/bed_high_templ.png');
    await page.waitForFunction(() => document.getElementById('bed-type-icon')?.naturalWidth > 0);
    assert.equal(await page.evaluate(() => window.__appStore.getState().sliceResult), null);
    await sliceAndCheck(61);
    await page.getByRole('tab', { name: 'Prepare', exact: true }).click();
    await page.evaluate(async () => {
      await window.__appStore.getState().chooseVendor('Voron');
      await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
    });
    assert.equal(await chooser.count(), 0);
    await page.evaluate(async () => window.__appStore.getState().chooseVendor('BBL'));
    await chooser.waitFor();
    console.log(`${browserType.name()}: supported-printer chooser, defaults, slice invalidation, and bed-specific G-code temperatures pass`);
  } finally { await browser.close(); }
}

await startServer(port, 'bed-type-chooser');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
