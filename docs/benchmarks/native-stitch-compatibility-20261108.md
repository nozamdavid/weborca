# Native stitch compatibility — 2026-11-08

An explicit newest-equivalent-insertion-first policy reproduces all 34 native fixtures and fixes the three original-GUI tree solid geometry/E commands. It preserves the shared-project bracket's complete executable output. The speed gate remains inconclusive: warm medians increased slightly. This is a measured copied-source candidate, not a qualified product patch. No deployment, commit or push occurred.

## Policy and provenance

Worktree `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`; ignored evidence [native-stitch-compatibility-20261108](../../wasm/build/native-stitch-compatibility-20261108/). Read AGENTS, KNOWLEDGE, diagnosing-bugs, [internal cause](arachne-internal-cause-20261108.md) and [paired fixtures](narrow-infill-native-cause-20261108.md). The established cause makes another hypothesis survey unnecessary. The user's original-native compatibility priority supersedes the previous report's blanket rejection of reproducing native container ordering.

The installed original GUI remains the reference, with source manifest `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19` and executable SHA256 `9c42194b612e85b29ec269124d8f1b83d768f3e8a3dfdfb65e26625942e947cc`. Existing native expected fixture files were read unchanged; candidate helpers did not regenerate them. The helper's supplemental provenance limitations remain those of the preceding reports.

Phase-one copied-header instrumentation records actual insertions and complete grid iteration, including every duplicate cell. Native libstdc++ visitation matches reverse insertion order for all 316 cell groups / 434 endpoints / 112 multiply occupied cells across 34 fixtures. Native stdout matches every saved expected output. In actual Helium baseline WASM all 112 multiply occupied cell groups differ from that policy; candidate WASM has zero unequal groups. Complete ordered insertion signatures match across native and both application captures (`order-result.json`, `web-order-result.json`). This checks actual groups rather than assuming a standard-library label implies an order.

The sole policy change in copied `src/PolylineStitcher.hpp` replaces its local point grid with an unordered map from cell to endpoint vector. Insertions append; each cell visits its vector in reverse. Cell hash-table iteration never selects a candidate: lookup uses the existing `SquareGrid::processNearby` cell enumeration. Callback eligibility, processed-point rejection, snap early exit, arithmetic, geometry, kernel and clipping are unchanged. Stitching never erases grid entries; vector addresses do not escape, and population completes before traversal. There is no sorting or coordinate/material/layer-dependent policy. Inherited coordinate filters in diagnostic logging are probes only, not candidate selection rules. No global SparseGrid semantics change.

`probe-src`, `probe-replay`, `probe-engine`, and `probe-I` preserve the pre-policy capture. `src`, `replay`, `engine` and `I` hold the candidate. Both affected copied TUs compile with the existing compile_commands flags and private archives link; native replaces WallToolPaths, WASM also retains the previous FillConcentricInternal capture probe. Original archives and shipped sources/assets remain preserved.

## Actual application fidelity

The shared preview tool returned `available:false`; the authorized existing driver used headed `/opt/helium/helium` with isolated profile and original normal STL import → Keep original → presets/arrange → Slice → Export. Probe export preserves all baseline commands including M73, complete config, ordered vertices/facets and serialized matrices. Candidate preserves the same config and geometry. Owned browser profiles and servers close after each batch. Every compile/link/slice/analysis batch acquires exclusive `/tmp/weborca-parity-benchmark.lock`.

All 34 candidate native stdout fixtures match saved native expected files. All 34 candidate actual-WASM ordered preparation/generation/stitch/prune/separate/simplify traces match native, including the two previously unequal stitch outputs (`comparison.json` is entirely equal). The chosen endpoint distances remain 3471/2810; the policy does not choose the zero-distance alternative.

Against unchanged installed-original GUI tree export, complete executable positions differ **79**, previously **80**. Excluding M73 diagnostically, differences fall **15 → 12**. All three solid geometry/E commands now match original GUI exactly. Remaining deposition differences occupy only the two known upper wall traversal groups; counts remain 1,284,474 deposition segments. Net E changes from 40585.07067998099 to **40585.07048998099 mm**, exactly native's value. Full raw bytes are unequal.

All nine candidate-versus-baseline executable-position changes are accounted for: three corrected solid commands and six positions representing three M73/G1 adjacent swaps. Native-relative M73 position differences rise **65 → 67**, so 79 = 12 + 67. Progress remains part of the gate. The corrected paths feed the real downstream estimate; no estimate override or progress filtering was used. `results.json` retains exact command examples and directed deposition/E group hashes. There are no additional changed deposition groups. Six documented GUI project-state keys still differ from the original-tree reference; this is not a completely state-matched native reslice.

