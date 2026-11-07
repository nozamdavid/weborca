import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../node_modules/playwright/index.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';
import { startServer, stopServer } from './lib/dist.mjs';

const base = process.env.APP_TEST_BASE_URL || 'http://127.0.0.1:5342';
const out = path.resolve(process.env.APP_TEST_OUTPUT || 'docs/superpowers/preview-shading-fixes-20261014');
fs.mkdirSync(out, { recursive: true });
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}
if (!process.env.APP_TEST_BASE_URL) await startServer(5342, 'preview-shading-fix', { frozenDist: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(base).origin && !/^\/(api|gateway|printer|cloud|device|_printer|_gw|_cloud|_orca-cloud|orca-cloud)(\/|$)/.test(url.pathname)
      ? route.continue() : route.abort();
  });
  let page = await context.newPage();
  // Cold WASM recovery can delay pointer dispatch under the fixture memory cap.
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const ready = async () => {
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(() => {
      const p = window.__prefsStore.getState();
      p.setGeneralPref('autosave', false);
      p.setGeneralPref('autoSliceAfterChange', false);
      p.setGeneralPref('slicingThreads', 1);
    });
  };
  await page.goto(base + '/prepare');
  await ready();
  await selectAddedPrinter(page, 'Voron');
  await page.setInputFiles('#model-file', path.resolve('tests/data/20mm_cube.obj'));
  await page.waitForFunction(() => window.__plateScene?.volumeMeshes.size === 1 && !window.__appStore.getState().isModelLoading);
  const ids = await page.evaluate(async () => {
    const obj = (await window.__orcaEngine.listObjects())[0];
    const part = (await window.__orcaEngine.getObjectTree()).objects[0].volumes[0];
    window.__plateStore.getState().selectObject(obj.id, obj.instances[0].id);
    const added = await window.__orcaEngine.addVolume({ objectId: obj.id, type: 'negative', shape: 'cube', size: 10, offset: [8, 8, 0], name: 'Overlay negative' });
    await window.__plateStore.getState().refreshObjects();
    await window.__objectListStore.getState().refreshTree();
    return { objectId: obj.id, instanceId: obj.instances[0].id, partId: part.id, negativeId: added.volumeId };
  });
  await page.waitForFunction(() => window.__plateScene.volumeMeshes.size === 2);
  // Fixed test framing only; product lights, colours, and camera behavior stay intact.
  await page.evaluate(() => {
    const s = window.__plateScene;
    const m = [...s.volumeMeshes.values()].find(m => m.userData.type === 'part');
    const Box = m.geometry.boundingBox.constructor;
    s.fitBounds(new Box().setFromObject(m), m.position.clone().set(-1, -1.5, 1.2), 60);
    window.__plateStore.getState().selectObject(null);
  });
  await page.waitForFunction(() => !document.getElementById('selection-panel') || getComputedStyle(document.getElementById('selection-panel')).display === 'none');
  async function pixels(old = false) {
    const points = await page.evaluate(old => {
      const s = window.__plateScene;
      const m = [...s.volumeMeshes.values()].find(m => m.userData.type === 'part');
      const parent = m.parent;
      parent.material = old ? s.defaultMaterial : s.hiddenMaterial;
      for (const n of s.volumeMeshes.values()) n.visible = !old;
      s.renderer.render(s.scene, s.camera);
      const b = m.geometry.boundingBox;
      const v = (x, y, z) => m.position.clone().set(x, y, z).applyMatrix4(m.matrixWorld).project(s.camera);
      const at = (x, y, z) => v(b.min.x + (b.max.x-b.min.x)*x, b.min.y + (b.max.y-b.min.y)*y, b.min.z + (b.max.z-b.min.z)*z);
      const r = s.renderer.domElement.getBoundingClientRect();
      return [[at(.3,.5,1),at(.7,.5,1)], [at(.3,0,.5),at(.7,0,.5)], [at(0,.3,.5),at(0,.7,.5)]].map(face => face.map(p => ({ x: Math.round(r.x + (p.x+1)*r.width/2), y: Math.round(r.y + (1-p.y)*r.height/2) })));
    }, old);
    const image = await page.screenshot({ path: path.join(out, `${old ? 'old' : 'volume'}-${await page.evaluate(() => document.documentElement.dataset.theme)}.png`) });
    return page.evaluate(async ({ data, points }) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img,0,0);
      return points.map(face => face.map(p => [...ctx.getImageData(p.x,p.y,1,1).data].slice(0,3)));
    }, { data: image.toString('base64'), points });
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.__prefsStore.getState().setDisplayPref('theme', theme), theme);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    const old = await pixels(true);
    const current = await pixels(false);
    console.log('FACE PIXELS', JSON.stringify({ theme, old, current }));
    await check(`${theme} cube faces remain flat with visible face contrast`, async () => {
      for (const face of current) assert.ok(Math.max(...face[0].map((c,i) => Math.abs(c-face[1][i]))) <= 3, `within-face gradient ${JSON.stringify(face)}`);
      assert.ok(Math.max(...current[0][0].map((c,i) => Math.abs(c-current[1][0][i]))) >= 15, 'top/front face contrast');
      for (let f=0; f<3; f++) for (let c=0; c<3; c++) assert.ok(Math.abs(current[f][0][c]-old[f][0][c]) <= 3, 'old normal-part illumination retained');
    });
  }
  await page.evaluate(async ids => {
    await window.__plateStore.getState().setVolumeTransform(ids.objectId, ids.negativeId, { offset: [-8,-8,0] });
    window.__objectListStore.getState().selectItem(ids.objectId, ids.partId);
  }, ids);
  await check('selected normal part retains selection and negative opacity', async () => {
    await page.waitForFunction(ids => {
      const nodes = [...window.__plateScene.volumeMeshes.values()];
      return nodes.find(n => n.userData.volumeId === ids.partId)?.material.emissive.r > 0 && nodes.find(n => n.userData.volumeId === ids.negativeId)?.material.emissive.r === 0;
    }, ids);
  });
  for (const theme of ['light','dark']) {
    await page.evaluate(theme => window.__prefsStore.getState().setDisplayPref('theme',theme),theme);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme,theme);
    await page.screenshot({path:path.join(out,`selected-negative-${theme}.png`)});
  }
  await check('negative stays translucent and part Move preserves native parent and sibling', async () => {
    const result = await page.evaluate(async ids => {
      const s = window.__plateScene;
      const n = [...s.volumeMeshes.values()].find(m => m.userData.type === 'negative');
      const e = window.__orcaEngine;
      const before = (await e.listObjects())[0].instances;
      const sibling = await e.call('getVolume', { objectId: ids.objectId, volumeId: ids.negativeId });
      const part = await e.call('getVolume', { objectId: ids.objectId, volumeId: ids.partId });
      await window.__plateStore.getState().setVolumeTransform(ids.objectId, ids.partId, { offset: [part.offset[0]+1, part.offset[1], part.offset[2]] });
      return { material: [n.material.transparent,n.material.opacity,n.material.side,n.material.depthWrite], before, after: (await e.listObjects())[0].instances,
        sibling, siblingAfter: await e.call('getVolume', { objectId: ids.objectId, volumeId: ids.negativeId }),
        moved: await e.call('getVolume', { objectId: ids.objectId, volumeId: ids.partId }) };
    }, ids);
    assert.deepEqual(result.material, [true,.35,2,false]);
    assert.deepEqual(result.before,result.after); assert.deepEqual(result.sibling,result.siblingAfter);
    assert.equal(result.moved.offset[0],1);
  });
  // Save real multipart native bytes after the part edit, then use the actual recovery offer.
  await page.evaluate(async () => { if (!await window.__autosave.writeAutosave()) throw new Error('backup failed'); });
  const slice = async selector => {
    await page.click(selector);
    await page.waitForFunction(() => !window.__appStore.getState().isSlicing && (window.__appStore.getState().sliceResult || window.__appStore.getState().engineError), null, { timeout: 90000 });
    const state = await page.evaluate(() => { const s = window.__appStore.getState(); return { error:s.engineError, bytes:s.sliceResult?.gcode?.length, recovery:s.sessionRecovery }; });
    console.log('NATIVE SLICE', JSON.stringify(state));
    assert.equal(state.error,null); assert.ok(state.bytes > 0);
    await page.waitForURL('**/preview', { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('canvas')?.dataset.previewReady === 'true', null, { timeout: 60000 });
    assert.equal(await page.locator('#canvas').isVisible(), true);
  };
  await check('desktop fresh sidebar Slice from Prepare opens native Preview', async () => { await slice('#slice-btn'); });
  for (const width of [1280,390]) {
    // Keep IndexedDB recovery bytes, but release the prior WASM page under the 2 GiB cap.
    await page.close();
    page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await page.goto(base + '/prepare'); await ready();
    await page.click('#recovery-restore');
    try {
      await page.waitForFunction(() => window.__appStore.getState().sessionRecovery === 'restored', null, { timeout:90000 });
    } catch (error) {
      console.error('RECOVERY STATE', await page.evaluate(() => {
        const s=window.__appStore.getState();
        return { recovery:s.sessionRecovery, loading:s.isModelLoading, error:s.engineError, status:s.sliceStatusText,
          dialog:document.getElementById('recovery-dialog')?.innerText };
      }));
      throw error;
    }
    await check(`${width} recovery remains Prepare and preserves edited part`, async () => {
      assert.equal(new URL(page.url()).pathname,'/prepare');
      assert.equal(await page.locator('.prepare-page').isVisible(),true);
      assert.equal(await page.evaluate(async () => (await window.__orcaEngine.getObjectTree()).objects[0].volumes.length),2);
      assert.equal(await page.evaluate(async () => { const o=(await window.__orcaEngine.getObjectTree()).objects[0]; return (await window.__orcaEngine.call('getVolume',{objectId:o.id,volumeId:o.volumes[0].id})).offset[0]; }),1);
    });
    if (width === 390) {
      await page.click('#mobile-choose-settings');
      for(let i=0;i<3;i++) await page.click('#mobile-next');
    }
    await check(`${width} post-recovery UI Slice opens native Preview`, async () => { await slice(width===390 ? '#mobile-slice' : '#slice-plate-btn'); });
    if (new URL(page.url()).pathname === '/prepare') {
      // Continue evidence collection after a red auto-switch assertion using the real manual control.
      await page.getByRole(width===390 ? 'button':'tab',{name:'Preview',exact:true}).click();
    }
    await page.screenshot({ path: path.join(out, `native-preview-${width}.png`) });
  }
  await page.setViewportSize({ width:1280,height:800 });
  await page.getByRole('tab',{name:'Prepare',exact:true}).click();
  await check('cancelled actual slice stays Prepare without a result', async () => {
    await page.click('#slice-plate-btn');
    await page.click('#preview-cancel-btn');
    await page.waitForFunction(() => !window.__appStore.getState().isSlicing, null, {timeout:90000});
    assert.equal(new URL(page.url()).pathname,'/prepare');
    assert.equal(await page.evaluate(() => window.__appStore.getState().sliceResult),null);
  });
  await check('no browser page errors', async () => assert.deepEqual(errors,[]));
} finally { await browser.close(); if (!process.env.APP_TEST_BASE_URL) await stopServer(5342); }
if(failures) process.exitCode=1;
