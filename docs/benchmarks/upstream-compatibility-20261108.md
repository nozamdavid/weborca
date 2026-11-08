# Original Orca compatibility — 2026-11-08

Native executable G-code and slicing speed are the acceptance targets. Strict parity remains open. This investigation identifies the exact float recentering operation explaining the tree mesh change on native project reload, but does not yet establish the internal original-STL native/web geometry equality or justify a product correction.

## Current policy and acceptance

The user's priority supersedes unconditional recommendations to retain custom stable sorting, bounded Random mapping and canonical endpoint selection for reproducibility. Their historical rationale and measured controls remain in [KNOWLEDGE.md](../../KNOWLEDGE.md), [source controls](bracket-source-cause-20261107.md) and [wall traversal controls](wall-traversal-cause-20261107.md). These are provisional implementation choices to reassess against original output. Wholesale reversion is not supported by the existing single-expression controls, which do not produce global equality.

Reference: installed Flatpak OrcaSlicer 2.5.0; manifest source `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`; binary SHA256 `9c42194b612e85b29ec269124d8f1b83d768f3e8a3dfdfb65e26625942e947cc`. Exact preset leaves, inherited bases and full effective project state must match. The [desktop metadata report](desktop-gui-metadata-20261107.md) retains unresolved state differences. Acceptance requires actual headed `/opt/helium/helium`, normal import, Slice and Export. A worker-only replay is insufficient.

Preserve raw timestamps, thumbnails and original files. Report raw-byte equality separately from exact meaningful executable-command equality, including coordinates, E, order and progress. Comment/M73-filtered comparisons are diagnostic only. Equal layer counts, travel totals or segment multisets do not establish identical executable output. Speed is measured by another task; this investigation makes no new speed claim.

## Reproduction and evidence

Ignored evidence: `wasm/build/upstream-compatibility-20261108/`. Original native/WASM candidates and prior dirty benchmarks remain intact. No source edits, compile/link, slicing, integrated candidate build, deployment, commit, push or PR occurred. These operations therefore did not contend for the exclusive `/tmp/weborca-parity-benchmark.lock`; future compile/link or CPU-intensive slicing must acquire it per operation.

The previously captured full-app bracket differential was rerun:

```sh
node wasm/tests/parity/diagnose-sample-parity.mjs \
  wasm/build/sample-parity-cause-20261107/native-project/plate_1.gcode \
  wasm/build/sample-parity-cause-20261107/ui-replay/bracket_3mf.gcode \
  --assert-equal
```

Exit 1, as expected: 51,789/51,797 deposition segments, 98/106 different segment keys, filtered executable equality false. Output is `bracket-red.json`. It is a red-capable captured-output check; it does not rerun slicing.

Ranked hypotheses: (1) repeated `center_geometry_after_creation` physically changes float vertices; (2) XML decimal formatting changes parsed float values without a second translation; (3) instance placement/arrangement changes transforms while vertices remain equal. The vertex check below distinguishes the first two for the web-project → native-project transition. It does not resolve all causes of the independent original-STL comparison.

```sh
node wasm/build/upstream-compatibility-20261108/mesh-check.mjs
```

Exit 0. `mesh-check.json` retains numbers and representative coordinates. This diagnostic reads unchanged original binary STL and both saved 3MF mesh XML blobs; it uses `Math.fround` for IEEE float32 arithmetic and parses all serialized coordinates to float32. It does not alter geometry or rewrite G-code.

## Exact mesh operation recovered

The web-saved tree has 65,754 vertices; native re-export has the same count and identical ordered triangle XML hash. Web float32 mesh bounds are:

- Min: `(-45.85230255126953, -45.85401153564453, -75.00003814697266)`.
- Max: `(45.85231018066406, 45.85400390625, 75.00003814697266)`.
- Center: `(0.000003814697265625, -0.000003814697265625, 0)`.

For **every coordinate of every vertex**, native re-export parsed to float32 equals:

```text
native[k] = float32(web[k] - float32(web_mesh_bbox_center[k]))
```

There are zero prediction failures across 197,262 coordinate components. All 131,508 X/Y components change; maximum change is `0.000003814697265625` mm. For example vertex 0 X changes from `20.511489868164062` to `20.511486053466797`, and Y from `-1.797454833984375` to `-1.7974510192871094`.

