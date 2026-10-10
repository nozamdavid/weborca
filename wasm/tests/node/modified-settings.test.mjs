/** The list of settings that differ from their preset (wasm/app/src/settings/modifiedSettings.ts). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modifiedSettings } from '../../app/src/settings/modifiedSettings.ts';

const layout = {
  source: { file: '', gitBlob: '' },
  tabs: [
    { id: 'print', pages: [{ title: 'Quality', groups: [{ title: 'Layer height', lines: [
      { type: 'option', key: 'layer_height', label: 'Layer height' },
      { type: 'line', label: 'Widths', options: ['line_width', 'outer_wall_line_width'] }
    ] }] }] },
    { id: 'filament', pages: [{ title: 'Filament', groups: [{ title: 'Basic', lines: [{ type: 'option', key: 'nozzle_temperature' }] }] }] }
  ]
};

test('lists changed options with their labels and pages', () => {
  const preset = { layer_height: '0.2', line_width: '0.4', outer_wall_line_width: '0.4', nozzle_temperature: '210', other: '1' };
  const current = { ...preset, layer_height: '0.16', outer_wall_line_width: '0.42', nozzle_temperature: '215', other: '2' };
  const changes = modifiedSettings(layout, current, preset);
  assert.deepEqual(changes.map((c) => [c.tab, c.page, c.label, c.from, c.to]), [
    ['print', 'Quality', 'Layer height', '0.2', '0.16'],
    ['print', 'Quality', 'Widths', '0.4', '0.42'],
    ['filament', 'Filament', 'nozzle temperature', '210', '215']
  ]);
});

test('nothing without a layout or when equal; options missing on either side are ignored', () => {
  assert.deepEqual(modifiedSettings(null, { a: '1' }, { a: '2' }), []);
  assert.deepEqual(modifiedSettings(layout, { layer_height: '0.2' }, { layer_height: '0.2' }), []);
  assert.deepEqual(modifiedSettings(layout, { layer_height: '0.2' }, {}), []);
});
