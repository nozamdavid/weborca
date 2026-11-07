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
import { selectAddedPrinter } from './lib/printer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '5115', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE = fs.readFileSync(path.resolve(__dirname, '../../../tests/data/20mm_cube.obj'));

// The app server (vite preview) inherits this and turns its printer gateway on for private addresses.
process.env.ORCA_PRINTER_PROXY = 'private';
process.env.ORCA_PRINTER_CLOUD = 'bambu-cloud';

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
    await selectAddedPrinter(page, 'Voron');
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
    await selectAddedPrinter(page, 'Voron');
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

    // A finished slice on a connected printer replaces the Slice button with Send to printer.
    assert.equal(await page.locator('#slice-btn').count(), 0);
    assert.equal(await text('#send-to-printer-btn'), 'Send to printer');
    assert.match(await page.locator('#send-to-printer-btn').getAttribute('class'), /ds-btn|btn-slice/);
    await page.evaluate(() => window.__printerStore.setState({ status: 'error' }));
    await page.waitForSelector('#slice-btn', { state: 'attached' });
    await page.evaluate(() => window.__printerStore.setState({ status: 'online' }));
    await page.waitForSelector('#slice-btn', { state: 'detached' });

    await page.click('#tab-preview');
    await page.getByRole('button', { name: /Send to Printer/ }).click();
    await page.waitForSelector('#send-to-printer-dialog');
    assert.equal(await page.locator('#send-printer').inputValue(), await page.evaluate(() => window.__printerStore.getState().selectedPrinterId));
    await page.fill('#send-filename', 'plate one.gcode');
    await page.click('#send-upload');
    await page.waitForFunction(() => document.getElementById('send-result')?.dataset.ok === 'true');
    assert.equal(mock.uploads.at(-1).filename, 'plate one.gcode');
    assert.ok(mock.uploads.at(-1).content.length >= sliced.length, 'the printer received the sliced G-code with thumbnails');
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
const ffMock = await startMockFlashforge();
await startServer(PORT, 'printers');
async function runBambuCloudSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const log = (msg) => console.log(`[${name} Bambu Cloud] ${msg}`);
  const text = (selector) => page.locator(selector).innerText();

  try {
    await page.route('**/_printer/bambu-cloud/api/v1/user-service/user/login', async route => {
      const postData = JSON.parse(route.request().postData() || '{}');
      if (postData.account === 'test@example.com' && postData.password === 'challenge') {
        await route.fulfill({ status: 200, json: { loginType: 'verifyCode' } });
      } else if (postData.account === 'test@example.com' && (postData.password === 'good' || postData.code === '123456')) {
        await route.fulfill({ status: 200, json: { accessToken: 'valid_token' } });
      } else {
        await route.fulfill({ status: 400, json: { error: 'Bad login' } });
      }
    });

    await page.route('**/_printer/bambu-cloud/api/v1/design-user-service/my/preference', async route => {
      await route.fulfill({ status: 200, json: { uid: 9999 } });
    });

    await page.route('**/_printer/bambu-cloud/api/v1/iot-service/api/user/bind', async route => {
      if (route.request().headers().authorization === 'Bearer valid_token') {
        await route.fulfill({ status: 200, json: { devices: [{ dev_id: 'SER123', name: 'My Cloud Printer' }] } });
      } else {
        await route.fulfill({ status: 401, body: 'Unauthorized' });
      }
    });

    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.click('#tab-device');
    await page.click('#device-add-printer');
    await page.waitForSelector('#printer-connection-dialog');

    log('configure bambu cloud');
    await page.fill('#pc-name', 'Mock Bambu Cloud');
    await page.selectOption('#pc-host-type', 'bambu-cloud');

    await page.fill('#pc-cloud-account', 'test@example.com');
    await page.fill('#pc-cloud-password', 'wrong');
    await page.click('button:has-text("Log in / Get devices")');
    await page.waitForFunction(() => document.getElementById('pc-test-result')?.dataset.ok === 'false');

    await page.fill('#pc-cloud-password', 'challenge');
    await page.click('button:has-text("Log in / Get devices")');
    await page.waitForFunction(() => document.getElementById('pc-test-result')?.textContent.includes('Verification code required'));
    await page.fill('#pc-cloud-code', '123456');
    await page.click('button:has-text("Log in / Get devices")');
    await page.waitForFunction(() => document.getElementById('pc-test-result')?.dataset.ok === 'true');
    assert.equal(await page.inputValue('#pc-cloud-account'), 'test@example.com', 'the email remains editable after MQTT username lookup');

    await page.fill('#pc-cloud-password', 'good');
    await page.click('button:has-text("Log in / Get devices")');

    await page.waitForFunction(() => document.getElementById('pc-test-result')?.dataset.ok === 'true');
    assert.ok((await text('#pc-test-result')).includes('Found 1 devices.'));

    const serialValue = await page.inputValue('#pc-serial-select');
    assert.equal(serialValue, 'SER123');

    // Test connection with valid token
    await page.click('#pc-test');
    await page.waitForFunction(() => document.getElementById('pc-test-result')?.textContent.includes('Connected to My Cloud Printer'));

    assert.equal(await page.inputValue('#pc-cloud-account'), 'test@example.com');
    assert.doesNotMatch(await text('#pc-gateway-status'), /does not allow Prusa Connect/);
    await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('language', 'es'));
    await page.waitForSelector('button:has-text("Iniciar sesión / Obtener dispositivos")');
    assert.match(await page.locator('#pc-cloud-account').locator('..').innerText(), /Cuenta \(correo electrónico\)/);
    await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('language', 'en'));
    log('password, code challenge, re-login and test successful');
    await page.click('#pc-cancel');
  } finally {
    await browser.close();
  }
}

