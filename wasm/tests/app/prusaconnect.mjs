#!/usr/bin/env node
/**
 * Browser test of Prusa Connect integration, Chromium and Firefox:
 *  - Sign-in paste flow with PKCE
 *  - Printer picking and saving
 *  - Device tab live status display and camera snapshot
 *  - Pause, resume, and cancel print controls
 *  - Upload flow with print queueing
 *
 * SAFETY: Uses fake local mock servers on 127.0.0.1. Never contacts real Prusa services or printers.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '5200', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const closeServer = (server) => new Promise((resolve) => {
  server.closeAllConnections?.();
  server.close(() => resolve());
});

const makeFakeJwt = (sub, expSeconds = 3600) => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + expSeconds })).toString('base64url');
  return `${header}.${payload}.sig`;
};

// -----------------------------------------------------------------------------
// 1. Fake Prusa Account Server
// -----------------------------------------------------------------------------
async function startFakeAccountServer() {
  const tokenRequests = [];

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyStr = Buffer.concat(chunks).toString('utf8');

    if (req.method === 'POST' && req.url === '/o/token/') {
      const params = new URLSearchParams(bodyStr);
      const grantType = params.get('grant_type');
      tokenRequests.push({ grantType, params: Object.fromEntries(params.entries()) });

      if (grantType === 'authorization_code') {
        const code = params.get('code');
        const verifier = params.get('code_verifier');
        if (code && verifier) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            access_token: makeFakeJwt('prusa_user_42'),
            refresh_token: 'prusa_refresh_42',
            expires_in: 3600
          }));
        }
      }

      if (grantType === 'refresh_token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          access_token: makeFakeJwt('prusa_user_42'),
          refresh_token: 'prusa_refresh_rotated_42',
          expires_in: 3600
        }));
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'invalid_grant' }));
    }

    res.writeHead(404);
    res.end();
  });

  const port = await listen(server);
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    tokenRequests,
    close: () => closeServer(server)
  };
}

// -----------------------------------------------------------------------------
// 2. Fake Prusa Connect Server
// -----------------------------------------------------------------------------
async function startFakeConnectServer() {
  const requests = [];
  let currentConnectState = 'PRINTING';

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuf = Buffer.concat(chunks);
    const bodyStr = bodyBuf.toString('utf8');
    const urlPath = (req.url || '').split('?')[0];

    let bodyJson = null;
    try { bodyJson = JSON.parse(bodyStr); } catch { /* ignore */ }

    requests.push({
      method: req.method,
      url: req.url,
      path: urlPath,
      headers: req.headers,
      bodyStr,
      bodyJson
    });

    // GET /app/login
    if (req.method === 'GET' && urlPath === '/app/login') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        user: {
          public_name: 'maker_test',
          first_name: 'Josef',
          last_name: 'Maker',
          default_team_id: 42,
          teams: [{ id: 42, name: 'Research Lab' }]
        }
      }));
    }

    // GET /app/printers
    if (req.method === 'GET' && urlPath === '/app/printers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        printers: [
          {
            uuid: 'prusa-mk4-uuid-001',
            name: 'Original Prusa MK4',
            sn: 'CZPX99998888',
            printer_type_name: 'MK4',
            printer_model: 'MK4',
            connect_state: currentConnectState,
            printer_state: currentConnectState,
            team_id: 42
          }
        ]
      }));
    }

    // GET /app/printers/prusa-mk4-uuid-001
    if (req.method === 'GET' && urlPath === '/app/printers/prusa-mk4-uuid-001') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        uuid: 'prusa-mk4-uuid-001',
        name: 'Original Prusa MK4',
        printer_type_name: 'MK4',
        connect_state: currentConnectState,
        printer_state: currentConnectState,
        temp: {
          temp_nozzle: 215.5,
          target_nozzle: 215.0,
          temp_bed: 60.1,
          target_bed: 60.0
        },
        chamber: { temp: 35.0, target_temp: 35.0 },
        speed: 100,
        flow: 100,
        job_info: {
          display_name: 'benchy.gcode',
          progress: 45.0,
          time_printing: 1200,
          time_remaining: 1500
        }
      }));
    }

    // GET /app/printers/prusa-mk4-uuid-001/storages
    if (req.method === 'GET' && urlPath === '/app/printers/prusa-mk4-uuid-001/storages') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        storages: [
          { path: '/usb/', mountpoint: '/usb', type: 'USB', read_only: false, corrupted: false }
        ]
      }));
    }

    // GET /app/printers/prusa-mk4-uuid-001/cameras
    if (req.method === 'GET' && urlPath === '/app/printers/prusa-mk4-uuid-001/cameras') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        cameras: [
          { id: 'cam-01', name: 'Nozzle Cam', token: 'cam_tok_99' }
        ]
      }));
    }

    // GET /app/cameras/cam-01/snapshots/last
    if (req.method === 'GET' && urlPath === '/app/cameras/cam-01/snapshots/last') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      // Minimal valid JPEG header bytes
      return res.end(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9]));
    }

    // POST /app/users/teams/42/uploads
    if (req.method === 'POST' && urlPath === '/app/users/teams/42/uploads') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        id: 'upload_job_playwright_1',
        hash: 'file_hash_sha256_pw'
      }));
    }

    // PUT /app/teams/42/files/raw
    if (req.method === 'PUT' && urlPath === '/app/teams/42/files/raw') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        hash: 'file_hash_sha256_pw'
      }));
    }

    // POST /app/printers/prusa-mk4-uuid-001/queue
    if (req.method === 'POST' && urlPath === '/app/printers/prusa-mk4-uuid-001/queue') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, queued_id: 101 }));
    }

    // POST /app/printers/prusa-mk4-uuid-001/commands/sync
    if (req.method === 'POST' && urlPath === '/app/printers/prusa-mk4-uuid-001/commands/sync') {
      const cmd = bodyJson?.command;
      if (cmd === 'PAUSE_PRINT') {
        currentConnectState = 'PAUSED';
      } else if (cmd === 'RESUME_PRINT') {
        currentConnectState = 'PRINTING';
      } else if (cmd === 'STOP_PRINT') {
        currentConnectState = 'IDLE';
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ command_id: 'cmd_pw_1', state: 'SUCCESS' }));
    }

    res.writeHead(404);
    res.end();
  });

  const port = await listen(server);
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    requests,
    setState: (st) => { currentConnectState = st; },
    close: () => closeServer(server)
  };
}

