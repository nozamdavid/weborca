// Import offers use native facet counts and the existing undoable Simplify operation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { zipSync } from '../../app/node_modules/fflate/esm/browser.js';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter, seedAddedPrinters } from './lib/printer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const shots = path.join(root, 'docs/superpowers/ui-layout-20261013/after');
fs.mkdirSync(shots, { recursive: true });
const port = 5197;

// A closed, local sphere with 114,720 triangles. No external/private fixture.
function sphere() {
  const sides = 240, rings = 240, vertices = [[0, 0, 40]];
  for (let i = 1; i < rings; i++) {
    const a = Math.PI * i / rings;
    for (let j = 0; j < sides; j++) {
      const b = 2 * Math.PI * j / sides;
      vertices.push([20 * Math.sin(a) * Math.cos(b), 20 * Math.sin(a) * Math.sin(b), 20 + 20 * Math.cos(a)]);
    }
  }
  vertices.push([0, 0, 0]);
  const index = (i, j) => i === 0 ? 1 : i === rings ? vertices.length : 2 + (i - 1) * sides + j % sides;
  const lines = vertices.map(v => `v ${v.join(' ')}`);
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    if (i > 0) lines.push(`f ${index(i, j)} ${index(i + 1, j)} ${index(i, j + 1)}`);
    if (i < rings - 1) lines.push(`f ${index(i, j + 1)} ${index(i + 1, j)} ${index(i + 1, j + 1)}`);
  }
  return Buffer.from(lines.join('\n'));
}

