import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from '../../build/web-smoke/node_modules/playwright/index.mjs';

// Exercise the actual production panel/CSS with inert printer/session boundaries.
// APP_TEST_SOURCE also runs this same regression against retained shipped sources.
const app = path.resolve(process.env.APP_TEST_SOURCE ?? 'wasm/app');
const output = path.resolve(process.env.APP_TEST_OUTPUT ?? 'wasm/build/tests-device-refresh-resize/ui/fix/screenshots');
await mkdir(output, { recursive: true });
const boundary = `
import {create} from 'zustand';
import en from '${app}/src/locales/en.json';
import es from '${app}/src/locales/es.json';
import {HOST_CAPABILITIES} from '${app}/src/printers/types';
export const useHarness=create(()=>({active:true,language:'en'}));
export const reading={state:'printing',file:'saved-part.gcode',progress:0.42,elapsed:120,remaining:180,layer:{current:4,total:10},fans:[],
  heaters:[0,1,2,3].map(i=>({id:'extruder'+i,kind:'extruder',label:'Tool '+i,toolIndex:i,current:201+i,target:211+i})).concat([{id:'bed',kind:'bed',label:'Bed',current:40,target:60}]),
  filamentSlots:[0,1,2,3].map(i=>({id:'tool-'+i,label:'T'+i,slotIndex:i,presence:'present',material:'PLA',vendor:'Generic',color:['#808080','#0000FF','#000000','#FFFFFF'][i]}))};
const printer={id:'synthetic',name:'U1',host_type:'snapmaker-cloud',print_host:'http://device.test',printhost_apikey:''};
export const usePrinterConnectionStore=create(()=>({printers:[printer],selectedPrinterId:printer.id,status:'error',error:'Synthetic monitoring error',
  liveState:null,cachedState:reading,lastRefreshedAt:Date.now()-70000,monitoringPaused:false,
  selectPrinter:()=>{},openDialog:()=>{},savePrinter:()=>{},setDeviceTabActive:()=>{}}));
export const useTranslation=()=>{const {language}=useHarness();const dict=language==='es'?es:en;return {language,t:(key,values)=>
  (dict[key]||en[key]||key).replace(/\\{\\{(\\w+)\\}\\}/g,(m,k)=>values?.[k]??m)}};
export const confirmDialog=()=>{throw Error('Printer action forbidden')};
export const getCurrentPrinterApi=()=>{throw Error('Printer action forbidden')};
export const reconnectPrinterSession=()=>{window.retryCount=(window.retryCount||0)+1};
export const parseHost=()=>({scheme:'http',hostPort:'device.test',basePath:''});
export const localGatewayBase=()=>undefined;
export const createUiSession=()=>{throw Error('Gateway session forbidden')};
export class OctoEverywhereApi {}
export const getEffectivePrinterCapabilities=p=>HOST_CAPABILITIES[p.host_type];
export const safeOctoEverywhereUserUrl=()=>undefined;
export const OctoEverywhereConnection=()=>null;
export const OctoEverywherePanel=()=>null;
`;
const bundled = await build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import './src/index.css'; import './src/App.css'; import './src/mobile/mobile.css';
  import {DevicePanel} from './src/printers/DevicePanel'; import * as fixture from 'fixture';
  window.fixture=fixture;
  const App=()=>{const {active}=fixture.useHarness();return <DevicePanel active={active}/>};
  const root=createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();root.render(<App/>);
