# OrcaSlicer Real Native x86_64 vs WebAssembly Parity Coverage

This document details the test harness, methodology, environment provenance, observed results, and diagnostic limitations for native x86_64 versus WebAssembly slicing parity in OrcaSlicer.

---

## 1. Overview and Scope

The test runner `wasm/tests/parity/native-parity.mjs` executes independent native x86_64 slicing against the frozen WebAssembly engine baseline (`wasm/build/native-parity-baseline/orca_engine.mjs`) across three bounded, representative test cases:
1. **`cube-voron`**: 20mm cube on Voron 2.4 300 0.4 nozzle with Generic PLA
2. **`benchy-voron`**: 3DBenchy STL on Voron 2.4 300 0.4 nozzle with Generic PLA
3. **`cube-bbl`**: 20mm cube on Bambu Lab X1 Carbon 0.4 nozzle with Bambu PLA Basic

### Independent Configuration and Model Placement Fairness
- **Preset Provenance**: Native slicing loads vendor profile JSON files directly from `resources/profiles/` via `--load-settings` and `--load-filaments`. The WebAssembly engine loads the bundled vendor profile JSON files via `createEngineCore` and selects the identical presets by name. Neither side derives configuration from the other.
- **Model Provenance**: Input geometry uses either tracked repository fixtures (`tests/data/20mm_cube.obj` for `cube-voron` and `cube-bbl`) or a downloaded build artifact (`wasm/build/models/3DBenchy.stl`, fetched via `wasm/tests/data/fetch_models.sh` with pinned SHA-256 `6ab57f...`, not a tracked git fixture).
- **Model Placement Fairness**: The native CLI centers input models on the build plate by default during `--slice 0`. The WebAssembly engine runs `core.call('arrange', {})` immediately after loading the model geometry, which likewise centers the model on the plate. Output bounding box coordinates confirm that spatial positioning on the build plate is aligned across both runners.
- **Independent Expected Oracle**: Native slicing is executed as an independent process without injecting WASM-derived state or parameters.

---

## 2. Environment Provenance & Version Inspection

### Native Binary Inspection
- **Binary Location**: `/tmp/orca-native/squashfs-root/AppRun` (wrapper invoking `/tmp/orca-native/squashfs-root/bin/orca-slicer`)
- **Binary Architecture**: ELF 64-bit LSB pie executable, `x86-64`, version 1 (SYSV), dynamically linked
- **Binary Version Label**: `OrcaSlicer 2.5.0-dev` (`02.08.01.55`)
- **Toolchain / Runtime**: Linux GCC toolchain linked against GNU `libstdc++` (GLIBC 2.38+)

### Repository Baseline
- **Branch**: `wasm-spike`
- **Source Commit**: `b6c0994400553f32aad8f53c906245baf1afadc7` (baseline measurement commit)
- **Repository Version**: `02.08.01.55` (defined in `version.inc`)

### WebAssembly Engine Baseline
- **Engine Module**: `wasm/build/native-parity-baseline/orca_engine.mjs` (and companion `orca_engine.wasm`, 14.2 MB)
- **Toolchain**: Emscripten `wasm64`, Clang/LLVM toolchain linking against LLVM `libc++`

### Source Equivalence vs Version Label Distinction
- While the native binary version strings (`02.08.01.55` / `OrcaSlicer 2.5.0-dev`) match the version series in `version.inc`, **source commit equivalence is unproven**.
- Binary inspection confirms the version label but cannot verify the exact git commit, compiler version, optimization flags, or patch level used to compile `/tmp/orca-native/squashfs-root/bin/orca-slicer`.
- Therefore, observed differences cannot be assumed to stem solely from compiler or runtime differences; potential commit skew or build configuration differences cannot be ruled out.

### Toolchain Differences & Limits of Hypotheses
- Native Linux builds link against GNU `libstdc++`, while WebAssembly (Emscripten) and macOS builds link against LLVM `libc++`.
- Differences in standard library hash implementations, unordered container iteration order, and sorting algorithms between `libstdc++` and `libc++` represent a plausible hypothesis for reordering in infill traversal moves.
- **Critical Limits of This Hypothesis**:
  1. The macOS x86_64 golden reference (`cube-voron.gcode`) matches WASM with exit 0 (0 differing lines), which supports the toolchain hypothesis for `cube-voron`.
  2. However, the macOS cube match **does not prove root cause for all cases**.
  3. No macOS golden reference exists for `benchy-voron` or `cube-bbl`.
  4. Matching bounding boxes and close total extrusion figures do **not** prove layer-by-layer geometric equivalence.
  5. For `cube-bbl`, the 5.3 mm extrusion delta is an unverified difference; claiming it is exclusively due to prime-line / wipe custom G-code remains an unproven hypothesis without layer-by-layer extrusion tracing.

