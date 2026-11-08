# WebOrca technical knowledge

Main human and agent entry point for engine/desktop parity and benchmark methodology. Updated 2026-11-08. This records observations, decisions and their limits; detailed reports retain reproduction commands and artifacts.

## Priority update — 2026-11-08

Native Orca executable G-code and slicing speed are the acceptance targets. The user prioritizes matching original Orca over custom determinism for reproducibility. Earlier unconditional retain-stable_sort, boundedRandom and canonical-endpoint recommendations are superseded as policy; their measurements and historical rationale remain evidence. The reassessment rows below are provisional hypotheses, not immutable requirements. A single upstream-expression revert has not established global equality, so changes still require discriminating controls.

The reference is installed Flatpak OrcaSlicer 2.5.0, manifest upstream `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`, executable SHA256 `9c42194b612e85b29ec269124d8f1b83d768f3e8a3dfdfb65e26625942e947cc`. Match exact source presets, inherited bases and complete project state. Acceptance requires the full actual headed `/opt/helium/helium` app import → Slice → Export flow. Worker-only execution cannot replace it.

Keep raw bytes (including timestamps and thumbnails) intact and report raw-byte equality separately. Executable parity compares meaningful commands exactly, including coordinates, extrusion, ordering and progress commands; diagnostic filters must be labeled. Equal travel totals or layer aggregates do not establish identical output. See [current compatibility investigation](docs/benchmarks/upstream-compatibility-20261108.md).

## Baseline and provenance

The recorded shipped baseline is CURRENT5070's `wasm/build/v250-export-align/candidate`. The [release report](docs/v2.5.0-integration/export-alignment-publication.md) owns publication, frozen inputs, integrity evidence and guarded rollback. The [root README](README.md) summarizes current release state; the [integration checkpoint](docs/v2.5.0-integration/README.md) owns accepted core/configuration/Preview/STEP checks and build-input links. Its older deployment paragraph is historical relative to the export-alignment release.

The [sample comparison](docs/benchmarks/sample-parity-20261107.md) owns exact sample hashes, Helium/Chromium versions, installed user Flatpak OrcaSlicer 2.5.0 identity, executable and shipped WASM hashes, trial destinations and instrumentation provenance. The [toolpath report](docs/benchmarks/toolpath-cause-20261107.md) records the Flatpak manifest's upstream source commit, LLVM21/Release/GNOME 50 and checkout snapshot. Installed native and WebOrca are distinct source/build baselines; naming the same upstream version does not establish build equivalence. `/tmp/orca-native` was not used.

