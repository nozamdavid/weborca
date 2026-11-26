import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

const appDir = new URL('../../app/', import.meta.url).pathname;
const fixture = `
import {create} from 'zustand';
const printer={id:'synthetic',name:'Fixture printer',host_type:'prusaconnect',print_host:'http://device.test',print_host_webui:'http://device.test',printhost_apikey:''};
export const usePrinterConnectionStore=create(()=>({printers:[printer],selectedPrinterId:printer.id,status:'online',
  liveState:{state:'ready',software:'Prusa Connect',heaters:[{id:'nozzle',kind:'extruder',label:'Nozzle',current:20,target:0},{id:'bed',kind:'bed',label:'Bed',current:19,target:0}],fans:[],speedFactor:100,flowFactor:100},
  selectPrinter:()=>{},openDialog:()=>{},setDeviceTabActive:()=>{}}));
export const useTranslation=()=>({t:key=>key});
export const confirmDialog=()=>{throw Error('Printer action forbidden')};
export const getCurrentPrinterApi=()=>{throw Error('Printer action forbidden')};
export const reconnectPrinterSession=()=>{throw Error('Printer retry forbidden')};
export const parseHost=()=>({scheme:'http',hostPort:'device.test',basePath:''});
export const localGatewayBase=()=>undefined;
export const createUiSession=()=>{throw Error('Gateway session forbidden')};
`;

test('Device Web UI fills a separate mobile row and retains desktop layout and hide/show', async () => {
  const output = path.resolve(process.env.APP_TEST_OUTPUT ?? 'wasm/build/tests-mobile-device-webui/fix/after');
  await mkdir(output, { recursive: true });
  const bundled = await build({stdin:{contents:`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import './src/index.css'; import './src/App.css'; import './src/mobile/mobile.css';
    import {DevicePanel} from './src/printers/DevicePanel'; import * as fixture from 'fixture';
    window.fixture=fixture;
    createRoot(document.getElementById('root')).render(<DevicePanel active/>);`,loader:'tsx',resolveDir:appDir},
    bundle:true,write:false,outdir:'fixture',format:'iife',platform:'browser',
    plugins:[{name:'inert-printer-boundary',setup(build){
      build.onResolve({filter:/^fixture$|\/(connectionStore|i18n|ModalBackdrop|session|gatewayUrl)$/},()=>({path:'fixture',namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,resolveDir:appDir}));
    }}]});
  const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  // Every response is synthetic; no server, printer, account or stored browser profile.
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}));
  try {
    await page.goto('http://device.test');
    await page.addStyleTag({content:bundled.outputFiles.find(file=>file.path.endsWith('.css')).text});
    await page.addScriptTag({content:bundled.outputFiles.find(file=>file.path.endsWith('.js')).text});
    await page.locator('#device-controls').waitFor();
    const failures=[];
    for (const hostType of ['prusaconnect','octoprint']) {
      await page.evaluate(host_type=>{
        const store=window.fixture.usePrinterConnectionStore;
        store.setState({printers:store.getState().printers.map(p=>({...p,host_type}))});
      },hostType);
      if (hostType==='octoprint') await page.locator('#device-webui-frame').waitFor();
      for (const width of [320,390,1400]) {
        if (await page.locator('#device-webui-toggle').getAttribute('aria-expanded')==='false') await page.locator('#device-webui-toggle').click();
        await page.setViewportSize({width,height:844});
        // Reserve the 10px consumed by the headed browser's visible scrollbar.
        await page.locator('#device-body').evaluate((el, width)=>{
          el.style.paddingRight=width===320?'22px':'';
        },width);
        await page.locator('#device-body').evaluate(el=>{el.scrollTop=0;});
        // DeviceSplit updates React state from matchMedia and ResizeObserver.
        // Measure after those viewport notifications have reached layout.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const bounds=await page.evaluate(()=>{
          const box=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
          const body=document.querySelector('#device-body');
          const style=getComputedStyle(body);
          return {body:box('#device-body'),status:box('#device-status'),controls:box('#device-controls'),side:box('.device-ui-side'),webui:box('#device-webui'),
            frame:document.querySelector('iframe')?box('iframe'):null,
            available:body.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),
            overflow:document.documentElement.scrollWidth>innerWidth || body.scrollWidth>body.clientWidth};
        });
        console.log(JSON.stringify({hostType,width,...bounds}));
        await page.screenshot({path:path.join(output,`${hostType}-${width}.png`),fullPage:true});
        if(width<=800 && hostType==='octoprint') {
          await page.locator('#device-webui').scrollIntoViewIfNeeded();
          await page.screenshot({path:path.join(output,`${hostType}-${width}-webui.png`)});
        }
        try {
          if(width<=800) {
            assert.equal(await page.locator('#device-body #device-edit-printer').count(), 1, 'settings are inside the scrollable Device body');
            assert.equal(await page.locator('.device-header #device-add-another').isVisible(), false, 'adding is offered in the picker');
            assert.ok(bounds.side.top>=bounds.status.bottom-1 && bounds.webui.top>=bounds.controls.bottom,`${width}: Web UI below status/controls`);
            assert.ok(Math.abs(bounds.webui.width-bounds.available)<=1,`${width}: Web UI full available width`);
            if(bounds.frame) {
              assert.ok(bounds.frame.width>=bounds.available-3,`${width}: iframe full width`);
              assert.ok(bounds.frame.height>=200,`${width}: usable iframe height`);
            }
          } else {
            assert.equal(await page.locator('.device-header #device-edit-printer').isVisible(), true, 'desktop settings stay in the header');
            assert.equal(await page.locator('.device-header #device-add-another').isVisible(), true, 'desktop add stays in the header');
            assert.ok(bounds.side.left>=bounds.status.right, 'desktop side by side');
            assert.ok(Math.abs(bounds.side.top-bounds.status.top)<=1,'desktop same row');
          }
          assert.equal(bounds.overflow,false,`${width}: no horizontal overflow`);
          await page.locator('#device-webui-toggle').click();
          assert.equal(await page.locator('#device-webui-toggle').getAttribute('aria-expanded'),'false');
          assert.equal(await page.locator('#device-webui').isVisible(),false);
          assert.equal(await page.locator('#device-status').evaluate(el=>el.scrollWidth<=el.clientWidth),true,`${width}: collapsed cards fit`);
          await page.locator('#device-webui-toggle').click();
          assert.equal(await page.locator('#device-webui-toggle').getAttribute('aria-expanded'),'true');
          assert.equal(await page.locator('#device-webui').isVisible(),true);
        } catch(error) { failures.push(`${hostType}: ${error.message}`); }
      }
    }
    assert.deepEqual(errors,[]);
    assert.deepEqual(failures,[]);
  } finally { await browser.close(); }
});
