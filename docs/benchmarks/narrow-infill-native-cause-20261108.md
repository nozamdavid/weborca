# Narrow solid infill: paired native/WASM stage replay — 2026-11-08

Identical ordered integer polygon inputs produce different **raw Arachne junctions** in a supplemental native process and actual headed Helium. Rotation/start selection and end clipping are downstream of the difference. Two native-helper clipped endpoints round to the installed original GUI's residual endpoints. This is a generated-geometry divergence at `WallToolPaths::getToolPaths`, not evidence for an import correction or G-code rounding adjustment. The internal operation within `generate()` remains unresolved; no product correction is justified yet.

## Reference and scope

Worktree `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`. Read AGENTS, diagnosing-bugs, KNOWLEDGE and the desktop-tree-parity, tree-residual-cause and slicing-performance reports dated 20261108. No CONTEXT.md exists at the root. This task owns this document and ignored diagnostics only. Original inputs, prior evidence and frozen candidate assets were preserved. No policy A/B/C reruns, project reload normalization, upper-wall investigation, speed trials, product edits, deployment, commit, push, README/KNOWLEDGE or Taproot changes.

Original installed GUI reference remains `wasm/build/desktop-tree-parity-20261108/desktop-original.gcode`; shipped web reference remains `wasm/build/sample-parity-cause-20261107/tree-project/obj_1_Ribbed_Christmas_Tree_Flat_48_stl.gcode`. The native executable was rehashed unchanged: `9c42194b612e85b29ec269124d8f1b83d768f3e8a3dfdfb65e26625942e947cc`. The six previously documented GUI state keys remain unequal. The helper below is supplemental diagnosis, never a replacement original-native benchmark.

## Actual application capture

Evidence root: [narrow-infill-native-cause-20261108](../../wasm/build/narrow-infill-native-cause-20261108/). `W/src/FillConcentricInternal.cpp` is a copied TU. Its tagged probe serializes the selected calls with a diagnostic mutex and records complete ordered `no_overlap_expolygons` contours/holes as scaled integers, flow/spacing/layer/clip/nozzle values, explicit generator settings, raw junction order and widths, converted polylines, nearest start index/last position, and pre/post clipping points and widths. The height filter selects Z55.4 and Z56.8 only. No arithmetic or path selection expression was changed.

`preview_status` reported unavailable/no tab. The explicitly authorized existing driver launched its own headed `/opt/helium/helium`, imported the original STL through the normal model input, chose Keep original, selected presets/arranged, sliced, saved geometry and exported G-code. Passive worker observation was retained. Browser reports Chromium 156.0.8078.79, hardwareConcurrency 14, AMD RX9070. Port 5097 and private isolated app state were used. Owned browser/server sessions closed at completion.

`W/ui/console.log` contains three complete calls (two at Z56.8), yielding 34 independent ordered polygon fixtures. `compare.mjs` serializes them without coordinate rounding, sorting, rotation normalization or float truncation. Its stage-id adjustment subtracts only the preceding polygon's path count for local comparison; junction order and all coordinates/widths remain intact.

Captured common values: spacing `0.35707962512969971`, scaled spacing 357079, clipping 40000, layer height `0.20000000000000284`, flow width `0.40000000596046448`, flow height `0.20000000298023224`, mm³/mm `0.071415930986404419`, role 5. Generator values include min bead `0.34000000357627869`, min feature `0.10000000149011612`, transition length `0.40000000596046448`, angle 10, filter deviation `0.10000000149011612`, distribution 1, wall inset 0, equal outer/inner spacing. Loop limits are 155 for the target Z55.4 polygon and 21 for Z56.8 polygon15.

Unassigned generator defaults are source-defined in `WallToolPathsParams`: min_length_factor 0.5f, is_top_or_bottom_layer false, resolution scaled(0.5), deviation scaled(0.025). These defaults were not separately logged at runtime; both helper and capture construct this same type and assign only the six explicit settings above. Complete exported configuration equality is checked separately.

## Native inspection and controlled replay

`file` identifies the installed Flatpak ELF as stripped. `nm -D -C` exposes none of FillConcentric/WallToolPaths/ThickPolyline. `readelf` finds `.gnu_debuglink` naming `orca-slicer.debug`, but the installed `files/lib/debug` is empty and a search beneath the user Flatpak installation finds no such file. No debugger attachment, executable replacement or native GUI reslice was performed. This does not rule out obtaining external matching debug symbols later.

