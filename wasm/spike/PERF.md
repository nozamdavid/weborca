# WebAssembly vs Native Slicing Engine Benchmark Report

## 1. Environment

- **Machine**: Linux x86_64
- **CPU**: AMD Ryzen 9 9950X3D 16-Core Processor
- **Logical CPUs**: 32 logical cores (`0-31`), 1 socket, 16 physical cores (2 threads/core)
- **Node.js**: v24.19.0 (emsdk Node at `/home/david/emsdk/node/24.19.0_64bit/bin/node`)
- **Native Binary**: `/tmp/orca-native/squashfs-root/AppRun` (invoked via `wasm/build/native/slice_native.sh`)
- **Load Average**:
  - Benchmark start: `21:25:27 up 5 days, 1:25, 7 users, load average: 1.45, 3.35, 4.47`
  - Benchmark end: `21:35:03 up 5 days, 1:35, 7 users, load average: 2.53, 3.67, 4.29`

---

## 2. Measurement Methodology

All benchmarks were run strictly sequentially (one process at a time) on an otherwise idle system. Each configuration was executed 3 times, and the median of each metric is reported.

### Commands Used

- **Environment Setup**:
  ```bash
  source wasm/scripts/env.sh
  ```

- **WASM Driver Execution**:
  Wrapped with `/usr/bin/time -f "%e %M"` and `timeout 300`:
  ```bash
  # Explicit thread counts (1, 2, 4, 8):
  /usr/bin/time -f "%e %M" timeout 300 node wasm/build/variants/<variant>/orca_slice_driver.js <model> <out.gcode> wasm/spike/data/voron24_pla_020.json <threads>

  # Default thread count (TBB uses all 32 logical cores via task_arena):
  /usr/bin/time -f "%e %M" timeout 300 node wasm/build/variants/<variant>/orca_slice_driver.js <model> <out.gcode> wasm/spike/data/voron24_pla_020.json
  ```
  - `slice ms` and `driver total ms` are parsed directly from driver stdout (`Slicing: <N> ms` and `Total: <N> ms`).
  - `process wall ms` is calculated as `wall_seconds * 1000`.
  - `peak RSS MB` is calculated as `max_rss_kb / 1024`.

- **Native Execution**:
  Constrained using `taskset -c 0-(N-1)`:
  ```bash
  # Threads 1, 2, 4, 8:
  /usr/bin/time -f "%e %M" timeout 300 taskset -c 0-$((N-1)) bash wasm/build/native/slice_native.sh <model> <out.gcode>

  # Default thread count (all CPUs, no taskset):
  /usr/bin/time -f "%e %M" timeout 300 bash wasm/build/native/slice_native.sh <model> <out.gcode>
  ```

- **Native Startup Overhead**:
  Measured as the minimum wall time over 3 runs slicing `wasm/build/bench/models/tiny_cube.obj`:
  - Run 1: 0.30 s
  - Run 2: 0.20 s
  - Run 3: 0.30 s
  - **Minimum Startup Overhead**: **0.20 s (200 ms)** (peak RSS: ~175 MB).
  - Native Net Process Wall Time = Process Wall Time minus 200 ms.

---

## 3. Matrix 1: 3DBenchy Scaling Across Variants

- **Model**: `wasm/build/bench/models/3DBenchy.stl`
- **Variants**:
  - `base`: dlmalloc, PTHREAD_POOL_SIZE=8, 8 MB pthread stacks, -O3
  - `mimalloc`: -sMALLOC=mimalloc
  - `mimalloc_poolhw`: mimalloc + PTHREAD_POOL_SIZE=navigator.hardwareConcurrency (32)
  - `dlmalloc_poolhw`: dlmalloc + PTHREAD_POOL_SIZE=navigator.hardwareConcurrency (32)
  - `mimalloc_stack1mb`: mimalloc + 1 MB pthread stacks
  - `lto`: -flto (dlmalloc, pool 8)
  - `simd`: -msimd128 (dlmalloc, pool 8)
  - `lto_simd`: -flto -msimd128 (dlmalloc, pool 8)
  - `native`: Linux x86_64 AppRun
