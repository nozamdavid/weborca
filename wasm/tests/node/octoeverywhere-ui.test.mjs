import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { before, after, test } from 'node:test';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

const jpegBytes = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z', 'base64');

// Actual React components and OE client, with synthetic same-origin endpoints. No app
// build, account, external service or printer is involved in this focused harness.
const resolveDir = new URL('../../app', import.meta.url).pathname;
const connection = { connectionId: 'synthetic-ui', url: 'https://synthetic.octoeverywhere.com/',
  appApiToken: 'synthetic-app-secret', auth: { type: 'bearer', token: 'synthetic-auth-secret' },
  printerName: 'Authorized fixture', userFacingUrl: 'https://octoeverywhere.com/view/Fixture' };
const printer = (host_type = 'moonraker', mode = 'remote') => ({ id: 'fixture', name: 'Workshop printer', host_type,
  print_host: '192.0.2.1', printhost_apikey: 'synthetic-native-secret', cloud_refresh_token: 'synthetic-cloud-secret',
  octoeverywhere: { mode, connection } });
const status = { Features: 63, JobStatus: { State: 'idle', Lights: [{ Name: 'Chamber light', On: false }],
  CurrentPrint: { Temps: { BedActual: 25, BedTarget: 0, HotendActual: 26, HotendTarget: 0 } },
  MaterialSystem: { Sources: [{ Id: 'source-7', Name: 'Spool A', UnitId: 'unit-9', PrintMappingValue: 7, Material: { Type: 'PLA', ColorHex: 'E59A52' } }],
    Tools: [{ Id: 'tool-3', Name: 'Tool B', Index: 3 }], Units: [{ Id: 'unit-9', Name: 'Dry box', HumidityPercent: 24 }], Routes: [{ SourceId: 'source-7', ToolId: 'tool-3', State: 'loaded' }] } },
  ListWebcams: { Webcams: [{ Name: 'Work camera', Enabled: true, FlipH: true, Rotation: 90 }, { Name: 'Side camera', Enabled: true }] } };
