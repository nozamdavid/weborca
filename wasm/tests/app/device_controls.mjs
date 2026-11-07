#!/usr/bin/env node
/**
 * Browser test of Device Tab Controls: Chromium and Firefox.
 * Tests manual controls (Home, Jog, Extrude, Temps, Fan, Speed, Pause/Resume/Cancel),
 * safety restrictions (disabling while printing, disabling when offline, high temp warning > 260C, cancel confirmation),
 * and capability hiding for Moonraker, OctoPrint, PrusaLink, and Bambu.
 *
 * SAFETY: Uses fake local mock servers on 127.0.0.1. Never contacts real printers.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import wsPkg from '../../app/node_modules/ws/index.js';
const { WebSocketServer } = wsPkg;
import { Aedes } from '../../app/node_modules/aedes/aedes.js';
import { digestAuthorization } from '../../app/gateway/policy.ts';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '5170', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

process.env.ORCA_PRINTER_PROXY = 'private';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

// -----------------------------------------------------------------------------
// 1. Fake Moonraker Server
// -----------------------------------------------------------------------------
async function startFakeMoonraker() {
  const gcodeScripts = [];
  const printCommands = [];
  const sockets = new Set();
  let printState = 'ready';

  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    const bodyStr = raw.toString('utf8');
    let bodyObj;
    try { bodyObj = JSON.parse(bodyStr); } catch { /* ignore */ }
    const urlPath = req.url.split('?')[0];

    if (urlPath === '/server/info') {
      return json(res, 200, { result: { klippy_connected: true, klippy_state: 'ready', moonraker_version: 'v0.9.0-mock', components: [] } });
    }
    if (urlPath === '/printer/info') {
      return json(res, 200, { result: { state: 'ready', hostname: 'mockmoonraker', software_version: 'v0.12.0-mock' } });
    }
    if (urlPath === '/printer/gcode/script' && req.method === 'POST') {
      if (bodyObj?.script) gcodeScripts.push(bodyObj.script);
      return json(res, 200, { result: 'ok' });
    }
    if (urlPath === '/printer/print/pause' && req.method === 'POST') {
      printCommands.push('pause');
      return json(res, 200, { result: 'ok' });
    }
    if (urlPath === '/printer/print/resume' && req.method === 'POST') {
      printCommands.push('resume');
      return json(res, 200, { result: 'ok' });
    }
    if (urlPath === '/printer/print/cancel' && req.method === 'POST') {
      printCommands.push('cancel');
      return json(res, 200, { result: 'ok' });
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server, path: '/websocket' });
  wss.on('connection', (ws) => {
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', (data) => {
      const { method, id } = JSON.parse(data.toString());
      const reply = (result) => ws.send(JSON.stringify({ jsonrpc: '2.0', result, id }));
      switch (method) {
        case 'server.connection.identify': return reply({ connection_id: 1 });
        case 'server.info': return reply({ components: [] });
        case 'printer.objects.list': return reply({ objects: ['print_stats', 'toolhead', 'heater_bed', 'extruder'] });
        case 'printer.objects.subscribe': return reply({ eventtime: 1, status: {
          webhooks: { state: 'ready', state_message: 'Printer is ready' },
          print_stats: { state: printState, filename: '', print_duration: 0, message: '' },
          toolhead: { position: [10, 20, 30, 0], extruder: 'extruder' },
          extruder: { temperature: 200, target: 200 },
          heater_bed: { temperature: 60, target: 60 }
        } });
        case 'server.webcams.list': return reply({ webcams: [] });
        case 'server.files.list': return reply([]);
        case 'printer.info': return reply({ state: 'ready', hostname: 'mockmoonraker', software_version: 'v0.12.0-mock' });
        default: return ws.send(JSON.stringify({ jsonrpc: '2.0', result: {}, id }));
      }
    });
  });

  const port = await listen(server);
  return {
    port,
    gcodeScripts,
    printCommands,
    pushStatus(patch) {
      if (patch.print_stats?.state) printState = patch.print_stats.state;
      const message = JSON.stringify({ jsonrpc: '2.0', method: 'notify_status_update', params: [patch, Date.now() / 1000] });
      sockets.forEach((s) => s.send(message));
    },
    close: () => {
      sockets.forEach((s) => s.terminate());
      server.closeAllConnections();
      return new Promise((r) => server.close(r));
    }
  };
}

