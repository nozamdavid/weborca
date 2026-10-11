#!/usr/bin/env node
/** Exercises read-only cloud login/device persistence using browser-intercepted first-party response shapes. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
const port = Number(process.env.PORT || 5187);
process.env.ORCA_PRINTER_CLOUD = 'creality-cloud';
const device = { deviceName: 'mock-k2-dn', tbId: 'mock-tb-id', aliasName: 'Mock K2', model: 'K2 Plus', type: 1,
  deviceState: 1, multicolor: true, printInfo: { printProgress: 1, modelName: 'cube.gcode' },
  iotTelemetry: [{ key: 'layer', value: 3 }, { key: 'printLeftTime', value: 120 }] };
async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let qrPolls = 0;
  let qrAuthorized = false;
  const requests = [];
  await page.route('**/_printer/creality-cloud/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON();
    requests.push({ path: url.pathname, method: request.method(), body });
    let payload;
    if (url.pathname.endsWith('/qrLogin')) payload = { code: 0, result: { identical: 'mock-qr', expireTime: Math.floor(Date.now() / 1000) + 120 } };
    else if (url.pathname.endsWith('/qrQuery')) {
      qrPolls++;
      payload = { code: 0, result: qrAuthorized ? { state: 3, token: 'mock-token', userId: '42' } : { state: 1 } };
    } else if (url.pathname.endsWith('/loginV2')) payload = body?.password === 'correct' ? { code: 0, result: { token: 'mock-token', userId: '42' } } : { code: 4, msg: 'Incorrect password' };
    else if (url.pathname.endsWith('/getDevices')) payload = { code: 0, result: { totalCount: 1, list: [device] } };
    else if (url.pathname.endsWith('/pollState')) payload = { code: 0, result: [device] };
    else if (url.pathname.includes('/values/timeseries')) payload = { code: 0, result: { nozzleTemp: [{ ts: 1, value: 210 }], bedTemp: [{ ts: 1, value: 60 }] } };
    else if (url.pathname.includes('/values/attributes')) payload = { code: 0, result: [{ key: 'nozzleTemp2', value: 215 }, { key: 'bedTemp2', value: 65 }, { key: 'TotalLayer', value: 100 }] };
    else if (url.pathname.includes('/rpc/twoway/')) {
      assert.deepEqual(body, { method: 'get', params: { cfsList: 1 } });
      payload = { code: 0, result: { cfsList: [{ portList: [{ rfidState: 1, filamentType: 'PLA', filamentsColor: '#FFFF0000' }, { rfidState: 0, filamentType: 'ABS' }] }] } };
    } else throw new Error(`Unexpected cloud request: ${url.pathname}`);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
  });
  const log = text => console.log(`${browserType.name()}: ${text}`);
  try {
    log('initialize');
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    log('QR and login-mode cancellation');
    await page.click('#tab-device');
    await page.click('#device-add-printer');
    await page.fill('#pc-name', 'Cloud K2');
    await page.selectOption('#pc-host-type', 'creality-cloud');
    await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('language', 'es'));
    assert.match(await page.locator('#printer-connection-dialog').innerText(), /Iniciar sesión en Creality Cloud/);
    await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('language', 'en'));
    await page.click('#cc-show-qr');
    await page.waitForSelector('#cc-qr svg, svg#cc-qr');
    await page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/qrQuery'), { timeout: 10000 });
    assert.ok(qrPolls > 0, 'epoch-seconds QR remains valid and polls');
    assert.doesNotMatch(await page.locator('#printer-connection-dialog').innerText(), /QR code expired/);
    await page.getByRole('button', { name: 'Account / Password', exact: true }).click();
    const stoppedPolls = qrPolls;
    await page.waitForTimeout(2800);
    assert.equal(qrPolls, stoppedPolls, 'switching login modes stops QR polling');
    log('password login');
    await page.fill('#cc-account', 'mock@example.com');
    await page.fill('#cc-password', 'wrong');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.waitForSelector('#cc-error');
    assert.match(await page.locator('#cc-error').innerText(), /password/);
    await page.fill('#cc-password', 'correct');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.locator('[data-testid=cc-device]').first().click();
    assert.equal(await page.locator('#pc-save').isDisabled(), false);
    log('connection test and save');
    await page.click('#pc-test');
    await page.waitForFunction(() => document.querySelector('#pc-test-result')?.dataset.ok === 'true');
    await page.click('#pc-save');
    await page.waitForSelector('#device-connection-dot[data-status="online"]');
    assert.match(await page.locator('#device-state').innerText(), /printing/i);
    assert.equal(await page.locator('[role="progressbar"]').getAttribute('aria-valuenow'), '1');
    assert.match(await page.locator('#device-temps').innerText(), /210.*215/);
    log('inventory and recovery');
    const state = await page.evaluate(() => window.__printerStore.getState().liveState);
    assert.equal(state.filaments.length, 1);
    assert.equal(state.filaments[0].material, 'PLA');
    assert.equal(state.filaments[0].color.toLowerCase(), '#ff0000');
    const before = await page.evaluate(() => window.__printerStore.getState().printers[0]);
    await page.reload();
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    const restored = await page.evaluate(() => window.__printerStore.getState().printers[0]);
    assert.equal(restored.serial, before.serial);
    assert.equal(restored.cloud_device_id, 'mock-tb-id');
    assert.equal(restored.cloud_region, 'global');
    log('QR authorization and China region');
    await page.click('#tab-device');
    await page.click('#device-add-another');
    await page.fill('#pc-name', 'QR Cloud K2');
    await page.selectOption('#pc-host-type', 'creality-cloud');
    await page.selectOption('#cc-region', 'china');
    qrAuthorized = true;
    await page.click('#cc-show-qr');
    await page.locator('[data-testid=cc-device]').first().click();
    await page.click('#pc-save');
    await page.waitForFunction(() => window.__printerStore.getState().printers.length === 2);
    const qrPrinter = await page.evaluate(() => window.__printerStore.getState().printers.find(p => p.name === 'QR Cloud K2'));
    assert.equal(qrPrinter.cloud_region, 'china');
    assert.equal(qrPrinter.cloud_device_id, 'mock-tb-id');
    assert.equal(qrPrinter.printhost_user, '42');
    assert.ok(requests.some(r => r.path.includes('/china/auth/') && r.path.endsWith('/qrQuery')));
    assert.ok(requests.every(r => !/upload|addSingleTask|rpc\/oneway/.test(r.path)));
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()}: Creality cloud QR/password/status/CFS/recovery passed`);
  } catch (error) {
    console.error(await page.evaluate(() => ({ ready: window.__appStore?.getState().isEngineReady, error: window.__appStore?.getState().engineError, isolated: crossOriginIsolated })));
    throw error;
  } finally { await browser.close(); }
}
await startServer(port, 'creality-cloud');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