- **Metrics**: Medians across 3 runs.

| Variant | Threads | Slice ms | Driver Total ms | Process Wall ms | Peak RSS MB |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `base` | 1 | 1586 | 4120 | 4600 | 1761.11 |
| `base` | 2 | 1065 | 2772 | 3200 | 1760.69 |
| `base` | 4 | 1224 | 2656 | 3100 | 1868.65 |
| `base` | 8 | 2500 | 3706 | 4200 | 2022.02 |
| `base` | default | 3984 | 5202 | 5700 | 2199.07 |
| `mimalloc` | 1 | 1500 | 4015 | 4200 | 699.76 |
| `mimalloc` | 2 | 858 | 2386 | 2600 | 723.80 |
| `mimalloc` | 4 | 574 | 1681 | 1900 | 842.63 |
| `mimalloc` | 8 | 474 | 1396 | 1600 | 887.47 |
| `mimalloc` | default | 522 | 1328 | 1600 | 1366.97 |
| `mimalloc_poolhw` | 1 | 1506 | 4029 | 4300 | 1034.41 |
| `mimalloc_poolhw` | 2 | 857 | 2399 | 2700 | 1057.98 |
| `mimalloc_poolhw` | 4 | 561 | 1674 | 1900 | 1121.27 |
| `mimalloc_poolhw` | 8 | 456 | 1365 | 1600 | 1212.20 |
| `mimalloc_poolhw` | default | 467 | 1259 | 1500 | 1477.52 |
| `dlmalloc_poolhw` | 1 | 1594 | 4166 | 4700 | 2086.33 |
| `dlmalloc_poolhw` | 2 | 1105 | 2841 | 3300 | 2069.61 |
| `dlmalloc_poolhw` | 4 | 1234 | 2564 | 3100 | 2114.98 |
| `dlmalloc_poolhw` | 8 | 2329 | 3559 | 4100 | 2242.73 |
| `dlmalloc_poolhw` | default | 4052 | 5306 | 5800 | 2339.14 |
| `mimalloc_stack1mb` | 1 | 1506 | 4021 | 4200 | 693.52 |
| `mimalloc_stack1mb` | 2 | 867 | 2413 | 2600 | 719.88 |
| `mimalloc_stack1mb` | 4 | 559 | 1655 | 1900 | 762.98 |
| `mimalloc_stack1mb` | 8 | 469 | 1396 | 1600 | 888.88 |
| `mimalloc_stack1mb` | default | fail* (522) | fail* (1328) | fail* (1550) | fail* (1344.86) |
| `lto` | 1 | 1532 | 4072 | 4600 | 1725.85 |
| `lto` | 2 | 1064 | 2775 | 3200 | 1745.57 |
| `lto` | 4 | 1263 | 2629 | 3100 | 1820.45 |
| `lto` | 8 | 2645 | 3888 | 4400 | 1987.48 |
| `lto` | default | 4022 | 5338 | 5800 | 2330.77 |
| `simd` | 1 | 1588 | 4136 | 4600 | 1709.34 |
| `simd` | 2 | 1139 | 2849 | 3300 | 1784.58 |
| `simd` | 4 | 1277 | 2632 | 3100 | 1853.89 |
| `simd` | 8 | 2040 | 3243 | 3700 | 1954.56 |
| `simd` | default | 3982 | 5222 | 5700 | 2326.56 |
| `lto_simd` | 1 | 1535 | 4048 | 4500 | 1742.85 |
| `lto_simd` | 2 | 1081 | 2745 | 3200 | 1751.57 |
| `lto_simd` | 4 | 1253 | 2592 | 3100 | 1820.24 |
| `lto_simd` | 8 | 2574 | 3792 | 4300 | 1934.81 |
| `lto_simd` | default | 3991 | 5163 | 5700 | 2322.21 |
| `native` | 1 | - | - | 2900 (net 2700) | 258.52 |
| `native` | 2 | - | - | 1700 (net 1500) | 274.49 |
| `native` | 4 | - | - | 1200 (net 1000) | 276.56 |
| `native` | 8 | - | - | 900 (net 700) | 288.72 |
| `native` | default | - | - | 700 (net 500) | 332.51 |

