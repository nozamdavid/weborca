# Model/slicing CI fixture failures, 2026-11-11

Engine under test: `ORCA_ENGINE_MODULE=$PWD/wasm/build/review-preview-native/wasm/engine/orca_engine.mjs`. Every run used `MEMCAP=6G wasm/scripts/memcap.sh`. Bed containment was not weakened, and no blanket arrange bypass, native source, runtime input, golden or engine.test.mjs was touched.

## Diagnosis

Most failures were stale fixtures. Loaded models and calibration meshes sit at instance offset (0,0), which is the bed corner. The accepted bed containment check now excludes any instance that is not fully inside the bed, so the print comes out empty ("The print is empty"). The fix places each intended model explicitly inside the bed.

## Resolved (all stale fixtures)

| Test file | Failures | Cause | Fix |
|---|---|---|---|
| `calibration.test.mjs` | 9 empty prints (PA Tower, PA Line, Temperature, Retraction, Max Volumetric Speed, VFA, Input Shaping x2, Cornering), plus Reset Calibration Mode | Calibration and loaded models at the bed corner | `sliceOnBed` helper moves the single instance to (100,100) before slicing. Assertions unchanged. 12/12 pass. |
| `large-project.test.mjs` | Empty print for 56 instances | `arrange` without `useBed` ignores the bed, and 56 copies do not fit on one bed | Instances are placed explicitly in 5x5 grids (55 mm pitch for the ~52x50 mm mesh) on 3 plates at the 360 mm plate stride. Plate-count and round-trip assertions kept. Slices 10 layers. |
| `layers.test.mjs` | Adaptive-profile slice empty | Benchy at origin | Instance moved to (150,150) before the slice. 9/9 pass. |
| `mirror-clone.test.mjs` | Mirror-then-scale slice empty | Cube at origin | Instance moved to (150,150) before the first slice. 5/5 pass. |
| `svg-units.test.mjs` | SVG reopen slice empty | Reopened project object at origin | Instance moved to (150,150) before the slice. 3/3 pass. |
| `objects.test.mjs` | 2 assertions (`volume.extruder` 1 !== 0) | Upstream `Model.cpp` (lines 625, 643, 654) gives a new object `extruder=1`, and `getObjectTree` reports an unset volume as inheriting it | Expectations changed to 1 for initial value and after reset-to-0. This is not matching output: reset-to-0 clears the volume override, so the volume inherits the object value. 15/15 pass. |
| `text.test.mjs` | "text does not intersect target model geometry" | Not a bed issue. Commit 413cb95cb6 replaced the flat fallback in `TextOps.cpp` with an explicit error. The test's last case still expected the fallback. | That case now asserts the rejection message and that no volume is added. The cylinder wrap assertions are unchanged. 8/8 pass. |

## Unresolved

`cut-connectors.test.mjs` "two upper plugs retain distinct identities...": the failure is a real product regression, so it was not changed. The assertion `peg.boundingBox.min[2] ≈ 6` gets 5.95, and the socket spans 5.95 to 10.05. The test never slices, so the bed has no part in it.

Cause: `wasm/engine/CutConnectorOps.cpp` `apply_connector_tolerance` (lines 85-106) keeps a private copy of the tolerance logic, with a `z_offset -= 0.05` shift. Upstream a0e51b4044 (#16893) rewrote the same logic in `src/libslic3r/CutUtils.cpp`: plugs and snaps now grow by `CONNECTOR_HOLE_OVERLAP` instead of moving, so the hole keeps its full depth.

Proposed fix, for the parent to approve: make the engine copy match `CutUtils.cpp::apply_tolerance`, i.e. `sf[Z] += CONNECTOR_HOLE_OVERLAP` and `z_offset = 0.5 * (height_tolerance - CONNECTOR_HOLE_OVERLAP)` for plugs and snaps. The test's expected values would then need a separate check against the new geometry. The change is in `wasm/engine`, which is runtime-fingerprinted, so it was not made here.

Not owned and not attempted: `engine.test.mjs` cube parity and abort-cancel tests (native oracle owner), preview tests, Snapmaker reconnect, cloud/history tests.

## Changed files

- `wasm/tests/node/calibration.test.mjs`
- `wasm/tests/node/large-project.test.mjs`
- `wasm/tests/node/layers.test.mjs`
- `wasm/tests/node/mirror-clone.test.mjs`
- `wasm/tests/node/svg-units.test.mjs`
- `wasm/tests/node/objects.test.mjs`
- `wasm/tests/node/text.test.mjs`

## Verification

Each file above, run alone against the qualified engine: calibration 12/12, large-project 1/1, layers 9/9, mirror-clone 5/5, objects 15/15, svg-units 3/3, text 8/8. `bed-boundary-slicing.test.mjs` still passes (1/1). `node --check` and `git diff --check` pass. No `[DEBUG-` tags remain. No Taproot, README, commit, server, UI build or child agent was used.
