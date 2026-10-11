import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
const port = 5293;
const cube = readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');
async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(async text => {
      window.__prefsStore.getState().setGeneralPref('autosaveIntervalSeconds', 3600);
      await window.__appStore.getState().importModelFile(new File([text], 'cube.obj'));
      await window.__appStore.getState().applyOptionChange('enable_support', '0', 'print');
      const engine = window.__orcaEngine, original = engine._call.bind(engine);
      let busy = false;
      const gate = new Promise(resolve => { window.__releaseSave = resolve; });
      engine._call = async (...args) => {
        if (args[0] === 'saveProject') { busy = true; window.__saveStarted = true; }
        if (busy) await gate;
        return original(...args);
      };
      window.__savePromise = window.__autosave.writeAutosave();
    }, cube);
    await page.waitForFunction(() => window.__saveStarted);
    await page.click('#quick-support');
    await page.waitForTimeout(150);
    assert.equal(await page.isChecked('#quick-support'), true, 'Support responds before the slow autosave finishes');
    assert.equal(await page.evaluate(() => window.__appStore.getState().currentConfig.enable_support), '0', 'native config remains truthful while the edit is queued');
    assert.equal(await page.getAttribute('#quick-support', 'aria-busy'), 'true');
    await page.evaluate(() => window.__appStore.getState().setActivePrintPage('Support'));
    assert.equal(await page.isChecked('#setting-input-enable_support'), true, 'both support controls show the same queued choice');
    await page.click('#quick-support');
    assert.equal(await page.isChecked('#quick-support'), false, 'a second click updates the queued choice');
    await page.click('#quick-support');
    await page.evaluate(() => { window.__slicePromise = window.__appStore.getState().startSlice(); });
    assert.equal(await page.evaluate(() => window.__appStore.getState().isSlicing), false, 'slicing waits for queued settings');
    await page.evaluate(() => window.__releaseSave());
    await page.evaluate(() => window.__savePromise);
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.enable_support === '1' && !Object.keys(window.__appStore.getState().pendingOptions).length);
    await page.evaluate(() => window.__slicePromise);
    assert.equal(await page.evaluate(() => !!window.__appStore.getState().sliceResult), true, 'slicing continues after the edit is confirmed');
    assert.equal(await page.evaluate(async () => (await window.__autosave.readAutosave()).setup.options.enable_support), '1', 'the pre-slice backup contains the confirmed support setting');
    await page.getByRole('tab', { name: 'Prepare', exact: true }).click();
    await page.evaluate(() => window.__appStore.getState().setActivePrintPage('Support'));
    await page.click('#setting-input-enable_support');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.enable_support === '0');
    await page.evaluate(() => {
      const engine = window.__orcaEngine, original = engine._call.bind(engine);
      engine._call = (...args) => args[0] === 'setOptions' ? Promise.reject(new Error('Rejected test setting')) : original(...args);
    });
    await page.click('#quick-support');
    await page.waitForFunction(() => window.__appStore.getState().engineError?.includes('Rejected test setting') && !Object.keys(window.__appStore.getState().pendingOptions).length);
    assert.equal(await page.isChecked('#quick-support'), false, 'a rejected edit restores the confirmed value');
    console.log(`${browserType.name()}: settings remain responsive during autosave and the latest queued choice reaches the engine`);
  } finally { await browser.close(); }
}
await startServer(port, 'settings-during-autosave');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
