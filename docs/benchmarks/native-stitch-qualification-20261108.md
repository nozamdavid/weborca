# Native stitch production qualification — 2026-11-08

The review candidate implements original-native equal-cell endpoint visitation in the production stitcher. Native matching takes priority; zero measurable overhead is not a prerequisite for this fidelity correction. Release remains a separate parent decision. No deployment, commit or push is authorized here.

## Implementation and provenance

Production header: `src/libslic3r/Arachne/utils/PolylineStitcher.hpp` (the shorthand `src/libslic3r/PolylineStitcher.hpp` is not a production file). A local unordered map stores `boost::container::small_vector<Index, 2>` per cell. Boost small_vector is already a libslic3r dependency. Endpoints append and queries traverse each cell in reverse insertion order. This preserves the [measured original-native oracle](native-stitch-compatibility-20261108.md), not an assumed standard-library guarantee. SquareGrid neighbor enumeration, callback signature/eligibility, processed rejection, early snap exit and arithmetic are unchanged. No global grid API changes or diagnostic probes are included.

The recorded population was 316 cells / 434 endpoints / 112 duplicate cells. Two inline endpoints cover the common one/two-endpoint occupancy; higher occupancy still follows the same policy. This avoids the vector candidate's separate heap allocation for every populated cell. It does not assert a universal allocation or speed advantage over unordered_multimap.

Ignored immutable evidence lives in `wasm/build/native-stitch-qualification-20261108`; the previous compatibility candidate and baseline archives were preserved. `build.sh` copies the original archives, compiles production `WallToolPaths.cpp` and `Arachne/utils/PolylineStitcher.cpp` with each build's recorded compile flags, replaces only those private archive members, and links the clean engine. These are the direct header consumers. The prior instrumented FillConcentricInternal object is not installed in the clean archive. The frozen full UI is reused with the newly linked engine; no frontend source changed. `build.sha256` records source and engine identity.

## Focused regression

`ORCA_STITCH_REGRESSION=ON` exposes the `native_stitch_regression` target in native and Emscripten builds. Its independent synthetic input contains a processed parent and a tiny segment with both endpoints in one cell. It checks that the newest endpoint wins the snap and leaves the original endpoint at the stitched tail. It embeds no user-fixture coordinates. Compile/link flags for direct qualification are retained in `unit-*.sh`, `wasm-test-*.sh`, and their logs. Native and WASM pass; recompiling the WASM test against the original header fails with `newest equal-cell endpoint must win after skipping the processed parent`. Original-native success before the patch is expected: matching that behavior is the purpose.

## Qualification protocol

Every build, link, timed batch and analysis acquires exclusive `/tmp/weborca-parity-benchmark.lock`. No timing analysis runs concurrently with the timed batch. The shared browser preview reported `available:false`; the existing authorized driver uses actual headed `/opt/helium/helium`, isolated profiles, normal project import, Slice and Export. Profiles and the owned local server are closed by the drivers/traps. Secrets remain private.

The bracket uses the exact frozen shared `sample-parity-cause-20261107/ui-project/input.3mf`; the native oracle remains `native-project/plate_1.gcode`, not the differently configured desktop STL export. Three sessions alternate control/candidate order (control first, candidate first, control first). Each condition has one first slice plus seven warm fresh-project recomputations, for 21 warm observations per condition. Reimport constructs a new Print; these are not cached-result timings. Auto/eight slicing threads and the same frozen UI/configuration are used. The timer variant adds only the existing aligned Print timer object to a private archive; the clean candidate is retained separately.

Normal inherited affinity is CPUs 0–31 on 16 physical cores with SMT; no affinity, scheduler, services or governors were changed. Observed preparatory host load was approximately 21/16/15. These are realistic default-affinity observations, not isolated-core measurements. Perimeters are the primary affected stage; the aligned entire Print region is secondary. Paired pass-position differences and per-session medians/ranges quantify variability; sequential conditions share uncontrolled host effects. Three sessions cannot prove absolute zero overhead. Native's earlier 40.8 ms aligned median remains independent historical context.

## Results and decision

The clean product candidate passes 34/34 native and 34/34 WASM saved-native stdout fixtures (`fixtures-result.txt`). The headed clean full tree and bracket match the prior qualified vector candidate's complete executable commands, including M73, and configuration exactly (`results.json`). This checks the allocation optimization independently of the native policy change. Direct original-native comparison (`native-results.json`) confirms 79 differing executable positions, 12 excluding M73 diagnostically, and only the two previously known upper wall deposition groups. All three solid geometry/E corrections remain. Against the frozen shipped tree there are precisely nine differing executable positions: three corrected commands and the six positions of the previously accounted M73/G1 swaps. Tree net E is native's 40585.07048998099 mm. Raw bytes remain unequal. Ordered saved geometry matches the frozen baseline (`I/geometry.json`); six native GUI state keys remain unequal.

All 96 timing exports (48 default plus 48 affinity) match frozen bracket commands including M73 and complete configuration. Warm measurements, milliseconds:

| Condition | Control perimeter median [range] | Candidate perimeter median [range] | Control aligned region median [range] | Candidate aligned region median [range] |
| --- | --- | --- | --- | --- |
| Default affinity, 21 each | 37.025 [35.645–40.520] | 37.955 [35.190–45.550] | 85.480 [82.325–92.630] | 88.405 [83.530–107.925] |
| Eight physical cores, 21 each | 39.415 [35.295–43.975] | 38.500 [35.650–45.895] | 87.575 [83.175–95.240] | 89.800 [83.330–109.780] |