if (process.argv.includes('--source-focused')) {
  await (await import('./lib/import-context-source.mjs')).importContextSourceTest();
} else {
let browser;
try {
  await startServer(port, 'import-simplify', { frozenDist: true });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('**/*', route => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(route.request().url()) || !route.request().url().startsWith('http') ? route.continue() : route.abort());
  await seedAddedPrinters(page, ['Voron 2.4 300 0.4 nozzle']);
  await page.goto(`http://127.0.0.1:${port}`);
  await selectAddedPrinter(page, 'Voron');
  await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('autosave', false));
  const importBytes = async (name, bytes, context) => page.evaluate(async ({ name, bytes, context }) => {
    await window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], name), undefined, false, context);
    if (window.__appStore.getState().engineError) throw new Error(window.__appStore.getState().engineError);
  }, { name, bytes: Array.from(bytes), context });
  const facets = id => page.evaluate(async id => (await window.__orcaEngine.call('getMeshHealth', { objectId: id })).facetsCount, id);

  await importBytes('low.obj', fs.readFileSync(path.join(root, 'tests/data/20mm_cube.obj')));
  await page.waitForFunction(() => !window.__appStore.getState().isModelLoading);
  assert.equal(await page.locator('#simplify-dialog').count(), 0, 'ordinary cube has no offer');

  const high = sphere();
  assert.equal(await page.evaluate(() => window.__prefsStore.getState().general.importSimplifyThreshold), 250000);
  await importBytes('below-default.obj', high);
  assert.equal(await page.locator('#simplify-dialog').count(), 0, '114720 triangles is below the default threshold');
  await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('importSimplifyThreshold', 0));
  await importBytes('disabled.obj', high);
  assert.equal(await page.locator('#simplify-dialog').count(), 0, 'zero disables the import offer');
  await importBytes('high.obj', high, { source: 'builtin-handy' });
  const handyId = await page.evaluate(() => window.__plateStore.getState().objects.at(-1).id);
  const handyFacets = await facets(handyId);
  assert.ok(handyFacets >= 100000, 'trusted high-poly example retains original facets');
  assert.equal(await page.locator('#simplify-dialog').count(), 0, 'trusted built-in example skips the automatic offer');
  await page.evaluate(id => window.__editOpsStore.getState().openSimplifyDialog(id), handyId);
  await page.locator('#simplify-dialog').waitFor();
  assert.equal(await page.locator('#simplify-current-count').textContent(), String(handyFacets), 'manual Simplify still sees original example geometry');
  await page.evaluate(() => window.__editOpsStore.getState().closeSimplifyDialog());
  await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('importSimplifyThreshold', 100000));
  await importBytes('high.obj', high);
  await page.locator('#import-simplify-mesh').waitFor();
  const firstId = await page.evaluate(() => window.__editOpsStore.getState().simplifyObjectId);
  const before = await facets(firstId);
  assert.ok(before >= 100000 && before <= 114720, 'native facet count exceeds the offer threshold');
  assert.equal(await page.locator('#simplify-current-count').textContent(), String(before));
  await page.click('#simplify-keep-original');
  assert.equal(await facets(firstId), before, 'Keep original does not change geometry');
  await page.evaluate(async () => { await window.__plateStore.getState().refreshObjects(); await window.__objectListStore.getState().refreshTree(); });
  assert.equal(await page.locator('#simplify-dialog').count(), 0, 'refresh does not repeat the offer');

  await importBytes('accepted.obj', high);
  await page.locator('#import-simplify-mesh').waitFor();
  const acceptedId = await page.evaluate(() => window.__editOpsStore.getState().simplifyObjectId);
  await page.evaluate(() => window.__prefsStore.getState().setDisplayPref('fontScale', 150));
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const dialog = await page.locator('#simplify-dialog').boundingBox();
    assert.ok(dialog.x >= 0 && dialog.y >= 0 && dialog.x + dialog.width <= viewport.width + 1 && dialog.y + dialog.height <= viewport.height + 1, 'offer fits viewport at 150%');
    await page.locator('#simplify-keep-original').click({ trial: true });
    await page.locator('#simplify-apply-btn').click({ trial: true });
    const overflow = await page.locator('#simplify-dialog').evaluate(e => e.scrollWidth > e.clientWidth + 1);
    assert.equal(overflow, false, 'offer has no horizontal clipping');
    await page.screenshot({ path: path.join(shots, `import-simplify-${viewport.width}-font150.png`) });
  }
  await page.fill('#simplify-ratio-input', '50');
  await page.click('#simplify-apply-btn');
  await page.waitForFunction(() => !window.__editOpsStore.getState().isOperating && !window.__editOpsStore.getState().activeDialog, null, { timeout: 90000 });
  const after = await facets(acceptedId);
  assert.ok(after < before && after <= before * 0.51, `50% reduces facets: ${before} -> ${after}`);
  await page.evaluate(() => window.__historyStore.getState().undo());
  const restoredId = await page.evaluate(() => window.__plateStore.getState().objects.find(o => o.name === 'accepted.obj').id);
  assert.equal(await facets(restoredId), before, 'Undo restores the imported original');
  assert.equal(await page.locator('#simplify-dialog').count(), 0, 'Undo does not offer again');

  await importBytes('multiple.zip', zipSync({ 'first.obj': high, 'second.obj': high }));
  await page.locator('#import-simplify-mesh').waitFor();
  assert.equal(await page.locator('#import-simplify-mesh option').count(), 2, 'one offer lists both high-poly imports');
  const pending = await page.evaluate(() => window.__editOpsStore.getState().importedMeshes);
  await page.selectOption('#import-simplify-mesh', `${pending[1].objectId}:${pending[1].volumeId}`);
  assert.equal(await page.evaluate(() => window.__editOpsStore.getState().simplifyObjectId), pending[1].objectId);
  await page.click('#simplify-keep-original');
  assert.equal(await page.locator('#import-simplify-mesh option').count(), 1, 'Keep original advances to remaining import');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#simplify-dialog').count(), 0, 'dismiss keeps all remaining originals');
  for (const mesh of pending) assert.equal(await facets(mesh.objectId), before);
  console.log(`PASS import simplification: default 250000, disabled at zero, configured 100000; native ${before} -> ${after}, Undo restored; multiple imports kept`);
} finally {
  await browser?.close();
  await stopServer(port);
}
}
