# Installed original Orca / actual Helium slicing performance — 2026-11-08

The bracket exposes two costs: first-use work inside slicing, and slower warm geometry processing. Warm fresh recomputation reduces web region time from a fresh-app median **225.8 ms** to **85.1 ms**, versus installed-original **40.8 ms**. No optimization implemented. Executable G-code agreement with the original remains a separate acceptance requirement from speed.

## Successful measurements

Milliseconds, median [minimum–maximum], three measured trials. Fresh-app trial 0 and same-session pass 0 are excluded warmups. A fresh-app warmup does **not** warm subsequent independent browser instances; the same-session control is needed to measure warmed execution. Every same-session pass re-imports the same saved project through the normal input, slices and exports; `Engine.cpp:2920` constructs a new local `Slic3r::Print` per slice. These are recomputations, not a second click returning an already sliced result.

| Actual workflow | Source-aligned slicing region | Entire web process call |
|---|---:|---:|
| Installed original, fresh process/default | 40.8 [40.1–43.5] | not probed |
| Helium, fresh app/Auto (8) | 225.8 [224.7–242.4] | 228.9 [227.9–245.4] |
| Helium, same app/Auto (8), fresh project each pass | 85.1 [81.7–87.7] | 85.3 [81.9–88.1] |
| Helium, fresh app/1 thread | 650.5 [638.6–725.2] | 653.3 [640.8–728.4] |
| Helium, same app/1 thread, fresh project each pass | 546.1 [529.1–560.8] | 546.4 [529.4–561.1] |
| Helium, same app/16 threads, fresh project each pass | 66.7 [59.3–100.4] | 68.3 [59.6–100.7] |

First same-session slices: Auto 222.1 ms, one thread 645.2 ms, sixteen threads 269.3 ms. Sixteen is the UI's available upper control because twelve is unavailable. It has a slower first slice and a broad warm range; this does **not** establish an erroneous default cap or justify changing the default from eight. No tree trial was needed: the smallest bracket already discriminates warming and concurrency clearly.

Stage elapsed-time medians (independent medians need not sum to the total):

| Region | Fresh app Auto | Warm Auto | Warm 1 | Warm 16 |
|---|---:|---:|---:|---:|
| slice geometry | 24.6 | 3.9 | 12.5 | 4.2 |
| perimeters | 90.2 | 36.1 | 263.1 | 22.2 |
| prepare infill | 50.4 | 18.0 | 101.0 | 13.5 |
| infill | 32.1 | 22.8 | 151.9 | 16.8 |
| remaining process work | 29.9 | 3.7 | 17.6 | 4.3 |

Fresh-app `Print::process` work outside the aligned markers is approximately 3 ms; warm Auto it is 0.2–0.4 ms. This boundary mismatch cannot explain the historical roughly 200 ms web result. The much larger fresh-versus-warm difference occurs **inside** the slicing region, after initialization/import. It must not be relabelled as file import or application initialization time.

## Ranked findings and next experiment

1. **First-use work is a major cost.** Auto's same-session first slice is 222.1 ms and its next three fresh recomputations are 81.7–87.7 ms. One-thread warming also helps, but much less. This supports a combination of code/runtime warming and parallel-runtime first use; it does not separately measure V8 tier-up, WASM compilation, TBB worker startup or allocator warming. No assertion that all of this is pthread startup is warranted.
2. **Warm perimeter and infill algorithms dominate.** Warm Auto spends 36.1 ms in perimeters, 22.8 ms in infill and 18.0 ms preparing infill. A separate symbol-mapped full-app worker profile identifies Arachne wall generation, Voronoi predicates/extended-integer arithmetic, Clipper execution and `FillMonotonic::fill_surface` under `Print::process` ancestry. These are concrete follow-up targets, not proof of which primitive causes the native/WASM gap. No native stage profile was collected.
3. **Parallelism helps; extra workers have a tradeoff.** One thread is substantially slower. Sixteen improves the warm median but is noisy and worsens the first slice. Native observation found 32 OS tasks, all accumulating CPU ticks during the separate complete invocation. Web `/proc` snapshots show eight DedicatedWorker tasks with large CPU deltas (one engine caller plus seven workers), and many other parked workers. These observations establish actual task activity outside the timed trials; they do not prove 32 native workers execute simultaneously inside the 40 ms region. Do not equate configured arena size, preloaded workers, logical cores and active slice workers.
4. **Over-invalidation and codegen claims remain unproven.** Reimport/new-Print controls intentionally require full recomputation. There is no evidence here that web does extra invalidation relative to native. O3/NDEBUG rules out a simple debug-build explanation. WASM64/BigInt bridges, atomic operations, exceptions and memory-growth overhead have not been isolated by an output-invariant A/B test.

