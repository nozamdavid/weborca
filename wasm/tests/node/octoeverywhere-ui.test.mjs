import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

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
  MaterialSystem: { Sources: [{ Id: 'source-7', Name: 'Spool A', UnitId: 'unit-9', PrintMappingValue: 7, Material: { Type: 'PLA' } }],
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
    import {usePrinterConnectionStore as store} from './src/printers/connectionStore';
    import {ConfirmHost} from './src/components/ModalBackdrop';
    import {SendToPrinterDialog} from './src/printers/SendToPrinterDialog';
    import './src/index.css'; import './src/App.css';
    import './src/mobile/mobile.css'; import './src/mobile/mobileShell.css'; import './src/mobile/mobileControls.css';
    const root=createRoot(document.getElementById('root'));let currentView='device';const bytes=new Uint8Array([71,50,56]);
    function Fixture(){const s=store();const p=s.printers.find(p=>p.id===s.selectedPrinterId);return <><ConfirmHost/>{p && (currentView==='link'
      ? <OctoEverywhereConnection key={p.id} printer={p} onChange={store.getState().savePrinter}/>
      : currentView==='panel' ? <OctoEverywherePanel key={p.id} printer={p} state={s.liveState} active={true}/> : currentView==='send' ? <SendToPrinterDialog getGcode={()=>bytes} defaultFilename="cube.gcode"/> : <DevicePanel active={true}/>)}</>;}
    window.fixture={store, async seed(p,view='device'){store.getState().activeApi?.dispose?.();currentView=view;
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

async function fixture(t, { host = 'moonraker', view = 'device', mode = 'remote', config = { enabled: true, portalAvailable: true }, pending = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); const calls = []; let currentStatus = structuredClone(status);
  t.after(() => context.close());
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<html data-theme="dark"><head><style>${css}body{margin:0;background:var(--bg-base);font-family:var(--font-sans);font-size:13px}#root{height:100vh}.ds-scrim--confirm{position:fixed;inset:0;z-index:9999;background:#0008;display:grid;place-items:center}</style></head><body><div id="root"></div><script>${js}</script></body></html>` });
    assert.equal(url.origin, 'https://fixture.invalid', 'all provider requests intercepted at same origin');
    if (/^\/(fonts|icons)\//.test(url.pathname)) return route.fulfill({ status: 204 });
    calls.push({ path: url.pathname, query: url.search, method: request.method(), body: request.postData() });
    let result = {};
    const envelope = value => ({ Status: 200, Result: value });
    if (url.pathname.endsWith('/config')) result = config;
    else if (url.pathname.endsWith('/portal/start')) result = { portalUrl: 'https://octoeverywhere.com/portal', flowId: 'synthetic-flow', pollToken: 'synthetic-poll-secret' };
    else if (url.pathname.includes('/portal/result/')) result = { status: pending ? 'pending' : 'complete', connection };
    else if (url.pathname.endsWith('/sessions') && request.method() === 'POST') result = { sessionId: 'synthetic-session', sessionToken: 'synthetic-session-secret', expiresAt: Date.now() + 60000 };
    else if (url.pathname.endsWith('/info')) result = { IsOnline: true, PrinterLimits: { MaxUploadFileSizeBytes: 1048576, MaxDownloadFileSizeBytes: 2097152, MaxSingleWebcamStreamLengthSeconds: 1 } };
    else if (url.pathname.endsWith('/status')) result = envelope(currentStatus);
    else if (url.pathname.endsWith('/files/list')) result = envelope({ Root: [{ Type: 'file', Name: 'cube.gcode', VirtualPath: 'gcode/exact/cube.gcode', PlatformPath: '/disk/cube.gcode', SizeBytes: 12 }, { Type: 'file', Name: 'project.3mf', VirtualPath: 'gcode/exact/project.3mf' }] });
    else if (url.pathname.endsWith('/files/upload')) result = envelope({ VirtualPath: 'gcode/returned/upload.gcode', PlatformPath: '/disk/upload.gcode' });
    else if (url.pathname.endsWith('/files/details')) result = envelope({ VirtualPath: 'gcode/exact/cube.gcode', PlatformPath: '/disk/cube.gcode', FileName: 'cube.gcode' });
    else if (url.pathname.endsWith('/files/download')) return route.fulfill({ contentType: 'application/octet-stream', body: 'G28\n' });
    else if (url.pathname.endsWith('/ticket')) result = { url: '/_octoeverywhere/tickets/synthetic', expiresAt: Date.now() + 5000 };
    else if (url.pathname.includes('/tickets/')) return; // Held open to simulate a camera stream; explicit close tears it down.
    else if (url.pathname.endsWith('/live-link')) result = { LiveId: 'synthetic-live', Url: 'https://octoeverywhere.com/live/synthetic', ShortUrl: 'https://oe.link/synthetic' };
    else result = envelope({});
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.goto('https://fixture.invalid/');
  await page.evaluate(() => { window.open = () => ({ opener: null, close() {}, location: { replace() {} } }); navigator.clipboard.writeText = async value => { window.copied = value; }; });
  await page.evaluate(async ({ p, view }) => window.fixture.seed(p, view), { p: printer(host, mode), view });
  await page.waitForSelector(view === 'send' ? '#send-to-printer-dialog' : '.oe-panel');
  return { page, calls, setStatus: async value => { currentStatus = value; await page.evaluate(() => window.fixture.refresh()); } };
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
const disclose = async (page, name) => { const summary = page.locator('summary').filter({ hasText: name }); if (!await summary.evaluate(element => element.parentElement.open)) await summary.click(); };
const confirm = page => page.getByTestId('confirm-ok').click();

test('portal success requires explicit printer binding; transport selection retains local fields and detach confirms', async t => {
  const { page, calls } = await fixture(t, { view: 'link', mode: 'local' });
  await button(page, 'Reconnect OctoEverywhere').focus(); await page.keyboard.press('Enter');
  await page.getByText('Bind authorized printer', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.fixture.store.getState().printers[0].octoeverywhere.mode), 'local');
  await button(page, 'Confirm printer binding').click();
  await page.waitForFunction(() => window.fixture.store.getState().printers[0].octoeverywhere.mode === 'remote');
  await button(page, 'Local').click(); await button(page, 'OctoEverywhere').click();
  assert.equal(await page.evaluate(() => window.fixture.store.getState().printers[0].printhost_apikey), 'synthetic-native-secret');
  assert.equal(await page.getByRole('link', { name: 'Open printer' }).getAttribute('href'), connection.userFacingUrl);
  await button(page, 'Detach').click(); await confirm(page);
  await page.waitForFunction(() => !window.fixture.store.getState().printers[0].octoeverywhere);
  assert.ok(calls.some(call => call.path.endsWith('/portal/start')));
  assert.doesNotMatch(await page.locator('body').innerText(), /synthetic-(app|auth|native|cloud|poll|session)-secret/);
});

test('portal cancel, deleted or edited printer and missing App ID never bind stale credentials', async t => {
  const { page, calls } = await fixture(t, { view: 'link', pending: true });
  await button(page, 'Reconnect OctoEverywhere').click(); await page.getByText('Authorize in the new tab.', { exact: false }).waitFor();
  await button(page, 'Cancel connection').click();
  await page.waitForFunction(() => !document.body.innerText.includes('Authorize in the new tab.'));
  assert.ok(calls.some(call => call.method === 'DELETE' && call.path.includes('/portal/result/')));
  await button(page, 'Reconnect OctoEverywhere').click(); await page.getByText('Authorize in the new tab.', { exact: false }).waitFor();
  await page.evaluate(() => { const s = window.fixture.store.getState(); s.savePrinter({ ...s.printers[0], name: 'Edited printer' }); });
  await page.waitForFunction(() => !document.body.innerText.includes('Authorize in the new tab.'));
  assert.equal(await button(page, 'Confirm printer binding').count(), 0);
  await page.evaluate(() => window.fixture.store.getState().deletePrinter('fixture'));
  assert.equal(await button(page, 'Confirm printer binding').count(), 0);
  const unavailable = await fixture(t, { view: 'link', config: { enabled: true, portalAvailable: false } });
  await unavailable.page.getByText('Connecting requires a production', { exact: false }).waitFor();
  assert.equal(await button(unavailable.page, 'Reconnect OctoEverywhere').isDisabled(), true);
  assert.equal(unavailable.calls.some(call => call.path.endsWith('/portal/start')), false);
  const disabled = await fixture(t, { view: 'link', config: { enabled: false, portalAvailable: false } });
  await disabled.page.getByText('Remote access is disabled', { exact: false }).waitFor();
  assert.equal(await button(disabled.page, 'Reconnect OctoEverywhere').isDisabled(), true);
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
  await setStatus({ ...status, Features: 0 });
  assert.equal(await page.locator('#control-group-home').count(), 0);
});

test('files preserve returned VirtualPath, separate upload/start, confirm delete; extras require explicit calls', async t => {
  const { page, calls } = await fixture(t, { view: 'panel' });
  assert.equal(calls.some(call => /live-link|notifications/.test(call.path)), false);
  await disclose(page, 'Printer files'); await button(page, 'Refresh files').click();
  await page.getByText('gcode/exact/cube.gcode', { exact: false }).first().waitFor();
  await button(page, 'Details').first().click(); await page.getByText('/disk/cube.gcode', { exact: true }).waitFor();
  const download = page.waitForEvent('download'); await button(page, 'Download').first().click();
  assert.equal((await download).suggestedFilename(), 'cube.gcode');
  assert.ok(calls.some(call => call.path.endsWith('/files/download') && call.query.includes('gcode%2Fexact%2Fcube.gcode')));
  await page.locator('input[type=file]').setInputFiles({ name: 'upload.gcode', mimeType: 'application/octet-stream', buffer: Buffer.from('G28') });
  await page.waitForFunction(() => document.querySelector('input[placeholder="gcode/filename.gcode"]')?.value === 'gcode/returned/upload.gcode');
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
  assert.doesNotMatch(await page.locator('body').innerText(), /synthetic-(app|auth|native|cloud|poll|session)-secret/);
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
  const { page, calls } = await fixture(t);
  await disclose(page, 'Cameras'); await button(page, 'Start stream').click();
  await page.locator('.oe-camera img').waitFor();
  assert.match(await page.locator('.oe-camera img').getAttribute('style'), /rotate\(90deg\) scale\(-1, 1\)/);
  await page.locator('.oe-camera img').waitFor({ state: 'detached', timeout: 3000 });
  assert.equal(calls.filter(call => call.path.endsWith('/ticket')).length, 1);
  await button(page, 'Start stream').click(); await page.locator('.oe-camera img').waitFor();
  await page.locator('.oe-camera img').evaluate(img => img.dispatchEvent(new Event('error'))); await page.locator('.oe-camera img').waitFor({ state: 'detached' });
  await button(page, 'Start stream').click(); await page.locator('.oe-camera img').waitFor();
  await page.locator('.oe-camera img').evaluate(img => img.dispatchEvent(new Event('load'))); await page.locator('.oe-camera img').waitFor({ state: 'detached' });
  await button(page, 'Start stream').click(); await page.locator('.oe-camera img').waitFor();
  await page.getByLabel('Camera', { exact: true }).selectOption('1'); await page.locator('.oe-camera img').waitFor({ state: 'detached' });
  await page.getByLabel('Camera', { exact: true }).selectOption('0');
  await button(page, 'Start stream').click(); await page.locator('.oe-camera img').waitFor();
  await page.evaluate(() => window.fixture.unmount()); assert.equal(await page.locator('.oe-camera img[src]').count(), 0);
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
  const { page, calls } = await fixture(t, { host: 'bambu-cloud', view: 'send' });
  const gcodePrinter = await fixture(t, { view: 'send' });
  assert.match(await gcodePrinter.page.locator('#send-to-printer-dialog').innerText(),/Device → Printer files/);
  assert.equal(await page.locator('#send-upload').isDisabled(), false);
  assert.equal(await page.locator('#send-print').count(), 0);
  await page.locator('#send-upload').click(); await page.locator('#send-result[data-ok=true]').waitFor();
  assert.ok(calls.some(call => call.method === 'PUT' && call.path.endsWith('/files/upload')));
  assert.equal(calls.some(call => call.path.endsWith('/start')), false);
  assert.ok(calls.some(call => call.method === 'DELETE' && /\/sessions\/[^/]+$/.test(call.path)), 'temporary upload adapter disposed');
  const sessionCalls = calls.filter(call => call.path.endsWith('/sessions') && call.method === 'POST');
  assert.ok(sessionCalls.every(call => !/synthetic-(native|cloud)-secret/.test(call.body)));
  const unsupported = await fixture(t, { host: 'snapmaker-cloud', view: 'send' });
  assert.equal(await unsupported.page.locator('#send-upload').isDisabled(), true);
});
