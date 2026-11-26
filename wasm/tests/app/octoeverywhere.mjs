// Run against the single final immutable Vite candidate. Actual browser client and
// gateway; injected upstream is loopback only. Never uses a provider or printer.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
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
let printerOnline = true;
let redirectStatus = false;
let uploadResponse;
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
const jpegBytes = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z', 'base64');
const connection = { connectionId: 'synthetic-integrated', url: 'https://synthetic.octoeverywhere.com/',
  appApiToken: 'synthetic-app-secret', auth: { type: 'bearer', token: 'synthetic-relay-secret' },
  printerName: 'Synthetic printer', userFacingUrl: 'https://octoeverywhere.com/view/Synthetic' };
const upstream = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  calls.push({ path: req.url, method: req.method, body: Buffer.concat(chunks).toString(), headers: req.headers });
  if (redirectStatus && req.url.includes('/status')) {
    res.writeHead(302, { Location: 'https://example.invalid/synthetic' });
    res.end();
    return;
  }
  res.setHeader('content-type', 'application/json');
  let result = {};
  if (req.url.includes('/info')) result = { IsOnline: printerOnline, PrinterName: 'Synthetic printer', PrinterLimits: { MaxUploadFileSizeBytes: 1048576, MaxDownloadFileSizeBytes: 2097152, MaxSingleWebcamStreamLengthSeconds: 1 } };
  else if (req.url.includes('/status')) result = { Status: 200, Result: { Features: 63, JobStatus: { State: 'idle', Lights: [{ Name: 'Chamber light', On: false }], CurrentPrint: { Temps: { BedActual: 25, BedTarget: 0, HotendActual: 26, HotendTarget: 0 } }, MaterialSystem: { Sources: [{ Id: 'source-7', Name: 'Spool A', UnitId: 'unit-9', Material: { Type: 'PLA' } }], Tools: [{ Id: 'tool-3', Name: 'Tool B', Index: 3 }], Units: [{ Id: 'unit-9', Name: 'Dry box' }], Routes: [{ SourceId: 'source-7', ToolId: 'tool-3', State: 'loaded' }] } }, ListWebcams: { Webcams: [{ Name: 'Disabled camera', Enabled: false }, { Name: 'Work camera', Enabled: true, FlipH: true, Rotation: 90 }] } } };
  else if (req.url.includes('/webcam/snapshot')) { res.setHeader('content-type', 'image/jpeg'); res.end(jpegBytes); return; }
  else if (req.url.includes('/webcam/stream')) { res.setHeader('content-type', 'multipart/x-mixed-replace; boundary=frame'); res.write(Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpegBytes.length}\r\n\r\n`), jpegBytes, Buffer.from('\r\n')])); return; }
  else if (req.url.includes('/files/download')) { res.setHeader('content-type', 'application/octet-stream'); res.end('G28\n'); return; }
  else if (req.url.includes('/files/details')) result = { Status: 200, Result: { VirtualPath: 'gcode/returned/integration.gcode', PlatformPath: '/synthetic/integration.gcode', SizeBytes: 4 } };
  else if (req.url.includes('/files/upload')) {
    uploadResponse?.started?.resolve(res);
    await uploadResponse?.promise;
    result = { Status: 200, Result: { VirtualPath: 'gcode/returned/integration.gcode', PlatformPath: '/synthetic/integration.gcode' } };
  }
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
const missingId = createOctoEverywhereGateway({ enabled: true, appId: undefined, publicOrigin: origin });
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
  assert.equal(documentResponse.headers()['cross-origin-embedder-policy'], process.env.VITE_COEP || 'require-corp');
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
  await page.locator('.device-header #device-add-another').waitFor();
  await page.locator('.device-header #device-edit-printer').waitFor();
  await page.waitForFunction(() => document.querySelector('.oe-camera img')?.naturalWidth > 0);
  assert.equal(calls.filter(call => call.path.includes('/webcam/snapshot')).length, 1, 'Device opens with one snapshot');
  assert.equal(calls.find(call => call.path.includes('/webcam/snapshot')).path, '/octoeverywhere-command-api/webcam/snapshot?index=1');
  assert.equal(calls.filter(call => call.path.includes('/webcam/stream')).length, 0, 'Device does not start streaming');
  await page.screenshot({ path: 'wasm/build/tests-octoeverywhere-20261105/dashboard-desktop.png' });
  console.log('Synthetic remote monitoring connected.');
  const button = name => page.getByRole('button', { name, exact: true });
  const disclose = async name => {
    const section = page.locator('summary').filter({ hasText: name }).or(page.getByRole('heading', { name, exact: true }));
    if (await section.evaluate(el => el.tagName === 'SUMMARY' && !el.parentElement.open)) await section.click();
  };
  const confirm = () => page.getByTestId('confirm-ok').click();
  // The gateway config must disable actual built UI linking, even with a saved connection.
  for (const [implementation, message] of [[missingId, 'Connecting requires a production'], [disabled, 'Remote access is disabled']]) {
    activeGateway = implementation;
    await page.reload();
    await disclose('Remote connection');
    await page.getByText(message, { exact: false }).waitFor();
    assert.equal(await button('Reconnect OctoEverywhere').isDisabled(), true);
    const cfg = await page.evaluate(async () => (await fetch('/_octoeverywhere/config')).json());
    assert.equal(cfg.portalAvailable, false);
    const code = await page.evaluate(async () => (await fetch('/_octoeverywhere/info', { headers: { 'X-OctoEverywhere-App-Token': 'x' } })).status);
    if (implementation === disabled) assert.equal(code, 403);
  }
  activeGateway = gateway;
  console.log('Missing-ID and disabled UI verified.');
  await page.reload();
  await disclose('Remote connection');
  // Capture external navigation without contacting the provider, then complete callback in a second page.
  await page.evaluate(() => { window.open = () => ({ opener: null, close() {}, location: { replace(url) { window.syntheticPortal = url; } } }); });
  await button('Reconnect OctoEverywhere').click();
  await page.waitForFunction(() => window.syntheticPortal);
  const portal = new URL(await page.evaluate(() => window.syntheticPortal));
  assert.equal(portal.searchParams.get('appid'), 'synthetic-assigned-app');
  const callback = new URL(portal.searchParams.get('returnUrl'));
  const callbackPage = await context.newPage();
  const wrong = new URL(callback);
  wrong.pathname = wrong.pathname.replace(/\/[^/]+\/?$/, '/wrong');
  await callbackPage.goto(wrong.href);
  await callbackPage.getByText('This authorization link has expired or was already used.', { exact: false }).waitFor();
  assert.equal(callbackPage.url(), `${origin}/octoeverywhere/callback`);
  for (const [key, value] of Object.entries({ success: 'true', id: connection.connectionId, url: connection.url, appApiToken: connection.appApiToken, authBearerToken: connection.auth.token, printername: connection.printerName, userPrinterAccessUrl: connection.userFacingUrl })) callback.searchParams.set(key, value);
  await callbackPage.goto(callback.href);
  await callbackPage.getByText('Return to WebOrca to finish connecting. You can close this tab.', { exact: true }).waitFor();
  assert.equal(callbackPage.url(), `${origin}/octoeverywhere/callback`);
  assert.doesNotMatch(await callbackPage.locator('body').innerText(), /synthetic-(app|relay|local)-secret/);
  await page.getByText('Bind authorized printer', { exact: false }).waitFor();
  await callbackPage.goto(callback.href);
  await callbackPage.getByText('This authorization link has expired or was already used.', { exact: false }).waitFor();
  await callbackPage.close();
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
  await disclose('Printer files');
  uploadResponse = Promise.withResolvers();
  await page.locator('.oe-remote input[type=file]').setInputFiles({ name: 'integration.gcode', mimeType: 'application/octet-stream', buffer: Buffer.from('G28\n') });
  await page.getByText('Waiting for the printer...', { exact: true }).waitFor();
  const uploadProgress = page.getByRole('progressbar', { name: 'Uploading' });
  assert.equal(await uploadProgress.getAttribute('aria-valuenow'), '100');
  assert.equal(await page.getByText('Uploaded. Review print options before starting.').count(), 0);
  await uploadProgress.locator('..').screenshot({ path: 'wasm/build/tests-octoeverywhere-20261105/upload-progress.png' });
  uploadResponse.resolve();
  uploadResponse = undefined;
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
  uploadResponse = { ...Promise.withResolvers(), started: Promise.withResolvers() };
  await page.locator('.oe-remote input[type=file]').setInputFiles({ name: 'cancel.gcode', mimeType: 'application/octet-stream', buffer: Buffer.from('G28\n') });
  await page.getByText('Waiting for the printer...', { exact: true }).waitFor();
  const pendingUpload = await Promise.race([
    uploadResponse.started.promise,
    delay(5000, undefined, { ref: false }).then(() => { throw new Error('Upload did not reach the synthetic printer'); })
  ]);
  const cancelUpload = button('Cancel upload');
  await cancelUpload.waitFor({ timeout: 3000 });
  const upstreamClosed = once(pendingUpload, 'close', { signal: AbortSignal.timeout(5000) });
  await Promise.all([cancelUpload.click(), upstreamClosed]);
  await uploadProgress.waitFor({ state: 'detached' });
  assert.equal(await path.inputValue(), 'gcode/returned/integration.gcode');
  await page.locator('.oe-remote input[type=file]:enabled').waitFor();
  uploadResponse.resolve();
  uploadResponse = undefined;
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
  await page.locator('#device-oe-tab-webui').click();
  await page.locator('#device-webui-open').waitFor();
  assert.equal(await page.locator('#device-webui-frame').count(), 0);
  assert.equal(await page.locator('#device-webui-open').getAttribute('href'), connection.userFacingUrl);
  assert.equal((await page.locator('#device-webui-open').innerText()).trim(), 'Open in OctoEverywhere');
  await page.locator('#device-oe-tab-remote').click();
  printerOnline = false;
  redirectStatus = true;
  await page.reload();
  await page.locator('#device-connection-error').filter({ hasText: 'Printer is offline' }).waitFor();
  printerOnline = true;
  redirectStatus = false;
  await page.locator('#device-reconnect').click();
  await page.locator('#device-connection-status').filter({ hasText: 'Connected' }).waitFor();
  await page.waitForFunction(() => document.querySelector('.oe-camera img')?.naturalWidth > 0);
  console.log('Device reports a confirmed offline printer and Retry restores status and camera.');
  await page.evaluate(() => window.__printerStore.getState().deletePrinter('synthetic-integrated'));
  console.log('OctoEverywhere immutable candidate: isolation, disabled/missing-ID UI, correlated portal, controls, exact file transfers/start/delete, camera tickets, extras, credential separation and 1440/1280/390/320 screenshots passed.');

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.route('https://**/*', route => route.abort());
  await phone.addInitScript(() => localStorage.setItem('orca.wizard', JSON.stringify({ printers: [], filaments: [] })));
  const mobile = await phone.newPage();
  await mobile.goto(origin + '/device');
  await mobile.locator('#device-add-printer').tap();
  const dialog = mobile.getByRole('dialog', { name: 'Printer connection' });
  await dialog.locator('#pc-name').fill('Mobile workshop printer');
  await dialog.locator('#pc-next').tap();
  await dialog.locator('summary').filter({ hasText: 'OctoEverywhere' }).tap();
  // Exercise the mobile popup-blocked fallback using the real generated link.
  await mobile.evaluate(() => { window.open = () => null; });
  await dialog.getByRole('button', { name: 'Connect OctoEverywhere', exact: true }).tap();
  const link = dialog.getByRole('link', { name: 'Open OctoEverywhere portal' });
  const mobileCallback = new URL(new URL(await link.getAttribute('href')).searchParams.get('returnUrl'));
  for (const [key, value] of Object.entries({ success: 'true', id: connection.connectionId, url: connection.url, appApiToken: connection.appApiToken, authBearerToken: connection.auth.token, printername: connection.printerName, userPrinterAccessUrl: connection.userFacingUrl })) mobileCallback.searchParams.set(key, value);
  const mobileCallbackPage = await phone.newPage();
  await mobileCallbackPage.goto(mobileCallback.href);
  await mobileCallbackPage.getByText('Return to WebOrca to finish connecting. You can close this tab.').waitFor();
  await mobileCallbackPage.close();
  await dialog.getByRole('button', { name: 'Confirm printer binding' }).tap();
  await dialog.locator('#pc-save').tap();
  await dialog.waitFor({ state: 'hidden' });
  await mobile.locator('#device-connection-status').filter({ hasText: 'Connected' }).waitFor({ state: 'attached' });
  await mobile.waitForFunction(() => document.querySelector('.oe-camera img')?.naturalWidth > 0);
  assert.equal(await mobile.evaluate(() => window.__printerStore.getState().printers[0].octoeverywhere.mode), 'remote');
  const fitsPhone = async locator => {
    const bounds = await locator.evaluate(async el => {
      await Promise.all(el.getAnimations().map(animation => animation.finished));
      const { left, right, top, bottom } = el.getBoundingClientRect();
      return { left, right, top, bottom, innerWidth, innerHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    assert.ok(bounds.left >= -1 && bounds.right <= bounds.innerWidth + 1
      && bounds.top >= -1 && bounds.bottom <= bounds.innerHeight + 1
      && bounds.scrollWidth <= bounds.clientWidth + 1, `dialog fits the phone: ${JSON.stringify(bounds)}`);
  };
  await mobile.setViewportSize({ width: 320, height: 720 });
  assert.equal(await mobile.locator('.device-header #device-add-another').isVisible(), false);
  assert.equal(await mobile.locator('.device-header #device-edit-printer').isVisible(), false);
  assert.equal(await mobile.locator('.device-header .device-freshness').isVisible(), false);
  const picker = mobile.locator('#device-printer-select');
  const selected = await picker.inputValue();
  const addOption = picker.locator('option').last();
  assert.equal(await addOption.textContent(), 'Add printer');
  await picker.selectOption(await addOption.getAttribute('value'));
  await dialog.getByRole('heading', { name: 'Add a printer' }).waitFor();
  await dialog.locator('#pc-cancel').tap();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await picker.inputValue(), selected);
  const pickerBounds = await picker.boundingBox();
  const dotBounds = await mobile.locator('#device-connection-dot').boundingBox();
  assert.ok(dotBounds && pickerBounds && dotBounds.x >= pickerBounds.x && dotBounds.y >= pickerBounds.y
    && dotBounds.x + dotBounds.width <= pickerBounds.x + pickerBounds.width
    && dotBounds.y + dotBounds.height <= pickerBounds.y + pickerBounds.height, 'mobile status dot fits inside the picker');
  await mobile.locator('#device-edit-printer').tap();
  await dialog.locator('#pc-name').fill('Renamed on mobile');
  await fitsPhone(dialog.locator('.printer-sheet'));
  await mobile.screenshot({ path: 'wasm/build/tests-octoeverywhere-20261105/mobile-printer-settings.png' });
  await mobile.keyboard.press('Escape');
  const discard = mobile.getByRole('alertdialog');
  await discard.waitFor();
  await fitsPhone(discard.locator('.ds-dialog'));
  await discard.getByTestId('confirm-cancel').tap();
  await dialog.locator('#pc-save').tap();
  await dialog.waitFor({ state: 'hidden' });
  await mobile.waitForFunction(() => {
    const [printer] = window.__printerStore.getState().printers;
    return printer.name === 'Renamed on mobile' && printer.octoeverywhere.mode === 'remote';
  });
  const navigation = mobile.getByRole('navigation', { name: 'Main navigation' });
  await navigation.getByRole('button', { name: 'Prepare', exact: true }).tap();
  await navigation.getByRole('button', { name: 'Device', exact: true }).tap();
  await mobile.waitForFunction(() => document.querySelector('.oe-camera img')?.naturalWidth > 0);
  await mobile.locator('.device-remote-body').evaluate(element => { element.scrollTop = 0; });
  await mobile.screenshot({ path: 'wasm/build/tests-octoeverywhere-20261105/dashboard-phone.png' });
  const materials = mobile.locator('.oe-material');
  assert.equal(await materials.locator('summary').textContent(), 'Materials');
  assert.doesNotMatch(await materials.innerText(), /Tool B · Unknown \/ Unknown °C/);
  await mobile.getByRole('group', { name: 'Temperatures' }).getByText('26.0 °C').waitFor();
  const startCalls = calls.filter(call => call.path.endsWith('/start')).length;
  const files = mobile.locator('.oe-files');
  const filesSummary = files.locator('summary');
  if (await filesSummary.count() && !await files.evaluate(element => element.open)) await filesSummary.tap();
  await mobile.getByLabel('Existing virtual path').fill('gcode/phone.gcode');
  await mobile.getByRole('button', { name: 'Start print…', exact: true }).tap();
  const start = mobile.getByRole('alertdialog', { name: 'Start print?' });
  await fitsPhone(start.locator('.ds-dialog'));
  await start.getByTestId('confirm-cancel').tap();
  assert.equal(calls.filter(call => call.path.endsWith('/start')).length, startCalls);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 320);
  // A visible phone page can report no DOM focus after reload until the user switches apps.
  await mobile.addInitScript(() => { document.hasFocus = () => false; });
  const beforeReload = calls.filter(call => call.path.includes('/webcam/snapshot')).length;
  await mobile.reload();
  await mobile.locator('#device-connection-status').filter({ hasText: 'Connected' }).waitFor({ state: 'attached', timeout: 8000 });
  await mobile.waitForFunction(() => document.querySelector('.oe-camera img')?.naturalWidth > 0, null, { timeout: 8000 });
  assert.equal(calls.filter(call => call.path.includes('/webcam/snapshot')).length, beforeReload + 1);
  const pickerStyle = await picker.evaluate(element => ({
    font: parseFloat(getComputedStyle(element).fontSize),
    height: element.getBoundingClientRect().height
  }));
  assert.ok(pickerStyle.font < 16 && pickerStyle.height >= 48, 'smaller mobile type keeps the picker touch target');
  await phone.close();
  console.log('Mobile printer setup, confirmations and reconnect on refresh without a focus event passed.');

} finally {
  uploadResponse?.resolve();
  await browser?.close(); gateway.close(); missingId.close(); disabled.close(); server.closeAllConnections(); upstream.closeAllConnections();
  await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  await stopServer(staticPort);
}
