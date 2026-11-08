# Original GUI tree residual controls — 2026-11-08

The shipped tree's remaining commands are **unaffected by all three existing isolated upstream restorations**: Fill sort (A), random mapping (B), and perimeter endpoint iteration (C). Fresh full headed Helium exports match the captured web executable hash exactly, including M73. No product correction is supported by these controls. Strict original-native parity remains open.

## Correct reference and scope

Worktree `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`. Read its AGENTS, KNOWLEDGE, diagnosing-bugs and writing-for-agents skills, [source controls](bracket-source-cause-20261107.md), [wall controls](wall-traversal-cause-20261107.md), [compatibility investigation](upstream-compatibility-20261108.md) and [actual original desktop GUI tree evidence](desktop-tree-parity-20261108.md). The last report supersedes the historical CLI interpretation of a dominant original-GUI import normalization defect.

Reference G-code is `wasm/build/desktop-tree-parity-20261108/desktop-original.gcode`, from installed Flatpak source `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`, binary SHA256 `9c42194b612e85b29ec269124d8f1b83d768f3e8a3dfdfb65e26625942e947cc`. Captured web reference is exactly `wasm/build/sample-parity-cause-20261107/tree-project/obj_1_Ribbed_Christmas_Tree_Flat_48_stl.gcode`. Original STL hash remains `47b5811659d769576c9a1139c3085de27f4c208829839fdfa12486f47b019556`.

Original desktop and web STL saved geometry agrees in all ordered float32 vertices, facets and serialized transforms. Travel residual is +0.01915875 mm, not the historical −2165.54 mm CLI gap. Extra native project-reload recentering changes float coordinates and would move away from original GUI evidence. None of these controls reopens a project as a substitute for original STL import.

All seven original CLI-versus-GUI metadata fields agree with actual desktop GUI. Cool Plate/35°C agrees. Six explicit effective-config differences remain: multi-bed support and its override provenance, AMS inventory, nozzle inventory, disabled-tower X/Y. The desktop report retains source gates and native high-temperature/Cool Plate toolpath equality. These constrain the mismatch but do not establish complete live state equivalence.

## Controlled full-app loop

All new artifacts are under ignored `wasm/build/tree-residual-cause-20261108/`. `run.sh` copies the frozen full app `wasm/build/v250-export-align/candidate`, replaces only the saved diagnostic engine in that isolated copy, and launches its own server on localhost:5093. No frontend build was performed. Original candidate, archived engines, inputs and G-code remain intact.

T3 `preview_status` returned `available:false`. The copied existing `driver.mjs` uses actual headed `/opt/helium/helium` with fresh isolated profiles and observes worker messages passively. Normal `#model-file` import → Keep original → source process/filament selection → app placement → Save project → Slice Plate 1 → File/Export G-code is used. It does not call engine APIs. Same original-STL workflow as the captured baseline is used; import's app arrangement is retained. Browser/version, screenshots, import/slice event timestamps, saved geometry and full config remain beside each export. These timestamps are observations, **not speed benchmarks**.

Every run, compile/link and CPU-heavy comparison acquires exclusive `flock /tmp/weborca-parity-benchmark.lock`. Run sequentially from the worktree root, using new output destinations when reproducing:

```sh
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/tree-residual-cause-20261108/run.sh baseline
flock /tmp/weborca-parity-benchmark.lock node --max-old-space-size=12000 wasm/build/tree-residual-cause-20261108/check.mjs
# Baseline equality must pass before testing variants.
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/tree-residual-cause-20261108/run.sh A
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/tree-residual-cause-20261108/run.sh B
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/tree-residual-cause-20261108/run.sh C
flock /tmp/weborca-parity-benchmark.lock node --max-old-space-size=12000 wasm/build/tree-residual-cause-20261108/check.mjs
```

The baseline check passed before A. Fresh baseline and captured web have the exact executable SHA256 `2bd5a75dfc493e62ec012a59d0e578cdc90f9eb8b33060a2220216330275277d`, including M73. Complete CONFIG_BLOCKs match byte-for-byte. Saved vertex and triangle tags match; component and instance transform tags agree. `check.mjs` asserts these controls. The actual desktop executable hash is `4a1e0166df5e9ddbcff33a77988bc380a86cff4c63c679c0c34b71578f394fab`. The native-versus-web comparison is a persistent red signal; equal baseline control is not native acceptance.

