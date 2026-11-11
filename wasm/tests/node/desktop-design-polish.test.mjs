import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

const resolveDir = new URL('../../app/', import.meta.url).pathname;
const fixture = `import {create} from 'zustand';
export const calls=[];
const defs={height:{type:'float',label:'Layer height',sidetext:'mm',default:'0.2'},width:{type:'float',label:'Default width',sidetext:'mm or %',default:'0.4'}};
const pages=['Quality','Strength','Speed','Support','Multimaterial','Others'].map(title=>({title,groups:[{title:'Layer height',lines:[{type:'option',key:'height'},{type:'option',key:'width'}]}]}));
export const useAppStore=create((set)=>({
  layout:{tabs:[{id:'print',pages}]},configDefs:defs,currentConfig:{height:'0.2',width:'0.4'},presetConfig:{height:'0.2',width:'0.4'},
  rulesState:{fields:{}},settingsMode:'advanced',activePrintPage:'Quality',searchQuery:'',pendingOptions:{},
  vendors:[],printers:[],processes:[],filaments:[],selectedPrinter:'Test printer',selectedProcess:'Test process',selectedFilaments:[],
  userPresets:[],activeUserPreset:{},modelObjects:[],isEngineReady:true,selectedVendor:'Test',
  gcodeUrl:'blob:fixture',modelFile:{name:'actual-model.stl'},sliceResult:{plateIndex:0,gcode:new Uint8Array()},
  setActivePrintPage:activePrintPage=>set({activePrintPage}),setSettingsMode:settingsMode=>set({settingsMode}),
  openSavePresetDialog:kind=>calls.push(['save',kind]),applyOptionChange:(...args)=>calls.push(['setting',...args]),
  resetOption:()=>{},startSlice:()=>{},setSearchQuery:searchQuery=>set({searchQuery}),jumpToOption:()=>{}
}));
export const pendingOptionKey=(_kind,key)=>key;
export const resolveDeviceVendor=()=>'';
export const usePrefsStore=create((set,get)=>({display:{sidebarWidth:360,sidebarSections:{objects:false},previewLowQuality:false,previewLighting:true,previewShowFps:false},setDisplayPref:(key,value)=>set({display:{...get().display,[key]:value}})}));
export const useWizardStore=create(()=>({addedFilaments:[]}));
export const useHistoryStore=create(()=>({isRestoring:false}));
export const usePlatesStore=create(()=>({activePlateIndex:0}));
export const usePrinterConnectionStore=create(()=>({printers:[],status:'none',setDeviceTabActive:()=>{},openDialog:()=>calls.push(['printer']),openSendDialog:()=>calls.push(['send'])}));
export const getCurrentPrinterApi=()=>({jog:async(...args)=>calls.push(['jog',...args])});
export const reconnectPrinterSession=async()=>{};
export const useCalibrationStore=create(()=>({openDialog:()=>calls.push(['flow'])}));
export const useInputShapingStore=create(()=>({openDialog:kind=>calls.push(['shaping',kind])}));
export const useOtherCalibrationStore=create(()=>({openDialog:kind=>calls.push(['calibration',kind])}));
export const legend={title:'Line type',type:'features',items:[{id:1,name:'Outer wall',color:'#009688',visible:true,timeS:124}],options:[{id:2,name:'Travel',color:'#777777',visible:true}]};
export const usePreviewStore=create((set,get)=>({
  isInitialized:true,layersCount:240,showStatsPanel:true,showGcodeWindow:false,viewType:'FeatureType',legend,
  minMove:0,maxMove:10000,currentMove:0,minLayer:0,maxLayer:239,
  stats:{layers:240,timeS:2345,filamentMm:3880,filamentG:11.58,features:Array.from({length:30},(_,i)=>({name:'Feature '+i,timeS:i*77,percent:i/3}))},
  toggleStatsPanelAction:()=>set({showStatsPanel:!get().showStatsPanel}),setInitialized:isInitialized=>set({isInitialized}),
  resetGcodeAction:()=>{},loadGcodeBytes:async()=>({}),resetCameraAction:()=>{},toggleGcodeWindowAction:()=>{},
  setViewTypeAction:viewType=>{calls.push(['scheme',viewType]);set({viewType})},
  toggleExtrusionRoleAction:id=>calls.push(['role',id]),toggleOptionAction:id=>calls.push(['option',id]),
  setMoveAction:currentMove=>{calls.push(['move',currentMove]);set({currentMove})}
}));
export const useTranslation=()=>({t:key=>key});
export const exportGcode=()=>calls.push(['export']);
export const getOption=async()=>({});
export const getPreviewModule=async()=>({});export const initPreview=async()=>{};
export const getLegendData=()=>legend;export const getLayersCount=()=>240;export const isGcodeLoaded=()=>true;
export const resize=()=>{};export const requestRender=()=>{};export const setLowQuality=()=>{};export const disposePreview=()=>{};export const setBedPolygon=()=>{};
export const setLightingEnabled=()=>{};
const performanceSample={idle:true,fps:null,cpuMs:null};export const getPerformanceSnapshot=()=>performanceSample;
export const subscribePerformance=()=>()=>{};
export const orbit=()=>{};export const pan=()=>{};export const zoom=()=>{};
export const modifiedSettings=()=>[];
export const SavedPrinterSelector=()=>null;export const bindDeviceProfile=()=>{};
export const ObjectListPanel=()=>null;export const FilamentSyncButton=()=>null;
export const ModifiedSettingsDialog=()=>null;export const FlushVolumesDialog=()=>null;
export const GCodeWindow=()=>null;export const LayerSlider=()=>null;export const PlateSelectorBar=()=>null;
export const CustomGcodeDialog=()=>null;export const SendToPrinterDialog=()=>null;
export const resolveBedAssets=async()=>({});export const displayBedOutline=p=>p;export const loadBedModelOutline=async()=>[];
`;

