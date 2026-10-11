import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startMockMoonraker } from '../node/lib/mockPrinters.mjs';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5275);
async function suite(browserType) {
  const mock = await startMockMoonraker({ filamentStatus: {
    filament_detect: { info: [{ MAIN_TYPE: 'NONE' }, { MAIN_TYPE: 'PLA', ARGB_COLOR: 0xff119944 }, { MAIN_TYPE: 'NONE' }, { MAIN_TYPE: 'NONE' }] },
    print_task_config: { filament_type: ['NONE', 'PLA', 'NONE', 'PETG'], filament_color: [0xffffffff, 0xff119944, 0xffffffff, 0xff2244bb], filament_exist: [false, true, false, true] },
    'filament_feed left': { extruder0: { filament_detected: false }, extruder1: { filament_detected: true } },
    'filament_feed right': { extruder2: { filament_detected: false }, extruder3: { filament_detected: true } }
  } });
  const browser = await browserType.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(async mockPort => {
      await window.__appStore.getState().chooseVendor('Snapmaker');
      await window.__appStore.getState().choosePrinter('Snapmaker U1 (0.4 nozzle)');
      window.__printerStore.getState().savePrinter({ id: 'sync-test', name: 'Mock U1', vendor: 'Snapmaker', preset: 'Snapmaker U1 (0.4 nozzle)', host_type: 'moonraker', print_host: `127.0.0.1:${mockPort}`, use_gateway: false });
    }, mock.port);
    await page.waitForFunction(() => window.__appStore.getState().isEngineReady && window.__printerStore.getState().liveState?.filaments?.length === 2);
    const before = await page.evaluate(() => [...window.__appStore.getState().selectedFilaments]);
    await page.click('#sync-printer-filaments');
    await page.locator('#sync-filaments-apply').waitFor();
    assert.match(await page.getByRole('dialog').innerText(), /T1.*PLA/);
    assert.match(await page.getByRole('dialog').innerText(), /T3.*PETG/);
    await page.click('#sync-filaments-apply');
    await page.locator('#sync-filaments-apply').waitFor({ state: 'detached' });
    const result = await page.evaluate(() => {
      const app = window.__appStore.getState();
      return { presets: app.selectedFilaments, colors: app.currentConfig.filament_colour.split(';'), device: window.__printerStore.getState().printers[0], error: app.engineError };
    });
    assert.equal(result.error, null);
    assert.equal(result.presets[0], before[0], 'unreported T0 stays unchanged');
    if (before[2]) assert.equal(result.presets[2], before[2], 'unreported T2 stays unchanged');
    assert.equal(result.presets.length, 4, 'missing intermediate slots preserve physical tool numbering');
    assert.match(result.presets[1], /PLA/);
    assert.match(result.presets[3], /PETG/);
    assert.equal(result.colors[1], '#119944');
    assert.equal(result.colors[3], '#2244BB');
    assert.deepEqual(result.device.filamentPresets, result.presets);
    assert.deepEqual(result.device.filamentColors, result.colors);
    assert.equal(mock.rpcMethods.filter(method => method === 'server.connection.identify').length, 1, 'saving sync results keeps the live connection open');
    await page.reload();
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady && window.__appStore.getState().selectedFilaments.length === 4, null, { timeout: 90000 });
    const restored = await page.evaluate(() => ({ presets: window.__appStore.getState().selectedFilaments, colors: window.__appStore.getState().currentConfig.filament_colour.split(';') }));
    assert.deepEqual(restored.presets, result.presets);
    assert.deepEqual(restored.colors, result.colors);
    assert.equal(mock.uploads.length, 0);
    assert.equal(mock.started.length, 0);
    assert.ok(mock.rpcMethods.every(method => ['server.connection.identify', 'server.info', 'printer.objects.list', 'printer.objects.subscribe', 'server.webcams.list', 'server.files.list', 'printer.info'].includes(method)));
    console.log(`${browserType.name()}: Moonraker discovery, sparse T1/T3 sync, native config and refresh recovery pass without printer writes`);
  } finally { await browser.close(); await mock.close(); }
}
await startServer(port, 'klipper-filament-sync');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