*\*Note on `mimalloc_stack1mb` at default threads*: Run 1 crashed with `RuntimeError: memory access out of bounds`. This was originally suspected to be pthread stack overflow on a 1 MB stack, but the identical crash also reproduced with 8 MB stacks; the actual cause was intermittent memory corruption inside oneTBB's `tbbmalloc`. Runs 2 and 3 succeeded (medians shown in parentheses).

---

## 4. Matrix 2: Cross-Model Benchmark

- **Best WASM Variant from Matrix 1**: **`mimalloc_poolhw`** (lowest median process wall time: **1500 ms** at `default` threads).
- **Models**:
  1. `20mm_cube`: `tests/data/20mm_cube.obj`
  2. `extruder_idler`: `tests/data/extruder_idler.obj`
  3. `frog_legs`: `tests/data/frog_legs.obj`
  4. `3DBenchy`: `wasm/build/bench/models/3DBenchy.stl`

| Model | Variant | Threads | Slice ms | Driver Total ms | Process Wall ms | Peak RSS MB | Ratio (WASM / Native) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `20mm_cube` | `base` | 1 | 76 | 232 | 1100 | 1597.10 | 3.67x |
| `20mm_cube` | `base` | default | 285 | 452 | 1100 | 2220.20 | 3.67x |
| `20mm_cube` | `mimalloc_poolhw` | 1 | 71 | 236 | 1000 | 859.87 | 3.33x |
| `20mm_cube` | `mimalloc_poolhw` | default | 120 | 288 | 1000 | 1243.88 | 3.33x |
| `20mm_cube` | `native` | default | - | - | 300 (net 100) | 189.67 | 1.00x |
| `extruder_idler` | `base` | 1 | 573 | 2539 | 3000 | 1629.60 | 7.50x |
| `extruder_idler` | `base` | default | 1846 | 2331 | 2800 | 2136.62 | 7.00x |
| `extruder_idler` | `mimalloc_poolhw` | 1 | 528 | 2477 | 2700 | 968.59 | 6.75x |
| `extruder_idler` | `mimalloc_poolhw` | default | 265 | 605 | 1100 | 1362.03 | 2.75x |
| `extruder_idler` | `native` | default | - | - | 400 (net 200) | 213.40 | 1.00x |
| `frog_legs` | `base` | 1 | 393 | 1543 | 2000 | 1631.64 | 5.00x |
| `frog_legs` | `base` | default | 620 | 908 | 1400 | 2114.45 | 3.50x |
| `frog_legs` | `mimalloc_poolhw` | 1 | 378 | 1525 | 1800 | 957.80 | 4.50x |
| `frog_legs` | `mimalloc_poolhw` | default | 224 | 472 | 1000 | 1210.69 | 2.50x |
| `frog_legs` | `native` | default | - | - | 400 (net 200) | 232.32 | 1.00x |
| `3DBenchy` | `base` | 1 | 1603 | 4184 | 4600 | 1698.33 | 5.75x |
| `3DBenchy` | `base` | default | 3928 | 5186 | 5700 | 2283.26 | 7.12x |
| `3DBenchy` | `mimalloc_poolhw` | 1 | 1501 | 4037 | 4300 | 1048.38 | 5.38x |
| `3DBenchy` | `mimalloc_poolhw` | default | 461 | 1242 | 1500 | 1470.04 | 1.88x |
| `3DBenchy` | `native` | default | - | - | 800 (net 600) | 335.44 | 1.00x |

---

## 5. Parity Results

All WASM output G-code files were verified with `bash wasm/spike/compare_gcode.sh`:
- **Matrix 1 (3DBenchy)**: All 40 configurations across all 8 variants and 5 thread counts were compared against `matrix1_3DBenchy_base_t1.gcode`.
  - **Status**: **100% PASS** (40/40 identical, exit code 0, 0 differing lines).
