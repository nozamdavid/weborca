#!/usr/bin/env node
// Focused real-engine plate commands. Also reused for isolated publication and live smoke.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectAddedPrinter } from './lib/printer.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = await import('../node_modules/playwright/index.mjs');
const base = process.env.APP_TEST_BASE_URL || 'http://127.0.0.1:5330';
const out = process.env.APP_TEST_OUTPUT || path.join(repo, 'docs/superpowers/plate-context-actions-20261014');
const mode = process.env.PLATE_MENU_MODE || 'regression';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], blocked = [];
const ids = ['select-all', 'select-all-plates', 'delete-all', 'arrange', 'auto-rotate', 'delete-plate'];
const labels = ['Select All', 'Select All Plates', 'Delete All', 'Arrange', 'Auto Rotate', 'Delete Plate'];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin || /^\/(api|gateway|printer|cloud|device|_printer|_gw|_cloud|_orca-cloud|orca-cloud)(\/|$)/.test(url.pathname)) {
      blocked.push(url.pathname); return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(base);
  await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.__prefsStore.getState().setGeneralPref('autosave', false);
    window.__prefsStore.getState().setGeneralPref('autoSliceAfterChange', false);
  });
  await selectAddedPrinter(page, 'Voron');
  await page.selectOption('#process-select', '0.20mm Standard @Voron');
  await page.selectOption('#filament-select', 'Generic PLA @System');
  const ready = () => page.waitForFunction(() => !window.__appStore.getState().isModelLoading && !window.__plateStore.getState().isLoading && !window.__platesStore.getState().isLoading && !window.__historyStore.getState().isRestoring);
  const open = async (index) => {
    await page.keyboard.press('Escape');
    await ready();
    const point = await page.evaluate(i => {
      const scene = window.__plateScene;
      const plate = window.__platesStore.getState().plates[i];
      const rect = scene.renderer.domElement.getBoundingClientRect();
      for (const [dx, dy] of [[0, 65], [65, 0], [-65, 0], [0, -65], [65, 65]]) {
        const v = scene.bedConfigCenterWorld(plate.origin);
        v.x += dx; v.y += dy; v.project(scene.camera);
        const x = rect.left + (v.x + 1) / 2 * rect.width, y = rect.top + (1 - v.y) / 2 * rect.height;
        if (scene.plateAt(x, y) === i && !scene.hitTest(x, y) && document.elementFromPoint(x, y) === scene.renderer.domElement) return { x, y };
      }
      throw new Error('Fixture needs visible empty canvas on the intended plate');
    }, index);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await page.locator('#plate-context-menu').waitFor();
  };
  const order = async () => {
    assert.deepEqual(await page.locator('#plate-context-menu > button').evaluateAll(nodes => nodes.slice(0, 6).map(n => n.textContent)), labels);
    assert.deepEqual(await page.locator('#plate-context-menu > button').evaluateAll(nodes => nodes.slice(0, 6).map(n => n.id)), ids.map(id => 'plate-menu-' + id));
    assert.equal(await page.locator('#plate-menu-delete-plate + [role=separator] + #plate-menu-primitive').count(), 1);
    assert.equal(await page.getByRole('menuitem', { name: 'Reload All', exact: true }).count(), 0);
  };
  await page.click('#view-top');
  await page.waitForTimeout(300);
  await open(0);
  await order();
  for (const id of ids) assert.equal(await page.locator('#plate-menu-' + id).isDisabled(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'plate-menu-primitive', 'roving focus skips disabled actions');
  await page.keyboard.press('Escape');
  await page.setInputFiles('#model-file', path.join(repo, 'tests/data/20mm_cube.obj'));
  await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1 && !window.__appStore.getState().isModelLoading);
  await ready();
  const first = await page.evaluate(() => window.__plateStore.getState().objects[0].id);
  if (mode === 'preflight') {
    await page.click('#slice-btn');
    await page.locator('.slice-stats-panel:visible').waitFor({ timeout: 90000 });
    await page.waitForFunction(() => window.__previewStore?.getState().layersCount > 0 && document.querySelector('#canvas')?.dataset.previewReady === 'true', null, { timeout: 30000 });
    assert.equal(await page.locator('.slice-stats-panel:visible #stat-layers').innerText(), '100');
    assert.equal(await page.locator('#preview-error-overlay').count(), 0);
    await page.getByRole('tab', { name: 'Prepare', exact: true }).click();
    console.log('PASS isolated public cube: 100 layers and native ready Preview');
  }
  if (mode !== 'live') {
    await page.evaluate(async () => { await window.__platesStore.getState().addPlate(); });
    await page.setInputFiles('#model-file', path.join(repo, 'tests/data/20mm_cube.obj'));
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 2 && !window.__appStore.getState().isModelLoading);
    await page.evaluate(async () => {
      const s = window.__plateStore.getState(), p = window.__platesStore.getState().plates[1];
      const obj = s.objects[1];
      await s.setInstanceTransform(obj.id, obj.instances[0].id, { offset: [p.origin[0] + 150, p.origin[1] + 150, 10] });
      await window.__platesStore.getState().fetchPlates();
      window.__platesStore.getState().setActivePlate(1);
    });
    await page.click('#view-fit');
    await page.click('#view-top');
    await page.waitForTimeout(400);
  }
  await open(0);
  await order();
  assert.equal(await page.locator('#plate-menu-delete-plate').isDisabled(), mode === 'live');
  await page.click('#plate-menu-select-all');
  assert.deepEqual(await page.evaluate(() => {
    const s = window.__plateStore.getState(); return [s.selectedObjectId, ...s.extraSelection.map(i => i.objectId)];
  }), [first]);
  const allCount = mode === 'live' ? 1 : 2;
  await open(0);
  await page.click('#plate-menu-select-all-plates');
  assert.equal(await page.evaluate(() => window.__plateStore.getState().extraSelection.length + 1), allCount);
  console.log('PASS menu order, separator, empty/last plate states and context selection versus project selection');
  if (mode === 'regression') {
    await page.evaluate(() => window.__platesStore.getState().setActivePlate(1));
    await open(0);
    await page.click('#plate-menu-arrange');
    await page.locator('#arrange-dialog').waitFor();
    assert.equal(await page.locator('#arrange-scope').inputValue(), 'current');
    assert.equal(await page.evaluate(() => window.__platesStore.getState().activePlateIndex), 0);
    await page.click('#arrange-cancel');
    await page.evaluate(() => {
      const engine = window.__orcaEngine, call = engine.call.bind(engine);
      window.__menuNativeCalls = [];
      engine.call = async (method, args, ...rest) => {
        const result = await call(method, args, ...rest);
        if (method === 'autoOrient') window.__menuNativeCalls.push({ method, args, result });
        return result;
      };
      window.__menuOperating = false;
      window.__editOpsStore.subscribe(state => { if (state.isOperating) window.__menuOperating = true; });
      window.__plateStore.getState().selectObject(null);
    });
    await open(0);
    await page.click('#plate-menu-auto-rotate');
    await page.waitForFunction(() => window.__menuNativeCalls.length === 1 && !window.__editOpsStore.getState().isOperating, null, { timeout: 60000 });
    assert.deepEqual(await page.evaluate(() => window.__menuNativeCalls[0].args.objectIds), [first]);
    assert.equal(await page.evaluate(() => window.__menuNativeCalls[0].result.success), true);
    assert.equal(await page.evaluate(() => window.__menuOperating), true);
    await page.waitForFunction(() => window.__plateStore.getState().selectedObjectId === null);
    assert.equal(await page.evaluate(() => window.__editOpsStore.getState().error), null);
    console.log('PASS existing Arrange dialog and real native Auto Rotate operation/busy progress/success with no manual selection');
    // Busy states and submenu dismissal use the menu's real reactive stores.
    await open(0);
    await page.evaluate(() => window.__appStore.setState({ isSlicing: true }));
    for (const id of ids) assert.equal(await page.locator('#plate-menu-' + id).isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__appStore.setState({ isSlicing: false }));
    await open(0);
    await page.hover('#plate-menu-primitive');
    await page.locator('#plate-submenu-primitive').waitFor();
    await page.locator('#plate-menu-primitive').focus();
    await page.locator('#plate-menu-select-all').focus();
    await page.locator('#plate-submenu-primitive').waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    // Objects still open the same object menu in the viewport.
    const point = await page.evaluate(id => {
      const scene = window.__plateScene, mesh = [...scene.objectMeshes.values()].find(m => m.userData.objectId === id);
      const rect = scene.renderer.domElement.getBoundingClientRect(), v = mesh.position.clone().project(scene.camera);
      return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
    }, first);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await page.locator('#object-list-context-menu').waitFor();
    assert.equal(await page.locator('#plate-context-menu').count(), 0);
    await page.keyboard.press('Escape');
    await open(0);
    await page.click('#plate-menu-delete-all');
    await page.waitForFunction(id => window.__plateStore.getState().objects.length === 1 && window.__plateStore.getState().objects[0].id !== id, first);
    await page.evaluate(async () => { await window.__historyStore.getState().undo(); });
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 2);
    await ready();
    assert.equal(await page.evaluate(() => window.__platesStore.getState().plates[0].instances.length), 1);
    console.log('PASS busy disabling, submenu dismissal, original object menu, plate-only Delete All and undo');
  }
  // Bounded Spanish labels at the viewport edge in both themes and densities.
  for (const width of ['regression', 'visual'].includes(mode) ? [1280, 390] : [1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => {
        window.__prefsStore.getState().setDisplayPref('theme', theme);
        window.__prefsStore.getState().setGeneralPref('language', 'es');
      }, theme);
      await page.keyboard.press('Escape');
      const box = await page.locator('#plate-canvas-container').boundingBox();
      await page.mouse.click(box.x + box.width - 12, box.y + box.height - 100, { button: 'right' });
      const menu = page.locator('#plate-context-menu');
      await menu.waitFor();
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await page.mouse.move(0, 0);
      await page.locator('#plate-menu-select-all-plates').focus();
      await page.locator('#plate-menu-select-all').focus();
      await page.locator('#plate-submenu-primitive, #plate-submenu-handy').waitFor({ state: 'detached' });
      const bounds = await menu.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 800);
      assert.equal(await page.locator('#plate-menu-select-all-plates').innerText(), 'Seleccionar todas las camas');
      await page.screenshot({ path: path.join(out, `menu-${mode}-${width}-${theme}-es.png`) });
    }
  }
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('language', 'en'));
  if (mode === 'regression') {
    await page.evaluate(async () => {
      await window.__platesStore.getState().setPlateConfig(0, {}, 'Context target');
      await window.__platesStore.getState().setPlateConfig(1, {}, 'Surviving plate');
      window.__plateStore.getState().selectObject(null);
      window.__platesStore.getState().setActivePlate(1);
    });
    await page.waitForTimeout(300);
    await page.click('#view-fit');
    await page.click('#view-top');
    await page.waitForTimeout(300);
    await open(0);
    await page.click('#plate-menu-delete-plate');
    await page.getByTestId('confirm-dialog').waitFor();
    assert.equal(await page.evaluate(() => window.__platesStore.getState().activePlateIndex), 1, 'opening deletion keeps active plate separate from context');
    await page.getByTestId('confirm-ok').click();
    await page.waitForFunction(() => window.__platesStore.getState().plates.length === 1 && !window.__platesStore.getState().isLoading);
    assert.equal(await page.evaluate(() => window.__platesStore.getState().activePlateIndex), 0);
    await page.click('#view-fit');
    await page.waitForTimeout(300);
    await open(0);
    assert.equal(await page.locator('#plate-menu-delete-plate').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__platesStore.getState().plates[0].name), 'Surviving plate', 'deletes the context plate rather than the active plate');
    assert.equal(await page.evaluate(() => window.__plateStore.getState().objects.length), 2, 'existing deletePlate behavior keeps objects');
    console.log('PASS confirmed context Delete Plate, surviving active plate and last-plate refusal');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  console.log(`PASS ${mode}: real engine, Spanish dark/light bounded menu, no page errors or printer/cloud requests`);
} finally { await browser.close(); }
