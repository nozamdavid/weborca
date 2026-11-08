# First-slice TBB runtime experiment — 2026-11-08

The simple TBB preinitialization candidate fails the acceptance criterion. Its
first-slice median improves only 2.6 ms (1.1%), with overlapping ranges and one
slower trial; initialization plus first process is effectively unchanged.
Do not recommend this as a native-speed fix. No production patch, deployment,
commit or push was made.

## Results

Milliseconds, median [minimum–maximum], three measured trials per condition.

| Metric | Control | Small TBB preinit |
|---|---:|---:|
| Fresh first aligned region | 232.8 [223.0–239.2] | 230.2 [227.0–268.2] |
| Fresh full process | 235.4 [225.4–243.1] | 232.7 [229.5–270.9] |
| C++ engine initialization | 0.69 [0.65–0.74] | 2.49 [2.28–3.36] |
| Preinit subsection | 0.005 [0–0.005] | 1.74 [1.64–2.38] |
| C++ init + first aligned region | 233.525 [223.715–239.825] | 233.525 [229.310–270.655] |
| C++ init + first full process | 236.135 [226.070–243.725] | 236.075 [231.800–273.365] |
| Broader engine init RPC | 1269.8 [1255.1–1344.2] | 1330.8 [1263.6–1390.7] |
| Init RPC + first full process (supplemental) | 1505.1 [1498.1–1569.6] | 1563.5 [1493.1–1661.5] |
| Warm fresh-recompute aligned region | 99.8 [83.5–112.3] | 84.9 [82.6–87.6] |
| Warm fresh-recompute full process | 100.2 [83.7–112.6] | 85.2 [82.8–87.9] |

Fresh aligned trials in trial-number order are control 223.025, 239.180,
232.780 and variant 268.160, 230.160, 227.025 ms. Paired differences change
sign. The added initialization work absorbs essentially all the median process
benefit; the broader initialization metric is worse. The warmed variant is
within the established historical 81.7–87.7 ms range; this run's control is
noisier. These six warm recomputations do not establish a lasting warm speedup.
There is no consistent first-slice improvement and no overall gain established.

All **32** completed exports (16 final, including excluded preliminary and
pass-0 exports, plus 16 from the excluded earlier batch) match the shipped
baseline executable-command hash and every exported configuration field.
`harness/summary.json` records per-export command and canonical full-config
hashes, timing boundaries and comparisons. Executable hash:
`e0992f3ce802c0946f9da180c00ff16520c01637b13ad3c7142099f93f756734`.
Canonical full-config hash (all parsed exported key/value fields, sorted by
key and JSON encoded):
`ef26b1d6f9c71e475f74b99e8c87e0319b8ac5a2ecd0727c3a0f307f20f74d34`.
This preserves shipped behavior; the known executable-G-code difference from
installed original Orca remains unresolved. No native parity claim follows.

The smallest workload tested does not account for the important first-use
penalty. This does not exclude scheduler costs or prove which workers ran:
there was no worker-identity profile or persistent-arena variant. Geometry code
and WASM tier-up remain distinct hypotheses. No broader prewarm was attempted.
The next measured warm algorithm target is Arachne wall generation (previously
36.1 ms warm perimeters), followed by infill/FillMonotonic (22.8 ms) and prepare
infill (18.0 ms), using the existing process-ancestry profile to choose a narrow
output-invariant experiment. Native speed parity is not promised.

Final fresh-trial host one-minute load ranged 7.62–9.81; five-minute 8.76–9.17,
fifteen-minute 7.17–7.35. Background services, CPU frequency and affinity remain
uncontrolled. Load samples are before/after fresh trials in `final-load.log`;
warm-session load was not separately sampled. Helium Chromium is
156.0.8078.79; per-run `browser.json` records varying hardware concurrency
(e.g. control trial 1: 14, variant trial 1: 16). Auto remains capped at eight.
No comparator, profile or task-owned build ran concurrently with final timings.

