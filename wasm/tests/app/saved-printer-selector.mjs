#!/usr/bin/env node
/** Browser test of the sidebar printer dropdown: added profiles across brands, the Add printer modal, device binding and persistence. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5132', 10);
const VORON = 'Voron 2.4 300 0.4 nozzle';
const BAMBU = 'Bambu Lab X1 Carbon 0.4 nozzle';
// Local, unreachable hosts only: the test never contacts a real printer.
const device = (id) => ({ id, name: `Device ${id}`, host_type: 'moonraker', print_host: '127.0.0.1:9' });

await startServer(PORT, 'saved-printer-selector', { frozenDist: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  // Seed the wizard's added printers (two brands) and two devices without a profile, once per fresh context.
  await context.addInitScript(({ voron, bambu, a, b }) => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('orca.wizard', JSON.stringify({ printers: [voron, bambu], filaments: [] }));
    localStorage.setItem('orca-printers', JSON.stringify({ state: { printers: [a, b], selectedPrinterId: null }, version: 1 }));
  }, { voron: VORON, bambu: BAMBU, a: device('A'), b: device('B') });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === `http://127.0.0.1:${PORT}` && !/^\/(api|gateway|printer|cloud|device|_printer|_gw|_cloud|_orca-cloud)(\/|$)/.test(url.pathname) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err));
  const ready = () => page.waitForFunction(() => window.__appStore?.getState().isEngineReady && !window.__appStore.getState().isSelectingPreset, null, { timeout: 90000 });
  const devices = () => page.evaluate(() => Object.fromEntries(window.__printerStore.getState().printers.map((p) => [p.id, p.preset ?? null])));
  const options = () => page.evaluate(() => [...document.querySelectorAll('#printer-select option')].map((o) => o.value));
  await page.goto(`http://127.0.0.1:${PORT}`);
  await ready();

  console.log('one dropdown lists both brands and ends with Add printer...');
  assert.equal(await page.locator('#vendor-select').count(), 0, 'no brand dropdown');
  assert.equal(await page.locator('#add-printers-btn').count(), 0, 'no separate add button');
  const list = await options();
  assert.ok(list.includes(VORON) && list.includes(BAMBU), JSON.stringify(list));
  assert.match(await page.locator('#printer-select option').last().textContent(), /Add printer/);

  console.log('a pick without a device changes no device');
  await page.selectOption('#printer-select', BAMBU);
  await page.waitForFunction((n) => window.__appStore.getState().selectedPrinter === n && window.__appStore.getState().selectedVendor === 'BBL' && !window.__appStore.getState().isSelectingPreset, BAMBU, { timeout: 90000 });
  assert.deepEqual(await devices(), { A: null, B: null });

  console.log('a pick binds only the selected device');
  await page.evaluate(() => window.__printerStore.getState().selectPrinter('A'));
  await ready();
  await page.selectOption('#printer-select', VORON);
  await page.waitForFunction(() => window.__printerStore.getState().printers.find((p) => p.id === 'A')?.preset, null, { timeout: 90000 });
  assert.deepEqual(await devices(), { A: VORON, B: null });
  assert.equal(await page.evaluate(() => window.__appStore.getState().selectedVendor), 'Voron');

  console.log('Add printer... opens the modal and keeps the selection');
  await page.selectOption('#printer-select', '__add_printer__');
  await page.waitForSelector('#wizard-dialog');
  assert.equal(await page.locator('#printer-select').inputValue(), VORON);
  await page.getByRole('button', { name: 'Close' }).first().click();

  console.log('the selection persists across a reload');
  await page.reload();
  await ready();
  await page.waitForFunction((n) => document.querySelector('#printer-select')?.value === n, VORON, { timeout: 60000 });
  assert.deepEqual(await devices(), { A: VORON, B: null });
  const after = await options();
  assert.ok(after.includes(VORON) && after.includes(BAMBU));
  console.log('all checks passed');
} catch (err) {
  console.error('Saved printer selector tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
  await stopServer(PORT);
}
