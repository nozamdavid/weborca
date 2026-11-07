// Focused component seam: real App, mobile shell, dialogs and setting inputs;
// synthetic stores and inert engine/3D/device boundaries. No integrated build.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

const resolveDir = new URL('../../app', import.meta.url).pathname;
const stubs = {
  appStore: `import { create } from 'zustand';
    export const resolveDeviceVendor=async()=>undefined;
    export const withPrinterProfileSelection=async action=>action();
    export const pendingOptionKey = (...parts) => parts.join(':');
    export const useAppStore = create((set, get) => ({
      isIsolated:true, isEngineReady:true, initApp(){}, sessionRecovery:'idle', sliceResult:null,
      isSlicing:false, isModelLoading:false, isSelectingPreset:false, pendingOptions:{}, engineError:null,
      selectedPrinter:'Fixture printer', selectedProcess:'Fixture process', selectedFilament:'Fixture PLA',
      selectedFilaments:[], activeUserPreset:{}, userPresets:[],
      processes:[{name:'Fixture process',isCompatible:true}], filaments:[{name:'Fixture PLA',isCompatible:true}],
      currentConfig:{nozzle_diameter:'0.4,0.6', layer_height:'0.2', initial_layer_print_height:'0.24', seam_position:'aligned', staggered_inner_seams:'0', travel_speed:'100%'},
      presetConfig:{nozzle_diameter:'0.4,0.6', layer_height:'0.2', initial_layer_print_height:'0.24', seam_position:'aligned', staggered_inner_seams:'0', travel_speed:'100%'},
      configDefs:{nozzle_diameter:{type:'floats',label:'Nozzle diameter',mode:'simple',min:0.1,max:2,sidetext:'mm'},
        layer_height:{type:'float',label:'Layer height',mode:'simple',min:0.01,max:1,sidetext:'mm'},
        initial_layer_print_height:{type:'float',label:'First layer height',mode:'simple',min:0.01,max:1,sidetext:'mm'},
        seam_position:{type:'enum',label:'Seam position',mode:'advanced',enumValues:['aligned','random']},
        staggered_inner_seams:{type:'bool',label:'Staggered inner seams',mode:'advanced'},
        travel_speed:{type:'floatOrPercent',label:'First layer travel acceleration with a long setting label',mode:'simple',sidetext:'mm/s or %'}},
      layout:{tabs:[{id:'print',pages:[{title:'Quality',groups:[{title:'Layer height',lines:[{type:'option',key:'layer_height'},{type:'option',key:'initial_layer_print_height'}]},
        {title:'Seam',lines:[{type:'option',key:'seam_position'},{type:'option',key:'staggered_inner_seams'}]}]},
        {title:'Strength',groups:[{title:'Walls',lines:[{type:'option',key:'layer_height'},
          {type:'option',key:'travel_speed'},{type:'line',label:'Travel acceleration',options:['travel_speed']}]}]}]}]},
      rulesState:{fields:{},fixes:[],messages:[]}, settingsMode:'advanced',
      setSettingsMode(settingsMode){set({settingsMode})},
      async applyOptionChange(key,value,kind,index){
        if(key==='nozzle_diameter') {window.__nozzleWrite={key,value,kind,index};const cells=get().currentConfig[key].split(',');cells[index]=value;set({currentConfig:{...get().currentConfig,[key]:cells.join(',')}});return;}
        window.__writes.push({key,value,kind});
        if(window.__failKey===key){set({engineError:'Fixture engine failure'});return;}
        set({engineError:null,currentConfig:{...get().currentConfig,[key]:value}})},
      resetOption(){throw Error('draft must never reset the engine')}, closeDialog(){}, openDialog(){},
      openManagePresetsDialog(){}, saveProjectFile(){}, requestImportFile(){}, cancelSlice(){},
    })); window.__appStore=useAppStore; window.__writes=[];`,
  i18n: `export const useTranslation=()=>({t:(key,args={})=>(window.__longLabels ? ({'Printer':'Impresora seleccionada para este proyecto', 'First layer height':'Altura de la primera capa para este proyecto', 'Search Quality settings':'Buscar ajustes de calidad de impresión'}[key]??key) : key).replaceAll('{{count}}',args.count??'')});`,
  orcaEngine: `export const disposeEngine=()=>{}; export const getOption=async({key,layoutIndex,serializedValue})=>({value:key==='nozzle_diameter'?(serializedValue??window.__appStore.getState().currentConfig[key]).split(',')[layoutIndex]:''}); export const getEngine=async()=>({call:async()=>null});`,
  prefs: `export const usePrefsStore=select=>select({display:{showSidebar:true,theme:'dark',fontScale:100}}); export const PreferencesDialog=()=>null;`,
  prefsStore: `export const usePrefsStore={getState:()=>({openDialog:tab=>{window.__preferencesTab=tab}})};`,
  history: `export const useHistoryStore=select=>{const state={canUndo:false,canRedo:false,isRestoring:false};return select?select(state):state};`,
  platesStore: `export const usePlatesStore=()=>({plates:[{index:0,name:'Plate 1',instances:[{objectId:1,instanceId:1}]}],activePlateIndex:0});`,
  plateStore: `import {create} from 'zustand'; export const usePlateStore=create((set,get)=>({objects:[],extraSelection:[],gizmoMode:null,
    getMesh:async()=>({positions:new Float32Array([0,0,0,20,0,0,0,30,0,0,0,40]),indices:new Uint32Array([0,1,2,0,2,3])}),
    setInstanceTransform(objectId,instanceId,transform){window.__transforms.push(transform);set({objects:get().objects.map(object=>object.id===objectId?({...object,instances:object.instances.map(instance=>instance.id===instanceId?({...instance,...transform}):instance)}):object)});}
  })); window.__plateStore=usePlateStore;window.__transforms=[];`,
  objectListStore: `export const useObjectListStore=select=>select({selectedVolumeId:null});`,
  PlateView: `import React from 'react';export const PlateView=()=>React.createElement('div',{className:'plate-view'},
    ...['view-cube','selection-panel','plate-toolbar','plate-selector-bar'].map(id=>React.createElement('div',{id,key:id},id)),React.createElement('div',{className:'view-buttons'},'Views'));`,
  PreviewView: `import React from 'react';export const PreviewView=()=>React.createElement('p',null,'Preview boundary');`,
  printers: `import React from 'react';export const DevicePanel=()=>React.createElement('p',null,'Device boundary');export const PrinterConnectionDialog=()=>null;`,
  CalibrationPage: `import React from 'react';export const CalibrationPage=()=>React.createElement('p',null,'Calibration boundary');`,
  connectionStore: `export const usePrinterConnectionStore={getState:()=>({selectedPrinterId:null})};`,
  toastStore: `export const showToast=()=>{};`,
};
for (const [module, names] of Object.entries({
  wizard:['WizardDialog'], CloudDialog:['CloudDialog'], CloudStartup:['CloudStartup'], CloudAutoSync:['CloudAutoSync'],
  ComparePresetsDialog:['ComparePresetsDialog'], FlowRateModal:['FlowRateModal'], OtherCalibrationsDialogs:['OtherCalibrationsDialogs'],
  OtherCalibrationsMenu:['OtherCalibrationsMenu'], ErrorBanner:['ErrorBanner'], IsolationNotice:['IsolationNotice'], StepImportModal:['StepImportModal'],
  ManagePresetsDialog:['ManagePresetsDialog'], FixesDialog:['FixesDialog'], SavePresetDialog:['SavePresetDialog'], SettingsDialog:['SettingsDialog'],
  HelpDialogs:['HelpDialogs'], PrepareSidebar:['PrepareSidebar'], TopBar:['TopBar'], SlicingGuard:['SlicingGuard'], RecoveryDialog:['RecoveryDialog'],
  ProjectNotesDialog:['ProjectNotesDialog'], SlicingWarningsDialog:['SlicingWarningsDialog'], Toast:['ToastContainer'], editops:['EditOpsDialogs'],
  ObjectListPanel:['ObjectListPanel'], exportGcode:['exportGcode']
})) stubs[module] = names.map(name=>`export const ${name}=()=>null;`).join('\n');
stubs.wizard += `export const useWizardStore=select=>select({addedPrinters:['Fixture printer','Other printer']});`;

