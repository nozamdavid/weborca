import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
const port = 5278;
const cube = readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');
async function suite(browserType) {
  const browser = await browserType.launch(); const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(async text => {
      const app = window.__appStore.getState();
      await app.chooseVendor('Snapmaker'); await app.choosePrinter('Snapmaker U1 (0.4 nozzle)');
      const preset = window.__appStore.getState().filaments.find(p => p.isCompatible && p.name.startsWith('Generic PLA'));
      await app.chooseFilament(preset.name);
      while (window.__appStore.getState().selectedFilaments.length < 4) await app.addFilamentSlot(preset.name);
      await app.applyOptionChange('filament_colour', '#FF0000;#00FF00;#0000FF;#FFFFFF', 'filament');
      await app.importModelFile(new File([text], 'cube.obj'));
      const obj = window.__objectListStore.getState().objects[0];
      await window.__objectListStore.getState().setObjectExtruder(obj.id, 3);
      await window.__appStore.getState().startSlice();
    }, cube);
    assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);
    await page.waitForSelector('#canvas[data-preview-ready="true"]', { timeout: 90000 });
    await page.selectOption('#view-type-select', 'Tool');
    const palette = await page.evaluate(() => JSON.parse(window.preview.getLegendData()).items);
    assert.equal(palette.find(item => item.id === 2).color.toUpperCase(), '#0000FF', 'native renderer palette uses filament 3 blue');
    await page.waitForTimeout(300);
    const pixels = () => page.evaluate(() => {
      const canvas = document.querySelector('#canvas'), copy = document.createElement('canvas');
      copy.width = canvas.width; copy.height = canvas.height;
      const ctx = copy.getContext('2d'); ctx.drawImage(canvas, 0, 0);
      const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
      let blue = 0, red = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 2] > 70 && data[i + 2] > data[i] * 1.7 && data[i + 2] > data[i + 1] * 1.7) blue++;
        if (data[i] > 70 && data[i] > data[i + 2] * 1.7 && data[i] > data[i + 1] * 1.7) red++;
      }
      return {blue, red};
    });
    const bluePixels = await pixels();
    await page.evaluate(() => { window.preview.setToolColors(['', '', '#FF0000']); window.preview.render(); });
    const redPixels = await pixels();
    assert.ok(bluePixels.blue - redPixels.blue > 100 && redPixels.red - bluePixels.red > 100, 'changing the native palette changes the actual toolpath pixels');
    for (const color of ['#000000', '#0047BB', '#0000FF']) {
      const actual = await page.evaluate(color => {
        window.preview.setToolColors(['', '', color]);
        return JSON.parse(window.preview.getLegendData()).items.find(item => item.id === 2).color;
      }, color);
      assert.equal(actual.toUpperCase(), color, 'RGB channels are preserved exactly');
    }
    assert.equal(await page.locator('.stat-filament-row').count(), 1, 'unused slots are omitted');
    assert.equal(await page.locator('#stat-filament-slot-3').count(), 1, 'used slot keeps its original number');
    assert.equal(await page.locator('#stat-filament-slot-1').count(), 0);
    assert.equal(await page.locator('#stat-filament-slot-2').count(), 0);
    assert.equal(await page.locator('#stat-filament-slot-4').count(), 0);
    console.log(`${browserType.name()}: native blue toolpath palette/pixels and only-used filament 3 statistics pass`);
  } finally { await browser.close(); }
}
await startServer(port, 'preview-filament-usage');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
