import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../../app/node_modules/typescript/lib/typescript.js';

test('initializing preview synchronizes native viewport with a canvas already sized by layout', async () => {
  const previousWindow = globalThis.window, previousModule = globalThis.__viewportModule;
  globalThis.window = {};
  globalThis.__viewportModule = { OrcaPreview: class {
    viewport = [800, 600];
    setLightingEnabled(enabled) { this.lighting = enabled; }
    setLowQuality(enabled) { this.lowQuality = enabled; }
    init() { this.initialLighting = this.lighting; return true; }
    resize(width, height) { this.viewport = [width, height]; }
    delete() {}
  } };
  try {
    const source = fs.readFileSync(new URL('../../app/src/preview/orcaPreviewModule.ts', import.meta.url), 'utf8')
      .replace("import { preparePreview, cancelPreviewWorker } from './previewWorkerClient';", "const cancelPreviewWorker = () => {}; const preparePreview = () => { throw new Error('unexpected preparation'); };")
      .replace('let previewModule: any = null;', 'let previewModule: any = globalThis.__viewportModule;');
    const js = ts.transpile(source, { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 });
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
    let preview = await mod.initPreview({ id: 'canvas', width: 800, height: 600 });
    assert.equal(preview.initialLighting, true, 'default appearance is enabled before native init');
    mod.setLightingEnabled(false);
    mod.setLowQuality(true);
    for (const [width, height] of [[2560, 1520], [1280, 760]]) {
      preview = await mod.initPreview({ id: 'canvas', width, height });
      assert.deepEqual(preview.viewport, [width, height]);
      assert.equal(preview.initialLighting, false, 'retained preference applied before native reinitialization');
      mod.setLowQuality(false);
      assert.equal(preview.lighting, false, 'quality never overwrites lighting');
    }
    mod.setLightingEnabled(true);
    assert.equal(preview.lighting, true);
    assert.equal(preview.lowQuality, false);
    mod.disposePreview();
    const late = mod.initPreview({ id: 'cached-disposed', width: 20, height: 20 });
    mod.disposePreview();
    await assert.rejects(late, error => error.name === 'AbortError');
    assert.equal(mod.getPreviewInstance(), null);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousModule === undefined) delete globalThis.__viewportModule; else globalThis.__viewportModule = previousModule;
  }
});

test('disposing during initialization prevents a late native viewer and failed init is deleted', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  let constructed = 0, deleted = 0, fail = false;
  let resolveModule;
  const modulePromise = new Promise(resolve => { resolveModule = resolve; });
  const nativeModule = { OrcaPreview: class {
    constructor() { constructed++; }
    init() { return !fail; }
    setLightingEnabled() {} resize() {} setLowQuality() {}
    delete() { deleted++; }
  } };
  globalThis.__viewportDeferred = modulePromise;
  try {
    const source = fs.readFileSync(new URL('../../app/src/preview/orcaPreviewModule.ts', import.meta.url), 'utf8')
      .replace("import { preparePreview, cancelPreviewWorker } from './previewWorkerClient';", "const cancelPreviewWorker = () => {}; const preparePreview = () => { throw new Error('unexpected preparation'); };")
      .replace('let previewModulePromise: Promise<any> | null = null;', 'let previewModulePromise: Promise<any> | null = globalThis.__viewportDeferred;');
    const js = ts.transpile(source, { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 });
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
    const a = mod.initPreview({ id: 'old', width: 10, height: 10 });
    const canceled = assert.rejects(a, error => error.name === 'AbortError');
    mod.disposePreview();
    const b = mod.initPreview({ id: 'new', width: 20, height: 20 });
    resolveModule(nativeModule);
    await canceled;
    assert.strictEqual(await b, mod.getPreviewInstance());
    assert.equal(nativeModule.canvas.id, 'new');
    assert.equal(constructed, 1);
    mod.disposePreview();
    assert.equal(deleted, 1);
    const stale = mod.initPreview({ id: 'disposed', width: 20, height: 20 });
    mod.disposePreview();
    await assert.rejects(stale, error => error.name === 'AbortError');
    assert.equal(constructed, 1);
    fail = true;
    await assert.rejects(mod.initPreview({ id: 'failure', width: 20, height: 20 }), /WebGL2/);
    assert.equal(constructed, 2);
    assert.equal(deleted, 2);
    assert.equal(mod.getPreviewInstance(), null);
  } finally {
    delete globalThis.__viewportDeferred;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});
