import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
const bundle = await build({ stdin: {
  contents: "export * from './shell/quickSettingDefinitions'; export * from './shell/slicePrerequisites'; export * from './plates/resultState'; export * from './settings/numericValidation';",
  resolveDir: new URL('../../app/src/', import.meta.url).pathname, loader: 'ts'
}, bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { quickSettings, slicePrerequisites, readinessAction, plateResultState, hasPlateOutput } = module.exports;
test('strict quick numeric seam commits only finite in-range scalar values', () => {
  const commits = [];
  const commit = value => commits.push(value);
  const float = {type:'float',min:0,max:1};
  for (const value of ['-1', 'NaN', 'Infinity', '1e999', '1.1', '', '-']) {
    module.exports.commitNumericValue(value, float, commit);
  }
  module.exports.commitNumericValue('2.5', {type:'int',min:0,max:10}, commit);
  assert.deepEqual(commits, []);
  module.exports.commitNumericValue('0.245', float, commit);
  module.exports.commitNumericValue('23%', {type:'percent',min:0,max:100}, commit);
  module.exports.commitNumericValue('101%', {type:'percent',min:0,max:100}, commit);
  assert.deepEqual(commits, ['0.245', '23%']);
});
test('quick controls target individual native options, including exact adhesion enum', () => {
  assert.deepEqual(quickSettings.map(row => row[0]), ['layer_height', 'sparse_infill_density', 'enable_support', 'brim_type']);
});
test('all prerequisite blockers retain shared validation and only recoverable choices have actions', () => {
  const ready = { isEngineReady: true, modelFile: { name: 'model.stl' }, pendingOptions: {}, selectedPrinter: 'P', selectedProcess: 'Q', selectedFilaments: ['F'] };
  assert.equal(slicePrerequisites(ready, false), '');
  for (const [patch, action] of [[{isEngineReady:false,engineLoad:{phase:'downloading'}},null], [{isEngineReady:false,engineError:'failed'},null], [{modelFile:null},'model'], [{isModelLoading:true},null], [{isSelectingPreset:true},null], [{pendingOptions:{'print:layer_height':{value:'0.2'}}},null], [{isSlicing:true},null], [{selectedPrinter:''},'printer'], [{selectedProcess:''},'process'], [{selectedFilaments:[],selectedFilament:''},'filament']]) {
    const reason = slicePrerequisites({...ready,...patch}, false);
    assert.ok(reason); assert.equal(readinessAction(reason), action);
  }
  assert.equal(readinessAction(slicePrerequisites(ready, true)), null);
});
test('only retained matching nonempty output is current and exportable', () => {
  const result = {plateIndex: 1, gcode: new Uint8Array([1])};
  assert.equal(hasPlateOutput(result, 1), true);
  assert.equal(hasPlateOutput(result, 0), false);
  assert.equal(hasPlateOutput(null, 1), false);
  assert.equal(hasPlateOutput({...result,gcode:new Uint8Array()}, 1), false);
  assert.equal(plateResultState(0, 1, 1, true), 'Empty');
  assert.equal(plateResultState(1, 1, 1, true), 'Current');
  assert.equal(plateResultState(1, 1, 0, true), 'Needs slicing');
  assert.equal(plateResultState(1, undefined, 1, false), 'Needs slicing');
});

// Render the real SettingInput used by QuickSettings, replacing only its external
// store/engine boundary. No browser or engine is needed to check pending display.
test('quick input displays pending values and preserves custom override/reset state', async () => {
  const result = await build({
    stdin: { contents: "export { SettingInput } from './settings/SettingInput';", resolveDir: new URL('../../app/src/', import.meta.url).pathname, loader: 'tsx' },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom', 'react-dom/server'], loader: { '.css': 'empty' },
    plugins: [{ name: 'input-boundary', setup(builder) {
      builder.onLoad({ filter: /\/store\/appStore\.ts$/ }, () => ({ contents: `
        export const pendingOptionKey = (kind, key) => kind + ':' + key;
        export const useAppStore = () => globalThis.quickInputState;
      ` }));
      builder.onLoad({ filter: /\/i18n\.ts$/ }, () => ({ contents: 'export const useTranslation = () => ({t: key => key});' }));
      builder.onLoad({ filter: /\/engine\/orcaEngine\.ts$/ }, () => ({ contents: 'export const getOption = async () => ({});' }));
      builder.onLoad({ filter: /\/mobile\/useMobile\.ts$/ }, () => ({ contents: 'export const useMobile = () => false;' }));
    } }]
  });
  const require = createRequire(new URL('../../app/package.json', import.meta.url));
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const currentConfig = { layer_height: '0.16', brim_type: 'outer_only', unrelated: 'retain' };
  const pendingOptions = { 'print:layer_height': { value: '0.12', requestId: 1 } };
  globalThis.quickInputState = { currentConfig, pendingOptions, presetConfig: { layer_height: '0.2' }, selectedFilaments: [], isEngineReady: true };
  try {
    const html = renderToStaticMarkup(React.createElement(mod.exports.SettingInput, { optionKey: 'layer_height', kind: 'print', def: {type:'float', min:0.04, max:0.8}, idPrefix:'quick-setting' }));
    assert.match(html, /value="0.12"/);
    assert.match(html, /is-modified/);
    assert.match(html, /reset-btn-layer_height/);
    assert.match(html, /min="0.04" max="0.8"/);
    assert.deepEqual(currentConfig, {layer_height:'0.16',brim_type:'outer_only',unrelated:'retain'});
    assert.equal(pendingOptions['print:layer_height'].value, '0.12');
  } finally { delete globalThis.quickInputState; }
});
