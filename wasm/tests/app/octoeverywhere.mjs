// Run against the single final immutable Vite candidate. Actual browser client and
// gateway; injected upstream is loopback only. Never uses a provider or printer.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

assert.ok(process.env.APP_TEST_DIST, 'Set APP_TEST_DIST to the final verified candidate; this test must not build another candidate.');
const { createOctoEverywhereGateway } = await import(pathToFileURL(path.resolve(process.env.APP_TEST_DIST, 'octoeverywhere-bridge.mjs')));
const port = Number(process.env.PORT || 5189);
assert.notEqual(port, 5070, 'Never mutate the live service');
const origin = `http://127.0.0.1:${port}`;
const staticPort = port + 1;
assert.notEqual(staticPort, 5070);
const calls = [];
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
const connection = { connectionId: 'synthetic-integrated', url: 'https://synthetic.octoeverywhere.com/',
  appApiToken: 'synthetic-app-secret', auth: { type: 'bearer', token: 'synthetic-relay-secret' },
  printerName: 'Synthetic printer', userFacingUrl: 'https://octoeverywhere.com/view/Synthetic' };
const upstream = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  calls.push({ path: req.url, method: req.method, body: Buffer.concat(chunks).toString(), headers: req.headers });
  res.setHeader('content-type', 'application/json');
  let result = {};
  if (req.url.includes('/info')) result = { IsOnline: true, PrinterName: 'Synthetic printer', PrinterLimits: { MaxUploadFileSizeBytes: 1048576, MaxDownloadFileSizeBytes: 2097152, MaxSingleWebcamStreamLengthSeconds: 1 } };
  else if (req.url.includes('/status')) result = { Status: 200, Result: { Features: 63, JobStatus: { State: 'idle', Lights: [{ Name: 'Chamber light', On: false }], CurrentPrint: { Temps: { BedActual: 25, BedTarget: 0, HotendActual: 26, HotendTarget: 0 } }, MaterialSystem: { Sources: [{ Id: 'source-7', Name: 'Spool A', UnitId: 'unit-9', Material: { Type: 'PLA' } }], Tools: [{ Id: 'tool-3', Name: 'Tool B', Index: 3 }], Units: [{ Id: 'unit-9', Name: 'Dry box' }], Routes: [{ SourceId: 'source-7', ToolId: 'tool-3', State: 'loaded' }] } }, ListWebcams: { Webcams: [{ Name: 'Work camera', Enabled: true, FlipH: true, Rotation: 90 }] } } };
  else if (req.url.includes('/webcam/snapshot')) { res.setHeader('content-type', 'image/png'); res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=', 'base64')); return; }
  else if (req.url.includes('/webcam/stream')) { res.setHeader('content-type', 'multipart/x-mixed-replace; boundary=frame'); res.write('--frame\r\n'); return; }
  else if (req.url.includes('/files/download')) { res.setHeader('content-type', 'application/octet-stream'); res.end('G28\n'); return; }
  else if (req.url.includes('/files/details')) result = { Status: 200, Result: { VirtualPath: 'gcode/returned/integration.gcode', PlatformPath: '/synthetic/integration.gcode', SizeBytes: 4 } };
  else if (req.url.includes('/files/upload')) result = { Status: 200, Result: { VirtualPath: 'gcode/returned/integration.gcode', PlatformPath: '/synthetic/integration.gcode' } };
  else if (req.url.includes('/files/list')) result = { Status: 200, Result: { Root: [{ Type: 'file', Name: 'integration.gcode', VirtualPath: 'gcode/returned/integration.gcode' }] } };
  else if (req.url.includes('/api/live/')) result = { LiveId: 'synthetic-live', Url: 'https://octoeverywhere.com/live/synthetic', ShortUrl: 'https://oe.link/synthetic' };
  else if (/SetNotificationWebhook|DeleteNotificationWebhook/.test(req.url)) { res.setHeader('content-type', 'text/plain'); res.end('OK'); return; }
  else result = { Status: 200, Result: {} };
  res.end(JSON.stringify(result));
});
const upstreamPort = await listen(upstream);
const gateway = createOctoEverywhereGateway({ enabled: true, appId: 'synthetic-assigned-app', publicOrigin: origin,
  resolver: async () => [{ address: '8.8.8.8', family: 4 }],
  request: (options, callback) => http.request({ ...options, hostname: '127.0.0.1', port: upstreamPort, lookup: undefined }, callback) });
