import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

test('session pauses, restores a safe snapshot and reconnects once on browser return', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
  const events = new EventTarget();
  let focused = true;
  globalThis.document = { hidden: false, hasFocus: () => focused, addEventListener: events.addEventListener.bind(events) };
  globalThis.window = { localStorage, addEventListener: events.addEventListener.bind(events) };
  const timers = new Map(); let timerId = 0;
  globalThis.setTimeout = (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; };
  globalThis.clearTimeout = id => timers.delete(id);
  const connections = [];
  let disposals = 0;
  globalThis.__sessionFixture = { create: () => ({ connect(state, error, options) {
    const c = { state, error, options, stopped: false }; connections.push(c);
    return () => { c.stopped = true; };
  }, dispose() { disposals++; } }) };
  const bundled = await build({ stdin: { contents: "export * from './src/printers/session'; export {usePrinterConnectionStore} from './src/printers/connectionStore';", resolveDir: new URL('../../app', import.meta.url).pathname }, bundle:true, platform:'node', format:'esm', write:false,
    plugins:[{ name:'api-fixture', setup(b) { b.onResolve({filter:/^\.\/api$/}, () => ({path:'api',namespace:'fixture'})); b.onLoad({filter:/.*/,namespace:'fixture'}, () => ({contents:'export const createPrinterApi=()=>globalThis.__sessionFixture.create();'})); } }] });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`;
  const {startPrinterSession, reconnectPrinterSession, usePrinterConnectionStore: store} = await import(moduleUrl);
  const p = {id:'p',name:'P',host_type:'snapmaker-cloud',print_host:'id.snapmaker.com',cloud_account:'a',cloud_device_id:'D',printhost_apikey:'secret',use_gateway:true};
  store.setState({printers:[p],selectedPrinterId:p.id,deviceTabActive:true});
  startPrinterSession(); startPrinterSession();
  assert.equal(connections.length,1);
  assert.equal(connections[0].options.pollIntervalMs,15000);
  const reading = {state:'printing',heaters:[{id:'bed',label:'Bed',kind:'bed',current:45,target:60}],fans:[],progress:0.5,file:'job.gcode',filamentSlots:[{id:'tool-0',label:'Extruder 1',material:'PLA',presence:'present',vendor:'Bambu Lab',subtype:'Silk'}],webcams:[{name:'cam',url:'https://secret.invalid/?token=secret'}],files:[{name:'https://secret.invalid/?token=secret'}]};
  connections[0].state(reading);
  // Entering a child iframe blurs the parent window without unfocusing the document.
  events.dispatchEvent(new Event('blur'));
  assert.equal(store.getState().monitoringPaused,false,'embedded web UI focus keeps monitoring active');
  assert.equal(store.getState().liveState,reading);
  assert.equal(connections[0].stopped,false);
  store.getState().setDeviceTabActive(false);
  document.hidden = true; focused = false; events.dispatchEvent(new Event('blur')); events.dispatchEvent(new Event('visibilitychange'));
  // A terminal callback already queued by the old transport must never replace the good snapshot.
  connections[0].state({state:'unknown',heaters:[],fans:[]}); connections[0].error(new Error('Snapmaker upstream error'));
  assert.equal(store.getState().liveState,null,'paused/error data must never remain live');
  assert.equal(store.getState().cachedState?.heaters[0].current,45,'last successful display survives inactivity and terminal stale callbacks');
  assert.equal(connections[0].stopped,true);
  assert.equal(disposals,0,'activity pause must not dispose command operations');
  assert.equal(timers.size,0);
  assert.equal(store.getState().monitoringPaused,true);
  document.hidden = false; focused = true; store.getState().setDeviceTabActive(true);
  events.dispatchEvent(new Event('focus')); events.dispatchEvent(new Event('visibilitychange')); events.dispatchEvent(new Event('pageshow'));
  assert.equal(connections.length,1,'recent return waits for the shared interval');
  assert.deepEqual([...timers.values()].map(t => t.delay),[15000]);
  now += 15000;
  const resume = [...timers.values()][0]; timers.clear(); resume.fn();
  assert.equal(connections.length,2,'active interval expiry reconnects once');
  assert.equal(store.getState().liveState,null);
  connections[1].state(reading);
  const timestamp = store.getState().lastRefreshedAt;
  assert.ok(timestamp > 0);
  const cache = [...storage.entries()].find(([k]) => k !== 'orca-printers');
  assert.ok(cache,'display cache is durable');
  assert.ok(!cache[1].includes('secret'));
  assert.equal(store.getState().cachedState.webcams,undefined);
  assert.equal(store.getState().cachedState.files,undefined);
  assert.equal(store.getState().cachedState.filamentSlots[0].vendor,'Bambu Lab');
  assert.equal(store.getState().cachedState.filamentSlots[0].subtype,'Silk');
  connections[1].error(new Error('Snapmaker upstream error'));
  assert.equal(store.getState().liveState,null);
  assert.equal(store.getState().cachedState.heaters[0].current,45);
  assert.equal(store.getState().lastRefreshedAt,timestamp);
  assert.deepEqual([...timers.values()].map(t => t.delay),[15000]);
  const retry = [...timers.values()][0]; timers.clear(); retry.fn();
  assert.equal(connections.length,3);
  reconnectPrinterSession(); assert.equal(connections.length,3);
  connections[2].state(reading);
  store.getState().setDeviceTabActive(false);
  store.getState().setDeviceTabActive(true);
  assert.equal(store.getState().cachedState.heaters[0].current,45);
  store.getState().savePrinter({...p,printhost_apikey:'rotated'});
  assert.equal(store.getState().cachedState.heaters[0].current,45,'same account token rotation preserves cache');
  store.getState().savePrinter({...p,cloud_device_id:'other'});
  assert.equal(store.getState().cachedState,null,'device scope change invalidates cache');
  const latest = () => connections.at(-1);
  latest().state(reading);
  const count = connections.length;
  document.hidden = true; events.dispatchEvent(new Event('visibilitychange'));
  assert.equal(latest().stopped,true,'document hiding alone stops monitoring');
  assert.equal(timers.size,0);
  document.hidden = false; events.dispatchEvent(new Event('visibilitychange'));
  assert.equal(connections.length,count,'recent visible return defers network');
  now += 15000;
  const visibleResume = [...timers.values()][0]; timers.clear(); visibleResume.fn();
  assert.equal(connections.length,count+1);
  latest().state(reading);
  focused = false; events.dispatchEvent(new Event('blur'));
  assert.equal(latest().stopped,true,'blur alone stops monitoring');
  assert.equal(timers.size,0);
  focused = true; events.dispatchEvent(new Event('focus'));
  now += 15000;
  const focusResume = [...timers.values()][0]; timers.clear(); focusResume.fn();
  latest().state(reading);
  store.getState().selectPrinter('absent');
  assert.equal(store.getState().cachedState,null);
  store.getState().selectPrinter(p.id);
  assert.equal(store.getState().cachedState.heaters[0].current,45,'selection restores durable display');
  latest().state(reading);
  store.getState().rejectSnapmakerSession({...p,cloud_device_id:'other'});
  assert.equal(store.getState().cachedState,null,'sign-out clears cached display');
  assert.ok(![...storage.entries()].find(([k]) => k !== 'orca-printers')[1].includes('job.gcode'));
  assert.equal(timers.size,0,'signed-out failures do not busy retry');
  store.getState().savePrinter(p);
  latest().state(reading);
  store.getState().setDeviceTabActive(false);
  const reloaded = await import(`${moduleUrl}#reload`);
  reloaded.startPrinterSession();
  assert.equal(reloaded.usePrinterConnectionStore.getState().cachedState.heaters[0].current,45,'reload restores durable identity-scoped display');
  assert.equal(reloaded.usePrinterConnectionStore.getState().liveState,null,'reload never makes cached data live');
  store.getState().setDeviceTabActive(true);
  store.getState().deletePrinter(p.id);
  assert.equal(store.getState().cachedState,null);
  assert.equal(timers.size,0);
  const key = cache[0];
  storage.set(key,'{broken');
  store.getState().savePrinter(p);
  assert.equal(store.getState().cachedState,null,'corrupt storage is ignored');
  localStorage.setItem = () => { throw new Error('quota'); };
  latest().state(reading);
  assert.equal(store.getState().cachedState.heaters[0].current,45,'unavailable storage keeps an in-memory display');
  store.getState().setDeviceTabActive(false);
});