---

## 3. Test Cases & Exact Slicing Commands

Test cases use either tracked repository fixtures (`tests/data/20mm_cube.obj`) or downloaded build artifacts (`wasm/build/models/3DBenchy.stl`):

### Case 1: `cube-voron`
- **Model**: `tests/data/20mm_cube.obj` (tracked repository fixture)
- **Machine Preset**: `resources/profiles/Voron/machine/Voron 2.4 300 0.4 nozzle.json`
- **Process Preset**: `resources/profiles/Voron/process/0.20mm Standard @Voron.json`
- **Filament Preset**: `resources/profiles/OrcaFilamentLibrary/filament/Generic PLA @System.json`
- **Native Command**:
  ```bash
  mkdir -p wasm/build/native-parity/cube-voron
  /tmp/orca-native/squashfs-root/AppRun \
    --load-settings "resources/profiles/Voron/machine/Voron 2.4 300 0.4 nozzle.json;resources/profiles/Voron/process/0.20mm Standard @Voron.json" \
    --load-filaments "resources/profiles/OrcaFilamentLibrary/filament/Generic PLA @System.json" \
    --slice 0 \
    --outputdir wasm/build/native-parity/cube-voron \
    tests/data/20mm_cube.obj
  ```

### Case 2: `benchy-voron`
- **Model**: `wasm/build/models/3DBenchy.stl` (downloaded build artifact fetched via `wasm/tests/data/fetch_models.sh`, not a tracked git fixture)
- **Machine Preset**: `resources/profiles/Voron/machine/Voron 2.4 300 0.4 nozzle.json`
- **Process Preset**: `resources/profiles/Voron/process/0.20mm Standard @Voron.json`
- **Filament Preset**: `resources/profiles/OrcaFilamentLibrary/filament/Generic PLA @System.json`
- **Native Command**:
  ```bash
  # Ensure model artifact exists: wasm/tests/data/fetch_models.sh
  mkdir -p wasm/build/native-parity/benchy-voron
  /tmp/orca-native/squashfs-root/AppRun \
    --load-settings "resources/profiles/Voron/machine/Voron 2.4 300 0.4 nozzle.json;resources/profiles/Voron/process/0.20mm Standard @Voron.json" \
    --load-filaments "resources/profiles/OrcaFilamentLibrary/filament/Generic PLA @System.json" \
    --slice 0 \
    --outputdir wasm/build/native-parity/benchy-voron \
    wasm/build/models/3DBenchy.stl
  ```

### Case 3: `cube-bbl`
- **Model**: `tests/data/20mm_cube.obj` (tracked repository fixture)
- **Machine Preset**: `resources/profiles/BBL/machine/Bambu Lab X1 Carbon 0.4 nozzle.json`
- **Process Preset**: `resources/profiles/BBL/process/0.20mm Standard @BBL X1C.json`
- **Filament Preset**: `resources/profiles/BBL/filament/Bambu PLA Basic @BBL X1C.json`
- **Native Command**:
  ```bash
  mkdir -p wasm/build/native-parity/cube-bbl
  /tmp/orca-native/squashfs-root/AppRun \
    --load-settings "resources/profiles/BBL/machine/Bambu Lab X1 Carbon 0.4 nozzle.json;resources/profiles/BBL/process/0.20mm Standard @BBL X1C.json" \
    --load-filaments "resources/profiles/BBL/filament/Bambu PLA Basic @BBL X1C.json" \
    --slice 0 \
    --outputdir wasm/build/native-parity/cube-bbl \
    tests/data/20mm_cube.obj
  ```

---

## 4. Parity Results Summary (Historical Baseline: 2026-10-08)

Comparison performed using `wasm/spike/compare_gcode.sh` (exit 0: identical normalized lines; exit 1: numerical difference within 0.001 mm; exit 2: differing toolpath lines).

| Case ID | Native vs WASM Exit | macOS Golden Ref Exit | Differing Lines | Native Slicing (ms) | WASM Slicing (ms) | Native Extrusion (mm) | WASM Extrusion (mm) | Extrusion Delta (%) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`cube-voron`** | **2** | **0** | 1,736 | ~240 ms | ~190 ms | 1304.9417 | 1304.9417 | **0.000% (exact)** |
| **`benchy-voron`** | **2** | *no ref* | 19,287 | ~760 ms | ~1,270 ms | 3883.2024 | 3883.2033 | **0.00002% (< 1 µm)** |
| **`cube-bbl`** | **2** | *no ref* | 3,213 | ~400 ms | ~50 ms | 1341.6802 | 1336.3722 | **0.395% (~5.3 mm)** |

