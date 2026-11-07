import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
let client, directory;
const storage = new Map();
const source = { id: 'fixture', name: 'Fixture', host_type: 'snapmaker-cloud', print_host: 'id.snapmaker.com', cloud_region: 'global',
  use_gateway: true, cloud_account: 'fixture@example.invalid', printhost_apikey: 'access', cloud_refresh_token: 'refresh', cloud_device_id: 'D' };
const tokens = { code: 200, data: { access_token: 'rotated', refresh_token: 'renewed' } };
const device = { deviceId: 'D', name: 'Synthetic U1', online: true, status: 5, ip: '192.0.2.1', port: 80 };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
before(async () => {
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
  globalThis.window = { localStorage: globalThis.localStorage };
  const bundle = await build({ stdin: { contents: `export * from './src/printers/snapmakerCloud';export {usePrinterConnectionStore} from './src/printers/connectionStore';`, resolveDir: new URL('../../app', import.meta.url).pathname },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'locale', setup(b) { b.onResolve({filter:/\/i18n$/}, () => ({path:'locale',namespace:'fixture'})); b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const translate=s=>s;'})); } }],
    banner: { js: `import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(new URL('../../app/package.json',import.meta.url).href)});` } });
  directory = await mkdtemp(join(tmpdir(),'snapmaker-client-'));
  const file = join(directory,'client.mjs'); await writeFile(file,bundle.outputFiles[0].text); client = await import(pathToFileURL(file));
});
after(async () => { delete globalThis.localStorage; delete globalThis.window; await rm(directory,{recursive:true,force:true}); });
beforeEach(() => { storage.clear(); client.usePrinterConnectionStore.setState({printers:[],snapmakerSessions:[],selectedPrinterId:null}); });
const read = (p = source, signal = new AbortController().signal) => client.readSnapmakerSession(p,signal);

test('normalized login modes, code and account/list requests omit ambient credentials; cache precedes profile', async t => {
  const requests = [];
  t.mock.method(globalThis,'fetch',async (url,options) => { requests.push([url,options]);
    if (url.endsWith('/auth/send-code')) return response({code:200});
    if (url.endsWith('/auth/token')) return response(tokens);
    if (url.endsWith('/account')) { assert.equal(client.usePrinterConnectionStore.getState().snapmakerSessions[0].printhost_apikey,'rotated'); return response({code:200,data:{id:'A'}}); }
    return response({code:0,data:[device]});
  });
  for (const secret of [{password:'synthetic-password'},{code:'synthetic-code'}]) {
    const p = await client.loginSnapmaker(source,source.cloud_account,secret,new AbortController().signal);
    assert.deepEqual(JSON.parse(requests.at(-1)[1].body),{email:source.cloud_account,...secret});
    const result = await read(p); assert.deepEqual(result.data.devices,[{deviceId:'D',name:'Synthetic U1',online:true,sn:undefined}]);
  }
  await client.sendSnapmakerCode(source,source.cloud_account,new AbortController().signal);
  assert.deepEqual(JSON.parse(requests.at(-1)[1].body),{account:source.cloud_account});
  assert.ok(requests.every(([u,o])=>u.startsWith('/_printer/snapmaker-cloud/') && o.credentials==='same-origin' && o.signal));
  assert.ok(requests.filter(([u])=>u.endsWith('/devices')).every(([,o])=>o.body==='{}' && o.headers.Authorization==='Bearer rotated'));
  const saved = storage.get('orca-printers'); for (const s of ['synthetic-password','synthetic-code','Synthetic U1','192.0.2.1']) assert.ok(!saved.includes(s));
  assert.deepEqual(client.usePrinterConnectionStore.getState().printers,[]);
});

test('strict token/account/device parsing rejects malformed and incomplete lists without invalidating tokens', async t => {
  for (const v of [{},{code:200,data:{access_token:'a'}},{code:0,data:{access_token:'a',refresh_token:'r'}}]) assert.throws(()=>client.parseSnapmakerTokens(v));
  for (const v of [{code:0,data:[{name:'No ID'}]},{code:0,data:[device,device]},{code:0,data:[device],page:{total:2}},{code:0,data:[{...device,online:'0'}]}]) assert.throws(()=>client.parseSnapmakerDevices(v));
  for (const profile of [{code:200,data:{id:''}},{code:0,data:{id:'A'}},null]) {
    client.usePrinterConnectionStore.getState().saveSnapmakerSession(source);
    t.mock.method(globalThis,'fetch',async()=>response(profile)); await assert.rejects(read());
    assert.equal(client.usePrinterConnectionStore.getState().snapmakerSessions.length,1);
  }
});

test('concurrent auth rejection refreshes once and persists rotation before pending devices', async t => {
  const store=client.usePrinterConnectionStore; store.getState().saveSnapmakerSession(source);
  let refreshes=0, reached; const started=new Promise(r=>reached=r); const releases=[];
  t.mock.method(globalThis,'fetch',async(url,o)=>{
    if(url.endsWith('/auth/refresh')) {refreshes++; await new Promise(r=>setTimeout(r,5)); assert.deepEqual(JSON.parse(o.body),{refresh_token:'refresh'}); return response(tokens);}
    if(o.headers.Authorization==='Bearer access') return response({code:110003});
    if(url.endsWith('/account')) return response({code:200,data:{id:'A'}});
    assert.equal(JSON.parse(storage.get('orca-printers')).state.snapmakerSessions[0].cloud_refresh_token,'renewed');
    return new Promise(r=>{releases.push(r); if(releases.length===2) reached();});
  });
  const controller=new AbortController(); const a=read(source,controller.signal); const b=read(source,controller.signal);
  await started; assert.equal(refreshes,1); controller.abort(); releases.forEach(r=>r(response({code:0,data:[]})));
  for(const result of await Promise.allSettled([a,b])) { assert.equal(result.status,'rejected'); assert.equal(result.reason.name,'AbortError'); }
  assert.equal(store.getState().snapmakerSessions[0].printhost_apikey,'rotated');
});

for (const status of [401,403,503]) test(`HTTP ${status} preserves only transient/unidentified rejection`,async t=>{
  const store=client.usePrinterConnectionStore; const p={...source,cloud_refresh_token:undefined}; store.setState({printers:[p]});
  t.mock.method(globalThis,'fetch',async()=>response({},status)); await assert.rejects(read(p));
  assert.equal(store.getState().printers[0].printhost_apikey,status===401?undefined:'access');
});

test('abort and supersession prevent stale responses and token writes',async t=>{
  const store=client.usePrinterConnectionStore; store.getState().saveSnapmakerSession(source);
  let finish; t.mock.method(globalThis,'fetch',()=>new Promise(r=>finish=r));
  const controller=new AbortController(); const pending=read(source,controller.signal); controller.abort();
  store.getState().saveSnapmakerSession({...source,printhost_apikey:'newer'}); finish(response(tokens));
  await assert.rejects(pending,{name:'AbortError'}); assert.equal(store.getState().snapmakerSessions[0].printhost_apikey,'newer');
});

test('rejected rotated credentials stop after one refresh and invalidate only the matching account',async t=>{
  const store=client.usePrinterConnectionStore;
  const other={...source,cloud_account:'other@example.invalid'};
  store.getState().saveSnapmakerSession(source);store.getState().saveSnapmakerSession(other);
  let refreshes=0;
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.endsWith('/auth/refresh')) {refreshes++;return response(tokens);}
    return response({},401);
  });
  await assert.rejects(read(),{status:401});assert.equal(refreshes,1);
  assert.deepEqual(store.getState().snapmakerSessions.map(p=>p.cloud_account),[other.cloud_account]);
  // Even equal token bytes in separate account records must remain isolated on rejection.
  store.getState().saveSnapmakerSession(source);store.getState().rejectSnapmakerSession(source);
  assert.deepEqual(store.getState().snapmakerSessions.map(p=>p.cloud_account),[other.cloud_account]);
});

