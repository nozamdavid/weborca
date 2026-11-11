import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

test('populated mobile Objects keeps overrides contained and reachable', async () => {
  const resolveDir = new URL('../../app/', import.meta.url).pathname;
  const stubs = {
    i18n: `export const useTranslation=()=>({t:(key,args={})=>key.replaceAll('{{name}}',args.name??'')});`,
    appStore: `const state={isEngineReady:false,modelObjects:[],configDefs:{extruder:{label:'Extruder'},layer_height:{label:'Layer height',type:'float',sidetext:'mm'}},currentConfig:{},selectedFilaments:['A deliberately long filament preset name']};
      export const useAppStore=Object.assign(select=>select?select(state):state,{getState:()=>state});`,
    objectListStore: `const state={objects:[{id:1,name:'Cube',volumes:[{id:2,name:'Part',type:'part',extruder:0}],config:{extruder:'1',layer_height:'0.2'}}],selectedObjectId:1,selectedVolumeId:null,selectedRangeIndex:null,refreshTree(){}};
      export const useObjectListStore=()=>state;`,
    plateStore: `export const usePlateStore=select=>select({objects:[{id:1}]});`,
    platesStore: `export const usePlatesStore=select=>select({plates:[{index:0,name:'Plate 1'}],activePlateIndex:0,setActivePlate(){}});`,
    plateGroups: `export const instancesInGroup=(_objects,_plates,index)=>index===0?new Map([[1,[1]]]):new Map();`,
    ContextMenu: `export const ContextMenu=()=>null;`,
  };
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import './src/index.css';import './src/App.css';import './src/mobile/mobile.css';import './src/mobile/mobileShell.css';
    import {ObjectListPanel} from './src/objectlist/ObjectListPanel';
    createRoot(document.getElementById('root')).render(<div className="wm-sheet-backdrop"><section className="wm-sheet ds-dialog"><header className="ds-dialog__head">Objects</header><div className="wm-content"><ObjectListPanel/></div><footer><button>Close</button></footer></section></div>);`,loader:'tsx',resolveDir},
    bundle:true,write:false,outdir:'/virtual',platform:'browser',format:'iife',plugins:[{name:'inert-object-engine',setup(b){
      b.onResolve({filter:/\//},args=>{const name=args.path.split('/').at(-1);if(name in stubs)return {path:name,namespace:'fixture'};});
      b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir}));
    }}]});
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.route('**/*',route=>route.abort());
    await page.setContent('<!doctype html><div id="root"></div>');
    await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.css')).text});
    await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
    const collapse=page.getByRole('button',{name:'Collapse Cube',exact:true});
    await collapse.waitFor();
    assert.equal(await collapse.getAttribute('aria-expanded'),'true');
    assert.equal(await page.getByRole('button',{name:'Object actions for Cube',exact:true}).getAttribute('aria-haspopup'),'menu');
    assert.equal(await page.getByRole('button',{name:'Volume actions for Part',exact:true}).getAttribute('aria-expanded'),'false');
    await collapse.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('button',{name:'Expand Cube',exact:true}).getAttribute('aria-expanded'),'false');
    await page.keyboard.press('Enter');
    for(const width of [320,390])for(const scale of [100,125]){
      await page.setViewportSize({width,height:844});
      await page.evaluate(scale=>document.documentElement.style.fontSize=`${16*scale/100}px`,scale);
      assert.ok(await page.locator('[data-testid=plate-group-header-0]').evaluate(node=>node.getBoundingClientRect().height>=44));
      for(const name of ['extruder','layer_height']){
        const control=page.locator(`#override-input-${name}`);
        await control.focus();await control.scrollIntoViewIfNeeded();
        const fits=await control.evaluate(node=>{
          const box=node.getBoundingClientRect(),body=node.closest('.wm-content'),outer=body.getBoundingClientRect(),inset=parseFloat(getComputedStyle(body).paddingLeft);
          let visible=box.height>=48 && box.left>=outer.left+inset-1 && box.right<=outer.right-inset+1;
          for(let p=node.parentElement;p&&p!==body.parentElement;p=p.parentElement){
            if(['hidden','auto','scroll'].includes(getComputedStyle(p).overflowY)){
              const clip=p.getBoundingClientRect();visible&&=box.top>=clip.top-1&&box.bottom<=clip.bottom+1;
            }
          }
          return {pass:visible&&body.scrollWidth<=body.clientWidth+1,box:box.toJSON(),outer:outer.toJSON(),overflow:[body.clientWidth,body.scrollWidth],clips:[...function*(el){for(let p=el.parentElement;p;p=p.parentElement)yield p;}(node)].map(p=>({id:p.id,rect:p.getBoundingClientRect().toJSON(),overflow:getComputedStyle(p).overflow}))};
        });
        assert.ok(fits.pass,`${name} ${width}/${scale}: contained and visible through all scroll clips ${JSON.stringify(fits)}`);
      }
    }
  } finally {await browser.close();}
});
