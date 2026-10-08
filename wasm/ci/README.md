# OrcaSlicer WebAssembly CI Workflow

This directory provides the CI workflow template, local validation tooling, and documentation for the OrcaSlicer WebAssembly port.

- **Workflow Template**: [`wasm/ci/wasm.yml`](wasm.yml)
- **Local / CI Validation Entrypoint**: [`wasm/ci/check.sh`](check.sh)
- **Target Location**: `.github/workflows/wasm.yml` (or Tangled / provider-neutral CI pipeline)

---

## 1. Quick Validation Entrypoint (`check.sh`)

To avoid command drift and validate configuration, paths, artifact producer/consumer alignment, and environment prerequisites without running heavy builds:

```bash
bash wasm/ci/check.sh --check
```

This lightweight entrypoint statically verifies:
- YAML syntax of `wasm/ci/wasm.yml` using `actionlint`, `yamllint`, or Python `yaml`.
- Shell script syntax using `bash -n`.
- Existence of all referenced source files, test suites, and build scripts.
- Exact upload/download pairing and producer-consumer path accuracy for build artifacts (e.g. `tests-node/profiles/Voron.json` and `web/profiles/index.json`).
- Preview build option (`-DORCA_WASM_PREVIEW=ON`) and build directory (`wasm/build/orca-wasm64-preview`).
- Total process memory enforcement mechanism status (10GB ceiling via container cgroups or `systemd-run --user`).
- Rejection semantics and status of committed macOS x86_64 parity reference files.

---

## 2. Enabling the Workflow in CI

The workflow is maintained as a template inside `wasm/ci/` so that it stays versioned with the WebAssembly port without prematurely altering global repository configuration:

```bash
mkdir -p .github/workflows
cp wasm/ci/wasm.yml .github/workflows/wasm.yml
git add .github/workflows/wasm.yml
git commit -m "ci: enable OrcaSlicer WebAssembly workflow"
git push
```

---

## 3. Workflow Triggers & Inputs

The workflow triggers on:
- **`push`** touching `wasm/**` or `src/libslic3r/**`
- **`pull_request`** touching `wasm/**` or `src/libslic3r/**`
- **`workflow_dispatch`** with optional inputs for reproducible reference pinning:
  - `native_appimage_url`: URL to native Linux AppImage for CLI preset export.
  - `native_appimage_sha256`: Expected SHA-256 checksum of the native Linux AppImage.
  - `native_macos_dmg_url`: URL to native macOS universal DMG for golden reference generation.
  - `native_macos_dmg_sha256`: Expected SHA-256 checksum of the native macOS DMG.

---

## 4. Runner Requirements & Total Memory Enforcement (10GB)

### Process-Level vs. Total Memory Enforcement
- **Node JS Heap Cap (`NODE_OPTIONS: '--max-old-space-size=2048'`)** and **Parallelism Cap (`WASM_JOBS: '6'`)** are process-level controls to prevent individual JS engines or build tools from spiking.
- **They are NOT total process or system memory enforcement.** A host running multiple compiler steps or test runners can still exhaust system memory if not bounded by an OS/cgroup ceiling.
- **Workflow Requirement**: The workflow **strictly requires a 10GB total memory limit** enforced by the runner environment (via container cgroups or user systemd scopes).
- **No Uncapped Fallback**: If a runner lacks both container cgroup bounding (`<= 10GB`) and functional `systemd-run --user`, the workflow preflight step **fails clearly with an error** pending a configured bounded runner. Uncapped execution is not permitted.

### Supported Memory Enforcement Mechanisms
1. **Containerized / Docker Runners (Recommended)**:
   Runners bounded at the container level:
   ```bash
   docker run --memory=10g --memory-swap=10g ...
   ```
   The Linux kernel cgroup (`memory.max` in cgroup v2 or `memory.limit_in_bytes` in cgroup v1) enforces the 10GB ceiling across all processes in the container.
