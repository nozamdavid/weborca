import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { detailedGcode } from "../tests/lib/preview-performance-fixtures.mjs";
import { chromium } from '../tests/node_modules/playwright/index.mjs';
const dir = path.resolve(process.env.PREVIEW_MODULE_DIR || 'wasm/build/review-preview-native/wasm/preview');
let fixture = await fs.readFile('wasm/tests/parity/refs-macos-x86_64/cube-voron.gcode', 'utf8');
if (process.env.PREVIEW_LAYERS) {
 const config = Object.fromEntries(fixture.split("; CONFIG_BLOCK_START")[1].split("; CONFIG_BLOCK_END")[0].split("\n").map(line => /^; ([^=]+) = (.*)$/.exec(line)).filter(Boolean).map(([,key,value]) => [key.trim(),value]));
 fixture = detailedGcode({layers:Number(process.env.PREVIEW_LAYERS),segments:1024,config});
}
const server = http.createServer(async (req, res) => {
 try {
  const file = new URL(req.url, 'http://localhost').pathname.slice(1).replace(/^preview\//, '');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : file ? 'text/javascript' : 'text/html');
  if (file === 'parse-worker.mjs') return res.end(`import create from "/preview/orca_preview.js"; onmessage = async ({data}) => { let m; try { m = await create({locateFile: path => path.endsWith('.wasm') ? '/preview/orca_preview.wasm' : path}); m.FS.writeFile("/input.gcode", data); postMessage({parsing:true}); const stats = JSON.parse(m.parseGcode("/input.gcode", "/worker.bin")); const bytes = m.FS.readFile("/worker.bin"); postMessage({stats,bytes}, [bytes.buffer]); } catch (e) { postMessage({error:String(e)}); } };`);
  if (!file) return res.end('<canvas id="canvas" width="800" height="600"></canvas>');
  if (!['orca_preview.js','orca_preview.wasm'].includes(file)) { res.statusCode = 404; return res.end(); }
  res.end(await fs.readFile(path.join(dir,file)));
 } catch (e) { res.statusCode = 500; res.end(String(e)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
 browser = await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
 const page = await browser.newPage();
 page.context().on("requestfailed", r => console.error("FAILED",r.url(),r.failure()));
 page.on("console", m => console.error(m.text()));
 page.on("pageerror", e => console.error(e));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const result = await page.evaluate(async ({fixture, realWorker}) => {
  const heartbeat = {ticks:0,maxGapMs:0};
  let lastTick = performance.now();
  const timer = setInterval(() => { const now = performance.now(); ++heartbeat.ticks; heartbeat.maxGapMs = Math.max(heartbeat.maxGapMs,now-lastTick); lastTick = now; }, 5);
  const workerResult = realWorker ? await new Promise((resolve,reject) => {
   const worker = new Worker("/parse-worker.mjs", {type:"module"});
   const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Worker parse timeout')); }, 30000);
   worker.onmessage = ({data}) => {
    if (data.parsing) { heartbeat.ticks = 0; heartbeat.maxGapMs = 0; lastTick = performance.now(); return; }
    clearTimeout(timeout); worker.terminate(); data.error ? reject(new Error(data.error)) : resolve(data);
   };
   worker.onerror = e => { clearTimeout(timeout); worker.terminate(); reject(new Error(e.message + " " + e.filename + ":" + e.lineno)); }; worker.postMessage(fixture);
  }) : null;
  clearInterval(timer);
  const {default:create} = await import('/orca_preview.js');
  const m = await create({canvas:document.querySelector('canvas')});
  m.FS.writeFile('/input.gcode',fixture);
  const parsed = JSON.parse(m.parseGcode('/input.gcode','/parsed.bin'));
  if (parsed.error) throw new Error(JSON.stringify(parsed));
  if (workerResult) m.FS.writeFile("/parsed.bin",workerResult.bytes);
  const p = new m.OrcaPreview();
  p.init('#canvas');
  let rendererGapMs = 0;
  const rendererStart = performance.now();
  const rendererHeartbeat = new Promise(resolve => setTimeout(() => { rendererGapMs = performance.now()-rendererStart; resolve(); },0));
  const loaded = JSON.parse(p.loadParsedGcode('/parsed.bin'));
  await rendererHeartbeat;
  const layers = p.getLayersZs(), bounds = p.getBounds?.();
  const legacy = JSON.parse(p.loadGcode('/input.gcode'));
  m.FS.writeFile('/bad.bin',m.FS.readFile('/parsed.bin').slice(0,30));
  const bad = JSON.parse(p.loadParsedGcode('/bad.bin'));
  const unchanged = p.getSliceStatistics();
  const unchangedLayers = p.getLayersZs();
  const unchangedMoves = Number(p.getMovesCount());
  p.render();
  p.delete();
  return {workerStats:workerResult?.stats ?? parsed,parsed,loaded,legacy,bad,unchanged:JSON.parse(unchanged),layers,bounds,unchangedLayers,unchangedMoves,heartbeat,rendererGapMs,packetBytes:m.FS.stat('/parsed.bin').size};
 },{fixture,realWorker:Boolean(process.env.TEST_REAL_WORKER)});
 const strip = obj => Object.fromEntries(Object.entries(obj).filter(([k])=>!k.endsWith('Ms')));
 assert.deepEqual(strip(result.workerStats),strip(result.legacy));
 assert.deepEqual(strip(result.parsed),strip(result.legacy));
 assert.deepEqual(strip(result.loaded),strip(result.legacy));
 assert(result.parsed.layers>0 && result.parsed.moves>0 && result.parsed.filamentMm>0 && result.parsed.features.length>0);
 assert(result.bad.error);
 assert.deepEqual(result.unchanged,result.legacy);
 assert.equal(result.unchangedLayers,result.layers);
 assert.equal(result.unchangedMoves,result.legacy.moves);
 if (process.env.TEST_REAL_WORKER) assert(result.heartbeat.ticks > 0, 'UI heartbeat must progress during worker parsing');
 console.log(JSON.stringify(result,null,2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
