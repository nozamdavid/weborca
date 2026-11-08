# Bracket wall traversal cause — 2026-11-07

The original bracket wall direction differences are caused by the intentional open-wall endpoint policy in `PerimeterGenerator.cpp`. Restoring only upstream's endpoint selection in a copied translation unit reproduces native's Z=0.4 traversal and removes the original Z=12.4 traversal difference. This is a source-policy difference, not evidence of missing walls or a slicing correctness bug. Retain coordinate ordering, stable Fill sorting and portable Random mapping. No product correction is proposed.

## Controls and first incoming state

Read this worktree's AGENTS, diagnosing-bugs skill, [toolpath cause](toolpath-cause-20261107.md), [source controls](bracket-source-cause-20261107.md), [desktop metadata](desktop-gui-metadata-20261107.md), [merge foundation](../v2.5.0-integration/merge-foundation.md) and [semantic review](../v2.5.0-integration/core-semantic-review.md). No CONTEXT.md was found in the tracked file listing. The desktop report's separate remaining input mismatches are not substituted into the controlled shared-project experiment.

Reused unchanged `sample-parity-cause-20261107/ui-project/input.3mf`, SHA256 `a010c0e496d57b5e7259d452493b4ef52caabcef9e399e321b0cd3c4b022a6cc`, with the established identical serialized facets, vertices, component identity and instance transform `(150,150,22.5)`. Installed Flatpak reference remains source `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`, binary SHA256 `9c42194b612e85b29ec269124d8f1b83d768f3e8a3dfdfb65e26625942e947cc`, G-code `sample-parity-cause-20261107/native-project/plate_1.gcode`. Baseline is the previous full Helium `bracket-source-cause-20261107/baseline/ui/bracket_3mf.gcode`, backed by the byte-identical baseline relink of shipped WASM `452c0ab51a0b935f691384e629d73ad0005fda99733b059d18cc600c0d4c1f19`. Prior four-run determinism and single-thread controls are reused.

All new diagnostic artifacts are under ignored `wasm/build/wall-traversal-cause-20261107/` (paths below relative to that directory). The existing segment comparator was run again: 51,789/51,797 deposition segments, 98/106 differing unordered keys, first ordered divergence index 538 at Z=0.4. Its `--assert-equal` goes red for sparse segment differences, so a new narrow `check.mjs --assert-wall-equal` explicitly checks wall entry and was executed with exit 1. This captures the actual app symptom without depending on sparse differences.

`incoming-state.json` establishes that the **first executable difference**, excluding comments and M73, is command index 669 (zero based), the travel toward the wall. Every preceding executable command matches. Immediately before it both have XY `(129.530,138.454)`, Z `0.2`, accumulated E `-0.8` after G92, relative E enabled, role `Bottom surface`, feed `6300`. Both have already issued the same acceleration, bed-temperature and object-start commands. Thus the wall discrepancy is not inherited from an earlier different travel, extrusion or role sequence. The first travel is native `G1 X133.456 Y131.909 Z.8 F21000` versus web `G1 X132.931 Y131.622 Z.8 F21000`; their final approach endpoints are opposite ends of the same wall.

## Source review and discriminating experiment

`core.diff` preserves the full upstream-versus-checkout libslic3r diff. Explicit review covered PerimeterGenerator, Arachne, ShortestPath, ExtrusionEntity/Collection, GCode and seam sources and adjacent headers. Arachne, chaining, extrusion entities and seam implementations have no source diff in these paths. GCode's source/header differences add the optional speed-interpolation export argument. PerimeterGenerator has the supported/coordinate endpoint policy and two surface simplification differences. The fixture exports `wall_generator=arachne`, `enable_arc_fitting=disabled`, `resolution=0.012`; upstream and checkout's simplification expressions therefore select the same `m_scaled_resolution` here. The default-resolution source change is not the fixture's explicit value.

