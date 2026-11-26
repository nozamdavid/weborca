# Fresh slicing and Preview profiling

November 26, 2026. Measurements begin from commit `30b4ad83bc` and the deployed slicing and Preview follow-up. Raw samples and runner copies are retained in the local, ignored `wasm/build/` directory.

## Slicing thread scaling

The shipped WASM pair ran in Node 24.21.0 on a Ryzen 9 9950X3D. Each sample reimported and arranged the model before timing a fresh computation, including worker result polling and G-code delivery. The four-model fixture imports the same STL as four separate objects. Earlier four-instance tests reused one model mesh and have a different workload. Each thread count had one first-use sample and four warmed samples. All 25 G-code files per fixture matched after removing the generated header line.

| Requested threads | One Benchy median | Four imported Benchies median |
| ---: | ---: | ---: |
| 1 | 3,319 ms | 14,112 ms |
| 2 | 1,748 ms | 7,139 ms |
| 4 | 1,038 ms | 4,397 ms |
| 8 | 726 ms | 3,013 ms |
| 16 | 581 ms | 2,449 ms |

On this host, 16 threads took 20.0% less time than 8 for one Benchy and 18.7% less for four separate imports. The runner groups each thread count together. The measurements are for Node, with a separate Helium experiment for the browser and its worker startup behavior. Sample boundaries, asset hashes and all raw timed values are in `wasm/build/fresh-slicing-20261126/threads/summary.json`.

## Matched native and WASM phases

The [matched phase report](native-wasm-phase-profile-20261126.md) compares the same source with four requested threads in one serialized 73 s session. `Print::process()` medians were 318.7→356.7 ms on Benchy, 1641.0→1891.8 ms on four separate Benchies with supports and 8.6→16.4 ms on H2C, native→WASM. Native used five fresh processes per fixture and Node WASM used three warm samples in a reused engine. Process startup and G-code export fall outside this timed region. Host load rose from 3.46 to 5.24, and the two Voron fixtures had 18 and 31 differing G/M/T lines. The report gives directional phase details and output differences. This single thread count does not establish the cause of the runtime gap.

## PR source checks