### Overall Runner Exit Code
The test runner `wasm/tests/parity/native-parity.mjs` exits with **code 2** by default when any case exhibits compare exit 2. It does **not** mask mismatches by exiting 0. An exit code of 2 correctly reports that parity differences currently exist.

### Coarse Metrics Overview (Historical Baseline: 2026-10-08)
- **`cube-voron`**:
  - Layers: 100 vs 100
  - X Range: `140.200 - 159.800` vs `140.200 - 159.800`
  - Y Range: `140.200 - 159.800` vs `140.200 - 159.800`
  - Z Range: `0.200 - 20.400` vs `0.200 - 20.400`
- **`benchy-voron`**:
  - Layers: 240 vs 240
  - X Range: `120.200 - 179.787` vs `120.200 - 179.787`
  - Y Range: `134.700 - 165.302` vs `134.700 - 165.302`
  - Z Range: `0.200 - 48.400` vs `0.200 - 48.400`
- **`cube-bbl`**:
  - Layers: 100 vs 100
  - X Range: `18.000 - 240.000` vs `18.000 - 240.000`
  - Y Range: `-3.000 - 265.000` vs `-3.000 - 265.000`
  - Z Range: `0.150 - 120.000` vs `0.150 - 120.000`

> [!NOTE]
> Bounding box ranges and layer counts align, and total extrusion sums are close or identical for Voron cases. However, these aggregate numbers do not establish internal toolpath or path-by-path geometric equivalence.

---

## 5. Observed Differences & Diagnosis Limits (Historical Observations: 2026-10-08)

### Case 1: `cube-voron`
- **Observation**: 1,736 normalized lines differ (compare exit 2). Aggregate extrusion matches exactly (`1304.9417 mm`). WASM output matches the pre-recorded macOS reference with exit 0.
- **Differences**: Initial differences appear in infill traversal lines (`F21000`) starting from alternate vertices.
- **Assessment & Limits**: Toolchain differences between GNU `libstdc++` and LLVM `libc++` in container traversal order provide a plausible explanation supported by the macOS exit 0. However, this is a correlation and cannot be asserted as the sole cause. Exact source equivalence of the native binary is unproven.

### Case 2: `benchy-voron`
- **Observation**: 19,287 normalized lines differ (compare exit 2). Aggregate extrusion delta is less than 1 µm (`3883.2024 mm` vs `3883.2033 mm`).
- **Differences**: Differences occur throughout complex perimeters and infill toolpaths.
- **Assessment & Limits**: No macOS reference exists for `benchy-voron`. The macOS cube match cannot be extrapolated to prove root cause on Benchy. Potential causes include floating-point differences, optimization level divergence, mesh slicing edge cases, and standard library container ordering.

### Case 3: `cube-bbl`
- **Observation**: 3,213 normalized lines differ (compare exit 2). Extrusion differs by 5.308 mm (1341.6802 mm native vs 1336.3722 mm WASM, delta 0.395%).
- **Differences**: Toolpath ordering and custom G-code sequences differ.
- **Assessment & Limits**: No macOS reference exists for `cube-bbl`. The 5.3 mm extrusion discrepancy remains an unverified difference. While prime line or start G-code sequences may account for part of the difference, this has not been proven without an isolated layer-by-layer extrusion audit.

---

## 6. Preserved Artifacts

Slicing outputs and comparison reports are preserved in scratch directory `wasm/build/native-parity/<case-id>/`:
- `<case-id>/native.gcode`: Raw independent native slicing output
- `<case-id>/wasm.gcode`: Raw WebAssembly engine slicing output
- `<case-id>/result.json`: Slicer execution metadata, metrics, and exit status
- `<case-id>/diff_report.txt`: Output of `compare_gcode.sh`

---

## 7. How to Run the Parity Suite

Run the exact check commands under memory cap and timeout limits:

```bash
# 1. Syntax check (expected exit 0)
MEMCAP=10G NODE_OPTIONS=--max-old-space-size=2048 wasm/scripts/memcap.sh node --check wasm/tests/parity/native-parity.mjs

# 2. Execution under 2048 MB heap cap and 600s timeout (expected exit 2 while known differences remain)
MEMCAP=10G NODE_OPTIONS=--max-old-space-size=2048 wasm/scripts/memcap.sh timeout 600s node wasm/tests/parity/native-parity.mjs

# 3. Clean git diff check (expected exit 0)
git diff --check
```

### Environment Variables
- `NATIVE_ORCA`: Path to native OrcaSlicer executable (default: `/tmp/orca-native/squashfs-root/AppRun`)
- `ORCA_ENGINE_MODULE`: Path to frozen WASM engine module (default: `wasm/build/native-parity-baseline/orca_engine.mjs`)
