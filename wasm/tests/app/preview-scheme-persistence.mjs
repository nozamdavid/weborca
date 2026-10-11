#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5291);
const storageKey = 'orcaslicer_preview_view_type_v1';
const cube = readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');
const gcode = readFileSync(new URL('../node/fixture.gcode', import.meta.url), 'utf8');

async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  const ready = async () => {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  };
  const preview = async () => {
    await page.click('#tab-preview');
    await page.waitForFunction(() => window.__previewStore.getState().isInitialized, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => JSON.parse(window.preview.getLegendData()).viewType),
      await page.evaluate(() => window.__previewStore.getState().viewType), 'initial native renderer matches the stored choice');
    await page.evaluate(text => window.__previewStore.getState().loadGcodeBytes(text), gcode);
  };
  const backup = () => page.evaluate(async () => {
    const record = await window.__autosave.readAutosave();
    return record && { savedAt: record.savedAt, notes: record.setup.options.notes, bytes: record.bytes?.length };
  });
  const waitForBackup = async predicate => {
    const deadline = Date.now() + 15000;
    do {
      const record = await backup();
      if (predicate(record)) return record;
      await page.waitForTimeout(100);
    } while (Date.now() < deadline);
    assert.fail('The expected preview-triggered recovery backup was not persisted');
  };
  const nativeType = () => page.evaluate(() => JSON.parse(window.preview.getLegendData()).viewType);
  try {
    await ready();
    await preview();
    assert.equal(await page.locator('#view-type-select').inputValue(), 'FeatureType');
    await page.click('#tab-prepare');
    await page.evaluate(async text => {
      window.__prefsStore.getState().setGeneralPref('autosaveIntervalSeconds', 3600);
      await window.__appStore.getState().importModelFile(new File([text], 'cube.obj'));
    }, cube);
    await waitForBackup(record => !!record?.bytes);
    await page.waitForTimeout(700); // Let the first-model timer finish before the immediate-save assertion.
    await preview();
    const first = await backup();
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('notes', 'Saved on preview scheme change', 'print'));
    await page.selectOption('#view-type-select', 'Speed');
    const second = await waitForBackup(record => record?.notes === 'Saved on preview scheme change');
    assert.ok(second.bytes > 0, 'the immediate backup includes project geometry');
    assert.ok(second.savedAt > first.savedAt, 'the hour interval did not delay the scheme-triggered save');
    assert.equal(await nativeType(), 'Speed');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), 'Speed');

    // Neither initialization nor loading a G-code file should replace the chosen scheme.
    await page.evaluate(text => window.__previewStore.getState().loadGcodeBytes(text), gcode);
    assert.equal(await nativeType(), 'Speed');
    await page.click('#tab-prepare');
    await preview();
    assert.equal(await nativeType(), 'Speed');
    await ready();
    await page.waitForSelector('#recovery-dialog');
    await page.click('#recovery-restore');
    await page.waitForSelector('#recovery-dialog', { state: 'detached' });
    assert.equal(await page.evaluate(() => window.__appStore.getState().currentConfig.notes), second.notes);
    await preview();
    assert.equal(await page.locator('#view-type-select').inputValue(), 'Speed');
    await page.evaluate(text => window.__previewStore.getState().loadGcodeBytes(text), gcode);
    assert.equal(await nativeType(), 'Speed');

    // A change made during each busy operation must save as soon as it finishes.
    for (const flag of ['isSlicing', 'isModelLoading', 'isSelectingPreset', 'isRestoring']) {
      const before = await backup();
      const scheme = flag === 'isSlicing' || flag === 'isSelectingPreset' ? 'Height' : 'Speed';
      // Option edits cancel an active slice, so prepare the edit before setting the busy gate.
      await page.evaluate(note => window.__appStore.getState().applyOptionChange('notes', note, 'print'), flag);
      await page.evaluate(({ flag }) => {
        const store = flag === 'isRestoring' ? window.__historyStore : window.__appStore;
        store.setState({ [flag]: true });
      }, { flag });
      await page.selectOption('#view-type-select', scheme);
      await page.waitForTimeout(100);
      assert.equal((await backup()).savedAt, before.savedAt, `no write while ${flag}`);
      await page.evaluate(({ flag }) => {
        const store = flag === 'isRestoring' ? window.__historyStore : window.__appStore;
        store.setState({ [flag]: false });
      }, { flag });
      await waitForBackup(record => record?.notes === flag);
    }

    await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('autosave', false));
    const disabled = await backup();
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('notes', 'Disabled backup', 'print'));
    await page.selectOption('#view-type-select', 'Temperature');
    await page.waitForTimeout(700);
    assert.deepEqual(await backup(), disabled, 'disabled autosave stays disabled');
    await page.evaluate(key => localStorage.setItem(key, 'invalid-native-enum'), storageKey);
    await ready();
    await page.waitForSelector('#recovery-dialog');
    await page.click('#recovery-discard');
    await preview();
    assert.equal(await page.locator('#view-type-select').inputValue(), 'FeatureType');
    await page.evaluate(text => window.__previewStore.getState().loadGcodeBytes(text), gcode);
    assert.equal(await nativeType(), 'FeatureType');

    // An unavailable Storage API must not prevent using the selector.
    await page.evaluate(() => {
      Object.defineProperty(Storage.prototype, 'setItem', { value() { throw new Error('Storage unavailable'); }, configurable: true });
    });
    await page.selectOption('#view-type-select', 'Width');
    assert.equal(await nativeType(), 'Width');
    console.log(`${browserType.name()}: preview scheme survives refresh, native reload, and immediate/disabled/busy autosave checks`);
  } finally { await browser.close(); }
}

await startServer(port, 'preview-scheme-persistence');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
