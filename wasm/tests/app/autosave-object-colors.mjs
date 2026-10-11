import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
const port = 5280;
const cube = readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');
async function snapshot(page) {
  await page.waitForFunction(() => window.__plateScene?.objectMeshes.size === 2);
  await page.waitForTimeout(200);
  return page.evaluate(() => ({
    palette: window.__appStore.getState().currentConfig.filament_colour,
    assignments: window.__objectListStore.getState().objects.map(o => o.volumes.map(v => v.extruder)),
    colors: [...window.__plateScene.objectMeshes.values()].map(m => [...new Set(Array.from({length: m.geometry.attributes.color.count}, (_, i) =>
      Array.from(m.geometry.attributes.color.array.slice(i * 3, i * 3 + 3)).join(',')))].sort())
  }));
}
async function suite(browserType) {
  const browser = await browserType.launch(); const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, {timeout: 90000});
    await page.evaluate(async text => {
      window.__prefsStore.getState().setGeneralPref('autosaveIntervalSeconds', 3600);
      const app = window.__appStore.getState();
      await app.chooseVendor('Snapmaker'); await app.choosePrinter('Snapmaker U1 (0.4 nozzle)');
      const preset = window.__appStore.getState().filaments.find(p => p.isCompatible && p.name.startsWith('Generic PLA'));
      await app.chooseFilament(preset.name); await app.addFilamentSlot(preset.name);
      await app.setSlotColor(0, '#CC1122'); await app.setSlotColor(1, '#0047BB');
      await app.importModelFile(new File([text], 'red.obj'));
      await app.importModelFile(new File([text], 'blue.obj'));
      const objects = window.__objectListStore.getState().objects;
      await window.__objectListStore.getState().setObjectExtruder(objects[0].id, 1);
      await window.__objectListStore.getState().setObjectExtruder(objects[1].id, 2);
      await window.__autosave.writeAutosave();
    }, cube);
    const before = await snapshot(page);
    assert.deepEqual(before.assignments, [[1], [2]]);
    assert.equal(before.palette, '#CC1122;#0047BB');
    assert.notDeepEqual(before.colors[0], before.colors[1], 'objects have distinct rendered vertex colors');
    await page.reload();
    await page.waitForSelector('#recovery-restore', {timeout: 90000}); await page.click('#recovery-restore');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 2 && !window.__appStore.getState().isModelLoading);
    const after = await snapshot(page);
    assert.deepEqual(after, before, '3MF recovery preserves per-object assignments and actual viewport colors');
    // A multipart object must retain independent part assignments, too.
    await page.evaluate(async () => {
      const store = window.__objectListStore.getState();
      const obj = store.objects[1];
      const volumeId = await store.addVolume({objectId: obj.id, type: 'part', shape: 'cube', size: [10, 10, 10], offset: [30, 0, 0]});
      await window.__objectListStore.getState().setVolumeExtruder(obj.id, volumeId, 1);
    });
    const multipart = await snapshot(page);
    assert.deepEqual(multipart.assignments, [[1], [2, 1]]);
    await page.evaluate(async () => {
      const bytes = await window.__appStore.getState().saveProjectFile('colored-parts.3mf');
      await window.__appStore.getState().openProjectFile(new File([bytes], 'colored-parts.3mf'));
    });
    assert.deepEqual(await snapshot(page), multipart, 'exported 3MF retains object and part colors');
    await page.evaluate(() => window.__autosave.writeAutosave());
    await page.reload();
    await page.waitForSelector('#recovery-restore', {timeout: 90000}); await page.click('#recovery-restore');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 2 && !window.__appStore.getState().isModelLoading);
    assert.deepEqual(await snapshot(page), multipart, 'autosaved multipart 3MF retains independent part colors');
    console.log(`${browserType.name()}: 3MF export and refresh recovery preserve object and individual part filament colors`);
  } finally { await browser.close(); }
}
await startServer(port, 'autosave-object-colors');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
