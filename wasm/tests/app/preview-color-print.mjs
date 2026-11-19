import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { detailedGcode } from '../lib/preview-performance-fixtures.mjs';

const port = Number(process.env.PORT || 5372);
const palette = ['#0088ff', '#ff3300', '#ffd000', '#22cc66'];
await startServer(port, 'preview-color-print');
try {
  for (const browserType of process.env.PREVIEW_COLOR_CHROMIUM_ONLY === '1' ? [chromium] : [chromium, firefox]) {
    const browser = await browserType.launch({
      headless: process.env.APP_TEST_HEADED !== '1',
      args: browserType === chromium ? ['--enable-unsafe-swiftshader'] : []
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
      await page.goto(`http://127.0.0.1:${port}/preview`);
      await page.waitForFunction(() => window.__appStore?.getState().isEngineReady && window.__previewStore?.getState().isInitialized);
      const config = await page.evaluate(() => window.__appStore.getState().currentConfig);
      const load = async text => {
        await page.evaluate(async source => {
          delete document.querySelector('#canvas').dataset.previewReady;
          await window.__appStore.getState().openGcodeFile(new File([source], 'multicolor.gcode'));
        }, text);
        await page.waitForFunction(() => document.querySelector('#canvas')?.dataset.previewReady === 'true');
      };
      const capture = async scheme => {
        await page.getByTestId('view-type-select').selectOption(scheme);
        return page.evaluate(async () => {
          window.preview.render();
          const canvas = document.querySelector('#canvas');
          const copy = document.createElement('canvas');
          copy.width = canvas.width;
          copy.height = canvas.height;
          const context = copy.getContext('2d');
          context.drawImage(canvas, 0, 0);
          const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
          const digest = await crypto.subtle.digest('SHA-256', pixels);
          let magentaPixels = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (Math.min(pixels[i], pixels[i + 2]) > pixels[i + 1] + 70) magentaPixels++;
          }
          return {
            pixels: [...new Uint8Array(digest)],
            colors: window.__previewStore.getState().legend.items.map(item => item.color),
            magentaPixels
          };
        });
      };
      const gcode = process.env.PREVIEW_COLOR_GCODE
        ? await readFile(process.env.PREVIEW_COLOR_GCODE, 'utf8')
        : detailedGcode({ layers: 4, segments: 128, tools: 4, config });
      const headerIndex = gcode.indexOf('; HEADER_BLOCK_END') + '; HEADER_BLOCK_END'.length;
      const configIndex = gcode.indexOf('; CONFIG_BLOCK_START');
      const configEnd = gcode.indexOf('; CONFIG_BLOCK_END') + '; CONFIG_BLOCK_END'.length;
      // Bambu-family exports place metadata before the toolpaths. Also put
      // it at the end to exercise the legacy footer layout.
      const bareGcode = gcode.slice(0, configIndex) + gcode.slice(configEnd);
      const configBlock = gcode.slice(configIndex, configEnd);
      const expected = process.env.PREVIEW_COLOR_GCODE
        ? configBlock.match(/^; filament_colour = (.+)$/m)[1].toLowerCase().split(';')
        : palette;
      for (const text of [
        bareGcode.slice(0, headerIndex) + '\n' + configBlock + bareGcode.slice(headerIndex),
        bareGcode + '\n' + configBlock + '\n'
      ]) {
        await load(text);
        const tool = await capture('Tool');
        assert.deepEqual(tool.colors, expected, 'Filament view must use the G-code palette');
        for (const scheme of ['ColorPrint', 'Summary']) {
          const frame = await capture(scheme);
          assert.deepEqual(frame.colors, expected, `${scheme} must use the G-code palette`);
          assert.deepEqual(frame.pixels, tool.pixels, `${scheme} must render the same colors for ordinary tool changes`);
        }
      }
      if (!process.env.PREVIEW_COLOR_GCODE) {
        const singleFilament = detailedGcode({
          layers: 4, segments: 128, tools: 1, config: { ...config, printer_model: 'Voron 2.4' }
        });
        const swap = singleFilament.replace('G1 Z0.60 F3000\nT0\n', '$&;COLOR_CHANGE,T0,#FF00FF\nM600\n');
        assert.notEqual(swap, singleFilament, 'fixture must contain a manual swap on layer 3');
        await load(swap);

        const layers = (min, max) => page.evaluate(([start, end]) => {
          window.__previewStore.getState().setLayerRangeAction(start, end);
        }, [min, max]);
        await layers(0, 1);
        assert.deepEqual((await capture('ColorPrint')).pixels, (await capture('Tool')).pixels,
          'Layers before the swap keep their original color');

        await layers(2, 3);
        const tool = await capture('Tool');
        const colorPrint = await capture('ColorPrint');
        assert.deepEqual(tool.colors, [palette[0]], 'A manual swap stays on the same filament slot');
        assert.equal(tool.magentaPixels, 0, 'Filament view keeps the slot color after a manual swap');
        assert.ok(colorPrint.magentaPixels > 40, 'Color print renders the new color after the manual swap');
      }
      console.log(`${browserType.name()}: correct filament colors in header and footer G-code`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await stopServer(port);
}
