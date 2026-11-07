import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from '../../build/web-smoke/node_modules/playwright/index.mjs';
import path from 'node:path';
import { existsSync } from 'node:fs';

const app = new URL('../../app/', import.meta.url).pathname;
const source = process.env.PRESET_SOURCE_ROOT;
const stubs = {
  appStore: `import {useSyncExternalStore} from 'react';
    let state={};const listeners=new Set();
    export const useAppStore=Object.assign(()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state),{
      getState:()=>state,setState:update=>{state={...state,...(typeof update==='function'?update(state):update)};listeners.forEach(fn=>fn())}});`,
  i18n: `export const useTranslation=()=>({t:(key,args)=>key.replace(/{{(.*?)}}/g,(_,k)=>args?.[k]??k)});`,
  Dialog: `import React from 'react';export const Dialog=({children})=><div role="dialog">{children}</div>;`,
  systemProfiles: `export const systemProfiles=async()=>[];`,
  orcaEngine: `export const getEngine=async()=>({call:async(method,args)=>{
    if(method==='getConfig')return args.keys?Object.fromEntries(args.keys.map(k=>[k,window.slotConfig[k]])):window.slotConfig;
    if(method==='getOption')return {value:args.serializedValue??window.slotConfig[args.key]};
    throw Error(method)}});export const getCompatiblePresets=async()=>({compatibleUserPresets:[]});`,
  presetArchive: `export const parsePresetsFromUniversalInput=()=>{};export const exportDesktopPrinterBundle=()=>{};export const exportDesktopFilamentBundle=()=>{};export const exportDesktopPresetsZip=()=>{};`,
};
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
  import {useAppStore} from './src/store/appStore';
  import {PresetInheritance} from './src/presets/PresetInheritance';
  import {SavePresetDialog} from './src/settings/SavePresetDialog';
  import {saveCurrentUserPresetHelper} from './src/presets/presetActions';
  import {effectivePreset} from './src/presets/effectivePreset';
  import './src/index.css';
  const root=createRoot(document.getElementById('root'));
  Object.assign(window,{store:useAppStore,effectivePreset,
    renderInheritance:(kind,name)=>root.render(<div className="ds-dialog" style={{width:'min(580px,92vw)'}}><PresetInheritance kind={kind} name={name}/></div>),
    renderSave:()=>root.render(<SavePresetDialog/>),
    save:(kind,name)=>saveCurrentUserPresetHelper(useAppStore.getState,useAppStore.setState,kind,name)});`,resolveDir:app,loader:'tsx'},
  bundle:true,write:false,outdir:'/virtual',nodePaths:[path.join(app,'node_modules')],platform:'browser',format:'iife',plugins:[{name:'isolated-presets',setup(b){
    b.onResolve({filter:/.*/},args=>{
      const name=args.path.split('/').at(-1)?.replace(/\.tsx?$/,'');
      if(name in stubs)return {path:name,namespace:'fixture'};
      if(source&&['PresetInheritance','SavePresetDialog','presetActions','effectivePreset'].includes(name))return {path:path.resolve(source, args.path.includes('settings')?'wasm/app/src/settings': 'wasm/app/src/presets',name+(name==='PresetInheritance'||name==='SavePresetDialog'?'.tsx':'.ts'))};
      if(source&&args.resolveDir.startsWith(source)&&args.path.startsWith('.')){
        const shared=path.resolve(args.resolveDir.replace(source,new URL('../../..',import.meta.url).pathname),args.path);
        for(const suffix of ['','.ts','.tsx'])if(existsSync(shared+suffix))return {path:shared+suffix};
      }
    });
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:app}));
  }}]});

for (const kind of ['process','filament','printer']) for (const scenario of ['inheritance','layout','save dialog','saved values']) {
  test(`${kind}: ${scenario}`, async () => {
    const browser=await chromium.launch({headless:true});
    try {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      await page.route('**/*',route=>route.abort());
      await page.setContent('<!doctype html><html data-theme="dark"><body><div id="root"></div></body></html>');
      await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.css')).text});
      await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
      await page.evaluate(kind=>{
        const memory=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)}});
        Object.defineProperty(navigator,'locks',{value:{request:async(_name,work)=>work()}});
        const users=[
          {kind,name:'Parent',inherits:'System',values:{inherited:'parent',shadow:'parent'}},
          {kind,name:'Child',inherits:'Parent',values:{shadow:'child'},cloudRef:{accountId:'identity',id:'same'}},
          {kind,name:'Descendant',inherits:'Child',values:{}},
          {kind,name:'Other parent',inherits:'Other system',values:{inherited:'new parent'}},
        ];
        localStorage.setItem('orca_user_presets',JSON.stringify(users));
        window.slotConfig={inherited:'parent',shadow:'edited',manual:'edit'};
        window.store.setState({userPresets:users,selectedVendor:'',isSelectingPreset:false,
          processes:[{name:'System'},{name:'Other system'}],filaments:[{name:'System'},{name:'Other system'}],printers:[{name:'System'},{name:'Other system'}],
          selectedProcess:'Child',selectedPrinter:'Child',selectedFilament:'Sibling',selectedFilaments:['Sibling','Child'],activeFilamentSlot:1,
          activeUserPreset:{process:'Child',printer:'Child',filament:null},presetConfig:{inherited:'parent',shadow:'child',manual:'default'},
          processOverrides:{inherited:'parent',shadow:'edited',manual:'edit'},printerOverrides:{inherited:'parent',shadow:'edited',manual:'edit'},filamentOverrides:{shadow:'edited',manual:'edit',project:'exclude'},
          closeSavePresetDialog:()=>window.store.setState({savePresetDialogTarget:null}),
          saveCurrentUserPreset:window.save,
          selectUserPreset:async(kind,name,slot)=>{window.applied=window.effectivePreset(kind,name,window.store.getState().userPresets);window.selectedSlot=slot;},
        });
        window.renderInheritance(kind,'Child');
      },kind);
      await page.waitForSelector('#preset-parent');
      if(scenario==='layout'){
        await page.evaluate(kind=>{
          const key=kind==='process'?'processes':kind==='printer'?'printers':'filaments';
          window.store.setState({[key]:[{name:'System'},{name:'A very long manufacturer and printer preset name with a nozzle and material qualification repeated for overflow coverage'}]});
        },kind);
        for(const width of [390,1280])for(const theme of ['dark','light']){
          await page.setViewportSize({width,height:844});
          await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.style.setProperty('--ui-font-scale','1.25')},theme);
          if(process.env.PRESET_SCREENSHOTS)await page.screenshot({animations:'disabled',path:path.join(process.env.PRESET_SCREENSHOTS,`${kind}-${width}-${theme}.png`)});
          const geometry=await page.locator('#preset-inheritance').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,select:el.querySelector('select').getBoundingClientRect().width}));
          console.log(`${kind} ${width} ${theme} layout ${JSON.stringify(geometry)}`);
          assert.ok(geometry.scroll<=geometry.client+1,'inheritance must wrap long content and fit the dialog');
        }
        return;
      }
      if(scenario==='inheritance'){
      const options=await page.locator('#preset-parent option').evaluateAll(nodes=>nodes.map(n=>n.value));
      assert.ok(options.includes('Other parent'),'custom bases must be selectable');
      assert.ok(!options.includes('Child')&&!options.includes('Descendant'),'cycles must be excluded');
      await page.selectOption('#preset-parent','Other parent');
      await page.waitForFunction(()=>window.store.getState().userPresets.find(p=>p.name==='Child').inherits==='Other parent');
      assert.deepEqual(await page.evaluate(()=>window.applied),{preset:'Other system',values:{inherited:'new parent',shadow:'child'}});
      await page.evaluate(kind=>{
        const s=window.store.getState();
        window.store.setState({activeUserPreset:{...s.activeUserPreset,[kind]:'Descendant'},selectedFilaments:['Sibling','Descendant']});
        window.renderInheritance(kind,'Child');window.applied=null;
      },kind);
      await page.waitForFunction(()=>document.querySelector('#preset-parent')?.value==='Other parent');
      await page.selectOption('#preset-parent','Parent');
      await page.waitForFunction(()=>window.applied!==null);
      assert.deepEqual(await page.evaluate(()=>window.applied),{preset:'System',values:{inherited:'parent',shadow:'child'}},'rebasing an ancestor refreshes the selected child and preserves each level of overrides');
      return;
      }
      // Restore the original parent before testing a save of a nested child.
      await page.evaluate(kind=>{
        const s=window.store.getState();s.userPresets.find(p=>p.name==='Child').inherits='Parent';
        if (kind !== 'filament') {
          s.userPresets.find(p=>p.name==='Parent').values.inherited='0.2000';
          s.presetConfig.inherited='0.2';
          s[kind === 'process' ? 'processOverrides' : 'printerOverrides'].inherited='0.2000';
        }
        window.store.setState({savePresetDialogTarget:{kind,baseName:'Child'}});window.renderSave();
      },kind);
      await page.waitForSelector('#preset-name-input');
      if(scenario==='save dialog'){
      assert.equal(await page.inputValue('#preset-name-input'),'Child','prefill existing name');
      assert.match(await page.locator('[data-testid="save-preset-confirm-btn"]').innerText(),/Overwrite/i,'same-name save explicitly offers overwrite');
      await page.click('[data-testid="save-preset-confirm-btn"]');
      }else await page.evaluate(kind=>window.save(kind,'Child'),kind);
      await page.waitForFunction(()=>window.store.getState().savePresetDialogTarget===null);
      const saved=await page.evaluate(kind=>{
        const s=window.store.getState(),child=s.userPresets.find(p=>p.kind===kind&&p.name==='Child');
        s.userPresets.find(p=>p.name==='Parent').values.inherited='changed later';
        return {child,effective:window.effectivePreset(kind,'Child',s.userPresets),count:s.userPresets.length,
          selected:kind==='filament'?s.selectedFilaments:kind==='process'?s.selectedProcess:s.selectedPrinter,slot:window.selectedSlot};
      },kind);
      assert.deepEqual(saved.child.values,{shadow:'edited',manual:'edit'},'save must not freeze inherited parent values');
      assert.deepEqual(saved.child.cloudRef,{accountId:'identity',id:'same'});
      assert.equal(saved.child.inherits,'Parent');assert.equal(saved.count,4);
      assert.equal(saved.effective.values.inherited,'changed later');
      assert.deepEqual(saved.selected,kind==='filament'?['Sibling','Child']:'Child');
      if(kind==='filament')assert.equal(saved.slot,1);
      assert.match(await page.evaluate(async kind=>{try{await window.save(kind,'System');return 'allowed'}catch(e){return e.message}},kind),/immutable/);
      if(scenario==='save dialog'){
        await page.evaluate(kind=>window.store.setState({savePresetDialogTarget:{kind,baseName:'System'}}),kind);
        await page.waitForFunction(()=>document.querySelector('#preset-name-input')?.value==='System');
        await page.click('[data-testid="save-preset-confirm-btn"]');
        assert.match(await page.locator('[data-testid="preset-error-msg"]').innerText(),/immutable system preset/);
        assert.equal(await page.evaluate(()=>window.store.getState().userPresets.some(p=>p.name==='System')),false);
      }
    } finally { await browser.close(); }
  });
}
