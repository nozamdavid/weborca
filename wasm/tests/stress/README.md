# OrcaSlicer WASM Engine Memory and Recovery Harnesses

This directory contains bounded reliability and recovery test harnesses for the OrcaSlicer WebAssembly engine:
1. **Node Engine Memory Harness** (`memory-recovery.mjs`): Direct Node.js Embind stress and memory plateau testing.
2. **Browser Reliability & Recovery Harness** (`browser-recovery.mjs`): End-to-end browser runner exercising client/worker recovery against verified `ui-recovery-final-dist` in Chromium and Firefox.

> **Note on Load Timings**: Sequential load timings recorded in these harnesses represent workload execution measurements under stress conditions, not a comparative benchmark.
> **Note on Browser Heap Enforcement**: Neither browser JavaScript nor WebAssembly provides deterministic hard browser heap enforcement from user script. Memory allocation is governed by browser process managers and host OS limits; WebAssembly linear memory allocators retain expanded memory pages in arena free-lists and do not immediately return physical pages to the host OS.

---

## Verification Commands

Run the exact verification steps from the repository root:

```bash
# --- 1. Node.js Engine Harness ---
# Syntax check
wasm/scripts/memcap.sh node --check wasm/tests/stress/memory-recovery.mjs

# Execute under memory cap and 600s timeout
NODE_OPTIONS=--max-old-space-size=2048 wasm/scripts/memcap.sh timeout 600s node wasm/tests/stress/memory-recovery.mjs

# --- 2. Browser Reliability & Recovery Harness ---
# Syntax check
MEMCAP=10G NODE_OPTIONS=--max-old-space-size=2048 wasm/scripts/memcap.sh node --check wasm/tests/stress/browser-recovery.mjs

# Execute normal test across Chromium and Firefox
MEMCAP=10G NODE_OPTIONS=--max-old-space-size=2048 wasm/scripts/memcap.sh node wasm/tests/stress/browser-recovery.mjs

# Execute single-cycle test
STRESS_CYCLES=1 MEMCAP=10G NODE_OPTIONS=--max-old-space-size=2048 wasm/scripts/memcap.sh node wasm/tests/stress/browser-recovery.mjs

# Verify timeout guard cleans browser/server resources and exits non-zero
BROWSERS=chromium STRESS_TIMEOUT_MS=1 MEMCAP=10G NODE_OPTIONS=--max-old-space-size=2048 wasm/scripts/memcap.sh node wasm/tests/stress/browser-recovery.mjs

# Optional configuration flags / environment variables:
# STRESS_CYCLES=2 STRESS_INSTANCES=2 STRESS_MODEL=wasm/build/models/3DBenchy.stl BROWSERS=chromium,firefox wasm/scripts/memcap.sh node wasm/tests/stress/browser-recovery.mjs

# --- 3. Git status / diff check ---
git diff --check
```

Memory constraints:
- Cgroup memory cap: 10 GiB via `wasm/scripts/memcap.sh`.
- Node heap cap: `--max-old-space-size=2048` (2048 MB / 2 GiB).
- Thread limit: 4 worker threads (max 6 jobs).
- Host memory pre-check: `free -g` available RAM >= 15 GiB prior to heavy runs.

---

## Browser Reliability & Recovery Harness (`browser-recovery.mjs`)

The browser reliability runner verifies engine and worker lifecycle recovery against the verified `ui-recovery-final-dist` web application build in headless Chromium and Firefox.

### Scenarios Exercised

1. **COOP/COEP Isolation & Ephemeral Server**:
   - Launches an internal Node HTTP server serving `ui-recovery-final-dist` with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on an ephemeral port.
   - Verifies `window.crossOriginIsolated === true` in both Chromium and Firefox (enabling `SharedArrayBuffer` support).

2. **Baseline Cube Slice**:
   - Initializes `OrcaEngine` via Web Worker RPC (`/engine-worker.js`, `/engine/orca_engine.mjs`, `/profiles/`).
   - Slices `20mm_cube.obj` with Voron presets (`Voron 2.4 300 0.4 nozzle`, `0.20mm Standard @Voron`, `Generic PLA @System`).
   - Verifies 100 layers and establishes normalized reference G-code baseline.

3. **Configurable Stress Model Project**:
   - Loads a 3D model (default `3DBenchy.stl`, configurable via `STRESS_MODEL` path override).
   - Duplicates instances via `duplicateInstance` (configurable via `STRESS_INSTANCES`, default 2 instances).
   - Arranges instances on the bed polygon (`arrange({ useBed: true })`).

4. **In-Flight Cancellation During Active Computation**:
   - Initiates slicing computation with an `AbortController` signal and `onProgress` event listener.
   - Triggers `controller.abort()` after 250 ms during active background slicing.
   - Asserts streaming progress notifications were received (e.g., `Slicing mesh`, `Generating walls`), confirming cancellation interrupts active computation rather than rejecting prior to start.
   - Verifies immediate, bounded cancellation (`wasCanceled: true`, elapsed >= 200 ms, error caught as `AbortError`).

