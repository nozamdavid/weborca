#!/usr/bin/env node
/**
 * Browser test of the gateway on the user's computer, Chromium then Firefox. The app is served WITHOUT its own
 * printer gateway (like a hosted copy), a local gateway runs on loopback with the app's origin allowed, and a mock
 * Moonraker sits behind it. Checks the connection test, live status over the websocket, the camera image under
 * cross-origin isolation, and the printer web UI framed from its own <label>.localhost origin.
 */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startLocalGateway } from '../../app/gateway/local.ts';
import { startMockMoonraker } from '../node/lib/mockPrinters.mjs';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5112', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
delete process.env.ORCA_PRINTER_PROXY; // the app server has no gateway of its own

async function runSuite(browserType, name, mock, gateway) {
  mock.push({ extruder: { temperature: 210.2 } }); // the mock is shared by both browsers
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const frameResponses = [];
  page.on('response', (r) => r.url().includes('.localhost') && frameResponses.push(r));
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const text = (selector) => page.locator(selector).innerText();

  try {
    // A proxy or extension may strip the Referer; the camera and the frame must still be accepted.
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const meta = document.createElement('meta');
      meta.name = 'referrer';
      meta.content = 'no-referrer';
      document.head.append(meta);
    }));
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.click('#tab-device');
    await page.click('#device-add-printer');
    await page.waitForSelector('#printer-connection-dialog');

    log('the app server has no gateway, the local one is chosen in the dialog');
    await page.fill('#pc-name', 'Local Voron');
    await page.fill('#pc-host', `127.0.0.1:${mock.port}`);
    await page.fill('#pc-webui', `http://127.0.0.1:${mock.port}/ui`);
    await page.waitForFunction(() => /printer gateway is off/.test(document.getElementById('pc-gateway-status')?.textContent ?? ''));
    await page.check('#pc-local-gateway');
    await page.fill('#pc-local-gateway-url', `http://127.0.0.1:${gateway.port}`);
    await page.waitForFunction(() => /Gateway on: private networks only/.test(document.getElementById('pc-gateway-status')?.textContent ?? ''));
    log('discovery lists the printer found by the gateway and fills the form from it');
    await page.fill('#pc-host', '');
    await page.click('#pc-discover-btn');
    await page.waitForSelector('.pc-discovered');
    assert.match(await text('.pc-discovered'), new RegExp(`Moonraker.*127\\.0\\.0\\.1:${mock.port}`));
    await page.click('.pc-discovered button');
    assert.equal(await page.inputValue('#pc-host'), `127.0.0.1:${mock.port}`);
    await page.click('#pc-test');
    await page.waitForSelector('#pc-test-result');
    assert.equal(await text('#pc-test-result'), '✓ Moonraker v0.9.0-mock on mockhost, Klipper ready');

    log('an unreachable local gateway is explained');
    await page.fill('#pc-local-gateway-url', 'http://127.0.0.1:1');
    await page.click('#pc-test');
    await page.waitForFunction(() => document.getElementById('pc-test-result')?.dataset.ok === 'false');
    assert.match(await text('#pc-test-result'), /gateway on this computer/i);
    assert.match(await text('#pc-test-result'), /--allow-origin/);
    await page.fill('#pc-local-gateway-url', `http://127.0.0.1:${gateway.port}`);
    await page.click('#pc-save');
    await page.waitForSelector('#printer-connection-dialog', { state: 'detached' });

    log('the Device tab is live through the local gateway');
    await page.waitForSelector('#device-connection-dot[data-status="online"]');
    assert.equal(await text('[data-heater="extruder"] .device-row span:last-child'), '210.2 / 215 °C');
    mock.push({ extruder: { temperature: 211.5 } });
    await page.waitForFunction(() => document.querySelector('[data-heater="extruder"] .device-row span:last-child')?.textContent === '211.5 / 215 °C');

    log('the camera image loads from the local gateway under cross-origin isolation');
    const camera = page.locator('#device-camera img');
    assert.equal(await camera.getAttribute('src'), `http://127.0.0.1:${gateway.port}/_printer/http/127.0.0.1:${mock.port}/webcam/?action=stream`);
    assert.equal(await page.evaluate(() => crossOriginIsolated), true);
    for (let i = 0; i < 50 && !mock.httpRequests.some((r) => r.url.startsWith('/webcam/')); i++) await page.waitForTimeout(100);
    assert.ok(mock.httpRequests.some((r) => r.url.startsWith('/webcam/')), 'the gateway fetched the camera');

    log('the web UI is framed from its own <label>.localhost origin');
    const src = await page.locator('#device-webui-frame').getAttribute('src');
    assert.match(src, new RegExp(`^http://u[0-9a-f]{16}\\.localhost:${gateway.port}/$`));
    await page.waitForFunction(() => document.getElementById('device-webui-frame') !== null);
    for (let i = 0; i < 50 && !frameResponses.length; i++) await page.waitForTimeout(100);
    assert.equal(frameResponses.length > 0 && frameResponses[0].url(), src, 'the frame loaded its session address');
    assert.notEqual(frameResponses[0].status(), 403, 'the gateway accepted the frame');
    // The mock has no web UI, so its 404 reaches the frame; what matters is the framing headers.
    const headers = frameResponses[0].headers();
    assert.equal(headers['cross-origin-embedder-policy'], 'require-corp');
    assert.equal(headers['cross-origin-resource-policy'], 'cross-origin');
    assert.ok(mock.httpRequests.some((r) => r.url.startsWith('/ui/')), 'the base path of the UI address was used');

    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'printers-local');
const mock = await startMockMoonraker();
const gateway = await startLocalGateway({ allowedOrigins: [BASE_URL], port: 0, discover: { hosts: ['127.0.0.1'], ports: [mock.port], ssdp: false } });
try {
  await runSuite(chromium, 'chromium', mock, gateway);
  await runSuite(firefox, 'firefox', mock, gateway);
  console.log('All local gateway browser tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Local gateway browser tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await gateway.close();
  await mock.close();
  await stopServer(PORT);
}
