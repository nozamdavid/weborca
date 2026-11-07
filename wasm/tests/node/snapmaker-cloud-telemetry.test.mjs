import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
let client, directory, timers, timerId, requests;
const storage = new Map();
const source = { id: 'fixture', name: 'Fixture', host_type: 'snapmaker-cloud', print_host: 'id.snapmaker.com', cloud_region: 'global',
  use_gateway: true, cloud_account: 'fixture@example.invalid', printhost_apikey: 'access', cloud_refresh_token: 'refresh', cloud_device_id: 'D' };
const response = data => new Response(JSON.stringify(data));
const flush = () => new Promise(resolve => setImmediate(resolve));
class Socket {
  static instances = [];
  sent = []; closed = false;
  constructor(url) { this.url = url; Socket.instances.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; }
  open() { this.onopen?.({}); }
  frame(value) { this.onmessage?.({data:JSON.stringify(value)}); }
}
before(async () => {
  globalThis.localStorage = {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  globalThis.window = {localStorage:globalThis.localStorage,location:{href:'https://weborca.example.invalid/app?existing=query'}};
  const bundle = await build({stdin:{contents:`export * from './src/printers/snapmakerCloud';export * from './src/printers/snapmakerTelemetry';export {usePrinterConnectionStore} from './src/printers/connectionStore';export {HOST_CAPABILITIES} from './src/printers/types';`,resolveDir:new URL('../../app',import.meta.url).pathname},
    bundle:true,platform:'node',format:'esm',write:false,
    plugins:[{name:'locale',setup(b){b.onResolve({filter:/\/i18n$/},()=>({path:'locale',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const translate=s=>s;'}));}}],
    banner:{js:`import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(new URL('../../app/package.json',import.meta.url).href)});`}});
  directory=await mkdtemp(join(tmpdir(),'snapmaker-telemetry-'));const file=join(directory,'client.mjs');await writeFile(file,bundle.outputFiles[0].text);client=await import(pathToFileURL(file));
});
after(async()=>{delete globalThis.localStorage;delete globalThis.window;await rm(directory,{recursive:true,force:true});});
beforeEach(t=>{
  storage.clear();Socket.instances=[];timers=new Map();timerId=0;requests=[];
  client.usePrinterConnectionStore.setState({printers:[],snapmakerSessions:[],selectedPrinterId:null});
  t.mock.method(globalThis,'setTimeout',(callback,ms)=>{timers.set(++timerId,{callback,ms});return timerId;});
  t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
  t.mock.method(globalThis,'fetch',async(url,options)=>{requests.push([url,options]);return response(url.endsWith('/account')?{code:200,data:{id:'A'}}:{code:0,data:[{deviceId:'D',name:'Synthetic U1',online:false}]});});
  t.mock.property(globalThis,'WebSocket',Socket);
});
async function connect(t,p=source) {
  const states=[],errors=[];const api=new client.SnapmakerCloudApi(p);
  const stop=api.connect(state=>states.push(state),error=>errors.push(error));t.after(stop);
  await flush();
  if(p.cloud_device_id==='D')assert.deepEqual(errors,[]);
  return {api,stop,states,errors,socket:Socket.instances.at(-1)};
}
const snapshot = {
  print_stats:{state:'printing',filename:'received.gcode',print_duration:123,total_duration:150,info:{current_layer:3,total_layer:100}},
  display_status:{progress:0.25},virtual_sdcard:{progress:0.2},heater_bed:{temperature:59.5,target:60},extruder2:{temperature:219.1,target:220}
};

test('validated diagnostics refine fixed upstream text and ignore all remote messages', async t => {
  const {socket, errors}=await connect(t);socket.open();
  socket.frame({type:'error',code:'upstream',message:'PRIVATE',diagnostic:{phase:'objects-query',reason:'rpc-error',code:-32000}});
  assert.equal(errors[0].message,'Snapmaker monitoring could not reach the upstream service. Stage: printer object query; RPC rejected (code -32000).');
});

test('invalid diagnostics fall back to generic upstream text without coercion or leakage', () => {
  for (const diagnostic of [null, [], {phase:'PRIVATE',reason:'http'}, {phase:'device-list',reason:'PRIVATE'},
    {phase:'device-list',reason:'business',code:2147483648}, {phase:'device-list',reason:'business',code:1.5},
    {phase:'device-list',reason:'business',code:'123'}, {phase:'device-list',reason:'http',extra:'PRIVATE'},
    {phase:'device-list',reason:'http',code:99}, {phase:'device-list',reason:'http',code:600},
    {phase:'broker-connection',reason:'mqtt-rejected',code:256}, {phase:'dns',reason:'network',code:123}]) {
    assert.deepEqual(client.parseSnapmakerFrame(JSON.stringify({type:'error',code:'upstream',message:'PRIVATE',diagnostic})),{type:'error',code:'upstream'});
  }
});

test('unsupported diagnostics render fixed categories and discard malicious or unknown reasons', () => {
  for (const [phase, stage, reason, label] of [
    ['monitoring-credential', 'monitoring credential API', 'broker-host', 'unsupported broker host'],
    ['monitoring-credential', 'monitoring credential API', 'broker-port', 'unsupported broker port'],
    ['monitoring-credential', 'monitoring credential API', 'client-identity', 'invalid client identity'],
    ['monitoring-credential', 'monitoring credential API', 'credential-invalid', 'invalid monitoring credential'],
    ['monitoring-credential', 'monitoring credential API', 'subscribe-topics', 'unsupported subscribe topics'],
    ['monitoring-credential', 'monitoring credential API', 'publish-topics', 'unsupported publish topics'],
    ['device-list', 'device list API', 'device-response', 'invalid device list response'],
    ['device-list', 'device list API', 'device-identity', 'selected device identity could not be verified'],
    ['dns', 'broker DNS lookup', 'broker-address', 'broker address failed public address policy'],
    ['broker-connection', 'broker TLS/MQTT connection', 'client-in-use', 'local monitoring session already uses this client identity'],
    ['objects-list', 'printer object list', 'object-response', 'unsupported printer object response'],
    ['objects-query', 'printer object query', 'object-response', 'unsupported printer object response']
  ]) {
    const diagnostic = {phase,reason};
    const frame = client.parseSnapmakerFrame(JSON.stringify({type:'error',code:'unsupported',message:'PRIVATE',diagnostic}));
    assert.deepEqual(frame.diagnostic,diagnostic);
    assert.equal(client.snapmakerMonitorError(frame),`The Snapmaker monitoring configuration is unsupported. Stage: ${stage}; ${label}.`);
    for (const invalid of [{...diagnostic,code:123}, {...diagnostic,reason:reason+' PRIVATE'},
      {...diagnostic,reason:'toString'}, {...diagnostic,reason:'future-reason'}, {...diagnostic,host:'PRIVATE'}]) {
      const rejected = client.parseSnapmakerFrame(JSON.stringify({type:'error',code:'unsupported',message:'PRIVATE',diagnostic:invalid}));
      assert.deepEqual(rejected,{type:'error',code:'unsupported'});
      assert.equal(client.snapmakerMonitorError(rejected),'The Snapmaker monitoring configuration is unsupported.');
    }
  }
});

test('all diagnostic stages and signed numeric boundaries render only fixed labels', () => {
  for (const phase of ['device-list','monitoring-credential','dns','broker-connection','subscription',
    'objects-list','objects-subscribe','subscribe-filter','objects-query']) {
    for (const code of [-2147483648,0,2147483647]) {
      const frame=client.parseSnapmakerFrame(JSON.stringify({type:'error',code:'upstream',message:'PRIVATE',diagnostic:{phase,reason:'rpc-error',code}}));
      assert.deepEqual(frame.diagnostic,{phase,reason:'rpc-error',code});
      const text=client.snapmakerMonitorError(frame);
      assert.ok(text.includes(`(code ${code})`));assert.ok(!text.includes('PRIVATE'));assert.ok(!text.includes('undefined'));
    }
  }
  assert.equal(client.snapmakerMonitorError(client.parseSnapmakerFrame('{"type":"error","code":"upstream","message":"PRIVATE"}')),
    'Snapmaker monitoring could not reach the upstream service.');
});
function unknown(state) {
  assert.equal(state.state,'unknown');assert.deepEqual(state.heaters,[]);assert.deepEqual(state.fans,[]);
  for(const key of ['file','elapsed','remaining','progress','layer','filaments','filamentSlots'])assert.equal(state[key],undefined,key);
}

test('material snapshot preserves physical slots and presence; clear replaces old inventory', async t => {
  const {socket,states,errors}=await connect(t);socket.open();
  socket.frame({type:'snapshot',objects:{...snapshot,print_task_config:{
    filament_vendor:['Old','Example','Other','Example'],filament_type:['PLA','PETG','ABS','PLA'],
    filament_sub_type:['Matte','Basic','NONE','Silk'],filament_exist:[false,true,null,true],
    filament_color_rgba:['FF0000FF','11223380','bad','#000000FF']}}});
  assert.deepEqual(errors,[]);
  assert.deepEqual(states.at(-1).filamentSlots,[
    {id:'snapmaker:tool:0',slotIndex:0,label:'T0',material:'',presence:'empty'},
    {id:'snapmaker:tool:1',slotIndex:1,label:'T1',material:'PETG',presence:'present',vendor:'Example',subtype:'Basic',color:'#112233'},
    {id:'snapmaker:tool:2',slotIndex:2,label:'T2',material:'ABS',presence:'unknown',vendor:'Other'},
    {id:'snapmaker:tool:3',slotIndex:3,label:'T3',material:'PLA',presence:'present',vendor:'Example',subtype:'Silk',color:'#000000'}]);
  assert.equal(states.at(-1).filaments,undefined);
  const slots=states.at(-1).filamentSlots;
  socket.frame({type:'delta',objects:{extruder2:{temperature:230}}});
  assert.deepEqual(states.at(-1).filamentSlots,slots);
  socket.frame({type:'delta',objects:{print_task_config:{}}});
  assert.deepEqual(states.at(-1).filamentSlots,slots);
  socket.frame({type:'delta',objects:{print_task_config:null}});
  assert.equal(states.at(-1).filamentSlots,undefined);
  socket.frame({type:'delta',objects:{print_task_config:{filament_type:[],filament_vendor:[],filament_exist:[]}}});
  assert.deepEqual(states.at(-1).filamentSlots,[]);
  socket.frame({type:'snapshot',objects:snapshot});
  assert.equal(states.at(-1).filamentSlots,undefined);
});

test('material arrays replace whole fields; optional malformed values stay bounded and unknown', () => {
  const parse=objects=>client.parseSnapmakerFrame(JSON.stringify({type:'snapshot',objects})).objects;
  const state=objects=>client.snapmakerPrinterState(objects);
  let objects=parse({print_task_config:{filament_type:['PLA','PETG','ABS'],filament_exist:[true,true,true],filament_color:[0,-65536,4279312947]}});
  assert.deepEqual(state(objects).filamentSlots.map(s=>s.color),['#000000','#FF0000','#112233']);
  objects=client.mergeSnapmakerObjects(objects,parse({print_task_config:{filament_type:[' Nylon '],filament_exist:[true],filament_color:[]}}));
  assert.deepEqual(state(objects).filamentSlots,[{id:'snapmaker:tool:0',slotIndex:0,label:'T0',material:'Nylon',presence:'present'}]);
  objects=client.mergeSnapmakerObjects(objects,parse({print_task_config:{filament_type:null,filament_exist:[]}}));
  assert.deepEqual(state(objects).filamentSlots,[]);
  for(const clear of [false,{},[]])assert.equal(state(parse({print_task_config:clear})).filamentSlots,undefined);
  assert.equal(state(parse({print_task_config:{filament_type:false,filament_vendor:false,filament_exist:false}})).filamentSlots,undefined);
  assert.equal(state(parse({print_task_config:null})).filamentSlots,undefined);
  for(const presence of [undefined,null,'true',1,{},[]]) {
    const config={filament_type:['NONE','PLA'],filament_exist:[presence,false],filament_vendor:[' ','Stale'],filament_sub_type:['NONE','Stale'],filament_color:['invalid',-1]};
    const slots=state(parse({print_task_config:config})).filamentSlots;
    assert.deepEqual(slots,[{id:'snapmaker:tool:0',slotIndex:0,label:'T0',material:'',presence:'unknown'},
      {id:'snapmaker:tool:1',slotIndex:1,label:'T1',material:'',presence:'empty'}]);
  }
  for(const bad of [Array(17).fill('PLA'),{},'PLA',42]) {
    const result=state(parse({extruder:{temperature:20,target:200},print_task_config:{filament_type:bad,filament_exist:[true]}}));
    assert.equal(result.heaters.length,1);assert.equal(result.filamentSlots[0].material,'');
  }
  const colors=state(parse({print_task_config:{filament_type:Array(7).fill('PLA'),filament_color_rgba:['#abcdef80','bad',null,null,null,null,null],
    filament_color:[-1,-1,0,4294967295,-2147483648,4294967296,1.5]}})).filamentSlots;
  assert.deepEqual(colors.map(s=>s.color),['#ABCDEF',undefined,'#000000','#FFFFFF','#000000',undefined,undefined]);
  assert.equal(state(parse({print_task_config:{filament_type:['x'.repeat(129)]}})).filamentSlots[0].material,'');
  const highest=state(parse({print_task_config:{filament_type:Array(16).fill('PLA'),filament_exist:Array(16).fill(true)}})).filamentSlots[15];
  assert.equal(highest.id,'snapmaker:tool:15');assert.equal(highest.slotIndex,15);assert.equal(highest.label,'T15');
});

test('sparse extruder joins preserve array indices and reject ambiguous physical joins', () => {
  const slots=extruders=>client.snapmakerPrinterState(client.parseSnapmakerFrame(JSON.stringify({type:'snapshot',objects:{
    ...extruders,print_task_config:{filament_type:['PLA','PETG','ABS','Nylon'],filament_exist:[true,true,true,true]}}})).objects).filamentSlots;
  assert.deepEqual(slots({extruder1:{extruder_index:3},extruder3:{extruder_index:1}}).map(s=>[s.slotIndex,s.label,s.material]),
    [[0,'T0','PLA'],[1,'T1','PETG'],[2,'T2','ABS'],[3,'T3','Nylon']]);
  for(const index of [-1,1.5,16,'0',null])assert.equal(slots({extruder:{extruder_index:index}})[0].presence,'unknown');
  const duplicate=slots({extruder:{extruder_index:1},extruder1:{extruder_index:1}});
  assert.equal(duplicate[0].material,'');assert.equal(duplicate[1].presence,'unknown');
  assert.equal(slots({extruder15:{extruder_index:15}}).length,4);
});

test('heater physical indices use authoritative explicit values or canonical names only', () => {
  const heaters = objects => client.snapmakerPrinterState(client.parseSnapmakerFrame(JSON.stringify({type:'snapshot',objects})).objects).heaters;
  const reading = {temperature:201,target:211};
  assert.deepEqual(heaters({extruder3:reading,extruder:reading,extruder15:reading}).map(h=>h.toolIndex),[3,0,15]);
  assert.equal(heaters({extruder:{...reading,extruder_index:3}})[0].toolIndex,3);
  for (const index of [-1,16,1.5,'0',null])
    assert.equal(heaters({extruder:{...reading,extruder_index:index}})[0].toolIndex,undefined);
  for (const name of ['extruder01','extruder16','extruder99','heater_bed'])
    assert.equal(heaters({[name]:reading})[0].toolIndex,undefined);
});

test('connect validates device, uses same-origin WS and sends only one initial token frame; snapshot supplies real readings',async t=>{
  const {socket,states,errors}=await connect(t,{...source,local_gateway:'https://account-gateway.example.invalid'});
  assert.equal(requests.length,2);assert.ok(requests.every(([url])=>url.startsWith('/_printer/snapmaker-cloud/')));
  assert.equal(socket.url,'wss://weborca.example.invalid/_printer/snapmaker-cloud/monitor');
  assert.deepEqual(socket.sent,[]);socket.open();
  assert.deepEqual(socket.sent,[{type:'connect',accessToken:'access',deviceId:'D'}]);
  socket.frame({type:'connection',state:'connecting'});assert.deepEqual(states,[]);
  socket.frame({type:'snapshot',objects:snapshot});
  const state=states.at(-1);assert.equal(state.state,'printing');assert.equal(state.file,'received.gcode');assert.equal(state.elapsed,123);
  assert.equal(state.progress,0.25);assert.deepEqual(state.layer,{current:3,total:100});
  assert.deepEqual(state.heaters.map(h=>[h.id,h.current,h.target]),[['heater_bed',59.5,60],['extruder2',219.1,220]]);
  assert.equal(state.filaments,undefined);assert.equal(state.remaining,undefined);assert.deepEqual(errors,[]);assert.equal(socket.sent.length,1);
  assert.ok(Object.values(client.HOST_CAPABILITIES['snapmaker-cloud']).every(v=>v===false));
});

test('sparse object and nested layer deltas preserve fields; snapshots replace them and absent values stay unknown',async t=>{
  const {socket,states}=await connect(t);socket.open();socket.frame({type:'snapshot',objects:snapshot});
  socket.frame({type:'delta',objects:{print_stats:{info:{current_layer:4}},extruder2:{temperature:221}}});
  assert.deepEqual(states.at(-1).layer,{current:4,total:100});assert.equal(states.at(-1).file,'received.gcode');
  assert.equal(states.at(-1).heaters[1].target,220);assert.equal(states.at(-1).heaters[1].current,221);
  socket.frame({type:'delta',objects:{display_status:{progress:null},print_stats:{filename:null}}});
  assert.equal(states.at(-1).progress,0.2);assert.equal(states.at(-1).file,undefined);
  socket.frame({type:'snapshot',objects:{heater_bed:{temperature:50},extruder:{target:200},print_stats:{info:{total_layer:100}}}});
  unknown(states.at(-1));socket.frame({type:'snapshot',objects:{}});unknown(states.at(-1));
});

for(const terminal of ['close','error','disconnected','stale','auth'])test(`${terminal} reports an error without synthetic telemetry, closes once and never reconnects`,async t=>{
  const {socket,states,errors}=await connect(t);socket.open();socket.frame({type:'snapshot',objects:{...snapshot,print_task_config:{filament_type:['PLA'],filament_exist:[true]}}});
  assert.equal(states.at(-1).filamentSlots[0].presence,'present');
  const received=states.at(-1), count=states.length;
  const late=socket.onmessage;
  if(terminal==='close')socket.onclose({});
  else if(terminal==='error')socket.onerror({});
  else if(terminal==='disconnected')socket.frame({type:'connection',state:'disconnected'});
  else socket.frame({type:'error',code:terminal,message:'UNTRUSTED REMOTE TEXT'});
  assert.equal(states.length,count);assert.equal(states.at(-1),received);assert.equal(errors.length,1);assert.ok(!errors[0].message.includes('UNTRUSTED'));
  assert.ok(socket.closed);assert.equal(timers.size,0);late({data:JSON.stringify({type:'snapshot',objects:snapshot})});
  assert.equal(states.length,count);assert.equal(errors.length,1);assert.equal(Socket.instances.length,1);assert.equal(requests.length,2);
});

test('startup and freshness deadlines bound connecting frames and silent monitors',async t=>{
  let run=await connect(t);run.socket.open();assert.equal([...timers.values()][0].ms,35_000);
  const startup=[...timers.values()][0];run.socket.frame({type:'connection',state:'connecting'});
  assert.equal([...timers.values()][0],startup);startup.callback();assert.equal(run.errors.length,1);assert.deepEqual(run.states,[]);assert.ok(run.socket.closed);assert.equal(timers.size,0);
  run=await connect(t);run.socket.frame({type:'snapshot',objects:snapshot});
  const received=run.states.at(-1), count=run.states.length;
  const fresh=[...timers.values()][0];assert.equal(fresh.ms,30_000);fresh.callback();assert.equal(run.states.length,count);assert.equal(run.states.at(-1),received);assert.equal(run.errors.length,1);assert.ok(run.socket.closed);assert.equal(timers.size,0);
});

test('malformed, oversized, polluted, invalid numbers and pre-snapshot deltas fail closed',async t=>{
  const bad=[null,'{',JSON.stringify({type:'delta',objects:{}}),JSON.stringify({type:'connected'}),
    JSON.stringify({type:'snapshot',objects:[]}),JSON.stringify({type:'snapshot',objects:{heater_bed:{temperature:2000,target:60}}}),
    JSON.stringify({type:'snapshot',objects:{display_status:{progress:1.1}}}),
    '{"type":"snapshot","objects":{"heater_bed":{"temperature":1e999,"target":60}}}',
    '{"type":"snapshot","objects":{"__proto__":{"polluted":true}}}',
    '{"type":"snapshot","objects":{"print_stats":{"info":{"constructor":{}}}}}',
    ' '.repeat(256*1024+1)];
  for(const data of bad){const {socket,states,errors}=await connect(t);socket.onmessage({data});assert.equal(errors.length,1);assert.deepEqual(states,[]);assert.ok(socket.closed);assert.equal(timers.size,0);}
  assert.equal({}.polluted,undefined);
  for(const objects of [{print_stats:{print_duration:-1}},{print_stats:{info:{current_layer:1.5}}},{extruder:{temperature:20,target:-1}},
    {virtual_sdcard:{progress:'0.5'}},{print_stats:{filename:5}},{extruder100:{temperature:20,target:20}}])
    assert.throws(()=>client.parseSnapmakerFrame(JSON.stringify({type:'snapshot',objects})));
  const parsed=client.parseSnapmakerFrame(JSON.stringify({type:'snapshot',objects:{print_stats:{state:'unrecognized'},extruder:{temperature:null,target:200}}}));
  unknown(client.snapmakerPrinterState(parsed.objects));
});

test('disconnect, selection switch and a second connect cancel sockets, timers and stale callbacks',async t=>{
  const run=await connect(t);const lateOpen=run.socket.onopen,lateMessage=run.socket.onmessage;
  run.stop();lateOpen({});lateMessage({data:JSON.stringify({type:'snapshot',objects:snapshot})});
  assert.deepEqual(run.socket.sent,[]);assert.deepEqual(run.states,[]);assert.deepEqual(run.errors,[]);assert.equal(timers.size,0);
  const next=await connect(t);client.usePrinterConnectionStore.getState().selectPrinter('other');
  assert.ok(next.socket.closed);assert.deepEqual(next.states,[]);assert.equal(timers.size,0);
  const third=await connect(t);const stop=third.api.connect(()=>{},()=>{});t.after(stop);assert.ok(third.socket.closed);await flush();
});

test('pending account fetch is aborted by selection switch and cannot create a late socket',async t=>{
  let finish,signal;t.mock.method(globalThis,'fetch',(_u,o)=>{signal=o.signal;return new Promise(r=>finish=r);});
  const api=new client.SnapmakerCloudApi(source);const states=[],errors=[];const stop=api.connect(s=>states.push(s),e=>errors.push(e));t.after(stop);
  client.usePrinterConnectionStore.getState().selectPrinter('other');assert.ok(signal.aborted);
  finish(response({code:200,data:{id:'A'}}));await flush();assert.equal(Socket.instances.length,0);assert.deepEqual(states,[]);assert.deepEqual(errors,[]);
});

test('session supersession tears down immediately and suppresses retained callbacks',async t=>{
  const store=client.usePrinterConnectionStore;store.getState().saveSnapmakerSession(source);
  const {socket,states,errors}=await connect(t);socket.open();socket.frame({type:'snapshot',objects:{...snapshot,print_task_config:{filament_type:['PLA'],filament_exist:[true]}}});const late=socket.onmessage;
  assert.equal(states.at(-1).filamentSlots[0].material,'PLA');
  const received=states.at(-1), count=states.length;
  store.getState().saveSnapmakerSession({...source,printhost_apikey:'new-login',cloud_refresh_token:'new-refresh'});
  assert.ok(socket.closed);assert.equal(states.length,count);assert.equal(states.at(-1),received);assert.equal(errors.length,1);assert.equal(timers.size,0);late({data:JSON.stringify({type:'snapshot',objects:snapshot})});assert.equal(states.length,count);assert.equal(errors.length,1);
  assert.equal(store.getState().snapmakerSessions[0].printhost_apikey,'new-login');
});

test('missing selected device never opens a websocket; rotated access token is used in the initial frame',async t=>{
  const missing=await connect(t,{...source,cloud_device_id:'missing'});assert.equal(Socket.instances.length,0);assert.equal(missing.errors.length,1);
  client.usePrinterConnectionStore.getState().saveSnapmakerSession(source);
  t.mock.method(globalThis,'fetch',async(url,o)=>{
    if(url.endsWith('/auth/refresh'))return response({code:200,data:{access_token:'rotated',refresh_token:'renewed'}});
    if(o.headers.Authorization==='Bearer access')return new Response('{}',{status:401});
    return response(url.endsWith('/account')?{code:200,data:{id:'A'}}:{code:0,data:[{deviceId:'D',name:'Synthetic U1'}]});
  });
  const rotated=await connect(t);rotated.socket.open();assert.equal(rotated.socket.sent[0].accessToken,'rotated');
  assert.equal(client.usePrinterConnectionStore.getState().snapmakerSessions[0].cloud_refresh_token,'renewed');
});

test('missing access credentials fail locally without another rejected account request',async t=>{
  const {errors,states}=await connect(t,{...source,printhost_apikey:undefined,cloud_device_id:'missing'});
  assert.equal(errors.length,1);assert.deepEqual(states,[]);assert.equal(requests.length,0);assert.equal(Socket.instances.length,0);assert.equal(timers.size,0);
});
