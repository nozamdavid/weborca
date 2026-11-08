// Isolated benchmark server. Serves the immutable deployed candidate verbatim.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root = process.cwd();
const candidate = path.resolve(process.env.CANDIDATE || 'wasm/build/v250-export-align/candidate');
const samples = '/mnt/appdata/workspace/OrcaSlicer/samples';
const out = path.resolve('wasm/build/sample-parity-20261107');
fs.mkdirSync(out, {recursive:true});
const names = fs.readdirSync(samples).filter(n=>/\.(stl|3mf)$/i.test(n));
const hash = b=>createHash('sha256').update(b).digest('hex');
fs.writeFileSync(path.join(out,'inputs.json'),JSON.stringify(names.map(name=>({name,sha256:hash(fs.readFileSync(path.join(samples,name)))})),null,2));
const page = `<!doctype html><title>Sample benchmark</title><pre id="status">Ready</pre><script type="module">
const names=${JSON.stringify(names)};
const save=async(name,data)=>{const r=await fetch('/result/'+encodeURIComponent(name),{method:'POST',body:typeof data==='string'?data:JSON.stringify(data)});if(!r.ok)throw Error('save failed')};
window.run=async()=>{window.results=[];for(let i=0;i<names.length;i++){const name=names[i];for(let trial=0;trial<4;trial++){
document.querySelector('pre').textContent=name+' trial '+trial;
const native=await (await fetch('/native/'+i+'/'+trial)).json();
const w=new Worker('/engine-worker.js',{type:'module'});let id=0;const pending=new Map();w.onmessage=({data:d})=>{if(d.progress)return;const p=pending.get(d.id);if(p){pending.delete(d.id);d.ok?p[0](d.result):p[1](Error(d.error?.message||JSON.stringify(d.error)))}};
const call=(method,args={})=>new Promise((resolve,reject)=>{const k=++id;pending.set(k,[resolve,reject]);w.postMessage({id:k,method,args})});
const result={name,trial,native,web:{hardwareConcurrency:navigator.hardwareConcurrency,threads:Math.min(navigator.hardwareConcurrency||4,8),sliceOnlyMs:null}};
try{await call('init',{moduleUrl:location.origin+'/engine/orca_engine.mjs',profilesUrl:location.origin+'/profiles/'});await call('loadVendors',{vendors:['Voron','OrcaFilamentLibrary','BBL']});
if(name.endsWith('.stl'))await call('selectPresets',{printer:'Voron 2.4 300 0.4 nozzle',process:'0.20mm Standard @Voron',filaments:['Generic PLA @System']});
const bytes=new Uint8Array(await(await fetch('/sample/'+i)).arrayBuffer());result.web.import=await call('loadModel',{fileName:name,bytes});
if(name.endsWith('.stl'))result.web.arrange=await call('arrange');
result.web.config=await call('getConfig');result.web.plates=await call('listPlates');result.web.objects=await call('getObjectTree');
const start=performance.now();const sliced=await call('slice',{plateIndex:0});result.web.sliceAndExportAndReadMs=performance.now()-start;
const gcode=sliced.gcode;delete sliced.gcode;result.web.slice=sliced;
await fetch('/result/'+i+'-'+trial+'-web.gcode',{method:'POST',body:gcode});
}catch(e){result.web.error=String(e)}finally{w.terminate()}
await save(i+'-'+trial+'.json',result);window.results.push(result);
}}document.querySelector('pre').textContent='Finished';return window.results.map(r=>({name:r.name,trial:r.trial,native:r.native,webError:r.web.error,webMs:r.web.sliceAndExportAndReadMs}))};
</script>`;
const server=http.createServer(async(req,res)=>{try{
res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
const url=new URL(req.url,'http://localhost');const parts=url.pathname.split('/').map(decodeURIComponent);
if(parts[1]==='result'&&req.method==='POST'){const name=path.basename(parts[2]);const chunks=[];for await(const c of req)chunks.push(c);fs.writeFileSync(path.join(out,name),Buffer.concat(chunks));res.end('ok');return}
if(parts[1]==='native'){
const i=Number(parts[2]),trial=Number(parts[3]);const dir=path.join(out,i+'-'+trial+'-native');fs.mkdirSync(dir,{recursive:true});
const args=['run','--user','com.orcaslicer.OrcaSlicer','--datadir',path.join(dir,'data'),'--debug','3','--logfile',path.join(dir,'engine.log'),'--allow-newer-file','--slice','0','--outputdir',dir];
if(names[i].endsWith('.stl'))args.push('--load-settings',path.join(root,'resources/profiles/Voron/machine/Voron 2.4 300 0.4 nozzle.json')+';'+path.join(root,'resources/profiles/Voron/process/0.20mm Standard @Voron.json'),'--load-filaments',path.join(root,'resources/profiles/OrcaFilamentLibrary/filament/Generic PLA @System.json'));
args.push(path.join(samples,names[i]));fs.writeFileSync(path.join(dir,'command.json'),JSON.stringify(['flatpak',...args],null,2));
const log=fs.openSync(path.join(dir,'stdout.log'),'w');const p=spawn('flatpak',args,{stdio:['ignore',log,log]});const code=await new Promise(resolve=>p.on('close',resolve));fs.closeSync(log);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code,sliceOnlyMs:null,log:path.join(dir,'stdout.log')}));return}
if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(page);return}
const file=parts[1]==='sample'?path.join(samples,names[Number(parts[2])]):path.join(candidate,url.pathname);
if(!file.startsWith(candidate)&&!file.startsWith(samples))throw Error('invalid path');
res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':/\.(js|mjs)$/.test(file)?'text/javascript':file.endsWith('.json')?'application/json':'application/octet-stream');
res.end(fs.readFileSync(file));
}catch(e){res.statusCode=500;res.end(String(e))}});
server.listen(5079,'0.0.0.0',()=>console.log('Benchmark http://localhost:5079; results '+out));