- **Matrix 2 (20mm_cube)**: All 4 configurations (`base` t1/default, `mimalloc_poolhw` t1/default) compared against `wasm/build/p6_cube.gcode` (golden parity file).
  - **Status**: **100% PASS** (4/4 identical, exit code 0, 0 differing lines).
- **Matrix 2 (extruder_idler)**: Compared against `matrix2_extruder_idler_base_t1.gcode`.
  - **Status**: **100% PASS** (4/4 identical, exit code 0).
- **Matrix 2 (frog_legs)**: Compared against `matrix2_frog_legs_base_t1.gcode`.
  - **Status**: **100% PASS** (4/4 identical, exit code 0).

**Parity Failures**: **0**.

---

## 6. Observations

1. **Thread Scaling Contention**: Variants using `dlmalloc` (`base`, `dlmalloc_poolhw`, `lto`, `simd`, `lto_simd`) hit severe thread lock contention beyond 2-4 threads on this 32-core machine, regressing 3DBenchy slicing time from ~1065 ms at 2 threads to ~3984 ms at default threads (~3.7x slowdown).
2. **Allocator Impact (`mimalloc` vs `dlmalloc`)**: Switching to `mimalloc` eliminates allocator contention entirely. Slicing scales cleanly from 1500 ms (t=1) down to 456 ms (t=8) and 467 ms (default), giving an 8.5x slicing speedup over `base` at default threads.
3. **Pthread Pool Sizing**: Pre-allocating the worker pool to hardware concurrency (`mimalloc_poolhw`) eliminates worker spawn and resizing latency during execution, reducing total driver time to 1259 ms and process wall time to 1500 ms on 3DBenchy.
4. **Stack Size and Allocator Failure**: The run 1 crash on `mimalloc_stack1mb` was originally attributed to stack overflow, but investigation confirmed the identical crash also occurred with 8 MB stacks, tracing instead to `tbbmalloc` (see Section 8). An 8 MB stack remains the standard, robust default configuration for OrcaSlicer's geometry and recursive slicing workloads.
5. **LTO and SIMD**: `-flto` and `-msimd128` provide modest improvements (~3.5% faster slicing single-threaded), but because existing builds use `dlmalloc`, multi-threaded scaling remains bottlenecked by allocator contention.
6. **Memory Footprint**: `mimalloc` slashes peak RSS compared to `dlmalloc`: at 1 thread, RSS drops from 1761 MB (`base`) to 700 MB (`mimalloc`), a 60% memory reduction. Native Linux runs in 190–335 MB RSS.

---

## 7. Recommendation

Applied (see Section 8, "Final build"):
- **Allocator**: `-sMALLOC=mimalloc`, plus the tbbmalloc shim. This is the change that matters: 3DBenchy at default threads goes from 5.7 s to 1.5 s wall and from 2.2 GB to 1.3 GB peak RSS.
- **Pool size**: kept at 8. `mimalloc_poolhw` was about 0.1 s faster at default threads but used about 330 MB more RSS at every thread count, and in a browser it starts one Worker per core at load time.
- **Stacks**: kept at 8 MB. 1 MB did not reduce RSS measurably, and oneTBB sets its own 4 MB stack for worker threads on 64-bit anyway.
- **LTO / SIMD**: not applied. At most 3.5% faster single-threaded slicing, no wall-time gain, and a 5% larger download.
- **Thread count**: 8 threads is as fast as 32 here (1.5 s) with about 470 MB less RSS. The web engine API should default to `min(navigator.hardwareConcurrency, 8)` and let the user change it.

Native Linux x86_64 numbers are for speed and memory only. Its G-code differs from WASM and from native macOS (different C++ standard library), so parity is checked against native macOS x86_64.

---

## 8. Allocator Crash and Fix

### Background and Diagnosis
During stability testing, multithreaded slicing on 3DBenchy with default threads crashed in approximately 1 out of 40 runs with `RuntimeError: memory access out of bounds` (specifically, 3 crashes captured across 80 debug runs plus 1 crash in the benchmark suite).

