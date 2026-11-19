import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

test('PreviewView resets disposed metadata and tracks the current G-code load', async () => {
  const resolveDir = new URL('../../app/', import.meta.url).pathname;
  const fixture = `import React from 'react'; import {create} from 'zustand';
    export const useAppStore=create(()=>({sliceResult:{gcode:new Uint8Array([1])},currentConfig:{},
      selectedPrinter:'Fixture',selectedVendor:'Fixture',userPresets:[],isEngineReady:true,isSlicing:false}));
    export const usePrefsStore=create(()=>({display:{previewLowQuality:false,previewLighting:true,previewShowFps:false},setDisplayPref(){}}));
    export const useTranslation=()=>({t:key=>key});
    export const bindCanvasTouch=()=>()=>{};
    export const resolveBedAssets=async()=>({}); export const displayBedOutline=points=>points;
    export const loadBedModelOutline=async()=>[];
    let nativeLayers=0, loadedBytes=null; export const getLayersCount=()=>nativeLayers;
    export const getPreviewModule=async()=>({});
    export const clearGcode=()=>{nativeLayers=0;loadedBytes=null};
    export const initPreview=async()=>clearGcode(); export const disposePreview=clearGcode;
    export const cancelPendingGcodeLoad=()=>{};
    export const pendingLoads=[];
    export const getLoadedValue=()=>loadedBytes?.[0];
    export const loadGcode=bytes=>{
      const finish=()=>{loadedBytes=bytes;nativeLayers=12;return {layers:12,timeS:125,features:[]}};
      if (bytes[0]<3) return finish();
      return new Promise((resolve,reject)=>pendingLoads.push({
        finish:()=>resolve(finish()),
        fail:(message,name='Error')=>reject(Object.assign(new Error(message),{name}))
      }));
    };
    export const getLayersZs=()=>Array.from({length:12},(_,i)=>(i+1)*.2);
    export const getMoveRange=()=>({min:0,max:100});
    export const getLegendData=()=>({viewType:'FeatureType',title:'Line Type',type:'features',items:[],options:[]});
    export const isGcodeLoaded=bytes=>loadedBytes===bytes;
    export const setLowQuality=()=>{}; export const setViewType=()=>{};
    export const setLightingEnabled=()=>{};
    export const performanceListeners=new Set();
    export const subscribePerformance=listener=>{performanceListeners.add(listener);return()=>performanceListeners.delete(listener)};
    let performanceSample={idle:true,fps:null,cpuMs:null};export const getPerformanceSnapshot=()=>performanceSample;
    export const publishPerformance=sample=>{performanceSample=sample;performanceListeners.forEach(listener=>listener(sample))};
    export const resize=()=>{}; export const requestRender=()=>{};
    export const zoom=()=>{}; export const pan=()=>{}; export const orbit=()=>{};
    export const resetCamera=()=>{}; export const setBedPolygon=()=>{};
    export const setLayerRange=()=>{}; export const setMove=()=>{};
    export const toggleExtrusionRole=()=>{}; export const toggleOption=()=>{};
    export const LayerSlider=()=>null; export const MoveSlider=()=>null;
    export const ViewTypeLegend=()=>null; export const SliceStatsPanel=()=>null;
    export const CustomGcodeDialog=()=>null; export const PlateSelectorBar=()=>null;
    export const GCodeWindow=()=>null;`;
  const bundle = await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';
      import{PreviewView}from'./src/preview/PreviewView';
      import{usePreviewStore}from'./src/preview/previewStore';import*as fixture from'fixture';
      window.fixture={...fixture,usePreviewStore};window.root=createRoot(document.getElementById('root'));
      window.loadPreview=value=>fixture.useAppStore.setState({sliceResult:{gcode:new Uint8Array([value])}});
      window.renderPreview=(active=true)=>window.root.render(<PreviewView active={active}/>);window.renderPreview();`,loader:'tsx',resolveDir},
    bundle:true,write:false,format:'iife',loader:{'.css':'empty'},plugins:[{name:'native-boundary',setup(b){
      b.onResolve({filter:/^fixture$|\/(appStore|prefsStore|i18n|canvasTouch|bedAssets|bedModelOutline|orcaPreviewModule|LayerSlider|MoveSlider|ViewTypeLegend|SliceStatsPanel|CustomGcodeDialog|PlateSelectorBar|GCodeWindow)$/},()=>({path:'fixture',namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,resolveDir}));
      b.onResolve({filter:/\/MobilePreview$/},()=>({path:'mobile',namespace:'mobile'}));
      b.onLoad({filter:/.*/,namespace:'mobile'},()=>({contents:`import React from'react';export const MobilePreview=({canvas})=>React.createElement('div',null,canvas);`,resolveDir}));
    }}]});
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:900,height:844}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setContent('<div id="root" style="height:700px"></div>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.waitForFunction(()=>window.fixture.usePreviewStore.getState().layersCount===12);
    await page.evaluate(()=>window.fixture.usePrefsStore.setState(state=>({display:{...state.display,previewShowFps:true}})));
    await page.waitForFunction(()=>window.fixture.performanceListeners.size===1);
    await page.evaluate(()=>window.fixture.publishPerformance({idle:false,fps:48,cpuMs:1.25}));
    await page.waitForFunction(()=>document.querySelector('.preview-performance')?.textContent==='48 FPSCPU 1.3 ms');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
    assert.equal(await page.evaluate(()=>window.fixture.performanceListeners.size),0,'hidden document detaches measurement');
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});
    await page.waitForFunction(()=>window.fixture.performanceListeners.size===1);
    await page.evaluate(()=>window.renderPreview(false));
    await page.waitForFunction(()=>window.fixture.performanceListeners.size===0);
    assert.equal(await page.locator('.preview-performance').count(),0,'inactive Preview removes the overlay');
    await page.evaluate(()=>window.renderPreview());
    await page.waitForFunction(()=>window.fixture.performanceListeners.size===1);
    await page.evaluate(()=>window.fixture.useAppStore.setState({sliceResult:null}));
    await page.setViewportSize({width:390,height:844});
    await page.locator('.mobile-preview').waitFor();
    await page.waitForFunction(()=>window.fixture.usePreviewStore.getState().isInitialized);
    assert.equal(await page.evaluate(()=>window.fixture.getLayersCount()),0);
    assert.equal(await page.evaluate(()=>window.fixture.usePreviewStore.getState().layersCount),0,
      'disposed toolpaths must not leave loaded controls attached to an empty native viewer');
    assert.equal(await page.evaluate(()=>window.fixture.usePreviewStore.getState().stats),null);
    await page.evaluate(()=>window.fixture.useAppStore.setState({sliceResult:{gcode:new Uint8Array([2])}}));
    await page.waitForFunction(()=>window.fixture.usePreviewStore.getState().layersCount===12);
    await page.setViewportSize({width:900,height:844});
    await page.locator('#orca-preview-view:not(.mobile-preview)').waitFor();
    await page.waitForFunction(()=>window.fixture.usePreviewStore.getState().isInitialized&&window.fixture.getLayersCount()===12);
    assert.equal(await page.evaluate(()=>window.fixture.usePreviewStore.getState().layersCount),12);
    await page.evaluate(()=>window.fixture.usePrefsStore.setState(state=>({display:{...state.display,previewShowFps:false}})));
    await page.waitForFunction(()=>window.fixture.performanceListeners.size===0);
    await page.evaluate(()=>window.fixture.usePrefsStore.setState(state=>({display:{...state.display,previewShowFps:true}})));
    await page.waitForFunction(()=>window.fixture.performanceListeners.size===1);
    await page.waitForFunction(()=>document.querySelector('canvas[data-preview-ready]'));
    await page.evaluate(()=>window.loadPreview(3));
    await page.waitForFunction(()=>window.fixture.pendingLoads.length===1);
    const previousFrame = await page.evaluate(()=>window._previewFirstFrameTime);
    await page.evaluate(()=>window.loadPreview(4));
    await page.waitForFunction(()=>window.fixture.pendingLoads.length===2);
    await page.evaluate(()=>window.fixture.pendingLoads[1].finish());
    await page.waitForFunction(previous=>window._previewFirstFrameTime>previous, previousFrame);
    const rejectPreparation = (index, message, name) => page.evaluate(async ({ index, message, name }) => {
      window.fixture.pendingLoads[index].fail(message, name);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    }, { index, message, name });
    const overlay = () => page.evaluate(()=>document.querySelector('#preview-error-overlay')?.textContent ?? null);
    await rejectPreparation(0, 'Preview preparation canceled', 'AbortError');
    assert.equal(await overlay(), null, 'a canceled preparation must not overlay the winning preview');
    assert.equal(await page.evaluate(()=>window.fixture.getLoadedValue()), 4);

    await page.evaluate(()=>window.loadPreview(5));
    await page.waitForFunction(()=>window.fixture.pendingLoads.length===3);
    const winningFrame = await page.evaluate(()=>window._previewFirstFrameTime);
    await page.evaluate(()=>window.renderPreview(false));
    await page.waitForFunction(()=>window.fixture.pendingLoads.length===4);
    await rejectPreparation(2, 'obsolete parser failure');
    assert.equal(await overlay(), null, 'a superseded failure must not write an error');
    assert.equal(await page.evaluate(()=>window.fixture.usePreviewStore.getState().isLoading), true);
    assert.equal(await page.evaluate(()=>window._previewFirstFrameTime), winningFrame,
      'old toolpaths must not mark the pending G-code as frame ready');

    await rejectPreparation(3, 'Preview preparation canceled', 'AbortError');
    assert.equal(await overlay(), null, 'canceling the current load leaves the previous preview visible');
    assert.equal(await page.evaluate(()=>window.fixture.usePreviewStore.getState().isLoading), false);
    assert.equal(await page.evaluate(()=>window.fixture.getLoadedValue()), 4);

    await page.evaluate(()=>window.loadPreview(6));
    await page.waitForFunction(()=>window.fixture.pendingLoads.length===5);
    await rejectPreparation(4, 'current parser failure');
    assert.match(await overlay(), /Preview Initialization Error.*current parser failure/);

    await page.evaluate(()=>window.root.unmount());
    assert.equal(await page.evaluate(()=>window.fixture.performanceListeners.size),0,'unmount removes the observer');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
