#!/usr/bin/env node
// Source-bound layout regression: real panel, tree items and override rows; no engine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const app = path.join(root, 'wasm/app');
const evidence = process.env.OBJECTS_EVIDENCE;
const stores = `
import {create} from 'zustand';
export const useAppStore=create(()=>({isEngineReady:false,modelObjects:[],configDefs:{},currentConfig:{},selectedFilaments:[]}));
export const usePlateStore=create(set=>({objects:[],selectedInstanceId:null,selectObject:(id,instance)=>set({selectedInstanceId:instance})}));
export const usePlatesStore=create(set=>({plates:[{index:0,name:'Plate 1',instances:[]}],activePlateIndex:0,setActivePlate:index=>set({activePlateIndex:index})}));
export const useObjectListStore=create(set=>({objects:[],selectedObjectId:null,selectedVolumeId:null,selectedRangeIndex:null,isLoading:false,error:null,refreshTree:async()=>{},selectItem:(id,volume=null,range=null)=>set({selectedObjectId:id,selectedVolumeId:volume,selectedRangeIndex:range}),setObjectConfig:(id,volume,config)=>set(s=>({objects:s.objects.map(o=>o.id===id?{...o,config:{...o.config,...config}}:o)}))}));
window.seed=(count,selected=false)=>{
 const config=Object.fromEntries(Array.from({length:16},(_,i)=>['option_'+i,'2']));
 const objects=Array.from({length:count},(_,i)=>({id:i,name:'A very long object name '+ 'printed part '.repeat(12)+i,config,volumes:[{id:1000+i,name:'Part '+i,type:'part',config:{}}],layerRanges:[]}));
 useObjectListStore.setState({objects,selectedObjectId:selected&&count?0:null,selectedVolumeId:null,selectedRangeIndex:null});
 usePlateStore.setState({objects:objects.map(o=>({id:o.id,instances:[{id:o.id}]}))});
 usePlatesStore.setState({plates:[{index:0,name:'Plate 1',instances:objects.map(o=>({objectId:o.id,instanceId:o.id}))}]});
};
window.deselect=()=>useObjectListStore.getState().selectItem(null);
`;
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ObjectListPanel} from './src/objectlist/ObjectListPanel';
import './src/index.css';
import './src/App.css';
import './src/mobile/mobile.css';
import './src/mobile/mobileControls.css';
import './src/mobile/mobileShell.css';
const mobile=innerWidth<=800;
createRoot(document.getElementById('root')).render(mobile
 ? <div className="wm-scrim ds-scrim"><section className="wm-sheet ds-dialog"><header className="ds-dialog__head">Objects</header><div className="wm-content"><ObjectListPanel/></div></section></div>
 : <div className="workspace"><aside className="sidebar"><div className="sidebar-scroll"><section className="sb-section sb-objects"><div className="sb-head" onClick={e=>e.currentTarget.parentElement.classList.toggle('closed')}>Objects</div><div className="sb-body"><div className="objects-wrap"><ObjectListPanel/></div></div></section><div className="sb-settings">Process settings</div></div></aside></div>);
