# OrcaSlicer WebAssembly CI Workflow

This directory provides the CI workflow template, local validation tooling, and documentation for the OrcaSlicer WebAssembly port.

- **Workflow Template**: [`wasm/ci/wasm.yml`](wasm.yml)
- **Local / CI Validation Entrypoint**: [`wasm/ci/check.sh`](check.sh)

---

## 1. Quick Validation Entrypoint (`check.sh`)

To avoid command drift and statically validate configuration, paths, artifact producer/consumer alignment, and environment prerequisites without running heavy builds:

```bash
bash wasm/ci/check.sh --check
```

This lightweight entrypoint statically verifies:
- YAML syntax of `wasm/ci/wasm.yml` using Python `yaml` (syntax validation only) or `actionlint` (GitHub Actions workflow schema validation when installed).
- Shell script syntax using `bash -n`.
- Existence of all referenced source files, 15 Node unit test suites, and build scripts.
- Clean checkout test fixture existence (`tests/data/20mm_cube.obj`, `tests/data/extruder_idler.obj`, `tests/data/frog_legs.obj`, `wasm/tests/data/two_cubes_multi.3mf`).
- Exact upload/download Lowest Common Ancestor (LCA) pairing and producer-consumer path accuracy for build artifacts (e.g. `tests-node/profiles/Voron.json` and `web/profiles/index.json`).
- Preview build option (`-DORCA_WASM_PREVIEW=ON`) and build directory (`wasm/build/orca-wasm64-preview`).
- Scoped memory boundary provisioning and enforcement (`10GB` ceiling via `wasm/scripts/memcap.sh`, `NODE_OPTIONS=--max-old-space-size=2048`, `WASM_JOBS=6`).
- Absence of unproven causal assertions regarding stdlib differences.
- Native runner CLI flags (`--load-settings`, `--load-filaments`, `--slice 0`, `--export-settings`, `--outputdir`) and input paths (`ORCA_ENGINE_MODULE`, `NATIVE_ORCA`).
- Non-silent failure guarantees for known mismatching native parity cases.

---

## 2. Workflow Template Status

`wasm/ci/wasm.yml` is retained as a reference template. This repository has no active GitHub Actions workflows; CI will no longer run.

---

## 3. Workflow Triggers & Inputs

### Honest Explanation of Trigger Strategy
- **Manual `workflow_dispatch` is configured initially**:
  Compiling the full WebAssembly toolchain and 13 C++ dependencies (`Boost`, `CGAL`, `TBB`, `MPFR`, `GMP`, `NLopt`, `Cereal`, `Eigen`, `Expat`, `JPEG`, `PNG`, `Zlib`) with Emscripten wasm64 takes approximately 1 to 2 hours on un-cached runners. Running on every `push` and `pull_request` would be prohibitively expensive on public runners until warm remote caches are established.
- **Push and Pull Request Triggers**:
  The paths-filtered `push` and `pull_request` trigger configurations touching `wasm/**` and `src/libslic3r/**` are documented and preserved in comments in the workflow, ready to be uncommented once warm cache infrastructure is established.
- **`workflow_dispatch` Inputs**:
  - `native_appimage_url`: URL to native Linux AppImage for CLI preset export and native parity verification.
  - `native_appimage_sha256`: Expected SHA-256 checksum of the native Linux AppImage.
  - `native_macos_dmg_url`: URL to native macOS universal DMG for golden reference generation.
  - `native_macos_dmg_sha256`: Expected SHA-256 checksum of the native macOS DMG.

---

## 4. Runner Requirements & Scoped Memory Boundary Enforcement (10GB)

### Process-Level vs. Scoped Memory Enforcement
- **Node JS Heap Cap (`NODE_OPTIONS: '--max-old-space-size=2048'`)** and **Parallelism Cap (`WASM_JOBS: '6'`)** are process-level controls to prevent individual JS engines or build tools from spiking.
- **Heavy Command Scoping**: The workflow explicitly provisions a systemd user session on `ubuntu-24.04` (`sudo loginctl enable-linger "$USER"`, `sudo systemctl start "user@$(id -u).service"`, setting `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS`). Every heavy build, compilation, test, and bundling step is executed under `wasm/scripts/memcap.sh`, placing the process tree into a dedicated 10GB cgroup scope (`MemoryMax=10G`, `MemorySwapMax=0`).
- **No Uncapped / Silent Fallback**: Heavy steps do not fall back silently to unwrapped execution. If scoped memory provisioning fails, the preflight step fails fast with an explicit error.
- **macOS Reference Runner (`refs-macos`)**: The `refs-macos` job executes on Apple Silicon (`macos-14`) with Rosetta 2 (`softwareupdate --install-rosetta`). The macOS Darwin kernel does not possess Linux cgroups or systemd; the Linux-only systemd provisioning is deliberately omitted from `refs-macos`.