test('real desktop components retain aligned settings, calibration and reachable live Preview export', async () => {
  const fixtureModules = new Set(['appStore','prefs','prefsStore','wizard','history','platesStore','connectionStore',
    'calibrationStore','inputShapingStore','otherCalibrationStore','previewStore','i18n','exportGcode','orcaEngine',
    'orcaPreviewModule','SavedPrinterSelector','ObjectListPanel','FilamentSyncDialog',
    'ModifiedSettingsDialog','FlushVolumesDialog','GCodeWindow','LayerSlider','PlateSelectorBar','CustomGcodeDialog',
    'SendToPrinterDialog','bedAssets','bedModelOutline','session']);
  const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import './src/index.css';import './src/App.css';import './src/mobile/mobile.css';
    import {PrepareSidebar} from './src/shell/PrepareSidebar';import {CalibrationPage} from './src/shell/CalibrationPage';
    import {DevicePanel} from './src/printers/DevicePanel';import {PreviewView} from './src/preview/PreviewView';
    import * as fixture from 'fixture';window.fixture=fixture;
    const root=createRoot(document.getElementById('root'));
    window.show=kind=>root.render(<div className="orca-app">{window.innerWidth<=800&&<header className="wm-header"/>}
      {kind==='prepare'?<div className="prepare-page" style={{height:'100%'}}><PrepareSidebar/></div>:
      kind==='calibration'?<CalibrationPage/>:kind==='device'?<DevicePanel active/>:<PreviewView active/>}</div>);
    window.show('prepare');`,loader:'tsx',resolveDir},bundle:true,write:false,outdir:'/virtual',platform:'browser',format:'iife',
    plugins:[{name:'desktop-component-boundaries',setup(b){
      b.onResolve({filter:/.*/},args=>{
        const name=args.path.split('/').at(-1);
        if(args.path==='fixture'||fixtureModules.has(name))return {path:'fixture',namespace:'fixture'};
      });
      b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'tsx',resolveDir}));
    }}]});
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url()==='http://desktop-fixture.test/'?route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}):route.abort());
  try {
    await page.goto('http://desktop-fixture.test');
    await page.addStyleTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.css')).text});
    await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
    await page.evaluate(()=>window.fixture.useAppStore.setState({modelFile:null}));
    await page.locator('#slice-disabled-reason').waitFor();
    assert.equal(await page.locator('#slice-btn').isDisabled(),true);
    assert.equal(await page.locator('#slice-btn').getAttribute('title'),'Add a model to slice.');
    assert.equal(await page.locator('#slice-disabled-reason').textContent(),'Add a model to slice.');
    await page.evaluate(()=>window.fixture.useAppStore.setState({modelFile:{name:'preview-only.gcode'}}));
    assert.equal(await page.locator('#slice-btn').isDisabled(),true,'G-code alone cannot be sliced as a model');
    await page.evaluate(()=>window.fixture.useAppStore.setState({modelFile:{name:'actual-model.stl'},selectedFilaments:['PLA'],currentConfig:{height:'0.08',width:'0.4'}}));
    await page.locator('#modified-open').waitFor();
    assert.equal(await page.locator('#modified-open').textContent(),'Modified · 1');
    assert.equal(await page.locator('#slice-btn').isEnabled(),true);
    await page.evaluate(()=>window.fixture.useAppStore.setState({currentConfig:{height:'0.2',width:'0.4'}}));
    for(const theme of ['dark','light']) for(const width of [1024,1280,1440]) {
      await page.setViewportSize({width,height:800});
      await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
      await page.evaluate(()=>window.show('prepare'));
      await page.locator('.settings-title').waitFor();
      const settings=await page.locator('.sidebar').evaluate(sidebar=>{
        const box=sidebar.getBoundingClientRect(),title=sidebar.querySelector('.settings-title'),tabs=[...sidebar.querySelectorAll('.settings-tabs button')];
        const inputs=[...sidebar.querySelectorAll('.setting-number')].map(el=>el.getBoundingClientRect());
        const units=[...sidebar.querySelectorAll('.setting-unit')].map(el=>el.getBoundingClientRect());
        const header=sidebar.querySelector('.settings-header-top').getBoundingClientRect();
        return {width:box.width,titleOneLine:title.getBoundingClientRect().height<22,
          headerFits:[title,sidebar.querySelector('.save-preset-btn'),sidebar.querySelector('.mode-select')].every(el=>{const r=el.getBoundingClientRect();return r.left>=header.left&&r.right<=header.right+1}),
          tabs:tabs.length,rows:new Set(tabs.map(el=>el.offsetTop)).size,
          aligned:inputs.length===2&&Math.abs(inputs[0].left-inputs[1].left)<1&&Math.abs(units[0].left-units[1].left)<1,
          unitFits:units.every(r=>r.right<=box.right),
          insets:[...sidebar.querySelectorAll('.sb-body,.settings-header,.settings-content,.sidebar-footer')].map(el=>getComputedStyle(el).paddingLeft)};
      });
      assert.equal(settings.width,width===1024?304:360,`${theme}/${width} sidebar`);
      assert.equal(settings.titleOneLine,true);assert.equal(settings.headerFits,true);
      assert.equal(settings.tabs,6);assert.equal(settings.rows,2);assert.equal(settings.aligned,true);assert.equal(settings.unitFits,true);
      assert.equal(new Set(settings.insets).size,1);
      await page.locator('.settings-header [data-testid="save-process-btn"]').click();
      await page.locator('[data-testid="mode-select"]').selectOption('expert');
      await page.locator('[data-testid="setting-input-height"]').fill('0.24');
      assert.equal(await page.locator('.setting-control-wrapper').first().evaluate(el=>{
        const peers=[...el.closest('.group-lines').querySelectorAll('.setting-control-wrapper')];
        return new Set(peers.map(p=>p.querySelector('input').getBoundingClientRect().left)).size===1&&
          new Set(peers.map(p=>p.querySelector('.setting-unit').getBoundingClientRect().left)).size===1;
      }),true,'modified values keep the input and unit columns');
      // Long real speed units must stay clear of Reset at supported UI font sizes.
      for(const scale of [1,1.3,1.5]) {
        await page.evaluate(scale=>{
          document.documentElement.style.setProperty('--ui-font-scale',String(scale));
          const store=window.fixture.useAppStore,state=store.getState();
          store.setState({configDefs:{...state.configDefs,width:{...state.configDefs.width,sidetext:'mm/s or %'}},currentConfig:{...state.currentConfig,width:'0.5'}});
        },scale);
        const clear=await page.locator('[data-testid="setting-input-width"]').evaluate(input=>{
          const wrapper=input.closest('.setting-control-wrapper'),unit=wrapper.querySelector('.setting-unit'),reset=wrapper.querySelector('.reset-arrow-btn');
          const range=document.createRange();range.selectNodeContents(unit);
          const bounds=unit.getBoundingClientRect(),button=reset.getBoundingClientRect();
          return [...range.getClientRects()].every(r=>r.right<=bounds.right+1&&r.right<=button.left-1);
        });
        assert.ok(clear,`${theme}/${width}/${scale}: long unit text stays clear of Reset`);
      }
      await page.evaluate(()=>document.documentElement.style.removeProperty('--ui-font-scale'));
      await page.evaluate(()=>window.show('calibration'));await page.locator('.calib-tile').first().waitFor();
      assert.equal(await page.locator('.calib-tile').count(),11);
      assert.equal(await page.locator('.calib-tiles').first().evaluate(grid=>{
        const row=[...grid.children].filter(el=>el.offsetTop===grid.children[0].offsetTop);
        return new Set(row.map(el=>el.querySelector('strong').getBoundingClientRect().top)).size===1&&row.every(el=>el.getBoundingClientRect().height>=88);
      }),true);
      await page.locator('#cal-pa-line').click();
      await page.evaluate(()=>window.show('device'));await page.locator('#device-add-printer').waitFor();
      assert.equal(await page.locator('.device-empty > div').evaluate(el=>getComputedStyle(el).fontSize),'18px');
      await page.locator('#device-add-printer').click();
      await page.evaluate(()=>{window.fixture.usePreviewStore.setState({layersCount:240});window.show('preview')});await page.locator('#download-link').waitFor();
      await page.locator('#preview-lighting').uncheck();
      await page.locator('#preview-low-quality').check();
      assert.equal(await page.evaluate(()=>window.fixture.usePrefsStore.getState().display.previewLighting),false);
      await page.locator('#preview-low-quality').uncheck();
      await page.locator('#preview-lighting').check();
      await page.locator('#preview-show-fps').check();
      assert.equal(await page.locator('.preview-performance').textContent(),'IdleCPU — ms');
      assert.equal(await page.locator('#preview-low-quality').isChecked(),false);
      assert.equal(await page.locator('#preview-lighting').isChecked(),true);
      await page.locator('#preview-show-fps').uncheck();
      if(width >= 1280) {
        const clear = await page.evaluate(()=>document.querySelector('#preview-top-controls').getBoundingClientRect().right <= document.querySelector('.preview-detail-panels').getBoundingClientRect().left);
        assert.ok(clear,`${theme}/${width}: Preview toolbar clears statistics`);
      }
      assert.equal(await page.locator('.slicestats-panel__row-10').getAttribute('aria-expanded'),'false');
      assert.equal(await page.locator('.preview-legend__time').count(),0,'feature timing appears only in the statistics detail');
      assert.equal(await page.locator('#stats-section .ds-stat__label').first().evaluate(e=>getComputedStyle(e).fontSize),'12px');
      assert.equal(await page.locator('.preview-legend__head label').evaluate(e=>getComputedStyle(e).fontSize),'12px');
      await page.locator('.slicestats-panel__row-10').click();
      const preview=await page.locator('#stats-section').evaluate(panel=>{
        const body=panel.querySelector('.slice-stats-panel__body'),link=panel.querySelector('#download-link'),r=link.getBoundingClientRect(),p=panel.getBoundingClientRect();
        const rows=[...panel.querySelectorAll('.slicestats-panel__row-6')];
        return {visible:r.top>=p.top&&r.bottom<=p.bottom&&r.bottom<=800,scroll:body.scrollHeight>body.clientHeight,
          footerOutsideBody:!body.contains(link),columns:new Set(rows.map(el=>el.children[0].getBoundingClientRect().right)).size===1,
          quiet:getComputedStyle(panel.querySelector('.slicestats-panel__card-24')).backgroundColor==='rgba(0, 0, 0, 0)'};
      });
      assert.deepEqual(preview,{visible:true,scroll:true,footerOutsideBody:true,columns:true,quiet:true},`${theme}/${width} Preview`);
      const panelTops=await page.evaluate(()=>({legend:document.querySelector('#preview-legend-panel').getBoundingClientRect().top,
        stats:document.querySelector('.preview-detail-panels').getBoundingClientRect().top}));
      assert.equal(panelTops.stats,width===1024?106:panelTops.legend,'wide panels align; compact stats clear the toolbar');
      await page.evaluate(()=>{const s=window.fixture.usePreviewStore.getState();window.fixture.usePreviewStore.setState({stats:{...s.stats,features:s.stats.features.slice(0,8)}})});
      assert.equal(await page.locator('#stats-section').evaluate(el=>Math.round(el.getBoundingClientRect().top)),Math.round(panelTops.stats),'short real feature lists keep the actual statistics card at the intended top');
      await page.evaluate(()=>{const s=window.fixture.usePreviewStore.getState();window.fixture.usePreviewStore.setState({stats:{...s.stats,features:Array.from({length:30},(_,i)=>({name:'Feature '+i,timeS:i*77,percent:i/3}))}})});
      await page.locator('#download-link').click();await page.locator('.slicestats-panel__button-1').click();
      await page.locator('[data-testid="toggle-role-1"]').click();await page.locator('[data-testid="toggle-opt-2"]').click();
      await page.locator('#view-type-select').selectOption('Speed');
      await page.locator('#btn-play-moves').click();await page.waitForFunction(()=>window.fixture.calls.some(c=>c[0]==='move'));
      await page.locator('#btn-play-moves').click();
      await page.evaluate(()=>window.fixture.usePreviewStore.setState({layersCount:0}));
      await page.locator('#preview-empty-prompt').waitFor();
      assert.equal(await page.locator('#preview-empty-prompt p').evaluate(el=>getComputedStyle(el).fontSize),'22px');
    }
    for(const width of [320,390]) for(const scale of [100,125]) {
      await page.setViewportSize({width,height:800});
      await page.evaluate(scale=>{document.documentElement.style.fontSize=16*scale/100+'px';window.show('calibration')},scale);
      await page.locator('.calib-tile').first().waitFor();
      assert.deepEqual(await page.locator('.calib-tile').first().evaluate(el=>({foreground:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,page:getComputedStyle(el.closest('.calibration-page')).backgroundColor})),{foreground:'rgb(229, 229, 228)',background:'rgb(45, 45, 49)',page:'rgb(35, 35, 39)'},'mobile Calibration keeps its neutral dark palette after desktop light theme');
      await page.locator('.calib-group h3').first().evaluate(el=>el.textContent+=' / extended calibration group title for enlarged text');
      const calibration=await page.locator('.calibration-page').evaluate(el=>{
        const box=el.getBoundingClientRect(),css=getComputedStyle(el),tiles=[...el.querySelectorAll('.calib-tile')];
        return {left:parseFloat(css.paddingLeft),top:parseFloat(css.paddingTop),end:parseFloat(css.paddingBottom),
          contained:tiles.every(tile=>{const r=tile.getBoundingClientRect();return r.left>=box.left&&r.right<=box.right&&r.height>=48&&tile.scrollWidth<=tile.clientWidth+1}),
          columns:new Set(tiles.map(tile=>tile.getBoundingClientRect().left)).size,
          wrapped:el.querySelector('h3').scrollWidth<=el.querySelector('h3').clientWidth+1};
      });
      assert.deepEqual(calibration,{left:width===320?12:16,top:20,end:24,contained:true,columns:1,wrapped:true},`Calibration ${width}/${scale}`);
      await page.locator('#cal-shaping-freq').click();
      await page.evaluate(()=>{const printer={id:'geometry',name:'Geometry fixture printer with a long name',host_type:'octoprint',print_host:''};
        window.fixture.usePrinterConnectionStore.setState({printers:[printer],selectedPrinterId:printer.id,status:'online',
          liveState:{state:'ready',heaters:[{id:'extruder',kind:'extruder',label:'Nozzle',current:20,target:0}],fans:[],speedFactor:100,flowFactor:100}});
        window.show('device');});
      await page.locator('#control-jog-x-plus').waitFor();
      const device=await page.locator('#device-panel').evaluate(el=>{
        const box=el.getBoundingClientRect(),targets=[...el.querySelectorAll('button,input,select,.btn')];
        return {targets:targets.every(node=>{const r=node.getBoundingClientRect();return r.height>=48&&r.left>=box.left&&r.right<=box.right+1}),
          jog:[...el.querySelectorAll('.jog-btn')].every(node=>node.getBoundingClientRect().width>=48),
          insets:getComputedStyle(el.querySelector('.device-body')).paddingLeft==='16px'&&getComputedStyle(el.querySelector('.device-header')).paddingLeft==='16px',
          noOverflow:el.scrollWidth<=el.clientWidth+1,
          selection:getComputedStyle(el.querySelector('.btn-step.active')).backgroundColor,
          status:getComputedStyle(el.querySelector('.device-status-dot')).backgroundColor,
          heater:getComputedStyle(el.querySelector('.device-heater-bar > div')).backgroundColor};
      });
      assert.deepEqual(device,{targets:true,jog:true,insets:true,noOverflow:true,selection:'rgb(69, 69, 75)',status:'rgb(76, 175, 80)',heater:'rgb(239, 108, 0)'},`Device ${width}/${scale}`);
      await page.locator('#control-step-1').click();await page.locator('#control-jog-x-plus').click();
      await page.locator('#control-extrude-amount').focus();
      assert.equal(await page.locator('#control-extrude-amount').evaluate(el=>getComputedStyle(el).outlineColor),'rgb(245, 245, 245)');
    }
    const calls=await page.evaluate(()=>window.fixture.calls);
    for(const kind of ['save','setting','calibration','printer','export','send','role','option','scheme','move'])assert.ok(calls.some(c=>c[0]===kind),kind);
    assert.ok(calls.some(c=>c[0]==='jog'&&c[1]==='x'&&c[2]===1));
    assert.ok(calls.some(c=>c[0]==='shaping'&&c[1]==='freq'));
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