// -----------------------------------------------------------------------------
// 2. Fake OctoPrint Server
// -----------------------------------------------------------------------------
async function startFakeOctoPrint() {
  const printheadCommands = [];
  const toolCommands = [];
  const bedCommands = [];
  const gcodeCommands = [];
  const jobCommands = [];

  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    let bodyObj;
    try { bodyObj = JSON.parse(raw.toString('utf8')); } catch { /* ignore */ }
    const urlPath = req.url.split('?')[0];

    if (urlPath === '/api/version') return json(res, 200, { api: '0.1', server: '1.10.0', text: 'OctoPrint 1.10.0' });
    if (urlPath === '/api/printer') {
      return json(res, 200, {
        state: { text: 'Operational', flags: { operational: true, printing: false, paused: false, ready: true } },
        temperature: { tool0: { actual: 200, target: 200 }, bed: { actual: 60, target: 60 } }
      });
    }
    if (urlPath === '/api/job' && req.method === 'GET') {
      return json(res, 200, { state: 'Operational', job: { file: { name: null } }, progress: {} });
    }
    if (urlPath === '/api/printer/printhead' && req.method === 'POST') {
      printheadCommands.push(bodyObj);
      res.writeHead(204);
      return res.end();
    }
    if (urlPath === '/api/printer/tool' && req.method === 'POST') {
      toolCommands.push(bodyObj);
      res.writeHead(204);
      return res.end();
    }
    if (urlPath === '/api/printer/bed' && req.method === 'POST') {
      bedCommands.push(bodyObj);
      res.writeHead(204);
      return res.end();
    }
    if (urlPath === '/api/printer/command' && req.method === 'POST') {
      gcodeCommands.push(bodyObj);
      res.writeHead(204);
      return res.end();
    }
    if (urlPath === '/api/job' && req.method === 'POST') {
      jobCommands.push(bodyObj);
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });

  const port = await listen(server);
  return {
    port,
    printheadCommands,
    toolCommands,
    bedCommands,
    gcodeCommands,
    jobCommands,
    close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); }
  };
}

// -----------------------------------------------------------------------------
// 3. Fake PrusaLink Server
// -----------------------------------------------------------------------------
async function startFakePrusaLink({ user = 'maker', password = 'secret' } = {}) {
  const challenge = { realm: 'Printer API', nonce: 'nonce123', qop: 'auth' };
  const jobCommands = [];

  const server = http.createServer(async (req, res) => {
    await readBody(req);
    const auth = req.headers.authorization;
    if (!auth) {
      res.writeHead(401, { 'www-authenticate': `Digest realm="${challenge.realm}", qop="auth", nonce="${challenge.nonce}"` });
      return res.end();
    }
    const fields = Object.fromEntries([...auth.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)].map((m) => [m[1], m[2] ?? m[3]]));
    const expected = digestAuthorization(challenge, user, password, req.method, req.url, parseInt(fields.nc, 16), fields.cnonce);
    if (expected !== auth) {
      res.writeHead(401, { 'www-authenticate': `Digest realm="${challenge.realm}", qop="auth", nonce="${challenge.nonce}"` });
      return res.end();
    }

    const urlPath = req.url.split('?')[0];
    if (urlPath === '/api/version') return json(res, 200, { api: 'v1', server: '2.0.0', text: 'PrusaLink 2.0.0' });
    if (urlPath === '/api/v1/status') {
      return json(res, 200, {
        printer: { state: 'PRINTING', temp_nozzle: 215, target_nozzle: 215, temp_bed: 60, target_bed: 60 },
        job: { id: 7, progress: 50, time_printing: 120, time_remaining: 120 }
      });
    }
    if (urlPath === '/api/v1/job') return json(res, 200, { id: 7, state: 'PRINTING', file: { name: 'cube.gcode' } });
    if (urlPath === '/api/v1/job/7/pause' && req.method === 'PUT') {
      jobCommands.push('pause');
      res.writeHead(204);
      return res.end();
    }
    if (urlPath === '/api/v1/job/7/resume' && req.method === 'PUT') {
      jobCommands.push('resume');
      res.writeHead(204);
      return res.end();
    }
    if (urlPath === '/api/v1/job/7' && req.method === 'DELETE') {
      jobCommands.push('cancel');
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });

  const port = await listen(server);
  return {
    port,
    jobCommands,
    close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); }
  };
}

