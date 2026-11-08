# Arachne internal stitch cause — 2026-11-08

The two validated narrow-solid raw endpoint differences first occur in `PolylineStitcher::stitch`, when it accepts the first eligible endpoint within snap distance and stops visiting candidates. Native and WASM choose opposite ends of the same tiny segment. Ordered preparation and skeletal output match exactly. No product correction, deployment, commit or speed improvement is established.

## Provenance and gates

Worktree `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`; ignored evidence [arachne-internal-cause-20261108](../../wasm/build/arachne-internal-cause-20261108/). The [preceding report](narrow-infill-native-cause-20261108.md) owns the 34 original fixtures and unchanged original installed GUI reference. Its prebuilt clang21/O1/libstdc++ native helper remains supplemental; complete archive provenance and original GUI internal junctions are not established.

Copied `WallToolPaths.cpp` was compiled with each build's actual `compile_commands.json` command, retaining flags and adding original include directories. Private archives replace the original `WallToolPaths.cpp.o` member. Native reuses the prior helper link command and dependencies. WASM additionally replaces copied `FillConcentricInternal.cpp` to enable a thread-local probe only for the two selected heights. A second copied-header probe instruments `PolylineStitcher.hpp` through that same TU. Initial private archive naming and printf format errors were corrected before successful compile/link and application verification; failure logs are diagnostic only.

`preview_status` returned unavailable/no tab. The explicitly authorized existing driver ran headed `/opt/helium/helium`, original normal STL import, Keep original, preset selection/arrange, Slice and Export. Each of two probe revisions used its own full app capture; `stage-I/ui` preserves the first, `I/ui` the second. Owned browser/server sessions closed. Original samples, earlier evidence and frozen candidate remain preserved. Every build/link/slice/comparison acquired exclusive `/tmp/weborca-parity-benchmark.lock`.

Both full-app gates pass complete executable commands including M73, full configuration block, ordered vertices/facets and serialized matrices against shipped capture. Executable digest remains `2bd5a75dfc493e62ec012a59d0e578cdc90f9eb8b33060a2220216330275277d`; final instrumented WASM digest is `89d3177e4dab8e03852d8809bf4cc3fe336792c5f76d9aa3889d95a3ad356aaf`.

`compare.mjs` checks complete ordered captured polygon/config/generator records against the previous capture. Thread scheduling changed call-block order: new blocks 0/1/2 map to original 1/0/2, verified by those records. Polygon and junction order within each call is preserved. All 34 native stdout replays match previous native results exactly; each fixture is executed twice during comparison. No new minimal WASM kernel substitutes for the application.

## First unequal stage

Every fixture matches at ordered prepared outlines after union and at all ordered generated groups/junctions/widths immediately after `wall_maker.generateToolpaths`. Exactly two fixtures differ immediately after `stitchToolPaths`. The other 32 match at every recorded stage. Prune, separate and simplify preserve the differing endpoint. Trace files are `fixture-<original-block>-<polygon>.{native,web}.trace`; `comparison.json` gives the first differing line. Width remains 340000.

| Original fixture | Tiny generated segment A → B | Native chosen endpoint | WASM chosen endpoint |
| --- | --- | --- | --- |
| Z55.4 block1 polygon0 | (12891714,23278350) → (12895141,23278901) | line41 point1 B; distance3471 | line41 point0 A; distance0 |
| Z56.8 block0 polygon15 | (27304637,-6761948) → (27305601,-6764588) | line3 point1 B; distance2810 | line3 point0 A; distance0 |

These choices occur while extending in reverse direction. Snap distance is exactly 10000, max stitch distance 357078. Native visits the unprocessed tiny line's point1 first. WASM first visits the already processed parent endpoint, rejects it, then visits the unprocessed tiny line's point0. Both pass connectivity and reverse eligibility. Both execute `dist < snap_distance`, returning false from the candidate callback immediately. Thus native never compares the zero-distance alternative before choosing B.

For point1, stitching takes `rbegin()`, advances once because segment distance is below snap, and appends the remaining A. For point0, it takes `begin()`, advances once, and appends B. Native therefore retains A as the final endpoint (duplicated before simplification), while WASM retains B. These are precisely the two prior raw differences, before conversion/rotation/clipping. Native `.native.stitch` and full app `I/ui/console.log` record candidate visitation and chosen endpoint inputs and branch operands.

`SparsePointGrid::insert` inserts endpoints in identical generated line order. `SparseGrid::processFromCell` visits `std::unordered_multimap<GridPoint,Elem,PointHash>::equal_range` in container order. Both endpoints lie in the same grid cell in each example. The observed enumeration differs; early acceptance converts that enumeration into an orientation decision. This is concrete container-order dependence, with identical integer geometry and thresholds, rather than evidence for a floating precision or libmath correction. No differing numeric calculation or Voronoi predicate is implicated by these captures. No timing claim follows from instrumentation, and this stitch result does not establish the measured scalar Voronoi/extended-integer speed hypothesis.

## Reproduction and remaining work

Run from the worktree, preserving existing capture destinations before rerunning the application:

```sh
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/arachne-internal-cause-20261108/build.sh
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/arachne-internal-cause-20261108/run.sh I
flock /tmp/weborca-parity-benchmark.lock node wasm/build/arachne-internal-cause-20261108/acceptance.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/arachne-internal-cause-20261108/compare.mjs
```

Copied affected TUs compile and private helpers/engines link. Shell and JS syntax checks and `git diff --check` pass. Product source is unchanged. The final comparison rechecks all 34 controls and exact native baseline stdout. Diagnostic stderr is deliberately excluded from output gates.

Next: define a geometric stitch-selection rule and independent native/WASM oracle for this tiny-segment ambiguity, then test it as a copied-source candidate. Merely choosing the closest endpoint reproduces current WASM here, so it cannot be assumed to restore native. Emulating incidental native hash iteration is not a correction. Any proposed portable rule must first reproduce original GUI residual groups, all 34 fixtures, full tree commands/config/geometry and the bracket control before product recommendation. Downstream variable-width/E group attribution and the two upper wall traversal groups remain open. Strict executable parity, six GUI state differences and native slicing speed remain open; previous TBB preinitialization and selected-TU SIMD experiments remain negative evidence.
