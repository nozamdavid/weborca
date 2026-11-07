import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from '../../build/web-smoke/node_modules/playwright/index.mjs';

const appDir = new URL('../../app/', import.meta.url).pathname;
const fixture = `
import React from 'react';
import { create } from 'zustand';
export const calls = [];
export const useAppStore = create(() => ({
  sliceResult: { plateIndex: 0, gcode: new TextEncoder().encode('; total filament cost = 0.42\\n; filament used [mm] = 2200\\n; filament used [g] = 6.6'), warnings: [] },
  modelFile: {name: 'fixture.stl'}, selectedFilaments: ['Fixture PLA'], currentConfig: {filament_colour:'#008172'},
  selectedPrinter:'Fixture printer', selectedProcess:'Fixture process', isSlicing:false, engineError:null,
  isEngineReady:true,isSelectingPreset:false,isModelLoading:false,pendingOptions:{},startSlice:()=>calls.push(['slice']),
  openGcodeFile: file => calls.push(['open',file.name])
}));
const legend = {title:'Line Type',type:'features',items:[{id:2,name:'Outer wall',color:'#ff7d38',visible:true,timeS:70}],
  options:[{id:4,name:'Travel',color:'#38489b',visible:false}]};
export const usePreviewStore = create((set,get) => ({
  isInitialized:true,isLoading:false,layersCount:12,layersZs:Array.from({length:12},(_,i)=>(i+1)*.2),
  minLayer:0,maxLayer:11,minMove:10,maxMove:110,currentMove:110,viewType:'FeatureType',showGcodeWindow:false,legend,
  stats:{layers:12,timeS:125,filamentMm:2200,filamentG:6.6,features:[{name:'Outer wall',timeS:70,percent:56}]},
  setLayerRangeAction:(minLayer,maxLayer)=>{calls.push(['layers',minLayer,maxLayer]);set({minLayer,maxLayer})},
  resetLayersAction:()=>set({minLayer:0,maxLayer:11}),
  setViewTypeAction:viewType=>{calls.push(['scheme',viewType]);set({viewType})},
  toggleExtrusionRoleAction:id=>{calls.push(['role',id]);set({legend:{...get().legend,items:get().legend.items.map(i=>({...i,visible:!i.visible}))}})},
  toggleOptionAction:id=>{calls.push(['option',id]);set({legend:{...get().legend,options:get().legend.options.map(i=>({...i,visible:!i.visible}))}})},
  toggleGcodeWindowAction:()=>set({showGcodeWindow:!get().showGcodeWindow}),
  setMoveAction:currentMove=>{calls.push(['move',currentMove]);set({currentMove})}
}));
export const usePrefsStore = create((set,get)=>({display:{previewLowQuality:false,previewLighting:true,previewShowFps:false},setDisplayPref:(key,value)=>set({display:{...get().display,[key]:value}})}));
export const usePlatesStore = create(()=>({activePlateIndex:0}));
export const usePrinterConnectionStore = create(set=>({sendDialogOpen:false,openSendDialog:()=>{calls.push(['send']);set({sendDialogOpen:true})}}));
export const useHistoryStore = create(()=>({}));
export const exportGcode = ()=>calls.push(['export']);
export const useTranslation = ()=>({t:key=>key});
export const SavedPrinterSelector = ()=>null;
export const SettingInput = ()=>null;
export const SendToPrinterDialog = ({getGcode,defaultFilename})=>usePrinterConnectionStore(s=>s.sendDialogOpen)
  ? React.createElement('div',{role:'dialog','aria-label':'Send fixture'},defaultFilename,
      React.createElement('button',{onClick:()=>usePrinterConnectionStore.setState({sendDialogOpen:false})},'Close send'),
      React.createElement('span',null,getGcode()?.length?'G-code ready':'No G-code')) : null;
export const getMoveGcodeLine = ()=>0;
`;