// -----------------------------------------------------------------------------
// 4. Fake Bambu MQTT Broker
// -----------------------------------------------------------------------------
async function startFakeBambu() {
  const published = [];
  const brokerSockets = new Set();
  const broker = await Aedes.createBroker();

  broker.authenticate = (_client, username, password, callback) => callback(null, username === 'bblp' && password?.toString() === '12345678');
  broker.on('publish', (packet, client) => {
    if (!client) return;
    try {
      const payload = JSON.parse(packet.payload.toString());
      published.push({ topic: packet.topic, payload });
      if (payload.pushing?.command === 'pushall') {
        const report = {
          print: {
            gcode_state: 'IDLE',
            spd_lvl: 2,
            nozzle_temper: 210,
            nozzle_target_temper: 210,
            bed_temper: 60,
            bed_target_temper: 60
          }
        };
        broker.publish({
          topic: `device/01S00A000000000/report`,
          payload: JSON.stringify(report),
          qos: 0,
          retain: false
        }, () => {});
      }
    } catch { /* ignore */ }
  });

  const tcp = net.createServer(broker.handle);
  tcp.on('connection', (s) => brokerSockets.add(s));
  const port = await listen(tcp);

  return {
    port,
    published,
    close: () => {
      brokerSockets.forEach((s) => s.destroy());
      return new Promise((r) => tcp.close(() => broker.close(r)));
    }
  };
}

