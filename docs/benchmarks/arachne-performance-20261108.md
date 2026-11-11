# Bounded warm Arachne SIMD experiment — 2026-11-08

The selected-TU strict SIMD experiment **fails speed acceptance**. Warm perimeter
time does not improve: control median 37.9 ms versus SIMD 38.5 ms. All 16 exports
preserve shipped executable commands, including M73, and full exported configuration.
No production patch or candidate is recommended. Original executable-G-code parity
remains unresolved; output equality here is against the frozen web baseline.

## Mechanism and scope

The existing `slicing-performance-20261108/profile-named-summary.json` uses the
symbol map emitted by its own `symbols/` engine for its own excluded profiles.
Its `Print::process` ancestry subset includes Voronoi `pss` (10,545 us sampled
weight), `extended_int<64>::dif` (7,634), WallToolPaths::generate (8,476), and
SkeletalTrapezoidation::generateSegments (5,240). These are perturbed sample
weights, not complete slice CPU percentages; worker stacks lack caller ancestry.
This selects the Voronoi caller in `SkeletalTrapezoidation.cpp`, rather than the
export ray-intersection hotspot in the all-worker view.

Ranked predictions were: enabling strict SIMD in this TU may improve generated
operations; scalar dependent predicates may prevent useful vectorization; allocation
cost may dominate what SIMD can change. Exactly one variant was built:
`-msimd128` on a byte-identical private copy of SkeletalTrapezoidation.cpp.
The original compile command was retained, with copied input/output paths and the
original Arachne include directory added for relative headers. Optimization remarks
are diagnostic only. No fast-math, relaxed SIMD, reassociation, geometry changes,
preinit workload, model prewarm, or missing paths were introduced.

The actual WASM command ends in O3/NDEBUG, MEMORY64, pthreads and WASM exceptions;
it originally lacks `-msimd128`. Eigen's installed vectorization configuration has
no WASM SIMD branch, so no new Eigen packet ABI is selected here. The compiler
reports SLP stores in ExtrusionJunction. Object disassembly confirms real SIMD:
95 v128 loads, 200 stores, nine f32x4 multiplies and one i64x2 add, with lane and
mask operations. There is no f64x2 arithmetic in this object. This gives a concrete
but limited mechanism; it does not demonstrate acceleration of double-precision
Voronoi circle predicates. Successful normal UI slices establish Helium support
for this linked SIMD artifact.

The installed native reference is still source manifest
`40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`, binary SHA256
`9c42194b612e85b29ec269124d8f1b83d768f3e8a3dfdfb65e26625942e947cc` (rechecked).
Its manifest specifies Clang, Release and lld. Exact installed-native TU flags
are unavailable: the installed ELF lacks `.comment` and the manifest does not
retain compile commands. Local native diagnostic command databases contain O1;
they are separate builds and cannot establish the reference's code generation.
No claim of equivalent native/WASM compiler flags follows.

## Results

Milliseconds, median [minimum–maximum], three trials per condition. Trial 0 for
each engine is excluded, both fresh and warm passes.

| Metric | Control | TU SIMD |
|---|---:|---:|
| Fresh aligned region | 238.2 [226.6–240.5] | 230.3 [224.1–240.8] |
| Fresh perimeter stage | 91.6 [87.7–93.2] | 87.8 [87.0–98.0] |
| Fresh full process | 240.9 [229.3–243.2] | 233.0 [226.5–243.1] |
| C++ initialization | 0.785 [0.705–0.805] | 0.730 [0.670–1.640] |
| Init + fresh full process | 241.7 [230.0–244.0] | 233.7 [228.2–243.8] |
| Warm aligned region | 90.9 [86.5–96.1] | 87.1 [85.2–87.2] |
| Warm perimeter stage | 37.9 [37.7–39.6] | 38.5 [36.7–39.1] |
| Warm prepare-infill stage | 17.6 [17.1–18.7] | 17.0 [16.7–17.2] |
| Warm infill stage | 25.7 [23.3–30.8] | 23.4 [22.8–24.2] |
| Warm full process | 91.2 [86.9–96.5] | 87.5 [85.6–87.6] |

Warm perimeter pairs in trial order (control, SIMD): (39.595,39.110),
(37.655,36.720), (37.895,38.490). Fresh perimeter pairs also change sign.
The lower whole-region median does not establish the proposed mechanism: warm
perimeter fails to improve, ranges overlap, and infill accounts for much of the
apparent reduction despite its TU being unchanged. No reliable startup gain or
regression is established. The older native 40.8 ms and web warm 85.1 ms medians
remain historical context, not matched comparators for this batch.