test('refresh age, activity and generation gate deferred returns without restarting healthy monitors', async t => {
  const bundled = await build({ stdin: { contents: "export * from './src/printers/session'; export {usePrinterConnectionStore} from './src/printers/connectionStore'; export const ageFixture=true;", resolveDir: new URL('../../app', import.meta.url).pathname }, bundle:true, platform:'node', format:'esm', write:false,
    plugins:[{ name:'api-fixture', setup(b) { b.onResolve({filter:/^\.\/api$/}, () => ({path:'api',namespace:'fixture'})); b.onLoad({filter:/.*/,namespace:'fixture'}, () => ({contents:'export const createPrinterApi=p=>globalThis.__sessionFixture.create(p);'})); } }] });
  const storage = new Map(), timers = new Map(), events = new EventTarget(), connections = [];
  let now = 1000, focused = true, timerId = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.property(globalThis, 'localStorage', { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) });
  t.mock.property(globalThis, 'document', { hidden: false, hasFocus: () => focused, addEventListener: events.addEventListener.bind(events) });
  t.mock.property(globalThis, 'window', { addEventListener: events.addEventListener.bind(events) });
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => { timers.set(++timerId, {fn, delay}); return timerId; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  t.mock.property(globalThis, '__sessionFixture', {create: printer => ({connect(state, error, options) {
    const c = {printer, state, error, options, stopped:false}; connections.push(c);
    return () => { c.stopped = true; };
  }})});
  const {startPrinterSession, reconnectPrinterSession, usePrinterConnectionStore:store} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  const p = {id:'age',name:'Age',host_type:'octoprint',print_host:'fixture.invalid'};
  store.setState({printers:[p,{...p,id:'other'}],selectedPrinterId:p.id,deviceTabActive:true});
  startPrinterSession();
  t.after(() => store.getState().setDeviceTabActive(false));
  const reading = {state:'ready',heaters:[],fans:[]};
  connections[0].state(reading);
  assert.equal(timers.size,0,'healthy push monitor has no periodic restart timer');
  now += 30000; events.dispatchEvent(new Event('focus'));
  assert.equal(connections.length,1,'healthy monitor survives multiple intervals');
  connections[0].state(reading);
  focused = false; events.dispatchEvent(new Event('blur'));
  now += 5000;
  focused = true; events.dispatchEvent(new Event('focus')); events.dispatchEvent(new Event('pageshow'));
  assert.equal(connections.length,1);
  assert.deepEqual([...timers.values()].map(t => t.delay),[10000],'recent return waits only the remaining configured interval');
  const obsolete = [...timers.values()][0];
  store.getState().setDeviceTabActive(false);
  assert.equal(timers.size,0);
  now += 15000; obsolete.fn(); events.dispatchEvent(new Event('focus'));
  assert.equal(connections.length,1,'non-Device return and cancelled expiry cannot read');
  store.getState().setDeviceTabActive(true);
  assert.equal(connections.length,2,'stale return starts immediately');
  connections[1].state(reading);
  document.hidden = true; events.dispatchEvent(new Event('visibilitychange'));
  now += 1000;
  document.hidden = false; events.dispatchEvent(new Event('visibilitychange'));
  const inactiveExpiry = [...timers.entries()][0];
  focused = false; // A timer must also check activity when a browser event is omitted.
  now += 14000; timers.delete(inactiveExpiry[0]); inactiveExpiry[1].fn();
  assert.equal(connections.length,2,'expiry while unfocused cannot read');
  focused = true; events.dispatchEvent(new Event('focus'));
  assert.equal(connections.length,3);
  connections[2].state(reading);
  connections[2].error(new Error('retry fixture'));
  reconnectPrinterSession(); reconnectPrinterSession();
  assert.equal(connections.length,4,'manual Retry bypasses recent successful age exactly once');
  connections[3].state(reading);
  document.hidden = true; events.dispatchEvent(new Event('visibilitychange'));
  now += 1000;
  document.hidden = false; events.dispatchEvent(new Event('visibilitychange'));
  const oldSelection = [...timers.values()][0];
  store.getState().selectPrinter('other');
  assert.equal(connections.length,5,'selected printer without data loads immediately');
  assert.equal(connections[4].printer.id,'other');
  oldSelection.fn();
  connections[3].state({...reading,state:'printing'}); connections[3].error(new Error('obsolete'));
  assert.equal(connections.length,5,'old selection expiry cannot duplicate monitoring');
  assert.equal(store.getState().cachedState,null,'old generation cannot populate selected cache');
  connections[4].state(reading);
  focused = false; events.dispatchEvent(new Event('blur'));
  now += 1000; focused = true; events.dispatchEvent(new Event('focus'));
  const hiddenExpiry = [...timers.entries()][0];
  document.hidden = true; now += 14000;
  timers.delete(hiddenExpiry[0]); hiddenExpiry[1].fn();
  assert.equal(connections.length,5,'expiry while hidden cannot read');
  document.hidden = false; events.dispatchEvent(new Event('visibilitychange'));
  assert.equal(connections.length,6);
});