// Helper to wait until a condition is met
async function waitUntil(predicate, desc = 'condition', timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${desc}`);
}

// -----------------------------------------------------------------------------
// Playwright Suite (Chromium + Firefox)
// -----------------------------------------------------------------------------
async function runSuite(browserType, browserName) {
  console.log(`\n================== Running suite on ${browserName} ==================`);
  const moonraker = await startFakeMoonraker();
  const octo = await startFakeOctoPrint();
  const prusa = await startFakePrusaLink();
  const bambu = await startFakeBambu();
  let browser;

  try {
    browser = await browserType.launch({ timeout: 30000 });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', (err) => console.error(`[${browserName} pageerror]`, err));
    console.log(`[${browserName}] Opening app at ${BASE_URL}...`);
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await selectAddedPrinter(page, 'Voron');

    // -------------------------------------------------------------------------
    // TEST 1: Moonraker (Home, Jog, Extrude, Temps, Fan, Speed, Safety & Dialogs)
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Testing Moonraker controls...`);
    await page.click('#tab-device');
    await page.waitForSelector('#device-add-printer');
    await page.click('#device-add-printer');
    await page.waitForSelector('#printer-connection-dialog');

    await page.fill('#pc-name', 'Moonraker Test');
    await page.selectOption('#pc-host-type', 'moonraker');
    await page.fill('#pc-host', `127.0.0.1:${moonraker.port}`);
    await page.click('#pc-save');
    await page.waitForSelector('#printer-connection-dialog', { state: 'detached' });

    await page.waitForSelector('#device-connection-dot[data-status="online"]', { timeout: 15000 });
    await page.waitForSelector('#device-controls');

    // A) Home
    await page.click('#control-home-all');
    await waitUntil(() => moonraker.gcodeScripts.includes('G28'), 'Moonraker G28');
    await page.click('#control-home-xy');
    await waitUntil(() => moonraker.gcodeScripts.includes('G28 X Y'), 'Moonraker G28 X Y');
    await page.click('#control-home-z');
    await waitUntil(() => moonraker.gcodeScripts.includes('G28 Z'), 'Moonraker G28 Z');

    // B) Jog & Step selection
    await page.click('#control-jog-y-plus');
    await waitUntil(() => moonraker.gcodeScripts.some((s) => s.includes('G1 Y10 F3000')), 'Jog Y+ 10');
    // Change step to 1
    await page.click('#control-step-1');
    await page.click('#control-jog-x-minus');
    await waitUntil(() => moonraker.gcodeScripts.some((s) => s.includes('G1 X-1 F3000')), 'Jog X- 1');
    await page.click('#control-jog-z-plus');
    await waitUntil(() => moonraker.gcodeScripts.some((s) => s.includes('G1 Z1 F600')), 'Jog Z+ 1');

    // C) Extrude / Retract
    await page.click('#control-extrude');
    await waitUntil(() => moonraker.gcodeScripts.some((s) => s.includes('G1 E10 F300')), 'Extrude 10');
    await page.click('#control-retract');
    await waitUntil(() => moonraker.gcodeScripts.some((s) => s.includes('G1 E-10 F300')), 'Retract 10');

    // D) Temperatures
    await page.fill('#control-temp-nozzle-input', '210');
    await page.click('#control-temp-nozzle-set');
    await waitUntil(() => moonraker.gcodeScripts.includes('M104 S210'), 'Nozzle 210');

    await page.click('#control-temp-nozzle-off');
    await waitUntil(() => moonraker.gcodeScripts.includes('M104 S0'), 'Nozzle off');

    await page.fill('#control-temp-bed-input', '60');
    await page.click('#control-temp-bed-set');
    await waitUntil(() => moonraker.gcodeScripts.includes('M140 S60'), 'Bed 60');

    await page.click('#control-temp-bed-off');
    await waitUntil(() => moonraker.gcodeScripts.includes('M140 S0'), 'Bed off');

    // High temperature confirmation dialog (> 260C)
    await page.fill('#control-temp-nozzle-input', '280');
    await page.click('#control-temp-nozzle-set');
    await page.waitForSelector('[data-testid="confirm-dialog"]');
    await page.click('[data-testid="confirm-ok"]');
    await page.waitForSelector('[data-testid="confirm-dialog"]', { state: 'detached' });
    await waitUntil(() => moonraker.gcodeScripts.includes('M104 S280'), 'High temp nozzle 280 after confirm');

    // E) Fan & Print speed
    await page.click('#control-fan-set');
    await waitUntil(() => moonraker.gcodeScripts.includes('M106 S255'), 'Fan 100%');
    await page.click('#control-fan-off');
    await waitUntil(() => moonraker.gcodeScripts.includes('M106 S0'), 'Fan 0%');

    await page.fill('#control-speed-input', '150');
    await page.click('#control-speed-set');
    await waitUntil(() => moonraker.gcodeScripts.includes('M220 S150'), 'Print speed 150%');

    // F) Printing safety & Job control (Pause, Resume, Cancel with confirm)
    moonraker.pushStatus({ print_stats: { state: 'printing', filename: 'test.gcode' } });
    await page.waitForFunction(() => document.getElementById('device-state')?.textContent?.toLowerCase() === 'printing');

    // Assert motion is disabled while printing
    assert.ok(await page.locator('#control-jog-y-plus').isDisabled(), 'Jog Y+ disabled during print');
    assert.ok(await page.locator('#control-home-all').isDisabled(), 'Home all disabled during print');
    assert.ok(await page.locator('#control-extrude').isDisabled(), 'Extrude disabled during print');

    // Assert Pause is enabled and click
    assert.ok(!await page.locator('#control-pause').isDisabled(), 'Pause enabled during print');
    await page.click('#control-pause');
    await waitUntil(() => moonraker.printCommands.includes('pause'), 'Moonraker pause');

    // Switch state to paused
    moonraker.pushStatus({ print_stats: { state: 'paused' } });
    await page.waitForFunction(() => document.getElementById('device-state')?.textContent?.toLowerCase() === 'paused');

    // Resume enabled
    assert.ok(!await page.locator('#control-resume').isDisabled(), 'Resume enabled when paused');
    await page.click('#control-resume');
    await waitUntil(() => moonraker.printCommands.includes('resume'), 'Moonraker resume');

    // Cancel print with confirm dialog
    await page.click('#control-cancel');
    await page.waitForSelector('[data-testid="confirm-dialog"]');
    await page.click('[data-testid="confirm-ok"]');
    await page.waitForSelector('[data-testid="confirm-dialog"]', { state: 'detached' });
    await waitUntil(() => moonraker.printCommands.includes('cancel'), 'Moonraker cancel after confirm');

    console.log(`[${browserName}] Moonraker controls test PASSED.`);

    // -------------------------------------------------------------------------
    // TEST 2: OctoPrint (REST endpoints)
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Testing OctoPrint controls...`);
    await page.click('#device-add-another');
    await page.waitForSelector('#printer-connection-dialog');

    await page.fill('#pc-name', 'OctoPrint Test');
    await page.selectOption('#pc-host-type', 'octoprint');
    await page.fill('#pc-host', `127.0.0.1:${octo.port}`);
    await page.fill('#pc-apikey', 'KEY');
    await page.click('#pc-save');
    await page.waitForSelector('#printer-connection-dialog', { state: 'detached' });

    await page.waitForSelector('#device-connection-dot[data-status="online"]', { timeout: 15000 });

    // Home
    await page.click('#control-home-all');
    await waitUntil(() => octo.printheadCommands.some((c) => c.command === 'home' && c.axes?.includes('x')), 'OctoPrint home');

    // Jog
    await page.click('#control-jog-y-plus');
    await waitUntil(() => octo.printheadCommands.some((c) => c.command === 'jog' && c.y === 10), 'OctoPrint jog Y+');

    // Extrude
    await page.click('#control-extrude');
    await waitUntil(() => octo.toolCommands.some((c) => c.command === 'extrude' && c.amount === 10), 'OctoPrint extrude');

    // Temps
    await page.click('#control-temp-nozzle-set');
    await waitUntil(() => octo.toolCommands.some((c) => c.command === 'target' && c.targets?.tool0 === 200), 'OctoPrint nozzle temp');

    await page.click('#control-temp-bed-set');
    await waitUntil(() => octo.bedCommands.some((c) => c.command === 'target' && c.target === 60), 'OctoPrint bed temp');

    // Fan via G-code command
    await page.click('#control-fan-set');
    await waitUntil(() => octo.gcodeCommands.some((c) => c.command === 'M106 S255'), 'OctoPrint fan command');

    // Speed via printhead feedrate
    await page.click('#control-speed-set');
    await waitUntil(() => octo.printheadCommands.some((c) => c.command === 'feedrate' && c.factor === 100), 'OctoPrint speed factor');

    console.log(`[${browserName}] OctoPrint controls test PASSED.`);

    // -------------------------------------------------------------------------
    // TEST 3: PrusaLink (Capability Hiding & Job Pause)
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Testing PrusaLink capabilities...`);
    await page.click('#device-add-another');
    await page.waitForSelector('#printer-connection-dialog');

    await page.fill('#pc-name', 'PrusaLink Test');
    await page.selectOption('#pc-host-type', 'prusalink');
    await page.fill('#pc-host', `127.0.0.1:${prusa.port}`);
    await page.fill('#pc-user', 'maker');
    await page.fill('#pc-password', 'secret');
    await page.click('#pc-save');
    await page.waitForSelector('#printer-connection-dialog', { state: 'detached' });

    await page.waitForSelector('#device-connection-dot[data-status="online"]', { timeout: 15000 });

    // Assert unsupported controls are HIDDEN
    assert.equal(await page.locator('#control-group-home').count(), 0, 'PrusaLink has no home group');
    assert.equal(await page.locator('#control-group-jog').count(), 0, 'PrusaLink has no jog group');
    assert.equal(await page.locator('#control-group-extrude').count(), 0, 'PrusaLink has no extrude group');
    assert.equal(await page.locator('#control-group-temps').count(), 0, 'PrusaLink has no temps group');
    assert.equal(await page.locator('#control-group-fan').count(), 0, 'PrusaLink has no fan group');
    assert.equal(await page.locator('#control-group-speed').count(), 0, 'PrusaLink has no speed group');

    // Assert Job control is present
    assert.equal(await page.locator('#control-group-job').count(), 1, 'PrusaLink has job group');
    await page.click('#control-pause');
    await waitUntil(() => prusa.jobCommands.includes('pause'), 'PrusaLink pause command');

    console.log(`[${browserName}] PrusaLink test PASSED.`);

    // -------------------------------------------------------------------------
    // TEST 4: Bambu LAN (MQTT Speed Preset)
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Testing Bambu Lab controls...`);
    await page.click('#device-add-another');
    await page.waitForSelector('#printer-connection-dialog');

    await page.fill('#pc-name', 'Bambu Test');
    await page.selectOption('#pc-host-type', 'bambu');
    await page.fill('#pc-host', `127.0.0.1:${bambu.port}`);
    await page.fill('#pc-apikey', '12345678');
    await page.fill('#pc-serial', '01S00A000000000');
    await page.click('#pc-save');
    await page.waitForSelector('#printer-connection-dialog', { state: 'detached' });

    await page.waitForSelector('#device-connection-dot[data-status="online"]', { timeout: 15000 });

    // Assert Bambu specific speed buttons
    assert.equal(await page.locator('#control-speed-sport').count(), 1, 'Bambu sport button present');
    await page.click('#control-speed-sport');
    await waitUntil(() => bambu.published.some((p) => p.payload?.print?.command === 'print_speed' && p.payload?.print?.param === '3'), 'Bambu speed 3 (Sport)');

    console.log(`[${browserName}] Bambu test PASSED.`);

    // -------------------------------------------------------------------------
    // TEST 5: Disabling when offline
    // -------------------------------------------------------------------------
    console.log(`[${browserName}] Testing offline controls disabling...`);
    await page.click('#device-add-another');
    await page.waitForSelector('#printer-connection-dialog');

    await page.fill('#pc-name', 'Offline Printer');
    await page.selectOption('#pc-host-type', 'moonraker');
    await page.fill('#pc-host', '127.0.0.1:1');
    await page.click('#pc-save');
    await page.waitForSelector('#printer-connection-dialog', { state: 'detached' });

    await page.waitForSelector('#device-connection-dot[data-status="error"]', { timeout: 15000 });
    assert.ok(await page.locator('#control-jog-y-plus').isDisabled(), 'Jog disabled when offline');
    assert.ok(await page.locator('#control-temp-nozzle-set').isDisabled(), 'Temps set disabled when offline');

    console.log(`[${browserName}] Offline disabling test PASSED.`);
    console.log(`[${browserName}] All assertions passed successfully!`);
  } finally {
    if (browser) await browser.close();
    await moonraker.close();
    await octo.close();
    await prusa.close();
    await bambu.close();
  }
}

async function main() {

  console.log(`Starting server on port ${PORT}...`);
  await startServer(PORT, 'device-controls', { frozenDist: true });

  try {
    await runSuite(chromium, 'Chromium');
    if (process.env.SKIP_FIREFOX !== '1') await runSuite(firefox, 'Firefox');
    console.log('\n================== ALL BROWSER TESTS PASSED ==================\n');
  } finally {
    await stopServer(PORT);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('\nTest failed with error:\n', err);
  stopServer(PORT).finally(() => process.exit(1));
});
