#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const base = process.env.APP_TEST_BASE_URL || 'http://127.0.0.1:5330';
const out = process.env.APP_TEST_OUTPUT || path.join(root, 'docs/superpowers/mobile-touch-20261014');
const narrow = process.env.MOBILE_TOUCH_MODE && process.env.MOBILE_TOUCH_MODE !== 'regression';
const hoverCheck = process.env.MOBILE_TOUCH_MODE?.startsWith('hover');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], blocked = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin || /^\/(api|gateway|printer|cloud|device|_printer|_gw|_cloud|_orca-cloud|orca-cloud)(\/|$)/.test(url.pathname)) {
      blocked.push(url.pathname); return route.abort();
    }
    return route.continue();
  });
  // Read the actual WASM renderer's matrices. No application or native camera mock.
  await context.addInitScript(() => {
    const names = new WeakMap();
    const get = WebGL2RenderingContext.prototype.getUniformLocation;
    WebGL2RenderingContext.prototype.getUniformLocation = function(program, name) {
      const location = get.call(this, program, name);
      if (location) names.set(location, name);
      return location;
    };
    const set = WebGL2RenderingContext.prototype.uniformMatrix4fv;
    WebGL2RenderingContext.prototype.uniformMatrix4fv = function(location, ...args) {
      set.call(this, location, ...args);
      const name = names.get(location);
      if (this.canvas.id === 'canvas' && ['view_matrix', 'projection_matrix'].includes(name)) {
        window.__touchMatrices ??= {};
        window.__touchMatrices[name] = Array.from(this.getUniform(this.getParameter(this.CURRENT_PROGRAM), location));
      }
    };
    window.__trustedTouches = [];
    document.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') window.__trustedTouches.push({ id: e.pointerId, trusted: e.isTrusted });
    }, true);
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
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
  await page.setInputFiles('#model-file', path.join(root, 'tests/data/20mm_cube.obj'));
  await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1 && !window.__appStore.getState().isModelLoading);
  await page.waitForTimeout(300);
  const unchanged = () => page.evaluate(() => ({ objects: window.__plateStore.getState().objects, config: window.__appStore.getState().currentConfig }));
  const original = await unchanged();
  const camera = async preview => page.evaluate(preview => {
    if (!preview) {
      const s = window.__plateScene, target = s.orbitControls.target.toArray();
      return { rotation: s.camera.quaternion.toArray(), target, distance: s.camera.position.distanceTo(s.orbitControls.target), zoom: s.camera.zoom };
    }
    const v = window.__touchMatrices.view_matrix, p = window.__touchMatrices.projection_matrix;
    const distance = (p[14] / (p[10] - 1)) / 0.01;
    const eye = [0, 1, 2].map(i => -(v[i * 4] * v[12] + v[i * 4 + 1] * v[13] + v[i * 4 + 2] * v[14]));
    return { rotation: v.slice(0, 12), target: eye.map((n, i) => n - v[i * 4 + 2] * distance), distance, zoom: 1 };
  }, preview);
  const changed = (a, b, key) => assert.ok(Array.isArray(a[key]) ? a[key].some((n, i) => Math.abs(n - b[key][i]) > 0.001) : Math.abs(a[key] - b[key]) > 0.001, `${key} changed`);
  const sameCamera = (a, b) => {
    for (const key of ['rotation', 'target', 'distance', 'zoom']) {
      const aa = [].concat(a[key]), bb = [].concat(b[key]);
      assert.ok(aa.every((n, i) => Math.abs(n - bb[i]) < 0.03), `${key}: finger transition has no jump ${JSON.stringify({a, b})}`);
    }
  };
  const point = async (object = false) => page.evaluate(object => {
    const s = window.__plateScene, r = s.renderer.domElement.getBoundingClientRect();
    if (object === true) {
      const mesh = [...s.objectMeshes.values()][0];
      const p = mesh.position.clone(); p.z += 10; p.project(s.camera);
      const x = r.left + (p.x + 1) * r.width / 2, y = r.top + (1 - p.y) * r.height / 2;
      if (s.hitTest(x, y) && document.elementFromPoint(x, y) === s.renderer.domElement) return { x, y };
    }
    for (let y = r.top + 100; y < r.bottom - 80; y += 20) for (let x = r.left + 30; x < r.right - 30; x += 20) {
      if ((object === 'away' || s.plateAt(x, y) === 0) && !s.hitTest(x, y) && document.elementFromPoint(x, y) === s.renderer.domElement) return { x, y };
    }
    throw Error('No unobstructed intended canvas hit');
  }, object);
  const cdp = await context.newCDPSession(page);
  const touch = async (type, points) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ ...p, radiusX: 1, radiusY: 1, force: 1 })) });
    await page.waitForTimeout(35);
  };
  const finger = (p, id = 1) => ({ ...p, id });
  const release = () => touch('touchEnd', []);
  const dismiss = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(50); };
  const menuBounds = async selector => {
    await page.locator(selector).waitFor();
    const b = await page.locator(selector).boundingBox();
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= page.viewportSize().width + 1 && b.y + b.height <= 801, 'menu clamped');
    assert.equal(await page.locator(selector).getAttribute('role'), 'menu');
    assert.ok(await page.locator(selector).evaluate(el => el.contains(document.activeElement)), 'menu keyboard focus');
  };
  const dismissTouch = async selector => {
    const outside = await point('away');
    const before = await camera(false);
    const selection = await page.evaluate(() => window.__plateStore.getState().selectedObjectId);
    await touch('touchStart', [finger(outside)]);
    assert.equal(await page.locator(selector).count(), 0, 'new outside touch closes menu immediately');
    await touch('touchMove', [finger({ x: outside.x + 15, y: outside.y + 10 })]);
    await release();
    await page.waitForTimeout(600);
    assert.equal(await page.locator('[role=menu]:visible').count(), 0, 'dismissal owns release');
    sameCamera(before, await camera(false));
    assert.equal(await page.evaluate(() => window.__plateStore.getState().selectedObjectId), selection, 'outside dismissal preserves selection');
    assert.deepEqual(await unchanged(), original, 'outside dismissal preserves models/config');
    console.log(`PASS ${selector}: outside trusted touch dismisses without scene action`);
  };
  const tapItem = async selector => {
    await page.locator(selector).scrollIntoViewIfNeeded();
    const b = await page.locator(selector).boundingBox();
    await touch('touchStart', [finger({ x: b.x + b.width / 2, y: b.y + b.height / 2 })]);
    await release();
  };
  if (hoverCheck) {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await page.evaluate(() => window.__plateScene.setCameraView(0));
    await page.waitForTimeout(1200);
    // Clamping puts Add Primitive beneath the stationary opening mouse.
    const bottomPlate = await page.evaluate(() => {
      const s = window.__plateScene, r = s.renderer.domElement.getBoundingClientRect();
      for (let y = r.bottom - 40; y > r.top; y -= 10) for (let x = r.left + r.width / 2; x < r.right - 40; x += 10) {
        if (s.plateAt(x, y) === 0 && !s.hitTest(x, y) && document.elementFromPoint(x, y) === s.renderer.domElement) return { x, y };
      }
      throw Error('No lower visible plate point');
    });
    await page.mouse.click(bottomPlate.x, bottomPlate.y, { button: 'right' });
    await menuBounds('#plate-context-menu');
    const anchor = await page.locator('#plate-menu-primitive').boundingBox();
    await dismiss();
    const stationary = { x: page.viewportSize().width - 30, y: anchor.y + anchor.height / 2 };
    assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.tagName, stationary), 'CANVAS');
    for (let opening = 0; opening < 2; opening++) {
      await page.mouse.click(stationary.x, stationary.y, { button: 'right' });
      await menuBounds('#plate-context-menu');
      assert.equal(await page.locator('#plate-menu-primitive').evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), stationary), true, 'new menu actually covers stationary pointer with submenu trigger');
      await page.screenshot({ path: path.join(out, `desktop-initial-${opening}.png`) });
      assert.equal(await page.locator('#plate-submenu-primitive').count(), 0, 'stationary pointer and initial focus keep submenu closed on every opening');
      await page.mouse.move(stationary.x + 2, stationary.y);
      await page.locator('#plate-submenu-primitive').waitFor();
      await page.screenshot({ path: path.join(out, `desktop-moved-${opening}.png`) });
      await dismiss();
    }
    await page.mouse.click(stationary.x, stationary.y, { button: 'right' });
    await menuBounds('#plate-context-menu');
    await page.keyboard.press('Home');
    for (let step = 0; step < 8 && await page.evaluate(() => document.activeElement.id) !== 'plate-menu-primitive'; step++) await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'plate-menu-primitive', 'keyboard roving reaches submenu trigger');
    await page.keyboard.press('ArrowRight');
    await page.locator('#plate-submenu-primitive').waitFor();
    assert.ok(await page.locator('#plate-submenu-primitive').evaluate(el => el.contains(document.activeElement)), 'ArrowRight opens and focuses flyout without mouse movement');
    await dismiss();
    await page.mouse.click(stationary.x, stationary.y, { button: 'right' });
    await menuBounds('#plate-context-menu');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.locator('#plate-submenu-handy').waitFor();
    await dismiss();
    const objectPoint = await point(true);
    await page.mouse.click(objectPoint.x, objectPoint.y, { button: 'right' });
    await menuBounds('#object-list-context-menu');
    assert.equal(await page.locator('[id^=submenu-]').count(), 0, 'object initial focus keeps all flyouts closed');
    await page.keyboard.press('ArrowRight');
    await page.locator('#submenu-part').waitFor();
    assert.ok(await page.locator('#submenu-part').evaluate(el => el.contains(document.activeElement)), 'object ArrowRight focuses portal');
    await dismiss();
    await page.mouse.click(objectPoint.x, objectPoint.y, { button: 'right' });
    await menuBounds('#object-list-context-menu');
    await page.hover('#menu-item-negative');
    await page.locator('#submenu-negative').waitFor();
    await page.keyboard.press('ArrowRight');
    await page.locator('#submenu-part').waitFor();
    assert.ok(await page.locator('#submenu-part').evaluate(el => el.contains(document.activeElement)), 'ArrowRight opens the focused trigger when hover showed another flyout');
    await dismiss();
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    console.log('PASS stationary desktop pointer, real movement, reopen reset and keyboard ArrowRight');
  }
  if (!narrow) {
    const p = await point();
    const before = await camera(false);
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 35, p.y + 20, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(1200); changed(before, await camera(false), 'rotation');
    const panBefore = await camera(false);
    await page.mouse.move(p.x, p.y); await page.mouse.down({ button: 'right' }); await page.mouse.move(p.x + 25, p.y, { steps: 5 }); await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(1200); changed(panBefore, await camera(false), 'target');
    const wheelBefore = await camera(false); await page.mouse.wheel(0, 80); await page.waitForTimeout(1200);
    const wheelAfter = await camera(false); assert.ok(wheelBefore.distance !== wheelAfter.distance || wheelBefore.zoom !== wheelAfter.zoom);
    console.log('PASS desktop mouse orbit/pan/wheel');
  }
  const navigate = async preview => {
    const selected = await page.evaluate(() => window.__plateStore.getState().selectedObjectId);
    const canvas = preview ? page.locator('#canvas') : page.locator('.plate-view canvas').first();
    const b = await canvas.boundingBox();
    const p = { x: b.x + b.width * 0.45, y: b.y + b.height * 0.5 };
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, p), 'CANVAS');
    let a = finger({ x: p.x - 35, y: p.y }), z = finger({ x: p.x + 35, y: p.y }, 2);
    const before = await camera(preview);
    await touch('touchStart', [a]);
    a = { ...a, x: a.x + 20, y: a.y + 12 }; await touch('touchMove', [a]);
    await page.waitForTimeout(1200); changed(before, await camera(preview), 'rotation');
    let settled = await camera(preview);
    await touch('touchStart', [a, z]); sameCamera(settled, await camera(preview));
    a = { ...a, x: a.x - 15 }; z = { ...z, x: z.x + 15 };
    await touch('touchMove', [a, z]); await page.waitForTimeout(1200);
    const zoomed = await camera(preview);
    assert.ok(Math.abs(zoomed.distance - settled.distance) > 0.1 || Math.abs(zoomed.zoom - settled.zoom) > 0.01, 'pinch changes camera distance/zoom');
    settled = zoomed;
    a = { ...a, x: a.x + 15, y: a.y + 14 }; z = { ...z, x: z.x + 15, y: z.y + 14 };
    await touch('touchMove', [a, z]); await page.waitForTimeout(1200); changed(settled, await camera(preview), 'target');
    settled = await camera(preview);
    await touch('touchEnd', [z]); sameCamera(settled, await camera(preview));
    await touch('touchMove', [a]); sameCamera(settled, await camera(preview));
    await release();
    assert.equal(await page.evaluate(() => window.__plateStore.getState().selectedObjectId), selected, 'remaining finger does not select');
    // Native browser cancellation, then a following working gesture.
    await touch('touchStart', [a, z]); await touch('touchCancel', []);
    await touch('touchStart', [a]); a = { ...a, x: a.x + 12 }; await touch('touchMove', [a]); await release();
    await page.waitForTimeout(1200); changed(settled, await camera(preview), 'rotation');
    if (preview) assert.equal(await page.locator('[role=menu]:visible').count(), 0);
    assert.deepEqual(await unchanged(), original, 'navigation preserves models and config');
    console.log(`PASS ${preview ? 'Preview' : 'Prepare'} ${page.viewportSize().width}: orbit, pinch, centroid pan, transitions, cancel recovery`);
  };
  for (const width of narrow ? [390] : [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(1200);
    if (process.env.MOBILE_TOUCH_MODE !== 'dismiss-red' && !hoverCheck) await navigate(false);
    await page.evaluate(() => window.__plateScene.setCameraView(0));
    await page.waitForTimeout(1200);
    const obj = await point(true);
    await page.evaluate(() => window.__plateStore.getState().selectObject(null, null));
    await touch('touchStart', [finger(obj)]); await release();
    assert.notEqual(await page.evaluate(() => window.__plateStore.getState().selectedObjectId), null, 'tap selects object');
    await page.mouse.click(obj.x, obj.y, { button: 'right' });
    await menuBounds('#object-list-context-menu');
    const desktopItems = await page.locator('#object-list-context-menu > button').evaluateAll(ns => ns.map(n => n.id));
    await page.mouse.click((await point()).x, (await point()).y);
    assert.equal(await page.locator('#object-list-context-menu').count(), 0, 'desktop outside mouse dismisses');
    await page.mouse.click(obj.x, obj.y, { button: 'right' });
    await dismiss();
    for (const theme of narrow && process.env.MOBILE_TOUCH_MODE !== 'hover' ? ['dark'] : ['dark', 'light']) {
      await page.evaluate(theme => window.__prefsStore.getState().setDisplayPref('theme', theme), theme);
      await touch('touchStart', [finger(obj)]); await page.waitForTimeout(550);
      await menuBounds('#object-list-context-menu');
      if (hoverCheck) assert.equal(await page.locator('[id^=submenu-]').count(), 0, 'object longpress initial autofocus does not open submenu');
      assert.deepEqual(await page.locator('#object-list-context-menu > button').evaluateAll(ns => ns.map(n => n.id)), desktopItems, 'same existing hit-object context menu');
      await release();
      assert.equal(await page.locator('#object-list-context-menu').isVisible(), true, 'release does not replace/dismiss longpress menu');
      await page.screenshot({ path: path.join(out, `object-menu-${width}-${theme}.png`) });
      await tapItem('#menu-item-extruder');
      assert.equal(await page.locator('#submenu-extruder').isVisible(), true, 'touch inside opens object flyout');
      if (hoverCheck) await page.screenshot({ path: path.join(out, `object-touch-open-${width}-${theme}.png`) });
      const flyout = await page.locator('#submenu-extruder').boundingBox();
      await touch('touchStart', [finger({ x: flyout.x + 2, y: flyout.y + 2 })]);
      await release();
      assert.equal(await page.locator('#object-list-context-menu').isVisible(), true, 'touch in portal stays inside menu');
      await dismissTouch('#object-list-context-menu');
    }
    for (const theme of narrow && process.env.MOBILE_TOUCH_MODE !== 'hover' ? ['dark'] : ['dark', 'light']) {
      await page.evaluate(theme => window.__prefsStore.getState().setDisplayPref('theme', theme), theme);
      const empty = await point();
      await touch('touchStart', [finger(empty)]); await page.waitForTimeout(550);
      await menuBounds('#plate-context-menu');
      if (hoverCheck) assert.equal(await page.locator('[id^=plate-submenu-]').count(), 0, 'plate longpress keeps submenus closed');
      assert.deepEqual(await page.locator('#plate-context-menu > button').evaluateAll(ns => ns.slice(0, 6).map(n => n.id)), ['select-all', 'select-all-plates', 'delete-all', 'arrange', 'auto-rotate', 'delete-plate'].map(id => 'plate-menu-' + id));
      await release();
      assert.equal(await page.locator('#plate-context-menu').isVisible(), true, 'plate longpress release retains menu');
      await page.screenshot({ path: path.join(out, `menu-${width}-${theme}.png`) });
      await tapItem('#plate-menu-primitive');
      assert.equal(await page.locator('#plate-submenu-primitive').isVisible(), true, 'touch inside opens plate flyout');
      if (hoverCheck) await page.screenshot({ path: path.join(out, `plate-touch-open-${width}-${theme}.png`) });
      await dismissTouch('#plate-context-menu');
      // A later menu item still activates after the dismissal guard has expired.
      await touch('touchStart', [finger(empty)]); await page.waitForTimeout(550); await release();
      const labels = await page.evaluate(() => window.__prefsStore.getState().display.showLabels);
      await tapItem('#plate-menu-labels');
      assert.equal(await page.locator('#plate-context-menu').count(), 0, 'inside item closes menu');
      assert.equal(await page.evaluate(() => window.__prefsStore.getState().display.showLabels), !labels, 'inside item activates once');
      await page.evaluate(() => window.__prefsStore.getState().toggleShowLabels());
    }
    if (!narrow) {
      for (const kind of ['move', 'second', 'cancel']) {
        const p = await point();
        await touch('touchStart', [finger(p)]);
        if (kind === 'move') await touch('touchMove', [finger({ x: p.x + 15, y: p.y })]);
        if (kind === 'second') { const second = finger({ x: p.x + 25, y: p.y }, 2); await touch('touchStart', [finger(p), second]); await touch('touchEnd', [second]); }
        if (kind === 'cancel') await touch('touchCancel', []);
        await page.waitForTimeout(550);
        assert.equal(await page.locator('[role=menu]:visible').count(), 0, `${kind} cancels longpress`);
        if (kind !== 'cancel') await release();
      }
    }
    assert.deepEqual(await unchanged(), original);
    const next = await point();
    const beforeNext = await camera(false);
    await touch('touchStart', [finger(next)]);
    await touch('touchMove', [finger({ x: next.x + 20, y: next.y + 12 })]); await release();
    await page.waitForTimeout(1200); changed(beforeNext, await camera(false), 'rotation');
    console.log('PASS next gesture after dismissal and inside item activation');
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click('#slice-btn');
  await page.waitForSelector('#canvas[data-preview-ready=true]', { timeout: 90000 });
  assert.equal(await page.locator('.slice-stats-panel:visible #stat-layers').innerText(), '100');
  await page.waitForFunction(() => window.__touchMatrices?.view_matrix && window.__touchMatrices?.projection_matrix);
  // Count native parse/load calls while navigation and rendering run together.
  await page.evaluate(() => {
    window.__touchLoads = 0;
    for (const name of ['loadGcode', 'loadGcodeFromFile']) {
      if (typeof window.preview[name] !== 'function') continue;
      const original = window.preview[name].bind(window.preview);
      window.preview[name] = (...args) => { window.__touchLoads++; return original(...args); };
    }
  });
  for (const width of narrow ? [390] : [390, 320]) {
    await page.setViewportSize({ width, height: 800 }); await page.waitForTimeout(1200);
    await navigate(true);
    for (const theme of narrow ? ['dark'] : ['dark', 'light']) {
      await page.evaluate(theme => window.__prefsStore.getState().setDisplayPref('theme', theme), theme);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(out, `preview-${width}-${theme}.png`) });
    }
  }
  assert.equal(await page.evaluate(() => window.__touchLoads), 0, 'no native G-code reload during navigation');
  const events = await page.evaluate(() => window.__trustedTouches);
  assert.ok(events.length > 10 && events.every(e => e.trusted), 'CDP produces trusted browser touch pointers');
  assert.ok(new Set(events.map(e => e.id)).size > 1);
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  console.log('PASS public cube: 100 layers, trusted two-ID touch, unchanged transforms/config, no parse/upload, no page errors or external requests');
} finally { await browser.close(); }