test('Bambu cloud recovery preserves cached telemetry until a print status report arrives', async t => {
  const app = new URL('../../app/', import.meta.url).pathname;
  const bundled = await build({
    stdin: { contents: "export * from './src/printers/session'; export {usePrinterConnectionStore} from './src/printers/connectionStore';", resolveDir: app },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'bambu-factory', setup(b) {
      b.onResolve({ filter: /^\.\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: "import {BambuCloudApi} from './bambuCloud'; export const createPrinterApi=p=>new BambuCloudApi(p);",
        resolveDir: `${app}src/printers`
      }));
    } }]
  });
  const storage = new Map(), timers = new Map(), sockets = [];
  let timerId = 0, now = 1000;
  t.mock.property(globalThis, 'localStorage', { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) });
  t.mock.property(globalThis, 'window', { location: { origin: 'https://fixture.invalid' }, addEventListener() {} });
  t.mock.property(globalThis, 'document', { hidden: false, hasFocus: () => true, addEventListener() {} });
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  t.mock.method(Date, 'now', () => now);
  t.mock.property(globalThis, 'WebSocket', class {
    constructor() { sockets.push(this); }
    send() {}
    close() { this.onclose?.(); }
    receive(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  });
  const { startPrinterSession, usePrinterConnectionStore: store } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  store.setState({ printers: [{ id: 'bambu', name: 'Bambu', host_type: 'bambu-cloud', print_host: 'fixture.invalid',
    use_gateway: true, printhost_user: 'u_fixture', printhost_apikey: 'fixture-token', serial: 'fixture-serial' }],
    selectedPrinterId: 'bambu', deviceTabActive: true });
  startPrinterSession();
  t.after(() => store.getState().setDeviceTabActive(false));
  sockets[0].receive({ type: 'connected' });
  sockets[0].receive({ type: 'report', payload: { print: { gcode_state: 'RUNNING', nozzle_temper: 205, mc_percent: 50 } } });
  store.getState().setDeviceTabActive(false);
  store.getState().setDeviceTabActive(true);
  now += 15000;
  const resume = [...timers.entries()][0]; timers.delete(resume[0]); resume[1].fn();
  assert.equal(sockets.length, 2);
  now = 2000;
  sockets[1].receive({ type: 'connected' });
  for (const payload of [{ info: { command: 'get_version', module: [] } }, { print: { command: 'pushall' } }, { print: [] }]) {
    sockets[1].receive({ type: 'report', payload });
    assert.equal(store.getState().cachedState.heaters[0]?.current, 205, 'non-telemetry cannot replace the last successful display');
    assert.equal(store.getState().lastRefreshedAt, 1000);
    assert.equal(store.getState().liveState, null);
    assert.equal(store.getState().status, 'connecting');
    assert.deepEqual([...timers.values()].map(timer => timer.delay), [35000], 'keep the initial telemetry deadline');
    assert.equal(JSON.parse(storage.get('orca-printer-display-v1')).bambu.state.heaters[0].current, 205);
  }
  const deadline = [...timers.entries()][0];
  timers.delete(deadline[0]); deadline[1].fn();
  assert.equal(store.getState().status, 'error');
  assert.equal(store.getState().cachedState.heaters[0].current, 205);
  assert.deepEqual([...timers.values()].map(timer => timer.delay), [15000]);
  const retry = [...timers.entries()][0];
  timers.delete(retry[0]); retry[1].fn();
  sockets[2].receive({ type: 'connected' });
  sockets[2].receive({ type: 'report', payload: { print: { gcode_state: 'NEW_STATUS' } } });
  assert.equal(store.getState().liveState.state, 'unknown', 'genuine unknown run states remain valid telemetry');
  assert.equal(store.getState().lastRefreshedAt, 2000);
  assert.equal(timers.size, 0);
});

