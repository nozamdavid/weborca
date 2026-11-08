# Tree upper wall investigation — 2026-11-08

The captured upper inner walls are **open odd Arachne lines**, not closed extrusion loops. Native replay of the manifest's supported-endpoint selection and actual chaining reproduces the original GUI's opposite traversal at both target heights. Raw Arachne output matches exactly. The isolated endpoint counterfactual fixes exactly the twelve target positions; combined with the prior stitch candidate it matches **every native executable command including M73**. Complete G-code/config-state parity and speed qualification remain open. No product change was made.

## Evidence and reference

Worktree `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`. Read AGENTS, KNOWLEDGE, diagnosing-bugs and the desktop-tree-parity, tree-residual-cause, arachne-internal-cause, native-stitch-compatibility and bracket wall-traversal reports. No delegation, deployment, commit, push, shared documentation or product-source edits. Evidence root: [tree-upper-wall-cause-20261108](../../wasm/build/tree-upper-wall-cause-20261108/).

The original installed GUI oracle remains `wasm/build/desktop-tree-parity-20261108/desktop-original.gcode`. Web reference remains the original-STL `sample-parity-cause-20261107/tree-project/obj_1_Ribbed_Christmas_Tree_Flat_48_stl.gcode`. The CLI transform baseline and project reload are not substituted. Six exported GUI state differences remain as documented previously.

`preview_status` returned `available:false`. The existing driver was copied into this task's ignored directory and used headed `/opt/helium/helium`, normal original STL import, Keep original, presets, placement, Save project, Slice and Export. The full app was copied from the immutable shipped candidate; only engine WASM changed. Each server/browser session closed on completion. Private authentication state is excluded from this report. Builds, links, slices and CPU comparisons use exclusive `/tmp/weborca-parity-benchmark.lock`; concurrent stitch qualification sometimes held the lock first. These are not speed measurements.

Both initial P and expanded P2 probes preserve complete shipped executable commands including M73, full config block and ordered saved vertices/facets/matrices. P acceptance executable SHA256 is `2bd5a75dfc493e62ec012a59d0e578cdc90f9eb8b33060a2220216330275277d`. Acceptance scripts and JSON preserve the gates. P's original app is retained under `stage-P`; P2 retains the expanded endpoint capture. Probes change no path-selection expression.

## Incoming state and first replayed boundary

`incoming.mjs` asserts original native versus old web emitted XYZ, E position, feed, E mode and XYZ mode before both target approach commands. First target incoming state is `(150.305,150.720,148.8)`, F7200, relative E, absolute XYZ, E−0.8. Second is `(149.993,150.655,149.6)`, F7200, same modes, E approximately −0.80001. Earlier solid residuals do not change these incoming emitted positions. This is an emitted-state check; it does not assert every private GCode object field or timing accumulator equals native.

Actual perimeter capture verifies layer IDs **744 and 748**, corresponding to deposition Z149.0/149.8. `PerimeterGenerator.cpp` probes record ordered scaled input polygons, all `WallToolPathsParams` fields, outer/inner spacing, inset/count, layer height, raw junction coordinates/widths/perimeter indices, closed/odd flags, and post-clipping path coordinates/flow. `comparison.json` checks real native `WallToolPaths` output byte-for-byte against the actual app for both inputs. Both match, including junction order.

The native helper reuses the prebuilt clang21/O1/libstdc++ archive/dependencies documented in the narrow-infill report. `source-control.diff` is empty for current WallToolPaths and ExtrusionLine versus manifest `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`; `provenance.sha256` records selected source/archive hashes. Complete archive provenance and installed GUI internals are not established. The helper is supplemental evidence, never a replacement native GUI oracle.

| Layer | Raw odd line, ordered start → end | Width | Flags |
| --- | --- | --- | --- |
| 744 | `(24875,-46510)` → `(50991,-1277)` | 417848 | closed=0, odd=1, six junctions |
| 748 | `(35362,-61669)` → `(71694,1259)` | 581308 | closed=0, odd=1, six junctions |

Each line traverses five sides of a tiny hexagon; no closing sixth segment exists in this raw line. The complete tree's undirected segment agreement must not be interpreted as proof these are closed `ExtrusionLoop` objects. They follow the open `ExtrusionMultiPath` branch. Closed-loop seam rotation is therefore not the target operation.

P2 records one clipped supported path per line, with the same six coordinates and order. Layer744 flow is width `0.46076834201812744`, height `0.20000000298023224`, mm³/mm `0.083569593727588654`; layer748 width `0.62422835826873779`, same height, mm³/mm `0.11626160144805908`.

`endpoints.cpp` replays the captured path, actual `PointHash`/`std::unordered_map` insertion, manifest-source supported-endpoint loop and real `chain_and_reorder_extrusion_paths`. Both endpoints have occurrence1, overhang0. Insertion is first endpoint then last endpoint; native enumeration visits last then first. P2 WASM enumeration also visits last then first. The **selection expression**, rather than differing enumeration in this fixture, changes the result: canonical coordinate comparison selects the first endpoint; manifest early acceptance selects the last. No distance comparison or floating tie participates.