---

## 5. Workflow Jobs

| Job | Runner | Triggers | Description |
| :--- | :--- | :--- | :--- |
| **`build`** | `ubuntu-24.04` (scoped 10GB) | dispatch (push/PR ready) | Provisions systemd scoped memory, builds C/C++ dependency prefix (`prefix-wasm64`), compiles engine (`orca_engine`), spike driver (`orca_slice_driver`), preview module (`orca_preview` via `-DORCA_WASM_PREVIEW=ON`), extracts settings layout (`layout.json`), packs vendor profiles, builds web app bundle (`dist`), and uploads artifacts. All heavy steps wrapped via `wasm/scripts/memcap.sh`. |
| **`test-node`** | `ubuntu-24.04` (scoped 10GB) | dispatch (push/PR ready) | Provisions systemd scoped memory, downloads engine and profiles, verifies artifacts, fetches test models, runs all 15 Node unit test suites (`node --test --test-concurrency=1 wasm/tests/node/*.test.mjs`), runs engine memory recovery stress harness (`wasm/tests/stress/memory-recovery.mjs`), executes driver preset-merging & macOS golden parity runner (`run_parity.mjs`), and executes real native Linux parity runner (`native-parity.mjs`). All heavy steps wrapped via `wasm/scripts/memcap.sh`. |
| **`test-browser`** | `ubuntu-24.04` (scoped 10GB) | dispatch (push/PR ready) | Provisions systemd scoped memory, downloads engine, profiles, preview module, settings layout, and app bundle, verifies artifacts, installs Playwright browsers via lockfile `npm ci`, runs browser worker test suite (`wasm/tests/browser/run.mjs`), and executes app smoke test (`wasm/tests/app/smoke.mjs`). All heavy steps wrapped via `wasm/scripts/memcap.sh`. |
| **`refs-macos`** | `macos-14` | **dispatch only** (when DMG URL provided) | Downloads and mounts native macOS DMG, verifies SHA-256 against input, enables Rosetta 2 (`arch -x86_64`), runs `wasm/tests/parity/make_refs_macos.sh`, and uploads `refs-macos-x86_64` artifacts. |

---

## 6. Repeatability & Test Discovery

1. **Explicit Node Test Suite Discovery**:
   - Pinned unit test invocation covers all 15 suites:
     ```bash
     node --test --test-concurrency=1 wasm/tests/node/*.test.mjs
     ```
   - Engine memory recovery stress harness:
     ```bash
     node wasm/tests/stress/memory-recovery.mjs
     ```
   - Avoids directory recursion heuristics and guarantees serial execution to eliminate scratch folder collisions and heap spikes.
2. **Lockfile Enforcement**:
   - Dependencies are installed strictly via `npm ci` referencing repository lockfiles (`wasm/tests/package-lock.json` and `wasm/app/package-lock.json`).
3. **Deterministic Cache Keys**:
   - Dependency cache key incorporates runner OS, toolchain version, and file hashes:
     ```text
     prefix-wasm64-${{ runner.os }}-emsdk-6.0.11-${{ hashFiles('wasm/deps/**', 'wasm/scripts/env.sh') }}
     ```
4. **Fail-Fast Artifact Verification**:
   - Consumer jobs verify presence and non-zero size of exact produced artifacts before running tests.

---

## 7. Artifact Pairing & Producer-Consumer Alignment

