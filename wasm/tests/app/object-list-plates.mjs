#!/usr/bin/env node
/** Browser test of the sidebar object list: grouping by plate, context-menu reorder, modifier nesting, the slicing guard and the SVG visibility icons. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5131', 10);
const here = path.dirname(fileURLToPath(import.meta.url));
const cube = path.resolve(here, '../../../tests/data/20mm_cube.obj');
const appRoot = path.resolve(here, '../../app');

// Static check: the eye icons are official Heroicons files shipped with their MIT license, not emoji.
for (const name of ['heroicons-eye.svg', 'heroicons-eye-slash.svg', 'LICENSE-heroicons.txt']) assert.ok(fs.existsSync(path.join(appRoot, 'public/icons', name)), `${name} is shipped`);
assert.match(fs.readFileSync(path.join(appRoot, 'public/icons/LICENSE-heroicons.txt'), 'utf8'), /MIT License[\s\S]*Tailwind Labs/);
assert.ok(!/👁/.test(fs.readFileSync(path.join(appRoot, 'src/preview/ViewTypeLegend.tsx'), 'utf8')), 'the legend has no eye emoji');
for (const f of ['settings/SettingsPanel.tsx', 'settings/SettingsDialog.tsx']) assert.ok(!/💾/.test(fs.readFileSync(path.join(appRoot, 'src', f), 'utf8')), `${f} has no save emoji`);
assert.ok(fs.existsSync(path.join(appRoot, 'public/icons/save.svg')) && fs.existsSync(path.join(appRoot, 'public/icons/ICON-SOURCES.txt')), 'save icon and its source note are shipped');

await startServer(PORT, 'object-list-plates', { frozenDist: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
try {
  page.on('pageerror', (err) => console.error('[pageerror]', err));
  await page.goto(`http://127.0.0.1:${PORT}`);
  await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

  console.log('two plates: two objects on plate 1, one on plate 2');
  const count = () => page.evaluate(() => window.__plateStore.getState().objects.length);
  const groupRows = (key) => page.evaluate((k) => [...document.querySelectorAll(`[data-testid=plate-group-${k}] [data-testid^=object-row-]`)].map((el) => Number(el.dataset.testid.replace('object-row-', ''))), key);
  await page.setInputFiles('#model-file', { name: 'first.obj', mimeType: 'text/plain', buffer: fs.readFileSync(cube) });
  await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1);
  await page.waitForSelector('[data-testid=plate-group-0] [data-testid^=object-row-]');
  assert.deepEqual(await groupRows('0'), await page.evaluate(() => window.__plateStore.getState().objects.map((o) => o.id)), 'plain normal import appears on Plate 1 without a test-side membership refresh');
  assert.deepEqual(await groupRows('unassigned'), []);
  await page.screenshot({ path: path.resolve(here, '../../build/ui-night3-membership-normal-import.png') });
  await page.evaluate(() => window.__platesStore.getState().addPlate('Second'));
  await page.setInputFiles('#model-file', { name: 'second.obj', mimeType: 'text/plain', buffer: fs.readFileSync(cube) });
  await page.waitForFunction(() => window.__plateStore.getState().objects.length === 2);
  await page.evaluate(() => window.__platesStore.getState().setActivePlate(0));
  await page.setInputFiles('#model-file', { name: 'third.obj', mimeType: 'text/plain', buffer: fs.readFileSync(cube) });
  await page.waitForFunction(() => window.__plateStore.getState().objects.length === 3);
  // Set up plate membership through real instance coordinates, as plates.mjs does.
  await page.evaluate(async () => {
    const store = window.__plateStore.getState();
    const object = store.objects.find((o) => o.name === 'second.obj');
    await store.setInstanceTransform(object.id, object.instances[0].id, { offset: [510, 150, 10] });
  });
  assert.equal(await count(), 3);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^=object-row-]').length === 3);

  await page.waitForFunction(() => document.querySelectorAll('[data-testid=plate-group-1] [data-testid^=object-row-]').length === 1);
  const first = await groupRows('0');
  assert.equal(first.length, 2, 'plate 1 lists two objects');
  assert.equal((await groupRows('1')).length, 1, 'plate 2 lists one object');
  assert.equal(await page.locator('[data-testid=plate-group-count-0]').textContent(), '2');
  assert.equal(await page.locator('[data-testid=plate-group-count-1]').textContent(), '1');
  assert.match(await page.locator('[data-testid=plate-group-header-1]').textContent(), /Second/);

  console.log('arrange, move and paste synchronize membership without test-side refreshes');
  await page.evaluate(() => window.__plateStore.getState().arrange(false));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=plate-group-0] [data-testid^=object-row-]').length === 3);
  assert.deepEqual(await groupRows('1'), [], 'arrange moves all three objects onto Plate 1');
  await page.evaluate(async () => {
    const store = window.__plateStore.getState();
    const object = store.objects.find((o) => o.name === 'second.obj');
    await store.setInstanceTransform(object.id, object.instances[0].id, { offset: [510, 150, 10] });
    store.selectObject(object.id, object.instances[0].id);
    await store.copySelected();
    window.__platesStore.getState().setActivePlate(1);
    await store.pasteClipboard();
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=plate-group-1] [data-testid^=object-row-]').length === 2);
  const pastedId = await page.evaluate(() => window.__plateStore.getState().selectedObjectId);
  assert.ok((await groupRows('1')).includes(pastedId), 'paste appears on its actual plate');
  assert.equal((await groupRows('0')).length, 2, 'move removes the object from its old plate');
  await page.evaluate((id) => window.__plateStore.getState().deleteObject(id), pastedId);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=plate-group-1] [data-testid^=object-row-]').length === 1);

  console.log('clicking a group header selects the plate');
  await page.click('[data-testid=plate-group-header-1]');
  await page.waitForFunction(() => window.__platesStore.getState().activePlateIndex === 1);

  console.log('context menu reorders inside the plate group');
  await page.click(`[data-testid=object-row-${first[0]}]`, { button: 'right' });
  await page.click('[data-testid=menu-action-move-down]');
  await page.waitForFunction((ids) => {
    const rows = [...document.querySelectorAll('[data-testid=plate-group-0] [data-testid^=object-row-]')].map((el) => Number(el.dataset.testid.replace('object-row-', '')));
    return rows[0] === ids[1] && rows[1] === ids[0];
  }, first, { timeout: 15000 });

  console.log('Move Up/Down stay inside the plate group and are disabled at its edges');
  const before = await page.evaluate(() => window.__objectListStore.getState().objects.map((o) => o.id));
  const [lastOfFirst] = (await groupRows('0')).slice(-1);
  await page.click(`[data-testid=object-row-${lastOfFirst}]`, { button: 'right' });
  assert.equal(await page.getAttribute('[data-testid=menu-action-move-down]', 'aria-disabled'), 'true', 'last of its group cannot move down');
  await page.click('[data-testid=menu-action-move-down]');
  const [onlyOnSecond] = await groupRows('1');
  await page.click(`[data-testid=object-row-${onlyOnSecond}]`, { button: 'right' });
  assert.equal(await page.getAttribute('[data-testid=menu-action-move-up]', 'aria-disabled'), 'true', 'a lone object cannot move up');
  assert.equal(await page.getAttribute('[data-testid=menu-action-move-down]', 'aria-disabled'), 'true', 'a lone object cannot move down');
  await page.click('[data-testid=menu-action-move-up]');
  assert.deepEqual(await page.evaluate(() => window.__objectListStore.getState().objects.map((o) => o.id)), before, 'disabled moves change nothing');

  console.log('a modifier nests under its object in the same group');
  const objectId = first[0];
  const volumeId = await page.evaluate((id) => window.__objectListStore.getState().addVolume({ objectId: id, type: 'modifier', shape: 'cube' }), objectId);
  await page.waitForSelector(`[data-testid=plate-group-0] [data-testid=volume-row-${volumeId}]`);

  console.log('one logical object appears on both plates and in Unassigned');
  const instanceIds = await page.evaluate(async (id) => {
    const store = window.__plateStore.getState();
    const original = store.objects.find((o) => o.id === id).instances[0].id;
    await store.duplicateRefs([{ objectId: id, instanceId: original }]);
    let instances = window.__plateStore.getState().objects.find((o) => o.id === id).instances;
    const second = instances.find((i) => i.id !== original).id;
    await store.setInstanceTransform(id, second, { offset: [510, 150, 10] });
    await store.duplicateRefs([{ objectId: id, instanceId: original }]);
    instances = window.__plateStore.getState().objects.find((o) => o.id === id).instances;
    const unassigned = instances.find((i) => i.id !== original && i.id !== second).id;
    // Native assignment always chooses the nearest plate for ordinary coordinates and
    // exposes no unassign API. A finite far-away fixture overflows squared distance,
    // leaving this real native instance unassigned without replacing any store data.
    await store.setInstanceTransform(id, unassigned, { offset: [1e200, 1e200, 10] });
    await window.__objectListStore.getState().refreshTree();
    return [original, second, unassigned];
  }, objectId);
  await page.waitForSelector(`[data-testid=plate-group-unassigned] [data-testid=object-row-${objectId}]`);
  assert.ok((await groupRows('0')).includes(objectId));
  assert.ok((await groupRows('1')).includes(objectId));
  assert.deepEqual(await groupRows('unassigned'), [objectId]);
  const row = (key) => page.locator(`[data-testid=plate-group-${key}] [data-testid=object-row-${objectId}]`);
  for (const [index, key] of ['0', '1', 'unassigned'].entries()) {
    assert.equal(await row(key).getAttribute('data-instance-ids'), String(instanceIds[index]));
    await row(key).click();
    assert.equal(await page.evaluate(() => window.__plateStore.getState().selectedInstanceId), instanceIds[index], `group ${key} selects its instance`);
    await page.locator(`[data-testid=plate-group-${key}] [data-testid=volume-row-${volumeId}]`).click();
    assert.equal(await page.evaluate(() => window.__plateStore.getState().selectedInstanceId), instanceIds[index], 'part selection preserves the group instance');
    assert.equal(await page.evaluate(() => window.__objectListStore.getState().selectedVolumeId), volumeId);
  }

  console.log('shared membership reorders globally without losing rows; cross-group drags are rejected');
  const secondRows = await groupRows('1');
  const move = secondRows[0] === objectId ? 'down' : 'up';
  await row('1').click({ button: 'right' });
  await page.click(`[data-testid=menu-action-move-${move}]`);
  await page.waitForFunction(({ id, move }) => {
    const rows = [...document.querySelectorAll('[data-testid=plate-group-1] [data-testid^=object-row-]')].map((el) => Number(el.dataset.objectId));
    return rows[move === 'down' ? 1 : 0] === id;
  }, { id: objectId, move });
  for (const key of ['0', '1', 'unassigned']) assert.ok((await groupRows(key)).includes(objectId), `reorder retains ${key} membership`);
  await row('unassigned').click({ button: 'right' });
  assert.equal(await page.getAttribute('[data-testid=menu-action-move-up]', 'aria-disabled'), 'true');
  assert.equal(await page.getAttribute('[data-testid=menu-action-move-down]', 'aria-disabled'), 'true');
  await page.keyboard.press('Escape');
  const beforeDrag = await page.evaluate(() => window.__objectListStore.getState().objects.map((o) => o.id));
  await row('0').dragTo(page.locator(`[data-testid=plate-group-1] [data-testid=object-row-${onlyOnSecond}]`), { targetPosition: { x: 40, y: 2 } });
  assert.deepEqual(await page.evaluate(() => window.__objectListStore.getState().objects.map((o) => o.id)), beforeDrag, 'shared membership does not permit a drag across group boundaries');

  console.log('desktop editor controls are visible and usable alongside the scrolling tree');
  // Collapse parts so all three membership headers fit in the desktop evidence PNG.
  for (const button of await page.locator('[data-testid^=object-row-] > button:first-child').all()) await button.click();
  await row('1').click();
  await page.locator('#object-list-panel').scrollIntoViewIfNeeded();
  const usable = async (selector) => {
    await page.locator(selector).scrollIntoViewIfNeeded();
    return page.locator(selector).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && (hit === el || el.contains(hit));
    });
  };
  assert.ok(await usable('#btn-add-setting'), 'Add Setting is visible and receives pointer input');
  await page.click('#btn-add-setting');
  assert.ok(await usable('#add-setting-opt-layer_height'), 'setting options escape pane clipping');
  await page.click('#add-setting-opt-layer_height');
  await page.waitForSelector('#btn-reset-overrides');
  assert.ok(await usable('#btn-reset-overrides'), 'Reset All is usable');
  const sharedOverride = await page.evaluate((id) => window.__objectListStore.getState().objects.find((o) => o.id === id).config.layer_height, objectId);
  assert.ok(sharedOverride, 'object overrides still edit the shared logical object');
  await row('0').click();
  assert.equal(await page.evaluate((id) => window.__objectListStore.getState().objects.find((o) => o.id === id).config.layer_height, objectId), sharedOverride);
  await page.locator('#object-list-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.resolve(here, '../../build/object-list-membership-desktop.png') });
  console.log('PNG: wasm/build/object-list-membership-desktop.png');
  await page.click('#btn-reset-overrides');

  console.log('slicing warning, title and beforeunload');
  const originalTitle = await page.title();
  const unloadPrevented = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  assert.equal(await unloadPrevented(), false);
  await page.evaluate(() => window.__appStore.setState({ isSlicing: true }));
  await page.waitForSelector('[data-testid=slicing-warning]');
  assert.match(await page.locator('[data-testid=slicing-warning]').textContent(), /Slicing/);
  assert.match(await page.title(), /Slicing/);
  assert.equal(await unloadPrevented(), true);
  await page.evaluate(() => window.__appStore.setState({ isSlicing: false }));
  await page.waitForFunction(() => !document.querySelector('[data-testid=slicing-warning]'));
  assert.equal(await page.title(), originalTitle);
  assert.equal(await unloadPrevented(), false);

  console.log('preset save buttons use SVG icons');
  const saveButtons = await page.evaluate(() => [...document.querySelectorAll('[data-testid^=save-][data-testid$=-btn]')].map((b) => ({ svg: !!b.querySelector('svg, .ico'), text: b.textContent.trim() })));
  assert.ok(saveButtons.length > 0 && saveButtons.every((b) => b.svg), JSON.stringify(saveButtons));
  console.log('all checks passed');
} catch (err) {
  console.error('Plate grouping state:', await page.evaluate(() => ({ plates: window.__platesStore.getState().plates, objects: window.__plateStore.getState().objects, error: window.__appStore.getState().engineError })));
  console.error('Object list plate tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
  await stopServer(PORT);
}