try {
  await runBambuCloudSuite(chromium, 'chromium');
  if (process.env.SKIP_FIREFOX !== '1') await runBambuCloudSuite(firefox, 'firefox');
  await runSuite(chromium, 'chromium', mock);
  if (process.env.SKIP_FIREFOX !== '1') await runSuite(firefox, 'firefox', mock);
  await runFlashforgeSuite(chromium, 'chromium', ffMock);
  if (process.env.SKIP_FIREFOX !== '1') await runFlashforgeSuite(firefox, 'firefox', ffMock);
  console.log('All printer tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Printer tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
  await mock.close();
  await ffMock.close();
}

import { startMockFlashforge } from '../node/lib/mockPrinters.mjs';

async function runFlashforgeSuite(browserType, name, mock) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const log = (msg) => console.log(`[${name} Flashforge] ${msg}`);
  const text = (selector) => page.locator(selector).innerText();

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.click('#tab-device');
    await page.click('#device-add-printer');
    await page.waitForSelector('#printer-connection-dialog');

    log('configure flashforge');
    await page.fill('#pc-name', 'Mock Flashforge');
    await page.selectOption('#pc-host-type', 'flashforge');
    await page.fill('#pc-host', `127.0.0.1:${mock.port}`);
    await page.fill('#pc-apikey', 'CODE');
    await page.fill('#pc-serial', 'FF123');

    await page.click('#pc-test');
    await page.waitForSelector('#pc-test-result');
    if (await text('#pc-test-result') !== '✓ Adventurer 5M Pro (fw 1.2.3) connected') {
       const res = await text('#pc-test-result');
       throw new Error(`Test connection failed: ${res}`);
    }

    await page.click('#pc-save');
    await page.waitForSelector('#printer-connection-dialog', { state: 'detached' });

    log('device tab connected');
    await page.waitForSelector('#device-connection-dot[data-status="online"]');

    await page.waitForFunction(() => document.getElementById('device-state')?.textContent === 'ready');
    assert.equal(await text('[data-heater="bed"] .device-row span:last-child'), '60.0 / 60 °C');
    assert.equal(await text('[data-heater="extruder"] .device-row span:last-child'), '210.0 / 210 °C');
    log('verified status and temperatures');

    // Test rejection
    await page.click('#tab-device');
    await page.click('#device-edit-printer');
    await page.fill('#pc-apikey', 'WRONG');
    await page.click('#pc-test');
    await page.waitForFunction(() => document.getElementById('pc-test-result')?.dataset.ok === 'false');
    const testRes = await text('#pc-test-result');
    if (!testRes.includes('Invalid credentials')) throw new Error('Did not reject invalid credentials: ' + testRes);
    await page.click('#pc-cancel');

    await page.click('#device-edit-printer');
    await page.click('#pc-delete');
  } finally {
    await browser.close();
  }
}

// Will run this at the bottom.