With function names preserved via `--profiling-funcs`, all captured crashes localized to the same call path inside oneTBB's memory allocator:
- `rml::internal::Backend::genericGetBlock`
- called from `scalable_malloc`
- called during `std::vector<Slic3r::Point, tbb::scalable_allocator>` reallocation / growth in `Slic3r::chain_lines_by_triangle_connectivity` on a TBB worker thread.

Because the crash reproduced identically with both 1 MB and 8 MB stack configurations, stack exhaustion was ruled out; oneTBB's `tbbmalloc` internals exhibit intermittent memory corruption under Emscripten pthreads.

### The Shim Fix
OrcaSlicer only requires `scalable_malloc` and `scalable_free` from `libtbbmalloc.a`, while oneTBB's core library (`libtbb`) weakly references `scalable_malloc`, `scalable_free`, `scalable_aligned_malloc`, and `scalable_aligned_free`.

To eliminate `tbbmalloc` code entirely:
1. Created `wasm/deps/tbbmalloc_shim.c`, implementing all `scalable_*` API functions (`scalable_malloc`, `scalable_free`, `scalable_realloc`, `scalable_calloc`, `scalable_posix_memalign`, `scalable_aligned_malloc`, `scalable_aligned_realloc`, `scalable_aligned_free`, `scalable_msize`, `scalable_allocation_mode`, `scalable_allocation_command`) by forwarding directly to the standard C allocator (`malloc`, `free`, `realloc`, `calloc`, `posix_memalign`, `malloc_usable_size`).
2. Updated `wasm/deps/build_tbb.sh` to compile `tbbmalloc_shim.c` and replace `$WASM_PREFIX/lib/libtbbmalloc.a` with an archive containing only the shim object.
3. Updated `wasm/spike/CMakeLists.txt` to link with `-sMALLOC=mimalloc`. Because `mimalloc` is already a thread-safe scalable allocator, forwarding `scalable_*` to standard C allocation directs all allocations through `mimalloc` without running any `tbbmalloc` backend routines (`genericGetBlock`, `mallocLargeObject`).

### Crash Loop Verification
Post-fix verification was executed on the rebuilt binary:
- **3DBenchy** (`wasm/build/bench/models/3DBenchy.stl`) with default threads: **80 sequential runs**, timeout 120s: **0 failures** (80/80 passed).
- **extruder_idler** (`tests/data/extruder_idler.obj`) with default threads: **20 sequential runs**, timeout 120s: **0 failures** (20/20 passed).

### Final Build

Applied link flags:
```
-sMEMORY64=1 -pthread -fwasm-exceptions -O2 -Wall -O3 -DNDEBUG -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=8GB -sMALLOC=mimalloc -sPROXY_TO_PTHREAD -sEXIT_RUNTIME=1 -sPTHREAD_POOL_SIZE=8 -sNODERAWFS=1 -sSTACK_SIZE=8MB -sDEFAULT_PTHREAD_STACK_SIZE=8MB
```

Timing for final build on 3DBenchy (medians across 3 runs, measured with `/usr/bin/time -f "%e %M"`):

| Threads | Slice ms | Driver Total ms | Process Wall ms | Peak RSS MB |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 1420 | 3914 | 4040 | 665.30 |
| 8 | 460 | 1372 | 1510 | 824.08 |
| default | 525 | 1322 | 1470 | 1297.35 |

---

## 9. Browser (Phase 1 engine)

### Environment and Versions
- **Node.js**: v24.21.0
- **Chromium**: 153.0.8010.12 (headless shell, no experimental flags)
- **Firefox**: 155.0 (headless, standard default preferences)
- **Model**: `wasm/build/bench/models/3DBenchy.stl`
- **Presets**: Voron 2.4 300 0.4 nozzle, 0.20mm Standard @Voron, Generic PLA @System
- **Methodology**: Fresh isolated instance per configuration, static server on port 5057 (COOP/COEP enabled), 3 slices per instance. Node runs through `wasm/web/engine-core.js`; browsers run through `wasm/web/orca-engine.js` (Web Worker). All slice measurements reflect the complete `slice()` operation (C++ `print.process()` + `print.export_gcode()` + MEMFS G-code retrieval). RSS sampled every 100 ms across the entire process tree (`/proc/<pid>/status` `VmRSS` summed across parent and all descendant threads/processes).

