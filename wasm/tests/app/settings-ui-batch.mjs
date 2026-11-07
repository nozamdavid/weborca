import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from '../../build/web-smoke/node_modules/playwright/index.mjs';

// Same isolated React/esbuild/Playwright fixture boundary as preset-inheritance-save.
const repo = path.resolve(new URL('../../..', import.meta.url).pathname);
const source = process.env.SETTINGS_UI_SOURCE_ROOT || repo;
const app = path.join(source, 'wasm/app');
const installed = path.join(repo, 'wasm/app/node_modules');
const store = `import {useSyncExternalStore} from 'react';let state={};const listeners=new Set();
export const useAppStore=Object.assign((select=s=>s)=>select(useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state)),{getState:()=>state,setState:update=>{state={...state,...update};listeners.forEach(fn=>fn())}});
export const resolveDeviceVendor=()=>'';export const pendingOptionKey=(kind,key)=>kind+':'+key;`;
const stubs = {
  appStore: store,
  i18n: `export const useTranslation=()=>({t:key=>key});`,
  prefs: `export const usePrefsStore=Object.assign(fn=>fn({display:{sidebarWidth:360,sidebarSections:{}}}),{getState:()=>({display:{},setDisplayPref:()=>{}})});`,
  history: `export const useHistoryStore=fn=>fn({isRestoring:false});`,
  wizard: `export const useWizardStore=fn=>fn({addedFilaments:[]});`,
  connectionStore: `export const usePrinterConnectionStore=Object.assign(fn=>fn({status:'none',printers:[]}),{getState:()=>({})});`,
  platesStore: `export const usePlatesStore=(fn=s=>s)=>fn({activePlateIndex:0,plates:[{index:0,name:'Plate',instances:[{objectId:1,instanceId:1}]}],slicePlate:()=>window.sliced=true});`,
  plateStore: `export const usePlateStore=fn=>fn({objects:[{id:1,instances:[{id:1}]}],extraSelection:[]});`,
  textStore: `import {useAppStore} from './appStore';export const useTextStore=fn=>useAppStore(s=>fn(s.textState));`,
  SettingInput: `import React from 'react';export const SettingInput=({optionKey})=><input id={'setting-input-'+optionKey}/>;`,
  BedAssetsSettings: `export const BedAssetsSettings=()=>null;`,
  FilamentSyncDialog: `export const FilamentSyncButton=()=>null;`,
  FlushVolumesDialog: `export const FlushVolumesDialog=()=>null;`,
  ObjectListPanel: `export const ObjectListPanel=()=>null;`,
  SavedPrinterSelector: `export const SavedPrinterSelector=()=>null;export const bindDeviceProfile=()=>{};`,
  exportGcode: `export const exportGcode=()=>{};`,
  PlateView: `export const PlateView=()=>null;`,
  NumericTransform: `export const NumericTransform=()=>null;`,
  MobileProcessSettings: `export const MobileProcessSettings=()=>null;`,
  MobileShell: `export const MobileImport=()=>null;export const MobileSheet=()=>null;export const mobileBusy=()=>false;`,
};
const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
import {useAppStore} from './src/store/appStore';
import {SettingsPanel} from './src/settings/SettingsPanel';import {SettingsLine} from './src/settings/SettingsLine';
import {SettingsDialog} from './src/settings/SettingsDialog';import {ModifiedSettingsDialog} from './src/settings/ModifiedSettingsDialog';
import {PrepareSidebar} from './src/shell/PrepareSidebar';import {TextPanel} from './src/text/TextPanel';import {MobilePrepare} from './src/mobile/MobilePrepare';
import './src/index.css';import './src/App.css';import './src/mobile/mobile.css';import './src/desktop-polish.css';
const root=createRoot(document.getElementById('root'));
Object.assign(window,{store:useAppStore,render:kind=>root.render(kind==='sidebar'?<PrepareSidebar/>:kind==='dialog'?<SettingsDialog/>:kind==='modified'?<ModifiedSettingsDialog onClose={()=>{}}/>:kind==='text'?<TextPanel/>:kind==='mobile'?<MobilePrepare/>:<div className="sidebar" style={{width:300}}><SettingsPanel/><SettingsLine line={{type:'line',options:['unknown','layer_height']}}/></div>)});`,resolveDir:app,loader:'tsx'},bundle:true,write:false,outdir:'/virtual',nodePaths:[installed],platform:'browser',format:'iife',plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/.*/},args=>{const name=args.path.split('/').at(-1)?.replace(/\.tsx?$/,'');if(name in stubs)return {path:name,namespace:'fixture'};});
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:app}));
}}]});
const description = readFileSync(path.join(repo,'src/libslic3r/PrintConfig.cpp'),'utf8').match(/add\("layer_height"[\s\S]*?tooltip\s*=\s*L\("([^"]+)"/)[1];
const browser=await chromium.launch({headless:true});
try {
  for(const width of [1280,390])for(const theme of ['dark','light']) {
    await test(`${width} ${theme}: actual settings components`,async()=>{
      const page=await browser.newPage({viewport:{width,height:900}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>route.abort());
      const capture=async name=>{if(process.env.SETTINGS_UI_SCREENSHOTS)await page.screenshot({animations:'disabled',path:path.join(process.env.SETTINGS_UI_SCREENSHOTS,`${name}-${width}-${theme}.png`)});};
      try {
        await page.setContent(`<!doctype html><html data-theme="${theme}"><body><div id="root"></div></body></html>`);
        await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.css')).text});
        await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
        await page.evaluate(description=>{
          const pages=['Quality','Strength','Speed','Support','Multimaterial','Others'].map(title=>({title,groups:[{title:'Group',lines:[{type:'option',key:'layer_height'}]}]}));
          window.store.setState({layout:{tabs:[{id:'print',pages},{id:'filament',pages}]},configDefs:{layer_height:{label:'Layer height',tooltip:description,mode:'simple'}},rulesState:{fields:{}},settingsMode:'expert',currentConfig:{layer_height:'0.3'},presetConfig:{layer_height:'0.2'},pendingOptions:{},activePrintPage:'Quality',searchQuery:'',
            setActivePrintPage:title=>window.store.setState({activePrintPage:title}),setSettingsMode:()=>{},setSearchQuery:()=>{},jumpToOption:()=>{},
            activeDialog:'filament',activeFilamentPage:'Quality',selectedFilaments:['Generic ABS @System'],selectedFilament:'Generic ABS @System',activeFilamentSlot:0,selectedPrinter:'Printer',selectedProcess:'Process',selectedVendor:'',userPresets:[],activeUserPreset:{},vendors:[],printers:[],processes:[],filaments:[{name:'Generic ABS @System'}],modelObjects:[],isEngineReady:true,modelFile:{name:'test.stl'},
            openSavePresetDialog:()=>window.saved=true,openDialog:()=>{},closeDialog:()=>{},resetOption:()=>{},
            textState:{isOpen:true,targetObjectId:1,targetVolumeId:1,text:'Text',fonts:[],isFontsLoaded:true,selectedFont:null,size:10,depth:1,charGap:0,lineGap:0,boldness:0,skew:0,align:'left',volumeType:'part',rotation:0,useSurface:false},
          });window.render('settings');
        },description);
        await page.locator('.settings-tabs').waitFor();
        if(width>800){
          const ys=await page.locator('.tab-btn').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
          assert.equal(new Set(ys).size,1,'tabs stay on one row');
          assert.ok(await page.locator('.settings-tabs').evaluate(el=>el.scrollWidth>el.clientWidth),'tabs overflow horizontally');
          await page.evaluate(()=>window.store.setState({activePrintPage:'Others'}));
          await page.waitForFunction(()=>{const t=document.querySelector('.tab-btn.active').getBoundingClientRect(),r=document.querySelector('.settings-tabs').getBoundingClientRect();return t.left>=r.left&&t.right<=r.right+1});
        }
        const help=page.locator('.setting-help-link').last();
        assert.equal(await help.isVisible(),width>800,'help desktop only');
        assert.equal(await help.getAttribute('title'),description,'documented key supplies its actual metadata description');
        assert.equal(await help.getAttribute('href'),'https://www.orcaslicer.com/wiki/quality_settings_layer_height');
        if(width>800){await help.hover();await help.focus();assert.equal(await help.evaluate(el=>document.activeElement===el),true);await help.evaluate(el=>el.addEventListener('click',e=>{e.preventDefault();window.helpClicked=true}));await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.helpClicked),true);}
        await capture('process');
        await page.evaluate(()=>window.render('dialog'));
        await page.locator('.settings-dialog-content').waitFor();
        assert.equal(await page.locator('.settings-dialog-content').evaluate(el=>el.parentElement.classList.contains('settings-dialog-modal')),true,'content is an explicit dialog body, avoiding nested padding');
        assert.ok(await page.locator('.settings-dialog-modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
        const save=page.locator('[data-testid="save-dialog-preset-btn"]');
        assert.ok(await save.isVisible());await save.click();assert.equal(await page.evaluate(()=>window.saved),true);
        assert.ok(await save.evaluate(el=>parseFloat(getComputedStyle(el).gap)>0),'save icon has label spacing');
        assert.ok(await page.locator('.modal-header-actions').evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.settings-dialog-modal').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right+1}),'header actions fit inside the modal');
        await capture('filament');
        await page.evaluate(()=>window.render('modified'));
        await page.locator('.modified-row').first().waitFor();
        assert.ok(await page.locator('.modified-settings-modal .ds-dialog__body').evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft)>0));
        const paddings=await page.locator('.modified-settings-table').evaluate(el=>[...el.querySelectorAll('th')].slice(0,3).map((th,i)=>[getComputedStyle(th).paddingLeft,getComputedStyle(el.querySelectorAll('td')[i]).paddingLeft]));
        assert.ok(paddings.every(([a,b])=>a===b),'headers and cells align');
        await capture('modified');
        await page.evaluate(()=>window.render('text'));
        await page.locator('#text-panel-title').waitFor();
        assert.equal(await page.locator('#text-panel-title').innerText(),'Edit 3D Text');
        assert.equal((await page.locator('.text-panel__head').innerText()).split('🔤').length-1,1);
        await capture('text');
        await page.evaluate(()=>window.render('sidebar'));
        await page.locator('#edit-filament-btn').waitFor();
        assert.equal(await page.locator('[data-testid^="save-filament-btn"]').count(),0);
        assert.equal(await page.locator('#slice-btn').isVisible(),width<=800);
        if(width<=800){await page.evaluate(()=>window.render('mobile'));await page.getByRole('button',{name:'Slice plate',exact:true}).click();assert.equal(await page.evaluate(()=>window.sliced),true);}
        assert.deepEqual(errors,[]);
        console.log(`${width}/${theme}: tabs, help, dialog, modified table, text, sidebar and mobile slice passed`);
      }finally{await page.close();}
    });
  }
} finally { await browser.close(); }