Build artifacts and manifests under `wasm/build` are ignored local evidence, not a portable source release. Private alpha state, profiles and credentials remain outside published evidence. The [Taproot project](http://192.168.0.199:8789/p/YPttwK6VZASSDf) holds milestone state; completed investigations coexist with open strict parity work.

## Decision index

**Current publication — 2026-11-08:** [combined native compatibility acceptance](docs/benchmarks/native-compatibility-publication-20261108.md)
supersedes historical tree-residual and pending-release conclusions below. The live
immutable root is `wasm/build/native-compatibility-publication-20261108/candidate`,
WASM `df6c8b6aae6fd8ba1558bcff09c79240de45bd6d3728ddfbfc135096021d7d4a`.
The production small-vector stitch policy plus narrow supported-open-path endpoint
rule yield exact original GUI tree executable parity: 1,373,125 commands including
M73, local and authenticated public. Bracket preserves its 70,860 baseline commands;
this is not original bracket parity. Full baseline config and saved geometry pass.
New full headed Lily baseline/candidate and original installed-GUI Cool Plate/35°C
controls find 496 changed deposition groups: 309 newly exact sequences; directed
XYZ/E segment distance improves in 485 and remains equal in 11, with none worse.
187 changed groups remain sequence-unequal, so exact Lily parity remains open.
Six known native GUI state differences remain; no full native config-byte claim.
Public pair identity, protected access, asset bytes and old cached binary upgrade
to the new version followed by zero WASM transfer on warm refresh pass. Frozen UI,
Preview, STEP, profiles, recovery, painting and server remain intact. Guarded
rollback restores the Export alignment root. No commit, push or PR change occurred.
Original 3MF validation blocks and other browser/hardware coverage remain open.
This is a fidelity release: native-speed parity remains OPEN and the historical
possible 2–3 ms whole-region cost is not erased by the later +0.695 ms observation.
Indexed-chain storage remains rejected; no speedup or zero-overhead claim follows.

| Decision | Rationale and evidence |
| --- | --- |
| Match original native G-code and slicing speed | Current user priority; [2026-11-08 policy](#priority-update--2026-11-08) supersedes unconditional retention recommendations |
| Benchmark the actual full Helium UI | Worker-only runs omitted application import/state behavior; [methodology](#benchmark-methodology) |
| Match complete project state | Identical named presets and even identical source preset files leave GUI state unequal; [configuration](#configuration-parity) |
| Reassess stable infill ordering against native | Intentional portable tie order; reverting improves three groups but worsens overall agreement; [source controls](#intentional-determinism) |
| Reassess bounded Random mapping against native | Intentional cross-standard-library draws; reverting does not fix bracket walls/sparse infill; [source controls](#intentional-determinism) |
| Reassess canonical open-wall endpoint selection against native | Supported endpoints use coordinate order instead of unordered-map iteration; confirmed cause of the original bracket wall traversal differences; [endpoint control](#intentional-determinism) |
| Preserve original 3MF validation blocks | Original-file outcomes remain evidence; [project limits](#original-project-validation) |
| Keep strict parity and remaining connector cause OPEN | Original wall traversal cause is established; residual paths differ without a confirmed product bug; [open questions](#open-questions-and-evidence-limits) |

## Benchmark methodology

**Verified:** the [sample comparison](docs/benchmarks/sample-parity-20261107.md) drives headed `/opt/helium/helium` through the full app: import, preset selection, Slice and File → Export G-code. Projects use `#project-file-input` and the normal `openProject` workflow; low-level `loadModel` is insufficient for 3MF project settings, plates, embedded presets and overrides. STLs use `#model-file`; high-triangle imports choose Keep original. Passive worker-message observation supplies measurements, without direct engine calls. Synthetic worker-only results are superseded and excluded from app results.

Three STLs each have one warmup plus three fresh sequential trials per side. Both original 3MFs were attempted through project import but have no successful timing matrix. Host services, CPU frequency/affinity and active native thread count were uncontrolled. Web default was eight slicing threads.

**Timer boundaries:** slice-only and export are separate. Web's benchmark-only instrumented engine times the entire `print.process()` call with two steady-clock reads; export follows outside that timer. Installed native is unchanged: a file-buffer interposer timestamps `Starting the slicing process.` and `Slicing process finished.` before buffered writes. That native region excludes the function prologue. Buffered log arrival alone is not a precise timer. Neither timer includes import, settings, downloads, G-code export or printer-estimated print time. These boundaries do not justify an exact native/web function speed ratio.

Recorded native-region/web-process medians in milliseconds are bracket 39.4/228.2, tree 808.3/2050.0, lily 561.4/1129.0. The probe microbenchmark is not a Flatpak worst-case overhead bound; web clock overhead is uncalibrated. No sub-millisecond accuracy claim follows. All twelve instrumented outputs match corresponding shipped-app commands/configuration; text equality additionally requires timestamp and thumbnail removal. Instrumented timings describe a temporary build, not direct timing of the shipped engine. Exact ranges, commands and compile/link evidence belong to the sample report.

## Slicing performance follow-up — 2026-11-08

[Aligned-region profiling](docs/benchmarks/slicing-performance-20261108.md) supersedes the historical timer-boundary limitation for its new bracket trials: native and web use matching `Print::process` log-statement boundaries, excluding import, initialization and export. Recorded region medians are native 40.8 ms, fresh-app web 225.8 ms and warm fresh-recomputation web 85.1 ms. Reimport plus a new Print prevents cached-result reuse. Perimeters, infill and infill preparation dominate warm work. One thread is slower; sixteen has mixed startup/warm results and does not justify changing Auto. Native active-thread observations are not an exact simultaneous worker count. Host load and frequency remain uncontrolled; these are recorded measurements, not a universal speed ratio.

**Rejected runtime candidate:** [small TBB preinitialization](docs/benchmarks/first-slice-runtime-20261108.md) preserves commands and configuration but gives inconsistent first-slice improvement and no established initialization-plus-slicing gain. No production patch is justified by that experiment; moving work across the timer is not accepted as a speed improvement.

**Rejected compiler candidate:** [strict SIMD on the measured SkeletalTrapezoidation TU](docs/benchmarks/arachne-performance-20261108.md) emits actual SIMD and preserves commands including M73 and full configuration, but warm perimeter time does not consistently improve. It does not justify a SIMD production change or a claim that missing SIMD explains the gap. The next useful performance evidence should discriminate scalar Voronoi predicates/extended-integer costs; no such bottleneck cause or optimization is established yet. Both experiments used the full headed Helium app and copied-source/private engine variants. Production sources and shipped assets remain unchanged; native-speed parity stays open.

## Stitch production qualification — 2026-11-08

The [single indexed-chain storage alternative](docs/benchmarks/stitch-grid-cost-20261108.md) passes native/WASM regression, 34 fixtures per platform and full headed tree/bracket commands including M73, configuration and saved geometry. It is not promoted: 12 warm fresh imports per condition give small-vector/chain aligned medians 86.793/88.805 ms with mixed block differences. Production small-vector remains unchanged. Historical stage reanalysis finds the largest old-to-small-vector pooled stage difference in infill (+1.475 ms), so the prior 2–3 ms whole-region concern remains explicit; perimeter results alone cannot clear it. No native-speed-parity claim follows.

The [production report](docs/benchmarks/native-stitch-qualification-20261108.md) supersedes the earlier copied-source-only status. A minimal stitch-local `small_vector<Index, 2>` map preserves measured native newest-insertion-first order and existing neighbor/callback/arithmetic behavior. Clean native/WASM affected TUs compile; the synthetic WASM regression fails before and passes after, and 34/34 saved-native fixtures match per platform. Clean headed Helium tree/bracket commands including M73 and configuration exactly match the vector candidate. Tree remains 79 positions unequal to original native (12 excluding M73); all three solid fixes remain, with only two upper wall groups unequal.

Two separate three-session batches each have 21 warm samples per condition. Default pooled perimeter medians are 37.025/37.955 ms, affinity 39.415/38.500 ms; session differences change sign. No consistent meaningful perimeter slowdown is established, so retain the native-first product patch for review. Secondary aligned medians are 85.480/88.405 and 87.575/89.800 ms; a small whole-process cost remains possible. No speedup, absolute-zero-overhead or native-speed-parity claim follows. Parent release review remains required; no deployment/commit/push occurred. The historical copied-source paragraph below retains its initial measurements; this qualification supersedes its promotion status.

## Configuration parity

**Verified:** [producer/consumer tracing](docs/benchmarks/preset-metadata-parity-20261107.md) explains seven initial CLI/web differences as CLI-versus-GUI assembly. [Actual installed desktop GUI export](docs/benchmarks/desktop-gui-metadata-20261107.md), with complete source vendor files including inherited bases, confirms all seven match:

- Both omit `compatible_machine_expression_group`, `compatible_printers_condition`, `compatible_process_expression_group`, `different_settings_to_system` and `inherits_group` in this unedited selection.
- Both export `filament_multi_colour=#26A69A` and an empty `filament_plugin_config_overrides`.

**Decision:** retain GUI assembly and real override provenance. Empty groups need no fabricated export entries; genuine nonempty compatibility/inheritance and project override data remain meaningful. The two web fields exist in the installed schema. The earlier newer-schema explanation is disproven for these keys, and the seven-field residual is superseded as evidence of a web defect.

**Current tree state:** the [original desktop GUI tree control](docs/benchmarks/desktop-tree-parity-20261108.md) matches Cool Plate/35°C and all seven original metadata fields. Six differences remain: `different_settings_to_system`, `support_multi_bed_types`, AMS count, nozzle inventory and disabled-tower X/Y placement. Source gates and a native high-temperature/Cool Plate toolpath control constrain their effects, but do not constitute a completely state-matched reslice. The older High Temp/55°C mismatch describes the earlier desktop capture, not this current tree reference.

## Geometry and toolpaths

**Verified original GUI tree observation:** [desktop original STL evidence](docs/benchmarks/desktop-tree-parity-20261108.md) supersedes the historical CLI comparison as the native GUI reference. Ordered parsed float32 vertices, facets and serialized matrices match web exactly. Travel differs by only **+0.01915875 mm**; 15 of 1,372,656 comment/M73-filtered command positions differ: three solid geometry/E commands at Z55.4/56.8 and two wall traversal groups at Z149/149.8. The old −2165.54 mm gap does not establish a WebOrca import defect. Native project reload performs another float recenter, changing mesh values; adding it to original STL import would move away from the actual GUI evidence. Saved geometry equality does not prove every live transform bit.

**Current causal controls:** [tree residual investigation](docs/benchmarks/tree-residual-cause-20261108.md) reproduces the captured shipped commands exactly in fresh headed Helium, including M73. Reusing isolated A-sort, B-random and C-endpoint engines changes no executable tree command or directed deposition/E group. Those three operations therefore do not explain this tree residual; a combined variant has no predicted improvement. Their separate bracket effects remain valid. Exact native parity and the responsible tree operation remain open.

**First residual boundary:** a copied `FillConcentricInternal.cpp` probe records the web Z55.4 endpoint `(12855222,23276343)` in scaled coordinates before `variable_width`, preserved after conversion with width `0.39197438955307007`. It predicts emitted X162.855. Native emits X162.852; native internal unrounded coordinates remain unknown. Next compare ordered narrow-solid polygon inputs, raw Arachne junctions and end clipping before this boundary. This evidence supports neither an import recenter nor a G-code rounding correction. Including M73, 80 executable positions differ; the 15-position count explicitly filters progress.

**Verified bracket observation:** the same report controls identical serialized vertex values, facet order and component/instance transforms through saved-project replay. Substantive exported fields match apart from recorded bookkeeping and thumbnail formatting; complete config-byte equality is not established. Wall segment multisets match but directed traversal first diverges at Z=0.4. Sparse-infill connector choices differ across 11 layers. Native/web deposition segment counts are 51,789/51,797 with 98/106 differing segment keys. A one-thread web replay matches default-thread web output. This excludes web thread count for this bracket, without a native one-thread control or proof of identical native internal geometry.

## Intentional determinism

**Tree stitch compatibility, 2026-11-08:** [explicit visitation candidate](docs/benchmarks/native-stitch-compatibility-20261108.md) supersedes the earlier blanket rejection of native iteration compatibility. Actual native insertion/visitation traces verify newest-equivalent-insertion-first across 34 fixtures, 316 cells and 434 endpoints. A stitch-local cell/vector policy reproduces all native fixtures in native and actual headed Helium, fixes all three original-GUI solid geometry/E commands, and makes tree net E exactly native. Full executable differences improve 80 → 79, diagnostically M73-filtered differences 15 → 12; native-relative M73 position differences increase 65 → 67. Only the two known upper wall deposition groups remain unequal. Complete baseline config/saved geometry match; six native GUI state keys remain different. The shared-project bracket preserves every baseline executable command including M73 and all deposition groups. Warm region/perimeter medians increase 1.70%/0.265% with overlapping ranges; no performance qualification or native-speed improvement is established. Candidate remains copied-source only; product promotion stays open pending the speed gate and product regression test. Original installed GUI remains the oracle. Explicit portable native visitation is a valid compatibility direction under the user's priority.

**Historical decision (superseded as unconditional policy on 2026-11-08):** retain both policies. [Merge foundation](docs/v2.5.0-integration/merge-foundation.md) and [semantic review](docs/v2.5.0-integration/core-semantic-review.md) document stable sorting of infill arc costs and contour candidates to preserve portable tie order while retaining upstream's join-count algorithm. These historical source reviews are not themselves runtime qualification; the integration checkpoint records subsequent verification and the cooling fallback correction.

**Verified controls:** [bracket source experiments](docs/benchmarks/bracket-source-cause-20261107.md) compile/link isolated WASM variants and replay the full Helium UI against the fixed saved project. Baseline re-link matches shipped JS/WASM bytes. Reverting the two `stable_sort` calls to upstream `sort` makes complete directed sparse-infill groups match native at Z=1.8, 5.2 and 10.4, but worsens overall differences to 113/124 segment keys and leaves every wall sequence unchanged. This establishes a partial connector cause, not justification for reverting portable ordering.

`Random::uniform_bounded` intentionally defines GNU libstdc++ Lemire mapping and draw consumption across standard libraries; fixed draw/boundary/shuffle fixtures are in [test_random.cpp](tests/libslic3r/test_random.cpp). Restoring `std::uniform_int_distribution` changes solid/bridge/surface paths but leaves the existing wall and sparse-infill discrepancies intact. Those fixtures were inspected, not newly run in the source experiment. Copying an upstream expression or a library's incidental ordering does not establish cross-platform parity. A canonical ordering/mapping policy shared by both builds would require its own specification and geometry/extrusion checks if exact paths become a requirement.

**Verified endpoint control:** [wall traversal investigation](docs/benchmarks/wall-traversal-cause-20261107.md) isolates the original bracket wall-direction differences to open-wall endpoint selection in `PerimeterGenerator.cpp`, after path construction and before chaining. Incoming executable state matches before the first choice. Both endpoint candidates are supported: WebOrca chooses by coordinate order; upstream accepts the first supported endpoint encountered in an unordered map. Restoring only upstream selection reproduces the native Z=0.4 wall sequence and resolves the original Z=12.4 traversal difference, but introduces another traversal difference at Z=12. Wall segment multisets remain unchanged, and sparse-infill sequences and extrusion remain unchanged. Small E-only wall differences remain separate from traversal.

**Historical decision (superseded as unconditional policy on 2026-11-08):** retain the canonical supported-endpoint/coordinate policy. The confirmed traversal difference is an intentional source policy, not evidence of missing walls. Restoring unordered iteration does not establish universal native parity. The earlier wall-cause-open statements in the source-control reports are superseded by this targeted experiment; the remaining sparse-connector cause stays open.

## Original project validation

**Verified blocks:** [original 3MF outcomes](docs/benchmarks/sample-parity-20261107.md#3mf-outcomes) preserve the full archives and settings. Christmas ornament imports embedded presets/plates but fails `raft_first_layer_expansion=-1`; installed desktop GUI also reports the invalid parameter. Sylvanas imports but fails relative-extrusion validation requiring `G92 E0` in `layer_gcode`. Recorded native CLI attempts abort at vector-front assertions; those are distinct failures. There is no valid G-code or slice-time comparison for these projects. Painting/override preservation through successful slicing remains unverified. Originals were not silently stripped, flattened, rescaled or corrected to obtain a result.

## Open questions and evidence limits

**OPEN:** remaining bracket sparse-connector attribution and small E-only wall differences (`sample_wall_connectors_open`), three tree solid commands and two tree wall traversal groups, six current GUI state differences, and original-project validation/painting coverage. Original tree saved geometry equality is established; internal stage captures are needed only to localize the residual, not as grounds for an assumed import correction. See the [current tree report](docs/benchmarks/tree-residual-cause-20261108.md) for exact remaining units and next probes.

Native/web outputs are neither byte-identical nor executable-command-identical. Matching total travel, bounds, layers, net E or segment counts is insufficient geometry or material-volume proof. The causal comparator quantizes endpoints to 0.001 mm, counts multiplicity, ignores direction for segment keys and retains direction in group checks; it does not merge collinear subdivisions. It covers positive-E linear deposition with recorded role/Z, not arcs, relative XYZ, inches or multiple tools. Firmware macros/homing are unmodeled. Single source-variant UI replays reuse prior same-side repeatability evidence; no universal browser, hardware, print-quality or correctness claim follows.

**Current conclusion:** the combined publication establishes exact original-GUI tree executable parity including M73, preserves the labeled bracket baseline and improves Lily within the documented directed-segment checks. General native executable parity, full GUI configuration parity and speed remain open. Native matching takes priority over custom determinism; the bounded accepted production policies do not justify wholesale upstream restoration. Historical tree controls above retain their original scope and are superseded by the publication for current tree/release status.

## Updating this knowledge

When evidence changes, update the relevant topic above and its source-report link, label which older conclusion is superseded, and keep the measurement boundary and remaining uncertainty beside the finding. Detailed commands, hashes and failures belong in the owning report; this file holds the durable conclusion and rationale. Keep the README benchmark pointer/current release summary and Taproot milestone evidence consistent; close only work whose completion is supported by the new evidence.