GitHub declined to start the `source` job for [PR #22](https://github.com/nozamdavid/weborca/pull/22) and reported a billing or spending-limit issue. A local run passed actionlint, source validation, all 22 locale catalogs, TypeScript, manifest validation, and the native Preview packet test. The method tests had 75 passes and two skips.

The CI test inventory failed because the filament wizard test launches Chromium but is missing from the browser runner's list. The wizard test and runner inventory both predate the performance commit. Logs are in `wasm/build/fresh-slicing-20261126/local-ci/`. [Test inventory assertion](../ci/test-classification.test.mjs) · [Local test runner](../ci/run-node-tests.mjs)

## Helium thread scaling

Headed Helium 0.20.3.1 drove the same demo follow-up image the Node scaling test used. Each trial set `slicingThreads` to Auto (resolves to 8 on this 32-thread host) or 16 through the app store. Auto resolved to 8 effective engine threads; selecting 16 resolved to 12 effective (`resolvedThreads: 12` in every forced sample). The run was 24 fresh slices: four trials per arm, each with one first-use sample and two warmed samples, so 4 first-use and 8 warmed samples per arm. All timed values, asset provenance (`wasmSource`) and per-sample PSS come from `wasm/build/fresh-slicing-20261126/helium-ab/summary.json`. Every G-code in both arms matched after removing the generated-at line (`timestampMaskedSha256`).

| Stage | Auto 8 (effective 8) | Forced 16 (effective 12) |
| --- | ---: | ---: |
| Slice RPC, first (n=4) | 1,058.78 ms median (1,049.6–1,101.7) | 1,004.26 ms median (1,001.1–1,019.3) |
| Slice RPC, warm (n=8) | 760.18 ms median (744.3–808.2) | 671.80 ms median (630.6–729.3) |
| Click to first draw, first (n=4) | 1,450.90 ms median (1,438.7–1,488.1) | 1,394.40 ms median (1,382.0–1,407.9) |
| Click to first draw, warm (n=8) | 1,059.85 ms median (1,024.4–1,109.4) | 975.47 ms median (924.8–1,046.6) |
| Renderer PSS after slice, first (n=4) | 980.24 MiB median (964.8–1,137.3) | 1,053.53 MiB median (1,022.5–1,094.4) |
| Renderer PSS after slice, warm (n=8) | 1,152.85 MiB median (1,092.1–1,217.3) | 1,154.90 MiB median (1,135.0–1,195.8) |

Warm slices ran 88.4 ms faster at the median with effective 12 threads (760.18 vs 671.8 ms). Preview stages (`previewWorkerRpcMs`, `previewPacketToFirstDrawMs`, `replyToPreviewReadyMs`) stayed within noise between the arms; warm `replyToPreviewReadyMs` medians were 294.31 vs 294.65 ms. Warm PSS after Preview plateaued near 1.1–1.2 GiB in both arms (medians 1,152.85 and 1,154.90 MiB), and the first-use slice cost about 170 MiB (Auto 8) and 100 MiB (forced 16) less than the warmed plateau. Startup comparisons between the arms carry a single fetch asymmetry, kept separately from the timings above: one Auto-8 trial loaded the engine from the network instead of `CacheStorage`, which put a 1,617.8 ms outlier in that arm's `startupMs`; every forced-16 sample and the remaining Auto-8 trials loaded from `CacheStorage`.

## Export cache file identity

The current export cache checks the output path and file length. A public `writeFile` call flipped one byte in the 383,170-byte output. The next slice returned the overwritten file with the previous print statistics. The reproducer and log are in `wasm/build/same-path-export-20261126/probe.mjs` and `wasm/build/same-path-export-20261126/baseline/public-repro.log`.

An experimental exact byte comparison regenerated the file after public and direct filesystem writes, replacement, resize, and deletion. Cancellation and recovery also passed. On the four-Benchy fixture, median cache-hit latency rose from 7.45 to 50.57 ms across 30 hits per build and the snapshot retained an extra 19.5 MB of G-code. The prototype stays experimental. Results are in `wasm/build/same-path-export-20261126/`.

## Rejected: sharing one imported mesh across object copies

The prototype compared mesh contents for separately imported objects and reused geometry across identical meshes. At eight threads, the median of three runs fell from 2.959 to 2.512 s for four identical Benchys and from 3.124 to 3.064 s when one mesh had a vertex moved. Each fixture's normalized G-code hashes matched. An independent four-cantilever fixture lost two object-specific support warnings, even though the API warning arrays were empty in both builds. That regression ruled out the prototype. Evidence is in `wasm/build/fresh-slicing-20261126/mesh-share/`, including both logs under `diagnostic/`.

## Rejected: G-code parser scratch allocation reuse

A prototype that keeps the G-code parser's scratch containers with the processor and clears them on scope exit (including exception unwinding) was measured on the Preview packet path and rejected for lack of gain. On a large parse (four Benchys) it cut G-code parse time 2.02% at the median over 12 warmed pairs (590.79 → 578.02 ms) and the full parse-and-packet call 0.88% (893.88 → 884.81 ms); on a single Benchy it showed no repeatable gain (parse +0.80%, parse and packet +1.38% median paired change). Packet digests, statistics and frame hashes were identical between arms. Details and the allocation counts (baseline 51,490/193,096 allocations vs 9 for the candidate) are in `wasm/build/fresh-slicing-20261126/speed-moves/report.md`. The prototype stays in the experiment directory.

## Larger plates in Helium

Forty fresh slices compared Auto at eight threads with selecting 16, which resolved to 12 on this Helium profile. Warm slicing was 10.2–12.8% faster across four supported plate pairs. The two reverse-order pairs without supports improved by 12.3–13.1%. Two earlier Auto samples overlapped host CPU bursts and exaggerated the pooled difference. Every G-code file in each fixture matched after removing the generator timestamp, and the slice metadata matched exactly. The supported plate's median renderer PSS after Preview was 2,217 MiB at eight threads and 2,219 MiB at 12. The compute windows recorded no main-thread Long Tasks. See `wasm/build/fresh-slicing-20261126/helium-heavy/report.md` for the paired timings, host activity and first-use samples.

## Returning to a previously sliced plate

The instrumented engine returned to plate A in 788.0 ms at the median over eight warm A→B→A cycles with one Benchy on each plate. An immediate same-plate repeat on that two-plate project took 33.6 ms. That hit still spent 23.5 ms checking containment and 1.3 ms applying configuration at the median. An unchanged slice in a separate one-plate project took 4.65 ms wall time. The app wrapper already supplies per-plate output paths.

On return to A, the WebAssembly engine stage medians were 22.9 ms for containment, 23.0 ms for applying and validating, 248.5 ms for geometry and 467.6 ms for export. Reusing geometry alone still incurs export when switching plates. An independent-engine proxy added 135.5 MB of RSS for the second plate after that engine's setup, which costs another 617.4 MB. The direct two-Print experiment measures the memory tradeoff in one engine. Per-call stage logs and data are in `wasm/build/plate-retention-20261126/`.

The direct two-Print probe retained geometry for both plates and regenerated exports on each switch. Benchy return-to-A medians fell from 774.1 to 496.8 ms across eight cycles. All 36 recorded parity steps matched, including cancellation, a config change without `plateIndex`, model replacement, three plates, and plate renumbering. [Control results](../build/fresh-slicing-20261126/two-plate-retain/run-probe-control/result.json) · [Candidate results](../build/fresh-slicing-20261126/two-plate-retain/run-probe-candidate/result.json) · [Parity steps](../build/fresh-slicing-20261126/two-plate-retain/run-probe-candidate/parity.json)

With a 752,232-triangle model on each plate, both return-to-A samples took about 2.2 s in the control and 1.1 s in the candidate. With both plates retained, mimalloc counted 2,450 live pages in the control and 3,993 in the candidate at the corresponding stage. After the first switch, whole Node process RSS was 1.48 and 1.60 GiB respectively. Those snapshots include the rest of the runtime. Production qualification still needs browser peak memory, explicit slot identity when `plateIndex` is omitted, printer-family reset coverage and a safe export file identity check. [Dense control](../build/fresh-slicing-20261126/two-plate-retain/run-probe-control/dense.json) · [Dense candidate](../build/fresh-slicing-20261126/two-plate-retain/run-probe-candidate/dense.json) · [Experiment report](../build/fresh-slicing-20261126/two-plate-retain/report.md)

An integrated headed Helium test used the same app and Preview assets in both arms, eight requested threads, and three fresh profiles per arm and fixture. Return-to-A engine medians fell from 813 to 550 ms for Benchy and 2,266 to 1,160 ms for the dense fixture. Click to first visible draw fell from 1,043 to 782 ms and 2,924 to 1,823 ms respectively. All 18 matched phase pairs produced identical normalized G-code and slice statistics. The prototype logged slot reuse on all six candidate returns. Renderer VmHWM medians were 1,184/1,197 MiB for Benchy and 2,056/2,056 MiB for the dense fixture, control/candidate. Individual paired differences varied in sign. The tab and both workers shared one renderer, so this includes import, slicing, and Preview allocations. One dense candidate first slice took 8.16 s and remains in the samples. [Helium plate trials](../build/fresh-slicing-20261126/helium-prototypes/plates/report.md)

The next test is an exact-containment memo to address the measured 23.5 ms off-plate check. Its key must include the exact transform and bed inputs, and mutating geometry must invalidate it. Check the app's autosave and layer-range read or sync paths before every normal Slice, since they may affect whether the memo survives long enough to help.

## G-code export analysis

On one Benchy and four instances of the same Benchy, full export took 461.2 and 948.9 ms at the medians. The timed stream analysis calls took 144.8 and 546.9 ms, including temporary string construction, text parsing and motion analysis. The first file rewrite took 15.8 and 62.6 ms. Timings overlap across nested scopes and pipeline stages. Three warm runs per fixture per build matched G-code after removing the generator timestamp and matched every returned metadata field. [Export timings](../build/export-stage-profile-20261126/fallback/report.md)

A separate instrumented build timed the `calculate_time` flush inside `process_G1`. The four-instance fixture called it 31,813 times per export and spent 17.7 ms at the median, about 3% of stream analysis time. The three measured runs matched the earlier instrumented build's G-code and metadata. [Motion planner timings](../build/export-stage-profile-20261126/planner-flush/report.md)

A direct dispatch for the exact `G1` and `g1` command tokens matched output and metadata in all 12 measured slices. The two candidate batches had whole-slice medians of 1,306 and 1,309 ms, with control medians of 1,274 and 1,301 ms. The timing does not establish a gain from bypassing the command trie. [Dispatch experiment](../build/export-stage-profile-20261126/g1-dispatch/verification.json)

## Changes selected for integration

- **Skip empty preheat rewrites.** When the injector adds zero commands, the processor now skips reopening and rewriting the exported file. On four Benchys with the H2C profile and no insertions, the instrumented fresh-slice median fell from 1,158.5 to 1,128.0 ms over eight warm samples per build. The later clean build confirmed a 26.3 ms reduction. G-code, estimates, warnings, line offsets, and move IDs matched. A separate two-tool job still inserted three commands. The clean engine passed 35 focused Node checks and compiled for both native and WASM. Evidence is in `wasm/build/second-pass-early-return-20261126/` and `wasm/build/fresh-slicing-20261126/preheat-final/`. [G-code processor](../../src/libslic3r/GCode/GCodeProcessor.cpp)
- **Read and write Preview packet arrays in bulk.** The paired experiment saved 50.0 ms of worker round trip for the 27.2 MB Benchy packet and 187.9 ms for the 111.8 MB four-Benchy packet. Each figure is the median of paired sample differences between the builds, a paired statistic distinct from the difference between the two arms' group medians. The larger packet also saved 13.3 ms on the median main-thread decode and validation pair. Native parsing and the renderer's GPU submission time were similar. Packet bytes, statistics, visible pixels and move ranges matched, and both runtimes rejected four malformed cases. The production implementation bounds stream operations by the supported stream size. Evidence is in `wasm/build/preview-packet-io-20261126/report.md`. [Packet codec](../preview/packet.hpp)

## Experimental Preview tool palette upload suppression

A candidate Preview build skipped tool-palette texture uploads whose contents are unchanged. It remains a viable next candidate and has never shipped. On the 19.5 MB four-Benchy fixture in headed Helium, the 5.59 MB saving was measured on a Feature Type frame after a footer palette change, since that view does not use tool colors, and the equality checks apply to it as well. The median paired delta fell 5.37 ms for CPU submission and 6.22 ms for submit through readback, with the candidate faster in all 12 pairs. Eighteen exact full-frame comparisons matched on pixel SHA-256, covering palette changes, unchanged palettes, alpha-only changes and view switches. Evidence is in `wasm/build/fresh-slicing-20261126/tool-colors/results.json`.

## PrintObject tier

A candidate build raised `PrintObject.cpp` from -Os to -O3. Across 60 slices on three fixtures, median times stayed within ±0.2% per fixture and normalized G-code matched. The change added 228 KB of raw WASM and 27 KB after Brotli compression. Evidence is in `wasm/build/fresh-slicing-20261126/printobject-opt/report.md`.

## Clipper2 predicate fast path

A candidate header added a range-guarded int64 fast path to Clipper2's `ProductsAreEqual` and `CrossProductSign`. Equivalence held with zero mismatches across 27 million reference checks on native and wasm64. The wasm64 microprobe ran the sign predicate 3.2× cheaper per call (6.51 to 2.02 ns) and the equality predicate 3.4× cheaper (5.92 to 1.73 ns). The integrated A/B over 30 alternating pairs measured a −0.30% median paired change with a 95% interval spanning zero. The ceiling analysis bounds the predicates below 0.5% of single-thread slice time, and the change stays out of the engine until a paired measurement resolves that size of effect. No tracked source changed. The experiment directory `wasm/build/fresh-slicing-20261126/clipper-predicates/` holds `report.md` and `protocol-note.md`, which discloses two deviations: the smoke slices, counting-engine runs and probe microbenchmarks, each 5–25 s long, ran without the shared benchmark lock, and the first 12-pair batch's raw per-sample files were deleted before archiving.

## Further measurements

- **Seam visibility during export.** The symbol build uses the production engine's object files and matches executable G-code. On the four-instance sample, seam placement represented about 36% of attributed active engine CPU samples. AABB ray traversal dominated this bucket. CPU samples are summed across threads and the profiled runs were noisy. The direct wall measurements in the plate test independently show export as the largest phase. See `wasm/build/slicing-profile-20261126/report.md`. [Visibility ray casting](../../src/libslic3r/GCode/SeamPlacer.cpp)
- **Seam normals experiment.** On four separate Benchies, timed ray casting fell from 837.6 to 826.3 ms at the median, with a median paired change of −11.5 ms. The full uninstrumented slice measured 2931.2→2941.6 ms, within variation. All retained G-code parity checks matched, including the instrumentation checks. See the [full-slice log](../build/fresh-slicing-20261126/seam-normals/results/benchmark.log) and [raycast log](../build/fresh-slicing-20261126/seam-normals/results/raycast.log).
- **Shadow filter.** Reusing identical texel fetches lowered synchronized orbit frame medians from 14.30 to 12.48 ms on the large toolpath in Helium with the caster cache active in both builds. The smaller cube scene measured 8.49 to 6.62 ms. All 52 full-frame comparisons matched in Helium and another 52 matched in Firefox. Software shader compilation and an edge probe passed. An actual SwiftShader context also passed 10/10 full RGBA frame comparisons on the bounded cube run. Large software runtime verification and the existing lighting probe adaptation remain before integration. See the [SwiftShader report](../build/slicing-performance-20261126/pcf-tap-reuse/evidence-software-webgl-20261126/REPORT.md).
- **Repeat Preview preparation.** In headed Helium the candidate skipped all six unchanged repeat preparations through normal Prepare navigation. A wall-count change triggered preparation again. Slice reply to first visible WebGL draw fell from 234 to 60 ms for one Benchy and 880 to 262 ms for four separate imports. Renderer lifetime peak RSS through the repeat fell from 1,170 to 1,102 MiB and 2,416 to 2,020 MiB respectively. The candidate started the repeats with 26 and 19 MiB more RSS. Each median uses three fresh browser profiles per arm and fixture. Both workers ran in the same renderer as the tab. All 26 slices rendered and matching configurations produced identical normalized G-code and print estimates. [Integrated Helium results](../build/fresh-slicing-20261126/helium-prototypes/preview/report.md) · [Lifecycle tests and compare timings](../build/fresh-slicing-20261126/repeat-preview-lifecycle/findings.md)
- **Other prototypes.** The embedded config scan took 21.80 to 8.32 ms on the larger fixture, while total Preview times varied by pair. Removing export buffer copies passed 50 paired parity checks, with the performance result reversing on repeat. Inlining wall-stitch queries yielded a 0.8% Benchy median change across six interleaved pairs, with no consistent improvement on the larger plate. Evidence is in `wasm/build/fresh-slicing-20261126/{config-scan,export-buffer}/` and `wasm/build/stitch-visitor-ab-20261126/results/`.

## Frozen control

The frozen control for these tests is the demo follow-up image `weborca-private:demo-20261126-slicing-preview-followups`, which served :18974 when the tests started. The demo was switched separately afterwards to main `1aebe9c4c7`, which carries older binaries.

## Demo rollout

The Tailscale demo now serves the packaged image `weborca-private:demo-20261126-slicing-phase-followup` (`sha256:16016a6f0555e4b87824a1f7624aace37ac6273f5bd994d936cb4c844d620a4b`). The rollback container is `weborca-models-demo-before-fresh-slicing-20261126`, whose image is `sha256:279aa306a8c0934f53e4999388b36ba0f3c7102f6a760031d9af832d848cdeb4`. The rollout log, one connection reset followed by a full pass, is in `wasm/build/fresh-slicing-20261126/release-ready/live/rollout.log`. Verified HTTPS digests covered 14 files, including both Preview aliases. COEP `credentialless` and COOP `same-origin` were checked in the served headers, along with the engine version headers, and the checks compared `/prepare` and `/preview` against the candidate index. The cloud status reported all four printer bridges and OctoEverywhere enabled. The release logs are in `wasm/build/fresh-slicing-20261126/release-ready/`.

Packaged loopback QA ran headed Helium one-click trials on a cube and a Benchy, four per fixture, against the candidate container with COEP `credentialless`. Every trial rendered Preview from one Slice click, all engine and Preview asset digests matched the expected values, and timestamp-masked G-code and print statistics matched the previous optimizations exactly per fixture. Evidence is in `wasm/build/fresh-slicing-20261126/release-qa/`, with the one-click samples under `release-qa/smoke/oneclick/`.

An independent live HTTPS one-click Benchy against the deployed demo also completed. It saw 240 layers, about 1.40 s click-to-ready and one engine slice request, with exact digests and G-code after masking the timestamp. The run needed a shorter browser startup socket path and then one engine startup retry before passing. Evidence is in `wasm/build/fresh-slicing-20261126/release-qa/live/benchy/`, including `parity.sha256` and `timeline.log`.