The smallest concrete optimization **candidate to test** is pre-initializing the requested TBB arena with a small parallel workload before the first user Slice, retaining that arena/runtime. Hold input and effective thread count fixed. This is a diagnostic candidate for the measured first-use penalty, not an implemented fix or a claim that it warms geometry code. Record initialization cost as well as first-slice and warmed-slice costs so moving work across a timer is visible. Accept it only if three fresh-app trials improve the aligned first-slice region without regressing total initialization-plus-first-slice work or warmed slicing, and every export has the same executable-command hash and effective configuration as the baseline. If it fails, investigate WASM tier-up separately rather than broadening the warmup speculatively. The residual warm gap remains open; original speed is not promised.

## Profile limits and output invariance

`profile-auto` and `profile-symbols` are excluded from timing statistics. Profiling substantially perturbs elapsed time. The latter uses a separate relink with `--emit-symbol-map`; its WASM hash differs, so its symbol map is used only for its own profiles. All-worker profiles cover the normal Slice operation, which also exports internally. They include parked futex waits and sequential profiler stop overhead. Summing their sample weights is **not** slicing CPU time. `profile-summary.mjs` filters executing-thread ancestry through `Print::process(long long*, bool)` to exclude export for that subset; worker tasks lack the caller's ancestry, so those samples cannot supply a complete slice-only CPU percentage. The 340 ms of ancestry-filtered sample weight includes waits and profiling overhead. `emscripten_futex_wait` dominates the all-worker view, not evidence that it consumes 32 seconds of CPU. The prominent all-worker ray-intersection sample is excluded from slice-hotspot attribution because it may include export work.

All 26 completed instrumented exports, including initial exploratory runs, timing controls and both profiling variants, match the frozen baseline bracket in executable-command hash and every exported configuration field. Raw G-code is retained beside each event log; whole-file equality is not required because timestamps/thumbnails vary. The four new native exports share one executable hash; it still differs from web. Output invariance of an experiment does **not** establish original executable-G-code parity.

Canonical evidence: `summary.json`, `profile-named-summary.json`, `profile-auto/task-deltas.json`, `native-observe/tasks.json`, per-run G-code/event/log files, and retained compile/link commands. Comparator self-checks and harness syntax checks pass; copied Print TU compilation and both links pass. No deployment, commit, push, PR, README/KNOWLEDGE change or Taproot update was made by this task.

## Scope and measurement boundary

Evidence root: `wasm/build/slicing-performance-20261108` (ignored). All web experiments use the full frozen app, headed `/opt/helium/helium`, normal project input, Slice Plate 1 and File → Export G-code. Input is the established `wasm/build/sample-parity-cause-20261107/ui-project/input.3mf`; installed original loads that same project with `--arrange 0 --orient 0`. No synthetic engine page is used.

Native uses the existing `helium-ui/log-probe.so` file-buffer insertion interposer and CLOCK_MONOTONIC timestamps, before buffered disk writes. Web copies `Print.cpp`, adds steady-clock reads at the corresponding start/finish log statements, compiles only that copied TU, replaces its archive member in a private archive, and links existing dependency objects. Product sources remain untouched. Engine.cpp's existing benchmark object separately supplies full-call time. Initialization, import, preset loading, arrangement, export, preview and download are excluded from the region timer.

`Print.original.cpp` is extracted using `git show 40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19:src/libslic3r/Print.cpp`. Its `Print::process` source matches the checkout exactly; the file's only differences concern `export_gcode`, outside this timer. This establishes source-location equivalence across these binaries, not compiler or machine-instruction equivalence. The native timestamps include log expression evaluation immediately before the finish insertion; web info logging is compiled out. Native prologue before the first marker and epilogue after the last marker are excluded. Do not treat the historical whole-call web/native columns as exact speed ratios.

Four cumulative checkpoints follow `slice`, `make_perimeters`, `prepare_infill` and `infill`; subtraction yields stage elapsed times. They include called work and scheduling, not exclusively CPU execution. Checkpoints use clock reads only; their single diagnostic output occurs after the end timestamp. The bracket contains one object; this fixed checkpoint buffer is diagnostic instrumentation for that input only.

## Controls and constraints

All compilation/linking, timing batches and CPU profiling acquire exclusive `/tmp/weborca-parity-benchmark.lock`. Other desktop verification held this lock for roughly ten minutes; queued time is excluded. Background user services remain running. Host load averages were 3.54/3.07/2.92 initially and 7.11/6.96/5.52 after final analysis; CPU frequency and affinity are uncontrolled. These short, sequential batches do not eliminate host-load drift, especially for the noisy sixteen-thread control.

