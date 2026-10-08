# OrcaSlicer WASM Engine Memory and Recovery Harness

This directory contains the bounded engine memory and recovery harness (`memory-recovery.mjs`) for testing the WebAssembly engine in Node.js.

> **Note on Load Timings**: Sequential load timings recorded in this harness represent workload execution measurements under stress conditions, not a comparative benchmark.
> **Note on Test Environment**: This harness runs within Node.js with the Embind WebAssembly engine module and does not claim browser coverage.

---

## Verification Commands

Run the exact verification steps from the repository root:

```bash
# 1. Syntax check
wasm/scripts/memcap.sh node --check wasm/tests/stress/memory-recovery.mjs

# 2. Execute bounded harness under memory cap and 600s timeout
NODE_OPTIONS=--max-old-space-size=2048 wasm/scripts/memcap.sh timeout 600s node wasm/tests/stress/memory-recovery.mjs

# 3. Check git diff for whitespace or index issues
git diff --check
```

Memory constraints:
- Cgroup memory cap: 10 GiB via `wasm/scripts/memcap.sh`.
- Node heap cap: `--max-old-space-size=2048` (2048 MB / 2 GiB).
- Thread limit: 4 worker threads (max 6 jobs).
- Execution timeout: 120 seconds per scenario, 600 seconds total timeout.

---

## Scenarios Exercised

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

---

## Findings & Recorded Metrics

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

### Technical Observations & Limitations

- **Peak Process RSS & Memory Architecture**: Peak process RSS reaches ~1,776 MiB (~1.73 GiB) during 4-instance Benchy slicing and plateaus across subsequent recovery runs (~1,748–1,765 MiB). V8 JS heap usage remains low throughout (~13–28 MiB).
- **Attribution & Leak Limitations**: Process RSS reflects total OS resident set size of the Node.js process—including the V8 virtual machine, Node runtime libraries, Emscripten runtime, pthreads, virtual MEMFS filesystem, and WebAssembly linear memory. Process RSS cannot be attributed strictly to WebAssembly linear memory alone. Furthermore, WebAssembly memory allocators (e.g. dlmalloc/jemalloc) typically expand linear memory via 64 KiB pages and retain freed memory in arena free-lists rather than releasing physical memory pages back to the host operating system. Consequently, steady plateau RSS across three short cycles demonstrates operational stability, but does not establish the absence of long-term leaks.
- **Timer-Based Peak Sampling**: During asynchronous slicing, WebAssembly computation executes on background worker pthreads while Node's main event loop remains active (polling progress every 16 ms). The test's 10 ms periodic sampler (`setInterval`) samples `process.memoryUsage()` on the main event loop throughout the slice, capturing workload peaks across all scenarios. However, timer-based sampling is bounded by tick frequency and cannot detect sub-interval allocation spikes shorter than the sampling window.
- **Normalized Parity vs Raw Bit-for-Bit**: All 3 cancellation recovery cycles and the invalid-input recovery cycle achieved 0 differing normalized lines against the baseline cube. Normalization follows `compare_gcode.sh` (stripping comments, thumbnails, EXCLUDE_OBJECT, and M73 commands, and collapsing whitespace). This verifies functional equivalence and deterministic recovery of engine slicing output, but is not a raw bit-for-bit byte comparison.
- **Bounding Box & Instance Assertions**: Arranging 4 Benchy instances places each instance at non-overlapping XY coordinates within the Voron 300x300 mm bed polygon, with all individual bounding box envelopes `[offset ± size/2]` confirmed within [0, 300] mm XY bounds.
- **Execution Bounds**: The entire suite completed in ~6.4 seconds, well within the 120s per scenario and 600s total run bounds.
