#!/usr/bin/env node
/**
 * Browser test of printer connections, Chromium then Firefox: the connection dialog, the Device tab
 * (native status dashboard and web UI pane), live updates, and Send to printer. The printer is a mock
 * Moonraker on 127.0.0.1 reached through the app server's gateway; nothing talks to a real printer.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startMockMoonraker } from '../node/lib/mockPrinters.mjs';
import { startServer, stopServer } from './lib/dist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '5111', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE = fs.readFileSync(path.resolve(__dirname, '../../../tests/data/20mm_cube.obj'));

// The app server (vite preview) inherits this and turns its printer gateway on for private addresses.
process.env.ORCA_PRINTER_PROXY = 'private';

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function runSuite(browserType, name, mock) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const text = (selector) => page.locator(selector).innerText();
  const heaterRow = (id) => page.locator(`[data-heater="${id}"]`);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.selectOption('#vendor-select', 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');

    log('the Device tab starts empty and offers to add a printer');
    await page.click('#tab-device');
    await page.waitForSelector('#device-add-printer');
    await page.click('#device-add-printer');
    await page.waitForSelector('#printer-connection-dialog');

    log('the dialog validates before it saves');
    assert.ok(await page.locator('#pc-save').isDisabled());
    assert.match(await text('#pc-validation'), /name/i);
    await page.fill('#pc-name', 'Mock Voron');
    assert.match(await text('#pc-validation'), /hostname/i);
    await page.fill('#pc-host', 'not a host');
    assert.match(await text('#pc-validation'), /not valid/i);

    log('the dialog reports the gateway and tests the connection');
    await page.fill('#pc-host', `127.0.0.1:${mock.port}`);
    await page.fill('#pc-webui', `http://127.0.0.1:${mock.port}/ui`);
    assert.match(await text('#pc-gateway-status'), /Gateway on: private networks only/);
    await page.click('#pc-test');
    await page.waitForSelector('#pc-test-result');
    assert.equal(await text('#pc-test-result'), '✓ Moonraker v0.9.0-mock on mockhost, Klipper ready');

    await page.fill('#pc-host', '127.0.0.1:1');
    await page.click('#pc-test');
    await page.waitForFunction(() => document.getElementById('pc-test-result')?.dataset.ok === 'false');
    assert.match(await text('#pc-test-result'), /refused/);

    await page.fill('#pc-host', `127.0.0.1:${mock.port}`);
    await page.click('#pc-save');
    await page.waitForSelector('#printer-connection-dialog', { state: 'detached' });

    log('the Device tab shows the live printer');
    await page.waitForSelector('#device-connection-dot[data-status="online"]');
    assert.equal(await text('#device-connection-status'), 'Connected');
    assert.match(await text('#device-state'), /^ready$/i);
    assert.match(await text('#device-temps'), /Extruder 0/);
    assert.equal(await text('[data-heater="extruder"] .device-row span:last-child'), '210.2 / 215 °C');
    assert.equal(await heaterRow('extruder1').count(), 1, 'every extruder is listed');
    assert.equal(await text('[data-heater="heater_bed"] .device-row span:last-child'), '60.1 / 60 °C');
    assert.match(await text('#device-motion'), /Part cooling\s*50%/);
    assert.match(await text('#device-files'), /new\.gcode/);
    const camera = await page.locator('#device-camera img').getAttribute('src');
    assert.equal(camera, `/_printer/http/127.0.0.1:${mock.port}/webcam/?action=stream`);

    log('the web UI pane loads the printer UI address');
    assert.equal(await page.locator('#device-webui-frame').getAttribute('src'), `http://127.0.0.1:${mock.port}/ui/`);
    assert.equal(await page.locator('#device-webui-open').getAttribute('href'), `http://127.0.0.1:${mock.port}/ui/`);

    log('live updates arrive without reloading');
    mock.push({
      print_stats: { state: 'printing', filename: 'cube.gcode', print_duration: 300, info: { current_layer: 12, total_layer: 40 } },
      virtual_sdcard: { progress: 0.25 },
      extruder: { temperature: 214.9 }
    });
    await page.waitForFunction(() => document.getElementById('device-state')?.textContent === 'printing');
    assert.match(await text('#device-job'), /cube\.gcode/);
    assert.match(await text('#device-job'), /25\.0%/);
    assert.match(await text('#device-job'), /Layer\s*12 \/ 40/);
    assert.match(await text('#device-job'), /Remaining\s*15m/);
    assert.equal(await text('[data-heater="extruder"] .device-row span:last-child'), '214.9 / 215 °C');
    mock.push({ print_stats: { state: 'standby', filename: '' }, virtual_sdcard: { progress: 0 }, extruder: { temperature: 210.2 } });
    await page.waitForFunction(() => document.getElementById('device-state')?.textContent === 'ready');

    log('the sidebar shows the connection');
    await page.click('#tab-prepare');
    await page.locator('#printer-connection-btn .status-dot[data-status="online"]').waitFor();

    log('the printer survives a reload');
    await page.reload();
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.waitForFunction(() => window.__printerStore?.getState().status === 'online');
    assert.equal(await page.evaluate(() => window.__printerStore.getState().printers[0].name), 'Mock Voron');

    log('send to printer uploads the exact G-code and starts a print only after a confirmation');
    await page.selectOption('#vendor-select', 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.evaluate(async (bytes) => {
      await window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], 'cube.obj'));
    }, Array.from(CUBE));
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1);
    await page.waitForFunction(() => !document.getElementById('slice-btn')?.disabled);
    await page.click('#slice-btn');
    await page.waitForFunction(() => {
      const s = window.__appStore.getState();
      return !s.isSlicing && s.sliceResult;
    }, null, { timeout: 180000 });
    const sliced = await page.evaluate(async () => {
      const bytes = window.__appStore.getState().sliceResult.gcode;
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return { length: bytes.length, sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') };
    });

    await page.click('#tab-preview');
    await page.getByRole('button', { name: /Send to Printer/ }).click();
    await page.waitForSelector('#send-to-printer-dialog');
    assert.equal(await page.locator('#send-printer').inputValue(), await page.evaluate(() => window.__printerStore.getState().selectedPrinterId));
    await page.fill('#send-filename', 'plate one.gcode');
    await page.click('#send-upload');
    await page.waitForFunction(() => document.getElementById('send-result')?.dataset.ok === 'true');
    assert.equal(mock.uploads.at(-1).filename, 'plate one.gcode');
    assert.equal(mock.uploads.at(-1).content.length, sliced.length);
    assert.equal(sha256(mock.uploads.at(-1).content), sliced.sha256, 'the printer received the exact G-code');
    assert.equal(mock.uploads.at(-1).print, false);
    assert.deepEqual(mock.started, []);

    await page.click('#send-print');
    assert.match(await text('#send-confirm-text'), /starts printing on Mock Voron right away/);
    assert.deepEqual(mock.started, [], 'the first click only asks for confirmation');
    await page.click('#send-print-confirm');
    await page.waitForFunction(() => /print is starting/.test(document.getElementById('send-result')?.textContent ?? ''));
    assert.equal(mock.uploads.at(-1).print, true);
    assert.deepEqual(mock.started, ['plate one.gcode']);
    await page.click('#send-close');
    mock.started.length = 0;
    mock.push({ print_stats: { state: 'standby', filename: '' } });

    log('removing the printer empties the Device tab again');
    await page.click('#tab-device');
    await page.click('#device-edit-printer');
    await page.click('#pc-delete');
    await page.waitForSelector('#device-add-printer');
    assert.equal(await page.evaluate(() => window.__printerStore.getState().printers.length), 0);

    log('all checks passed');
  } finally {
    await browser.close();
  }
}

const mock = await startMockMoonraker();
await startServer(PORT, 'printers');
try {
  await runSuite(chromium, 'chromium', mock);
  await runSuite(firefox, 'firefox', mock);
  console.log('All printer tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Printer tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
  await mock.close();
}