5. **Same-Worker State Recovery & Normalized Parity**:
   - Immediately loads `20mm_cube.obj` on the same recovered Web Worker instance without restarting or reinitializing the worker.
   - Arranges and executes a complete slice.
   - Verifies recovery slice produces 100 layers and 0 differing normalized G-code lines compared to the baseline cube (per `compare_gcode.sh` normalization rules).
   - **Scope of Evidence**: Parity proves deterministic functional recovery of the WebAssembly worker on the same worker instance; it does not claim bit-for-bit parity with native desktop binaries.
   - Saves recovery G-code artifacts to `wasm/build/browser-recovery/`.

6. **Repeated Lifecycle & Robust Timeout Handling**:
   - Repeats cancellation/recovery across configurable cycles (`STRESS_CYCLES`, default 2).
   - Enforces per-browser timeout (`STRESS_TIMEOUT_MS`, default 120000 ms).
   - If a timeout occurs, closes the browser and forcibly terminates all owned descendant browser processes, shuts down the HTTP server, and exits non-zero. Clears timer upon normal completion.
   - Validates `BROWSERS` list; invalid or unknown browsers fail fast with non-zero exit code.
   - Concludes by calling `engine.dispose()`.

### Findings & Recorded Metrics (Browser Runner)

Recorded from a verified execution run under `memcap.sh` with `NODE_OPTIONS=--max-old-space-size=2048`:

| Browser | Cycle | Instances | Cancel (ms) | Recovery (ms) | Recovery Layers | Parity vs Baseline | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Chromium** | 1 | 2 | 258 | 50 | 100 | 0 diff lines | PASS |
| **Chromium** | 2 | 2 | 258 | 49 | 100 | 0 diff lines | PASS |
| **Firefox** | 1 | 2 | 276 | 49 | 100 | 0 diff lines | PASS |
| **Firefox** | 2 | 2 | 259 | 49 | 100 | 0 diff lines | PASS |

#### Honest Memory Metrics (Browser Runner)

| Browser | Cycle | Browser Tree RSS (MiB) | Client JS Heap | WASM Linear Heap |
| :--- | :---: | :---: | :---: | :---: |
| **Chromium** | 1 | 1374.93 | 11.35 MiB | unexposed across worker boundary |
| **Chromium** | 2 | 1436.40 | 11.35 MiB | unexposed across worker boundary |
| **Firefox** | 1 | 1857.77 | unavailable (Firefox unsupported) | unexposed across worker boundary |
| **Firefox** | 2 | 1919.16 | unavailable (Firefox unsupported) | unexposed across worker boundary |

*Memory Architecture & Attribution Notes*:
- **Browser Process Tree RSS**: Measures total host OS resident set size (`VmRSS`) attributed to the browser root process and all its descendants (main browser, zygote, GPU, network, content/renderer processes, worker threads) via direct `/proc` inspection. Excludes the Node.js runner process and unrelated child processes.
- **Client JS Heap**: Available only in Chromium via `window.performance.memory`. In Firefox, `performance.memory` is non-standard and unsupported, so it is honestly marked unavailable.
- **WASM Linear Heap**: WebAssembly linear memory (`SharedArrayBuffer`) is encapsulated within the background Web Worker and pthreads; it cannot be directly queried from the window DOM context without specialized worker instrumentation.
- **No Hard Browser Heap Enforcement**: Neither browser JS nor WebAssembly offers deterministic hard heap ceilings or immediate OS page release upon cancellation. Bounded stability is demonstrated by repeated successful cancellation and recovery cycles.

---

## Node Engine Memory Harness (`memory-recovery.mjs`)

The Node engine harness runs directly against the Embind module in Node.js for deep memory sampling and load testing.

### Scenarios Exercised

1. **Baseline Cube Slicing**:
   - Model: `tests/data/20mm_cube.obj`.
   - Presets: `Voron 2.4 300 0.4 nozzle`, `0.20mm Standard @Voron`, `Generic PLA @System`.
   - Produces baseline G-code (100 layers) saved to scratch `wasm/build/stress/scratch/cube_baseline.gcode`.
   - Establishes canonical normalized G-code baseline using `wasm/spike/compare_gcode.sh` normalization rules.
   - Measures slice duration and periodically sampled peak process RSS and JS heap.

2. **Sequential 1 Benchy Instance**:
   - Model: `wasm/build/models/3DBenchy.stl` (11,285,384 bytes, 112,569 vertices, 225,154 triangles).
   - Arranged on bed (`useBed: true`), verifying offset coordinates and model bounding box lie within the Voron 300x300 bed XY bounds [0, 300] mm.
   - Sliced with 4 threads; records duration, periodically sampled peak process RSS, and peak JS heap.

3. **Sequential 4 Benchy Instances**:
   - Model instances: 4 instances duplicated via `duplicateInstance` (total 900,616 triangles).
   - Arranged on bed (`useBed: true`), verifying all 4 instance center offsets and individual bounding boxes lie within [0, 300] mm XY bounds without overlapping offsets.
   - Sliced with 4 threads; records duration, periodically sampled peak process RSS, and peak JS heap.

