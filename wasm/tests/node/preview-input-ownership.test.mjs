import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../../app/node_modules/typescript/lib/typescript.js';

const source = fs.readFileSync(new URL('../../app/src/preview/orcaPreviewModule.ts', import.meta.url), 'utf8')
  .replace('let previewInstance: any = null;', 'let previewInstance: any = globalThis.__inputRenderer;')
  .replace('let previewModule: any = null;', 'let previewModule: any = globalThis.__inputModule;');
const js = ts.transpile(source, { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 });

test('preview borrows read-only source bytes and releases the temporary file on success or failure', async () => {
  const saved = Object.fromEntries(['window', '__inputModule', '__inputRenderer'].map(key => [key, globalThis[key]]));
  const files = new Map();
  let writes = 0, unlinks = 0, fail = false;
  const text = new TextEncoder().encode('; filament_colour = #0088FF\nG1 X10 E1\n');
  const backing = new Uint8Array(text.length + 8);
  backing.set(text, 4);
  const bytes = backing.subarray(4, backing.length - 4);
  const before = backing.slice();
  globalThis.window = {};
  globalThis.__inputModule = { FS: {
    writeFile(path, input, options) {
      assert.equal(options.canOwn, true);
      assert.equal(input, bytes);
      files.set(path, input); writes++;
    },
    unlink(path) { files.delete(path); unlinks++; }
  } };
  globalThis.__inputRenderer = {
    loadGcode(path) {
      assert.equal(files.get(path).byteOffset, 4);
      if (fail) throw new Error('Rejected fixture');
      return JSON.stringify({ layers: 1, moves: 2 });
    },
    setToolColors() {}
  };
  try {
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
    assert.deepEqual(mod.loadGcode(bytes), { layers: 1, moves: 2 });
    assert.equal(mod.isGcodeLoaded(bytes), true);
    assert.equal(files.size, 0);
    assert.deepEqual(backing, before, 'the complete backing buffer including out-of-view bytes is unchanged');
    fail = true;
    assert.throws(() => mod.loadGcode(bytes), /Rejected fixture/);
    assert.equal(mod.isGcodeLoaded(bytes), false, 'failed parsing does not retain a successful-load marker');
    assert.equal(files.size, 0);
    assert.equal(writes, 2); assert.equal(unlinks, 2);
    assert.deepEqual(backing, before);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('pre-mutation replacement errors preserve the old preview identity while native traps invalidate it', async () => {
  const saved = Object.fromEntries(['window', '__inputModule', '__inputRenderer'].map(key => [key, globalThis[key]]));
  const files = new Map();
  const oldBytes = new TextEncoder().encode('G1 X10 E1\n');
  const replacement = new TextEncoder().encode('G1 X20 E2\n');
  let failure = '', nativeLoads = 0;
  globalThis.window = {};
  globalThis.__inputModule = { FS: {
    writeFile(path, bytes) {
      files.set(path, bytes);
      if (failure === 'write') throw new Error('Partial write failed');
    },
    unlink(path) { files.delete(path); }
  } };
  globalThis.__inputRenderer = {
    loadGcode() {
      nativeLoads++;
      if (failure === 'parse') return JSON.stringify({ error: 'No moves in G-code' });
      if (failure === 'trap') throw new Error('Native trap');
      if (failure === 'json') return '{';
      return JSON.stringify({ layers: 1, moves: 2 });
    }
  };
  try {
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}#rollback`);
    mod.loadGcode(oldBytes);
    for (const kind of ['write', 'parse']) {
      failure = kind;
      assert.throws(() => mod.loadGcode(replacement));
      assert.equal(mod.isGcodeLoaded(oldBytes), true, `${kind} leaves the native old preview valid`);
      assert.equal(mod.isGcodeLoaded(replacement), false);
      assert.equal(files.size, 0, 'even a partially written temporary file is unlinked');
      assert.deepEqual(globalThis.window.previewStats, { layers: 1, moves: 2 });
    }
    assert.equal(nativeLoads, 2, 'a failed filesystem write never enters the native loader');
    for (const kind of ['trap', 'json']) {
      failure = '';
      mod.loadGcode(oldBytes);
      failure = kind;
      assert.throws(() => mod.loadGcode(replacement));
      assert.equal(mod.isGcodeLoaded(oldBytes), false, `${kind} may follow native mutation`);
      assert.equal(files.size, 0);
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('preview parse identity does not own otherwise released source bytes', { skip: typeof globalThis.gc !== 'function' }, async () => {
  const saved = Object.fromEntries(['window', '__inputModule', '__inputRenderer'].map(key => [key, globalThis[key]]));
  globalThis.window = {};
  globalThis.__inputModule = { FS: { writeFile() {}, unlink() {} } };
  globalThis.__inputRenderer = { loadGcode: () => JSON.stringify({ layers: 1, moves: 2 }) };
  try {
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js + '\n// GC ownership instance').toString('base64')}`);
    const marker = (() => {
      const bytes = new TextEncoder().encode('G1 X10 E1\n');
      mod.loadGcode(bytes);
      assert.equal(mod.isGcodeLoaded(bytes), true, 'file-open preload identity remains observable while the caller owns bytes');
      return new WeakRef(bytes);
    })();
    for (let attempt = 0; attempt < 20; ++attempt) {
      await new Promise(resolve => setImmediate(resolve));
      globalThis.gc();
      await new Promise(resolve => setImmediate(resolve));
      if (!marker.deref()) return;
    }
    assert.fail('the preview identity marker retained otherwise released G-code');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