## Predictions, engine identity and results

Ranked falsifiable hypotheses: A should alter the solid residual if either restored Fill tie sort is responsible; B should alter it if the restored random distribution is responsible; C should alter the two upper wall groups if canonical endpoint selection is responsible. Each changes one source policy. No other engine operation is swapped.

All JS files hash `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7`. Before each experiment, `engine.sha256` records the app engine and `app.diff` verifies only its WASM differs from the frozen full UI. Existing source patches and build provenance remain in the linked A/B/C reports.

| Engine | WASM SHA256 | Tree change from fresh shipped baseline |
| --- | --- | --- |
| Baseline | `452c0ab51a0b935f691384e629d73ad0005fda99733b059d18cc600c0d4c1f19` | Control |
| A: two Fill stable sorts → upstream sort | `af09b9c31019fe88a12e71aa51c264075527d15950674a61c210a4fe093572f0` | Zero executable commands, including M73 |
| B: bounded mapping → upstream distribution | `cd370458a5815ad38445d8c644edcd348a42489250cbab57f7dcd0e3f90e5bfd` | Zero executable commands, including M73 |
| C: canonical endpoint → upstream map iteration, plus saved logs | `8d910623c006728d14789a734b721b08c2eed030cc199f66c66c046f414dfa1d` | Zero executable commands, including M73 |

`results.json` contains full command counts/hashes, exact positional differences and ordered directed deposition/E hashes per layer and role. Every variant has 1,284,474 deposition moves and 1,372,656 comment/M73-filtered commands. Positive deposition E sums are native 40585.07048998099 mm and baseline/A/B/C 40585.07067998099 mm (floating accumulation; not physical volume proof). No directed deposition/E group changes anywhere in the tree. Raw files retain timestamps, thumbnails and config; raw equality is not claimed.

The native residual remains exactly 15 filtered positions:

- Three solid geometry/E commands: one at Z55.4 and two at Z56.8. First ordered deposition divergence is index 582,579, `(162.585,173.259,55.4)` → native `(162.852,173.276,55.4)` E0.00760 versus web X162.855 E0.00770.
- Two inner-wall traversal groups at Z149.0 and Z149.8: each has one approach travel and five reordered moves. Approach Z is 149.4/150.2. These trace identical tiny closed segment sets; the undirected multiset comparator cannot detect their order/direction residual.

All three solid commands and both wall groups survive A/B/C unchanged. Combining these restorations has no specific predicted improvement and was therefore not tested. The bracket controls remain separately informative: A fixes three sparse groups but worsens global segment agreement; C fixes two traversal groups but creates a Z12 traversal difference; B changes other paths without fixing bracket sparse/walls. Native matching is the priority, but these measured regressions prevent treating upstream-expression restoration as an established product fix.

Including M73, native and web each have 1,373,125 executable commands with **80 differing positions**. Filtering M73 removes 65 differences; it is a diagnostic filter, not exact acceptance. Each variant still matches web including those progress commands.

## Remaining operation and next native compatibility work

The first solid residual's nearby emitted width tags are 0.395303, 0.440201, 0.415738 and 0.391974. The final differing command follows width0.391974 and identical speed F10524.071. This is a geometric endpoint/E difference, not merely reordered G-code text. `internal_solid_infill_pattern=monotonic` alone does not identify its generator: `detect_narrow_internal_solid_infill=1` can send narrow solids through `ipConcentricInternal` in `Fill.cpp::group_fills`, then Arachne and `variable_width`. The existing A/B probes do not isolate that path.

### Copied-source stage probe

An initial copied `FillBase.cpp` probe (T) produced no points in this stage at Z55.4. Broadening its coordinate filter still produced no points. Source inspection establishes that `FillConcentricInternal` overrides `fill_surface_extrusion`; the general Fill method is not this narrow-solid seam. These negative probes remain in T, with the first capture retained as `ui-narrow/`. They are not evidence that the geometry was absent.

