import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from '../../app/node_modules/fflate/esm/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. Valid desktop .orca_printer archive
// Reproduces the output of ExportConfigsDialog::archive_preset_bundle_to_file
const printerBundleStructure = {
  version: '',
  bundle_id: 'offline_Desktop_Fixture_Printer_12345',
  bundle_type: 'printer config bundle',
  printer_preset_name: 'Desktop Fixture Printer',
  printer_config: ['printer/Desktop Fixture Printer.json'],
  filament_config: ['filament/Desktop Fixture Filament.json'],
  process_config: ['process/Desktop Fixture Process.json']
};

const printerJson = {
  type: 'machine',
  name: 'Desktop Fixture Printer',
  from: 'User',
  inherits: 'Voron 2.4 300 0.4 nozzle',
  version: '1.0.0.0',
  nozzle_diameter: ['0.4'],
  printable_height: '280'
};

const filamentJson = {
  type: 'filament',
  name: 'Desktop Fixture Filament',
  from: 'User',
  inherits: 'Generic PLA @Voron',
  version: '1.0.0.0',
  nozzle_temperature: ['215'],
  filament_flow_ratio: ['0.98']
};

const processJson = {
  type: 'process',
  name: 'Desktop Fixture Process',
  from: 'User',
  inherits: '0.20mm Standard @Voron',
  version: '1.0.0.0',
  layer_height: '0.18',
  wall_loops: '4'
};

const printerZip = zipSync({
  'bundle_structure.json': strToU8(JSON.stringify(printerBundleStructure, null, 2)),
  'printer/Desktop Fixture Printer.json': strToU8(JSON.stringify(printerJson, null, 2)),
  'filament/Desktop Fixture Filament.json': strToU8(JSON.stringify(filamentJson, null, 2)),
  'process/Desktop Fixture Process.json': strToU8(JSON.stringify(processJson, null, 2))
});
fs.writeFileSync(path.join(__dirname, 'desktop_bundle.orca_printer'), printerZip);

// 2. Valid desktop .orca_filament archive
// Reproduces the output of ExportConfigsDialog::archive_filament_bundle_to_file
const filamentBundleStructure = {
  version: '',
  bundle_id: 'offline_Desktop_Fixture_ABS_12345',
  bundle_type: 'filament config bundle',
  filament_name: 'Desktop Fixture ABS',
  printer_vendor: [
    {
      vendor: 'Voron',
      filament_path: ['Voron/Desktop Fixture ABS.json']
    }
  ]
};

const absFilamentJson = {
  type: 'filament',
  name: 'Desktop Fixture ABS',
  from: 'User',
  inherits: 'Generic ABS @Voron',
  version: '1.0.0.0',
  nozzle_temperature: ['245'],
  hot_plate_temp: ['105']
};

const filamentZip = zipSync({
  'bundle_structure.json': strToU8(JSON.stringify(filamentBundleStructure, null, 2)),
  'Voron/Desktop Fixture ABS.json': strToU8(JSON.stringify(absFilamentJson, null, 2))
});
fs.writeFileSync(path.join(__dirname, 'desktop_filament_bundle.orca_filament'), filamentZip);

// 3. Desktop archive with legacy keys
// Reproduces the output of ExportConfigsDialog::archive_preset_bundle_to_file with legacy keys
const legacyBundleStructure = {
  version: '',
  bundle_id: 'offline_Legacy_Printer_12345',
  bundle_type: 'printer config bundle',
  printer_preset_name: 'Legacy Fixture Printer',
  printer_config: ['printer/Legacy Fixture Printer.json'],
  filament_config: [],
  process_config: ['process/Legacy Fixture Process.json']
};

const legacyPrinterJson = {
  type: 'machine',
  name: 'Legacy Fixture Printer',
  from: 'User',
  inherits: 'Voron 2.4 300 0.4 nozzle',
  version: '1.0.0.0',
  machine_switch_extruder_time: '3.5'
};

const legacyProcessJson = {
  type: 'process',
  name: 'Legacy Fixture Process',
  from: 'User',
  inherits: '0.20mm Standard @Voron',
  version: '1.0.0.0',
  enable_wipe_tower: '1',
  wipe_tower_width: '18',
  bridge_fan_speed: '80',
  sparse_infill_filament: '1',
  counterbole_hole_bridging: 'partiallybridge',
  initial_layer_speed: '50%'
};

const legacyZip = zipSync({
  'bundle_structure.json': strToU8(JSON.stringify(legacyBundleStructure, null, 2)),
  'printer/Legacy Fixture Printer.json': strToU8(JSON.stringify(legacyPrinterJson, null, 2)),
  'process/Legacy Fixture Process.json': strToU8(JSON.stringify(legacyProcessJson, null, 2))
});
fs.writeFileSync(path.join(__dirname, 'desktop_legacy.orca_printer'), legacyZip);

// 4. Single preset .json
// Reproduces the output of ExportConfigsDialog::archive_printer_preset_to_file (or filament/process equivalents)
const singlePresetJson = {
  name: 'Single JSON Process',
  type: 'process',
  from: 'User',
  inherits: '0.20mm Standard @Voron',
  version: '1.0.0.0',
  layer_height: '0.22',
  top_shell_layers: '5'
};
fs.writeFileSync(
  path.join(__dirname, 'single_preset.json'),
  JSON.stringify(singlePresetJson, null, 2)
);

// 5. Single preset .ini
const singlePresetIni = `; OrcaSlicer preset INI
[print:Single INI Process]
inherits = 0.20mm Standard @Voron
print_settings_id = Single INI Process
layer_height = 0.24
wall_loops = 3
enable_wipe_tower = 1
bridge_fan_speed = 75
`;
fs.writeFileSync(path.join(__dirname, 'single_preset.ini'), singlePresetIni);

// 6. Corrupted archive
const corruptedBytes = Buffer.from('PK\x03\x04corrupted-archive-data-here-cannot-unzip');
fs.writeFileSync(path.join(__dirname, 'corrupted_archive.orca_printer'), corruptedBytes);

console.log('Fixtures created successfully.');