let browser, js, css;
before(async () => {
  const stubs = {
    session: `import {usePrinterConnectionStore as store} from '${resolveDir}/src/printers/connectionStore'; export const getCurrentPrinterApi=()=>store.getState().activeApi; export const reconnectPrinterSession=()=>{};`,
    gatewayUrl: `export const localGatewayBase=()=>undefined;export const createUiSession=()=>Promise.reject(Error('unexpected'));export const parseHost=value=>({scheme:'http',hostPort:value,basePath:''});`,
    i18n: `export const useTranslation=()=>({t:(s)=>s});`,
    appStore: `export const useAppStore=select=>select({selectedPrinter:''});`,
    useMobile: `export const useMobile=()=>false;`,
    MobileInput: `import React from 'react';export const MobileInput=React.forwardRef((props,ref)=><input {...props} ref={ref}/>);`,
    MobileSelect: `import React from 'react';export const MobileSelect=({onValueChange,...props})=><select {...props} onChange={e=>onValueChange(e.target.value)}/>;`,
    exportGcode: `export const getExportGcodePayload=async()=>({gcode:new Uint8Array([71,50,56])});`,
    api: `import {OctoEverywhereApi} from '${resolveDir}/src/printers/octoEverywhere';export const createPrinterApi=p=>new OctoEverywhereApi(p);`,
  };
  const bundle = await build({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {DevicePanel} from './src/printers/DevicePanel';
    import {OctoEverywhereConnection} from './src/printers/OctoEverywhereConnection';
    import {OctoEverywherePanel} from './src/printers/OctoEverywherePanel';
    import {OctoEverywhereApi} from './src/printers/octoEverywhere';
    import {completePortalCallback} from './src/printers/octoEverywherePortal';
    import {usePrinterConnectionStore as store} from './src/printers/connectionStore';
    import {ConfirmHost} from './src/components/ModalBackdrop';
    import {SendToPrinterDialog} from './src/printers/SendToPrinterDialog';
    import './src/index.css'; import './src/App.css';
    import './src/mobile/mobile.css'; import './src/mobile/mobileShell.css'; import './src/mobile/mobileControls.css';
    const root=createRoot(document.getElementById('root'));let currentView='device';const bytes=new Uint8Array([71,50,56]);
    function Fixture(){const s=store();const p=s.printers.find(p=>p.id===s.selectedPrinterId);return <><ConfirmHost/>{p && (currentView==='link'
      ? <OctoEverywhereConnection key={p.id} printer={p} onChange={store.getState().savePrinter}/>
      : currentView==='panel' ? <OctoEverywherePanel key={p.id} printer={p} state={s.liveState} active={true}/> : currentView==='send' ? <SendToPrinterDialog getGcode={()=>bytes} defaultFilename="cube.gcode"/> : <DevicePanel active={true}/>)}</>;}
    window.fixture={store, completePortalCallback, async seed(p,view='device'){store.getState().activeApi?.dispose?.();currentView=view;
      const api=new OctoEverywhereApi(p);store.setState({printers:[p],selectedPrinterId:p.id,activeApi:api,status:'online',liveState:null,sendDialogOpen:view==='send'});
      if(view!=='link'){await api.getInfo();store.setState({liveState:await api.readStatus()});}root.render(<Fixture/>);},
      async refresh(){const api=store.getState().activeApi;store.setState({liveState:await api.readStatus()});},
      unmount(){root.unmount();}};
    `, resolveDir, loader: 'tsx' }, bundle: true, format: 'iife', platform: 'browser', write: false,
    outdir: 'out', external: ['/fonts/*', '/icons/*'], define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'focused-ui-boundaries', setup(b) {
      b.onResolve({ filter: /\// }, args => { const name = args.path.split('/').at(-1); if (name in stubs) return { path: name, namespace: 'fixture' }; });
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], resolveDir, loader: 'tsx' }));
    } }] });
  js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

async function fixture(t, { host = 'moonraker', view = 'device', mode = 'remote', config = { enabled: true, appId: 'synthetic-app', portalAvailable: true }, initialStatus = status, uploadResponse } = {}) {
  const calls = []; let currentStatus = structuredClone(initialStatus); let streamError = false;
  const openStreams = new Set();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html data-theme="dark"><head><style>${css}body{margin:0;background:var(--bg-base);font-family:var(--font-sans);font-size:13px}#root{height:100vh}.ds-scrim--confirm{position:fixed;inset:0;z-index:9999;background:#0008;display:grid;place-items:center}</style></head><body><div id="root"></div><script>${js}</script></body></html>`);
      return;
    }
    if (/^\/(fonts|icons)\//.test(url.pathname)) { res.writeHead(204); res.end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    calls.push({ path: url.pathname, query: url.search, method: req.method, headers: req.headers, body });
    const envelope = value => ({ Status: 200, Result: value });
    if (url.pathname === '/_octoeverywhere/plugin/files/download') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end('G28\n'); return; }
    if (url.pathname === '/_octoeverywhere/plugin/webcam/snapshot') { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(jpegBytes); return; }
    if (url.pathname === '/_octoeverywhere/plugin/webcam/stream') {
      if (streamError) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'stream failed', code: 502 })); return; }
      openStreams.add(res); res.on('close', () => openStreams.delete(res));
      res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame' });
      res.write(Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpegBytes.length}\r\n\r\n`), jpegBytes, Buffer.from('\r\n')]));
      return;
    }
    let result = {};
    if (url.pathname === '/_octoeverywhere/config') result = config;
    else if (url.pathname === '/_octoeverywhere/info') result = { IsOnline: true, PrinterLimits: { MaxUploadFileSizeBytes: 1048576, MaxDownloadFileSizeBytes: 2097152, MaxSingleWebcamStreamLengthSeconds: 1 } };
    else if (url.pathname === '/_octoeverywhere/plugin/status') result = envelope(currentStatus);
    else if (url.pathname === '/_octoeverywhere/plugin/webcam/list') result = envelope({ Webcams: [{ Name: 'Listed camera', Enabled: true }] });
    else if (url.pathname === '/_octoeverywhere/plugin/files/list') result = envelope({ Root: [{ Type: 'file', Name: 'cube.gcode', VirtualPath: 'gcode/exact/cube.gcode', PlatformPath: '/disk/cube.gcode', SizeBytes: 12 }, { Type: 'file', Name: 'project.3mf', VirtualPath: 'gcode/exact/project.3mf' }] });
    else if (url.pathname === '/_octoeverywhere/plugin/files/upload') {
      await uploadResponse;
      result = envelope({ VirtualPath: 'gcode/returned/upload.gcode', PlatformPath: '/disk/upload.gcode' });
    }
    else if (url.pathname === '/_octoeverywhere/plugin/files/details') result = envelope({ VirtualPath: 'gcode/exact/cube.gcode', PlatformPath: '/disk/cube.gcode', FileName: 'cube.gcode' });
    else if (url.pathname === '/_octoeverywhere/live-link') result = { LiveId: 'synthetic-live', Url: 'https://octoeverywhere.com/live/synthetic', ShortUrl: 'https://oe.link/synthetic' };
    else if (url.pathname.startsWith('/_octoeverywhere/plugin/')) result = envelope({});
    else if (url.pathname.startsWith('/_octoeverywhere/')) result = {};
    else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  t.after(async () => {
    for (const s of openStreams) s.destroy();
    await context.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await context.route('https://**/*', route => route.abort());
  await page.goto(origin + '/');
  await page.evaluate(() => { window.open = () => ({ opener: null, close() {}, location: { replace(url) { window.syntheticPortal = url; } } }); navigator.clipboard.writeText = async value => { window.copied = value; }; });
  await page.evaluate(async ({ p, view }) => window.fixture.seed(p, view), { p: printer(host, mode), view });
  await page.waitForSelector(view === 'send' ? '#send-to-printer-dialog' : '.oe-panel');
  return { page, calls, setStreamError: value => { streamError = value; }, setStatus: async value => { currentStatus = value; await page.evaluate(() => window.fixture.refresh()); } };
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
const disclose = async (page, name) => {
  const section = page.locator('summary').filter({ hasText: name }).or(page.getByRole('heading', { name, exact: true }));
  if (await section.evaluate(element => element.tagName === 'SUMMARY' && !element.parentElement.open)) await section.click();
};
const confirm = page => page.getByTestId('confirm-ok').click();

test('portal success requires explicit printer binding; transport selection retains local fields and detach confirms', async t => {
  const { page, calls } = await fixture(t, { view: 'link', mode: 'local' });
  await button(page, 'Reconnect OctoEverywhere').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.syntheticPortal);
  const portalUrl = new URL(await page.evaluate(() => window.syntheticPortal));
  assert.equal(portalUrl.searchParams.get('appid'), 'synthetic-app');
  assert.equal(portalUrl.searchParams.has('printerId'), false, 'portal flow must not send local printer UUID as printerId');
  const returnUrl = new URL(portalUrl.searchParams.get('returnUrl'));
  assert.match(returnUrl.pathname, /^\/octoeverywhere\/callback\/[\w-]+$/);
  for (const [k, v] of Object.entries({ success: 'true', id: connection.connectionId, url: connection.url, appApiToken: connection.appApiToken, authBearerToken: connection.auth.token, printername: connection.printerName, userPrinterAccessUrl: connection.userFacingUrl })) returnUrl.searchParams.set(k, v);
  const outcome = await page.evaluate(url => window.fixture.completePortalCallback(url), returnUrl.href);
  assert.deepEqual(outcome, { status: 'complete' });
  await page.getByText('Bind authorized printer', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.fixture.store.getState().printers[0].octoeverywhere.mode), 'local');
  await button(page, 'Confirm printer binding').click();
  await page.waitForFunction(() => window.fixture.store.getState().printers[0].octoeverywhere.mode === 'remote');
  await button(page, 'Local').click(); await button(page, 'OctoEverywhere').click();
  assert.equal(await page.evaluate(() => window.fixture.store.getState().printers[0].printhost_apikey), 'synthetic-native-secret');
  assert.equal(await page.getByRole('link', { name: 'Open printer' }).getAttribute('href'), connection.userFacingUrl);
  await button(page, 'Detach').click(); await confirm(page);
  await page.waitForFunction(() => !window.fixture.store.getState().printers[0].octoeverywhere);
  assert.equal(calls.some(call => /\/(sessions|ticket|portal\/start|portal\/result)/.test(call.path)), false);
  assert.doesNotMatch(await page.locator('body').innerText(), /synthetic-(app|auth|native|cloud)-secret/);
});

test('portal cancel, deleted or edited printer and missing App ID never bind stale credentials', async t => {
  const { page, calls } = await fixture(t, { view: 'link' });
  await button(page, 'Reconnect OctoEverywhere').click(); await page.getByText('Authorize in the new tab.', { exact: false }).waitFor();
  assert.ok(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('orca.oe.portal.'))));
  await button(page, 'Cancel connection').click();
  await page.waitForFunction(() => !document.body.innerText.includes('Authorize in the new tab.'));
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('orca.oe.portal.'))), false, 'cancel cleans up localStorage');
  await button(page, 'Reconnect OctoEverywhere').click(); await page.getByText('Authorize in the new tab.', { exact: false }).waitFor();
  await page.evaluate(() => { const s = window.fixture.store.getState(); s.savePrinter({ ...s.printers[0], name: 'Edited printer' }); });
  await page.waitForFunction(() => !document.body.innerText.includes('Authorize in the new tab.'));
  assert.equal(await button(page, 'Confirm printer binding').count(), 0);
  await page.evaluate(() => window.fixture.store.getState().deletePrinter('fixture'));
  assert.equal(await button(page, 'Confirm printer binding').count(), 0);
  const unavailable = await fixture(t, { view: 'link', config: { enabled: true, portalAvailable: false } });
  await unavailable.page.getByText('Connecting requires a production', { exact: false }).waitFor();
  assert.equal(await button(unavailable.page, 'Reconnect OctoEverywhere').isDisabled(), true);
  assert.equal(unavailable.calls.some(call => call.path.includes('/portal/start')), false);
  const disabled = await fixture(t, { view: 'link', config: { enabled: false, portalAvailable: false } });
  await disabled.page.getByText('Remote access is disabled', { exact: false }).waitFor();
  assert.equal(await button(disabled.page, 'Reconnect OctoEverywhere').isDisabled(), true);
  assert.equal(calls.some(call => /\/(sessions|ticket|portal\/start)/.test(call.path)), false);
});

test('runtime controls omit native operations and enforce remote temperature limits; material joins use opaque IDs', async t => {
  const { page, calls, setStatus } = await fixture(t);
  assert.equal(await page.locator('#control-home-xy').count(), 0); assert.equal(await page.locator('#control-group-fan').count(), 0);
  assert.equal(await page.locator('#control-group-speed').count(), 0);
  assert.equal(await page.locator('#control-temp-nozzle-input').getAttribute('max'), '260');
  const nozzle = page.locator('#control-group-temps input').first();
  await page.getByLabel('Tool', { exact: true }).selectOption('3');
  await nozzle.fill('290');
  await page.locator('#control-group-temps button').first().click();
  await page.waitForTimeout(50);
  const temp = calls.find(call => call.path.endsWith('/set-temp'));
  assert.ok(temp); assert.match(temp.body, /260/);
  assert.equal(JSON.parse(temp.body).ToolNumber, 3);
  await page.locator('#control-temp-bed-input').fill('100'); await page.locator('#control-temp-bed-set').click();
  await page.waitForTimeout(50); assert.ok(calls.some(call => call.path.endsWith('/set-temp') && JSON.parse(call.body).BedC === 75));
  await page.locator('#control-home-all').click(); await page.locator('#control-extrude').click();
  assert.ok(calls.filter(call => call.path.endsWith('/extrude')).every(call => !call.body.includes('Speed')));
  await disclose(page, 'Material and tools');
  assert.match(await page.locator('.oe-remote').innerText(), /Presence unknown[\s\S]*Dry box[\s\S]*Tool B/);
  assert.equal(await page.getByRole('img', { name: 'Material color E59A52' }).evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(229, 154, 82)');
  await setStatus({ ...status, Features: 0 });
  assert.equal(await page.locator('#control-group-home').count(), 0);
  const infoCall = calls.find(c => c.path === '/_octoeverywhere/info');
  assert.equal(infoCall?.headers['x-octoeverywhere-app-token'], connection.appApiToken);
  const pluginCall = calls.find(c => c.path.startsWith('/_octoeverywhere/plugin/'));
  assert.equal(pluginCall?.headers['x-octoeverywhere-target'], connection.url);
  assert.equal(pluginCall?.headers['x-octoeverywhere-auth'], `Bearer ${connection.auth.token}`);
  assert.equal(pluginCall?.headers['x-octoeverywhere-app-token'], undefined);
  assert.equal(calls.some(c => /\/(sessions|ticket|portal\/start)/.test(c.path)), false);
});

test('files preserve returned VirtualPath, separate upload/start, confirm delete; extras require explicit calls', async t => {
  const upload = Promise.withResolvers();
  t.after(upload.resolve);
  const { page, calls } = await fixture(t, { view: 'panel', uploadResponse: upload.promise });
  assert.equal(calls.some(call => /live-link|notifications/.test(call.path)), false);
  await disclose(page, 'Printer files'); await button(page, 'Refresh files').click();
  await page.getByText('gcode/exact/cube.gcode', { exact: false }).first().waitFor();
  await button(page, 'Details').first().click(); await page.getByText('/disk/cube.gcode', { exact: true }).waitFor();
  const download = page.waitForEvent('download'); await button(page, 'Download').first().click();
  assert.equal((await download).suggestedFilename(), 'cube.gcode');
  assert.ok(calls.some(call => call.path.endsWith('/files/download') && call.query.includes('gcode%2Fexact%2Fcube.gcode')));
  await page.locator('input[type=file]').setInputFiles({ name: 'upload.gcode', mimeType: 'application/octet-stream', buffer: Buffer.from('G28') });
  await page.getByText('Waiting for the printer...', { exact: true }).waitFor();
  const progress = page.getByRole('progressbar', { name: 'Uploading' });
  assert.equal(await progress.getAttribute('aria-valuenow'), '100');
  assert.equal(await page.locator('input[type=file]').isDisabled(), true);
  assert.equal(await page.getByText('Uploaded. Review print options before starting.').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await progress.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, 'progress fits within the phone viewport');
  await page.setViewportSize({ width: 1440, height: 900 });
  upload.resolve();
  await page.waitForFunction(() => document.querySelector('input[placeholder="gcode/filename.gcode"]')?.value === 'gcode/returned/upload.gcode');
  await progress.waitFor({ state: 'detached' });
  assert.equal(calls.some(call => call.path.endsWith('/start')), false);
  await button(page, 'Start print…').click(); assert.equal(calls.some(call => call.path.endsWith('/start')), false); await confirm(page);
  await page.getByText('Print start requested.', { exact: true }).waitFor();
  assert.equal(JSON.parse(calls.find(call => call.path.endsWith('/start')).body).Path, 'gcode/returned/upload.gcode');
  await button(page, 'Delete').first().click(); await confirm(page);
  await page.waitForTimeout(50); assert.ok(calls.some(call => call.path.endsWith('/files/delete') && call.query.includes('gcode%2Fexact%2Fcube.gcode')));
  await disclose(page, 'Sharing and notifications');
  await button(page, 'Create temporary Live Link').click(); await confirm(page); await button(page, 'Copy Live Link').click();
  assert.equal(await page.evaluate(() => window.copied), 'https://oe.link/synthetic');
  await page.getByLabel('HTTPS callback URL').fill('https://callback.example/events'); await page.getByLabel('Inclusive event types', { exact: false }).fill('1, 3');
  await button(page, 'Set webhook').click(); await confirm(page); await page.getByText('Webhook registered.', { exact: false }).waitFor();
  assert.deepEqual(JSON.parse(calls.find(call => call.path.endsWith('/notifications') && call.method === 'POST').body).InclusiveEventTypesFilter, [1, 3]);
  await button(page, 'Test webhook').click(); await confirm(page); await page.getByText('Test notification requested.').waitFor();
  await button(page, 'Delete webhook').click(); await confirm(page); await page.getByText('Webhook deleted.').waitFor();
  const liveCall = calls.find(c => c.path === '/_octoeverywhere/live-link');
  assert.equal(liveCall?.headers['x-octoeverywhere-app-token'], connection.appApiToken);
  const notifCall = calls.find(c => c.path === '/_octoeverywhere/notifications');
  assert.equal(notifCall?.headers['x-octoeverywhere-app-token'], connection.appApiToken);
  assert.equal(calls.some(c => /\/(sessions|ticket|portal\/start)/.test(c.path)), false);
  assert.doesNotMatch(await page.locator('body').innerText(), /synthetic-(app|auth|native|cloud)-secret/);
});

test('Bambu exposes compatible 3MF plate/AMS options and PrusaLink allows existing-path start without file browser', async t => {
  const { page, calls } = await fixture(t, { view: 'panel', host: 'bambu' });
  await disclose(page, 'Printer files');
  await page.getByLabel('Existing virtual path').fill('gcode/raw.gcode'); assert.equal(await button(page, 'Start print…').isDisabled(), true);
  await page.getByLabel('Existing virtual path').fill('gcode/project.3mf'); await page.getByLabel('Plate (optional)').fill('2'); await page.getByLabel('Use AMS', { exact: true }).check();
  await page.getByLabel('AMS mapping values', { exact: false }).fill('7, 2'); await button(page, 'Start print…').click(); await confirm(page);
  await page.getByText('Print start requested.').waitFor();
  const payload = JSON.parse(calls.find(call => call.path.endsWith('/start')).body); assert.equal(payload.Plate, 2); assert.equal(payload.UseAms, true); assert.deepEqual(payload.AmsMapping, [7, 2]);
  assert.equal(payload.BedLeveling, false, 'unchecked explicit options are sent as false');
  const prusa = await fixture(t, { view: 'panel', host: 'prusalink' }); await disclose(prusa.page, 'Printer files');
  assert.equal(await button(prusa.page, 'Refresh files').count(), 0); assert.equal(await prusa.page.locator('input[type=file]').count(), 0);
  await prusa.page.getByLabel('Existing virtual path').fill('gcode/saved.gcode'); await prusa.page.getByLabel('Storage (optional)').fill('usb'); await button(prusa.page, 'Start print…').click(); await confirm(prusa.page);
  await prusa.page.getByText('Print start requested.').waitFor(); assert.equal(JSON.parse(prusa.calls.find(call => call.path.endsWith('/start')).body).Storage, 'usb');
});

test('camera transforms, bounded cleanup, explicit reconnect and unmount; desktop/mobile fit and screenshots', async t => {
  const { page, calls, setStreamError } = await fixture(t);
  assert.equal(await page.locator('.oe-camera').evaluate(el => el.open), true, 'Cameras disclosure should be open by default');
  await page.locator('.oe-camera img').waitFor();
  assert.equal(calls.filter(call => call.path.includes('/webcam/snapshot')).length, 1, 'mount requests one snapshot');
  assert.equal(calls.filter(call => call.path.includes('/webcam/stream')).length, 0, 'mount must not start a stream');
  await page.evaluate(() => window.fixture.refresh());
  await page.waitForTimeout(100);
  assert.equal(calls.filter(call => call.path.includes('/webcam/snapshot')).length, 1, 'status refresh keeps the snapshot');
  await button(page, 'Stop camera').click();
  await page.evaluate(() => window.fixture.refresh());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.oe-camera img').count(), 0, 'explicit stop survives status refresh');
  await button(page, 'Start stream').click();
  await page.locator('.oe-camera img').waitFor();
  assert.match(await page.locator('.oe-camera img').getAttribute('src'), /^blob:/);
  assert.match(await page.locator('.oe-camera img').getAttribute('style'), /rotate\(90deg\) scale\(-1, 1\)/);
  await page.locator('.oe-camera img').waitFor({ state: 'detached', timeout: 3000 });
  assert.equal(calls.filter(call => call.path === '/_octoeverywhere/plugin/webcam/stream').length, 1);
  await button(page, 'Start stream').click(); await page.locator('.oe-camera img').waitFor();
  await page.locator('.oe-camera img').evaluate(img => img.dispatchEvent(new Event('error'))); await page.locator('.oe-camera img').waitFor({ state: 'detached' });
  await page.getByText('Camera image could not be loaded. Check the printer webcam in OctoEverywhere.').waitFor();
  await button(page, 'Start stream').click(); await page.locator('.oe-camera img').waitFor();
  await page.locator('.oe-camera img').evaluate(img => img.dispatchEvent(new Event('load')));
  assert.equal(await page.locator('.oe-camera img').count(), 1, 'load event on MJPEG stream must keep camera image attached');
  await page.getByLabel('Camera', { exact: true }).selectOption('1'); await page.locator('.oe-camera img').waitFor({ state: 'detached' });
  await page.getByLabel('Camera', { exact: true }).selectOption('0');
  await button(page, 'Start stream').click(); await page.locator('.oe-camera img').waitFor();
  await page.evaluate(() => window.fixture.unmount()); assert.equal(await page.locator('.oe-camera img[src]').count(), 0);

  // Stream HTTP errors surface message and never keep stale image.
  const errCam = await fixture(t, { view: 'panel' });
  errCam.setStreamError(true);
  await button(errCam.page, 'Start stream').click();
  await errCam.page.getByText('OctoEverywhere could not complete this action.', { exact: false }).waitFor();
  assert.equal(await errCam.page.locator('.oe-camera img').count(), 0);

  // Cameras remain available when ListWebcams is omitted from status; snapshot survives; Refresh cameras populates select.
  const { ListWebcams: _omitted, ...statusWithoutWebcams } = status;
  const noList = await fixture(t, { view: 'panel', initialStatus: statusWithoutWebcams });
  assert.equal(await noList.page.locator('.oe-camera').evaluate(el => el.open), true);
  assert.equal(await noList.page.getByLabel('Camera', { exact: true }).count(), 0);
  await noList.page.locator('.oe-camera img').waitFor();
  assert.match(await noList.page.locator('.oe-camera img').getAttribute('src'), /^blob:/);
  assert.equal(noList.calls.at(-1).path, '/_octoeverywhere/plugin/webcam/snapshot');
  assert.equal(noList.calls.at(-1).query, '?index=0');
  await noList.page.waitForTimeout(120);
  assert.equal(await noList.page.locator('.oe-camera img').count(), 1, 'loaded snapshot must remain displayed');
  await button(noList.page, 'Start stream').click();
  await noList.page.locator('.oe-camera img').waitFor();
  assert.equal(noList.calls.at(-1).path, '/_octoeverywhere/plugin/webcam/stream');
  assert.equal(noList.calls.at(-1).query, '?index=0');
  await button(noList.page, 'Refresh cameras').click();
  await noList.page.getByLabel('Camera', { exact: true }).waitFor();
  assert.ok(noList.calls.some(c => c.path === '/_octoeverywhere/plugin/webcam/list'));
  assert.match(await noList.page.getByLabel('Camera', { exact: true }).innerText(), /Listed camera/);
  assert.equal(calls.some(c => /\/(sessions|ticket|portal\/start)/.test(c.path)), false);

  const fit = await fixture(t); await disclose(fit.page, 'Printer files'); await disclose(fit.page, 'Material and tools');
  for (const width of [1440, 1280, 390, 320]) {
    await fit.page.setViewportSize({ width, height: 900 });
    const dimensions = await fit.page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.width, `horizontal fit at ${width}: ${JSON.stringify(dimensions)}`);
    if (width <= 800) {
      assert.ok(await fit.page.locator('.oe-panel summary, .oe-options label:has(input[type=checkbox])').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().height>=44)),`touch disclosure and option targets at ${width}`);
    }
    await fit.page.screenshot({ path: `wasm/build/tests-octoeverywhere-20261105/ui-${width}.png`, fullPage: true });
    await fit.page.locator('.oe-remote').scrollIntoViewIfNeeded();
    assert.ok(await fit.page.locator('.oe-remote').evaluate(element => element.scrollWidth <= element.clientWidth), `remote tools fit at ${width}`);
    await fit.page.screenshot({ path: `wasm/build/tests-octoeverywhere-20261105/ui-remote-${width}.png`, fullPage: true });
  }
});

test('remote cloud send permits upload by actual capabilities, offers separate start and disposes temporary adapter', async t => {
  const upload = Promise.withResolvers();
  t.after(upload.resolve);
  const { page, calls } = await fixture(t, { host: 'bambu-cloud', view: 'send', uploadResponse: upload.promise });
  const gcodePrinter = await fixture(t, { view: 'send' });
  assert.match(await gcodePrinter.page.locator('#send-to-printer-dialog').innerText(),/Device → Printer files/);
  assert.equal(await page.locator('#send-upload').isDisabled(), false);
  assert.equal(await page.locator('#send-print').count(), 0);
  await page.locator('#send-upload').click();
  await page.getByText('Waiting for the printer...', { exact: true }).waitFor();
  const progress = page.getByRole('progressbar', { name: 'Uploading' });
  assert.equal(await progress.getAttribute('aria-valuenow'), '100');
  assert.equal(await page.locator('#send-result').count(), 0);
  upload.resolve();
  await page.locator('#send-result[data-ok=true]').waitFor();
  await progress.waitFor({ state: 'detached' });
  assert.ok(calls.some(call => call.method === 'PUT' && call.path === '/_octoeverywhere/plugin/files/upload'));
  assert.equal(calls.some(call => call.path.endsWith('/start')), false);
  assert.equal(calls.some(call => /\/(sessions|ticket|portal\/start)/.test(call.path)), false);
  assert.ok(calls.every(call => !JSON.stringify(call).includes('synthetic-native-secret') && !JSON.stringify(call).includes('synthetic-cloud-secret')));
  const unsupported = await fixture(t, { host: 'snapmaker-cloud', view: 'send' });
  assert.equal(await unsupported.page.locator('#send-upload').isDisabled(), true);
});

test('default snapshot waits for live online state and skips explicitly disabled cameras', async t => {
  const pending = await fixture(t, { initialStatus: {} });
  await pending.page.waitForTimeout(100);
  assert.equal(pending.calls.filter(call => call.path.endsWith('/webcam/snapshot')).length, 0);
  await pending.setStatus(status);
  await pending.page.locator('.oe-camera img').waitFor();
  assert.equal(pending.calls.filter(call => call.path.endsWith('/webcam/snapshot')).length, 1);
  const disabled = await fixture(t, { initialStatus: { ...status, ListWebcams: { Webcams: [{ Name: 'Disabled', Enabled: false }] } } });
  await disabled.page.waitForTimeout(100);
  assert.equal(disabled.calls.filter(call => call.path.endsWith('/webcam/snapshot')).length, 0);
  const enabled = await fixture(t, { initialStatus: { ...status, ListWebcams: { Webcams: [{ Name: 'Disabled', Enabled: false }, { Name: 'Enabled', Enabled: true }] } } });
  await enabled.page.locator('.oe-camera img').waitFor();
  assert.equal(enabled.calls.find(call => call.path.endsWith('/webcam/snapshot')).query, '?index=1');
  const delayed = await fixture(t, { initialStatus: {} });
  await delayed.setStatus({ ...status, ListWebcams: { Webcams: [{ Name: 'Disabled', Enabled: false }, { Name: 'Enabled', Enabled: true }] } });
  await delayed.page.locator('.oe-camera img').waitFor({ timeout: 3000 });
  assert.equal(delayed.calls.find(call => call.path.endsWith('/webcam/snapshot')).query, '?index=1');
  await delayed.page.evaluate(() => window.fixture.refresh());
  await delayed.page.waitForTimeout(100);
  assert.equal(delayed.calls.filter(call => call.path.endsWith('/webcam/snapshot')).length, 1);
  assert.equal(delayed.calls.filter(call => call.path.endsWith('/webcam/stream')).length, 0);
});

test('remote Device panel switches between Remote tools and Open in OctoEverywhere Web UI', async t => {
  const { page, calls } = await fixture(t);
  await page.locator('.oe-camera img').waitFor();
  assert.equal(await page.locator('#device-oe-tab-remote').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#device-oe-tab-webui').getAttribute('aria-selected'), 'false');
  assert.equal(await page.locator('.oe-remote').count(), 1);
  assert.equal(await page.locator('#device-webui-frame').count(), 0);

  await page.locator('#device-oe-tab-webui').click();
  await page.locator('#device-webui-open').waitFor();
  assert.equal(await page.locator('#device-oe-tab-webui').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#device-oe-tab-remote').getAttribute('aria-selected'), 'false');
  assert.equal(await page.locator('#device-webui-frame').count(), 0);
  assert.equal(await page.locator('#device-webui-open').getAttribute('href'), connection.userFacingUrl);
  assert.equal((await page.locator('#device-webui-open').innerText()).trim(), 'Open in OctoEverywhere');
  await page.getByText(connection.userFacingUrl, { exact: true }).waitFor();

  for (const width of [1440, 1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.width, `web ui horizontal fit at ${width}: ${JSON.stringify(dimensions)}`);
    if (width <= 800) {
      assert.ok(await page.locator('.device-oe-tab').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height >= 44)), `tab touch target height at ${width}`);
    }
  }

  await page.locator('#device-oe-tab-remote').click();
  await page.locator('.oe-remote').waitFor();
  await page.locator('.oe-camera img').waitFor();
  await page.evaluate(() => window.fixture.refresh());
  await page.waitForTimeout(100);
  assert.equal(calls.filter(call => call.path.endsWith('/webcam/snapshot')).length, 2, 'one snapshot per pane opening');
  assert.equal(calls.filter(call => call.path.endsWith('/webcam/stream')).length, 0);
  assert.equal(await page.locator('#device-oe-tab-remote').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#device-oe-tab-webui').getAttribute('aria-selected'), 'false');
});

for (const view of ['panel', 'send']) {
  test(`${view} cancels an active upload and immediately retries`, async t => {
    const upload = Promise.withResolvers();
    t.after(upload.resolve);
    const { page, calls } = await fixture(t, { view, uploadResponse: upload.promise });
    if (view === 'panel') await disclose(page, 'Printer files');
    const start = () => view === 'send' ? page.locator('#send-upload').click()
      : page.locator('input[type=file]').setInputFiles({ name: 'retry.gcode', mimeType: 'application/octet-stream', buffer: Buffer.from('G28') });
    await start();
    await page.getByText('Waiting for the printer...', { exact: true }).waitFor();
    await button(page, 'Cancel upload').click();
    await page.getByText('Upload cancelled. The file may already be in Printer files.', { exact: true }).waitFor();
    if (view === 'send') assert.equal(await page.locator('#send-result[data-ok]').count(), 0);
    await page.getByRole('progressbar').waitFor({ state: 'detached' });
    // Cancellation leaves the shared adapter usable for monitoring.
    await page.evaluate(() => window.fixture.refresh());
    await start();
    await page.getByText('Waiting for the printer...', { exact: true }).waitFor();
    upload.resolve();
    await page.getByRole('progressbar').waitFor({ state: 'detached' });
    if (view === 'send') await page.locator('#send-result[data-ok=true]').waitFor();
    else await page.getByText('Uploaded. Review print options before starting.').waitFor();
    assert.equal(calls.filter(call => call.method === 'PUT' && call.path.endsWith('/files/upload')).length, 2);
    assert.equal(calls.some(call => call.path.endsWith('/start')), false);
  });
}