U instruments only a copied `FillConcentricInternal.cpp`, immediately before and after `variable_width`, at Z55.4. `u-build.sh` extracts the original TU compile command, copies the original archive, replaces only that object, and links existing objects. Both this TU and the earlier T TU compiled/linked under the shared lock. T required a second compile after the empty coordinate-window capture; U compiled once. No frontend or product source was changed. The saved patches can be recovered by diffing each copied source against its original. U WASM SHA256 is `9721de2e08bb506935806a398641398708572e8189bb43c19413e64743b92aea`; JS remains the baseline hash. Run U through the same locked `run.sh U` command after `flock /tmp/weborca-parity-benchmark.lock bash wasm/build/tree-residual-cause-20261108/u-build.sh`.

`U/ui/console.log` captures the actual operation/input order and float values:

```text
concentric-before z=55.400000000000247 path=42 point=4 xy=12585235,23259042
concentric-before z=55.400000000000247 path=42 point=5 xy=12855222,23276343
concentric-after  z=55.400000000000247 path=97 point=0 xy=12585235,23259042 width=0.39197438955307007 mm3=0.069810807704925537
concentric-after  z=55.400000000000247 path=97 point=1 xy=12855222,23276343 width=0.39197438955307007 mm3=0.069810807704925537
```

With the object's 150mm placement these integer coordinates predict emitted `(162.585,173.259)` → `(162.855,173.276)`. Thus the web endpoint already differs from the native emitted endpoint **before variable-width conversion**; that conversion preserves the actual endpoint. Native's internal endpoint was not captured, so its unrounded coordinate must not be invented from X162.852. The probe localizes the web endpoint's origin to the input of conversion, not to G-code decimal formatting. `FillConcentricInternal.cpp` and `Arachne/WallToolPaths.cpp` have no diff from manifest source (`concentric-upstream.diff` empty); that source equality alone does not establish input/build equality.

The exact responsible operation is still open. The next matched installed-native/copied-native and WASM capture should compare `no_overlap_expolygons` ordered coordinates, Arachne raw junctions, rotation/start selection and `ThickPolyline::clip_end` before the observed conversion input. This distinguishes generated geometry from clipping without assuming a library explanation. Preserve scaled integers, input order and full-precision width/flow values; only after locating the first differing operation can an exact cross-platform implementation be specified. For the two wall groups, capture the closed-loop junction order and start selection at Z149/149.8; the existing C open-endpoint operation has now been experimentally excluded for this tree.

No product change is proposed. Before any actual patch, require exact meaningful commands including M73 on this original GUI tree baseline and the explicitly labeled bracket shared-project control (or a new actual GUI bracket baseline), account for all regressions, and compile affected TUs. No old 3MF/lily/performance suite was added absent a concrete risk.

## Verification and limits

`check.mjs` passes baseline command equality, complete config equality, ordered saved geometry and transform assertions for baseline/A/B/C/T/U. Both T and U reproduce the captured executable hash including M73 and every directed deposition/E group; instrumentation caused no observed output change. JS/shell syntax checks and comparator self-checks passed. An explicit native acceptance assertion against `results.json` returned exit1 with `native acceptance: 15 differing filtered positions`, as expected. Copied-TU behavioral checks use the same full headed app and compare the entire output. The existing deposition comparator's limits remain: linear positive-E moves, 0.001 mm multiset quantization, no collinear merging or physical-volume proof; exact command and directed/E comparisons are separate. Saved XML does not prove every live arithmetic bit. Source/build versions differ between installed native and WASM; this report preserves that provenance without attributing the residual to a generic toolchain.

Only this report, KNOWLEDGE, README and new ignored diagnostics are owned by this task. No product edits, commits, pushes or deployments. Owned browser/server sessions were closed. Taproot versions101/102 retain strict parity and precise remaining actions as open; completed controls carry evidence. A recursive completion audit found no expanded branch with all descendants complete; completion statuses were preserved. No secrets are included in report or tracking evidence.
