# OrcaSlicer WebAssembly CI Workflow

This directory provides the GitHub Actions CI workflow template and documentation for the OrcaSlicer WebAssembly engine port.

- **Workflow Template**: [`wasm/ci/wasm.yml`](wasm.yml)
- **Target Location**: `.github/workflows/wasm.yml`

---

## 1. How to Enable the Workflow

The workflow is maintained as a template inside `wasm/ci/` so that it stays versioned with the WebAssembly port without touching repository-wide `.github/` configurations prematurely.

To activate this workflow in GitHub Actions, copy the template into `.github/workflows/`:

```bash
mkdir -p .github/workflows
cp wasm/ci/wasm.yml .github/workflows/wasm.yml
git add .github/workflows/wasm.yml
git commit -m "ci: enable OrcaSlicer WebAssembly workflow"
git push
```

---

## 2. Triggers

The workflow triggers automatically on:
- **`push`** touching any file matching:
  - `wasm/**`
  - `src/libslic3r/**`
- **`pull_request`** touching any file matching:
  - `wasm/**`
  - `src/libslic3r/**`
- **`workflow_dispatch`**: Manual run from the GitHub Actions UI on any branch.

---

## 3. Workflow Jobs & Runner Requirements

| Job | Runner | Triggers | Description |
| :--- | :--- | :--- | :--- |
| **`build`** | `ubuntu-24.04` | push, pull_request, workflow_dispatch | Installs emsdk 6.0.11, Ninja, and Node 24. Restores or builds C/C++ dependency libraries (`prefix-wasm64`), compiles `orca_engine` and `orca_slice_driver`, packs vendor profiles, and uploads artifacts. |
| **`test-node`** | `ubuntu-24.04` | push, pull_request, workflow_dispatch | Depends on `build`. Downloads build artifacts, installs native Linux AppImage nightly CLI to `/tmp/orca-native/`, fetches test models via `wasm/tests/data/fetch_models.sh`, runs `node --test wasm/tests/node/` and `node wasm/tests/parity/run_parity.mjs`. |
| **`test-browser`** | `ubuntu-24.04` | push, pull_request, workflow_dispatch | Depends on `build`. Fetches test models via `wasm/tests/data/fetch_models.sh`, installs Playwright and server dependencies via `npm --prefix wasm/tests ci`, installs Playwright browsers, and runs headless browser test suite `node wasm/tests/browser/run.mjs` verifying cross-origin isolation, Web Worker slice execution, UI interaction, and cancellation. |
| **`refs-macos`** | `macos-14` | **`workflow_dispatch` only** | Manual golden reference generation. Mounts universal macOS nightly DMG, enables Rosetta 2 (`arch -x86_64`), runs `wasm/tests/parity/make_refs_macos.sh`, and uploads `refs-macos-x86_64` artifacts. |

---

## 4. Caches and Keys

### WASM Dependency Prefix Cache (`prefix-wasm64`)
- **Path**: `wasm/build/prefix-wasm64`
- **Key**: `prefix-wasm64-${{ hashFiles('wasm/deps/**', 'wasm/scripts/env.sh') }}`
- **Contents**: Headers and static archives for all 13 dependencies (`zlib`, `png`, `jpeg`, `expat`, `eigen`, `cereal`, `nlopt`, `libnoise`, `gmp`, `mpfr`, `cgal`, `tbb`, `boost`).
- **Behavior**: On a cache hit, dependency builds are completely skipped. On a cache miss, dependencies are built in strictly ordered sequence via `wasm/deps/*.sh`.

### Emscripten SDK Cache
- Managed by `mymindstorm/setup-emsdk@v14` with `actions-cache-folder: 'emsdk-cache'` pinned to emsdk version `6.0.11`.
- Speeds up toolchain provisioning on GitHub-hosted runners.

---

## 5. Artifacts Produced

1. **`orca-wasm-engine`**:
   - `wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs`
   - `wasm/build/orca-wasm64/wasm/engine/orca_engine.wasm`
   - `wasm/build/orca-wasm64/wasm/spike/orca_slice_driver.js`
   - `wasm/build/orca-wasm64/wasm/spike/orca_slice_driver.wasm`
2. **`orca-wasm-profiles`**:
   - `wasm/build/web/`: Packed browser bundles (`profiles/`, `index.json`, `resources.json`)
   - `wasm/build/tests-node/`: Packed Node test bundles (`Voron`, `OrcaFilamentLibrary`, `BBL`, `Prusa`)
3. **`browser-test-results`** (from `test-browser`):
   - Slice G-code outputs from Chromium and Firefox (`tests-browser/`)
4. **`refs-macos-x86_64`** (from `refs-macos`):
   - Golden reference G-codes for all test cases defined in [`wasm/tests/parity/cases.json`](../tests/parity/cases.json).

---

## 6. Parity Source of Truth: Why macOS x86_64 References?

The parity test suite evaluates WebAssembly slice output against two checks:
- **Check (a)**: WebAssembly engine vs. spike driver using flattened config exported via native CLI.
- **Check (b)**: WebAssembly engine output vs. native reference G-code (`refs-macos-x86_64/<id>.gcode`).

### Why Native Linux Output Is Not the Parity Golden Reference
Native Linux binaries cannot serve as the reference of truth for WebAssembly slicing:
1. **Standard Library Discrepancy**: Native Linux binaries link against GNU `libstdc++`, while WebAssembly (compiled via Emscripten / Clang) and macOS binaries link against LLVM `libc++`.
2. **Path & Infill Divergence**: Differences in standard library implementations (container internal ordering, hash algorithms, and `std::sort` stability) result in slight differences in polygon traversal and infill toolpath ordering, even when input models and slicing parameters are 100% identical.
3. macOS x86_64 builds share Clang and LLVM `libc++`, producing exact byte-for-byte or normalized move parity with WebAssembly builds.

### Why Rosetta 2 Emulation on macOS Runners?
OrcaSlicer's upstream release CI produces a universal binary (`OrcaSlicer_Mac_universal_nightly.dmg`) built on Apple Silicon runners, but OrcaSlicer has no dedicated Intel macOS runners. Because the reference files must target the x86_64 instruction set and ABI:
- The `refs-macos` job runs on a `macos-14` runner.
- Rosetta 2 is installed via `softwareupdate --install-rosetta --agree-to-license`.
- The native binary is executed under Rosetta using `arch -x86_64` within [`wasm/tests/parity/make_refs_macos.sh`](../tests/parity/make_refs_macos.sh).
- Because macOS runners incur higher GitHub Actions billing, this job is strictly gated to manual `workflow_dispatch`.

---

## 7. Expected Run Times

- **Dependency Build (Cold Cache)**: ~20–30 minutes (compiling Boost, CGAL, TBB, etc. for WebAssembly).
- **OrcaSlicer WASM Compilation (`build_orca.sh`)**: ~3–5 minutes.
- **Warm CI Run (Cached Dependencies)**:
  - `build` job: ~4–6 minutes.
  - `test-node` job: ~1–2 minutes.
  - `test-browser` job: ~2–3 minutes.
  - Total pipeline duration: **~7–9 minutes**.
- **`refs-macos` (when dispatched)**: ~2–4 minutes.
