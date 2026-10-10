/**
 * Tests for exportName.ts: expandFileName placeholders, sanitising, fallback to 'plate',
 * and buildExportGcodeFileName behavior.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  expandFileName,
  sanitizeFileName,
  formatPrintTimeTag,
  getDefaultTimestamp,
  buildExportGcodeFileName
} from '../../app/src/shell/exportName.ts';

test('formatPrintTimeTag formats durations into short filename tags', () => {
  assert.equal(formatPrintTimeTag(0), '0s');
  assert.equal(formatPrintTimeTag(45), '45s');
  assert.equal(formatPrintTimeTag(120), '2m');
  assert.equal(formatPrintTimeTag(150), '2m30s');
  // 1 hour, 23 minutes, 0 seconds
  assert.equal(formatPrintTimeTag(4980), '1h23m');
  // 1 hour, 23 minutes, 20 seconds (< 30s does not round up)
  assert.equal(formatPrintTimeTag(5000), '1h23m');
  // 1 hour, 23 minutes, 40 seconds (>= 30s rounds up to 1h24m)
  assert.equal(formatPrintTimeTag(5020), '1h24m');
  // 1 day, 2 hours, 15 minutes
  assert.equal(formatPrintTimeTag(86400 + 2 * 3600 + 15 * 60), '1d2h15m');
});

test('sanitizeFileName strips illegal characters and control chars, trims, and falls back to "plate"', () => {
  // Strips illegal characters: / \ : * ? " < > |
  assert.equal(sanitizeFileName('foo/bar\\baz:qux*one?two"three<four>five|six.gcode'), 'foobarbazquxonetwothreefourfivesix.gcode');
  // Strips ASCII control characters
  assert.equal(sanitizeFileName('clean\x00\x07\x1f\x7f\x80\x9fname.gcode'), 'cleanname.gcode');
  // Trims whitespace
  assert.equal(sanitizeFileName('   my_cool_model.gcode   '), 'my_cool_model.gcode');
  // Fallback to 'plate' when string becomes empty
  assert.equal(sanitizeFileName(''), 'plate');
  assert.equal(sanitizeFileName('   '), 'plate');
  assert.equal(sanitizeFileName('///:::***'), 'plate');
  assert.equal(sanitizeFileName('\x00\x1f\x7f'), 'plate');
  assert.equal(sanitizeFileName('.'), 'plate');
  assert.equal(sanitizeFileName('..'), 'plate');
});

test('expandFileName expands all standard OrcaSlicer placeholders', () => {
  const vars = {
    input_filename_base: '3DBenchy',
    printer_model: 'Voron 2.4 300',
    print_preset: '0.20mm Standard @Voron',
    filament_type: ['PLA', 'PETG'],
    'filament_type[0]': 'PLA',
    layer_height: '0.2',
    print_time: '1h23m',
    plate: '1',
    timestamp: '20261010-143000'
  };

  assert.equal(expandFileName('{input_filename_base}', vars), '3DBenchy');
  assert.equal(expandFileName('{printer_model}', vars), 'Voron 2.4 300');
  assert.equal(expandFileName('{print_preset}', vars), '0.20mm Standard @Voron');
  assert.equal(expandFileName('{filament_type[0]}', vars), 'PLA');
  assert.equal(expandFileName('{filament_type[1]}', vars), 'PETG');
  assert.equal(expandFileName('{layer_height}', vars), '0.2');
  assert.equal(expandFileName('{print_time}', vars), '1h23m');
  assert.equal(expandFileName('{plate}', vars), '1');
  assert.equal(expandFileName('{timestamp}', vars), '20261010-143000');
});

test('expandFileName supports {filament_type[initial_tool]} and numeric print_time', () => {
  const vars = {
    input_filename_base: 'calibration_cube',
    filament_type: ['PETG'],
    initial_tool: 0,
    print_time: 4980 // 1h23m
  };

  const template = '{input_filename_base}_{filament_type[initial_tool]}_{print_time}.gcode';
  assert.equal(expandFileName(template, vars), 'calibration_cube_PETG_1h23m.gcode');
});

test('expandFileName supports bracket style [placeholder] syntax', () => {
  const vars = {
    input_filename_base: 'test_part',
    print_time: '45m'
  };
  assert.equal(expandFileName('[input_filename_base]_[print_time].gcode', vars), 'test_part_45m.gcode');
});

test('expandFileName sanitises expanded results and applies "plate" fallback', () => {
  // Strips invalid characters introduced by placeholders or literals
  const vars = {
    input_filename_base: 'part/with:bad*chars',
    filament_type: ['PLA?']
  };
  assert.equal(
    expandFileName('{input_filename_base}_{filament_type[0]}.gcode', vars),
    'partwithbadchars_PLA.gcode'
  );

  // Fallback to 'plate' on empty or entirely stripped formats
  assert.equal(expandFileName(''), 'plate');
  assert.equal(expandFileName('   '), 'plate');
  assert.equal(expandFileName(null), 'plate');
  assert.equal(expandFileName(undefined), 'plate');
  assert.equal(expandFileName('///:::***'), 'plate');
  assert.equal(expandFileName('{unknown_placeholder}', {}), 'plate');
});

test('expandFileName defaults timestamp when none provided', () => {
  const result = expandFileName('{timestamp}', {});
  assert.match(result, /^\d{8}-\d{6}$/);
});

test('buildExportGcodeFileName adheres to filename_format, fallback and project name preference', () => {
  // 1. When filename_format is specified in config
  const customNamed = buildExportGcodeFileName({
    modelFileName: 'robot_arm.stl',
    currentConfig: {
      filename_format: '{input_filename_base}_{layer_height}mm_{filament_type[0]}_{print_time}.gcode',
      layer_height: '0.16',
      filament_type: 'PLA-CF'
    },
    printTimeS: 5000,
    selectedPrinter: 'Voron 2.4'
  });
  assert.equal(customNamed, 'robot_arm_0.16mm_PLA-CF_1h23m.gcode');

  // 2. When filename_format is missing, preserves current behavior: <model_name>.gcode
  const defaultNamed = buildExportGcodeFileName({
    modelFileName: 'robot_arm.stl',
    currentConfig: {}
  });
  assert.equal(defaultNamed, 'robot_arm.gcode');

  // 3. When modelFile is null and filename_format missing, falls back to print.gcode
  const noModelNamed = buildExportGcodeFileName({
    modelFileName: null,
    currentConfig: {}
  });
  assert.equal(noModelNamed, 'print.gcode');

  // 4. When useProjectNameForExport is true, uses project/model name directly
  const projectNamePref = buildExportGcodeFileName({
    modelFileName: 'awesome_project.3mf',
    currentConfig: {
      filename_format: '{input_filename_base}_{filament_type[0]}_{print_time}.gcode',
      filament_type: 'PLA'
    },
    printTimeS: 3600,
    useProjectNameForExport: true
  });
  assert.equal(projectNamePref, 'awesome_project.gcode');

  // 5. Ensures .gcode extension is appended if format omitted it
  const noExt = buildExportGcodeFileName({
    modelFileName: 'cube.obj',
    currentConfig: {
      filename_format: '{input_filename_base}_noext'
    }
  });
  assert.equal(noExt, 'cube_noext.gcode');
});
