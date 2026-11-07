// Real Snapmaker login/client/store and shared controls; synthetic normalized HTTP only.
// This component fixture deliberately avoids the integrated engine/app build.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';
await mkdir(new URL('../../build/tests-snapmaker-cloud/browser/fix',import.meta.url),{recursive:true});
const resolveDir=new URL('../../app',import.meta.url).pathname;
const bundle=await build({stdin:{loader:'tsx',resolveDir,contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {SnapmakerCloudLogin} from './src/printers/SnapmakerCloudLogin';import {usePrinterConnectionStore} from './src/printers/connectionStore';
import './src/index.css';import './src/App.css';import './src/components/dialog.css';import './src/mobile/mobile.css';import './src/mobile/mobileShell.css';import './src/mobile/mobileControls.css';
const root=createRoot(document.getElementById('root'));let generation=0;window.__selected=null;window.__store=usePrinterConnectionStore;
const target={id:'draft',name:'',host_type:'snapmaker-cloud',print_host:'id.snapmaker.com',cloud_region:'global',use_gateway:true};
function Fixture({initial}){const [p,setP]=useState(target);return <div className="orca-app dialog-layer"><main className="ds-dialog printer-sheet fixture"><div className="printer-connection-fields"><label className="wm-field"><span className="wm-field-label">Name</span><input className="ds-input" value="Fixture" readOnly/></label>
<SnapmakerCloudLogin target={p} initialSession={initial} selectedDeviceId={p.cloud_device_id} onCredentials={s=>setP(d=>({...d,printhost_apikey:s.printhost_apikey,cloud_refresh_token:s.cloud_refresh_token}))}
onValidatedDevices={()=>{}} onSelectDevice={(d,s)=>{window.__selected=d.deviceId;setP({...s,cloud_device_id:d.deviceId});}}/></div></main></div>}
window.__show=initial=>flushSync(()=>root.render(<Fixture key={++generation} initial={initial}/>));window.__close=()=>flushSync(()=>root.render(null));window.__show();`},
  bundle:true,write:false,outdir:'/virtual',format:'esm',platform:'browser',external:['/fonts/*','/icons/*'],
  plugins:[{name:'locale-only',setup(b){b.onResolve({filter:/\/i18n$/},()=>({path:'locale',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const translate=s=>s;export const useTranslation=()=>({t:translate});'}));}}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const server=createServer((req,res)=>{
  if(req.url==='/ui.js'){res.setHeader('Content-Type','text/javascript');res.end(js);}
  else if(req.url==='/ui.css'){res.setHeader('Content-Type','text/css');res.end(css+'\nbody{overflow:auto}#root{height:auto}.fixture{position:relative;margin:0;padding:16px;width:100%;max-width:560px}');}
  else if(req.url.startsWith('/icons/')||req.url.startsWith('/fonts/')){res.writeHead(204);res.end();}
  else res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><div id="root"></div><script type="module" src="/ui.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const requests=[];let listFailure=false, delayed, delayLogin=false;
await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin)return route.abort();
  if(!url.pathname.startsWith('/_printer/'))return route.continue();
  const request=route.request();requests.push({path:url.pathname,body:request.postDataJSON(),headers:request.headers()});
  const fulfill=(json,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)}).catch(()=>{});
  if(url.pathname.endsWith('/auth/token')){
    if(delayLogin)await new Promise(r=>delayed=r);
    return fulfill({code:200,data:{access_token:'fixture-access',refresh_token:'fixture-refresh'}});
  }
  if(url.pathname.endsWith('/auth/send-code'))return fulfill({code:200});
  if(url.pathname.endsWith('/account'))return fulfill({code:200,data:{id:'fixture-account'}});
  if(url.pathname.endsWith('/devices'))return fulfill({code:0,data:[{deviceId:'D',name:'Fixture U1',online:1}]},listFailure?503:200);
  return route.abort();
});
const show=async()=>{await page.evaluate(()=>window.__show());await page.locator('#sc-email').waitFor();};
const select=async(id,value)=>{
  if(await page.locator(id).evaluate(n=>n.tagName==='SELECT'))await page.selectOption(id,value);
  else {await page.locator(id).click();await page.locator(`[role=option][data-value="${value}"]`).click();}
};
const fillLogin=async()=>{await page.locator('#sc-email').fill('fixture@example.invalid');await page.locator('#sc-secret').fill('synthetic-password');assert.ok(await page.locator('#sc-login').isDisabled());await page.locator('#sc-consent').check();};
try{
  await page.goto(origin);await page.locator('#sc-email').waitFor();
  for(const theme of ['dark','light'])for(const width of [320,390])for(const scale of [1,1.25]){
    await page.setViewportSize({width,height:1100});
    await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=16*scale+'px';document.documentElement.style.setProperty('--ui-font-scale',String(scale));},{theme,scale});
    await show();
    const metrics=await page.locator('.snapmaker-field').evaluateAll(nodes=>nodes.map(n=>{
      const a=n.querySelector('.wm-field-label'),b=n.querySelector('input,select,button'),x=a.getBoundingClientRect(),y=b.getBoundingClientRect(),s=getComputedStyle(a);
      return {gap:y.top-x.bottom,width:y.width,row:n.getBoundingClientRect().width,height:y.height,font:s.fontSize,weight:s.fontWeight,color:s.color,control:getComputedStyle(b).color};
    }));
    for(const m of metrics){assert.equal(m.gap,8);assert.equal(m.width,m.row);assert.ok(m.height>=48,JSON.stringify(m));assert.equal(m.font,`${16*scale}px`);assert.equal(m.weight,'400');}
    const gaps=await page.evaluate(()=>{const n=document.querySelector('.snapmaker-cloud-login');return {boundary:n.getBoundingClientRect().top-n.previousElementSibling.getBoundingClientRect().bottom,related:getComputedStyle(n.querySelector('.printer-provider-fields')).gap};});
    assert.equal(gaps.boundary,24);assert.equal(gaps.related,'16px');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('label').filter({has:page.locator('#sc-email')}).locator('.wm-field-label').click();assert.ok(await page.locator('#sc-email').evaluate(n=>n===document.activeElement));
    console.log('layout',theme,width,scale,JSON.stringify(metrics));
    if(width===390 && scale===1.25)await page.locator('.fixture').screenshot({path:new URL(`../../build/tests-snapmaker-cloud/browser/fix/component-mobile-${theme}.png`,import.meta.url).pathname,animations:'disabled'});
  }
  await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>{document.documentElement.style.fontSize='16px';document.documentElement.style.setProperty('--ui-font-scale','1');});await show();
  for(const theme of ['dark','light']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const desktop=await page.locator('#sc-email').evaluate(n=>({height:n.getBoundingClientRect().height,font:getComputedStyle(n).fontSize,label:getComputedStyle(n.previousElementSibling).fontSize}));
    console.log('desktop',theme,JSON.stringify(desktop));
    assert.ok(desktop.height<48);assert.equal(desktop.font,'13px');assert.equal(desktop.label,'12px');
    await page.locator('.fixture').screenshot({path:new URL(`../../build/tests-snapmaker-cloud/browser/fix/component-desktop-${theme}.png`,import.meta.url).pathname,animations:'disabled'});
  }
  assert.ok(await page.locator('#sc-login').isDisabled());
  await fillLogin();listFailure=true;await page.locator('#sc-login').click();await page.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(()=>window.__store.getState().snapmakerSessions.length),1);
  assert.ok(!await page.evaluate(()=>localStorage.getItem('orca-printers').includes('synthetic-password')));
  assert.equal(await page.locator('#sc-secret').inputValue(),'');
  listFailure=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('#sc-device').waitFor();await select('#sc-device','D');
  assert.equal(await page.evaluate(()=>window.__selected),'D');assert.deepEqual(await page.evaluate(()=>window.__store.getState().printers),[]);
  await show();await select('#sc-mode','code');await page.locator('#sc-email').fill('fixture@example.invalid');await page.locator('#sc-consent').check();await page.locator('#sc-send-code').click();
  await page.getByRole('status').waitFor();assert.deepEqual(requests.at(-1).body,{account:'fixture@example.invalid'});
  await page.locator('#sc-secret').fill('synthetic-code');await page.locator('#sc-login').click();await page.locator('#sc-device').waitFor();
  assert.deepEqual(requests.findLast(r=>r.path.endsWith('/auth/token')).body,{email:'fixture@example.invalid',code:'synthetic-code'});
  await show();await page.setViewportSize({width:390,height:1100});await page.locator('#sc-mode').click();await page.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await page.locator('#sc-mode').getAttribute('aria-expanded'),'false');
  await fillLogin();await page.evaluate(()=>window.__store.setState({snapmakerSessions:[]}));delayLogin=true;await page.locator('#sc-login').click();await page.waitForFunction(()=>document.querySelector('#sc-login').disabled);
  while(!delayed)await new Promise(r=>setTimeout(r,10));await page.evaluate(()=>window.__close());delayed();await page.waitForTimeout(50);
  assert.deepEqual(await page.evaluate(()=>window.__store.getState().snapmakerSessions),[]);assert.deepEqual(errors,[]);
  assert.ok(requests.every(r=>!r.headers.cookie));
  await show();
  await page.locator('.fixture').screenshot({path:new URL('../../build/tests-snapmaker-cloud/browser/fix/component-mobile.png',import.meta.url).pathname,animations:'disabled'});
  console.log('Snapmaker component checks passed: password/code, consent, retry, select, close/unmount and layout.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
