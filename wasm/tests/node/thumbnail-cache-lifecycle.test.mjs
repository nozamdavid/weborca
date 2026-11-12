import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import ts from '../../app/node_modules/typescript/lib/typescript.js';

// Exercise the real store subscription with unrelated engine/device services stubbed.
const storePath = fileURLToPath(new URL('../../app/src/store/appStore.ts', import.meta.url));
const source = ts.createSourceFile(storePath, fs.readFileSync(storePath, 'utf8'), ts.ScriptTarget.Latest);
const serviceExports = new Map();
for (const statement of source.statements) {
  if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
  const specifier = statement.moduleSpecifier.text;
  if (!specifier.startsWith('../') || specifier === '../shell/gcodeThumbnails') continue;
  const bindings = statement.importClause?.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) serviceExports.set(specifier, bindings.elements.map(item => item.propertyName?.text || item.name.text));
}
const bundled = await build({
  stdin: { contents: `export { useAppStore } from ${JSON.stringify(storePath)}; export * from './src/shell/gcodeThumbnails.ts';`, resolveDir: fileURLToPath(new URL('../../app', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'store-services', setup(plugin) {
    plugin.onResolve({ filter: /^\.\./ }, args => args.importer === storePath && args.path !== '../shell/gcodeThumbnails' ? { path: args.path, namespace: 'service' } : undefined);
    plugin.onLoad({ filter: /.*/, namespace: 'service' }, args => ({ contents: (serviceExports.get(args.path) || []).map(name =>
      name === 'usePrinterConnectionStore' || name === 'usePrinterCatalog'
        ? `export const ${name} = { getState: () => ({ selectedPrinterId: null, printers: [] }), subscribe: () => () => {} };`
        : `export const ${name} = () => undefined;`
    ).join('\n'), loader: 'js' }));
  } }]
});
const { useAppStore, setCachedExportGcode, getCachedExportGcode } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

test('slice byte identity replacement and clearing release the export cache even before engine readiness', () => {
  const raw = new TextEncoder().encode('G1 X10\n');
  const final = new TextEncoder().encode('; thumbnail\nG1 X10\n');
  useAppStore.setState({ sliceResult: { gcode: raw, plateIndex: 0 }, isEngineReady: false });
  setCachedExportGcode(raw, 0, final);
  useAppStore.setState({ slicePercent: 50 });
  assert.equal(getCachedExportGcode(0, raw), final, 'unrelated store updates preserve shared export bytes');
  useAppStore.setState({ sliceResult: { gcode: raw, plateIndex: 0 } });
  assert.equal(getCachedExportGcode(0, raw), final, 'new result wrappers with identical bytes preserve the cache');
  const replacement = raw.slice();
  useAppStore.setState({ sliceResult: { gcode: replacement, plateIndex: 0 } });
  assert.equal(getCachedExportGcode(), null, 'a new byte identity releases the prior raw/final pair');
  setCachedExportGcode(replacement, 0, final);
  useAppStore.setState({ sliceResult: null });
  assert.equal(getCachedExportGcode(), null, 'clearing the slice releases the last export');
});

test('G-code Blob URLs are released on clearing, invalidation and replacement', () => {
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  const active = new Set();
  const revoked = [];
  URL.createObjectURL = blob => { const url = create(blob); active.add(url); return url; };
  URL.revokeObjectURL = url => { active.delete(url); revoked.push(url); return revoke(url); };
  const raw = new TextEncoder().encode('G1 X1\n');
  const install = () => {
    const url = URL.createObjectURL(new Blob([raw]));
    useAppStore.setState({ sliceResult: { gcode: raw, plateIndex: 0 }, gcodeUrl: url });
    return url;
  };
  try {
    let url = install();
    useAppStore.setState({ slicePercent: 35 });
    assert.equal(active.has(url), true, 'unrelated updates preserve the current URL');
    useAppStore.setState({ modelFile: null, modelObjects: null, sliceResult: null, gcodeUrl: null });
    assert.equal(active.size, 0, 'New Project releases its cleared URL');
    for (const state of [
      { isModelLoading: true, sliceResult: null },
      { isSlicing: true, sliceResult: null }
    ]) {
      url = install();
      useAppStore.setState(state);
      assert.equal(active.has(url), false, 'import and slice-start invalidation release old URLs');
      assert.equal(useAppStore.getState().gcodeUrl, null);
    }
    url = install();
    const replacement = install();
    assert.equal(active.has(url), false);
    assert.equal(active.has(replacement), true, 'replacement URL remains live');
    useAppStore.setState({ gcodeUrl: replacement });
    assert.equal(revoked.filter(value => value === replacement).length, 0, 'unchanged URLs are preserved');
    useAppStore.setState({ sliceResult: null, gcodeUrl: null });
    assert.equal(active.size, 0);
  } finally {
    for (const url of active) revoke(url);
    URL.createObjectURL = create; URL.revokeObjectURL = revoke;
  }
});