Ranked falsifiable candidates after reproducing the failure: (1) endpoint policy should reverse the initial wall when only that operation is restored; (2) simplification should change pre-chain geometry if its conditional is active (disabled by this fixture's arc setting); (3) downstream chaining or seam state should remain divergent after endpoint restoration if it independently explains this wall. The endpoint experiment tests (1) and discriminates (3); no generic compiler attribution is needed for this first choice.

Variant C copies only `PerimeterGenerator.cpp`, computes the checkout's canonical endpoint for logging, then replaces its selected endpoint with the exact upstream loop: iterate `point_occurrence`, accept occurrence-one endpoints, break on the first supported endpoint. It keeps all other algorithms and settings. A narrow layer_id=1 trace prints the map's candidates, occurrence count and overhang flag before `chain_and_reorder_extrusion_paths(paths, &start_point)`. This is diagnostic instrumentation in an ignored copy, with no source-tree edits.

The decisive first trace is:

```text
canonical=-16628562,-19262389 upstream=-15842528,-19259661
map iteration:
 -15842528,-19259661 : occurrence=1 overhang=0
 -16043303,-19269869 : occurrence=2 overhang=0
 -16628562,-19262389 : occurrence=1 overhang=0
```

Both endpoints have equal supported preference. Coordinate order picks X=-16628562; upstream encounters X=-15842528 first and stops. The middle point is ineligible because its occurrence is two. With the instance offset, the endpoints are `(133.371438,130.737611)` and `(134.157472,130.740339)` mm. They round exactly to the observed web/native entry coordinates. No distance score or equal-distance numerical tie participates in this selection.

This locates the decision **after overhang clipping/path construction and before chaining**, not in G-code seam placement. It selects the start passed to chaining; the resulting open `ExtrusionMultiPath` retains those paths, and `GCode::extrude_multi_path` emits them in order. The full-app counterfactual verifies that this selected endpoint reaches emission. The installed native map itself was not instrumented: the restored operation in WASM choosing the installed-native endpoint and reproducing its command prefix is the causal evidence, rather than an assumption about native standard-library iteration.

## Build, full app verification and results

`C/compile.sh` extracts the original PerimeterGenerator compile command from `orca-v250-wasm64/compile_commands.json`, changing only input/output paths and adding the original libslic3r include directory for the copied file. Compilation passed. C copies the original `liblibslic3r.a`, replaces only `PerimeterGenerator.cpp.o` with `emar r`, then uses `C/link.sh`, derived from the prior saved Ninja link command. Link passed. Compile/link logs retain the MEMORY64 and pthread memory-growth warnings. No clean build or supplemental native engine was needed.

Engine hashes: JS `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7` (unchanged), WASM `8d910623c006728d14789a734b721b08c2eed030cc199f66c66c046f414dfa1d`. `C/source.patch`, `engine.sha256`, compile/link scripts and logs preserve provenance. `C/app-diff.txt` confirms that only engine WASM differs from the immutable candidate. The candidate and original archive were preserved.

T3 preview_status returned `available:false`. The user-specified headed `/opt/helium/helium` ran the existing diagnostic driver with a fresh isolated profile, normal project import → Save project → Slice Plate 1 → File → Export G-code. It calls no engine API. Port 5087 served C's candidate copy with separate private alpha state; secrets are excluded. Both owned browser and server were closed. The copied candidate initially retained read-only engine permissions; the failed copy was corrected on the isolated copy before launching Helium.

Commands, run from the worktree root (preserve existing destinations before replay):

```sh
node wasm/build/wall-traversal-cause-20261107/check.mjs --assert-wall-equal
# Expected red for the unchanged baseline.
source wasm/scripts/env.sh
cd wasm/build/orca-v250-wasm64
bash ../wall-traversal-cause-20261107/C/compile.sh
# Archive replacement and link are recorded above and in C/link.sh.
cd ../../..
bash wasm/build/wall-traversal-cause-20261107/serve.sh C
# In another shell:
APP_URL=http://localhost:5087 OUT=wasm/build/wall-traversal-cause-20261107/C/ui \
SAMPLE=bracket.3mf \
INPUT_PATH="$PWD/wasm/build/sample-parity-cause-20261107/ui-project/input.3mf" \
node wasm/build/bracket-source-cause-20261107/driver.mjs
node wasm/build/wall-traversal-cause-20261107/check.mjs --assert-C-entry
node wasm/build/wall-traversal-cause-20261107/compare.mjs
node wasm/tests/parity/diagnose-sample-parity.mjs --self-check
```

The C-entry assertion passes: its first 5,186 executable commands match native, versus 669 for baseline. First ordered deposition mismatch moves from index 538, Z=0.4 Inner wall, to index 4271, Z=1.8 Sparse infill. The complete Z=0.4 Inner wall sequence (233 segments, directed endpoints and E) now matches native.

`comparisons.json` and `wall-counts.json` quantify the change. Baseline/C have 51,797 segments each and **zero differing unordered segment keys**. C changes only Inner wall directed/E sequences: five segment positions at Z=0.4, five at Z=12, three at Z=12.4. These counts describe sequence positions, not lost wall lengths. C resolves both original coordinate-traversal groups, Z=0.4 and Z=12.4, but creates a new five-position traversal difference from native at Z=12, where canonical baseline already matched native. This demonstrates why restoring unordered iteration is not a universal parity correction.

Remaining native/C wall groups at Z=6, 6.8 and 12.2 have identical directed coordinates and respectively one, one and two E-only differences of 0.00001. They are distinct from wall direction selection and unchanged by C. The newly introduced Z=12 direction difference is consistent with implementation-dependent upstream hash iteration; its native internal map order was not measured. If pursuing that diagnostic variant, the next exact probe is the same endpoint trace at layer_id=59 on both controlled native and WASM sources, recording candidate insertion/iteration order and chosen start before chaining. No claim of general cross-platform equality follows from this single variant replay.

Sparse deposition sequences and E are byte-for-byte unchanged by the endpoint operation under the group comparison. Native/C still has the same 98/106 differing unordered keys as native/baseline. Thus the remaining sparse connectors are not a downstream consequence of this wall-start policy. Prior isolated Fill-sort evidence still attributes Z=1.8, 5.2 and 10.4 groups to that intentional sort policy; other sparse groups remain unattributed. A further sparse investigation should target the first remaining group after that existing sort control, tracing equal-cost candidate input order and selected connector in `Fill::connect_infill`, independently of wall entry.

Script syntax checks, original comparator self-checks and the focused C-entry assertion pass. All new C++ compilation was limited to the copied affected TU; behavioral verification was the full Helium app. No timing suites, other samples, product/deploy changes, commits, pushes, PRs, README/KNOWLEDGE/shared-report or Taproot edits were made. Comparator limits remain: emitted linear positive-E moves, 0.001 mm endpoint quantization for multiset keys, no collinear merging or physical-volume proof. This report establishes the original traversal decision and its intentional policy origin, not print-quality harm or full native parity.