const missingId = createOctoEverywhereGateway({ enabled: true, publicOrigin: origin });
const disabled = createOctoEverywhereGateway({ enabled: false, publicOrigin: origin });
let activeGateway = gateway;
// Serve the packaged app through a loopback static proxy. OE routes run directly
// on this origin so camera bodies stream and cancellation reaches the gateway.
const server = http.createServer((req, res) => void activeGateway.handle(req, res).then(handled => {
  if (handled) return;
  const forwarded = http.request({ hostname: '127.0.0.1', port: staticPort, path: req.url, method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${staticPort}` } }, upstream => {
    res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
  });
  forwarded.on('error', () => { res.statusCode = 502; res.end(); });
  req.pipe(forwarded);
}));
let browser;
try {
  await startServer(staticPort, 'octoeverywhere', { frozenDist: true });
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.route('https://**/*', route => route.abort());
  await page.addInitScript(() => localStorage.setItem('orca.wizard', JSON.stringify({ printers: [], filaments: [] })));
  const documentResponse = await page.goto(origin);
  assert.equal(documentResponse.headers()['cross-origin-embedder-policy'], 'require-corp');
  assert.equal(documentResponse.headers()['cross-origin-opener-policy'], 'same-origin');
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  console.log('Candidate isolation verified; waiting for app stores.');
  await page.waitForFunction(() => window.__printerStore && window.__appStore);
  await page.evaluate(connection => {
    const p = { id: 'synthetic-integrated', name: 'Synthetic remote printer', host_type: 'moonraker', print_host: '192.0.2.1',
      printhost_apikey: 'synthetic-local-secret', octoeverywhere: { mode: 'remote', connection } };
    window.__printerStore.getState().savePrinter(p);
  }, connection);
  // Device is the underlying tab ID even when the product labels it Operate.
  await page.locator('[data-tab="device"],#tab-device').first().click();
  await page.locator('#device-connection-status').filter({ hasText: 'Connected' }).waitFor();
  console.log('Synthetic remote monitoring connected.');
  const button = name => page.getByRole('button', { name, exact: true });
  const disclose = async name => {
    const summary = page.locator('summary').filter({ hasText: name });
    if (!await summary.evaluate(el => el.parentElement.open)) await summary.click();
  };
  const confirm = () => page.getByTestId('confirm-ok').click();
  // The gateway config must disable actual built UI linking, even with a saved connection.
  for (const [implementation, message] of [[missingId, 'Connecting requires a production'], [disabled, 'Remote access is disabled']]) {
    activeGateway = implementation;
    await page.reload();
    await disclose('Remote connection');
    await page.getByText(message, { exact: false }).waitFor();
    assert.equal(await button('Reconnect OctoEverywhere').isDisabled(), true);
    const code = await page.evaluate(async () => (await fetch('/_octoeverywhere/portal/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status);
    assert.equal(code, implementation === missingId ? 503 : 403);
  }
  activeGateway = gateway;
  console.log('Missing-ID and disabled UI verified.');
  await page.reload();
  await disclose('Remote connection');
  // Capture external navigation without contacting the provider, then simulate its callback.
  await page.evaluate(() => { window.open = () => ({ opener: null, close() {}, location: { replace(url) { window.syntheticPortal = url; } } }); });
  await button('Reconnect OctoEverywhere').click();
  await page.waitForFunction(() => window.syntheticPortal);
  const portal = new URL(await page.evaluate(() => window.syntheticPortal));
  assert.equal(portal.searchParams.get('appid'), 'synthetic-assigned-app');
  const callback = new URL(portal.searchParams.get('returnUrl'));
  const complete = async url => page.evaluate(async url => { const response = await fetch(url, { redirect: 'manual' }); return response.status; }, url);
  const wrong = new URL(callback); wrong.searchParams.set('correlation', 'wrong');
  assert.equal(await complete(wrong.href), 403);
  for (const [key, value] of Object.entries({ success: 'true', id: connection.connectionId, url: connection.url, appApiToken: connection.appApiToken, authBearerToken: connection.auth.token, printername: connection.printerName, userPrinterAccessUrl: connection.userFacingUrl })) callback.searchParams.set(key, value);
  // Browser manual redirects are opaque; verify successful correlation through the original UI poll.
  await complete(callback.href);
  await page.getByText('Bind authorized printer', { exact: false }).waitFor();
  assert.equal(await complete(callback.href), 403);
  await button('Confirm printer binding').click();
  await button('Confirm printer binding').waitFor({ state: 'detached' });
  console.log('Correlated portal and explicit binding verified.');
  await page.locator('summary').filter({ hasText: 'Remote connection' }).click();
  await page.locator('#device-connection-status').filter({ hasText: 'Connected' }).waitFor();
  assert.equal(await page.evaluate(() => window.__printerStore.getState().printers[0].printhost_apikey), 'synthetic-local-secret');
  await page.locator('#control-home-all').click();
  await page.getByLabel('Tool', { exact: true }).selectOption('3');
  await page.locator('#control-temp-nozzle-input').fill('290');
  await page.locator('#control-group-temps button').first().click();
  await button('Turn on').click();
  await button('Turn on').waitFor({ state: 'visible' });
  await page.waitForFunction(() => ![...document.querySelectorAll('.oe-remote button')].find(el => el.textContent === 'Turn on')?.disabled);
  assert.ok(calls.some(call => call.path.includes('/home')));
  assert.ok(calls.some(call => call.path.includes('/set-temp') && JSON.parse(call.body).ToolC === 260 && JSON.parse(call.body).ToolNumber === 3));
  assert.ok(calls.some(call => call.path.includes('/set-light')));
  assert.equal(await page.locator('#control-group-fan,#control-group-speed,#control-home-xy').count(), 0);
  const summary = page.locator('summary').filter({ hasText: 'Printer files' }); await summary.click();
  await page.locator('.oe-remote input[type=file]').setInputFiles({ name: 'integration.gcode', mimeType: 'application/octet-stream', buffer: Buffer.from('G28\n') });
  const path = page.getByLabel('Existing virtual path');
  await page.waitForFunction(() => document.querySelector('input[placeholder="gcode/filename.gcode"]')?.value === 'gcode/returned/integration.gcode');
  assert.equal(await path.inputValue(), 'gcode/returned/integration.gcode');
  assert.equal(calls.some(call => call.path.includes('/start')), false, 'upload never starts printing');
  await page.getByRole('button', { name: 'Start print…', exact: true }).click();
  assert.equal(calls.some(call => call.path.includes('/start')), false, 'confirmation gates mutation');
  await page.getByTestId('confirm-ok').click();
  await page.getByText('Print start requested.', { exact: true }).waitFor();
  assert.equal(JSON.parse(calls.find(call => call.path.includes('/start')).body).Path, 'gcode/returned/integration.gcode');
  assert.equal(calls.find(call => call.path.includes('/files/upload')).body, 'G28\n');
  await button('Details').first().click();
  await page.getByText('/synthetic/integration.gcode', { exact: true }).waitFor();
  const download = page.waitForEvent('download'); await button('Download').first().click();
  const downloaded = await download;
  assert.equal(downloaded.suggestedFilename(), 'integration.gcode');
  const downloadedBytes = [];
  for await (const chunk of await downloaded.createReadStream()) downloadedBytes.push(chunk);
  assert.equal(Buffer.concat(downloadedBytes).toString(), 'G28\n');
  await button('Delete').first().click(); await confirm();
  await page.waitForFunction(() => ![...document.querySelectorAll('.oe-remote button')].find(el => el.textContent === 'Refresh files')?.disabled);
  await disclose('Cameras'); await button('Snapshot').click();
  await page.waitForFunction(() => document.querySelector('.oe-camera img')?.naturalWidth > 0);
  assert.match(await page.locator('.oe-camera img').getAttribute('style'), /rotate\(90deg\) scale\(-1, 1\)/);
  await button('Stop camera').click();
  await button('Start stream').click();
  await page.locator('.oe-camera img').waitFor();
  await page.locator('.oe-camera img').waitFor({ state: 'detached', timeout: 4000 });
  assert.equal(calls.filter(call => call.path.includes('/webcam/stream')).length, 1, 'stream never automatically reconnects');
  await disclose('Sharing and notifications');
  await button('Create temporary Live Link').click(); await confirm();
  await button('Copy Live Link').waitFor();
  await page.getByLabel('HTTPS callback URL').fill('https://callback.example.invalid/events');
  await page.getByLabel('Inclusive event types', { exact: false }).fill('1, 3');
  await button('Set webhook').click(); await confirm(); await page.getByText('Webhook registered.', { exact: false }).waitFor();
  await button('Test webhook').click(); await confirm(); await page.getByText('Test notification requested.').waitFor();
  await button('Delete webhook').click(); await confirm(); await page.getByText('Webhook deleted.').waitFor();
  assert.ok(calls.some(call => call.path.includes('/files/delete')));
  assert.deepEqual(JSON.parse(calls.find(call => call.path.includes('/SetNotificationWebhook')).body).InclusiveEventTypesFilter, [1, 3]);
  for (const call of calls) {
    if (call.path.startsWith('/api/')) { assert.equal(call.headers.apptoken, connection.appApiToken); assert.equal(call.headers.authorization, undefined); }
    else { assert.equal(call.headers.authorization, `Bearer ${connection.auth.token}`); assert.equal(call.headers.apptoken, undefined); }
  }
  await disclose('Material and tools');
  assert.ok(calls.every(call => !JSON.stringify(call).includes('synthetic-local-secret')), 'local credentials never cross gateway');
  assert.doesNotMatch(await page.locator('body').innerText(), /synthetic-(app|relay|local)-secret/);
  for (const width of [1440, 1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.oe-remote').scrollIntoViewIfNeeded();
    await page.locator('.oe-remote').evaluate(el => {
      for (let container = el; container; container = container.parentElement) container.scrollTop = 0;
    });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `document fit at ${width}`);
    assert.ok(await page.locator('.oe-remote').evaluate(el => el.scrollWidth <= el.clientWidth), `remote tools fit at ${width}`);
    await page.screenshot({ path: `wasm/build/tests-octoeverywhere-20261105/integrated-${width}.png`, fullPage: true });
    await page.getByLabel('Existing virtual path').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `wasm/build/tests-octoeverywhere-20261105/integrated-files-${width}.png`, fullPage: true });
  }
  // Verify the concrete rotation/Stop regression in both themes and densities.
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await button('Snapshot').click();
      await page.waitForFunction(() => document.querySelector('.oe-camera img')?.naturalWidth > 0);
      await page.locator('.oe-camera-view').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `wasm/build/tests-octoeverywhere-20261105/integrated-camera-${width}-${theme}.png`, fullPage: true });
      await button('Stop camera').click();
      await page.locator('.oe-camera img').waitFor({ state: 'detached' });
    }
  }
  await page.evaluate(() => window.__printerStore.getState().deletePrinter('synthetic-integrated'));
  console.log('OctoEverywhere immutable candidate: isolation, disabled/missing-ID UI, correlated portal, controls, exact file transfers/start/delete, camera tickets, extras, credential separation and 1440/1280/390/320 screenshots passed.');
} finally {
  await browser?.close(); gateway.close(); missingId.close(); disabled.close(); server.closeAllConnections(); upstream.closeAllConnections();
  await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  await stopServer(staticPort);
}
