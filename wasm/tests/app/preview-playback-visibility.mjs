/** Playback pauses without changing position when its view or browser tab is hidden. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { detailedGcode } from '../lib/preview-performance-fixtures.mjs';

const port = Number(process.env.PORT || 5307);
const externalUrl = process.env.PREVIEW_PLAYBACK_URL;
if (!externalUrl) await startServer(port, 'preview-playback-visibility', { frozenDist: true });
try {
  for (const browserType of [chromium, firefox]) {
    const browser = await browserType.launch({ args: browserType === chromium ? ['--enable-unsafe-swiftshader'] : [] });
    try {
      const page = await browser.newPage();
      await page.goto(`${externalUrl || `http://127.0.0.1:${port}`}/preview`);
      await page.waitForFunction(() => window.__appStore?.getState().isEngineReady && window.__previewStore?.getState().isInitialized, null, { timeout: 90000 });
      await page.evaluate(() => {
        window.__prefsStore.getState().setGeneralPref('autosave', false);
        window.__prefsStore.getState().setDisplayPref('previewLowQuality', true);
      });
      const config = await page.evaluate(() => window.__appStore.getState().currentConfig);
      const code = detailedGcode({ layers: 4, segments: 128, config });
      await page.evaluate(text => window.__appStore.getState().openGcodeFile(new File([text], 'playback.gcode')), code);
      await page.waitForFunction(() => document.getElementById('canvas')?.dataset.previewReady === 'true');
      await page.evaluate(() => {
        const prototype = window.previewModule.OrcaPreview.prototype, original = prototype.render;
        window.__playbackFrames = 0;
        prototype.render = function (...args) { window.__playbackFrames++; return original.apply(this, args); };
        const state = window.__previewStore.getState();
        state.setMoveAction(state.minMove);
      });
      const play = page.locator('#btn-play-moves');
      const position = () => page.evaluate(() => window.__previewStore.getState().currentMove);
      async function settles() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
      async function stationary(label) {
        await settles();
        const before = await position();
        await page.evaluate(() => { window.__playbackFrames = 0; });
        await page.waitForTimeout(400);
        assert.equal(await position(), before, `${label}: position is preserved`);
        assert.equal(await page.evaluate(() => window.__playbackFrames), 0, `${label}: no native frames`);
        assert.equal(await play.getAttribute('title'), 'Play moves sequentially', `${label}: button is paused`);
      }
      const initial = await position();
      await play.click();
      await page.waitForFunction(before => window.__previewStore.getState().currentMove > before, initial);
      await page.getByRole('tab', { name: 'Prepare', exact: true }).click();
      await stationary('hidden Preview');
      await page.getByRole('tab', { name: 'Preview', exact: true }).click();
      await stationary('returning does not auto-resume');
      const resumePosition = await position();
      await play.click();
      await page.waitForFunction(before => window.__previewStore.getState().currentMove > before, resumePosition);
      // Browser automation cannot reliably background its sole page. Exercise the
      // real visibilitychange listener with the platform's hidden signal instead.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await stationary('background browser tab');
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await stationary('foreground does not auto-resume');
      console.log(`${browserType.name()}: visible playback, hidden view, explicit resume and document visibility PASS`);
    } finally { await browser.close(); }
  }
} finally { if (!externalUrl) await stopServer(port); }
