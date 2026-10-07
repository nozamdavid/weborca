# WASM Spike Reference Data

This directory contains reference data generated using the official native OrcaSlicer build for comparison against WebAssembly builds.

## Native Build Information

- **App Version**: `OrcaSlicer 2.5.0-dev`
- **Release**: GitHub release tag `nightly-builds` (commit `6d02a945e0`, closest build to `e027f8b225`)
- **Asset**: `OrcaSlicer_Mac_universal_nightly.dmg`

## Presets Used

- **Printer**: `Voron 2.4 300 0.4 nozzle` (`resources/profiles/Voron/machine/Voron 2.4 300 0.4 nozzle.json`)
- **Process**: `0.20mm Standard @Voron` (`resources/profiles/Voron/process/0.20mm Standard @Voron.json`)
- **Filament**: `Generic PLA @System` (`resources/profiles/OrcaFilamentLibrary/filament/Generic PLA @System.json`)

## Generation Commands

### 1. Download and Mount Native Build
```bash
gh release download nightly-builds \
  --repo OrcaSlicer/OrcaSlicer \
  --pattern "OrcaSlicer_Mac_universal_nightly.dmg" \
  --dir /tmp/orca-native/

hdiutil attach /tmp/orca-native/OrcaSlicer_Mac_universal_native.dmg \
  -mountpoint /tmp/orca-native/mount -nobrowse -readonly

cp -R /tmp/orca-native/mount/OrcaSlicer.app /tmp/orca-native/OrcaSlicer.app
hdiutil detach /tmp/orca-native/mount
```

### 2. Export Flattened Config JSON
```bash
/tmp/orca-native/OrcaSlicer.app/Contents/MacOS/OrcaSlicer \
  --load-settings "resources/profiles/Voron/machine/Voron 2.4 300 0.4 nozzle.json;resources/profiles/Voron/process/0.20mm Standard @Voron.json" \
  --load-filaments "resources/profiles/OrcaFilamentLibrary/filament/Generic PLA @System.json" \
  --export-settings wasm/spike/data/voron24_pla_020.json
```

### 3. Slice Reference Model to G-code
```bash
/tmp/orca-native/OrcaSlicer.app/Contents/MacOS/OrcaSlicer \
  --load-settings "resources/profiles/Voron/machine/Voron 2.4 300 0.4 nozzle.json;resources/profiles/Voron/process/0.20mm Standard @Voron.json" \
  --load-filaments "resources/profiles/OrcaFilamentLibrary/filament/Generic PLA @System.json" \
  --slice 0 \
  --outputdir /tmp/orca-native/ \
  tests/data/20mm_cube.obj

cp /tmp/orca-native/plate_1.gcode wasm/spike/data/reference_cube_native.gcode
```
