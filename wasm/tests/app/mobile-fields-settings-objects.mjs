// Real field components and CSS; inert store/engine boundaries, no integrated build.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

const resolveDir = new URL('../../app', import.meta.url).pathname;
const stubs = {
  appStore: `import {create} from 'zustand';
    export const pendingOptionKey=(...parts)=>parts.join(':');
    export const useAppStore=create((set,get)=>({
      configDefs:{height:{type:'float',label:'Printable height for this printer with a long translated label',sidetext:'mm'},
        speed:{type:'float',label:'Filament ramming length with a long translated label',sidetext:'mm/s or %'},
        vendor:{type:'enum',label:'Filament vendor',enumValues:['generic','other']},
        precise:{type:'bool',label:'Precise Z height'},extruder:{type:'int',label:'Extruder'}},
      currentConfig:{height:'250',speed:'20',vendor:'generic',precise:'1'},
      presetConfig:{height:'200',speed:'10',vendor:'other',precise:'0'},
      rulesState:{fields:{}},settingsMode:'expert',pendingOptions:{},selectedFilaments:[],
      async applyOptionChange(key,value,kind){window.writes.push({key,value,kind});set({currentConfig:{...get().currentConfig,[key]:value}})},
      async resetOption(key,kind){window.resets.push({key,kind});set({currentConfig:{...get().currentConfig,[key]:get().presetConfig[key]}})}
    })); window.store=useAppStore;window.writes=[];window.resets=[];`,
  i18n: `export const useTranslation=()=>({t:key=>key});`,
  orcaEngine: `export const getOption=async()=>({});`,
};
const bundle=await build({stdin:{contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {SettingsGroup} from './src/settings/SettingsGroup';
  import {BedAssetsSettings} from './src/plate/BedAssetsSettings';
  import {ObjectSettingRow} from './src/objectlist/ObjectSettingRow';
  import {useAppStore} from './src/store/appStore';
  import './src/index.css';import './src/App.css';import './src/mobile/mobile.css';import './src/mobile/mobileShell.css';
  function Fixture(){const [values,setValues]=React.useState({height:'0.2',vendor:'generic',precise:'1',extruder:'0'});
    return <main className="orca-app"><header className="wm-header">Field regression fixture</header>
      <div className="settings-dialog-modal"><div className="settings-dialog-content">
        <SettingsGroup kind="printer" group={{title:'Basic information',lines:['height','speed','vendor','precise'].map(key=>({type:'option',key}))}}/>
        <SettingsGroup kind="printer" group={{title:'Second group',lines:[{type:'option',key:'height'}]}}/>
        <BedAssetsSettings/>
      </div></div>
      <div className="wm-sheet"><div id="object-settings-editor" style={{background:'var(--canvas-bg)'}}>
        {Object.entries(values).map(([key,value])=><ObjectSettingRow key={key} optionKey={key} value={value}
          onChange={value=>{window.objectWrites.push({key,value});setValues({...values,[key]:value})}}
          onRemove={()=>{window.removes.push(key);setValues(Object.fromEntries(Object.entries(values).filter(([name])=>name!==key)))}}/>)}
      </div></div>
      <div className="printer-sheet"><label className="wm-field"><span className="wm-field-label">Connection field</span><input/></label></div>
      <div className="mp-sheet"><label className="wm-field"><span className="wm-field-label">Preview field</span><input/></label></div>
    </main>}
  window.objectWrites=[];window.removes=[];createRoot(document.getElementById('root')).render(<Fixture/>);
`,loader:'tsx',resolveDir},bundle:true,write:false,outdir:'/virtual',entryNames:'ui',format:'esm',external:['/fonts/*','/icons/*'],
plugins:[{name:'inert-boundaries',setup(build){
  build.onResolve({filter:/\//},args=>{const name=args.path.split('/').at(-1);if(name in stubs)return {path:name,namespace:'fixture'};});
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],resolveDir}));
}}]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const server=createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/ui.js'?'text/javascript':req.url==='/ui.css'?'text/css':'text/html');
  res.end(req.url==='/ui.js'?js:req.url==='/ui.css'?css:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><style>body{overflow:auto}#root,.orca-app{height:auto!important;overflow:visible}.settings-dialog-modal{width:calc(100% - 44px);margin:0 22px;height:auto;flex-shrink:0}.settings-dialog-content{overflow:visible}.wm-sheet,.printer-sheet,.mp-sheet{position:static;padding:12px;flex-shrink:0;max-height:none;background:var(--surface-2)}</style><div id="root"></div><script type="module" src="/ui.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const theme of ['dark','light']) for(const width of [320,390]) for(const scale of [100,125]){
    await page.setViewportSize({width:1280,height:844});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.setViewportSize({width,height:844});
    await page.evaluate(scale=>{document.documentElement.style.fontSize=`${16*scale/100}px`;document.documentElement.style.setProperty('--ui-font-scale',scale/100);},scale);
    await page.locator('#override-input-height').waitFor();
    const metrics=await page.evaluate(()=>{
      const rect=e=>e.getBoundingClientRect();
      const selectors=['.settings-group .setting-row:not(:has(input[type=checkbox]))','.bed-assets-settings .wm-field','.object-setting-row.wm-field','.printer-sheet .wm-field','.mp-sheet .wm-field'];
      const fields=selectors.flatMap(selector=>[...document.querySelectorAll(selector)]).map(row=>{
        const label=row.querySelector('.setting-label,.wm-field-label');
        const control=label.nextElementSibling;
        const r=rect(row),l=rect(label),c=rect(control),style=getComputedStyle(label);
        const input=control.matches('input,button,select')?control:control.querySelector('input,button.mobile-select,select');
        return {text:label.textContent,width:l.width,rowWidth:r.width,controlWidth:c.width,inputWidth:input?rect(input).width:0,gap:c.top-l.bottom,font:style.fontSize,line:style.lineHeight,weight:style.fontWeight,color:style.color,overflow:row.scrollWidth-row.clientWidth};
      });
      const label=document.querySelector('.object-setting-label');let bg=label;
      while(bg&&getComputedStyle(bg).backgroundColor==='rgba(0, 0, 0, 0)')bg=bg.parentElement;
      const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
      const lum=s=>rgb(s).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
      const a=lum(getComputedStyle(label).color),b=lum(getComputedStyle(bg).backgroundColor);
      const bool=document.querySelector('.object-setting-row-bool');
      const settingsBool=document.querySelector('.settings-group .setting-row:has(input[type=checkbox])');
      return {fields,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),boolDirection:getComputedStyle(bool).flexDirection,
        settingsBoolLabel:rect(settingsBool.querySelector('label')).width,
        relatedGap:parseFloat(getComputedStyle(document.querySelector('.group-lines')).gap),
        groupGap:parseFloat(getComputedStyle(document.querySelector('.settings-dialog-content')).gap),
        overflow:document.documentElement.scrollWidth-innerWidth};
    });
    console.log(JSON.stringify({theme,width,scale,...metrics}));
    for(const f of metrics.fields){assert.ok(f.width>0,f.text);assert.ok(f.inputWidth>0,f.text+' visible control');assert.ok(Math.abs(f.width-f.rowWidth)<2,f.text+' full label');assert.ok(Math.abs(f.controlWidth-f.rowWidth)<2,f.text+' full row');assert.ok(Math.abs(f.gap-8)<1,f.text+' 8px gap');assert.equal(f.font,`${16*scale/100}px`);assert.equal(f.weight,'400');assert.ok(f.overflow<=1,f.text+' overflow');}
    assert.ok(metrics.contrast>=4.5);assert.equal(metrics.boolDirection,'row');assert.ok(metrics.settingsBoolLabel>0);assert.ok(metrics.overflow<=1);
    assert.equal(metrics.relatedGap,16);assert.equal(metrics.groupGap,24);
    for(const key of ['height','vendor','extruder']) assert.ok(await page.locator(`#override-input-${key}`).evaluate(input=>input.getBoundingClientRect().width>input.closest('.object-setting-controls').getBoundingClientRect().width/2),key+' flexible input');
    await page.screenshot({path:`wasm/build/tests-mobile-field-consistency/settings-objects/fix/screenshots/${theme}-${width}-${scale}.png`,fullPage:true});
    await page.locator('label[for="setting-input-height"]').first().click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'setting-input-height');
    await page.locator('#setting-input-height').first().fill('260');await page.locator('#setting-input-height').first().blur();
    assert.ok(await page.evaluate(()=>window.writes.some(w=>w.key==='height'&&w.value==='260'&&w.kind==='printer')));
    await page.locator('[data-testid="reset-btn-height"]').first().click();assert.ok(await page.evaluate(()=>window.resets.some(w=>w.key==='height'&&w.kind==='printer')));
    await page.locator('#setting-input-vendor').click();await page.getByRole('listbox').getByRole('option',{name:'other',exact:true}).click();
    assert.ok(await page.evaluate(()=>window.writes.some(w=>w.key==='vendor'&&w.value==='other')));
    await page.locator('label[for="override-input-height"]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'override-input-height');
    await page.locator('#override-input-height').fill('0.3');await page.locator('#override-input-vendor').selectOption('other');
    await page.locator('label[for="override-input-precise"]').click();
    assert.deepEqual(await page.evaluate(()=>window.objectWrites),[{key:'height',value:'0.3'},{key:'vendor',value:'other'},{key:'precise',value:'0'}]);
    await page.locator('#override-remove-vendor').click();assert.equal(await page.locator('#override-row-vendor').count(),0);
    assert.equal(await page.locator('#bed_custom_texture').evaluate(input=>input.labels[0].textContent.trim()),'Bed image');
  }
  for(const theme of ['dark','light']){
    await page.setViewportSize({width:1280,height:844});await page.reload();
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const compact=await page.locator('.settings-group .setting-row').first().evaluate(row=>({direction:getComputedStyle(row).flexDirection,font:getComputedStyle(row.querySelector('label')).fontSize}));
    assert.equal(compact.direction,'row');assert.equal(compact.font,'12px');
  }
  assert.deepEqual(errors,[]);console.log('PASS settings/objects field matrix and edit/reset/remove semantics; compact desktop');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
