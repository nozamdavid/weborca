/** Closing a project releases toolpaths; ordinary option invalidation keeps an outdated preview. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { detailedGcode } from '../lib/preview-performance-fixtures.mjs';

const port = Number(process.env.PORT || 5303);
await startServer(port, 'preview-newproject-reset', {
  frozenDist: process.env.PREVIEW_NEWPROJECT_FROZEN_DIST === '1'
});
try {
  for (const browserType of [chromium, firefox]) {
    const browser = await browserType.launch({ args: browserType === chromium ? ['--enable-unsafe-swiftshader'] : [] });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/preview`);
      await page.waitForFunction(() => window.__appStore?.getState().isEngineReady && window.__previewStore?.getState().isInitialized);
      await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('autosave', false));
      const emptyGpuBytes = await page.evaluate(() => {
        window.__prefsStore.getState().setDisplayPref('previewLowQuality', true);
        window.preview.setLowQuality(true);
        return JSON.parse(window.preview.getRenderMemoryUsage()).gpuBytes;
      });
      const config = await page.evaluate(() => window.__appStore.getState().currentConfig);
      const code = detailedGcode({ layers: 2, segments: 16, tools: 1, config });
      await page.evaluate(text => window.__appStore.getState().openGcodeFile(new File([text], 'valid.gcode')), code);
      await page.waitForFunction(() => document.getElementById('canvas')?.dataset.previewReady === 'true');
      const sample = () => page.evaluate(() => ({
        moves: Number(window.preview.getMovesCount()),
        memory: JSON.parse(window.preview.getRenderMemoryUsage()),
        layers: window.__previewStore.getState().layersCount,
        stats: window.__previewStore.getState().stats,
        source: !!window.__appStore.getState().sliceResult,
        url: window.__appStore.getState().gcodeUrl,
        model: window.__appStore.getState().modelFile,
        banner: !!document.getElementById('slice-outdated-banner'),
        frameTiming: document.getElementById('canvas').dataset.sliceToFrameMs || null,
        previewReady: document.getElementById('canvas').dataset.previewReady || null,
        canvasVisible: document.getElementById('canvas').getBoundingClientRect().width > 0
      }));
      const original = await sample();
      await page.evaluate(() => window.__appStore.getState().invalidateSlicePreview());
      await page.waitForSelector('#slice-outdated-banner');
      assert.equal((await sample()).moves, original.moves, 'ordinary invalidation keeps outdated geometry');
      await page.evaluate(text => window.__appStore.getState().openGcodeFile(new File([text], 'valid.gcode')), code);
      await page.waitForFunction(() => window.__appStore.getState().sliceResult !== null && !document.getElementById('slice-outdated-banner'));
      await page.evaluate(() => window.__prefsStore.getState().setDisplayPref('previewLowQuality', true));
      await page.evaluate(() => window.__previewStore.getState().setViewTypeAction('Speed'));
      const bed = await page.evaluate(() => window.preview.getBedPolygon());
      await page.evaluate(() => { window.__newProjectViewer = window.preview; window.__newProjectContext = document.getElementById('canvas').getContext('webgl2'); });
      const before = await sample();
      await page.locator('.menu-label', { hasText: 'File' }).first().click();
      await page.locator('.menu.open .menu-item', { hasText: 'New project' }).first().click();
      await page.click('[data-testid=confirm-ok]');
      await page.waitForFunction(() => window.__appStore.getState().modelFile === null && window.__appStore.getState().sliceResult === null);
      await page.waitForTimeout(300);
      const after = await sample();
      console.log(JSON.stringify({ browser: browserType.name(), before, after }));
      assert.equal(await page.evaluate(() => window.preview === window.__newProjectViewer && document.getElementById('canvas').getContext('webgl2') === window.__newProjectContext), true, 'viewer and GL context survive reset');
      assert.equal(after.source, false); assert.equal(after.url, null);
      assert.equal(after.moves, 0, 'New Project discards native toolpaths');
      assert.equal(after.memory.gpuBytes, emptyGpuBytes, 'New Project releases toolpath GPU textures while retaining reusable renderer templates');
      assert.ok(after.memory.cpuBytes < before.memory.cpuBytes, 'New Project releases geometry CPU storage');
      assert.equal(after.frameTiming, null, 'project reset removes old timing metadata');
      assert.equal(after.previewReady, null, 'project reset removes old readiness metadata');
      assert.equal(after.layers, 0); assert.equal(after.stats, null); assert.equal(after.banner, false);
      assert.equal(await page.evaluate(() => window.preview.getSliceStatistics()), '');
      assert.deepEqual(await page.evaluate(() => window.preview.getBedPolygon()), bed, 'bed survives the project reset');
      assert.equal(await page.evaluate(() => window.__prefsStore.getState().display.previewLowQuality), true);
      assert.equal(await page.evaluate(() => window.__previewStore.getState().viewType), 'Speed');
      const emptyLegend = await page.evaluate(() => {
        window.__previewStore.getState().setViewTypeAction('Temperature');
        window.__prefsStore.getState().setDisplayPref('previewLowQuality', false);
        return JSON.parse(window.preview.getLegendData());
      });
      assert.equal(emptyLegend.viewType, 'Temperature');
      assert.equal(emptyLegend.title, 'Temperature (°C)');
      assert.deepEqual(emptyLegend.ranges, []); assert.deepEqual(emptyLegend.options, []);
      const cameraReset = await page.evaluate(() => {
        const canvas = document.getElementById('canvas'), gl = canvas.getContext('webgl2');
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        const hash = () => {
          window.preview.render();
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let value = 2166136261;
          for (let i = 0; i < pixels.length; i += 16) value = Math.imul(value ^ pixels[i], 16777619);
          return value >>> 0;
        };
        const before = hash(); window.preview.resetCamera(); const after = hash();
        return { before, after, error: gl.getError() };
      });
      assert.equal(cameraReset.before, cameraReset.after, 'empty Reset Camera preserves the bed camera');
      assert.equal(cameraReset.error, 0);
      await page.evaluate(text => window.__appStore.getState().openGcodeFile(new File([text], 'again.gcode')), code);
      await page.waitForFunction(() => window.__previewStore.getState().layersCount === 2 && document.getElementById('canvas')?.dataset.previewReady === 'true');
      assert.equal((await sample()).moves, before.moves, 'next load works in the preserved viewer');
      assert.equal(await page.locator('#preview-error-overlay').count(), 0);
      console.log(`${browserType.name()}: New Project reset and next load PASS`);

    } finally {
      await browser.close();
    }
  }
} finally {
  stopServer();
}
