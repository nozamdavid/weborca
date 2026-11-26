import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../../app/node_modules/typescript/lib/typescript.js';
import * as THREE from '../../app/node_modules/three/build/three.module.js';

const rendererSource = fs.readFileSync(new URL('../../app/src/paint-tools/overlayRenderer.ts', import.meta.url), 'utf8');
const rendererJS = ts.transpile(rendererSource, { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 })
  .replace("'three'", JSON.stringify(new URL('../../app/node_modules/three/build/three.module.js', import.meta.url).href));
const { renderPaintOverlay, clearPaintOverlay } = await import(`data:text/javascript;base64,${Buffer.from(rendererJS).toString('base64')}`);

// Execute the production effect, including its exit guard and async cancellation.
const source = fs.readFileSync(new URL('../../app/src/plate/PlateView.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('PlateView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' &&
      node.arguments[0]?.getText(ast).includes('scene?.clearToolOverlays()')) effect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);

test('paint exit restores Prepare color regions for every volume; re-entry and reset discard stale overlays', async () => {
  const calls = [];
  let rendered = [];
  let empty = false;
  const overlay = { vertexCount: 3, triangleCount: 1, positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), states: [{ state: 2, firstTriangle: 0, triangleCount: 1 }] };
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
  const scene = {
    clearToolOverlays() { rendered = []; clearPaintOverlay(mesh); },
    updateToolOverlay(...args) { rendered.push(args); renderPaintOverlay(mesh, ...args.slice(1)); },
  };
  const objects = [];
  const state = { sceneRef: { current: scene }, isPaintingActive: false, selectedObjectId: 1,
    isRestoring: false, objects, displayedObjects: { current: objects },
    selectedVolumeId: null, paintLayer: 'color', isEngineReady: true,
    objectTree: [{ id: 1, volumes: [{ id: 10 }, { id: 11 }] }], filamentColours: '#009688;#ff0000',
    usePaintToolsStore: { getState: () => ({ filamentColors: ['#009688', '#ff0000'] }) },
    getPaintOverlay: async args => { calls.push(args); return { buffer: empty ? null : overlay, states: overlay.states }; },
    parsePaintOverlayBinary: buffer => buffer };
  const js = ts.transpile(`const effect = ${effect};`, { target: ts.ScriptTarget.ES2022 });
  const run = () => new Function(...Object.keys(state), `${js}; return effect();`)(...Object.values(state));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  let cleanup = run();
  await flush();
  assert.equal(rendered.length, 1, 'Prepare must display painted regions after exit');
  assert.deepEqual(calls.map(c => c.volumeId), [10, 11]);
  assert.equal(rendered[0][1].triangleCount, 2, 'all volumes retain regions');
  assert.deepEqual([...rendered[0][1].indices], [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(rendered[0][3], ['#009688', '#ff0000']);
  const regions = mesh.getObjectByName('__paint_overlay_container__').children;
  assert.equal(regions.length, 2);
  assert.ok(regions.every(region => region.visible && region.material.color.getHex() === 0xff0000));
  assert.ok(regions.every(region => region.material.polygonOffsetFactor < 0), 'regions draw over Prepare volume surfaces');
  assert.equal(mesh.material.visible, false, 'Prepare keeps its normal volume/selection materials');
  cleanup();
  for (const guard of ['restoring', 'pending objects']) {
    state.isRestoring = guard === 'restoring';
    state.displayedObjects.current = guard === 'pending objects' ? [] : objects;
    assert.equal(run(), undefined, `${guard} skips the overlay effect`);
    await flush();
    assert.equal(calls.length, 2, `${guard} cannot request stale overlays`);
    assert.equal(rendered.length, 1, `${guard} preserves the displayed overlay`);
  }
  state.isRestoring = false;
  state.displayedObjects.current = objects;
  state.isPaintingActive = true; state.selectedVolumeId = 10;
  cleanup = run(); await flush();
  assert.equal(rendered[0][1].triangleCount, 1, 're-entry uses the active-volume overlay');
  cleanup();
  state.isPaintingActive = false; state.selectedVolumeId = null; empty = true;
  run(); await flush();
  assert.equal(rendered.length, 0, 'cleared paint cannot leave old colors visible');
  empty = false;
  run()(); await flush();
  assert.equal(rendered.length, 0, 'cancelled Prepare readback cannot overwrite a newer mode');
});