Native chained layer744 coordinates are `(50991,-1277)`, `(24875,43956)`, `(-27356,43956)`, `(-53471,-1277)`, `(-27355,-46510)`, `(24875,-46510)`. With placement150 they round to the original GUI approach `(150.051,149.999)` and five native moves. Layer748 similarly gives `(71694,1259)`, `(35362,64187)`, `(-37301,64187)`, `(-73632,1259)`, `(-37300,-61669)`, `(35362,-61669)`, matching GUI `(150.072,150.001)` and its five moves. Full integer output is retained in `endpoints-*.native.txt`; original E commands remain the oracle.

This establishes the earliest unequal **replayed** operation after matching raw output. Installed-native post-clipping internals were not observed. Agreement of replayed sequence with the original GUI supports this cause; the full-app counterfactual is needed to establish sufficiency and regression scope.

The selection depends on the path endpoints and supported flags, not incoming GCode XY or seam state. Submicron incoming native private position was not captured, but cannot enter this operation's branch or comparison. Full emitted incoming state matches independently. Raw coordinates and captured clipping output already predict both complete traversal sequences before GCode sees an entity.

## Historical C discrepancy and counterfactual

The archived C copied source does contain the upstream early-accept loop, and its reported tree executable output equals shipped web. That historical zero-effect observation conflicts with the newly captured boundary prediction. It is preserved, not silently discarded, and has not been rerun. This task does not claim to have explained the archived engine/capture discrepancy.

The new counterfactual changes only supported single-path/two-key endpoint selection to the last inserted endpoint, explicitly specifying native's observed two-key visitation outcome. It leaves other branches at baseline. This is a diagnostic compatibility scope, not a qualified general container policy. `candidate.patch` is relative to the preserved expanded-probe source. Product stitch files remain outside this task's ownership.

## Full-app counterfactual results

`counterfactual-check.mjs` passes: V changes exactly twelve comment/M73-filtered positions versus shipped baseline, all at the two original target groups, and all equal the original GUI. No added/removed command or other filtered path change occurs. Three original narrow-solid residual commands remain. V versus native has exactly three executable differences even **including M73**. Thus this isolated wall correction also brings progress placement back into agreement for this run, despite leaving the three small solid residuals.

J replaces only the perimeter object in a private copy of the **prior vector-per-cell stitch compatibility archive**, `native-stitch-compatibility-20261108/wasm64.a`. It does not alter the ongoing stitch qualification source/header/archive. The base archive hash is in `combined-base.sha256`. Full headed original-STL J capture has **zero differing native executable positions**, including M73, with native executable digest `4a1e0166df5e9ddbcff33a77988bc380a86cff4c63c679c0c34b71578f394fab`. `final.json` preserves complete comparisons. Both V and J preserve shipped config bytes and ordered saved geometry/matrices. Native's six known GUI config keys still differ; raw G-code equality is not claimed. All existing native executable deposition and travel commands, including their E fields, now agree in J; an undirected comparator is not the acceptance gate.

A bracket regression was justified because the endpoint predicate applies to other open walls. The combined engine's normal shared-project bracket replay retains **all 70,860 baseline executable commands including M73**, and complete baseline config. `bracket-check.mjs` passes with zero changes. This is the labeled shared-project bracket control, not a new original-GUI bracket oracle. No unrelated fixture suite or speed experiment was added.

`fixture-test.mjs` passes for layers744/748: canonical selection fails the native endpoint expectation; manifest selection plus actual chaining passes it. Copied PerimeterGenerator was compiled/linked for each probe/counterfactual; native replay and endpoint fixture TUs compile/link and execute successfully. Build/link logs retain existing Emscripten and dependency LTO warnings. `engines.sha256` retains immutable capture identities. Shell syntax and `git diff --check` pass.

Review delta: [candidate.patch](../../wasm/build/tree-upper-wall-cause-20261108/candidate.patch). [review.patch](../../wasm/build/tree-upper-wall-cause-20261108/review.patch) contains the same six-line addition with product path labels, corrected product line numbers and zero context; `git apply --check --unidiff-zero` passes without applying it. This two-key rule is deliberately narrow diagnostic evidence. Parent coordination must decide its final policy/test placement and performance qualification. No production patch, benchmark improvement or universal native container emulation is asserted. Owned browser profiles and servers were closed; private per-run authentication state files were removed.

Reproduction, from the worktree root, with existing capture destinations preserved before repeating full app runs:

```sh
flock /tmp/weborca-parity-benchmark.lock node wasm/build/tree-upper-wall-cause-20261108/incoming.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/tree-upper-wall-cause-20261108/acceptance-P2.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/tree-upper-wall-cause-20261108/compare.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/tree-upper-wall-cause-20261108/fixture-test.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/tree-upper-wall-cause-20261108/counterfactual-check.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/tree-upper-wall-cause-20261108/final-check.mjs
flock /tmp/weborca-parity-benchmark.lock node wasm/build/tree-upper-wall-cause-20261108/bracket-check.mjs
```

The historical C zero-effect conflict remains an archival reproducibility question. The specific follow-up, if needed, is to validate that archived engine's selected endpoint and post-chain output at layers744/748 against its archived source/object identity. Do not treat its zero-effect observation as a fresh localization result or repeat A/B/C speculatively. New actual-app baseline equality, exact integer fixtures and the one-operation full-app counterfactual establish this task's result independently.