2. **Self-Hosted / Bare-Metal Runners with User systemd**:
   When running on systemd-enabled hosts, `wasm/scripts/memcap.sh` invokes `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0` to place heavy processes into a dedicated 10GB cgroup.
   To enable user systemd on runner service accounts:
   ```bash
   loginctl enable-linger <runner-user>
   export XDG_RUNTIME_DIR="/run/user/$(id -u)"
   export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
   ```

### Runner Prerequisites & Platform Boundaries
- **Default GitHub-Hosted Linux Runners**: Standard GitHub-hosted `ubuntu-24.04` runners do NOT come bounded to 10GB memory nor do they provide a functional user systemd DBUS session out of the box. Running this workflow on GitHub Actions requires container-level bounding (`container: { image: ..., options: "--memory=10g" }`) or self-hosted runners configured as above; unbounded runners intentionally fail preflight.
- **macOS Reference Runner (`refs-macos`)**: The `refs-macos` job executes on Apple Silicon (`macos-14`) with Rosetta 2 (`softwareupdate --install-rosetta`). The macOS Darwin kernel does not possess Linux cgroups or systemd; the Linux-only 10GB cgroup preflight is deliberately omitted from `refs-macos` to avoid falsely breaking reference generation.

---

## 5. Workflow Jobs

| Job | Runner | Triggers | Description |
| :--- | :--- | :--- | :--- |
| **`build`** | `ubuntu-24.04` (bounded) | push, PR, dispatch | Enforces 10GB memory ceiling, builds C/C++ dependency prefix (`prefix-wasm64`), compiles engine (`orca_engine`), spike driver (`orca_slice_driver`), preview module (`orca_preview` via `-DORCA_WASM_PREVIEW=ON`), extracts settings layout (`layout.json`), packs vendor profiles, builds web app bundle (`dist`), and uploads artifacts. |
| **`test-node`** | `ubuntu-24.04` (bounded) | push, PR, dispatch | Enforces 10GB memory ceiling, downloads engine and profiles, verifies artifacts (`tests-node/profiles/Voron.json`, `web/profiles/index.json`), fetches test models, runs Node test suites (`node --test --test-concurrency=1 wasm/tests/node/*.test.mjs`), and executes parity checks (`run_parity.mjs`). |
| **`test-browser`** | `ubuntu-24.04` (bounded) | push, PR, dispatch | Enforces 10GB memory ceiling, downloads engine, profiles, preview module, settings layout, and app bundle, verifies artifacts, installs Playwright browsers via lockfile `npm ci`, runs browser worker test suite (`wasm/tests/browser/run.mjs`), and executes app smoke test (`wasm/tests/app/smoke.mjs`). |
| **`refs-macos`** | `macos-14` | **dispatch only** | Downloads and mounts native macOS DMG, verifies SHA-256 against input, enables Rosetta 2 (`arch -x86_64`), runs `wasm/tests/parity/make_refs_macos.sh`, and uploads `refs-macos-x86_64` artifacts. |

---

## 6. Repeatability & Test Discovery

