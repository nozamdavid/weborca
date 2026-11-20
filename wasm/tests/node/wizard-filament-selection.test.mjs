import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

test('vendor Select all adds only visible vendor filaments and preserves other selections', async () => {
  const resolveDir = new URL('../../app/', import.meta.url).pathname;
  const bundle = await build({
    stdin: { contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {WizardDialog} from './src/wizard/WizardDialog';
      import {useWizardStore} from './src/wizard/wizardStore';
      useWizardStore.setState({open:true,step:2,selectedFilaments:['Other PLA']});
      window.selection=()=>useWizardStore.getState().selectedFilaments;
      createRoot(document.getElementById('root')).render(<WizardDialog autoOpen={false}/>);`, loader: 'tsx', resolveDir },
    bundle: true, write: false, outdir: '/virtual', platform: 'browser', format: 'iife',
    plugins: [{ name: 'wizard-boundaries', setup(b) {
      b.onResolve({ filter: /\/(orcaEngine|appStore|i18n|printerCatalog|account|MobileInput|MobileSelect|Dialog)$/ }, args => ({ path: args.path.split('/').at(-1), namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ resolveDir, loader: 'jsx', contents: {
        orcaEngine: `export const listPresets=async()=>[
          {name:'Acme PLA',vendor:'Acme'},{name:'Acme PETG',vendor:'Acme'},
          {name:'Other PLA',vendor:'Other'},{name:'Other PETG',vendor:'Other'}];
          export const getCompatiblePresets=async()=>({});export const loadVendors=async()=>{};`,
        appStore: `export const useAppStore=fn=>fn({isEngineReady:true});useAppStore.getState=()=>({selectedPrinter:''});`,
        i18n: `export const useTranslation=()=>({t:key=>key});`,
        printerCatalog: `export const usePrinterCatalog=()=>({vendors:[],loading:false});export const loadPrinterCatalog=async()=>{};`,
        account: `export const openCloudAccount=()=>{};`,
        MobileInput: `import React from 'react';export const MobileInput=props=><input {...props}/>;`,
        MobileSelect: `import React from 'react';export const MobileSelect=props=><select {...props}/>;`,
        Dialog: `export const Dialog=({children})=>children;`
      }[path] }));
    } }]
  });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    const acme = page.getByRole('button', { name: 'Acme: Select all', exact: true });
    await acme.click();
    assert.deepEqual(await page.evaluate(() => window.selection()), ['Other PLA', 'Acme PLA', 'Acme PETG']);
    assert.equal(await acme.isDisabled(), true);
    await page.locator('input[value="Acme PLA"]').uncheck();
    assert.equal(await acme.isEnabled(), true);
    await acme.click();
    assert.equal(await page.evaluate(() => window.selection().length), 3, 'reselection creates no duplicates');
    await page.locator('#wizard-filament-select-none').click();
    await page.locator('input[value="Other PLA"]').check();
    await page.locator('#wizard-filament-search').fill('PETG');
    await acme.click();
    assert.deepEqual(await page.evaluate(() => window.selection()), ['Other PLA', 'Acme PETG']);
    await page.locator('#wizard-filament-search').fill('no matches');
    assert.equal(await page.locator('.wizard-filament-group').count(), 0);
  } finally {
    await browser.close();
  }
});