test('network failure retains tokens without refreshing; a superseded refresh cannot overwrite a newer login',async t=>{
  const store=client.usePrinterConnectionStore;store.getState().saveSnapmakerSession(source);
  let requests=0;
  t.mock.method(globalThis,'fetch',async()=>{requests++;throw new TypeError('Synthetic offline');});
  await assert.rejects(read(),/Synthetic offline/);assert.equal(requests,1);
  assert.equal(store.getState().snapmakerSessions[0].cloud_refresh_token,'refresh');
  let release,started;const waiting=new Promise(r=>started=r);
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.endsWith('/auth/refresh'))return new Promise(r=>{release=r;started();});
    return response({},401);
  });
  const pending=read();await waiting;
  store.getState().saveSnapmakerSession({...source,printhost_apikey:'new-login',cloud_refresh_token:'new-refresh'});
  release(response(tokens));await assert.rejects(pending,{name:'AbortError'});
  assert.equal(store.getState().snapmakerSessions[0].cloud_refresh_token,'new-refresh');
});

test('canceled login does not cache late tokens and unsupported scopes never fetch',async t=>{
  let release;let requests=0;
  t.mock.method(globalThis,'fetch',()=>{requests++;return new Promise(r=>release=r);});
  const controller=new AbortController();
  const pending=client.loginSnapmaker(source,source.cloud_account,{password:'synthetic'},controller.signal);
  controller.abort();release(response(tokens));await assert.rejects(pending,{name:'AbortError'});
  assert.deepEqual(client.usePrinterConnectionStore.getState().snapmakerSessions,[]);
  for(const changed of [{host_type:'prusaconnect'},{print_host:'192.0.2.1'},{cloud_region:'china'}])
    await assert.rejects(read({...source,...changed}),/Unsupported Snapmaker/);
  assert.equal(requests,1);
});

