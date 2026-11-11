// Full application UI only. No direct engine calls; isolated Helium profile.
import {chromium} from '/home/david/.t3/runtime/versions/0.1.2-nightly.20261021.3473/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const out = 'wasm/build/sample-parity-cause-20261107/'+(process.env.TRIAL||'ui-control');
fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync('/tmp/weborca-helium-benchmark-');
const browser = await chromium.launchPersistentContext(profile, {
  executablePath:'/opt/helium/helium',headless:false,
  env:{...process.env,DISPLAY:':0'},args:['--no-sandbox'],acceptDownloads:true,
  viewport:{width:1440,height:1000},ignoreHTTPSErrors:true
});
const page=browser.pages()[0];
await page.addInitScript(()=>{
 const NativeWorker=window.Worker;
 window.__benchmarkEvents=[];
 window.Worker=class extends NativeWorker {
  constructor(...args){super(...args);const methods=new Map();
   const send=this.postMessage.bind(this);this.postMessage=(data,...rest)=>{methods.set(data.id,data.method);window.__benchmarkEvents.push({at:performance.now(),direction:'request',method:data.method,id:data.id});return send(data,...rest)};
   this.addEventListener('message',({data})=>{const method=methods.get(data.id);const result=data.result;window.__benchmarkEvents.push({at:performance.now(),direction:'response',method,id:data.id,progress:data.progress,error:data.error,result:method==='slice'?{...result,gcode:undefined}:/^(getConfig|listPlates|getObjectTree|selectPresets)$/.test(method)?result:undefined});});
  }
 };
});
page.on('console',m=>fs.appendFileSync(`${out}/console.log`,`${Date.now()} ${m.type()} ${m.text()}\n`));
page.on('pageerror',m=>fs.appendFileSync(`${out}/errors.log`,String(m)+'\n'));
await page.goto(process.env.APP_URL||'https://server-1.barbel-hops.ts.net:5070');
await page.waitForFunction(()=>document.querySelector('#project-file-input') || [...document.querySelectorAll('button')].some(b=>b.textContent==='Login as admin'),{},{timeout:60000});
const secret=fs.readFileSync('/home/david/.config/weborca/alpha.env','utf8').match(/^ORCA_ALPHA_ADMIN_PASSWORD=(.*)$/m)?.[1]?.replace(/^['"]|['"]$/g,'');
const login=page.getByRole('button',{name:'Login as admin',exact:true});
if(await login.count()){await login.click();await page.getByLabel('Admin password',{exact:true}).waitFor();}
if(await page.getByLabel('Admin password',{exact:true}).count()){
 await page.getByLabel('Admin password',{exact:true}).fill(secret);
 await page.getByRole('button',{name:/Sign in/i}).click();
 await page.getByRole('button',{name:'Open slicer',exact:true}).or(page.getByRole('link',{name:'Open slicer',exact:true})).waitFor({timeout:60000});
}
await page.waitForTimeout(1500);
if(await page.getByRole('link',{name:'Open slicer',exact:true}).count())await page.getByRole('link',{name:'Open slicer',exact:true}).click();
else if(await page.getByRole('button',{name:'Open slicer',exact:true}).count())await page.getByRole('button',{name:'Open slicer',exact:true}).click();
await page.locator('#project-file-input').waitFor({state:'attached',timeout:90000});
fs.writeFileSync(`${out}/browser.json`,JSON.stringify({executable:'/opt/helium/helium',headed:true,url:page.url(),version:browser.browser().version(),...await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return {hardwareConcurrency:navigator.hardwareConcurrency,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null};})},null,2));
await page.locator('#process-select:not([disabled])').waitFor({timeout:90000});
if(process.env.ONE_THREAD){
 await page.keyboard.press('Control+p');
 await page.locator('#pref-slicing-threads').selectOption('1');
 await page.keyboard.press('Escape');
}
fs.writeFileSync(`${out}/initial-ui.txt`,await page.locator('body').innerText());
await page.screenshot({path:`${out}/initial.png`});
if(process.env.SAMPLE){
 await page.locator(process.env.SAMPLE.endsWith('.3mf')?'#project-file-input':'#model-file').setInputFiles(process.env.INPUT_PATH||'/mnt/appdata/workspace/OrcaSlicer/samples/'+process.env.SAMPLE);
 await page.waitForFunction(()=>window.__benchmarkEvents.some(e=>e.method==='getObjectTree'&&e.result?.objects?.length),{},{timeout:90000});
 await page.waitForTimeout(1000);
 const keepOriginal=page.getByRole('button',{name:'Keep original',exact:true});
 if(/Tree|lily/.test(process.env.SAMPLE))await keepOriginal.waitFor({timeout:60000});
 if(await keepOriginal.isVisible())await keepOriginal.click();
 fs.writeFileSync(`${out}/import-ui.txt`,await page.locator('body').innerText());
 console.log('Imported',process.env.SAMPLE);
 await page.screenshot({path:`${out}/import.png`});
 if(process.env.SAMPLE.endsWith('.stl')){
  await page.locator('#process-select').selectOption({label:'0.20mm Standard @Voron'});
  await page.locator('select[aria-label*="filament" i]').first().selectOption({label:'Generic PLA @System'});
  await page.waitForTimeout(1500);
 }
 const stem=process.env.SAMPLE.replace(/[^a-z0-9]/gi,'_');
 fs.writeFileSync(`${out}/${stem}-import-events.json`,JSON.stringify(await page.evaluate(()=>window.__benchmarkEvents),null,2));
 await page.getByRole('button',{name:'File',exact:true}).click();
 const projectDownload=page.waitForEvent('download');
 await page.getByRole('menuitem',{name:'Save project Ctrl+S',exact:true}).click();
 await (await projectDownload).saveAs(`${out}/input.3mf`);
 await page.getByRole('button',{name:'Slice Plate 1',exact:true}).click({timeout:60000});
 const observation=setInterval(async()=>{
  try {fs.writeFileSync(`${out}/${stem}-pending.txt`,await page.locator('body').innerText());fs.writeFileSync(`${out}/${stem}-pending-events.json`,JSON.stringify(await page.evaluate(()=>window.__benchmarkEvents),null,2));}catch{}
 },10000);
 await page.waitForFunction(()=>window.__benchmarkEvents.some(e=>e.method==='slice'&&e.direction==='response'&&!e.progress),{},{timeout:1200000});
 clearInterval(observation);
 fs.writeFileSync(`${out}/${stem}-slice-events.json`,JSON.stringify(await page.evaluate(()=>window.__benchmarkEvents),null,2));
 fs.writeFileSync(`${out}/${stem}-sliced-ui.txt`,await page.locator('body').innerText());
 const failure=await page.evaluate(()=>window.__benchmarkEvents.find(e=>e.method==='slice'&&e.error));
 if(failure){console.log('Slice failed',JSON.stringify(failure));await browser.close();fs.rmSync(profile,{recursive:true,force:true});process.exit(0);}
 await page.getByRole('button',{name:'File',exact:true}).click();
 const download=page.waitForEvent('download');
 await page.getByRole('menuitem',{name:/^Export G-code\s*Ctrl/}).click();
 await (await download).saveAs(`${out}/${stem}.gcode`);
 console.log('Exported',process.env.SAMPLE);
}
await browser.close();
fs.rmSync(profile,{recursive:true,force:true});
