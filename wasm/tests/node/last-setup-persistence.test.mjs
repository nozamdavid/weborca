import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

// Bundle the exported pure helper; browser dependencies are inert during this test.
const { outputFiles } = await build({
  entryPoints: [new URL('../../app/src/shell/autosave.ts', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'browser-stubs', setup(builder) {
    builder.onResolve({ filter: /^\.\./ }, args => ({ path: args.path, namespace: 'stub' }));
    builder.onResolve({ filter: /^\.\// }, args => args.importer ? ({ path: args.path, namespace: 'stub' }) : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
      export const getEngine = {}, getConfig = {}, setOptions = {}, usePrefsStore = {},
        usePlateStore = {}, useAppStore = {}, useHistoryStore = {}, capturePlateState = {},
        restorePlatesOnEmptyCanvas = {}, usePlatesStore = {}, isDefaultPlateName = {},
        useAutosaveStatus = {}, usePreviewStore = {};
    ` }));
  } }]
});
const { isRedundantAutosaveRecord } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

const plates = { plates: [{ index: 0, name: 'Plate 1', config: {}, filamentMaps: [] }], activePlateIndex: 0 };
const baseline = JSON.stringify({ vendor: 'BBL', printer: 'Printer', process: 'Process', filaments: ['PLA'],
  config: { filament_colour: '#123456', filament_type: 'PLA', layer_height: '0.2' }, plates });
const makeRecord = () => ({ objects: 0, plateState: plates, setup: {
  vendor: 'BBL', printer: 'Printer', process: 'Process', filaments: ['PLA'],
  presetConfig: { filament_colour: '#FFFFFF', filament_type: 'PLA', layer_height: '0.2' },
  options: {}, overrides: { filament: { filament_colour: '#123456' } }
} });

test('restored color override matching the startup baseline is redundant', () => {
  assert.equal(isRedundantAutosaveRecord(makeRecord(), baseline), true);
});

test('effective options take precedence over stale overrides', () => {
  const record = makeRecord();
  record.setup.options.layer_height = '0.3';
  record.setup.overrides.process = { layer_height: '0.2' };
  assert.equal(isRedundantAutosaveRecord(record, baseline), false);
});

test('a different filament slot count remains recoverable', () => {
  const record = makeRecord();
  record.setup.filaments.push('PLA');
  assert.equal(isRedundantAutosaveRecord(record, baseline), false);
});