| Artifact Name | Upload Path (Producer: `build`) | Download Path (Consumer) | Verified Consumer Files | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **`orca-wasm-engine`** | `wasm/build/orca-wasm64/wasm/engine/orca_engine.{mjs,wasm}`<br>`wasm/build/orca-wasm64/wasm/spike/orca_slice_driver.{js,wasm}` | `wasm/build/orca-wasm64/wasm` (`test-node`, `test-browser`) | `engine/orca_engine.{mjs,wasm}`<br>`spike/orca_slice_driver.{js,wasm}` | Core slicing engine and standalone spike driver (LCA: `wasm/build/orca-wasm64/wasm`) |
| **`orca-wasm-preview`** | `wasm/build/orca-wasm64-preview/wasm/preview/orca_preview.{js,wasm}` | `wasm/build/orca-wasm64-preview/wasm/preview` (`test-browser`) | `preview/orca_preview.{js,wasm}` | Standalone WebGL2 G-code preview renderer (built with `-DORCA_WASM_PREVIEW=ON`, LCA: `wasm/build/orca-wasm64-preview/wasm/preview`) |
| **`orca-wasm-profiles`** | `wasm/build/web`<br>`wasm/build/tests-node` | `wasm/build` (`test-node`, `test-browser`) | `web/profiles/index.json`<br>`tests-node/profiles/Voron.json` | Packed vendor profile bundles and index files (LCA: `wasm/build`) |
| **`orca-wasm-settings`** | `wasm/build/settings/layout.json` | `wasm/build/settings` (`test-browser`) | `settings/layout.json` | Desktop-extracted tab and settings hierarchy layout |
| **`orca-wasm-app-dist`** | `wasm/app/dist` | `wasm/app/dist` (`test-browser`) | `dist/index.html` | Production build of React web application |
| **`browser-test-results`** | `wasm/build/tests-browser`<br>`wasm/build/tests-app` | Upload only (`test-browser`) | N/A | Test screenshots and slice G-code outputs |
| **`refs-macos-x86_64`** | `wasm/tests/parity/refs-macos-x86_64` | Upload only (`refs-macos`) | `refs-macos-x86_64/cube-voron.gcode` | macOS golden reference G-code files |

---

## 8. Parity Source of Truth: Driver Comparison vs. Native Linux & macOS Parity

Understanding the distinct parity checks is critical:

### Check (a): Engine vs. Spike Driver (Preset Merging Verification via `run_parity.mjs`)
- **Purpose**: Validates that the WebAssembly engine's internal `PresetBundle` merging logic produces identical configuration and slicing output to native OrcaSlicer CLI config merging.
- **Mechanism**:
  1. Test case is sliced with `orca_engine.mjs` using internal bundle merging.
  2. Native Linux CLI exports flattened configuration (`--export-settings <id>.flat.json`).
  3. Spike driver (`orca_slice_driver.js`) slices using that flattened config.
  4. Both G-code outputs are compared with `compare_gcode.sh`.
- **Note**: This check validates configuration merging parity between Embind engine and spike driver. **It is NOT native Linux toolpath parity.** Do not mislabel this driver comparison as native parity.

### Check (b): Engine vs. Native macOS x86_64 Golden Reference (via `run_parity.mjs`)
- **Purpose**: Validates numerical and toolpath parity of WebAssembly output against pre-recorded native OrcaSlicer builds.
- **Committed Golden References**:
  - Currently, `cube-voron.gcode` is pre-recorded under [`wasm/tests/parity/refs-macos-x86_64/`](../tests/parity/refs-macos-x86_64/).
  - Other cases defined in `cases.json` report as `no ref` in summary output without failing.

### Check (c): Real Native Linux Parity (`native-parity.mjs`)
- **Purpose**: Directly compares real native Linux x86_64 AppImage slicing against WebAssembly engine slicing across three representative cases (`cube-voron`, `benchy-voron`, `cube-bbl`).
- **Observed Status**:
  - All three cases currently exhibit differing toolpath lines (exit code 2).
  - The underlying root causes remain unverified; no causal diagnosis attributing mismatches to standard library differences is asserted.
  - **No Silent Passing**: `native-parity.mjs` exits with code 2 when mismatches occur. The workflow step executes it without masking (`no || true`, no `continue-on-error: true`). When native parity verification is requested in CI, these mismatches will fail the step.

### Reproducible Reference Pinning & Integrity Verification
- URLs are not assumed to be immutable; repeatability and integrity are strictly enforced via expected SHA-256 checksums (`NATIVE_APPIMAGE_SHA256` for Linux CLI; `NATIVE_MACOS_DMG_SHA256` for macOS DMG).
- Checksums are verified via `sha256sum -c -` (Linux) or `shasum -a 256 -c -` (macOS Darwin) before extraction or mounting.
- If checksum inputs are absent or verification fails, CI rejects the input with an explicit error rather than accepting unverified binaries.