### Benchmark Results

| Browser | Threads | Create ms | LoadVendors ms | First slice ms | Median slice ms | Peak RSS delta MB | Peak RSS MB |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `node` | 1 | 108 | 250 | 3569 | 3374 | 1044.48 | 1170.54 |
| `node` | 4 | 109 | 268 | 1306 | 1093 | 1175.22 | 1301.09 |
| `node` | 8 | 112 | 244 | 982 | 789 | 1237.44 | 1363.42 |
| `node` | default | 103 | 246 | 996 | 788 | 1158.96 | 1285.35 |
| `chromium` | 1 | 86 | 220 | 3604 | 3345 | 378.51 | 1264.09 |
| `chromium` | 4 | 91 | 196 | 1310 | 1079 | 380.70 | 1298.24 |
| `chromium` | 8 | 80 | 199 | 1067 | 790 | 421.33 | 1325.66 |
| `chromium` | default | 76 | 210 | 1050 | 776 | 422.75 | 1334.48 |
| `firefox` | 1 | 97 | 228 | 3529 | 3429 | 539.63 | 1688.61 |
| `firefox` | 4 | 109 | 235 | 1202 | 1098 | 598.76 | 1744.11 |
| `firefox` | 8 | 102 | 251 | 879 | 794 | 633.21 | 1785.45 |
| `firefox` | default | 100 | 243 | 861 | 812 | 673.39 | 1826.09 |

### Parity Verification
Generated G-code from each environment was compared against `wasm/build/bench/p7/gcode/matrix1_3DBenchy_base_t1.gcode` via `bash wasm/spike/compare_gcode.sh`:
- **Node** (`wasm/build/tests-browser/node_benchy.gcode`): **Exit code 0** (PASS, 0 differing normalized lines).
- **Chromium** (`wasm/build/tests-browser/chromium_benchy.gcode`): **Exit code 0** (PASS, 0 differing normalized lines).
- **Firefox** (`wasm/build/tests-browser/firefox_benchy.gcode`): **Exit code 0** (PASS, 0 differing normalized lines).

### Comparisons

- **Browser vs Node.js (Same measurement)**:
  - Both measure the full `slice()` pipeline through JavaScript: C++ slicing, G-code export, and G-code file retrieval from MEMFS.
  - Across all thread configurations, browser and Node slice timings are virtually identical:
    - 1 thread: Node median 3374 ms vs Chromium 3345 ms vs Firefox 3429 ms.
    - 4 threads: Node median 1093 ms vs Chromium 1079 ms vs Firefox 1098 ms.
    - 8 threads: Node median 789 ms vs Chromium 790 ms vs Firefox 794 ms.
    - Default threads: Node median 788 ms vs Chromium 776 ms vs Firefox 812 ms.
  - Scaling is consistent across environments: slicing scales ~4.2x–4.3x faster from 1 thread (~3.4 s) to 8 threads (~0.78–0.81 s). Default threads matches 8 threads as expected from the `min(hardwareConcurrency, 8)` cap.

- **Comparison to Native Net Time**:
  - Native Linux x86_64 AppRun wall time is 0.7 s (700 ms) at default threads, with about 0.2 s (200 ms) being process startup overhead, so net slicing and export time is about 0.5 s (500 ms).
  - WebAssembly warm median slice time at default threads is 0.78 s (776 ms) in Chromium, 0.81 s (812 ms) in Firefox, and 0.79 s (788 ms) in Node.
  - Compared like-for-like to native net time (~0.5 s), WASM browser slice time is ~1.55x native net in Chromium and ~1.62x native net in Firefox.
  - Note: Comparing WASM warm slice time (0.78–0.81 s) directly to total native process wall time (0.7 s) yields ~1.11x–1.16x, but this is not like-for-like because native process wall includes binary load and dynamic linking overhead while the WASM worker is already initialized.
