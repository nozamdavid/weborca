/** A rejected replacement must not prevent the next valid G-code from displaying. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { detailedGcode } from '../lib/preview-performance-fixtures.mjs';

const port = Number(process.env.PORT || 5303);
await startServer(port, 'preview-load-recovery', {
  frozenDist: process.env.PREVIEW_RECOVERY_FROZEN_DIST === '1'
});
try {
  for (const browserType of [chromium, firefox]) {
    const browser = await browserType.launch({ args: browserType === chromium ? ['--enable-unsafe-swiftshader'] : [] });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/preview`);
      await page.waitForFunction(() => window.__appStore?.getState().isEngineReady && window.__previewStore?.getState().isInitialized);
      await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('autosave', false));
      const config = await page.evaluate(() => window.__appStore.getState().currentConfig);
      const code = detailedGcode({ layers: 2, segments: 16, tools: 1, config });
      await page.evaluate(text => window.__appStore.getState().openGcodeFile(new File([text], 'valid.gcode')), code);
      await page.waitForFunction(() => document.getElementById('canvas')?.dataset.previewReady === 'true');
      const oldStats = await page.evaluate(() => window.__previewStore.getState().stats);

      await page.evaluate(() => {
        const prototype = window.previewModule.OrcaPreview.prototype;
        window.__originalPreviewLoad = prototype.loadGcode;
        // Native returned errors leave the previous viewer intact.
        prototype.loadGcode = () => JSON.stringify({ error: 'Rejected replacement fixture' });
        const result = window.__appStore.getState().sliceResult;
        window.__appStore.setState({ sliceResult: { ...result, gcode: new Uint8Array(result.gcode) } });
      });
      await page.waitForSelector('#preview-error-overlay');
      assert.match(await page.locator('#preview-error-overlay').innerText(), /Rejected replacement fixture/);
      assert.deepEqual(await page.evaluate(() => window.__previewStore.getState().stats), oldStats);

      await page.evaluate(() => {
        window.previewModule.OrcaPreview.prototype.loadGcode = window.__originalPreviewLoad;
        const result = window.__appStore.getState().sliceResult;
        delete document.getElementById('canvas').dataset.previewReady;
        window.__appStore.setState({ sliceResult: { ...result, gcode: new Uint8Array(result.gcode) } });
      });
      await page.waitForFunction(() => document.getElementById('canvas')?.dataset.previewReady === 'true');
      assert.equal(await page.locator('#preview-error-overlay').count(), 0, 'a valid replacement clears the prior error');
      assert.deepEqual(await page.evaluate(() => window.__previewStore.getState().stats), oldStats);
      console.log(`${browserType.name()}: failed replacement preserves statistics and a valid retry recovers`);
    } finally {
      await browser.close();
    }
  }
} finally {
  stopServer();
}