The supplementary affinity wrapper execs `taskset -c 0-7,16-23 /opt/helium/helium`; only this owned browser process tree inherits the restriction. These logical CPUs cover eight distinct physical cores with both SMT siblings, selected after allowed-affinity/topology inspection and a two-second per-CPU idle sample (roughly 4.5–10% busy). Neither Node/server nor other processes were pinned. It is a separate observation, not a replacement for normal defaults; the cores are not reserved or isolated. The same immutable timer engine/UI is reused.

Candidate-minus-control medians of paired warm pass-position differences, followed by full paired ranges, in milliseconds:

| Session | Default perimeters | Default region | Affinity perimeters | Affinity region |
| --- | --- | --- | --- | --- |
| 1 | −0.850 [−3.215, 2.515] | 1.955 [−7.695, 21.985] | −3.025 [−5.530, −0.300] | −2.885 [−4.590, 3.525] |
| 2 | 2.340 [−1.805, 8.510] | 4.635 [−2.160, 24.470] | −0.465 [−4.185, 2.435] | 1.175 [−5.085, 7.670] |
| 3 | 0.010 [−4.475, 1.675] | 1.525 [−3.215, 3.255] | 1.865 [0.325, 10.600] | 5.645 [0.350, 22.605] |

These are descriptive uncertainty ranges, not confidence intervals. Samples within each session are correlated; sequential condition blocks permit host drift. Default session perimeter median differences are −0.135, +3.815, +0.045 ms; affinity session differences are −3.935, −1.020, +3.085 ms. The primary stage does not show a consistent regression across sessions/conditions. Its pooled change reverses from +2.51% at defaults to −2.32% with affinity. Neither percentage establishes a speedup or a precisely bounded overhead. The secondary region is +3.42% / +2.54% at the pooled medians; a small whole-process cost cannot be excluded and is retained as a release-review limitation. Unchanged stages' differences cannot be causally assigned to stitching from these timings.

First-slice aligned medians are 241.660/241.625 ms default and 221.035/218.055 ms affinity (control/candidate). Perimeter medians are 90.775/96.025 and 89.075/90.995 ms. Each has only three observations: no first-slice improvement or firm regression claim follows.

**Decision:** retain the clean minimal product patch and focused native/WASM target for parent review. Fidelity gates pass; there is no reproducible meaningful slowdown in the affected perimeter stage in this bounded qualification. This practical decision follows the user's native-first policy and does not require proof of absolute zero overhead. The residual secondary-region difference is explicit; further broad optimization or attribution is not established. Strict native parity, upper wall traversal, six tree GUI state differences and the independent native-speed gap remain open. No release was performed.

## Exact identities and reproduction

Clean engine WASM SHA256: `2c19bf098841bb23a13b6d160c73a8b9866b616322a22d2e5812a9482cb40a18`; timer engine: `c275122dceee78647d9370b71979fa9a2f7c175805f76e1fc100b8d9cf2abdd1`. `provenance.sha256` retains original input archive, compile database and affected source hashes. `build.sha256` retains header and clean engine identities; compile/link scripts retain exact flags, archive members and baseline object paths. The frozen frontend is `v250-export-align/candidate`, with only its two engine files replaced in private app copies.

Tree raw/executable SHA256: `d42fda7c0b3359a4dad06264f9241bf46a65e5e218bd72bce63c9edb667d8268` / `dd04eb31051d70340a93dac0af5d952e47a2ec2612d4c0c3f4bea558dc45c12e`. Bracket raw/executable: `98cde88b2647eea2078fb749a92781f1caba5f2256fa92bc3ba89af54db932c9` / `e0992f3ce802c0946f9da180c00ff16520c01637b13ad3c7142099f93f756734`. Full configuration hash on both: `2ad0cc2b4df031c50fc13ffa58b7e3de2fbcf4460f2d751c13f67f4f6c46b2c6`. Original native executable SHA256 remains `9c42194b612e85b29ec269124d8f1b83d768f3e8a3dfdfb65e26625942e947cc`; original native tree raw G-code SHA256 is `98fb196c5b588328be0bc26aea3b132b5ffa3589dbe739524f25605c0807307b`.

Run evidence scripts from this worktree under `flock /tmp/weborca-parity-benchmark.lock`: `build.sh`, `focused.sh`, `fixtures.sh`, `timing-build.sh`, `timing-run.sh`, `run.sh I`, `run-bracket.sh I`, `analyze.mjs`, `affinity-run.sh`, `native-check.mjs`, `affinity-analyze.mjs`, in that order (prefix shell scripts with `bash`, JS with `node`). Preserve existing destinations before a repeat; app engines and outputs are immutable qualified evidence. Native linking retains existing TBB LTO warnings; Emscripten reports its existing MEMORY64 deprecation and pthread/memory-growth advisories. They did not prevent compilation or tests. `git diff --check` and shell/JS syntax checks pass. No Lily expansion was needed: the local policy is unchanged, the full tree changes exactly match the previously qualified candidate, and the shared bracket has zero changes.

Taproot receipts are `tracking-ops.json`, `tracking-receipt.json` (version 107), and `taproot-after.json`: bounded qualification is done, parent release review is open. Recursive completed-subtree collapse found zero further branches requiring updates (`collapse-ops.json`). README and KNOWLEDGE carry this decision. Existing dirty reports/harnesses and the other upper-wall investigation were preserved. Own code files are the production stitch header, root CMake option/registration, and `wasm/tests/native-stitch/{CMakeLists.txt,native_stitch.cpp}`; `product.patch` and `tests.sha256` retain the review delta and test identity.