This is a real change in parsed float vertices. Decimal-formatting differences alone cannot account for the changed float values. The operation matches `ModelVolume::center_geometry_after_creation` exactly, both in this checkout and `git show 40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19:src/libslic3r/Model.cpp`: compute the double bounding-box center, cast displacement components to float, then `TriangleMesh::translate` adds the float displacement to each float vertex. The 3MF loader (`bbs_3mf.cpp`, `_generate_volumes_new` volume creation around line 5354) calls `object.add_volume`, which performs that centering before multiplying the component transform by the newly created volume transform.

The stored component offset changes from approximately `(-3.81469727e-06,3.81469727e-06,0)` to `(-4.37499971e-15,4.37499971e-15,0)`. Adding the recovered mesh shift to the serialized web offset predicts that tiny residual (within the displayed serialization precision). Instance translation remains `(150,150,75.0000381)`. This explains the changed mesh/compensating component transform through native project import. It does not by itself prove native's live in-memory state or identify the complete source of the executable residual.

## Original STL and application flow

The unchanged original binary STL has 131,504 facets and bounds min `(82.14800262451172,82.14598846435547,3.6054714769306884e-8)`, max `(173.8526153564453,173.85400390625,150.0000762939453)`. Its double center is `(128.00030899047852,127.99999618530273,75.000038165)`.

Applying the upstream float centering expression once to the original facet vertices produces 65,754 unique vertices. Every saved web vertex belongs to that set; zero unmatched vertices. This verifies the entire coordinate set, rather than just bounds. Original-STL facet order/reindex equivalence is not asserted by this set check; native/web saved-project triangle order was checked separately above.

Source trace:

1. `load_stl` → `Model::add_object` → `ModelObject::add_volume` → `center_geometry_after_creation`: physical float vertex translation with compensating double volume offset.
2. Actual web `plateStore.importFile` uses `addModel`, then `arrange`. `Engine::commit_loaded_model(..., replace=false)` clones the object and calls `center_around_origin()`; this changes volume transforms through `ModelObject::translate`, not vertex storage. The `loadModel` replacement branch does not call it, so using that branch alone would be a different experiment.
3. Desktop `Plater::load_files` calls `center_around_origin(false)` for STL before placement. For this one-part STL with no modifiers, the include-modifiers default difference is not evidence of a divergent operation. Both desktop and web already use the same conceptual sequence here.
4. Original native CLI's explicit `center` path calls `center_instances_around_point` and adjusts instance Z to ground. It does not invoke the desktop STL object-centering step there. Thus CLI versus actual GUI transform decomposition still needs an internal-state control. The historical CLI original-STL output cannot alone establish a missing web GUI operation.

The earlier [travel observations](toolpath-cause-20261107.md) remain: original independent imports −2165.54199 mm, shared web project −7.61358 mm, native-normalized project replay +0.02328 mm. This investigation recovers the exact float operation for the middle project's normalization; it does **not** causally assign the full −2165.54 mm change to that operation. Applying an extra recenter to web STL merely to emulate a project reload would be an unsupported product change: original GUI STL import does not call that extra volume creation a second time.

## Next discriminating check and limits

Capture all ordered float vertex bits, facet indices, volume/component matrices, instance matrices and origin_translation immediately after **original STL** import/centering/placement in native GUI at the manifest source and actual web `addModel`/arrange, and immediately before slicing. Compare the composed transform arithmetic as well as local coordinates. Preserve the native executable reference; instrument a separate copied translation unit/build. A transform-only diagnostic variant should be attempted only after those captures identify an actual operation difference. Match desktop bed, AMS/nozzle and wipe state first.

No justified product fix emerged from this check. No arbitrary rounding, extra normalization or G-code postprocessing was introduced. Native in-memory snapshots and full headed diagnostic-variant Slice/Export remain pending. If that control establishes a divergence, add one fixture asserting native-equivalent coordinates/transforms, compile affected translation units under the shared lock, and make exactly one immutable integrated candidate batch for full Helium bracket/tree acceptance. Existing aggregate convergence does not satisfy acceptance.

New documentation links, all KNOWLEDGE links, cited source operations and retained reproduction commands were checked; `git diff --check` passes. A broader README link check found a pre-existing missing ignored artifact, `wasm/build/tests-background-engine-20261107/report.md`; that unrelated link was preserved. No build or test suite is needed for these documentation-only changes; the two targeted diagnostic commands above were run. Taproot version 100 records the priority/evidence milestone as done, keeps internal geometry comparison and parity open, and collapses completed branches recursively.
