# Native and WASM slicing phase profile

November 26, 2026. Both runtimes built from commit `30b4ad83bc`. Raw samples, drivers and logs are in the ignored `wasm/build/fresh-slicing-20261126/phase-timers/` directory.

## Method

The same instrumented `Print.cpp` is used for both runtimes. It adds 38 chrono laps and one `fprintf` to `Print::process()` and removes nothing; the diff against the frozen `30b4ad83bc` copy is additions only. Native links a clean Release archive from `native-current` with exactly one member replaced, the instrumented `Print.cpp.o`, verified by extracting it back and comparing bytes. A second driver links the untouched archive and produces identical executable G-code on all three fixtures, so the instrumentation is behavior-neutral.

Both arms use the same fixture inputs. H2C executable G-code matches exactly. The two Voron fixtures have 18 and 31 differing G/M/T lines, detailed under "Cross-runtime output" below.

Both runtimes request 4 threads. Native runs `tbb::task_arena(4)`. Every sample is taken under the shared `/tmp/weborca-parity-benchmark.lock`.

**Process lifetimes differ between arms.** The Node WASM arm reuses one engine core across its samples, so its first row pays first-use cost and later rows inherit warmth. Every native sample uses a fresh process and may pay first-use costs within the measured phases. Process startup is outside the timed region. The first row of each arm is excluded (WASM warm-up, native run 0). The retained samples compare five fresh native processes with three warm WASM samples per fixture.

**Timed window.** `PRINT_PHASE_TIMES` covers `Print::process()` only. `Print::export_gcode()` runs after it and is timed separately in the native driver. Export is excluded from the phase comparison, and on this host it is the larger part of a slice.

## Matched run

One serialized 73-second lock session ran from 17:55:36 to 17:56:49 UTC on a 32-CPU host. All six batches (three WASM, three native) ran inside this session. Host load rose from 3.46 to 5.24, so the session does not establish equal host conditions across batches. This replaces an earlier pair of batches where the WASM arm ran at load 20–24 and the native arm at 7–9. Those earlier numbers are not used here.

Native values are medians of 5 fresh-process samples and WASM values are medians of 3 warm samples. All times below are milliseconds.

| phase | Benchy native | Benchy WASM | supports native | supports WASM | h2c native | h2c WASM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| total | 318.7 | 356.7 | 1641.0 | 1891.8 | 8.6 | 16.4 |
| mesh slice | 69.1 | 65.6 | 272.4 | 255.8 | 0.7 | 1.5 |
| walls | 123.2 | 137.9 | 501.6 | 542.5 | 1.5 | 3.5 |
| prepare infill | 63.1 | 78.1 | 249.4 | 312.6 | 1.2 | 2.6 |
| infill | 41.0 | 47.4 | 166.4 | 191.5 | 1.3 | 2.5 |
| support material | 11.9 | 15.5 | 303.1 | 395.6 | 0.3 | 0.7 |
| object other | 2.8 | 3.8 | 11.2 | 15.0 | 0.1 | 0.2 |
| tool order | 0.9 | 1.6 | 2.9 | 5.3 | 0.7 | 1.6 |
| skirt and brim | 3.6 | 3.9 | 62.2 | 74.6 | 0.1 | 0.1 |
| finalize | 1.3 | 2.2 | 72.2 | 86.8 | 2.8 | 3.4 |

WASM over native, totals: 1.12× on Benchy, 1.15× on supports, 1.92× on h2c.

## Where the time goes

Within `process()`, the order is the same in both runtimes and on both plate sizes. Walls is the largest phase at 38.6% of Benchy in the native arm and 38.6% in the WASM arm, and 30.6% and 28.7% of the support plate. Mesh slicing, prepare-infills and infill follow. Support material holds 18.5% of the support plate and 3.7% of Benchy, so it matters only where supports exist.

## The profiled half is the smaller half

Export is outside the phase laps and costs more than everything the timers cover:

| fixture | process (profiled) | export (unprofiled) | export share |
| --- | ---: | ---: | ---: |
| Benchy | 319 ms | 693 ms | 68.5% |
| supports | 1641 ms | 2979 ms | 64.5% |
| h2c | 9 ms | 37 ms | 81.2% |

A native fresh slice is roughly a third `process()` and two thirds `export_gcode()`. Optimizing against the phase table alone addresses 31% of the work. The WASM `slice` RPC calls `process()` then `export_gcode()` in the same order (`wasm/engine/Engine.cpp:3249`), so the equivalent split exists there; the engine does not currently return an export timing, so it is not measured for that runtime here.

## Per-phase ratio

The phase boundaries support directional comparisons within the shared session. Changing load and distinct process lifetimes limit attribution of the ratios. Values below are WASM over native.

| phase | Benchy | supports |
| --- | ---: | ---: |
| mesh slice | 0.95× | 0.94× |
| walls | 1.12× | 1.08× |
| infill | 1.15× | 1.15× |
| prepare infill | 1.24× | 1.25× |
| support material | 1.31× | 1.31× |
| object other | 1.35× | 1.34× |
| tool order | 1.81× | 1.79× |

Mesh slicing measured slightly lower in WASM at both sizes. Walls, prepare infill and infill measured 1.08–1.25× native time. Object other and tool order have larger relative ratios and together cost 5.4 ms on Benchy and 20.3 ms on the supported plate in WASM. H2C phases each took under 4 ms, making their ratios sensitive to small absolute changes.

The measured ratios span 0.94× to 1.81× across these phases. This single point at four requested threads does not establish scaling behavior or the cause of the runtime gap. A thread sweep with controlled process lifetimes and host load would be needed to investigate those causes.

## Cross-runtime output

Executable G-code, comments stripped:

| fixture | native | WASM | differing G/M/T commands |
| --- | --- | --- | --- |
| Benchy | `43e5d8fd…` | `96e88800…` | 18 |
| supports | `2c01ba22…` | `817ff637…` | 31 |
| h2c | `bc046f08…` | `bc046f08…` | 0 |

The h2c plate matches exactly. The two Voron fixtures differ in last-digit extrusion rounding (`.00887` against `.00888`), two travel coordinates by 0.001 mm, and one adjacent-line order swap. Their executable command streams therefore differ. Native output is identical across both native batches. These observations do not establish why the runtimes differ.

## Caveats

- Absolute times are for load 3.5–5.3 on a shared 32-CPU host, with 4 threads requested. They are not a speed benchmark; another delegate's build can change them.
- The export share is measured from the native driver only. WASM export is inside the slice RPC and untimed, so the two runtimes' export costs are not compared.
- Native samples use fresh processes and the WASM arm reuses a core. Process startup lands outside the phase laps. First-use costs within `Print::process()` can still affect both total and per-phase ratios.
- h2c completes in under 20 ms, so small absolute changes have a large effect on its ratios. This run does not isolate fixed overhead.

## Artifacts

- `phase-timers/matched/` — this session: `<fixture>.wasm.phases.log`, `<fixture>-<n>/{phases,driver,host,command.sha256}`.
- `phase-timers/wasm-batch-1720/` — the earlier load-confounded WASM batch, kept as a record of what was superseded.
- `phase-timers/runs/` — the first native batch at load 7.6–8.9, same output hashes.
- `phase-timers/native/{replay,replay-control}` — instrumented and control drivers.
- `node phase-timers/compare-matched.mjs` regenerates the tables above.
