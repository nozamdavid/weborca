import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from '../../tests/node_modules/playwright/index.mjs';
import {detailedGcode} from '../../tests/lib/preview-performance-fixtures.mjs';
const root=path.resolve('wasm/build/ui-review-followups-20261111');
const server=http.createServer((req,res)=>{const p=path.join(root,new URL(req.url,'http://localhost').pathname);res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');const f=fs.existsSync(p)&&fs.statSync(p).isFile()?p:path.join(root,'index.html');res.setHeader('Content-Type',f.endsWith('.wasm')?'application/wasm':/\.m?js$/.test(f)?'text/javascript':f.endsWith('.json')?'application/json':f.endsWith('.css')?'text/css':'text/html');fs.createReadStream(f).pipe(res);});
await new Promise((r,j)=>{server.once('error',j);server.listen(5067,'127.0.0.1',r)});
let browser;try{
browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});const page=await browser.newPage();
await page.addInitScript(()=>{window.samples=[];const W=Worker;window.Worker=class extends W{constructor(...args){super(...args);if(String(args[0]).includes('previewWorker')){let timer,last,ticks,max,start;const post=this.postMessage.bind(this);this.postMessage=(...a)=>{last=start=performance.now();ticks=max=0;timer=setInterval(()=>{const t=performance.now();max=Math.max(max,t-last);last=t;ticks++},5);return post(...a)};this.addEventListener('message',e=>{clearInterval(timer);window.samples.push({stats:e.data.stats,error:e.data.error,ms:performance.now()-start,ticks,maxGapMs:max})})}}}});
await page.goto('http://127.0.0.1:5067');await page.waitForFunction(()=>window.__appStore?.getState().isEngineReady,null,{timeout:90000});
console.log('SUPPLEMENT',JSON.stringify(await page.evaluate(async small=>{
 const exports=await import('/assets/appStore-ByJFN79I.js');const stores=Object.entries(exports).filter(([,v])=>typeof v?.getState==='function');
 const ps=stores.find(([,v])=>'loadGcodeBytes' in v.getState())?.[1];
 const cloud=stores.find(([,v])=>'checking' in v.getState())?.[1];
 const summary=()=>({app:{...window.__appStore.getState().sliceResult,gcode:undefined},preview:ps?.getState().stats,samples:window.samples});
 await window.__appStore.getState().openGcodeFile(new File([small],'small.gcode'));const loaded=summary();
 await window.__appStore.getState().openGcodeFile(new File(['not gcode'],'bad.gcode'));const bad=summary();
 await window.__appStore.getState().openGcodeFile(new File([small],'recovered.gcode'));const recovered=summary();
 let release;const old=new File([small],'older.gcode');old.arrayBuffer=()=>new Promise(r=>release=r);
 const a=window.__appStore.getState().openGcodeFile(old);await window.__appStore.getState().openGcodeFile(new File([small],'newest.gcode'));release(new TextEncoder().encode(small).buffer);await a;
 return {storeFound:!!ps,cloud:cloud?.getState(),loaded,bad,recovered,overlap:summary(),text:document.body.innerText.slice(-600)};
},fs.readFileSync('wasm/tests/parity/refs-macos-x86_64/cube-voron.gcode','utf8')),null,2));
const fixture=fs.readFileSync('wasm/tests/parity/refs-macos-x86_64/cube-voron.gcode','utf8');const config=Object.fromEntries(fixture.split('; CONFIG_BLOCK_START')[1].split('; CONFIG_BLOCK_END')[0].split('\n').map(l=>/^; ([^=]+) = (.*)$/.exec(l)).filter(Boolean).map(([,k,v])=>[k.trim(),v]));
console.log('LARGE_PHASES',JSON.stringify(await page.evaluate(async text=>{const ex=await import('/assets/appStore-ByJFN79I.js');const ps=Object.values(ex).find(v=>typeof v?.getState==='function'&&'loadGcodeBytes' in v.getState());await window.__appStore.getState().openGcodeFile(new File([text],'large.gcode'));return {stats:ps.getState().stats,sample:window.samples.at(-1)}},detailedGcode({layers:120,segments:1024,config})),null,2));
}catch(e){console.error(e);process.exitCode=1}finally{await browser?.close();await new Promise(r=>server.close(r));console.log('CLEANUP browser and owned server closed')}