## Workflow, acceptance and provenance

Evidence root: `wasm/build/arachne-performance-20261108` (ignored). The full frozen
UI and profile assets are reused through readonly links. Every session uses headed
`/opt/helium/helium`, the normal project-file input, Slice Plate 1 and File → Export
G-code. Each fresh app slices once, then reimports the original project and slices
again with a new Print, forcing warm recomputation. Three measured sessions per
condition alternate SIMD/control, control/SIMD, SIMD/control. A separate initial
control/SIMD session pair is excluded; it cannot warm future app JIT contexts.
Auto remains capped at eight effective threads. Browser metadata records Chromium
156.0.8078.79 and per-session hardwareConcurrency. No frontend build was needed.

Input is the established bracket saved project,
`sample-parity-cause-20261107/ui-project/input.3mf`, SHA256
`a010c0e496d57b5e7259d452493b4ef52caabcef9e399e321b0cd3c4b022a6cc`.
It is an algorithm fixture and shared-project control. Desktop original-tree GUI
parity belongs to the separate work; this experiment makes no native-output claim.

Both links reuse the prior control Engine object (preinit disabled), the exact
Print aligned-region/checkpoint instrumentation, and all original dependencies.
Private control and SIMD archives copy the baseline instrumented archive; only
the SIMD copy replaces SkeletalTrapezoidation.cpp.o. The control's two preliminary
exports passed the shipped-output gate before the first SIMD session. The aligned
region and perimeter checkpoints have the same source boundaries as the prior
Print/native log measurements. Full process and C++ initialization are separate
timers. Broader init RPC timing is unavailable in this reused REPEAT harness because
it clears the event list before import; the C++ init sums do not measure module
compilation or click-to-download latency.

Reject on any executable-command hash change (including M73), any full exported
configuration difference, or missing/invalid measurement. All 16 raw G-code files
pass: command SHA256
`e0992f3ce802c0946f9da180c00ff16520c01637b13ad3c7142099f93f756734`,
canonical sorted full-config SHA256
`ef26b1d6f9c71e475f74b99e8c87e0319b8ac5a2ecd0727c3a0f307f20f74d34`.
Comparator self-checks plus explicit changed-M73 and changed-config rejection checks
pass. Output invariance passes; targeted speed acceptance fails.

Control WASM SHA256:
`f4b299227b1c2a26e0f0a6c0e71d6e98660389e55c6fadc0220e4de43c3bad3a`.
SIMD WASM SHA256:
`caf78359c253606930c3ac21e5424a3a42fcb04f0e9304c8014ed682ec8dfd3f`.
Both JS hashes are
`70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7`.
Frozen shipped WASM remains
`452c0ab51a0b935f691384e629d73ad0005fda99733b059d18cc600c0d4c1f19`.

Compilation, links, whole timing batch and subsequent analysis acquire exclusive
`/tmp/weborca-parity-benchmark.lock`. There are no profiled trials in this batch.
Background services, frequency and affinity remain uncontrolled. Measured-session
one-minute loads range 15.89–20.88, five-minute 12.99–13.20 and fifteen-minute
9.26–9.47; preliminary loads are also retained. Do not infer a small speed win.
A brief preview login-page check occurred only during excluded trial 0 and its
tab was closed. Harness contexts/profiles close after each session; the private
server stops at batch exit. Authentication stays private.

Retained evidence: `setup.sh`, `harness/compile-simd.sh`, `harness/link-*.sh`,
`objects/*log`, copied source, private archives, immutable engine pairs,
`objects/simd-disassembly.txt`, `checks.log`, `harness/control-ship-gate.json`,
`harness/summary.json`, `harness/stats.txt`, per-run console/event/browser files
and raw exports. Initial copied-source compilation failed due to its moved relative
include and a split flag line; those harness issues were corrected before the
successful compile/link and all UI measurements. No product source was edited.

## Reproduction

Run from this worktree root. Use new evidence destinations; never overwrite this
batch. The build script is intended for a new destination. Shell and JS syntax
checks, the affected copied TU compilation, both links and all full-app workflows
passed. No new logic requires a kernel self-check.

```sh
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/arachne-performance-20261108/setup.sh
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/arachne-performance-20261108/harness/run-final.sh
# Only after timing completes:
flock /tmp/weborca-parity-benchmark.lock node wasm/build/arachne-performance-20261108/harness/summarize.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/arachne-performance-20261108/harness/stats.mjs
```

No deployment, commit, push, README/KNOWLEDGE or Taproot update was made. The
negative result narrows the next investigation to scalar predicate/extended-integer
costs rather than treating missing global SIMD as an established warm Arachne fix.
