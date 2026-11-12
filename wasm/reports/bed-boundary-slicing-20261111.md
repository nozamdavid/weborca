# Bed boundary slicing — 2026-11-11

Scope: `wasm/engine/Engine.cpp`, `wasm/tests/node/bed-boundary-slicing.test.mjs`, this report. Existing UI, README and report edits are preserved. No preview refresh, milestone update, commit or deployment.

The real WASM slice reproduction failed with `AssertionError: outside copy must not appear in emitted object labels` (ignored evidence directory `wasm/build/tests-bed-boundary-20261111/red.log`). It loads a cube, duplicates its instance, places one copy outside the printable polygon and inspects emitted G-code object labels.

Root cause: plate assignment intentionally accepts bounding-box overlap and falls back to the nearest plate. Slice previously treated that assignment as eligibility; no-plateIndex slicing skipped eligibility filtering altogether. The authoritative slice boundary now subtracts the target plate origin from each full instance/volume transform, projects model-part meshes with native `project_mesh`, and checks native polygon difference against the configured printable polygon. This handles concave polygon edges as well as transformed instances without a bounding-box approximation. Negative/modifier/support volumes do not expand the printable model footprint. Assignment and per-plate configuration behavior remain in place. The existing cleanup guard now saves/restores printable flags on both slice paths. Empty eligible prints raise the existing native empty-print error before processing/export.

The engine build is isolated at `wasm/build/engine-bed-boundary-20261111`. The initial cache was copied from the existing build, then CMake was explicitly configured against this worktree; all C++ source inputs were rebuilt against this worktree. Existing dependency prefix libraries are reused read-only. The parent checkout's uncommitted source files were not copied. Build log: `wasm/build/tests-bed-boundary-20261111/build.log`. Focused Engine.cpp compile log: `engine-tu.log` (existing mismatched PlateData class/struct warning). An initial Eigen conditional type error was fixed before verification.

Reproduction command (use emsdk Node via `source wasm/scripts/env.sh`):

```sh
node wasm/tests/node/bed-boundary-slicing.test.mjs
ORCA_ENGINE_MODULE="$PWD/wasm/build/engine-bed-boundary-20261111/wasm/engine/orca_engine.mjs" node wasm/tests/node/bed-boundary-slicing.test.mjs
```

Verification and candidate identity: pending below.

## Verified result

PASS: 14 focused checks in the updated actual WASM engine (`green.log`): outside copy, crossing edge, rotated/scaled/mirrored exclusion, inside transformed/mirrored retention, diamond polygon, concave notch (full edges, not vertices alone), circular polygon, nonzero bed origin/no plateIndex, second plate origin, all-outside errors on both paths (including an existing output path), flags restored after failure/other plate, distinct outside object, queued cancellation, explicit nonprintable exclusion and serialized state restoration. Existing model instances remain in the project. G-code labels are counted by unique object/instance label because native slicing splits differently transformed copies into distinct PrintObjects, whose copy indices restart at zero.

The all-outside errors are checked against the existing meaningful empty-print message on the explicit-plate path. The queued cancellation check does not claim mid-processing cancellation coverage; both paths share the existing RAII cleanup guard. No browser automation was required or performed.

Build succeeded: isolated `orca_engine` target, including Engine.cpp; `npm run build -- --outDir ../build/ui-bed-boundary-slicing-20261111` with `ORCA_ENGINE_DIR` explicitly pointing at the isolated updated runtime. Locale checks and `tsc --noEmit` passed as part of the UI build. Existing Vite externalization/chunk-size and Emscripten warnings remain. `git diff --check` passed.

Frozen read-only candidate: `wasm/build/ui-bed-boundary-slicing-20261111`. All-file manifest: `wasm/build/tests-bed-boundary-20261111/candidate.sha256`. Packaged engine `.mjs` and `.wasm` both match the updated isolated engine byte-for-byte (`cmp`). WASM SHA-256: `35707f0c38c6c83def0b2ce112c7ef2017d3e405d844644ccccc03182f371405`; loader SHA-256: `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7`.

Input snapshot: `ui-input.sha256`, `candidate-input.diff`, and `engine.sha256` in the evidence directory. UI input hashes remained stable during the build. The snapshot includes the independent Export G-code alignment edit in `wasm/app/src/preview/SliceStatsPanel.css` (removing `display: block`). This task did not edit that CSS. One combined candidate was built; no persistent preview/service changes. Independent combined acceptance belongs to the parent.

`wasm/app/node_modules` was absent at start; this task created a symlink to `/mnt/appdata/workspace/OrcaSlicer/wasm/app/node_modules` for existing dependencies and left it in place for the concurrent alignment task. No parent source edits were made. No README or Taproot update was made because acceptance/milestone ownership remains with the parent.

## Independent final acceptance

PASS 2026-11-11. Reused immutable combined candidate, no rebuild/source edits. Manifest verified; packaged loader/WASM byte-identical to isolated worktree build. All14 packaged-engine checks pass: `wasm/build/tests-bed-boundary-20261111/acceptance-packaged.log`. Native review found no concrete blocker in polygon difference, full instance/volume transforms, plate origins, model-part-only footprints, explicit printability or RAII restoration. Mid-processing cancellation and exhaustive modifier geometry remain code-reviewed rather than newly exercised.

Combined actual app on owned5067: cube at[40,40] plus copy at[400,40] emitted only `acceptance.obj id:0 copy 0`; both instances remained in native project. All-outside retry returned empty-print error, null sliceResult/gcodeUrl and no download anchors. Prior statistics may remain visible but prior output cannot be exported. Export center delta -0.453125px; screenshot visually inspected and descendant-aware center hit-test passed.

Private HTTPS5065 refreshed to combined candidate, Vite5064 bound100.105.38.125. Verified HTTP200, COOP same-origin, COEP require-corp, no-cache and served HTML/entry/loader/WASM byte identity (`https.headers`, `served*` in evidence directory). Persistent PID1649811; log/pid `wasm/build/preview-5064.{log,pid}`; stop `kill 1649811` after command-identity check. Prior PID1550591 and pidfile identity checked before stopping; proxy configuration preserved. Owned5067/tab closed; known dependency symlink removed.