1. **Explicit Node Test Suite Discovery**:
   - Pinned invocation:
     ```bash
     node --test --test-concurrency=1 wasm/tests/node/*.test.mjs
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
| **`orca-wasm-engine`** | `wasm/build/orca-wasm64/wasm/engine/orca_engine.{mjs,wasm}`<br>`wasm/build/orca-wasm64/wasm/spike/orca_slice_driver.{js,wasm}` | `wasm/build/orca-wasm64/wasm` (`test-node`, `test-browser`) | `engine/orca_engine.{mjs,wasm}`<br>`spike/orca_slice_driver.{js,wasm}` | Core slicing engine and standalone spike driver |
| **`orca-wasm-preview`** | `wasm/build/orca-wasm64-preview/wasm/preview/orca_preview.{js,wasm}` | `wasm/build/orca-wasm64-preview/wasm/preview` (`test-browser`) | `preview/orca_preview.{js,wasm}` | Standalone WebGL2 G-code preview renderer (built with `-DORCA_WASM_PREVIEW=ON`) |
| **`orca-wasm-profiles`** | `wasm/build/web`<br>`wasm/build/tests-node` | `wasm/build` (`test-node`, `test-browser`) | `web/profiles/index.json`<br>`tests-node/profiles/Voron.json` | Packed vendor profile bundles and index files |
| **`orca-wasm-settings`** | `wasm/build/settings/layout.json` | `wasm/build/settings` (`test-browser`) | `settings/layout.json` | Desktop-extracted tab and settings hierarchy layout |
| **`orca-wasm-app-dist`** | `wasm/app/dist` | `wasm/app/dist` (`test-browser`) | `dist/index.html` | Production build of React web application *(Integration Pending: see note below)* |
| **`browser-test-results`** | `wasm/build/tests-browser`<br>`wasm/build/tests-app` | Upload only (`test-browser`) | N/A | Test screenshots and slice G-code outputs |
| **`refs-macos-x86_64`** | `wasm/tests/parity/refs-macos-x86_64` | Upload only (`refs-macos`) | `refs-macos-x86_64/cube-voron.gcode` | macOS golden reference G-code files |

### Web App & App Smoke Test Integration Status (Pending)
> [!NOTE]
> The workflow includes build steps (`npm --prefix wasm/app run build`), artifact packaging (`orca-wasm-app-dist`), and Playwright smoke testing (`wasm/tests/app/smoke.mjs`) for the React web application.
> However, `wasm/app/` and `wasm/tests/app/` are currently untracked in the git repository (owned by active parallel development tracks).
> On clean checkouts from git, these directories do not exist. Complete standalone CI execution for web app artifacts and smoke tests is **pending** the integration and commit of the app codebase. This workflow should not be claimed as standalone complete CI until that integration lands.

---

## 8. Parity Source of Truth: Driver Comparison vs. Native macOS Reference

Understanding the two distinct parity checks in `run_parity.mjs` is critical:

### Check (a): Engine vs. Driver (Preset Merging Verification)
- **Purpose**: Validates that the WebAssembly engine's internal `PresetBundle` merging logic produces identical configuration and slicing output to native OrcaSlicer CLI config merging.
- **Mechanism**:
  1. Test case is sliced with `orca_engine.mjs` using internal bundle merging.
  2. Native Linux CLI exports flattened configuration (`--export-settings <id>.flat.json`).
  3. Spike driver (`orca_slice_driver.js`) slices using that flattened config.
  4. Both G-code outputs are compared with `compare_gcode.sh`.
- **Note**: This check tests configuration merging parity, **not** native Linux G-code toolpaths.

### Check (b): Engine vs. Native macOS x86_64 Golden Reference
- **Purpose**: Validates numerical and toolpath parity of WebAssembly output against official native OrcaSlicer builds.
- **Why macOS x86_64?**:
  - Native Linux binaries compile with GCC and GNU `libstdc++`.
  - WebAssembly (Clang / Emscripten) and macOS binaries compile with Clang and LLVM `libc++`.
  - Differences in standard library implementations (container internal layout, sort stability, hash maps) alter polygon ordering and infill toolpaths, even on identical models and settings.
  - macOS x86_64 shares Clang and LLVM `libc++`, producing exact move parity with WebAssembly builds.
- **Committed Golden References**:
  - **Never assume all test cases have native goldens.**
  - Currently, `cube-voron.gcode` is pre-recorded under [`wasm/tests/parity/refs-macos-x86_64/`](../tests/parity/refs-macos-x86_64/).
  - Other cases defined in `cases.json` report as `no ref` in summary output until generated.

### Reproducible Reference Pinning & Integrity Verification
- URLs are not assumed to be immutable; repeatability and integrity are strictly enforced via expected SHA-256 checksums (`NATIVE_APPIMAGE_SHA256` for Linux CLI; `NATIVE_MACOS_DMG_SHA256` for macOS DMG).
- Checksums are verified via `sha256sum -c -` (Linux) or `shasum -a 256 -c -` (macOS Darwin) before extraction or mounting.
- If checksum inputs are absent or verification fails, CI rejects the input with an explicit error rather than accepting unverified binaries.
