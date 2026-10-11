import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5257);
const cube = readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');
const gcode = readFileSync(new URL('../parity/refs-macos-x86_64/cube-voron.gcode', import.meta.url), 'utf8');

async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(async () => {
      await window.__appStore.getState().chooseVendor('Voron');
      await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
    });
    await page.getByRole('tab', { name: 'Preview', exact: true }).click();
    await page.waitForFunction(() => window.__previewStore?.getState().isInitialized);
    async function loadFinished() {
      await page.evaluate(async text => {
        await window.__appStore.getState().openGcodeFile(new File([text], 'finished.gcode'));
      }, gcode);
      assert.equal(await page.evaluate(() => !!window.__appStore.getState().sliceResult?.gcode), true);
    }
    async function checkInvalidated() {
      assert.deepEqual(await page.evaluate(() => {
        const state = window.__appStore.getState();
        return { slice: state.sliceResult, url: state.gcodeUrl };
      }), { slice: null, url: null });
      await page.getByTestId('slice-outdated-banner').waitFor();
    }
    await loadFinished();
    await page.evaluate(async () => {
      const state = window.__appStore.getState();
      await state.chooseFilament(state.selectedFilament);
    });
    await checkInvalidated();
    await loadFinished();
    await page.evaluate(async () => window.__appStore.getState().addFilamentSlot());
    await checkInvalidated();
    await loadFinished();
    await page.evaluate(async () => window.__appStore.getState().removeFilamentSlot(1));
    await checkInvalidated();
    await page.evaluate(async () => {
      const state = window.__appStore.getState();
      await state.importPresetBundleAction({
        format: 'orcaslicer-web-preset-bundle', version: 1, exportedAt: new Date().toISOString(),
        presets: [{ kind: 'filament', name: 'Invalidation filament', inherits: state.selectedFilament, values: { nozzle_temperature: '235' } }]
      });
    });
    await loadFinished();
    await page.evaluate(async () => window.__appStore.getState().selectUserPreset('filament', 'Invalidation filament'));
    await checkInvalidated();
    await page.getByRole('tab', { name: 'Prepare', exact: true }).click();
    await page.evaluate(async text => {
      await window.__appStore.getState().importModelFile(new File([text], 'cube.obj'));
      window.__sliceUnderTest = window.__appStore.getState().startSlice();
    }, cube);
    await page.waitForFunction(() => window.__appStore.getState().isSlicing);
    const canceled = await page.evaluate(async () => {
      const state = window.__appStore.getState();
      const controller = state.abortController;
      const change = state.chooseFilament(state.filaments.find(p => p.isCompatible)?.name || state.selectedFilament);
      const aborted = controller.signal.aborted;
      await change;
      await window.__sliceUnderTest;
      delete window.__sliceUnderTest;
      return { aborted, slicing: window.__appStore.getState().isSlicing, slice: window.__appStore.getState().sliceResult };
    });
    assert.deepEqual(canceled, { aborted: true, slicing: false, slice: null });
    console.log(`${browserType.name()}: filament changes invalidate exports, prompt re-slice, and cancel running slices`);
  } finally { await browser.close(); }
}

await startServer(port, 'filament-slice-invalidation');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
