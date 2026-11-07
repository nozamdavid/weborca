import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from '../../../app/node_modules/esbuild/lib/main.js';

export async function importContextSourceTest() {
  const source = readFileSync(new URL('../../../app/src/store/appStore.ts', import.meta.url), 'utf8');
  const menu = readFileSync(new URL('../../../app/src/plate/PlateContextMenu.tsx', import.meta.url), 'utf8');
  const compile = async text => (await transform(text, { loader: 'ts' })).code;
  const action = await compile(`const action = ${source.split('  importModelFile: async')[1].split('\n  startSlice:')[0].replace(/^/, 'async').replace(/,\s*$/, '')};`);
  const menuAction = await compile(`const importFile = ${menu.split('  const importFile = ')[1].split('\n  // Desktop sizes')[0]}`);
  // Extract just the Handy Item callback, including any object literal import context.
  const handyItem = menu.split('id={`plate-menu-handy-')[1].split(' />')[0];
  const callback = handyItem.slice(handyItem.indexOf('onClick={() => ') + 'onClick={() => '.length, -1);
  let objects = [], offers = [], history = [], names = [], addOptions = [], nextId = 1;
  const app = { engineError: null };
  const plate = { getState: () => ({ objects, refreshObjects: async () => objects, arrange: async () => {} }) };
  const edit = { getState: () => ({ offerImportSimplification: async ids => offers.push(...ids.filter(id => objects.find(o => o.id === id).facets >= 100000)) }) };
  const engine = { listObjects: async () => objects, call: async () => {} };
  const modules = async name => {
    if (name.includes('plateStore')) return { usePlateStore: plate };
    if (name.includes('platesStore')) return { usePlatesStore: { getState: () => ({ activePlateIndex: 0 }) } };
    if (name.includes('editOpsStore')) return { useEditOpsStore: edit };
    if (name.includes('history')) return { useHistoryStore: { getState: () => ({ commitTransaction: async label => history.push(label) }) } };
    if (name.includes('prefsStore')) return { usePrefsStore: { getState: () => ({ general: {} }) } };
    if (name.includes('archiveModels')) return { readArchiveModels: async () => [{ name: 'same.stl', bytes: new Uint8Array([1]) }, { name: 'part.3mf', bytes: new Uint8Array([1]) }] };
    throw new Error(`Unexpected import ${name}`);
  };
  const env = { get: () => app, set: patch => Object.assign(app, patch), modules, getEngine: async () => engine,
    addModel: async (name, bytes, options) => { names.push(name); addOptions.push(options); objects.push({ id: nextId++, name, facets: bytes[0] ? 114720 : 12 }); return { objects }; },
    showToast: () => {}, storeImportedRecentFile: async () => {} };
  app.importModelFile = Function('env', `with(env) { ${action.replaceAll('import(', 'modules(')}; return action; }`)(env);
  const menuEnv = { usePlateStore: plate, useAppStore: { getState: () => app }, onClose: () => {}, activate: () => {},
    renameObject: async (id, name) => { objects.find(o => o.id === id).name = name; }, showToast: () => {},
    loadHandyModel: async () => [new File([new Uint8Array([1])], 'same.stl'), new File([new Uint8Array([1])], 'bundle.3mf')], model: { label: 'Curated example' } };
  // Await the real menu's fire-and-forget operation without changing its production contract.
  const runMenu = menuAction.replace('void (async () =>', 'finished = (async () =>');
  const finished = Function('env', `with(env) { let finished; ${runMenu}; ${callback}; return finished; }`)(menuEnv);
  await finished;
  assert.equal(objects.length, 2, 'all Handy files, including bundled 3MF, imported');
  assert.deepEqual(offers, [], 'high-poly Handy originals do not offer automatic simplification');
  assert.equal(objects[0].name, 'Curated example', 'Handy import rename retained');
  assert.equal(history.length, 2, 'per-file import history retained');
  assert.deepEqual(objects.map(o => o.facets), [114720, 114720], 'original Handy geometry retained');
  await app.importModelFile(new File([new Uint8Array([1])], 'same.stl'));
  await app.importModelFile(new File([new Uint8Array([1])], 'bundle.3mf'));
  assert.equal(offers.length, 2, 'ordinary same-name STL and 3MF uploads still offer');
  await app.importModelFile(new File([new Uint8Array([0])], 'low.stl'));
  assert.equal(offers.length, 2, 'low-poly upload does not offer');
  const options = { linearDeflection: 0.1 };
  await app.importModelFile(new File([new Uint8Array([1])], 'handy.zip'), options, false, { source: 'builtin-handy' });
  assert.equal(offers.length, 2, 'trusted context survives archive branch');
  assert.deepEqual(addOptions.slice(-2), [options, options], 'STEP options survive archive recursion');
  await app.importModelFile(new File([new Uint8Array([1])], 'handy.zip'));
  assert.equal(offers.length, 4, 'ordinary same-path archive offers all imported meshes');
  const editSource = readFileSync(new URL('../../../app/src/editops/editOpsStore.ts', import.meta.url), 'utf8');
  const manual = await compile(`const manual = async${editSource.split('  openSimplifyDialog: async')[1].split('\n  closeSimplifyDialog:')[0].replace(/,\s*$/, '')};`);
  const dialog = {};
  const manualEnv = { usePlateStore: plate, useObjectListStore: { getState: () => ({ objects: [{ id: 1, volumes: [{ id: 10 }] }] }) },
    set: patch => Object.assign(dialog, patch), modules: async () => ({ getMeshHealth: async () => ({ facetsCount: objects[0].facets }) }) };
  await Function('env', `with(env) { ${manual.replaceAll('import(', 'modules(')}; return manual(1, 10); }`)(manualEnv);
  assert.equal(dialog.activeDialog, 'simplify', 'manual Simplify still opens for a trusted Handy object');
  assert.equal(dialog.currentTriangleCount, 114720, 'manual Simplify sees original geometry');
  console.log('PASS actual-source Handy menu/import action: multifile, bundled 3MF, original facets, same-name uploads, lowpoly, archive context/options, rename/history, manual Simplify seam');
}