The separate bracket uses the fixed shared `ui-project/input.3mf` and installed-native `native-project/plate_1.gcode`, as in the preceding bracket controls. Candidate matches baseline **every executable command including M73** and all directed deposition/E groups. Native-relative differences remain 51,789/51,797 deposition segments, 98/106 differing segment keys and 16 groups (`comparisons.json`). This is a matching-input shared-project control. The different-state `sample-parity-gui-metadata-20261107/desktop-source.gcode` is not substituted as its oracle.

Candidate engine WASM SHA256: `5d219f92c910a0b8b587c6c073d3a1496c0664ecda71803640ff580d499226c9`. Its immutable app is reused for tree and bracket; no frontend build was needed. Lily was not resliced: the full tree shows only the predicted two solid groups changing, and bracket has zero changes. Original blocked 3MFs remain out of scope.

## Speed gate

The timing-only linked variant adds the existing aligned `Print.cpp.o` timer to the same candidate archive, preserving the untimed engine. Timer WASM SHA256: `6ba6654bd65c077a6bd3f419a9967412c73692cfa30a0d2b5dfbea0ff67c8f39`. Control uses the existing aligned-timer engine. No frontend rebuild or worker-only slice substitutes for actual Helium. Three sessions per side alternate control/candidate order; each session reimports the shared bracket project for a fresh slice and three warm fresh recomputations, Auto/eight threads. Analysis follows the exclusively locked timing batch.

Fresh aligned-region median: control **235.909888 ms**, candidate **227.710208 ms**. Fresh perimeter medians: **93.645056 / 88.579840 ms**. Warm region medians (nine per side): **87.480064 / 88.969984 ms**, a **1.70% increase**. Warm perimeter medians: **37.684992 / 37.784832 ms**, a **0.265% increase**. All 24 timed exports preserve baseline commands including M73 and complete config. Individual values/ranges are in `timing-summary.json`.

Host load/frequency are uncontrolled and observed ranges overlap. This batch does not establish a statistically resolved slowdown, a speed improvement, or a regression-free performance qualification. Native speed remains open; the earlier installed-native aligned median of 40.8 ms is historical context, not a new simultaneous native timing. The user requires a passed speed gate before product changes, so product promotion remains OPEN rather than treating overlapping measurements as proof of no overhead.

## Reproduction and boundary

From the worktree, preserve existing destinations before rerunning application captures:

```sh
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/native-stitch-compatibility-20261108/build.sh
flock /tmp/weborca-parity-benchmark.lock node wasm/build/native-stitch-compatibility-20261108/order-check.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/native-stitch-compatibility-20261108/web-order-check.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/native-stitch-compatibility-20261108/compare.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/native-stitch-compatibility-20261108/check.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/native-stitch-compatibility-20261108/bracket-check.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/native-stitch-compatibility-20261108/timing-check.mjs
```

The focused copied-source target `native-stitch-order` compiles, links and passes natively. It independently specifies the tiny-endpoint result with natural synthetic coordinates: a processed parent and two coincident origins, plus a 3000-unit tiny endpoint inside a 5000-unit snap radius. Its source and compile/link logs remain alongside the candidate. The first compile lacked the original utils include directory; that command was corrected before the passing run. Linking retains preexisting TBB LTO type warnings. This standalone target was not run in WASM; the 34 actual-app fixture gates supply WASM coverage. Full fixture and application gates cover all neighboring cells, skipped processed endpoints and unchanged neighbor-cell traversal. No product regression target is installed because performance qualification has not passed. A future product patch must carry a focused native/WASM regression test and compile all affected product TUs before promotion.

Verified decision: a portable explicit native visitation policy is viable and improves measured native fidelity. The vector-per-cell candidate is retained for review; speed qualification, remaining upper walls, six state keys and strict executable parity remain open. This report does not declare native compatibility impossible or authorize release.

Reviewable policy delta: [candidate.patch](../../wasm/build/native-stitch-compatibility-20261108/candidate.patch), relative to the preserved diagnostic header; copied implementation: [PolylineStitcher.hpp](../../wasm/build/native-stitch-compatibility-20261108/src/PolylineStitcher.hpp). Only this report, README, KNOWLEDGE and the new ignored evidence directory were written by this task. Existing dirty work was preserved. `git diff --check`, shell syntax checks and timing-check JS syntax pass. Taproot receipts are `tracking-receipt.json` and `taproot-after.json`: investigation/candidate measurement done, performance promotion and remaining parity open. Recursive complete-subtree collapse found zero additional branches requiring updates.