test('mobile preview sheets retain live actions and state, export, and honest empty/error states', async () => {
  const bundled = await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MobilePreview} from './src/preview/MobilePreview'; import * as fixture from 'fixture';
    window.fixture=fixture; const root=createRoot(document.getElementById('root'));
    window.renderPreview=(props={})=>root.render(<div id="orca-preview-view" className="mobile-preview mp-root"><MobilePreview active loading={false} error={null}
      canvas={<canvas id="canvas" />} resetCamera={()=>fixture.calls.push(['camera'])} {...props}/></div>);
    window.renderPreview();`,loader:'tsx',resolveDir:appDir},
    bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'empty'},
    plugins:[{name:'engine-free-component-fixture',setup(build){
      build.onResolve({filter:/^(fixture)$|\/(appStore|previewStore|prefsStore|platesStore|connectionStore|exportGcode|i18n|history|SettingInput|SavedPrinterSelector|SendToPrinterDialog|orcaPreviewModule)$/},()=>({path:'fixture',namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,resolveDir:appDir}));
    }}]});
  const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  try {
    const css = (await Promise.all(['index.css','design/tokens.css','design/components.css','shell/theme.css','mobile/mobile.css','mobile/mobileShell.css','components/dialog.css','preview/MobilePreview.css','design/legacy.css'].map(path=>readFile(`${appDir}src/${path}`,'utf8')))).join('\n');
    await page.setContent(`<style>body{margin:0;background:#232327}#root{height:680px}${css}</style><div id="root"></div>`);
    await page.addScriptTag({content:bundled.outputFiles[0].text});
    assert.equal(await page.locator('#move-slider-container, #move-slider, #btn-play-moves').count(),0,'mobile preview omits move scrubbing and playback');
    assert.equal(await page.getByRole('slider').count(),1,'mobile preview retains only the layer slider');
    const controls=page.getByRole('button',{name:'Preview controls',exact:true});
    await controls.click();
    const dialog=page.getByRole('dialog',{name:'Preview controls',exact:true});
    await dialog.waitFor();
    for(const width of [320,390]) for(const scale of [100,125]) {
      await page.setViewportSize({width,height:844});
      await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale}%`,scale);
      assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true,`${width}px controls sheet wraps`);
      assert.equal(await dialog.getByRole('checkbox',{name:'Travel'}).evaluate(el=>Math.round(el.getBoundingClientRect().width)),40);
      assert.equal(await dialog.getByRole('checkbox',{name:'Travel'}).evaluate(el=>el.closest('label').getBoundingClientRect().height>=48),true);
      assert.equal(await dialog.locator('.mp-swatch').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 125, 56)','feature data swatch retains its color');
      const schemeStyle=await dialog.getByRole('combobox',{name:'Color Scheme'}).evaluate(el=>{
        const css=getComputedStyle(el);
        return {appearance:css.appearance,image:css.backgroundImage,padding:css.paddingRight};
      });
      assert.equal(schemeStyle.appearance,'none');
      assert.match(schemeStyle.image,/data:image\/svg\+xml/,'Preview styles preserve the shared inset chevron');
      assert.equal(schemeStyle.padding,'48px','Preview preserves space between selected text and chevron');
      const last=dialog.getByRole('checkbox',{name:'G-code',exact:true});
      await last.scrollIntoViewIfNeeded();
      assert.ok(await last.evaluate(el=>{
        const r=el.closest('label').getBoundingClientRect(),body=el.closest('.wm-content').getBoundingClientRect();
        const footer=el.closest('.wm-sheet').querySelector('footer').getBoundingClientRect();
        return r.height>=48 && r.top>=body.top && r.bottom<=body.bottom && r.bottom<=footer.top;
      }),`${width}/${scale}: last control scrolls above footer`);
      assert.equal(await dialog.getByRole('checkbox',{name:'Outer wall'}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(101, 101, 106)','checked switch retains neutral track');
      for(const name of ['Outer wall','Travel']) assert.deepEqual(await dialog.getByRole('checkbox',{name}).evaluate(el=>{
        const thumb=getComputedStyle(el,'::after');return {transform:thumb.transform,border:thumb.borderWidth,width:thumb.width,height:thumb.height,radius:getComputedStyle(el).borderRadius};
      }),{transform:'none',border:'0px',width:'16px',height:'16px',radius:'12px'},`${name}: switch thumb stays visible in both states with legacy checkbox styles`);
      if(process.env.EVIDENCE_DIR) await page.screenshot({path:`${process.env.EVIDENCE_DIR}/preview-controls-${width}-${scale}.png`});
    }
    await dialog.getByRole('button',{name:'Done',exact:true}).focus();
    await page.keyboard.press('Tab');
    assert.equal(await dialog.getByRole('button',{name:'Close',exact:true}).evaluate(el=>document.activeElement===el),true,'Tab wraps within shared Dialog');
    await dialog.getByRole('combobox',{name:'Color Scheme'}).selectOption('Speed');
    await dialog.getByRole('checkbox',{name:'Outer wall'}).uncheck();
    await dialog.getByRole('checkbox',{name:'Travel'}).check();
    await dialog.getByRole('spinbutton',{name:'Bottom visible layer'}).fill('3');
    await dialog.getByRole('spinbutton',{name:'Top visible layer'}).fill('8');
    await dialog.getByRole('checkbox',{name:'Low quality'}).check();
    await dialog.getByRole('checkbox',{name:'Lighting & shadows'}).uncheck();
    await dialog.getByRole('checkbox',{name:'Show FPS'}).check();
    assert.deepEqual(await page.evaluate(()=>window.fixture.usePrefsStore.getState().display), {previewLowQuality:true,previewLighting:false,previewShowFps:true});
    await dialog.getByRole('checkbox',{name:'Low quality'}).uncheck();
    assert.equal(await dialog.getByRole('checkbox',{name:'Lighting & shadows'}).isChecked(), false);
    await dialog.getByRole('button',{name:'Reset camera'}).click();
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'detached'});
    assert.equal(await controls.evaluate(el=>document.activeElement===el),true,'shared Dialog restores focus');
    await controls.click();
    assert.equal(await dialog.getByRole('combobox',{name:'Color Scheme'}).inputValue(),'Speed');
    assert.equal(await dialog.getByRole('checkbox',{name:'Travel'}).isChecked(),true);
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    const layerSlider=page.getByRole('slider',{name:/Top visible layer/});
    await layerSlider.fill('5');
    assert.deepEqual(await page.evaluate(()=>{const {minLayer,maxLayer}=window.fixture.usePreviewStore.getState();return [minLayer,maxLayer];}),[2,5]);
    await page.getByRole('button',{name:'All layers',exact:true}).click();
    assert.equal(await layerSlider.inputValue(),'11');
    await page.getByRole('button',{name:/Slicing statistics/}).click();
    const stats=page.getByRole('dialog',{name:'Slicing statistics',exact:true});
    await stats.waitFor();
    for(const width of [320,390]) for(const scale of [100,125]) {
      await page.setViewportSize({width,height:844});
      await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale}%`,scale);
      assert.equal(await stats.evaluate(el=>el.scrollWidth<=el.clientWidth),true,`${width}px statistics sheet wraps`);
      assert.equal(await stats.locator('dd').first().evaluate(el=>getComputedStyle(el).fontVariantNumeric),'tabular-nums');
      await stats.getByRole('button',{name:'Send to printer'}).scrollIntoViewIfNeeded();
      if(process.env.EVIDENCE_DIR) await page.screenshot({path:`${process.env.EVIDENCE_DIR}/preview-stats-${width}-${scale}.png`});
    }
    assert.match(await stats.innerText(),/2m 5s/); assert.match(await stats.innerText(),/6.60 g/);
    assert.match(await stats.innerText(),/0.42/); assert.match(await stats.innerText(),/Fixture PLA/);
    await stats.getByRole('button',{name:'Download G-code'}).click();
    await stats.getByRole('button',{name:'Send to printer'}).click();
    await page.getByRole('dialog',{name:'Send fixture'}).getByRole('button',{name:'Close send'}).dispatchEvent('click');
    await stats.getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('.mp-footer').getByRole('button',{name:'Send to printer',exact:true}).click();
    assert.match(await page.getByRole('dialog',{name:'Send fixture'}).innerText(),/fixture.gcode.*G-code ready/s,'footer mounts the send dialog with the current G-code');
    await page.getByRole('dialog',{name:'Send fixture'}).getByRole('button',{name:'Close send'}).dispatchEvent('click');
    assert.equal((await page.evaluate(()=>window.fixture.calls)).filter(c=>c[0]==='send').length,2,'footer reaches the existing send action');
    for(const width of [320,390]) for(const scale of [100,125]) {
      await page.setViewportSize({width,height:844});
      await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale}%`,scale);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px loaded preview wraps`);
      assert.equal(await page.locator('#canvas').evaluate(el=>Math.abs(el.getBoundingClientRect().width-el.parentElement.clientWidth)<1),true,'canvas fills mobile viewport');
      const primary=page.getByRole('button',{name:'Export G-code',exact:true});
      assert.equal(await primary.isEnabled(),true);
      await page.keyboard.press('Tab');await primary.focus();
      const chrome=await primary.evaluate(el=>{const css=getComputedStyle(el),box=el.getBoundingClientRect();
        return {background:css.backgroundColor,text:css.color,focus:css.outlineColor,outline:css.outlineWidth,
          visible:el.matches(':focus-visible'),width:box.width,height:box.height};});
      assert.equal(chrome.background,'rgb(229, 229, 228)');
      assert.equal(chrome.text,'rgb(35, 35, 39)');
      assert.equal(chrome.focus,'rgb(245, 245, 245)');
      assert.equal(chrome.outline,'3px');assert.equal(chrome.visible,true);
      assert.ok(chrome.width>=48 && chrome.height>=48);
      assert.equal(await layerSlider.evaluate(el=>getComputedStyle(el).accentColor),'rgb(229, 229, 228)');
      console.log('NEUTRAL_PREVIEW',width,JSON.stringify(chrome));
      assert.ok(await primary.evaluate(el=>{
        const box=el.getBoundingClientRect();return box.top>=0 && box.bottom<=innerHeight;
      }),`${width}/${scale}: export footer remains visible`);
      if(process.env.EVIDENCE_DIR) await page.screenshot({path:`${process.env.EVIDENCE_DIR}/preview-loaded-${width}-${scale}.png`});
    }
    await page.getByRole('button',{name:'Export G-code',exact:true}).click();
    const calls=await page.evaluate(()=>window.fixture.calls);
    for(const expected of [['scheme','Speed'],['role',2],['option',4],['layers',2,7],['layers',2,5],['camera'],['send']])
      assert.ok(calls.some(call=>JSON.stringify(call)===JSON.stringify(expected)),JSON.stringify(expected));
    assert.equal(calls.filter(call=>call[0]==='export').length,2);
    // Raw G-code must not inherit unrelated selected preset names in statistics.
    await page.evaluate(()=>window.fixture.useAppStore.setState({modelFile:{name:'loaded.gcode'}}));
    await page.getByRole('button',{name:/Slicing statistics/}).click();
    assert.ok(!(await stats.innerText()).includes('Fixture process'));
    assert.match(await stats.innerText(),/loaded G-code/);
    await stats.getByRole('button',{name:'Close',exact:true}).click();
    await page.evaluate(()=>window.fixture.useAppStore.setState({sliceResult:null}));
    assert.equal(await page.locator('.mp-footer').getByRole('button',{name:'Send to printer',exact:true}).count(),0,'stale result has no send entry');
    await page.getByRole('button',{name:'Re-slice',exact:true}).click();
    assert.ok((await page.evaluate(()=>window.fixture.calls)).some(c=>c[0]==='slice'));
    assert.equal(await page.getByRole('button',{name:'Export G-code',exact:true}).isDisabled(),true);
    // Empty, busy and failed preview states expose no export or viewing actions.
    await page.evaluate(()=>{window.fixture.useAppStore.setState({sliceResult:null});window.fixture.usePreviewStore.setState({layersCount:0,stats:null});});
    await page.getByRole('heading',{name:'No G-code toolpaths loaded'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Export G-code',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Open G-code',exact:true}).click({trial:true});
    await page.locator('input[type=file]').setInputFiles({name:'import.gcode',mimeType:'text/plain',buffer:Buffer.from('G1 X1 E1')});
    assert.ok((await page.evaluate(()=>window.fixture.calls)).some(c=>c[0]==='open'&&c[1]==='import.gcode'));
    await page.evaluate(()=>window.renderPreview({error:'Synthetic WebGL failure'}));
    await page.getByText('Synthetic WebGL failure').waitFor();
    assert.equal(await page.getByRole('button',{name:'Export G-code',exact:true}).isDisabled(),true);
    for(const width of [320,390]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px body wraps`);
      assert.equal(await page.getByRole('button',{name:'Open G-code',exact:true}).evaluate(el=>el.getBoundingClientRect().height>=48),true);
    }
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});
