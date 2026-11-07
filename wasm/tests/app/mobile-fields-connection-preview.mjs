// Real field/provider/Preview/Device components; synthetic stores and service seams.
// Private components are exported in memory only. No integrated UI build or services.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

const resolveDir = new URL('../../app', import.meta.url).pathname;
const stubs = {
  i18n: `export const useTranslation=()=>({t:s=>window.__long && ['Email','Bottom visible layer'].includes(s)?s+' — Etiqueta larga para comprobar el ajuste de texto del campo':s});`,
  appStore: `export const useAppStore=selector=>selector({selectedFilaments:[],modelFile:null});`,
  prefsStore: `export const usePrefsStore=selector=>selector({display:{previewLowQuality:false},setDisplayPref(){}});`,
  previewStore: `export const usePreviewStore=()=>({minLayer:0,maxLayer:9,layersCount:10,viewType:'FeatureType',legend:{title:'Legend',items:[],options:[]},setLayerRangeAction:(...v)=>window.__range=v,setViewTypeAction:v=>window.__scheme=v,resetLayersAction(){},toggleGcodeWindowAction(){}});`,
  prusaConnect: `export const startPrusaConnectLogin=async()=>{window.__calls.push(['start']);return {state:'fixture-state'}};
    export const submitPrusaConnectLogin=async(target,state,input)=>{window.__calls.push(['prusa',target,state,input]);if('code' in input)throw Error('synthetic stop');return {mfaRequired:true}};
    export const completePrusaConnectLogin=()=>{throw Error('unused')};export const cancelPrusaConnectLogin=()=>{};`,
  crealityCloud: `export const loginCrealityCloudPassword=async(...args)=>{window.__calls.push(['creality',...args.slice(0,3)]);throw Error('synthetic stop')};
    export const fetchCrealityCloudDevices=()=>{throw Error('unused')};export const isCrealityQrExpired=()=>false;
    export const pollCrealityCloudQr=()=>{throw Error('unused')};export const requestCrealityCloudQr=()=>{throw Error('unused')};`,
  cloudSessionReuse: `export const validateCloudSession=()=>{throw Error('unused')};`,
  connectionStore: `export const usePrinterConnectionStore={getState:()=>({})};`,
  session: `export const getCurrentPrinterApi=()=>{throw Error('hardware forbidden')};`,
};
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
  import {Field} from './src/printers/PrinterConnectionDialog';import {PrusaConnectLogin} from './src/printers/PrusaConnectLogin';
  import {CrealityCloudLogin} from './src/printers/CrealityCloudLogin';import {MobilePreviewControls} from './src/preview/MobilePreview';
  import {ControlsCard} from './src/printers/DevicePanel';import {MobileInput} from './src/mobile/MobileInput';
  import './src/index.css';import './src/components/dialog.css';import './src/mobile/mobile.css';import './src/mobile/mobileShell.css';import './src/mobile/mobileControls.css';
  const root=createRoot(document.getElementById('root'));window.__calls=[];
  window.__show=kind=>{window.__kind=kind;root.render(<div className="orca-app"><div className="wm-header"/><div className={kind==='creality'?'dialog-layer':undefined}><main className={'printer-sheet'+(kind==='creality'?' ds-dialog':'')} style={{padding:16}} key={kind}>
    {kind==='prusa'?<div className="printer-connection-fields"><Field label="Name"><MobileInput value="Fixture" readOnly/></Field><PrusaConnectLogin gatewayTarget={{print_host:'connect.prusa3d.com'}} onSelectPrinter={()=>{}}/></div>:
    kind==='creality'?<CrealityCloudLogin onSelectDevice={()=>{}}/>:
    kind==='common'?<div className="printer-connection-fields"><Field label="Hostname, IP or URL"><MobileInput id="host"/></Field><div className="printer-field-pair"><Field label="Password"><MobileInput id="bambu-password"/></Field><Field label="Verification code"><MobileInput id="verification"/></Field></div></div>:
    kind==='preview'?<MobilePreviewControls resetCamera={()=>{}}/>:
    <div className="device-panel"><ControlsCard printer={{host_type:'moonraker'}} state={null} status="offline"/></div>}
  </main></div></div>)};window.__show('prusa');`,loader:'tsx',resolveDir},bundle:true,write:false,outdir:'/virtual',platform:'browser',format:'esm',external:['/fonts/*','/icons/*'],
  plugins:[{name:'bounded-components',setup(b){
    b.onResolve({filter:/\//},args=>{const name=args.path.split('/').at(-1);if(name in stubs)return {path:name,namespace:'fixture'};});
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],resolveDir}));
    b.onLoad({filter:/(PrinterConnectionDialog|MobilePreview|DevicePanel)\.tsx$/},async args=>{
      const source=await readFile(args.path,'utf8');let contents;
      if(args.path.endsWith('PrinterConnectionDialog.tsx'))contents=`import React from 'react';import {useTranslation} from '../i18n';${source.slice(source.indexOf('const Field:'),source.indexOf('/** Add, edit'))}export {Field};`;
      else if(args.path.endsWith('MobilePreview.tsx'))contents=`import React from 'react';import {useTranslation} from '../i18n';import {usePreviewStore} from './previewStore';import {usePrefsStore} from '../prefs/prefsStore';import {useAppStore} from '../store/appStore';import './MobilePreview.css';const formatPrintTime=String;${source.slice(source.indexOf('const schemes:'),source.indexOf('export function MobilePreview('))}export {MobilePreviewControls};`;
      else contents=`import React,{useState} from 'react';import {useTranslation} from '../i18n';import {HOST_CAPABILITIES} from './types';import {getCurrentPrinterApi} from './session';import {confirmDialog} from '../components/ModalBackdrop';import './DevicePanel.css';${source.slice(source.indexOf('const ControlsCard:'),source.indexOf('const StatusColumn:'))}export {ControlsCard};`;
      return {contents,loader:'tsx',resolveDir:args.path.slice(0,args.path.lastIndexOf('/'))};
    });
  }}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const server=createServer((req,res)=>{
  if(req.url==='/ui.js'){res.setHeader('Content-Type','text/javascript');res.end(js);}
  else if(req.url==='/ui.css'){res.setHeader('Content-Type','text/css');res.end(css);}
  else if(req.url.startsWith('/fonts/')||req.url.startsWith('/icons/')){res.writeHead(204);res.end();}
  else res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><style>body{overflow:auto}#root{height:auto}</style><div id="root"></div><script type="module" src="/ui.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin&&route.request().method()==='GET'?route.continue():route.abort());
  await page.goto(origin);await page.waitForFunction(()=>!!window.__show);
  const show=async kind=>{await page.evaluate(kind=>window.__show(kind),kind);await page.waitForTimeout(30);};
  async function fields(kind,width,scale,theme) {
    const metrics=await page.locator('label.wm-field').evaluateAll(nodes=>nodes.map(node=>{
      const label=node.querySelector('.wm-field-label'),control=node.querySelector('input,select,button');
      const a=label.getBoundingClientRect(),b=control.getBoundingClientRect(),r=node.getBoundingClientRect(),s=getComputedStyle(label);
      return {text:label.textContent,font:s.fontSize,weight:s.fontWeight,color:s.color,line:s.lineHeight,gap:b.top-a.bottom,width:b.width,row:r.width,height:b.height,wrap:a.height>parseFloat(s.lineHeight)*1.5};
    }));
    assert.ok(metrics.length);for(const m of metrics){assert.equal(m.font,`${16*scale}px`,JSON.stringify(m));assert.equal(m.weight,'400');assert.equal(m.color,'rgb(191, 192, 197)');assert.equal(m.line,`${24*scale}px`);assert.ok(Math.abs(m.gap-8)<.1,JSON.stringify(m));assert.ok(Math.abs(m.width-m.row)<.1,JSON.stringify(m));assert.ok(m.height>=48);}
    if(kind==='prusa'||kind==='preview')assert.ok(metrics.some(m=>m.wrap),'long label wraps');
    const label=page.locator('label.wm-field').filter({has:page.locator('input')}).first();
    if(await label.count()){await label.locator('.wm-field-label').click();assert.ok(await label.locator('input').evaluate(n=>document.activeElement===n));}
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'document fits');
    console.log('FIELDS',kind,width,scale,theme,JSON.stringify(metrics));
  }
  for(const theme of ['dark','light'])for(const width of [320,390])for(const scale of [1,1.25]){
    await page.setViewportSize({width:1280,height:844});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=`${16*scale}px`;document.documentElement.style.setProperty('--ui-font-scale',String(scale));window.__long=true;},{theme,scale});
    await page.setViewportSize({width,height:844});
    for(const kind of ['prusa','creality','common','preview','device']){
      await show(kind);if(kind==='creality')await page.getByRole('button',{name:'Account / Password',exact:true}).click();
      if(kind!=='device')await fields(kind,width,scale,theme);
      if(kind==='common'){
        assert.equal(await page.locator('.printer-connection-fields').evaluate(n=>parseFloat(getComputedStyle(n).gap)),16);
        assert.equal(await page.locator('.printer-field-pair').evaluate(n=>parseFloat(getComputedStyle(n).gap)),16);
      }
      if(kind==='prusa'){
        assert.equal(await page.locator('.printer-provider-fields').evaluate(n=>parseFloat(getComputedStyle(n).gap)),16);
        assert.equal(await page.locator('.prusa-connect-login').evaluate(n=>{const previous=n.previousElementSibling;return n.getBoundingClientRect().top-previous.getBoundingClientRect().bottom;}),24);
      }
      if(kind==='preview'){
        assert.equal(await page.locator('.mp-field-group').evaluate(n=>parseFloat(getComputedStyle(n).gap)),16);
        assert.equal(await page.locator('.mp-sheet').evaluate(n=>parseFloat(getComputedStyle(n).gap)),24);
        await page.locator('.wm-field input').first().fill('3');assert.deepEqual(await page.evaluate(()=>window.__range),[2,9]);
        await page.locator('.wm-field select').selectOption('Speed');assert.equal(await page.evaluate(()=>window.__scheme),'Speed');
      }
      if(kind==='device'){
        const rows=await page.locator('.device-temp-row,.device-extrude-row').evaluateAll(nodes=>nodes.map(n=>{const label=n.querySelector('.control-label'),input=n.querySelector('input'),s=getComputedStyle(label),a=label.getBoundingClientRect(),b=input.getBoundingClientRect();return {direction:getComputedStyle(n).flexDirection,font:s.fontSize,weight:s.fontWeight,color:s.color,horizontal:Math.abs(a.top+a.height/2-b.top-b.height/2)<1};}));
        assert.ok(rows.length>=3);for(const row of rows){assert.equal(row.direction,'row');assert.equal(row.font,`${16*scale}px`);assert.equal(row.weight,'400');assert.equal(row.color,'rgb(191, 192, 197)');assert.ok(row.horizontal,JSON.stringify(row));}
        assert.equal(await page.locator('.device-jog-xy .jog-row').count(),3);
      }
      assert.deepEqual(await page.evaluate(()=>window.__calls),[],'presentation makes no service calls');
      if(process.env.EVIDENCE_DIR)await page.screenshot({path:`${process.env.EVIDENCE_DIR}/${kind}-${theme}-${width}-${scale}.png`,fullPage:true});
    }
  }
  await page.setViewportSize({width:1280,height:844});
  await page.evaluate(()=>{window.__long=false;document.documentElement.style.fontSize='16px';document.documentElement.style.setProperty('--ui-font-scale','1');});
  await show('common');
  assert.equal(await page.locator('.printer-connection-fields').evaluate(n=>parseFloat(getComputedStyle(n).gap)),12);
  assert.equal(await page.locator('.printer-field-pair').evaluate(n=>getComputedStyle(n).flexDirection),'row');
  assert.equal(await page.locator('.printer-field-pair').evaluate(n=>parseFloat(getComputedStyle(n).gap)),8);
  await show('creality');await page.getByRole('button',{name:'Account / Password',exact:true}).click();
  assert.equal(await page.locator('.cc-region').evaluate(n=>getComputedStyle(n).flexDirection),'row');
  assert.equal(await page.locator('.cc-field .wm-field-label').first().evaluate(n=>getComputedStyle(n).fontSize),'12px');
  for(const selector of ['.cc-region select','#cc-account','#cc-password']) {
    assert.equal(await page.locator(selector).evaluate(n=>getComputedStyle(n).fontSize),'13px',selector);
  }
  assert.equal(await page.locator('.cc-field').first().evaluate(n=>parseFloat(getComputedStyle(n).gap)),4);
  await page.setViewportSize({width:390,height:844});
  await show('prusa');await page.locator('#pc-prusa-email').fill('fixture@example.invalid');await page.locator('#pc-prusa-password').fill('fixture-password');await page.locator('#pc-prusa-login-start').click();
  await page.locator('#pc-prusa-otp').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__calls),[['start'],['prusa',{print_host:'connect.prusa3d.com'},'fixture-state',{email:'fixture@example.invalid',password:'fixture-password'}]]);
  for(const theme of ['dark','light'])for(const width of [320,390])for(const scale of [1,1.25]){
    await page.setViewportSize({width,height:844});await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=`${16*scale}px`;document.documentElement.style.setProperty('--ui-font-scale',String(scale));},{theme,scale});await fields('otp',width,scale,theme);
  }
  await page.locator('#pc-prusa-otp').fill('123456');await page.locator('#pc-prusa-login-start').click();await page.locator('#pc-prusa-email').waitFor();
  assert.deepEqual((await page.evaluate(()=>window.__calls)).at(-1),['prusa',{print_host:'connect.prusa3d.com'},'fixture-state',{code:'123456'}]);
  await show('creality');await page.getByRole('button',{name:'Account / Password',exact:true}).click();await page.locator('#cc-account').fill('fixture@example.invalid');await page.locator('#cc-password').fill('fixture-password');await page.locator('#cc-password-login').click();await page.locator('#cc-error').waitFor();
  assert.deepEqual((await page.evaluate(()=>window.__calls)).at(-1),['creality','fixture@example.invalid','fixture-password',{region:'global'}]);
  assert.deepEqual(errors,[]);console.log('PASS real component matrix, OTP and stubbed submit payloads; no upstream/hardware');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
