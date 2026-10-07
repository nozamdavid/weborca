# WebAssembly vs Native Slicing Engine Benchmark

> Superseded by [PERF.md](PERF.md) (Linux x86_64, after the allocator fix). These are the first Mac M4 Pro numbers, kept for history.

## Environment

- **CPU**: Apple M4 Pro
- **Logical Cores (`hw.ncpu`)**: 12
- **Node version**: v24.19.0
- **emsdk version**: 6.0.11
- **Native binary**: `/tmp/orca-native/OrcaSlicer.app/Contents/MacOS/OrcaSlicer` (v2.5.0-dev nightly)
- **WASM driver**: `wasm/build/orca-wasm64/wasm/spike/orca_slice_driver.js`
- **Native startup overhead**: 0.15 s (measured minimum of 3 runs on tiny 1-layer cube)

---

## 1. Per-Model Benchmark (Default Threads)

Each measurement is run 3 times; values shown are the minimum across runs.

| Model | Native Wall (min) | Native Net (-0.15s) | WASM Slicing (min) | WASM Total (min) | Ratio (WASM Total / Native Wall) | Ratio (WASM Slicing / Native Net) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `20mm_cube.obj` | 0.16 s | 0.01 s | 256 ms | 442 ms | 2.76x | 25.60x |
| `extruder_idler.obj` | 0.39 s | 0.24 s | 1855 ms | 2417 ms | 6.20x | 7.73x |
| `frog_legs.obj` | 0.30 s | 0.15 s | 695 ms | 1042 ms | 3.47x | 4.63x |
| `3DBenchy.stl` | 0.78 s | 0.63 s | 4077 ms | 5415 ms | 6.94x | 6.47x |

### Run Details (3 Runs)

- **`20mm_cube.obj`**:
  - Native wall times: 0.16 s, 0.17 s, 0.17 s (min: 0.16 s)
  - WASM (Slicing / Total): 266 / 474 ms, 256 / 442 ms, 260 / 448 ms (min: 256 / 442 ms)
- **`extruder_idler.obj`**:
  - Native wall times: 0.41 s, 0.39 s, 0.39 s (min: 0.39 s)
  - WASM (Slicing / Total): 1902 / 2487 ms, 1855 / 2417 ms, 1878 / 2430 ms (min: 1855 / 2417 ms)
- **`frog_legs.obj`**:
  - Native wall times: 0.31 s, 0.30 s, 0.30 s (min: 0.30 s)
  - WASM (Slicing / Total): 689 / 1064 ms, 711 / 1067 ms, 695 / 1042 ms (min: 695 / 1042 ms)
- **`3DBenchy.stl`**:
  - Native wall times: 0.81 s, 0.78 s, 0.78 s (min: 0.78 s)
  - WASM (Slicing / Total): 4090 / 5415 ms, 4201 / 5639 ms, 4077 / 5418 ms (min: 4077 / 5415 ms)

---

## 2. Thread Scaling (3DBenchy WASM)

| Threads | Run 1 (Slicing / Total) | Run 2 (Slicing / Total) | Run 3 (Slicing / Total) | Min Slicing | Min Total |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | 1699 / 3999 ms | 1660 / 3979 ms | 1704 / 4064 ms | 1660 ms | 3979 ms |
| **2** | 1160 / 2798 ms | 1492 / 3162 ms | 1160 / 2956 ms | 1160 ms | 2798 ms |
| **4** | 2156 / 3742 ms | 2170 / 3633 ms | 1818 / 3159 ms | 1818 ms | 3159 ms |
| **8** | 3728 / 5058 ms | 3679 / 5009 ms | 3744 / 5194 ms | 3679 ms | 5009 ms |

*Note: Slicing scales best at 2 threads (1.43x speedup in slicing step over 1 thread). At higher thread counts (4 and 8), synchronization overhead between Emscripten Web Worker pthreads and memory barriers increases on Node.js.*

---

## 3. Peak Memory (3DBenchy WASM)

Measured using `/usr/bin/time -l` (maximum resident set size) over 3 runs:

| Run | Max RSS (bytes) | Max RSS (MB) |
| :--- | :--- | :--- |
| **Run 1** | 2,196,029,440 | 2094.29 MB |
| **Run 2** | 2,181,201,920 | 2080.15 MB |
| **Run 3** | 2,202,451,968 | 2100.42 MB |
| **Min Peak RSS** | **2,181,201,920** | **2080.15 MB** |

---

## 4. G-code Comparison (`compare_gcode.sh`)

| Model | Layers (Native / WASM) | G1 Moves (Native / WASM) | Extrusion (Native / WASM) | Exit Code |
| :--- | :--- | :--- | :--- | :--- |
| `20mm_cube.obj` | 100 / 100 | 9064 / 9091 | 1305.1783 / 1304.9417 | 2 |
| `extruder_idler.obj` | 190 / 190 | 51175 / 51161 | 1574.3466 / 1574.3654 | 2 |
| `frog_legs.obj` | 10 / 10 | 22023 / 22037 | 470.6321 / 467.9648 | 2 |
| `3DBenchy.stl` | 240 / 240 | 152115 / 151567 | 3882.8390 / 3883.2033 | 2 |