`;
const bundle = await build({stdin:{contents:entry,resolveDir:app,loader:'tsx'},bundle:true,write:false,outdir:'out',plugins:[{
 name:'engine-free-stores',setup(b){
  // Replay captured source bytes without restoring files in a shared checkout.
  if(process.env.OBJECTS_SOURCE_SNAPSHOT)b.onLoad({filter:/(ObjectListPanel|ObjectSettingsEditor)\.tsx$|\/(shell|mobileShell)\.css$/},args=>({contents:readFileSync(path.join(process.env.OBJECTS_SOURCE_SNAPSHOT,path.relative(root,args.path)),'utf8'),loader:args.path.endsWith('.css')?'css':'tsx',resolveDir:path.dirname(args.path)}));
  b.onResolve({filter:/(objectListStore|plateStore|appStore|platesStore)$/},()=>({path:'stores',namespace:'fixture'}));
  b.onResolve({filter:/i18n$/},()=>({path:'i18n',namespace:'fixture'}));
  // Menus are outside this fixture's sizing/selection/expansion contract.
  b.onResolve({filter:/\/ContextMenu$/},()=>({path:'menu',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='stores'?stores:args.path==='menu'?'export const ContextMenu=()=>null;':`const t=s=>s; export const useTranslation=()=>({t});`,loader:'js',resolveDir:app}));
 }
}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
const server=http.createServer((req,res)=>{
 res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':req.url==='/bundle.css'?'text/css':'text/html');
 res.end(req.url==='/bundle.js'?js:req.url==='/bundle.css'?css:'<!doctype html><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script type="module" src="/bundle.js"></script>');
});
await new Promise(resolve=>server.listen(Number(process.env.OBJECTS_PORT||0),'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
if(process.argv.includes('--serve')) { console.log(url); } else {
const browser=await chromium.launch({headless:true});
const failures=[];
try {
 for(const width of [1280,820,320,390]) for(const zoom of [1,1.25]) for(const theme of ['dark','light']) {
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.goto(url);
  await page.waitForFunction(()=>window.seed);
  await page.evaluate(({zoom,theme})=>{document.documentElement.style.fontSize=`${zoom*100}%`;document.documentElement.dataset.theme=theme;},{zoom,theme});
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const seed=async(n,selected=false)=>{await page.evaluate(({n,selected})=>window.seed(n,selected),{n,selected});await settle();};
  const measure=()=>page.evaluate(()=>{
   const panel=document.querySelector('#object-list-panel'),tree=document.querySelector('#object-tree-container'),editor=document.querySelector('#object-settings-editor');
   const box=e=>e?{height:e.getBoundingClientRect().height,client:e.clientHeight,scroll:e.scrollHeight,width:e.clientWidth,scrollWidth:e.scrollWidth}:null;
   return {panel:box(panel),tree:box(tree),editor:box(editor),empty:box(document.querySelector('#empty-objects-message')),editorList:box(editor?.lastElementChild)};
  });
  const check=(condition,message)=>{if(!condition)failures.push(`${width}/${zoom}/${theme}: ${message}`);};
  await seed(0);
  const empty=await measure();
  check(empty.panel.height<180,`empty panel ${empty.panel.height}px must hug its message`);
  check(!await page.getByText('Select an object or part to edit overrides').count(),'empty editor placeholder reserves space');
  await seed(1);
  const one=await measure();
  check(one.tree.scroll<=one.tree.client+1,'one object and part must fit naturally');
  await seed(3);
  const few=await measure();
  check(few.panel.height>one.panel.height+30,'panel must grow with rows');
  await seed(40);
  const many=await measure();
  check(many.tree.height<=261&&many.tree.scroll>many.tree.client,'many rows must cap and scroll');
  await page.locator('#object-row-39').scrollIntoViewIfNeeded();
  check(await page.locator('#object-row-39').evaluate(e=>{const row=e.getBoundingClientRect(),tree=document.querySelector('#object-tree-container').getBoundingClientRect();return row.top>=tree.top&&row.bottom<=tree.bottom;}),'last row reachable inside tree viewport');
  check(many.panel.scrollWidth<=many.panel.width+1,'long names must not widen panel');
  if(evidence)await page.screenshot({path:path.join(evidence,`${width}-${zoom}-${theme}-many-last.png`)});
  await seed(1);
  await page.locator('#object-row-0').click();await settle();
  const selected=await measure();
  check(selected.editorList.height>200,'populated editor must not collapse into tiny scroller');
  check(selected.editorList.scroll<=selected.editorList.client+1,'editor must use outer sidebar/sheet scroll');
  check(selected.editor.scrollWidth<=selected.editor.width+1,'long selected name must not widen editor');
  if(evidence)await page.screenshot({path:path.join(evidence,`${width}-${zoom}-${theme}-selected-top.png`)});
  await page.locator('#override-input-option_15').scrollIntoViewIfNeeded();
  await page.locator('#override-input-option_15').fill('7');
  check(await page.locator('#override-input-option_15').inputValue()==='7','last override remains editable');
  check(await page.locator('#override-input-option_15').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'last override reachable in outer viewport');
  await seed(40,true);
  const manySelected=await measure();
  check(manySelected.tree.height<=261&&manySelected.editorList.scroll<=manySelected.editorList.client+1,'many objects must keep capped tree and full editor');
  await seed(1,true);
  await page.locator('#object-row-0 button').first().click();await settle();
  const collapsed=await measure();
  check(collapsed.tree.height<selected.tree.height,'collapse releases row height');
  await page.locator('#object-row-0 button').first().click();await settle();
  check((await measure()).tree.height>collapsed.tree.height,'expand restores row height');
  await page.evaluate(()=>window.deselect());await settle();
  check(!await page.locator('#object-settings-editor').count(),'deselection removes editor');
  await seed(0);
  check(Math.abs((await measure()).panel.height-empty.panel.height)<1,'delete all restores empty height');
  if(width>800){await page.locator('.sb-head').click();check(!await page.locator('#object-list-panel').isVisible(),'section closes');await page.locator('.sb-head').click();}
  if(evidence){await seed(0);await page.screenshot({path:path.join(evidence,`${width}-${zoom}-${theme}-empty.png`)});await seed(1,true);await page.locator('#override-input-option_15').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,`${width}-${zoom}-${theme}-selected.png`)});}
  console.log(JSON.stringify({width,zoom,theme,empty,one,few,many,selected}));
  await page.close();
 }
 assert.deepEqual(failures,[]);
 console.log('PASS: 16 layouts; empty, growth, cap, long names, editor, deselect/delete/expand/collapse');
}finally{await browser.close();server.close();}
}