`, loader: 'tsx', resolveDir: app }, bundle: true, write: false, outdir: 'fixture', format: 'iife', platform: 'browser',
  plugins: [{ name: 'inert-printer-boundary', setup(builder) {
    builder.onResolve({ filter: /^fixture$|\/(connectionStore|i18n|ModalBackdrop|session|gatewayUrl|octoEverywhere|OctoEverywhereConnection|OctoEverywherePanel)$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: boundary, resolveDir: app }));
  } }] });
const js = bundled.outputFiles.find(f => f.path.endsWith('.js')).text;
const css = bundled.outputFiles.find(f => f.path.endsWith('.css')).text;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--renderer-process-limit=2'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // No service, real hardware, account, or external network requests.
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' }));
  await page.clock.install({ time: new Date('2026-11-05T12:00:00Z') });
  const load = async () => {
    await page.goto('http://fixture.test');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    await page.locator('#device-splitter').waitFor();
  };
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const set = state => page.evaluate(state => window.fixture.usePrinterConnectionStore.setState(state), state);
  const cards = page.locator('.device-extruder-card');
  const freshness = page.locator('#device-freshness');
  await load();
  const receiveTime = await page.evaluate(() => window.fixture.usePrinterConnectionStore.getState().lastRefreshedAt);
  assert.equal(await cards.count(), 4);
  for (let i = 0; i < 4; i++) {
    assert.equal(await cards.nth(i).getAttribute('data-tool'), String(i));
    assert.deepEqual(await cards.nth(i).locator('dd').allTextContents(), [`${201+i}.0 °C`, `${211+i} °C`]);
    assert.match(await cards.nth(i).innerText(), /PLA/);
  }
  assert.match(await freshness.innerText(), /Saved readings.*Last refreshed 1 minute ago/s);
  assert.match(await page.locator('#device-job').innerText(), /saved-part.gcode.*42.0%/s);
  assert.match(await page.locator('#device-temps').innerText(), /40.0 \/ 60/);
  assert.equal(await page.locator('time').getAttribute('datetime'), new Date(receiveTime).toISOString());
  assert.ok(await page.locator('time').getAttribute('title'));
  assert.equal(await page.locator('time').evaluate(n => !!n.closest('[aria-live]')), false);
  await page.locator('#device-reconnect').click();
  assert.equal(await page.evaluate(() => window.retryCount), 1);
  assert.equal(await page.evaluate(() => window.fixture.usePrinterConnectionStore.getState().lastRefreshedAt), receiveTime);

  await set({ monitoringPaused: true, status: 'none' });
  await page.evaluate(() => { window.fixture.useHarness.setState({ active: false }); window.dispatchEvent(new Event('blur')); });
  await settle();
  const pausedAge = await freshness.innerText();
  await page.clock.runFor(125000);
  assert.equal(await freshness.innerText(), pausedAge, 'paused age timer stops');
  assert.equal(await cards.count(), 4);
  assert.equal(await page.locator('#device-splitter').count(), 0);
  await page.evaluate(() => { window.fixture.useHarness.setState({ active: true }); window.dispatchEvent(new Event('focus')); });
  await set({ monitoringPaused: false, status: 'connecting' });
  await settle();
  assert.match(await freshness.innerText(), /3 minutes ago/);
  assert.equal(await page.locator('#device-connection-status').innerText(), 'Refreshing…');
  await page.clock.runFor(3600000);
  assert.match(await freshness.innerText(), /1 hour ago/);
  assert.equal(await page.evaluate(() => window.fixture.usePrinterConnectionStore.getState().lastRefreshedAt), receiveTime);
  console.log('PASS cached four physical cards/job/heaters; pause/return/hour age; Retry never advances receive time');

  // Live readings take priority; cache alone must not grant controls, even with online status.
  await page.evaluate(() => {
    const s=window.fixture.usePrinterConnectionStore;
    s.setState({printers:s.getState().printers.map(p=>({...p,host_type:'octoprint'})),status:'online',liveState:null});
  });
  await page.locator('#device-controls').waitFor();
  assert.equal(await page.locator('#device-controls button:not(.btn-step):not(:disabled)').count(), 0);
  assert.equal(await page.locator('#control-pause').isDisabled(), true, 'saved printing state never enables live job controls');
  await page.evaluate(() => window.fixture.usePrinterConnectionStore.setState({liveState:{...window.fixture.reading,state:'ready',heaters:[]},lastRefreshedAt:Date.now(),status:'online'}));
  await settle();
  assert.doesNotMatch(await freshness.innerText(), /Saved readings/);
  assert.match(await freshness.innerText(), /0 seconds ago/);
  assert.ok(await page.locator('#device-controls button:not(.btn-step):not(:disabled)').count() > 0);
  await set({ liveState: null, status: 'error' });
  await settle();
  assert.equal(await page.locator('#device-controls button:not(.btn-step):not(:disabled)').count(), 0);
  console.log('PASS live-only command state and eligibility; fresh readings have receive age');

  const splitter = page.locator('#device-splitter');
  await splitter.focus();
  await page.keyboard.press('Home');
  assert.equal(await splitter.getAttribute('aria-valuenow'), '280');
  await page.keyboard.press('ArrowRight');
  assert.equal(await splitter.getAttribute('aria-valuenow'), '290');
  await page.keyboard.press('End');
  assert.equal(await splitter.getAttribute('aria-valuenow'), await splitter.getAttribute('aria-valuemax'));
  assert.ok(await page.locator('.device-ui-side').evaluate(n => n.getBoundingClientRect().width >= 279));
  await page.keyboard.press('Home');
  const handle = await splitter.boundingBox();
  await page.mouse.move(handle.x + 4, handle.y + 150);
  await page.mouse.down();
  await page.mouse.move(handle.x + 204, handle.y + 150);
  assert.equal(await page.locator('#device-webui-frame').evaluate(n => getComputedStyle(n).pointerEvents), 'none');
  await page.mouse.move(1000, handle.y + 150);
  await page.mouse.up();
  assert.equal(await page.locator('.device-resizing').count(), 0);
  assert.equal(await page.locator('#device-webui-frame').evaluate(n => getComputedStyle(n).pointerEvents), 'auto');
  await splitter.focus(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+ArrowRight');
  const chosen = await splitter.getAttribute('aria-valuenow');
  assert.equal(chosen, '330');
  await page.locator('#device-webui-toggle').click();
  assert.equal(await splitter.count(), 0);
  assert.equal(await page.locator('#device-webui-frame').isVisible(), false);
  assert.ok(await page.locator('#device-status').evaluate(n => n.getBoundingClientRect().width > 1200));
  await page.locator('#device-webui-toggle').click();
  assert.equal(await splitter.getAttribute('aria-valuenow'), chosen);
  await load();
  assert.equal(await splitter.getAttribute('aria-valuenow'), chosen, 'width survives reload');
  await page.setViewportSize({ width: 820, height: 900 });
  await settle();
  assert.ok(Number(await splitter.getAttribute('aria-valuenow')) <= Number(await splitter.getAttribute('aria-valuemax')));
  await page.setViewportSize({ width: 1280, height: 900 });
  await settle();
  await page.locator('#device-panel').evaluate(n => n.style.width='550px');
  await settle();
  assert.equal(await splitter.count(), 0, 'actual narrow container stacks even in a desktop window');
  await page.locator('#device-panel').evaluate(n => n.style.width='');
  await settle();

  // A lost capture, pointer cancellation, collapse, inactivity, and unmount all release the shield.
  const startDrag = async () => {
    const box = await splitter.boundingBox();
    await page.mouse.move(box.x + 4, box.y + 100); await page.mouse.down();
    assert.equal(await page.locator('.device-drag-shield').count(), 1);
  };
  for (const event of ['pointercancel', 'lostpointercapture']) {
    await startDrag();
    await splitter.dispatchEvent(event);
    await page.mouse.up();
    await settle();
    assert.equal(await page.locator('.device-drag-shield').count(), 0);
  }
  await startDrag();
  await page.evaluate(() => window.fixture.useHarness.setState({ active: false }));
  await page.mouse.up();
  await settle();
  assert.equal(await page.locator('.device-drag-shield').count(), 0);
  await page.evaluate(() => window.fixture.useHarness.setState({ active: true }));
  await settle();
  await startDrag();
  await page.evaluate(() => document.querySelector('#device-webui-toggle').click());
  await page.mouse.up();
  await settle();
  assert.equal(await page.locator('.device-drag-shield').count(), 0);
  await page.locator('#device-webui-toggle').click();
  await startDrag();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.mouse.up();
  await settle();
  assert.equal(await page.locator('.device-drag-shield').count(), 0);
  console.log('PASS pointer capture/iframe release, keyboard bounds, collapse/full width, restore/reload, resize clamp, activity release');

  // Actual catalogs and production styles at narrow sizes, larger text, and both themes.
  for (const language of ['en', 'es']) for (const theme of ['light', 'dark']) for (const width of [1280, 390, 320]) for (const scale of [1, 1.25]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(({ language, theme, scale }) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.setProperty('--ui-font-scale', scale);
      window.fixture.useHarness.setState({ language });
      const s=window.fixture.usePrinterConnectionStore;
      s.setState({printers:s.getState().printers.map(p=>({...p,host_type:'snapmaker-cloud'})),cachedState:window.fixture.reading,liveState:null,status:'error',monitoringPaused:false});
    }, { language, theme, scale });
    await settle();
    assert.equal(await cards.count(), 4);
    const fit = await page.evaluate(() => {
      const panel=document.querySelector('#device-panel'), header=document.querySelector('.device-header'), status=document.querySelector('#device-status');
      const time=document.querySelector('time'), body=document.querySelector('#device-body');
      return { overflow:document.documentElement.scrollWidth>innerWidth||panel.scrollWidth>panel.clientWidth||header.scrollWidth>header.clientWidth||status.scrollWidth>status.clientWidth,
        timeVisible:time.getBoundingClientRect().right<=innerWidth, stacked:document.querySelector('.device-ui-side').getBoundingClientRect().top>=status.getBoundingClientRect().bottom-1,
        bodyOverflow:body.scrollWidth>body.clientWidth };
    });
    assert.equal(fit.overflow || fit.bodyOverflow, false, JSON.stringify({ language, theme, width, scale, fit }));
    assert.ok(fit.timeVisible);
    assert.equal(await splitter.count(), width > 800 ? 1 : 0);
    if (width <= 800) assert.ok(fit.stacked);
    assert.match(await freshness.innerText(), language==='es' ? /Lecturas guardadas.*Última actualización:/s : /Saved readings.*Last refreshed/s);
    await page.screenshot({ path: path.join(output, `${language}-${theme}-${width}-${scale}.png`), animations: 'disabled' });
    if (width === 390 && scale === 1.25) {
      await cards.nth(3).scrollIntoViewIfNeeded();
      assert.ok(await cards.nth(3).locator('dd').last().isVisible());
      await page.screenshot({ path: path.join(output, `${language}-${theme}-${width}-${scale}-fourth.png`), animations: 'disabled' });
      await page.locator('#device-body').evaluate(n=>n.scrollTop=0);
    }
    console.log('PASS layout', language, theme, width, scale);
  }
  await set({ cachedState: null, liveState: null, lastRefreshedAt: null, status: 'connecting' });
  assert.equal(await page.locator('time').count(), 0);
  assert.match(await page.locator('#device-state').innerText(), /Aún no hay lecturas guardadas/);
  console.log('PASS localized empty state without invented timestamp');

  await page.setViewportSize({ width: 1280, height: 900 });
  await settle();
  await startDrag();
  await page.evaluate(() => window.unmount());
  await page.mouse.up();
  assert.equal(await page.locator('.device-drag-shield').count(), 0);
  await page.evaluate(() => { localStorage.setItem('orca.device.layout.statusWidth','not-a-number'); });
  await load();
  assert.equal(await splitter.getAttribute('aria-valuenow'), '340');
  await page.evaluate(() => { localStorage.setItem('orca.device.layout.statusWidth','99999999'); });
  await load();
  assert.equal(await splitter.getAttribute('aria-valuenow'), await splitter.getAttribute('aria-valuemax'));
  await page.setViewportSize({ width: 820, height: 900 });
  await settle();
  assert.equal(await splitter.getAttribute('aria-valuenow'), await splitter.getAttribute('aria-valuemax'), 'restored width clamps again when the window shrinks');
  await page.setViewportSize({ width: 1280, height: 900 });
  await settle();
  await page.addInitScript(() => {
    Storage.prototype.getItem=()=>{throw new DOMException('blocked','SecurityError')};
    Storage.prototype.setItem=()=>{throw new DOMException('quota','QuotaExceededError')};
  });
  await load();
  await splitter.focus(); await page.keyboard.press('ArrowRight');
  await page.locator('#device-webui-toggle').click();
  assert.equal(await splitter.count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS corrupt/oversized/blocked/quota storage and unmount cleanup; zero browser errors');
} finally { await browser.close(); }
