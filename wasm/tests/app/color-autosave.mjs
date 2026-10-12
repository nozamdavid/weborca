/** Persist preview color immediately; flush real dirty projects without re-exporting clean ones. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
const port = Number(process.env.PORT || 5322);
const cube = fs.readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');
async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}/preview`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady && window.__previewStore?.getState().isInitialized, null, { timeout: 90000 });
    await page.evaluate(async text => {
      window.__prefsStore.getState().setGeneralPref('autosave', false);
      window.__prefsStore.getState().setGeneralPref('autosaveIntervalSeconds', 3600);
      window.__prefsStore.getState().setGeneralPref('autoArrangeOnImport', false);
      await window.__appStore.getState().chooseVendor('Voron');
      await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
      await window.__appStore.getState().importModelFile(new File([text], 'color-autosave.obj'));
      window.__colorAutosave = { exports: 0, completedWrites: 0 };
      const engine = window.__orcaEngine, call = engine.call;
      engine.call = function (op, args, options) {
        if (op === 'saveProject' && args?.path === '/out/autosave.3mf') window.__colorAutosave.exports++;
        return call.call(this, op, args, options);
      };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (record, ...args) {
        const request = put.call(this, record, ...args);
        if (this.name === 'autosave') this.transaction.addEventListener('complete', () => { window.__colorAutosave.completedWrites++; });
        return request;
      };
      window.__prefsStore.getState().setGeneralPref('autosave', true);
    }, cube);
    await page.waitForFunction(() => window.__colorAutosave.completedWrites === 1);
    await page.evaluate(() => { window.__colorAutosave.exports = 0; });
    await page.evaluate(() => window.__previewStore.getState().setViewTypeAction('ActualSpeed'));
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__colorAutosave.exports), 0, 'clean color choice does not recompress the project');
    await page.evaluate(() => window.__previewStore.getState().setViewTypeAction('ActualSpeed'));
    assert.equal(await page.evaluate(() => window.__colorAutosave.exports), 0, 'selecting the same color choice does not create another backup');

    await page.evaluate(() => window.__appStore.getState().applyOptionChange('layer_height', '0.21', 'print'));
    assert.equal(await page.evaluate(() => window.__colorAutosave.exports), 0, 'the one-hour background interval has not elapsed');
    await page.evaluate(() => window.__previewStore.getState().setViewTypeAction('Tool'));
    await page.waitForFunction(() => window.__colorAutosave.completedWrites === 2);
    assert.equal(await page.evaluate(() => window.__colorAutosave.exports), 1, 'color choice immediately flushes the real dirty edit');
    const record = await page.evaluate(() => window.__autosave.readAutosave().then(record => ({ options: record.setup.options, bytes: record.bytes.byteLength })));
    assert.equal(record.options.layer_height, '0.21');
    assert.ok(record.bytes > 0);

    await page.evaluate(async () => {
      // Explicit discard remains clean; a preference change must not recreate its backup.
      await window.__autosave.clearAutosave();
      window.__previewStore.getState().setViewTypeAction('FeatureType');
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__colorAutosave.exports), 1);
    assert.equal(await page.evaluate(() => window.__autosave.readAutosave().then(record => !!record)), false);
    await page.evaluate(async () => {
      window.__prefsStore.getState().setGeneralPref('autosave', false);
      await window.__appStore.getState().applyOptionChange('layer_height', '0.22', 'print');
      window.__previewStore.getState().setViewTypeAction('ActualSpeed');
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__colorAutosave.exports), 1, 'disabled autosave does not export a dirty project');
    await page.reload();
    await page.waitForFunction(() => window.__previewStore?.getState().isInitialized && window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    assert.equal(await page.evaluate(() => window.__previewStore.getState().viewType), 'ActualSpeed', 'color preference persists across refresh');
    assert.equal(await page.evaluate(() => window.__prefsStore.getState().general.autosave), false);
    console.log(`${browserType.name()}: clean choices skip export; dirty choices flush immediately; discard, disabled preference and refresh persistence preserved`);
  } finally { await browser.close(); }
}
await startServer(port, 'color-autosave', { frozenDist: process.env.APP_TEST_FROZEN === '1' });
try {
  if (process.env.APP_TEST_BROWSER !== 'firefox') await suite(chromium);
  if (process.env.APP_TEST_BROWSER !== 'chromium') await suite(firefox);
} finally { await stopServer(port); }