const bundle = await build({ stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client';
  import {App} from './src/App'; import {NumericTransform} from './src/plate/NumericTransform'; import './src/index.css';
  const root=createRoot(document.getElementById('root'));root.render(<App/>);
  window.__desktopNumeric=()=>{const object=window.__plateStore.getState().objects[0];root.render(<NumericTransform object={object} instance={object.instances[0]}/>)};`,loader:'tsx',resolveDir},
  bundle:true,write:false,outdir:'/virtual',entryNames:'ui',platform:'browser',format:'esm',external:['/fonts/*','/icons/*'],
  plugins:[{name:'bounded-mobile-components',setup(build){
    build.onResolve({filter:/\//},args=>{const name=args.path.split('/').at(-1);if(name in stubs)return {path:name,namespace:'fixture'};});
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],resolveDir}));
  }}] });
const js = bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const server = createServer((req,res)=>{
  if(req.url==='/ui.js'){res.setHeader('Content-Type','text/javascript');res.end(js);}
  else if(req.url==='/ui.css'){res.setHeader('Content-Type','text/css');res.end(css);}
  else if(req.url.startsWith('/icons/') || req.url.startsWith('/fonts/')){res.writeHead(204);res.end();}
  else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><div id="root"></div><script type="module" src="/ui.js"></script>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
  await page.goto(origin);
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  for(const name of ['Preview','Device','Calibration','Prepare']){
    await nav.getByRole('button',{name,exact:true}).click();
    assert.equal(new URL(page.url()).pathname,`/${name.toLowerCase()}`);
    assert.equal(await nav.getByRole('button',{name,exact:true}).getAttribute('aria-current'),'page');
    assert.equal(await page.locator('.tab-page:not([hidden])').count(),1);
  }
  await page.goBack();
  assert.equal(await nav.getByRole('button',{name:'Calibration',exact:true}).getAttribute('aria-current'),'page');
  await nav.getByRole('button',{name:'Prepare',exact:true}).click();
  for(const name of ['imported.gcode','empty-plate.stl']) {
    await page.evaluate(name=>window.__appStore.setState({modelFile:{name}}),name);
    assert.equal(await page.getByRole('button',{name:'Slice plate',exact:true}).isDisabled(),true);
    await page.locator('#mobile-slice-readiness').filter({hasText:'Add a model to slice.'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Slice plate',exact:true}).getAttribute('aria-describedby'),'mobile-slice-readiness');
  }
  await page.evaluate(()=>window.__appStore.setState({modelFile:null}));

  // Exercise both actual native mode selects, including the screenshot's Advanced state.
  // Measure painted pixels: native appearance/padding alone cannot prove arrow inset.
  const arrowEvidence=process.env.EVIDENCE_DIR ?? 'wasm/build/tests-mobile-process-dropdown/fix';
  const spacingEvidence=process.env.EVIDENCE_DIR ?? 'wasm/build/tests-ui-spacing/mobile/fix';
  async function sheetSpacing(dialog,label,width,scale) {
    const body=dialog.locator('.wm-content');
    await body.evaluate(node=>{node.scrollTop=0;});
    await page.screenshot({animations:'disabled',path:`${spacingEvidence}/${process.env.PHASE ?? 'after'}-${label}-${width}-${scale}.png`});
    const geometry=await body.evaluate(node=>{
      const style=getComputedStyle(node),box=node.getBoundingClientRect();
      return {padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft].map(parseFloat),
        gap:parseFloat(style.gap),overflow:style.overflowY,client:node.clientWidth,scroll:node.scrollWidth,
        children:[...node.children].filter(child=>child.getClientRects().length).map(child=>{const r=child.getBoundingClientRect();return {left:r.left-box.left,right:box.right-r.right,top:r.top,bottom:r.bottom};}),
        groups:[...node.querySelectorAll('.wm-card,.settings-group')].map(child=>{const r=child.getBoundingClientRect();return {left:r.left-box.left,right:box.right-r.right,top:r.top,bottom:r.bottom};})};
    });
    console.log('SHEET_SPACING',label,width,scale,JSON.stringify(geometry));
    const inset=width<=340?12:16;
    assert.deepEqual(geometry.padding,[20,inset,24,inset],`${label}: safe body padding and scroll-end space`);
    assert.equal(geometry.gap,24,`${label}: section gap`);
    assert.equal(geometry.overflow,'auto',`${label}: scrollable body`);
    assert.ok(geometry.scroll<=geometry.client,`${label}: no horizontal overflow`);
    for(const child of [...geometry.children,...geometry.groups]) {
      assert.ok(child.left>=inset-1 && child.right>=inset-1,`${label}: contained section ${JSON.stringify(child)}`);
    }
    for(let i=1;i<geometry.children.length;i++) assert.ok(geometry.children[i].top-geometry.children[i-1].bottom>=15,`${label}: separate sections`);
    for(let i=1;i<geometry.groups.length;i++) assert.ok(geometry.groups[i].top-geometry.groups[i-1].bottom>=15,`${label}: separate groups`);
    assert.ok(await body.evaluate(node=>{
      const box=node.getBoundingClientRect(),inset=parseFloat(getComputedStyle(node).paddingLeft);
      return [...node.querySelectorAll('.setting-control-wrapper,.setting-unit,.setting-label')].every(child=>{
        const r=child.getBoundingClientRect();return r.left>=box.left+inset-1 && r.right<=box.right-inset+1 && child.scrollWidth<=child.clientWidth+1;
      });
    }),`${label}: setting labels, units and grouped controls fit`);
    const details=body.locator('details[open]');
    if(await details.count()) assert.ok(await details.evaluate(node=>node.querySelector('.wm-stack').getBoundingClientRect().top-node.querySelector('summary').getBoundingClientRect().bottom)>=16,`${label}: expanded actions gap`);
    const last=body.locator('input:visible:not(:disabled),select:visible:not(:disabled),button:visible:not(:disabled),summary:visible').last();
    if(await last.count()) {
      await last.focus();
      assert.equal(await last.evaluate(node=>document.activeElement===node),true,`${label}: editing focus`);
      await last.scrollIntoViewIfNeeded();
      assert.ok(await last.evaluate(node=>{
        const rect=node.getBoundingClientRect(),body=node.closest('.wm-content').getBoundingClientRect();
        const footer=node.closest('.wm-sheet').querySelector('footer')?.getBoundingClientRect();
        return rect.top>=body.top && rect.bottom<=body.bottom && (!footer || rect.bottom<=footer.top);
      }),`${label}: last control reachable above footer`);
      await page.screenshot({animations:'disabled',path:`${spacingEvidence}/${process.env.PHASE ?? 'after'}-${label}-last-${width}-${scale}.png`});
    }
    await body.evaluate(node=>{node.scrollTop=0;});
  }
  async function nativeArrow(control, label, width, scale) {
    await control.scrollIntoViewIfNeeded();
    await control.evaluate(node=>node.blur());
    const box=await control.boundingBox();
    const image=(await control.screenshot({animations:'disabled',path:`${arrowEvidence}/${process.env.PHASE ?? 'fixed'}-${label}-${width}-${scale}.png`})).toString('base64');
    const pixels=await page.evaluate(async image=>{
      const img=new Image();img.src=`data:image/png;base64,${image}`;await img.decode();
      const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
      const {data}=ctx.getImageData(0,0,img.width,img.height);const points=[];
      for(let y=Math.floor(img.height/2)-8;y<=Math.ceil(img.height/2)+8;y++)
        for(let x=img.width-38;x<img.width-1;x++) {
          const i=(y*img.width+x)*4;
          if(data[i]>170 && data[i+1]>170 && data[i+2]>170)points.push([x,y]);
        }
      return {width:img.width,height:img.height,points};
    },image);
    assert.ok(pixels.points.length>5,`${label}: visible arrow pixels`);
    const xs=pixels.points.map(p=>p[0]),ys=pixels.points.map(p=>p[1]);
    const inset=pixels.width-1-Math.max(...xs), arrowWidth=Math.max(...xs)-Math.min(...xs)+1;
    console.log('NATIVE_ARROW',JSON.stringify({label,width,scale,inset,arrowWidth,top:Math.min(...ys),bottom:Math.max(...ys),controlWidth:box.width}));
    assert.ok(inset>=16 && inset<=21,`${label} ${width}/${scale}: visible arrow inset ${inset}px`);
    assert.match(await control.evaluate(node=>getComputedStyle(node).backgroundPosition),/^(right 16px center|calc\(100% - 16px\) 50%)$/);
    assert.equal(await control.evaluate(node=>getComputedStyle(node).paddingRight),'48px');
    assert.ok(arrowWidth>=8 && arrowWidth<=16,`${label}: exactly one compact chevron`);
    assert.ok(Math.abs((Math.min(...ys)+Math.max(...ys))/2-pixels.height/2)<=3,`${label}: centered arrow`);
    assert.ok(await control.evaluate(node=>node.getBoundingClientRect().right<=node.closest('.wm-content').getBoundingClientRect().right),`${label}: contained control`);
    assert.ok(await control.evaluate(node=>{
      const style=getComputedStyle(node),ctx=document.createElement('canvas').getContext('2d');ctx.font=style.font;
      return ctx.measureText(node.selectedOptions[0].text).width<=node.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
    }),`${label}: selected text fits before the reserved arrow space`);
  }
  // The same field contract across actual Menu, Process and Quality components.
  for(const theme of ['dark','light']) for(const width of [320,390]) for(const scale of [100,125]) {
    await page.setViewportSize({width:1280,height:844});
    await page.evaluate(({theme,scale})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.fontSize=`${scale}%`;document.documentElement.style.setProperty('--ui-font-scale',String(scale/100));window.__longLabels=scale===125;}, {theme,scale});
    await page.setViewportSize({width,height:844});
    const typography=[];
    async function fields(dialog) {
      const rows=dialog.locator('.wm-field, .settings-group .setting-row:not(.multi-option-row)');
      for(const row of await rows.all()) {
        const info=await row.evaluate(node=>{
          const label=node.querySelector('.wm-field-label, .setting-label'),control=node.querySelector('input,select,textarea,button.mobile-select');
          const box=node.getBoundingClientRect(),l=label.getBoundingClientRect(),c=control.getBoundingClientRect(),s=getComputedStyle(label);
          const wrapper=node.querySelector('.setting-control-wrapper')??control;
          return {type:control.type,gap:wrapper.getBoundingClientRect().top-l.bottom,
            typography:[s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight,s.color],
            width:box.width,row:wrapper.getBoundingClientRect().width,height:c.height,
            fits:[...node.querySelectorAll('input,select,textarea,button,.setting-unit')].every(child=>{const r=child.getBoundingClientRect();return r.left>=box.left-1&&r.right<=box.right+1&&child.scrollWidth<=child.clientWidth+1;}),
            labelFits:label.scrollWidth<=label.clientWidth+1};
        });
        typography.push(info.typography);
        assert.equal(info.gap,8,JSON.stringify(info));
        assert.ok(Math.abs(info.width-info.row)<1,JSON.stringify(info));
        assert.ok(info.height>=48&&info.fits&&info.labelFits,JSON.stringify(info));
        const label=row.locator('.wm-field-label, .setting-label');
        const control=row.locator('input,select,textarea,button.mobile-select').first();
        assert.ok(await control.getAttribute('aria-label') || await label.textContent(),'associated accessible label');
        await label.click();
        if(await page.locator('.mobile-selector').count()) {
          await page.keyboard.press('Escape');
        }
        assert.equal(await control.evaluate(node=>node===document.activeElement),true,'label click focuses control');
      }
      assert.equal(await dialog.locator('.wm-content').evaluate(node=>node.scrollWidth<=node.clientWidth),true);
    }
    await page.getByRole('button',{name:'Menu',exact:true}).click();
    const menu=page.getByRole('dialog',{name:'Menu & presets',exact:true});
    await menu.getByRole('button',{name:'Preferences...',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__preferencesTab),'general','Menu reaches existing Preferences action');
    await fields(menu);
    assert.equal(await menu.locator('.wm-content').evaluate(node=>getComputedStyle(node).gap),'24px');
    assert.deepEqual(await menu.locator('.wm-stack').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).gap)),['16px','16px','16px','16px']);
    assert.deepEqual(await menu.locator('.wm-group').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).gap)),['24px','24px']);
    const nozzle=menu.getByRole('spinbutton',{name:'Nozzle diameter',exact:true});
    await nozzle.fill('0.5');await nozzle.blur();
    assert.deepEqual(await page.evaluate(()=>window.__nozzleWrite),{key:'nozzle_diameter',value:'0.5',kind:'printer',index:0});
    assert.equal(await page.evaluate(()=>window.__appStore.getState().currentConfig.nozzle_diameter),'0.5,0.6');
    await page.screenshot({path:`${spacingEvidence}/fields-menu-${theme}-${width}-${scale}.png`});
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await fields(page.getByRole('dialog',{name:'Process Settings',exact:true}));
    await page.getByRole('button',{name:'Strength',exact:true}).click();
    const category=page.getByRole('dialog',{name:'Strength',exact:true});
    await fields(category);
    await page.screenshot({path:`${spacingEvidence}/fields-category-${theme}-${width}-${scale}.png`});
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Quality',exact:true}).click();
    const quality=page.getByRole('dialog',{name:'Quality',exact:true});
    await fields(quality);
    assert.equal(await quality.locator('.wm-quality-groups').evaluate(node=>getComputedStyle(node).gap),'24px');
    assert.deepEqual(await quality.locator('.wm-card').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).gap)),['16px','16px']);
    assert.ok(typography.every(style=>JSON.stringify(style)===JSON.stringify(typography[0])),`uniform labels ${theme}/${width}/${scale}`);
    await page.screenshot({path:`${spacingEvidence}/fields-quality-${theme}-${width}-${scale}.png`});
    await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    console.log('FIELD_CONSISTENCY',theme,width,scale,JSON.stringify(typography[0]));
  }
  await page.evaluate(()=>{window.__longLabels=false;document.documentElement.style.setProperty('--ui-font-scale','1');});
  for(const width of [320,390]) {
    await page.setViewportSize({width,height:844});
    for(const scale of [100,125]) {
      await page.evaluate(scale=>{document.documentElement.style.fontSize=`${scale}%`;},scale);
      await page.getByRole('button',{name:'Settings',exact:true}).click();
      const processDialog=page.getByRole('dialog',{name:'Process Settings',exact:true});
      await processDialog.waitFor();
      await sheetSpacing(processDialog,'process',width,scale);
      await processDialog.getByRole('button',{name:'Strength',exact:true}).click();
      const category=page.getByRole('dialog',{name:'Strength',exact:true});
      await sheetSpacing(category,'category',width,scale);
      await category.getByRole('button',{name:'Done',exact:true}).click();
      await page.screenshot({animations:'disabled',path:`${arrowEvidence}/${process.env.PHASE ?? 'fixed'}-process-screen-${width}-${scale}.png`});
      await nativeArrow(processDialog.getByRole('combobox',{name:'Settings mode',exact:true}),'process',width,scale);
      // Also cover an existing design-system native select class: the sheet's
      // background shorthand used to override its arrow image in this context.
      await processDialog.locator('.wm-content').evaluate(content=>{
        const label=document.createElement('label');label.textContent='Native select fixture';
        const select=document.createElement('select');select.className='ds-select';
        select.add(new Option('Advanced','advanced'));label.append(select);content.prepend(label);
      });
      const nativeFixture=processDialog.getByRole('combobox',{name:'Native select fixture',exact:true});
      await nativeArrow(nativeFixture,'ds-select',width,scale);
      await nativeFixture.evaluate(node=>{node.disabled=true;});
      assert.equal(await nativeFixture.isDisabled(),true);
      await nativeArrow(nativeFixture,'disabled',width,scale);
      await processDialog.getByRole('button',{name:'Quality',exact:true}).click();
      const qualityDialog=page.getByRole('dialog',{name:'Quality',exact:true});
      await sheetSpacing(qualityDialog,'quality',width,scale);
      const mode=qualityDialog.getByRole('combobox',{name:'Settings mode',exact:true});
      await nativeArrow(mode,'quality',width,scale);
      await mode.selectOption('simple');
      assert.equal(await page.evaluate(()=>window.__appStore.getState().settingsMode),'simple','native selection updates the store');
      await mode.focus();await page.keyboard.press('End');await page.keyboard.press('Tab');
      assert.equal(await mode.inputValue(),'expert','native keyboard selection remains functional');
      await mode.selectOption('advanced');
      await qualityDialog.getByRole('button',{name:'Cancel',exact:true}).click();
      await processDialog.getByRole('button',{name:'Done',exact:true}).click();
      for(const [trigger,name,label] of [
        [page.getByRole('button',{name:'Menu',exact:true}),'Menu & presets','menu'],
        [page.getByRole('button',{name:/Objects · 0/}),'Objects · 0','objects']
      ]) {
        await trigger.click();
        const dialog=page.getByRole('dialog',{name,exact:true});
        if(label==='menu') await dialog.locator('summary').click();
        await sheetSpacing(dialog,label,width,scale);
        await dialog.getByRole('button',{name:'Close',exact:true}).click();
      }
    }
  }
  await page.setViewportSize({width:1024,height:844});
  const desktop=await page.evaluate(()=>{
    const sheet=document.createElement('section');sheet.className='wm-sheet';
    const select=document.createElement('select');select.add(new Option('Advanced'));sheet.append(select);document.body.append(sheet);
    const style=getComputedStyle(select),result={appearance:style.appearance,backgroundImage:style.backgroundImage,paddingRight:style.paddingRight};
    sheet.remove();return result;
  });
  assert.equal(desktop.appearance,'auto');assert.equal(desktop.backgroundImage,'none');
  assert.notEqual(desktop.paddingRight,'48px','mobile arrow spacing stays outside desktop geometry');
  // Save Preset's outer body contains only a form, whose own slots supply padding
  // and scrolling. Keep that layout while ordinary bodies with form siblings scroll.
  const formLayout=await page.evaluate(()=>{
    const layer=document.createElement('div');layer.className='dialog-layer';
    layer.innerHTML='<div class="ds-dialog"><div class="ds-dialog__body"><form><div class="ds-dialog__body">Form fields</div></form></div></div>';
    document.body.append(layer);
    const body=layer.querySelector('.ds-dialog > .ds-dialog__body'),form=body.firstElementChild;
    const read=()=>({padding:getComputedStyle(body).padding,overflow:getComputedStyle(body).overflowY,flex:getComputedStyle(form).flex,minHeight:getComputedStyle(form).minHeight});
    const whole=read(),innerPadding=getComputedStyle(form.firstElementChild).padding;
    body.prepend(document.createElement('p'));
    const mixed=read();layer.remove();return {whole,innerPadding,mixed};
  });
  assert.equal(formLayout.whole.padding,'0px');assert.equal(formLayout.whole.overflow,'hidden');
  assert.equal(formLayout.whole.flex,'1 1 0%');assert.equal(formLayout.whole.minHeight,'0px');
  assert.ok(parseFloat(formLayout.innerPadding)>0,'full-form inner body keeps its padding');
  assert.ok(parseFloat(formLayout.mixed.padding)>0,'body with form siblings keeps its padding');
  assert.equal(formLayout.mixed.overflow,'auto');assert.equal(formLayout.mixed.flex,'0 1 auto');
  await page.evaluate(()=>{document.documentElement.style.fontSize='100%';});

  async function modal(trigger,name){
    await trigger.click();
    const dialog=page.getByRole('dialog',{name,exact:true});await dialog.waitFor();
    assert.equal(await page.locator('#root').evaluate(node=>node.inert),true);
    assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true);
    await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true);
    return dialog;
  }
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    // Real computed styles catch inherited picker accents and cascade regressions.
    async function neutralControl(locator, properties) {
      const style=await locator.evaluate((node,properties)=>{
        const css=getComputedStyle(node), box=node.getBoundingClientRect();
        return {enabled:!node.disabled,width:box.width,height:box.height,
          colors:properties.map(property=>css[property])};
      },properties);
      assert.equal(style.enabled,true);
      assert.ok(style.width>=48 && style.height>=48,JSON.stringify(style));
      for(const color of style.colors){
        const channels=color.match(/[\d.]+/g)?.slice(0,3).map(Number);
        assert.ok(channels?.length===3 && Math.max(...channels)-Math.min(...channels)<=8,
          `neutral chrome at ${width}px: ${color}`);
      }
      console.log('NEUTRAL',width,await locator.textContent(),JSON.stringify(style));
    }
    const active=nav.getByRole('button',{name:'Prepare',exact:true});
    await neutralControl(active,['backgroundColor','color','borderTopColor']);
    assert.equal(await active.evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(69, 69, 75)','approved selected navigation fill');
    await neutralControl(page.getByRole('button',{name:'Add model',exact:true}),['backgroundColor','color']);
    await page.keyboard.press('Tab');await active.focus();
    assert.equal(await active.evaluate(node=>node.matches(':focus-visible')),true);
    await neutralControl(active,['outlineColor']);
    assert.equal(await active.evaluate(node=>getComputedStyle(node).outlineWidth),'3px');
    const presetMenu=await modal(page.getByRole('button',{name:'Menu',exact:true}),'Menu & presets');
    await presetMenu.getByRole('button',{name:'Printer',exact:true}).click();
    const selected=page.getByRole('option',{name:'Fixture printer',exact:true});
    assert.equal(await selected.getAttribute('aria-selected'),'true');
    await neutralControl(selected,['backgroundColor','color']);
    assert.equal(await selected.evaluate(node=>getComputedStyle(node).boxShadow),'rgb(229, 229, 228) 2px 0px 0px 0px inset');
    await page.keyboard.press('Tab');await selected.focus();
    assert.equal(await selected.evaluate(node=>node.matches(':focus-visible')),true);
    await neutralControl(selected,['outlineColor']);
    assert.equal(await selected.evaluate(node=>getComputedStyle(node).outlineWidth),'2px');
    await page.screenshot({path:`${process.env.EVIDENCE_DIR ?? 'wasm/build/tests-mobile-neutral-accents/fix'}/picker-${width}.png`});
    await page.keyboard.press('Escape');
    for(const label of ['Filament','Process preset']){
      const trigger=presetMenu.getByRole('button',{name:label,exact:true});
      await neutralControl(trigger,['backgroundColor','color']);await trigger.click();
      await neutralControl(page.locator('.mobile-selector [aria-selected=true]'),['backgroundColor','color']);
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'Quality',exact:true}).click();
    const qualityDialog=page.getByRole('dialog',{name:'Quality',exact:true});
    await neutralControl(qualityDialog.getByRole('button',{name:'Apply',exact:true}),['backgroundColor','color']);
    const layer=qualityDialog.getByRole('spinbutton',{name:'Layer height',exact:true});
    await page.keyboard.press('Tab');await layer.focus();
    await neutralControl(layer,['outlineColor']);
    await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    for(const [trigger,name] of [[page.getByRole('button',{name:'Menu',exact:true}),'Menu & presets'],[page.getByRole('button',{name:/Objects · 0/}),'Objects · 0']]){
      await modal(trigger,name);await page.keyboard.press('Escape');
      assert.equal(await trigger.evaluate(node=>node===document.activeElement),true);
      assert.equal(await page.locator('#root').evaluate(node=>node.inert),false);
      const dialog=await modal(trigger,name);await dialog.getByRole('button',{name:'Close',exact:true}).click();
      assert.equal(await trigger.evaluate(node=>node===document.activeElement),true);
    }
  }
  const menu=await modal(page.getByRole('button',{name:'Menu',exact:true}),'Menu & presets');
  await menu.locator('summary').focus();
  await page.keyboard.press('Tab');
  assert.equal(await menu.getByRole('button',{name:'Close',exact:true}).evaluate(node=>node===document.activeElement),true,
    `Tab wraps from the native summary: ${await page.evaluate(()=>document.activeElement.outerHTML)}`);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await menu.locator('summary').evaluate(node=>node===document.activeElement),true,'native summary stays in dialog tab order');
  await page.keyboard.press('Escape');
  const settings=page.getByRole('button',{name:'Settings',exact:true});
  await modal(settings,'Process Settings');
  const categorySearch=page.getByRole('searchbox',{name:'Search settings',exact:true});
  await categorySearch.fill('no-such-setting-zz');
  await page.getByRole('status').filter({hasText:'No matching settings'}).waitFor();
  assert.equal(await categorySearch.evaluate(node=>document.activeElement===node),true,'no results preserves search focus');
  await categorySearch.fill('');
  const quality=page.getByRole('button',{name:'Quality',exact:true});
  await quality.click();
  let editor=page.getByRole('dialog',{name:'Quality',exact:true});
  await editor.getByRole('spinbutton',{name:'Layer height',exact:true}).fill('0.16');
  assert.deepEqual(await page.evaluate(()=>window.__writes),[]);
  await editor.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__appStore.getState().currentConfig.layer_height),'0.2');
  assert.equal(await quality.evaluate(node=>node===document.activeElement),true);
  await quality.click();editor=page.getByRole('dialog',{name:'Quality',exact:true});
  assert.equal(await editor.getByRole('spinbutton',{name:'Layer height',exact:true}).inputValue(),'0.2');
  await editor.getByRole('spinbutton',{name:'Layer height',exact:true}).fill('0.18');
  await editor.getByRole('spinbutton',{name:'First layer height',exact:true}).fill('0.3');
  await editor.getByRole('checkbox',{name:'Staggered inner seams',exact:true}).check();
  await editor.getByRole('button',{name:'Apply',exact:true}).click();await editor.waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>window.__writes),[
    {key:'layer_height',value:'0.18',kind:'print'},{key:'initial_layer_print_height',value:'0.3',kind:'print'},
    {key:'staggered_inner_seams',value:'1',kind:'print'}]);
  assert.equal(await quality.evaluate(node=>node===document.activeElement),true);
  await quality.click();editor=page.getByRole('dialog',{name:'Quality',exact:true});
  await editor.getByRole('spinbutton',{name:'Layer height',exact:true}).fill('');
  await editor.getByRole('button',{name:'Apply',exact:true}).click();
  await editor.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(()=>window.__writes.length),3,'invalid draft cannot commit');
  await page.keyboard.press('Escape');
  await quality.click();editor=page.getByRole('dialog',{name:'Quality',exact:true});
  await editor.getByRole('spinbutton',{name:'Layer height',exact:true}).fill('0.17');
  await editor.getByRole('spinbutton',{name:'First layer height',exact:true}).fill('0.28');
  await page.evaluate(()=>{window.__failKey='initial_layer_print_height';});
  await editor.getByRole('button',{name:'Apply',exact:true}).click();
  await editor.getByRole('alert').filter({hasText:'Fixture engine failure'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__appStore.getState().currentConfig.layer_height),'0.17');
  assert.equal(await editor.getByRole('spinbutton',{name:'First layer height',exact:true}).inputValue(),'0.28');
  await page.evaluate(()=>{window.__failKey=null;});
  await editor.getByRole('button',{name:'Apply',exact:true}).click();
  await editor.waitFor({state:'detached',timeout:3000});
  assert.deepEqual(await page.evaluate(()=>window.__writes.slice(3)),[
    {key:'layer_height',value:'0.17',kind:'print'},
    {key:'initial_layer_print_height',value:'0.28',kind:'print'},
    {key:'initial_layer_print_height',value:'0.28',kind:'print'}],
    'retry preserves the remaining draft and skips the confirmed write');
  await quality.click();editor=page.getByRole('dialog',{name:'Quality',exact:true});
  await editor.getByRole('spinbutton',{name:'Layer height',exact:true}).fill('0.16');
  await page.evaluate(()=>window.__appStore.setState({currentConfig:{...window.__appStore.getState().currentConfig,layer_height:'0.15'}}));
  await editor.getByRole('button',{name:'Apply',exact:true}).click();
  await editor.getByRole('alert').filter({hasText:'Settings changed while editing'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__writes.length),6,'external settings changes still prevent stale writes');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.equal(await settings.evaluate(node=>node===document.activeElement),true);
  // Real numeric component and mobile placement, with only the engine/store boundary inert.
  {
  await page.setViewportSize({width:320,height:844});
  await page.evaluate(()=>{
    document.documentElement.style.fontSize='125%';
    document.documentElement.style.setProperty('--ui-font-scale','1.25');
    window.__plateStore.setState({objects:[{id:1,size:[20,30,40],instances:[{id:1,offset:[10,20,0],scale:[1,1,1],rotation:[0,0,0]}]}],selectedObjectId:1,selectedInstanceId:1,gizmoMode:'translate'});
  });
  assert.equal(await page.locator('.numeric-transform').count(),0,'closed tools hide numeric editor');
  assert.match(await page.locator('.wm-prepare > div.wm-row').innerText(),/1 object/);
  await page.getByRole('button',{name:'Plate tools',exact:true}).click();
  const editor=page.locator('#mobile-nt-transform');
  await editor.waitFor();
  assert.equal(await page.locator('.wm-viewport .numeric-transform').count(),0);
  for(const overlay of ['#view-cube','.view-buttons','#selection-panel']) assert.equal(await page.locator(overlay).isVisible(),false,overlay);
  assert.equal(await editor.locator('input[type=text]').count(),3);
  const x=editor.getByRole('textbox',{name:'Position X (mm)',exact:true});
  assert.equal(await x.inputValue(),'10');await x.fill('25');await x.press('Enter');
  assert.equal(await page.evaluate(()=>window.__plateStore.getState().objects[0].instances[0].offset[0]),25);
  await editor.screenshot({path:`${spacingEvidence}/move-320-125.png`});
  await page.evaluate(()=>window.__plateStore.setState({gizmoMode:'scale'}));
  await editor.getByRole('textbox',{name:'Scale X (%)',exact:true}).waitFor();
  assert.equal(await editor.locator('input[type=text]').count(),6);
  assert.equal(await editor.getByRole('textbox',{name:'Size Y (mm)',exact:true}).inputValue(),'30');
  const scale=editor.getByRole('textbox',{name:'Scale X (%)',exact:true});await scale.fill('150');await scale.press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.__plateStore.getState().objects[0].instances[0].scale),[1.5,1.5,1.5]);
  await editor.getByRole('checkbox',{name:'Keep proportions'}).uncheck();
  const size=editor.getByRole('textbox',{name:'Size Y (mm)',exact:true});await size.fill('60');await size.press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.__plateStore.getState().objects[0].instances[0].scale),[1.5,2,1.5]);
  for(const input of await editor.locator('input[type=text]').all()) {
    const box=await input.boundingBox();assert.ok(box.height>=48 && box.width>=48);
    assert.ok(box.x>=0 && box.x+box.width<=320);
  }
  await editor.screenshot({path:`${spacingEvidence}/scale-320-125.png`});
  for (const theme of ['light','dark']) {
    await page.evaluate(theme=>{
      document.documentElement.dataset.theme=theme;
      const fixture=document.createElement('div');fixture.className='wm-scrim';fixture.id='mobile-alias-probe';
      fixture.innerHTML='<div style="background:var(--panel-bg);color:var(--text-color)">Rename</div>';
      document.body.append(fixture);
    },theme);
    for (const target of [editor.locator('input[type=text]').first(),page.locator('#mobile-alias-probe > div')]) {
      const contrast=await target.evaluate(node=>{
        const style=getComputedStyle(node);
        const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        const a=luminance(style.color),b=luminance(style.backgroundColor);
        return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      });
      assert.ok(contrast>=4.5,`${theme} mobile input/legacy panel contrast ${contrast}`);
    }
    await page.locator('#mobile-alias-probe').evaluate(node=>node.remove());
  }
  await page.evaluate(()=>window.__plateStore.setState({objects:[{id:1,size:[120,30,40],instances:[
    {id:1,offset:[10,20,0],scale:[1,1,1],rotation:[0,0,0]},
    {id:2,offset:[110,20,0],scale:[1,1,1],rotation:[0,0,0]}
  ]}]}));
  const copySize=editor.getByRole('textbox',{name:'Size X (mm)',exact:true});
  await page.waitForFunction(()=>document.querySelector('#mobile-nt-size-x')?.value==='20');
  await copySize.fill('40');await copySize.press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.__plateStore.getState().objects[0].instances.map(instance=>instance.scale)),[[2,1,1],[1,1,1]],'size uses selected copy bounds and leaves the off-plate copy unchanged');
  assert.equal(await page.locator('[id]').evaluateAll(nodes=>new Set(nodes.map(node=>node.id)).size===nodes.length),true,'unique control IDs');
  for(const state of [{gizmoMode:'rotate'},{gizmoMode:null},{gizmoMode:'translate',extraSelection:[{objectId:2,instanceId:1}]},{extraSelection:[],selectedInstanceId:99}]) {
    await page.evaluate(state=>window.__plateStore.setState(state),state);
    await editor.waitFor({state:'detached'});
  }
  await page.evaluate(()=>{window.__plateStore.setState({selectedInstanceId:1});window.__desktopNumeric()});
  await page.locator('#numeric-transform').waitFor();
  assert.equal(await page.locator('#numeric-transform .numeric-transform-row').count(),5,'desktop retains all default rows');
  assert.equal(await page.locator('#nt-lock').count(),1);
  }
  // The shared menu classes exercise the same cascade as context, dropdown and dialog menus.
  await page.setViewportSize({width:1024,height:844});
  for(const theme of ['dark','light']) {
    await page.evaluate(theme=>{
      document.documentElement.dataset.theme=theme;
      const fixture=document.createElement('div');fixture.id='neutral-menu-fixture';
      fixture.innerHTML='<div class="ds-menu context-menu"><button class="ds-menu__item" aria-current="true"><span class="menu-check">✓</span>Selected</button><button class="ds-menu__item" data-tone="danger">Delete</button></div><button class="ds-dropdown" aria-expanded="true">Dropdown</button><div class="ds-listbox"><button class="ds-option" aria-selected="true">Option</button></div><div class="ds-dialog"><button class="ds-btn ds-btn--primary">Apply</button><input class="ds-input"></div>';
      document.body.append(fixture);
    },theme);
    const fixture=page.locator('#neutral-menu-fixture');
    for(const selector of ['.ds-menu__item[aria-current]','.menu-check','.ds-dropdown','.ds-option','.ds-btn--primary']) {
      const colors=await fixture.locator(selector).evaluate(node=>{
        const s=getComputedStyle(node);return [s.color,s.backgroundColor,s.borderTopColor];
      });
      for(const color of colors) {
        const channels=color.match(/[\d.]+/g).slice(0,3).map(Number);
        assert.ok(Math.max(...channels)-Math.min(...channels)<=8,`${theme} ${selector}: ${color}`);
      }
    }
    await page.keyboard.press('Tab');await fixture.locator('.ds-input').focus();
    const focus=await fixture.locator('.ds-input').evaluate(node=>({visible:node.matches(':focus-visible'),shadow:getComputedStyle(node).boxShadow}));
    assert.equal(focus.visible,true);assert.notEqual(focus.shadow,'none');
    const status=await fixture.evaluate(node=>{
      const s=getComputedStyle(node);return Object.fromEntries(['--status-busy','--success-fg','--danger-fg','--gc-outer-wall','--vp-plate-active-outline'].map(name=>[name,s.getPropertyValue(name).trim()]));
    });
    assert.equal(status['--status-busy'],'#26b3a3');
    assert.equal(status['--vp-plate-active-outline'],'#008172');
    assert.equal(status['--gc-outer-wall'],'rgb(255 125 56)');
    assert.notEqual(status['--success-fg'],status['--danger-fg']);
    assert.ok((await fixture.locator('[data-tone=danger]').evaluate(node=>getComputedStyle(node).color)).startsWith('rgb('));
    await fixture.evaluate(node=>node.remove());
  }
  assert.deepEqual(errors,[]);
  console.log('PASS mobile Move/Scale outside viewport; transform commits; 320px/125% targets; hidden overlays; desktop rows; both-theme neutral context/dropdown/dialog menu classes; preserved status/data/canvas tokens');
  console.log('PASS mobile App navigation/history; Menu/Objects/settings dialogs and focus; Quality Cancel/Apply/invalid draft/partial failure retry/external changes');
} finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
