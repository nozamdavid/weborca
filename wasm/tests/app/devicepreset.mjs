#!/usr/bin/env node
/** Browser test: the Prepare tab's printer follows the selected device, the choice is made in the sidebar and survives a refresh. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5143', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const device = (id, name, preset, vendor) => ({ id, name, preset, vendor, host_type: 'moonraker', print_host: '127.0.0.1:1', use_gateway: false });
const VORON = 'Voron 2.4 300 0.4 nozzle';
const BAMBU = 'Bambu Lab X1 Carbon 0.4 nozzle';

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  await context.addInitScript((seed) => {
    if (!localStorage.getItem('orca-printers')) localStorage.setItem('orca-printers', JSON.stringify(seed));
  }, { version: 1, state: { printers: [device('a', 'Voron at home', VORON, 'Voron'), device('b', 'Bambu at work', BAMBU, undefined)], selectedPrinterId: 'b' } });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const preset = () => page.evaluate(() => window.__appStore.getState().selectedPrinter);
  const ready = async () => {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  };

  try {
    await ready();
    log('the last used device decides the printer at start');
    await page.waitForFunction((p) => window.__appStore.getState().selectedPrinter === p, BAMBU, { timeout: 60000 });
    assert.equal(await page.locator('#device-select').inputValue(), 'b');
    assert.equal(await page.evaluate(() => window.__printerStore.getState().printers.find(p => p.id === 'b').vendor), 'BBL', 'legacy device brand resolved and persisted');

    log('choosing another device in the sidebar switches the printer');
    await page.selectOption('#device-select', 'a');
    await page.waitForFunction((p) => window.__appStore.getState().isEngineReady && window.__appStore.getState().selectedPrinter === p, VORON, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.__appStore.getState().selectedVendor), 'Voron');

    log('the printer dialog lets you pick any brand and lists its printers');
    await page.evaluate(() => window.__printerStore.getState().openDialog(null));
    await page.waitForSelector('#pc-brand');
    await page.selectOption('#pc-brand', 'Creality');
    await page.waitForFunction(() => [...document.querySelectorAll('#pc-preset option')].some((o) => o.value.startsWith('Creality')), null, { timeout: 60000 });
    const options = await page.$$eval('#pc-preset option', (os) => os.map((o) => o.value).filter((n) => n.startsWith('Creality')));
    assert.ok(options.length > 5, 'Creality printers listed');
    await page.selectOption('#pc-preset', options[0]);
    await page.keyboard.press('Escape');
    await page.click('[data-testid=confirm-ok]');

    log('prepare filament slots and colors persist with the selected device');
    const savedFilaments = await page.evaluate(async () => {
      const app = window.__appStore.getState();
      await app.chooseFilament('Generic PLA @System', 0);
      await window.__appStore.getState().chooseFilament('Generic PETG @System', 1);
      await window.__appStore.getState().setSlotColor(0, '#123456');
      await window.__appStore.getState().setSlotColor(1, '#fedcba');
      return window.__appStore.getState().selectedFilaments;
    });
    await page.waitForFunction(() => {
      const device = window.__printerStore.getState().printers.find(p => p.id === 'a');
      return device?.filamentPresets?.length === 2 && device?.filamentColors?.[1]?.toLowerCase() === '#fedcba';
    });
    log('the choice is remembered after a refresh');
    await page.reload();
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.waitForFunction((p) => window.__appStore.getState().selectedPrinter === p, VORON, { timeout: 60000 });
    assert.equal(await page.locator('#device-select').inputValue(), 'a');
    assert.equal(await preset(), VORON);
    const restored = await page.evaluate(() => ({
      filaments: window.__appStore.getState().selectedFilaments,
      colors: window.__appStore.getState().currentConfig.filament_colour
    }));
    assert.deepEqual(restored.filaments, savedFilaments);
    assert.equal(restored.colors.toLowerCase(), '#123456;#fedcba');
    log('all checks passed');
  } finally {
    await browser.close();
  }
}
await startServer(PORT, 'devicepreset');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All device preset tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Device preset tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