The current Helium reports Chromium 156.0.8078.79 and hardwareConcurrency=14 in the initial aligned run; previous runs reported 12. Record per-run browser metadata rather than assuming this value is fixed. Preferences offers Auto, 1, 2, 4, 8 and 16, with Auto capped at eight. A requested 12-thread selection is unavailable through this UI and produced no slicing measurement. It is excluded.

The initial `web-*` batch began with shipped-engine links retained in a read-only copied asset directory. That batch is excluded from final timing statistics. The links were corrected; `aligned-default-0` recorded an aligned-region warmup of 226.900 ms. `aligned-default-1` hit the private server login rate limit and is excluded. The private benchmark server was restarted before `final-*`. Private app state and browser profiles must not be published.

An inherited link command initially retained its historical benchmark output destination. That ignored benchmark engine pair was restored with its original retained link command before the final batches; `restore-link.log` records the restoration. Subsequent link commands use this task's own destinations. Product/frozen candidate assets were untouched.

Input SHA256: `a010c0e496d57b5e7259d452493b4ef52caabcef9e399e321b0cd3c4b022a6cc`. Frozen shipped WASM: `452c0ab51a0b935f691384e629d73ad0005fda99733b059d18cc600c0d4c1f19`. Region-instrumented WASM: `d182f0a2572fac38e70ead91270b165da057dd8952963cf8b1dabf491567f069`. Symbol-map profile WASM: `40214bf5e57a5ba63cd9638462ff0298cfb7c06d0bace1212e4b91742e9cc2a9`. Installed original binary remains `9c42194b612e85b29ec269124d8f1b83d768f3e8a3dfdfb65e26625942e947cc`, manifest source commit `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`. Helium binary reports 0.20.3.1 / Chromium 156.0.8078.79; successful per-run hardwareConcurrency varies between 12 and 14.

## Build inspection

TU compilation contains `-sMEMORY64=1 -pthread -fwasm-exceptions -O2 ... -O3 -DNDEBUG`; the effective optimization is O3, Release, assertions disabled. Engine.cpp's retained benchmark object ends in `-Oz`. Link uses O3, WASM exceptions, MEMORY64, mimalloc, growing memory with 8 GB maximum, 8 MB stacks, and a generated pthread pool of `min(hardwareConcurrency,8)+2`. This does not establish all historical object provenance. Web dispatch enters `tbb::task_arena(threads).execute(do_slice_body)`; both sides use TBB, so describing web as serial or as lacking TBB would be wrong. Pool capacity does not prove actual worker activity.

Linker warns that pthreads plus growing memory may slow non-WASM code. This warning alone is not a measured bottleneck. WASM64 pointer/atomic overhead, hot geometry algorithms, scheduling and startup must be discriminated by measurements; none justifies promising original speed.

## Reproduction

Paths below are relative to `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`. Retained ignored artifacts include copied source, compile/link commands and logs, immutable engine pair, UI driver, native batch and separate observation harness. Never rerun into an evidence destination without archiving it first.

```sh
bash -n wasm/build/slicing-performance-20261108/native.sh
node --check wasm/build/slicing-performance-20261108/driver.mjs
node --check wasm/build/slicing-performance-20261108/observe-native.mjs
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/slicing-performance-20261108/native.sh
# Start serve.sh with the existing private alpha configuration, then:
flock /tmp/weborca-parity-benchmark.lock env \
  OUT="$PWD/wasm/build/slicing-performance-20261108/reproduction" \
  APP_URL=http://localhost:5093 THREADS=auto SAMPLE=bracket.3mf \
  INPUT_PATH="$PWD/wasm/build/sample-parity-cause-20261107/ui-project/input.3mf" \
  node wasm/build/slicing-performance-20261108/driver.mjs
```

Use one excluded warmup followed by three fresh app/project recomputations per setting. `PROFILE=1` is a separate run, excluded from timing; it enables worker DevTools profiles and `/proc` task snapshots. The native observer is also separate from timed trials.

Set `REPEAT=4` for the same-session control (pass 0 excluded). Set `THREADS=1` or `THREADS=16` for the two explicit UI controls. To reproduce the symbol profile, point only the private app root's engine-pair links at `symbols/` and use `PROFILE=1`, then restore them to `engine/`. Run `node wasm/build/slicing-performance-20261108/summarize.mjs` and `node wasm/build/slicing-performance-20261108/profile-summary.mjs` only after timing/profiling batches finish. The latter always reads the symbol artifact's own map and profiles. To rebuild copied instrumentation, run retained `compile.sh` and then `link.sh` from `wasm/build/orca-v250-wasm64` under the lock; the private archive contains the compiled Print member. Replacing instrumentation source requires rebuilding that archive member with emar before linking. `link-symbols.sh` adds only symbol-map emission for the separate profiling variant.
