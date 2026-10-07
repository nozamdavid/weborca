# OrcaSlicer WebAssembly Parity Test Suite

This suite verifies numerical and structural parity between the WebAssembly slicing engine (`orca_engine.mjs` driven by `engine-core.js`) and native reference outputs.

## Checks Performed

For each test case defined in `cases.json`, `run_parity.mjs` executes:

### Check (a): Engine vs Driver (Preset Merging Verification)
- **What it proves**: Validates that the WebAssembly engine's internal `PresetBundle` preset merging produces identical config and slicing results to the native OrcaSlicer CLI's config merging.
- **Methodology**:
  1. The test case is sliced using `engine-core.js` (WebAssembly Embind engine) into `<id>.wasm.gcode`.
  2. The same machine, process, and filament presets are exported into a flattened JSON configuration file using the native CLI (`AppRun --load-settings ... --load-filaments ... --export-settings <id>.flat.json`).
  3. The spike driver (`orca_slice_driver.js`) slices the model using that flattened JSON config into `<id>.driver.gcode`.
  4. Both outputs are compared using `wasm/spike/compare_gcode.sh`.
- **Expected result**: Exit code `0` (identical normalized G-code moves and extrusions).

### Check (b): Engine vs Native macOS x86_64 Reference
- **What it proves**: Confirms that WebAssembly slicing output matches official native macOS x86_64 builds.
- **Methodology**:
  1. Compares the engine's G-code output against pre-recorded reference G-code in `refs-macos-x86_64/<id>.gcode` using `compare_gcode.sh`.
  2. If no reference exists for a case, it is recorded as `no ref` and listed in the summary.

## Why Native Linux Output Is Not Used as Reference

Native Linux builds are **not** used as golden references for WebAssembly output because:
1. **Standard Library Differences**: Native Linux binaries are compiled with GNU `libstdc++`, whereas WebAssembly (Emscripten / Clang) and macOS binaries are built with LLVM `libc++`.
2. **Toolpath & Infill Ordering**: Differences in container ordering, hashing, and standard library algorithms between `libstdc++` and `libc++` lead to slight variations in infill path ordering, even when geometry and slicing settings are identical.
3. macOS x86_64 binaries share the Clang toolchain and `libc++` implementation, providing reliable byte-for-byte or normalized path parity with Emscripten builds.

## How to Run

### Prerequisites
From the repository root, source the environment script to ensure the proper Node.js version (Node 24) is on `PATH`, and ensure test models are fetched:
```bash
source wasm/scripts/env.sh
bash wasm/tests/data/fetch_models.sh
```

### Running Parity Tests
Run the test runner directly:
```bash
node wasm/tests/parity/run_parity.mjs
```
The runner will automatically pack required vendor profile bundles into `wasm/build/tests-node/` if not already present, run both checks for every case in `cases.json`, print a summary table, and report details of any mismatches or errors.

### Generating macOS x86_64 References
On a macOS x86_64 system (or Apple Silicon using Rosetta via `arch -x86_64`):
```bash
./wasm/tests/parity/make_refs_macos.sh /path/to/OrcaSlicer.app/Contents/MacOS/OrcaSlicer
```
This iterates over all cases in `cases.json` and outputs reference G-code files into `refs-macos-x86_64/<id>.gcode`.