test('test checks the account and selected device without claiming telemetry readiness',async t=>{
  t.mock.method(globalThis,'fetch',async url=>response(url.endsWith('/account')?{code:200,data:{id:'A'}}:{code:0,data:[device]}));
  assert.equal(await new client.SnapmakerCloudApi(source).test(),'Snapmaker account and selected printer verified. Connect to read live status.');
  await assert.rejects(new client.SnapmakerCloudApi({...source,cloud_device_id:'missing'}).test(),/Choose a printer/);
  await assert.rejects(new client.SnapmakerCloudApi(source).upload({}),/monitor-only/);
});

test('disconnect aborts pending account requests without callbacks',async t=>{
  let signal; t.mock.method(globalThis,'fetch',(_u,o)=>{signal=o.signal;return new Promise((_r,j)=>signal.addEventListener('abort',()=>j(signal.reason)));});
  const stop=new client.SnapmakerCloudApi(source).connect(()=>assert.fail('late state'),()=>assert.fail('late error')); stop(); assert.ok(signal.aborted);
});

test('a failed monitor setup retains immediate rotation and does not repeat account calls',async t=>{
  client.usePrinterConnectionStore.getState().saveSnapmakerSession(source);
  let failed,requests=0;
  const firstFailure=new Promise(r=>failed=r);
  t.mock.method(globalThis,'fetch',async(url,o)=>{
    requests++;
    if(url.endsWith('/auth/refresh'))return response(tokens);
    if(o.headers.Authorization==='Bearer access')return response({},401);
    if(url.endsWith('/account'))return response({code:200,data:{id:'A'}});
    return response({code:0,data:[device]},503);
  });
  const stop=new client.SnapmakerCloudApi(source).connect(()=>{},failed);
  await firstFailure;
  assert.equal(client.usePrinterConnectionStore.getState().snapmakerSessions[0].printhost_apikey,'rotated');
  assert.equal(requests,4);stop();
});