Both affected copied Engine TU compiles, both private links, shell/JavaScript
syntax checks and the actual full-app project/Slice/Export workflows pass.
Private browser contexts close after each successful run; the isolated server
is stopped after the final batch. No changes to README, KNOWLEDGE, Taproot or
the other task's reports/product sources were made.

## Method

Evidence root: `wasm/build/first-slice-runtime-20261108` (ignored), relative to
`/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`.

Both conditions compile the same copied benchmark Engine.cpp, with
`FIRST_SLICE_PREINIT=0` or `1`. The variant creates an eight-thread TBB arena in
`op_init`, executes `parallel_for(0,64)` with 4,096 volatile unsigned integer
updates per task, then releases the local arena. This tests the smallest simple
preinitialization candidate; it does not retain an arena or establish that all
seven worker threads participated. No model, geometry, Print, slicing, or result
caching occurs in initialization. Slicing still constructs its original arena.

The exact previous Print-region instrumentation and slicing archive are copied
unchanged. Only the copied Engine TU is compiled twice, preserving its original
flags including final `-Oz`; private links use the copied archive and existing
dependency objects. No frontend build is needed. Original archives, product
sources, frozen app assets and earlier evidence destinations are preserved.

`harness/run-final.sh` holds exclusive `/tmp/weborca-parity-benchmark.lock` over
all timed runs. Trial order alternates control/variant and variant/control.
Trial 0 for each condition is excluded. Trials 1–3 each launch a fresh headed
`/opt/helium/helium` with a new temporary browser profile. The preliminary run is
a different application/JIT context and does not warm those first slices.
Each same-session condition separately imports the original saved 3MF four
times through the normal project input, slices and exports through the UI;
pass 0 is excluded. Each slice makes a new Print, forcing recomputation.

All runs use Auto/default eight threads and the readonly frozen full UI/profile
bundle. Input is `wasm/build/sample-parity-cause-20261107/ui-project/input.3mf`,
SHA256 `a010c0e496d57b5e7259d452493b4ef52caabcef9e399e321b0cd3c4b022a6cc`.
The private server binds localhost:5095. Credentials and browser profiles are
outside the published evidence; temporary browser profiles are removed on close.

The aligned region excludes initialization, import, configuration, arrangement,
export, preview and download. Full process timing uses the unchanged existing
benchmark boundary around Print::process. `BENCH_RUNTIME` measures C++ op_init
and its preinitialization subsection. Their sums with region/process time expose
work shifted across that boundary. The existing worker init request/response
also measures broader engine initialization (asset fetching, module startup and
C++ init); its sum with process time is supplemental and sensitive to browser
asset caching. Neither sum is end-to-end click-to-download latency.

The first `harness/run.sh` batch is excluded: an early output comparison ran
while that batch was active. Its evidence is retained. Final timing analysis
and comparisons run only after the replacement batch completes.
The first replacement attempt hit HTTP 429 at login, before any slicing; its
logs are retained under `rate-limited-*`. The successful final harness restarts
only its own private server before each browser session to reset the limiter.

## Reproduction and checks

Run from the worktree root. Never overwrite evidence destinations.

```sh
bash -n wasm/build/first-slice-runtime-20261108/harness/build.sh
bash -n wasm/build/first-slice-runtime-20261108/harness/run-final.sh
node --check wasm/build/first-slice-runtime-20261108/harness/driver.mjs
node --check wasm/build/first-slice-runtime-20261108/harness/summarize.mjs
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/first-slice-runtime-20261108/harness/build.sh
# The final harness starts/stops serve.sh using the private alpha configuration.
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/first-slice-runtime-20261108/harness/run-final.sh
# Only after timings finish:
node wasm/build/first-slice-runtime-20261108/harness/summarize.mjs
```

Build scripts explicitly replace Engine object, archive and link destination
paths. The retained source/Print.cpp SHA256 is
`6a614fdc2ba9b05a81ca2e05a7bdf46f4aafc9996df262d1c265944ea0d64653`;
the private slicing archive SHA256 is
`7a31f056d4342f07d811077424c940086efd3c6b8ece555047943431aecf048e`.
Both match the previous experiment exactly.