// -----------------------------------------------------------------------------
// Playwright Suite
// -----------------------------------------------------------------------------
async function runSuite(browserType, name, fakeAccount, fakeConnect) {
  console.log(`\n--- Running Prusa Connect suite on ${name} ---`);
  let browser;
  try {
    browser = await browserType.launch({
      headless: true,
      args: ['--enable-features=SharedArrayBuffer']
    });
  } catch (err) {
    if (name === 'Firefox' && process.env.SKIP_FIREFOX === '1') {
      console.warn(`[${name}] Browser launch skipped: ${err.message}`);
      return;
    }
    throw err;
  }

  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));

  const text = (selector) => page.locator(selector).innerText();

  try {
    console.log(`[${name}] Navigating to app...`);
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    console.log(`[${name}] Selecting preset...`);
    await selectAddedPrinter(page, 'Voron');

    console.log(`[${name}] Opening Device tab and connection dialog...`);
    await page.click('#tab-device');
    await page.waitForSelector('#device-add-printer');
    await page.click('#device-add-printer');
    await page.waitForSelector('#printer-connection-dialog');

    // 1. Fill printer name and host type
    await page.fill('#pc-name', 'My Prusa MK4');
    await page.selectOption('#pc-host-type', 'prusaconnect');

    // Hostname field should be hidden for Prusa Connect
    assert.equal(await page.locator('#pc-host').count(), 0, 'host input is hidden for prusaconnect');

    // 2. Start Prusa Account sign-in wizard
    console.log(`[${name}] Starting PKCE sign-in...`);
    await page.waitForSelector('#pc-prusa-login-start');
    await page.click('#pc-prusa-login-start');

    // Wait for the paste input and auth link to appear
    await page.waitForSelector('#pc-prusa-pasted-url');
    await page.waitForSelector('#pc-prusa-reopen-auth');

    const authLink = await page.locator('#pc-prusa-reopen-auth').getAttribute('href');
    assert.ok(authLink, 'authorization link was generated');
    const authUrlParsed = new URL(authLink);
    const stateParam = authUrlParsed.searchParams.get('state');
    assert.ok(stateParam, 'state parameter was present in authorize URL');

    // 3. Paste the simulated callback URL
    console.log(`[${name}] Pasting callback URL...`);
    const callbackUrl = `https://connect.prusa3d.com/login/auth-callback?code=mock_auth_code_playwright&state=${stateParam}`;
    await page.fill('#pc-prusa-pasted-url', callbackUrl);
    await page.click('#pc-prusa-login-complete');

    // 4. Printer list appears
    console.log(`[${name}] Waiting for printer list...`);
    await page.waitForSelector('#pc-prusa-printer-list');
    await page.waitForSelector('#pc-prusa-printer-prusa-mk4-uuid-001');
    assert.match(await text('#pc-prusa-printer-prusa-mk4-uuid-001'), /Original Prusa MK4/);

    // Pick the printer
    await page.click('#pc-prusa-select-prusa-mk4-uuid-001');

    // Verify selected device indicator
    await page.waitForSelector('#pc-prusa-device');
    assert.match(await text('#pc-prusa-device'), /prusa-mk4-uuid-001/);

    // 5. Test connection
    console.log(`[${name}] Testing connection...`);
    await page.click('#pc-test');
    await page.waitForSelector('#pc-test-result');
    assert.match(await text('#pc-test-result'), /Connection to Prusa Connect is working.*Original Prusa MK4/);

    // Save printer
    console.log(`[${name}] Saving printer...`);
    await page.click('#pc-save');
    await page.waitForSelector('#printer-connection-dialog', { state: 'detached' });

    // 6. Device tab: verify live status & controls
    console.log(`[${name}] Verifying Device tab status & controls...`);
    await page.waitForSelector('#device-connection-dot[data-status="online"]');
    assert.equal(await text('#device-connection-status'), 'Connected');

    // Live state and job progress
    await page.waitForSelector('#device-state');
    assert.match(await text('#device-state'), /^printing$/i);

    await page.waitForSelector('#device-job');
    assert.match(await text('#device-job'), /benchy\.gcode/);
    assert.match(await text('#device-job'), /45\.0%/);

    // Temperatures
    await page.waitForSelector('#device-temps');
    assert.match(await text('#device-temps'), /215\.5 \/ 215/);
    assert.match(await text('#device-temps'), /60\.1 \/ 60/);

    // Web UI link: small "Open in Prusa Connect" link without blocked error message
    assert.equal(await page.locator('#device-webui-blocked').count(), 0, 'no blocked message for prusaconnect');
    const openLink = await page.locator('#device-webui-open').getAttribute('href');
    assert.match(openLink, /connect\.prusa3d\.com\/printer\/prusa-mk4-uuid-001/);
    assert.equal(await text('#device-webui-open'), 'Open in Prusa Connect');

    // Camera snapshot
    await page.waitForSelector('#device-camera img');
    const camSrc = await page.locator('#device-camera img').getAttribute('src');
    assert.match(camSrc, /\/_printer\/prusa-connect\/camera\/snapshot/);

    // 7. Test Print Controls: Pause, Resume, Cancel
    console.log(`[${name}] Testing Pause print control...`);
    await page.click('#control-pause');

    // Wait for fake Connect server to receive PAUSE_PRINT
    await page.waitForFunction(() => {
      const stateEl = document.getElementById('device-state');
      return stateEl && (stateEl.getAttribute('data-state') === 'paused' || stateEl.textContent.trim().toLowerCase() === 'paused');
    }, null, { timeout: 10000 });

    const pauseCall = fakeConnect.requests.find(
      (r) => r.path === '/app/printers/prusa-mk4-uuid-001/commands/sync' && r.bodyJson?.command === 'PAUSE_PRINT'
    );
    assert.ok(pauseCall, 'received PAUSE_PRINT command on fake Connect');

    // Resume print
    console.log(`[${name}] Testing Resume print control...`);
    await page.waitForSelector('#control-resume:not([disabled])');
    await page.click('#control-resume');

    await page.waitForFunction(() => {
      const stateEl = document.getElementById('device-state');
      return stateEl && (stateEl.getAttribute('data-state') === 'printing' || stateEl.textContent.trim().toLowerCase() === 'printing');
    }, null, { timeout: 10000 });

    const resumeCall = fakeConnect.requests.find(
      (r) => r.path === '/app/printers/prusa-mk4-uuid-001/commands/sync' && r.bodyJson?.command === 'RESUME_PRINT'
    );
    assert.ok(resumeCall, 'received RESUME_PRINT command on fake Connect');

    // Cancel print
    console.log(`[${name}] Testing Cancel print control...`);
    await page.click('#control-cancel');
    await page.waitForSelector('[data-testid="confirm-dialog"]');
    await page.click('[data-testid="confirm-ok"]');
    await page.waitForSelector('[data-testid="confirm-dialog"]', { state: "detached" });

    await page.waitForFunction(() => {
      const stateEl = document.getElementById('device-state');
      return stateEl && (stateEl.getAttribute('data-state') === 'ready' || stateEl.textContent.trim().toLowerCase() === 'ready');
    }, null, { timeout: 10000 });

    const stopCall = fakeConnect.requests.find(
      (r) => r.path === '/app/printers/prusa-mk4-uuid-001/commands/sync' && r.bodyJson?.command === 'STOP_PRINT'
    );
    assert.ok(stopCall, 'received STOP_PRINT command on fake Connect');

    // 8. Test Upload with print
    console.log(`[${name}] Testing upload and queue print...`);
    await page.evaluate(async () => {
      const api = window.__printerStore?.getState().activeApi;
      if (!api) throw new Error('No active API found on __printerStore');
      await api.upload({
        filename: 'playwright_test.gcode',
        gcode: new Uint8Array([71, 50, 56, 10, 77, 49, 48, 52, 32, 83, 50, 49, 48, 10]), // G28\nM104 S210\n
        print: true
      });
    });

    // Verify exact requests fake Connect received for the upload flow
    const uploadRegCall = fakeConnect.requests.find((r) => r.path === '/app/users/teams/42/uploads');
    assert.ok(uploadRegCall, 'received upload registration');
    assert.equal(uploadRegCall.bodyJson.filename, 'playwright_test.gcode');
    assert.equal(uploadRegCall.bodyJson.destination, '/usb/');
    assert.equal(uploadRegCall.bodyJson.printer_uuid, 'prusa-mk4-uuid-001');

    const rawUploadCall = fakeConnect.requests.find((r) => r.path === '/app/teams/42/files/raw');
    assert.ok(rawUploadCall, 'received raw file upload');
    assert.equal(rawUploadCall.method, 'PUT');
    assert.match(rawUploadCall.url, /upload_id=upload_job_playwright_1/);

    const queueCall = fakeConnect.requests.find((r) => r.path === '/app/printers/prusa-mk4-uuid-001/queue');
    assert.ok(queueCall, 'received queue request');
    assert.equal(queueCall.bodyJson.hash, 'file_hash_sha256_pw');
    assert.equal(queueCall.bodyJson.team_id, 42);
    assert.equal(queueCall.bodyJson.position, 0);
    assert.equal(queueCall.bodyJson.set_ready, true);

    console.log(`[${name}] All Prusa Connect browser tests passed successfully!`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const fakeAccount = await startFakeAccountServer();
  const fakeConnect = await startFakeConnectServer();

  process.env.ORCA_PRINTER_PROXY = 'private';
  process.env.ORCA_PRINTER_CLOUD = 'prusa-connect';
  process.env.PRUSA_ACCOUNT_URL = fakeAccount.url;
  process.env.PRUSA_CONNECT_URL = fakeConnect.url;
  process.env.PRUSA_CLIENT_ID = 'MRHTlZhZqkNrrQ6FUPtjyusAz8nc59ErHXP8XkS4';

  console.log(`Mock Account server running at ${fakeAccount.url}`);
  console.log(`Mock Connect server running at ${fakeConnect.url}`);
  console.log(`Starting test server on port ${PORT}...`);

  await startServer(PORT, 'prusaconnect', { frozenDist: true });

  try {
    await runSuite(chromium, 'Chromium', fakeAccount, fakeConnect);
    if (process.env.SKIP_FIREFOX !== '1') {
      await runSuite(firefox, 'Firefox', fakeAccount, fakeConnect);
    }
  } finally {
    console.log('Stopping test server and mock services...');
    await stopServer(PORT);
    await fakeAccount.close();
    await fakeConnect.close();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[prusaconnect browser test failure]:', err);
  process.exit(1);
});
