import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../../app/node_modules/typescript/lib/typescript.js';

// Use the real wrapper with a fake native renderer and controllable browser frame queue.
const source = fs.readFileSync(new URL('../../app/src/preview/orcaPreviewModule.ts', import.meta.url), 'utf8')
  .replace("import { preparePreview, cancelPreviewWorker } from './previewWorkerClient';", "const cancelPreviewWorker = () => {}; const preparePreview = async bytes => ({ packet: bytes.slice(), stats: { layers: 1, moves: 2 } });")
  .replace('let previewInstance: any = null;', 'let previewInstance: any = globalThis.__schedulingRenderer;');
const js = ts.transpile(source, { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 });

test('multiple preview mutations share one frame; immediate renders and disposal cancel queued frames', async () => {
  const saved = Object.fromEntries(['__schedulingRenderer', 'requestAnimationFrame', 'cancelAnimationFrame', 'document'].map(k => [k, globalThis[k]]));
  const frames = new Map();
  let frameId = 0;
  let renders = 0;
  let deleted = 0;
  let cleared = 0;
  globalThis.__schedulingRenderer = { render: () => renders++, delete: () => deleted++, clearGcode: () => cleared++, setLightTheme: () => {} };
  globalThis.document = { documentElement: { dataset: { theme: 'light' } } };
  globalThis.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  try {
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
    for (let i = 0; i < 100; i++) mod.requestRender();
    assert.equal(frames.size, 1);
    assert.equal(renders, 0);
    const [[id, callback]] = frames;
    frames.delete(id);
    callback();
    assert.equal(renders, 1);
    mod.requestRender();
    mod.render();
    assert.equal(frames.size, 0);
    assert.equal(renders, 2);
    mod.requestRender();
    const oldFrame = [...frames.keys()][0];
    mod.clearGcode();
    assert.equal(cleared, 1);
    assert.equal(deleted, 0, 'clearing toolpaths preserves the initialized native viewer');
    assert.equal(frames.has(oldFrame), false, 'the pre-reset render is canceled');
    assert.equal(frames.size, 1, 'one replacement frame renders the cleared viewer');
    mod.disposePreview();
    assert.equal(frames.size, 0);
    assert.equal(deleted, 1);
    mod.requestRender();
    assert.equal(frames.size, 0);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
