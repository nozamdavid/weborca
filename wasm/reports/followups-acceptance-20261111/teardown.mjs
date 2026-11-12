import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '../../tests/node_modules/playwright/index.mjs';
import {selectAddedPrinter} from '../../tests/app/lib/printer.mjs';
const root=path.resolve('wasm/build/ui-review-followups-final-20261111');
const server=createServer(async(req,res)=>{try {let p=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));if((await stat(p)).isDirectory())p=path.join(p,'index.html');const data=await readFile(p);res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.json':'application/json','.css':'text/css','.svg':'image/svg+xml'})[path.extname(p)]||'application/octet-stream','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise((r,j)=>{server.once('error',j);server.listen(5068,'127.0.0.1',r)});
let browser;try{browser=await chromium.launch({headless:true,args:['--enable-features=SharedArrayBuffer']});const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>console.log('PAGEERROR',e.message));await page.goto('http://127.0.0.1:5068');await selectAddedPrinter(page,'Voron');await page.setInputFiles('#model-file',path.resolve('tests/data/20mm_cube.obj'));await page.waitForFunction(()=>window.__plateScene?.objectMeshes?.size>0);await page.waitForTimeout(1500);console.log('STATE',await page.evaluate(()=>({isolated:crossOriginIsolated,plate:window.__plateStore.getState(),sceneKeys:Object.keys(window.__plateScene),globals:Object.keys(window).filter(k=>k.startsWith('__'))})));console.log('BODY',await page.locator('body').innerText());await page.screenshot({path:'wasm/reports/followups-acceptance-20261111/prepare.png'});
await page.evaluate(()=>window.__oldScene=window.__plateScene);
await page.setViewportSize({width:390,height:844});
await page.waitForFunction(()=>window.__oldScene.isDestroyed&&window.__plateScene!==window.__oldScene);
console.log('TEARDOWN',await page.evaluate(()=>({destroyed:window.__oldScene.isDestroyed,frame:window.__oldScene.animationFrameId,labels:window.__oldScene.labelSprites.size,meshes:window.__plateScene.objectMeshes.size})));
await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>window.__plateScene.objectMeshes.size===1);console.log('REMOUNT PASS');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