test('iframe focus loss and return reconcile without a second parent focus event', async t => {
  const bundled = await build({ stdin: { contents: "export * from './src/printers/session'; export {usePrinterConnectionStore} from './src/printers/connectionStore'; export const frameWatchFixture=true;", resolveDir: new URL('../../app', import.meta.url).pathname }, bundle:true, platform:'node', format:'esm', write:false,
    plugins:[{ name:'api-fixture', setup(b) { b.onResolve({filter:/^\.\/api$/}, () => ({path:'api',namespace:'fixture'})); b.onLoad({filter:/.*/,namespace:'fixture'}, () => ({contents:'export const createPrinterApi=()=>globalThis.__sessionFixture.create();'})); } }] });
  const storage = new Map(), timers = new Map(), events = new EventTarget();
  let focused = true, timerId = 0, starts = 0, stops = 0, now = 1000;
  t.mock.method(Date, 'now', () => now);
  t.mock.property(globalThis, 'localStorage', { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) });
  t.mock.property(globalThis, 'document', { hidden: false, hasFocus: () => focused, activeElement: {tagName:'BUTTON'}, addEventListener: events.addEventListener.bind(events) });
  t.mock.property(globalThis, 'window', { addEventListener: events.addEventListener.bind(events) });
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => { timers.set(++timerId, {fn, delay}); return timerId; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  t.mock.property(globalThis, '__sessionFixture', {create: () => ({connect(onState) {
    starts++;
    onState({state:'ready',heaters:[],fans:[]});
    return () => { stops++; };
  }})});
  const {startPrinterSession, usePrinterConnectionStore:store} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  store.setState({printers:[{id:'frame',name:'Frame',host_type:'octoprint',print_host:'fixture.invalid'}],selectedPrinterId:'frame',deviceTabActive:true});
  startPrinterSession(); startPrinterSession();
  t.after(() => store.getState().setDeviceTabActive(false));
  assert.equal(starts,1);
  document.activeElement = {tagName:'IFRAME'};
  events.dispatchEvent(new Event('blur'));
  assert.equal(store.getState().monitoringPaused,false);
  const checkFocus = () => {
    const check = [...timers.entries()].find(([,timer]) => timer.delay === 100);
    assert.ok(check,'one lightweight iframe focus check must exist');
    timers.delete(check[0]); check[1].fn();
  };
  focused = false; // The parent receives no further blur while its iframe owns focus.
  checkFocus();
  assert.equal(store.getState().monitoringPaused,true);
  assert.equal(store.getState().liveState,null);
  assert.equal(stops,1);
  assert.equal(timers.size,1,'only the focus check remains; no monitor/retry timer');
  focused = true; // Returning to the iframe can also omit the parent focus event.
  checkFocus();
  checkFocus();
  assert.equal(starts,1,'recent iframe return defers network');
  const resume = [...timers.entries()].find(([,timer]) => timer.delay === 15000);
  assert.ok(resume);
  now += 15000;
  timers.delete(resume[0]); resume[1].fn();
  assert.equal(starts,2,'exactly one connection is restored');
  assert.equal(stops,1);
  assert.equal(store.getState().status,'online');
  document.activeElement = {tagName:'BUTTON'};
  events.dispatchEvent(new Event('focus'));
  assert.equal(timers.size,0,'leaving the iframe removes its focus check');
  document.activeElement = {tagName:'IFRAME'};
  events.dispatchEvent(new Event('blur'));
  store.getState().setDeviceTabActive(false);
  assert.equal(timers.size,0,'leaving Device removes the focus check');
});