4. **Three Cancellation and Recovery Cycles**:
   - Each cycle starts slicing Benchy, signals cancellation via `AbortSignal` at 250 ms, and verifies that prompt cancellation occurs (`wasCanceled: true`, elapsed < 10 s).
   - Immediately recovers by loading `20mm_cube.obj`, arranging, and slicing with an active 10 ms memory sampler.
   - Verifies the recovered G-code produces 100 layers and achieves 0 differing normalized lines compared to the baseline cube (verified both in-process and via `wasm/spike/compare_gcode.sh`).

5. **Invalid-Input Error Recovery**:
   - Submits an invalid model path (`/models/nonexistent_invalid_path.stl`), verifying prompt rejection with error message.
   - Recovers by loading, arranging, and slicing `20mm_cube.obj` with an active 10 ms memory sampler.
   - Verifies 100 layers and 0 differing normalized lines compared to baseline cube.

6. **Resource Disposal**:
   - Calls `core.dispose()`, releasing the underlying C++ `Engine` Embind instance.

### Findings & Recorded Metrics (Node Harness)

Recorded from a verified execution run under `memcap.sh` with `NODE_OPTIONS=--max-old-space-size=2048`:

| Scenario | Instances | Triangles | Duration (s) | Peak Process RSS (MiB) | Peak JS Heap (MiB) | Layers | Success | Parity vs Baseline |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Baseline Cube** | 1 | 12 | 0.20 | 1040.97 | 22.95 | 100 | True | Baseline |
| **1 Benchy** | 1 | 225,154 | 1.12 | 1077.81 | 27.49 | 240 | True | N/A |
| **4 Benchy** | 4 | 900,616 | 1.69 | 1776.28 | 17.95 | 240 | True | N/A |
| **Cancel/Recover #1** | 1 | 12 | 0.05 | 1764.54 | 13.39 | 100 | True | 0 diff lines |
| **Cancel/Recover #2** | 1 | 12 | 0.05 | 1748.75 | 14.75 | 100 | True | 0 diff lines |
| **Cancel/Recover #3** | 1 | 12 | 0.05 | 1750.11 | 17.25 | 100 | True | 0 diff lines |
| **InvalidInput/Recover**| 1 | 12 | 0.05 | 1750.61 | 20.04 | 100 | True | 0 diff lines |

*Units Note*: 1 MiB = 1,048,576 bytes (`1024^2` bytes); 1 GiB = 1,024 MiB. Duration for Cancel/Recover and InvalidInput/Recover rows measures the timed recovery slice operation.

### Technical Observations & Limitations (Node Harness)

- **Peak Process RSS & Memory Architecture**: Peak process RSS reaches ~1,776 MiB (~1.73 GiB) during 4-instance Benchy slicing and plateaus across subsequent recovery runs (~1,748–1,765 MiB). V8 JS heap usage remains low throughout (~13–28 MiB).
- **Attribution & Leak Limitations**: Process RSS reflects total OS resident set size of the Node.js process—including the V8 virtual machine, Node runtime libraries, Emscripten runtime, pthreads, virtual MEMFS filesystem, and WebAssembly linear memory. Process RSS cannot be attributed strictly to WebAssembly linear memory alone. Furthermore, WebAssembly memory allocators (e.g. dlmalloc/jemalloc) typically expand linear memory via 64 KiB pages and retain freed memory in arena free-lists rather than releasing physical memory pages back to the host operating system. Consequently, steady plateau RSS across three short cycles demonstrates operational stability, but does not establish the absence of long-term leaks.
- **Timer-Based Peak Sampling**: During asynchronous slicing, WebAssembly computation executes on background worker pthreads while Node's main event loop remains active (polling progress every 16 ms). The test's 10 ms periodic sampler (`setInterval`) samples `process.memoryUsage()` on the main event loop throughout the slice, capturing workload peaks across all scenarios. However, timer-based sampling is bounded by tick frequency and cannot detect sub-interval allocation spikes shorter than the sampling window.
- **Normalized Parity vs Raw Bit-for-Bit**: All 3 cancellation recovery cycles and the invalid-input recovery cycle achieved 0 differing normalized lines against the baseline cube. Normalization follows `compare_gcode.sh` (stripping comments, thumbnails, EXCLUDE_OBJECT, and M73 commands, and collapsing whitespace). This verifies functional equivalence and deterministic recovery of engine slicing output, but is not a raw bit-for-bit byte comparison.
- **Bounding Box & Instance Assertions**: Arranging 4 Benchy instances places each instance at non-overlapping XY coordinates within the Voron 300x300 mm bed polygon, with all individual bounding box envelopes `[offset ± size/2]` confirmed within [0, 300] mm XY bounds.
- **Execution Bounds**: The entire suite completed in ~6.4 seconds, well within the 120s per scenario and 600s total run bounds.
