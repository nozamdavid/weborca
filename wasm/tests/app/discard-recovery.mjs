import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5273);
async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  const ready = async () => {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  };
  try {
    await ready();
    await page.evaluate(async () => {
      const app = window.__appStore.getState();
      window.__prefsStore.getState().setGeneralPref('autosaveIntervalSeconds', 5);
      await app.applyOptionChange('notes', 'Discard this project', 'print');
      await window.__autosave.writeAutosave();
      // A saved device restores its filament color at startup; this is not a new project edit.
      localStorage.setItem('orca-printers', JSON.stringify({ version: 1, state: {
        selectedPrinterId: 'discard-test', printers: [{
          id: 'discard-test', name: 'Recovery test device', host_type: 'moonraker',
          print_host: 'http://127.0.0.1:1', use_gateway: false,
          vendor: app.selectedVendor, preset: app.selectedPrinter,
          filamentPresets: [...app.selectedFilaments], filamentColors: ['#123456']
        }]
      } }));
    });
    await ready();
    await page.locator('#recovery-dialog').waitFor();
    await page.click('#recovery-discard');
    await page.locator('#recovery-dialog').waitFor({ state: 'detached' });
    await page.waitForTimeout(6000); // Include the first-save delay and a full autosave interval.
    assert.equal(await page.evaluate(() => window.__autosave.readAutosave()), undefined,
      'Discard must not be undone by startup device settings while the user does nothing');
    await ready();
    await page.waitForTimeout(6000);
    assert.equal(await page.locator('#recovery-dialog').count(), 0, 'a discarded recovery offer must not return');
    assert.equal(await page.evaluate(() => window.__autosave.readAutosave()), undefined, 'an idle refresh must not recreate the discarded session');
    await ready();
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('#recovery-dialog').count(), 0);
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('notes', 'A new edit', 'print'));
    await page.waitForFunction(async () => (await window.__autosave.readAutosave())?.setup?.options.notes === 'A new edit', null, { timeout: 10000 });
    console.log(`${browserType.name()}: discard survives idle intervals and reload; subsequent edits still autosave`);
  } finally { await browser.close(); }
}
await startServer(port, 'discard-recovery');
try { await suite(chromium); if (process.env.SKIP_FIREFOX !== '1') await suite(firefox); } finally { await stopServer(port); }
