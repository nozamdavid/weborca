import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
const port = 5279;
const cube = readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');
async function suite(browserType) {
  const browser = await browserType.launch(); const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, {timeout: 90000});
    await page.evaluate(async text => {
      window.__prefsStore.getState().setGeneralPref('autosaveIntervalSeconds', 3600);
      await window.__appStore.getState().importModelFile(new File([text], 'cube.obj'));
    }, cube);
    await page.waitForFunction(async () => (await window.__autosave.readAutosave())?.objects === 1);
    // Wait for the first timer save to finish, so only slicing can save this new edit.
    await page.waitForTimeout(200);
    await page.evaluate(async () => {
      await window.__appStore.getState().applyOptionChange('notes', 'Save immediately before slicing', 'print');
      await window.__appStore.getState().startSlice();
    });
    const saved = await page.evaluate(async () => {
      const record = await window.__autosave.readAutosave();
      return { notes: record.setup.options.notes, objects: record.objects, bytes: record.bytes.length, savedAt: record.savedAt, error: window.__appStore.getState().engineError, sliced: !!window.__appStore.getState().sliceResult };
    });
    assert.equal(saved.error, null); assert.equal(saved.sliced, true);
    assert.equal(saved.notes, 'Save immediately before slicing'); assert.equal(saved.objects, 1); assert.ok(saved.bytes > 0);
    await page.evaluate(async () => {
      window.__prefsStore.getState().setGeneralPref('autosave', false);
      await window.__appStore.getState().applyOptionChange('notes', 'Disabled: do not save at slice', 'print');
      await window.__appStore.getState().startSlice();
    });
    const disabled = await page.evaluate(async () => {
      const r = await window.__autosave.readAutosave(); return {savedAt: r.savedAt, notes: r.setup.options.notes};
    });
    assert.equal(disabled.notes, saved.notes, 'disabled autosave does not save the later edit when slicing');
    assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);
    await page.reload();
    await page.waitForSelector('#recovery-restore', {timeout: 90000}); await page.click('#recovery-restore');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1 && window.__appStore.getState().currentConfig.notes === 'Save immediately before slicing');
    console.log(`${browserType.name()}: slicing saves immediately with a one-hour interval, disabled preference respected, model/settings recover after refresh`);
  } finally { await browser.close(); }
}
await startServer(port, 'slice-autosave');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
