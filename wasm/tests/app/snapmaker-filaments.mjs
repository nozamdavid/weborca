// Focused Device component fixture: real telemetry decoder and stores, no engine or provider calls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

const evidence = new URL('../../build/tests-extruder-cards/ui/renders/', import.meta.url);
await mkdir(evidence, { recursive: true });
// Bundle separately under the build cap; browser verification stays within 512 MiB.
const bundleDir = new URL('../../build/tests-extruder-cards/ui/fixture/', import.meta.url).pathname;
if (!process.env.EXTRUDER_FIXTURE_REUSE_BUNDLE) {
await build({
  stdin: { loader: 'tsx', resolveDir: new URL('../../app/', import.meta.url).pathname, contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {DevicePanel} from './src/printers/DevicePanel';
    import {usePrinterConnectionStore as store} from './src/printers/connectionStore';
    import {useAppStore as project} from './src/store/appStore';
    import {usePrefsStore as prefs} from './src/prefs/prefsStore';
    import {loadCatalog} from './src/i18n';
    import {parseSnapmakerFrame, snapmakerPrinterState} from './src/printers/snapmakerTelemetry';
    import './src/index.css'; import './src/App.css';
    import './src/mobile/mobile.css'; import './src/mobile/mobileShell.css'; import './src/mobile/mobileControls.css';
    const printer={id:'fixture',name:'Synthetic U1',host_type:'snapmaker-cloud',print_host:'id.snapmaker.com',filamentPresets:['Project PLA'],filamentColors:['#123456']};
    store.setState({printers:[printer],selectedPrinterId:'fixture',status:'online'});
    project.setState({selectedFilaments:['Project PLA'],currentConfig:{filament_colour:'#123456'}});
    const root=createRoot(document.getElementById('root'));
    window.show=(state,status='online')=>flushSync(()=>store.setState({liveState:state,status}));
    window.frame=objects=>window.show(snapmakerPrinterState(parseSnapmakerFrame(JSON.stringify({type:'snapshot',objects})).objects));
    window.project=()=>({selectedFilaments:project.getState().selectedFilaments,currentConfig:project.getState().currentConfig,printers:store.getState().printers});
    window.provider=host_type=>flushSync(()=>store.setState({printers:[{...printer,host_type}]}));
    window.language=async language=>{await loadCatalog(language);flushSync(()=>prefs.setState({general:{...prefs.getState().general,language}}));};
    flushSync(()=>root.render(<DevicePanel active={true}/>));
  ` },
  bundle: true, write: true, outdir: bundleDir, format: 'esm', platform: 'browser',
  external: ['/fonts/*', '/icons/*'],
});
if (process.env.EXTRUDER_FIXTURE_BUILD_ONLY) process.exit(0);
}
const js = await readFile(`${bundleDir}/stdin.js`, 'utf8');
const css = await readFile(`${bundleDir}/stdin.css`, 'utf8');
const server = createServer((req, res) => {
  if (req.url === '/ui.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); }
  else if (req.url === '/ui.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
  else if (req.url.startsWith('/icons/') || req.url.startsWith('/fonts/')) { res.writeHead(204); res.end(); }
  else res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><div id="root"></div><script type="module" src="/ui.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
const externalRequests = [];
const workers = [];
page.on('pageerror', error => errors.push(error.message));
page.on('worker', worker => workers.push(worker.url()));
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  externalRequests.push(route.request().url());
  return route.abort();
});
const base = { state: 'idle', heaters: [], fans: [] };
const slots = [
  { id: 'snapmaker:tool:1', slotIndex: 1, label: 'T1', material: 'PLA', vendor: 'Snapmaker', subtype: 'Matte', color: '#000000', presence: 'present' },
  { id: 'snapmaker:tool:3', slotIndex: 3, label: 'T3', material: '', presence: 'empty' },
];
try {
  await page.goto(origin);
  await page.locator('#device-extruders').waitFor();
  const project = await page.evaluate(() => window.project());
  const objects = {
    extruder: { temperature: 20, target: 200, extruder_index: 0 },
    extruder1: { temperature: 21, target: 201, extruder_index: 1 },
    extruder2: { temperature: 22, target: 202, extruder_index: 2 },
    extruder3: { temperature: 23, target: 203, extruder_index: 3 },
    heater_bed: { temperature: 40, target: 60 },
    print_task_config: { filament_vendor: ['Snapmaker', 'Snapmaker', 'Snapmaker', 'Snapmaker'], filament_type: ['PLA', 'PLA', 'PLA', 'PLA'], filament_exist: [true, true, true, true], filament_color_rgba: ['808080FF', '0000FFFF', '000000FF', 'FFFFFFFF'] },
  };
  let section = page.locator('#device-extruders');
  await page.evaluate(objects => window.frame(objects), objects);
  const cards = page.locator('.device-extruder-card');
  assert.deepEqual(await cards.locator('h5').allTextContents(), ['Extruder 1', 'Extruder 2', 'Extruder 3', 'Extruder 4']);
  assert.deepEqual(await cards.locator('.device-extruder-temperatures dd:first-of-type').allTextContents(), ['20.0 °C', '200 °C', '21.0 °C', '201 °C', '22.0 °C', '202 °C', '23.0 °C', '203 °C']);
  assert.deepEqual(await cards.locator('.device-extruder-feed').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).stroke)), ['rgb(128, 128, 128)', 'rgb(0, 0, 255)', 'rgb(0, 0, 0)', 'rgb(255, 255, 255)']);
  assert.equal(await page.locator('#device-temps [data-kind="bed"]').count(), 1);
  assert.equal(await page.locator('#device-temps [data-kind="extruder"], #device-filaments').count(), 0);
  assert.equal(await section.locator('button,input,select').count(), 0);

  await page.evaluate(state => window.show(state), { ...base, filamentSlots: [...slots].reverse(), heaters: [
    { id: 'extruder3', kind: 'extruder', label: 'Extruder 3', toolIndex: 3, current: 23, target: 203 },
    { id: 'extruder1', kind: 'extruder', label: 'Extruder 1', toolIndex: 1, current: 21, target: 201 },
  ] });
  assert.deepEqual(await cards.locator('h5').allTextContents(), ['Extruder 2', 'Extruder 4']);
  assert.match(await cards.nth(0).innerText(), /21.0 °C/);
  assert.match(await cards.nth(1).innerText(), /23.0 °C/);
  await renderMatrix('snapmaker-four');
  await page.evaluate(objects => window.frame(Object.fromEntries(Object.entries(objects).reverse())), objects);
  assert.deepEqual(await cards.locator('h5').allTextContents(), ['Extruder 1', 'Extruder 2', 'Extruder 3', 'Extruder 4']);
  assert.match(await cards.nth(3).innerText(), /23.0 °C/);
  await page.evaluate(state => window.show(state), { ...base, filamentSlots: slots });
  assert.equal(await page.getByRole('region', { name: 'Extruders' }).count(), 1);
  assert.deepEqual(await section.locator('h5').allTextContents(), ['Extruder 2', 'Extruder 4']);
  assert.match(await section.innerText(), /PLA\nSnapmaker · Matte\nPresent/);
  assert.match(await section.locator('[data-tool="3"]').innerText(), /Empty/);
  assert.equal(await section.locator('[data-tool="3"] .device-extruder-feed').count(), 0);
  assert.equal(await section.getByText('Unavailable', { exact: true }).count(), 4, 'missing temperatures never become zero');
  assert.equal(await section.locator('.device-filament-swatch').count(), 1);
  assert.equal(await section.locator('.device-filament-swatch').evaluate(n => getComputedStyle(n).backgroundColor), 'rgb(0, 0, 0)');
  assert.equal(await section.getByLabel('Color: #000000').count(), 1);
  assert.equal(await section.locator('button,input,select').count(), 0);

  const long = { ...slots[0], material: 'PLA with a very long printer-reported material description', vendor: 'VendorWithAnUnbrokenNameThatMustWrapInsideTheDeviceCard', subtype: 'Support material with a long descriptive subtype', presence: 'unknown', color: '#FFFFFF' };
  await page.evaluate(state => window.show(state), { ...base, filamentSlots: [long, slots[1], { ...slots[0], id: 'snapmaker:tool:7', slotIndex: 7, material: '', vendor: undefined, subtype: undefined, color: undefined }] });
  assert.match(await section.innerText(), /Presence unknown/);
  assert.match(await section.locator('[data-tool="7"]').innerText(), /Unknown material\nPresent/);
  assert.notEqual(await section.locator('[data-presence="unknown"] .device-extruder-feed').evaluate(n => getComputedStyle(n).strokeDasharray), 'none');
  assert.notEqual(await section.locator('[data-presence="unknown"] .device-extruder-feed').evaluate(n => getComputedStyle(n).stroke), 'rgb(255, 255, 255)');
  async function renderMatrix(provider) {
    for (const language of ['en', 'es']) {
      await page.evaluate(language => window.language(language), language);
    for (const theme of ['dark', 'light']) for (const width of [320, 390, 1280]) for (const scale of [1, 1.25]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(({ theme, scale }) => { document.documentElement.dataset.theme = theme; document.documentElement.style.setProperty('--ui-font-scale', String(scale)); }, { theme, scale });
    const fit = await section.evaluate(n => {
      const box = n.getBoundingClientRect();
      return { page: document.documentElement.scrollWidth <= innerWidth, section: n.scrollWidth <= n.clientWidth, contents: [...n.querySelectorAll('dt,dd,h5,.device-extruder-material')].every(c => { const b = c.getBoundingClientRect(); return b.left >= box.left && b.right <= box.right && c.scrollWidth <= c.clientWidth; }) };
    });
    assert.deepEqual(fit, { page: true, section: true, contents: true }, `${theme}/${width}/${scale}`);
    // New secondary text must remain legible against the incumbent card in both themes.
    const contrast = await section.evaluate(n => {
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      return Math.min(...[...n.querySelectorAll('dt, dd, h5, .device-extruder-type, .device-filament-note, .device-filament-detail')].map(c => {
        const background = luminance(getComputedStyle(c.closest('.device-extruder-card, .device-card')).backgroundColor);
        const foreground = luminance(getComputedStyle(c).color);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      }));
    });
    assert.ok(contrast >= 4.5, `${theme}/${width}/${scale} text contrast ${contrast}`);
    await page.screenshot({ path: new URL(`device-${provider}-${language}-${theme}-${width}-${scale === 1 ? 100 : 125}.png`, evidence).pathname, fullPage: true });
    console.log('render', provider, language, theme, width, scale, JSON.stringify(fit), 'minimum text contrast', contrast);
    }
    }
    await page.evaluate(() => window.language('en'));
  }
  await renderMatrix('snapmaker');

  await page.evaluate(state => window.show(state), { ...base, filamentSlots: [] });
  assert.match(await section.innerText(), /No filament assignments reported/);
  assert.equal(await section.locator('.device-extruder-card,.device-filament-swatch').count(), 0);
  await page.evaluate(state => window.show(state), base);
  assert.match(await section.innerText(), /Filament information unavailable/);
  await page.evaluate(state => window.show(state, 'error'), { ...base, filamentSlots: slots });
  assert.equal(await section.locator('.device-extruder-card,.device-filament-swatch').count(), 0, 'connection failure hides even retained data');
  for (const state of ['offline', 'error']) {
    await page.evaluate(state => window.show(state), { ...base, state, filamentSlots: slots, heaters: [{ id: 'extruder', kind: 'extruder', label: 'Extruder', current: 20, target: 200 }] });
    assert.equal(await section.locator('.device-extruder-card').count(), 0, 'offline clears retained material and temperatures');
  }
  await page.evaluate(() => window.show(null, 'none'));
  assert.match(await section.innerText(), /Filament information unavailable/);

  // Synthetic telemetry through the production parser/store must not change project choices.
  await page.evaluate(() => window.frame({ print_task_config: { filament_vendor: ['Snapmaker'], filament_type: ['PETG'], filament_exist: [true], filament_color: [4278255360] } }));
  assert.match(await section.innerText(), /PETG/);
  await page.evaluate(() => window.frame({ print_task_config: { filament_vendor: [], filament_type: [] } }));
  assert.equal(await section.locator('.device-extruder-card').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.project()), project);

  const providers = [
    { host: 'prusaconnect', slots: [
      { id: 'prusa-tool-3', slotIndex: 2, label: 'Tool 3', material: 'PLA', presence: 'present' },
      { id: 'prusa-tool-5', slotIndex: 4, label: 'Tool 5', material: '', presence: 'empty' },
      { id: 'prusa-tool-1.4', label: 'MMU slot 1.4', material: '', presence: 'unknown' },
    ] },
    { host: 'creality-cloud', slots: [
      { ...long, id: 'cfs-1-2', slotIndex: undefined, label: 'CFS 1-2', presence: 'present', color: '#000000' },
      { id: 'cfs-2-4', label: 'CFS 2-4', material: '', presence: 'empty' },
      { id: 'cfs-2-1', label: 'CFS 2-1', material: '', presence: 'unknown' },
      { id: 'rack-1', label: 'External Spool', material: 'PETG', presence: 'present' },
      { id: 'smart-rack-1', label: 'External Spool 1', material: 'PLA', presence: 'present' },
      { id: 'smart-rack-2', label: 'External Spool 2', material: '', presence: 'empty' },
    ] },
  ];
  section = page.locator('#device-filaments');
  for (const provider of providers) {
    await page.evaluate(host => window.provider(host), provider.host);
    const before = await page.evaluate(() => window.project());
    await page.evaluate(state => window.show(state), { ...base, filamentSlots: provider.slots });
    await page.evaluate(state => window.show(state), { ...base, filamentSlots: provider.slots, heaters: [
      { id: 'hotend', kind: 'extruder', label: 'Reported hotend', current: 20, target: 200 },
    ] });
    assert.equal(await cards.getByRole('heading', { name: 'Reported hotend' }).count(), 1);
    assert.match(await cards.innerText(), /Filament information unavailable/);
    assert.deepEqual(await section.locator('dt').allTextContents(), provider.slots.map(slot => slot.label));
    assert.deepEqual(await section.locator('[data-slot]').evaluateAll(nodes => nodes.map(n => n.dataset.slot)), provider.slots.filter(slot => slot.slotIndex != null).map(slot => String(slot.slotIndex)));
    assert.equal(await section.locator('button,input,select').count(), 0);
    if (provider.host === 'prusaconnect') {
      assert.match(await section.innerText(), /assignments do not confirm that filament is loaded/);
      assert.match(await section.innerText(), /PLA\nAssigned/);
      assert.match(await section.innerText(), /No material assigned/);
      assert.match(await section.innerText(), /Unknown material\nAssignment unknown/);
      assert.doesNotMatch(await section.innerText(), /Present|Empty|Presence unknown/);
    } else {
      assert.match(await section.innerText(), /Ordinary external-spool assignments do not confirm/);
      assert.match(await section.innerText(), /External Spool\nPETG\nAssigned/);
      assert.match(await section.innerText(), /External Spool 1\nPLA\nPresent/);
      assert.match(await section.innerText(), /External Spool 2\nEmpty/);
      assert.match(await section.innerText(), /Presence unknown/);
      assert.equal(await section.getByLabel('Color: #000000').count(), 1);
    }
    await page.evaluate(() => window.language('es'));
    assert.match(await section.innerText(), provider.host === 'prusaconnect'
      ? /Las asignaciones de material comunicadas no confirman/
      : /Las asignaciones de bobina externa convencional no confirman/);
    assert.match(await section.innerText(), /Asignado/);
    if (provider.host === 'prusaconnect') {
      assert.match(await section.innerText(), /Sin material asignado/);
      assert.match(await section.innerText(), /Asignación desconocida/);
    }
    await page.evaluate(() => window.language('en'));
    await renderMatrix(provider.host);

    // Keep provider identities after reordering; labels never derive from array positions.
    await page.evaluate(state => window.show(state), { ...base, filamentSlots: [...provider.slots].reverse() });
    assert.deepEqual(await section.locator('dt').allTextContents(), [...provider.slots].reverse().map(slot => slot.label));
    await page.evaluate(state => window.show(state), { ...base, filamentSlots: [] });
    assert.match(await section.innerText(), /No filament assignments reported/);
    assert.equal(await section.locator('dt,.device-filament-swatch').count(), 0);
    await page.evaluate(state => window.show(state), base);
    assert.match(await section.innerText(), /Filament information unavailable/);
    for (const status of ['error', 'none', 'connecting']) {
      await page.evaluate(({ state, status }) => window.show(state, status), { state: { ...base, filamentSlots: provider.slots }, status });
      assert.match(await section.innerText(), /Filament information unavailable/);
      assert.equal(await section.locator('dt,.device-filament-swatch').count(), 0);
    }
    for (const state of ['offline', 'error']) {
      await page.evaluate(state => window.show(state), { ...base, state, filamentSlots: provider.slots });
      assert.equal(await section.locator('dt,.device-filament-swatch').count(), 0);
    }
    await page.evaluate(() => window.show(null, 'none'));
    assert.match(await section.innerText(), /Filament information unavailable/);
    assert.deepEqual(await page.evaluate(() => window.project()), before, 'read-only inventory preserves project and saved printer assignments');
  }
  await page.evaluate(() => window.provider('bambu-cloud'));
  assert.equal(await page.locator('#device-filaments').count(), 0, 'other providers retain existing Device behavior');
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, [], 'read-only fixture makes no provider requests');
  assert.deepEqual(workers, [], 'read-only fixture starts no engine workers');
  console.log('Extruder cards passed: real Snapmaker decoder, four joined tools, sparse/reversed/missing/empty/unknown/offline, SVG colors, separate bed, Prusa/CFS semantics, project isolation and 96 rendered variants (en/es).');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