`replay.cpp` reads one captured fixture, calls real Arachne `WallToolPaths`, converts its actual junctions, applies the original closed-path nearest-index/rotation expressions, then calls actual inherited `Polyline::clip_end`. It uses the prebuilt `orca-v250-native-clang` archive/dependencies; this build's cache specifies Release and clang++-21, with effective TU `-O1 -DNDEBUG -stdlib=libstdc++`. Its retained link wrapper uses g++ for GCC-LTO dependency compatibility. This is distinct from Flatpak LLVM21/Release/GNOME50. The selected WallToolPaths object predates this investigation (2026-11-07). No clean native GUI build was attempted. Manifest source comparison for `WallToolPaths.cpp` and `Polyline.cpp` is empty (`source-control.diff`), as is the earlier FillConcentric source comparison. This establishes selected source equality, not provenance for every prebuilt archive member.

## Paired operation evidence

`stage-comparison.json` records 34 fixtures: 32 match byte-for-byte at all replayed stages; only the two target fixtures differ. In both, exactly one raw junction position changes, with unchanged raw width 340000. Subsequent converted/preclip points carry the same raw difference. Start choices/order and every other replayed coordinate/width match.

| Fixture / stage | Native helper integer XY | Actual Helium integer XY |
|---|---|---|
| Z55.4 block1 polygon0, raw path33 last junction | 12891714,23278350 | 12895141,23278901 |
| Z55.4 same path, after clip | 12851793,23275835 | 12855222,23276343 |
| Z56.8 block0 polygon15, raw path1 last junction | 27304637,-6761948 | 27305601,-6764588 |
| Z56.8 same path, after clip | 27291950,-6724013 | 27292906,-6726655 |

Z55.4's preceding raw junction is identically `(12585235,23259042)` with width 349054. Its native clipped endpoint plus the established 150mm placement gives `(162.851793,173.275835)`, rounding to original GUI `(162.852,173.276)`. Web gives `(162.855222,173.276343)`, matching shipped `(162.855,173.276)`. Native Z56.8 clipped endpoint similarly gives `(177.291950,143.275987)`, rounding to original `(177.292,143.276)` versus web `(177.293,143.273)`.

These are 3427/551 and 964/−2640 **scaled-integer raw changes**, not a claim that a large floating coordinate has generic insufficient precision. Native internal original-GUI raw points remain uncaptured. Matching two rounded emitted endpoints supports the helper's relevance, but does not prove its complete native output or E values. The other Z56.8 residual command `(177.239,143.433)` / `(177.240,143.432)` and all three E residuals require downstream variable-width/export replay before claiming complete group explanation. Upper wall groups remain outside this evidence.

`Polyline::clip_end` casts points to doubles, computes `v.squaredNorm()`, tests distance², interpolates with `distance / sqrt(lsqr)`, and casts to coord_t. Here its inputs already differ. Identical fixture control therefore excludes earlier polygon input divergence as necessary to reproduce these **helper-versus-WASM** endpoints, and excludes clipping/rotation as their first divergence. It does not yet distinguish toolpath preparation, skeletal generation, stitching, pruning or simplification inside `WallToolPaths::generate()`.

## Checks, reproduction and next boundary

All compiles, links, full application slicing, and CPU-intensive comparison/replay acquire exclusive `/tmp/weborca-parity-benchmark.lock`; queued time is irrelevant and no timing claims are made. Copied WASM TU and native helper TU compile/link successfully. Shell and JS syntax checks pass. `acceptance.mjs` passes complete executable commands including M73, complete config block, ordered vertices/facets and serialized matrices against shipped web. Executable digest is `2bd5a75dfc493e62ec012a59d0e578cdc90f9eb8b33060a2220216330275277d`. W WASM SHA256 is `27a5a57eee3495c47f19f36fa84662176373cc686284d52fafb8c7d4e027d280`. Logs/fixtures remain ignored diagnostic artifacts; private credentials/state must not be published.

From this worktree, preserving existing destinations before any rerun:

```sh
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/narrow-infill-native-cause-20261108/build.sh
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/narrow-infill-native-cause-20261108/native-build.sh
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/narrow-infill-native-cause-20261108/run.sh W
flock /tmp/weborca-parity-benchmark.lock node wasm/build/narrow-infill-native-cause-20261108/acceptance.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/narrow-infill-native-cause-20261108/compare.mjs
```

Next specific probe: use these two exact fixtures to capture ordered prepared outlines immediately after `union_`, toolpaths immediately after `wall_maker.generateToolpaths`, then after stitch/removeSmallLines/separate/simplify. Compare native and WASM at the first unequal boundary. If prepared outlines match, instrument skeletal generation at that boundary; if they differ, split its polygon-preparation operations. Only attribute compiler/libmath/container behavior after that discriminating capture. No portable correction candidate is established by the present result.
