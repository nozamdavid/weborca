import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5269);
const cube = readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');

async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(async text => {
      await window.__appStore.getState().importModelFile(new File([text], 'cube.obj'));
    }, cube);
    await page.waitForFunction(() => window.__plateScene?.objectMeshes.size > 0);
    await page.evaluate(() => {
      const scene = window.__plateScene;
      window.__colorProbe = { busy: 0, bedReloads: 0, colors: [] };
      window.__stopColorProbe = window.__appStore.subscribe(state => {
        if (state.isSelectingPreset) window.__colorProbe.busy++;
      });
      const setBedLoading = scene.setBedLoading;
      const setVolumeColors = scene.setVolumeColors;
      scene.setBedLoading = function (loading) {
        if (loading) window.__colorProbe.bedReloads++;
        return setBedLoading.call(this, loading);
      };
      scene.setVolumeColors = function (colors) {
        window.__colorProbe.colors.push([...colors.values()].flatMap(parts => [...parts.values()]));
        return setVolumeColors.call(this, colors);
      };
    });
    for (const color of ['#ee2233', '#229944', '#3355dd']) {
      await page.locator('#filament-color-input-1').evaluate((input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, color);
      await page.waitForFunction(value => window.__appStore.getState().currentConfig.filament_colour.split(';')[0] === value.toUpperCase(), color);
    }
    await page.waitForFunction(() => window.__colorProbe.colors.some(colors => colors.includes('#3355DD')));
    const probe = await page.evaluate(() => {
      window.__stopColorProbe();
      return window.__colorProbe;
    });
    assert.equal(probe.busy, 0, 'Color edits must not disable/flash the entire UI');
    assert.equal(probe.bedReloads, 0, 'Color edits must not reload the bed');
    assert.equal(await page.locator('#filament-color-input-1').isDisabled(), false);
    console.log(`${browserType.name()}: picker updates model colors without preset loading or bed reloads`);
  } finally { await browser.close(); }
}

await startServer(port, 'filament-color-picker');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
