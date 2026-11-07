import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from '../../build/web-smoke/node_modules/playwright/index.mjs';

const resolveDir = new URL('../../app/', import.meta.url).pathname;

test('settings headers, bed assets and cloud method tabs fit their padded sections', async () => {
  const stubs = {
    appStore: `import {create} from 'zustand';
      export const useAppStore=create(set=>({activeDialog:'printer',settingsMode:'advanced',configDefs:{},
        rulesState:{fields:{}},currentConfig:{},presetConfig:{},selectedPrinter:'Fixture printer',
        selectedFilament:'Fixture filament',selectedFilaments:[],activeFilamentSlot:0,
        layout:{tabs:['printer','filament'].map(id=>({id,pages:[{title:'Basic information',groups:[]}]}))},
        closeDialog:()=>set({activeDialog:null}),setSettingsMode:settingsMode=>set({settingsMode})}));
      window.fixtureStore=useAppStore;`,
    i18n: `export const useTranslation=()=>({t:key=>key});`,
    SettingsSearchBar: `import React from 'react';export const SettingsSearchBar=()=> <input aria-label="Search settings" style={{width:'100%',minWidth:0}}/>;`,
    SettingsGroup: `export const SettingsGroup=()=>null;`,
  };
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import './src/index.css';import './src/App.css';import './src/mobile/mobile.css';
    import {SettingsDialog} from './src/settings/SettingsDialog';
    import {CrealityCloudLogin} from './src/printers/CrealityCloudLogin';
    const root=createRoot(document.getElementById('root'));
    window.showSettings=kind=>{window.fixtureStore.setState({activeDialog:kind});root.render(<SettingsDialog/>)};
    window.showCloud=()=>root.render(<div style={{width:'calc(100% - 66px)',margin:'0 33px'}}><CrealityCloudLogin onSelectDevice={()=>{}}/></div>);
    window.showSettings('printer');`,loader:'tsx',resolveDir},bundle:true,write:false,outdir:'/virtual',format:'iife',platform:'browser',
    plugins:[{name:'inert-spacing-boundaries',setup(b){
      b.onResolve({filter:/\//},args=>{const name=args.path.split('/').at(-1);if(name in stubs)return {path:name,namespace:'fixture'};});
      b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir}));
    }}]});
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.abort());
  const failures=[];
  try {
    await page.setContent('<!doctype html><div id="root"></div>');
    await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
    for(const [width,scale] of [[320,100],[320,125],[390,100],[390,125],[1400,100]]) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(scale=>{document.documentElement.style.fontSize=`${16*scale/100}px`;},scale);
      for(const kind of ['printer','filament']) {
        await page.evaluate(kind=>window.showSettings(kind),kind);
        const header=page.locator('.settings-dialog-modal > .modal-header');await header.waitFor();
        const checks=await header.evaluate(node=>{
          const box=node.getBoundingClientRect(),css=getComputedStyle(node);
          const inside=el=>{const r=el.getBoundingClientRect();return r.left>=box.left+parseFloat(css.paddingLeft)-1 && r.right<=box.right-parseFloat(css.paddingRight)+1;};
          return {title:node.querySelector('.modal-header-left').getBoundingClientRect().width>80,
            search:node.querySelector('input').getBoundingClientRect().width>80,
            actions:[...node.querySelectorAll('.modal-header-actions select,.modal-header-actions button')].every(inside)};
        });
        for(const [name,pass] of Object.entries(checks))if(!pass)failures.push(`${kind} ${width}/${scale}: ${name}`);
        if(kind==='printer') {
          const fits=await page.locator('.bed-assets-settings').evaluate(node=>{
            const box=node.getBoundingClientRect(),css=getComputedStyle(node),padding=parseFloat(css.paddingLeft);
            return padding>=12 && [...node.querySelectorAll('input[type=file]')].every(el=>{
              const r=el.getBoundingClientRect();return r.left>=box.left+padding && r.right<=box.right-padding;
            });
          });
          if(!fits)failures.push(`bed assets ${width}/${scale}: padding/file containment`);
        }
      }
      await page.evaluate(()=>window.showCloud());
      const tabs=page.locator('.btn-tab');await tabs.first().waitFor();
      const fits=await tabs.first().evaluate(node=>{
        const row=node.parentElement,box=row.getBoundingClientRect();
        return row.scrollWidth<=row.clientWidth+1 && [...row.children].every(el=>{const r=el.getBoundingClientRect();return r.left>=box.left-1 && r.right<=box.right+1;});
      });
      if(!fits)failures.push(`Creality methods ${width}/${scale}: containment`);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  } finally {await browser.close();}
});
