import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../../app/node_modules/typescript/lib/typescript.js';

test('initializing preview synchronizes native viewport with a canvas already sized by layout', async () => {
  const previousWindow = globalThis.window, previousModule = globalThis.__viewportModule;
  globalThis.window = {};
  globalThis.__viewportModule = { OrcaPreview: class {
    viewport = [800, 600];
    init() { return true; }
    resize(width, height) { this.viewport = [width, height]; }
    delete() {}
  } };
  try {
    const source = fs.readFileSync(new URL('../../app/src/preview/orcaPreviewModule.ts', import.meta.url), 'utf8')
      .replace('let previewModule: any = null;', 'let previewModule: any = globalThis.__viewportModule;');
    const js = ts.transpile(source, { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 });
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
    for (const [width, height] of [[2560, 1520], [1280, 760]]) {
      const preview = await mod.initPreview({ id: 'canvas', width, height });
      assert.deepEqual(preview.viewport, [width, height]);
    }
    mod.disposePreview();
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousModule === undefined) delete globalThis.__viewportModule; else globalThis.__viewportModule = previousModule;
  }
});