test('remote reload connects before focus and cached age without native cloud credentials', async t => {
  const bundled = await build({ stdin: { contents: "export * from './src/printers/session'; export {usePrinterConnectionStore} from './src/printers/connectionStore'; export {saveDisplay} from './src/printers/stateCache'; export const reloadFixture=true;", resolveDir: new URL('../../app', import.meta.url).pathname }, bundle:true, platform:'node', format:'esm', write:false,
    plugins:[{ name:'api-fixture', setup(b) { b.onResolve({filter:/^\.\/api$/}, () => ({path:'api',namespace:'fixture'})); b.onLoad({filter:/.*/,namespace:'fixture'}, () => ({contents:'export const createPrinterApi=()=>globalThis.__sessionFixture.create();'})); } }] });
  const storage = new Map(), timers = new Map(), events = new EventTarget();
  let focused = false, timerId = 0, starts = 0, stops = 0;
  t.mock.method(Date, 'now', () => 10000);
  t.mock.property(globalThis, 'localStorage', { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) });
  t.mock.property(globalThis, 'document', { hidden:false, hasFocus:() => focused, addEventListener:events.addEventListener.bind(events) });
  t.mock.property(globalThis, 'window', { addEventListener:events.addEventListener.bind(events) });
  t.mock.method(globalThis, 'setTimeout', (fn,delay) => { timers.set(++timerId,{fn,delay}); return timerId; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  t.mock.property(globalThis, '__sessionFixture', {create:() => ({connect(onState) {
    starts++; onState({state:'ready',heaters:[],fans:[]}); return () => { stops++; };
  }})});
  const {startPrinterSession, saveDisplay, usePrinterConnectionStore:store} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  const printer = {id:'reload',name:'Reload',host_type:'octoprint',print_host:'fixture.invalid',octoeverywhere:{mode:'remote'}};
  saveDisplay(printer, {state:'ready',heaters:[],fans:[]}, 9000);
  store.setState({printers:[printer],selectedPrinterId:printer.id,deviceTabActive:true});
  startPrinterSession(); startPrinterSession();
  t.after(() => store.getState().setDeviceTabActive(false));
  assert.equal(starts,1,'visible remote reload starts immediately despite initial false focus, recent cache and absent native credential');
  assert.equal(store.getState().status,'online');
  focused = true; events.dispatchEvent(new Event('focus'));
  assert.equal(starts,1,'initial focus cannot duplicate the monitor');
  focused = false; events.dispatchEvent(new Event('blur'));
  assert.equal(stops,1,'subsequent blur still pauses');
  focused = true; events.dispatchEvent(new Event('focus'));
  assert.equal(starts,1,'ordinary returns retain refresh throttling');
  document.hidden = true; events.dispatchEvent(new Event('visibilitychange'));
  assert.equal(timers.size,0,'hidden tabs cancel pending reads');
  // A fresh local selection must continue to respect desktop focus.
  focused = false; document.hidden = false;
  store.setState({printers:[{...printer,id:'local',host_type:'octoprint',octoeverywhere:undefined}],selectedPrinterId:'local'});
  assert.equal(starts,1,'local printer never bypasses focus');
  focused = true;
  store.setState({printers:[{...printer,id:'cloud',host_type:'bambu-cloud'}],selectedPrinterId:'cloud'});
  assert.equal(starts,2,'remote cloud printer connects without native cloud credentials');
});
