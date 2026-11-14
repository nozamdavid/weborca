# Incremental reslicing — 2026-11-12

Scope: Retained `Slic3r::Print` across `op_slice` calls in `wasm/engine/Engine.cpp`, invalidation cascade and finer-grained config invalidation fixes in `src/libslic3r/PrintObject.cpp`, `src/libslic3r/Print.cpp`, `src/libslic3r/PrintApply.cpp`, and `src/libslic3r/GCode/RetractWhenCrossingPerimeters.hpp`, Catch2 regression tests (`tests/fff_print/test_print.cpp`), node test suite (`wasm/tests/node/incremental-reslicing.test.mjs`), and benchmark harness (`wasm/tests/perf/incremental-reslicing-bench.mjs`).

## Invalidation rules

- `Engine::Impl` resets retained `m_print` on full model replacement (`commit_loaded_model` with `replace=true`), `op_openProject`, empty model after object/instance deletion, `op_deletePlate`, `op_setupCalibration`, in-place volume mesh replacement (`updateSvg`, `updateText`), plate/vendor/calibration changes in `op_slice`, and slice validation/empty/cancellation/error paths.
- Unchanged finished `Print` with matching `outPath` and MEMFS file size returns cached statistics, time, and warnings without re-running `process()` or `export_gcode()`.
- When `psGCodeExport` is still marked done before `export_gcode()` (e.g. `outPath` changed or file was unlinked), `invalidate_gcode_export_from_worker()` runs so `GCode::do_export` populates `GCodeProcessorResult`.
- `PrintObject::estimate_curled_extrusions()` marks `posEstimateCurledExtrusions` done (`set_done(posEstimateCurledExtrusions)`).
- `PrintObject::invalidate_step` cascades `posPerimeters` / `posSlice` to `posEstimateCurledExtrusions`, avoids double-simplifying retained perimeters on `posPrepareInfill` unless `need_z_contouring()`, cascades `posIroning` to `posInfill` / `posContouring` / `posSimplifyInfill` / `psSkirtBrim`, and cascades `posContouring` to perimeter and infill steps.
- `Print::invalidate_state_by_config_options()` and `PrintObject::invalidate_state_by_config_options()` map `PrintConfig`, `PrintObjectConfig`, and `PrintRegionConfig` options explicitly:
  - Export/material/filament metadata keys invalidate `psGCodeExport` without invalidating geometry when they do not affect slicing, `filament_type` invalidates `posEstimateCurledExtrusions` when curled-extrusion slowdown is active, and `filament_ironing_*` / `ironing_*` keys invalidate `posIroning`.
  - Unused filament slot additions/removals and unchanged `*_filament_id` swaps preserve slicing steps; `*_filament_id` invalidates `posSlice` only when variable layer height is active and filament extruder limits (`min_layer_height` / `max_layer_height`) differ.
  - `independent_support_layer_height` invalidates `posSlice` only when a raft is active (`raft_layers > 0 || has_raft()`), otherwise `posSupportMaterial`.
  - Fallback `else` branches invalidate all object steps (`object->invalidate_all_steps()`) in addition to print steps.
- `Print::apply()` in `src/libslic3r/PrintApply.cpp` synchronizes `model_object.printable = model_object_new.printable` when an existing `ModelObject` stays in `m_model` across slices and avoids unconditional `posSlice` invalidation on `enable_prime_tower`.
- `RetractWhenCrossingPerimeters::m_layer` in `src/libslic3r/GCode/RetractWhenCrossingPerimeters.hpp` initializes to `nullptr` so uninitialized stack memory across consecutive `GCode` exports cannot match a reused `Layer` address and skip building internal-island retraction caches.

## Output equivalence & benchmark evidence

Measured on `3DBenchy.stl` (4 threads, Voron 2.4 300 0.4 nozzle; baseline: fresh `loadModel` on current `orca_engine.mjs`; source: `/tmp/incremental-reslicing-bench-latest.json`):

- Equivalence: 100% raw (timestamp-stripped) and normalized G-code SHA-256 equivalence between retained `Print` and fresh `Print` across all 8 benchmark scenarios and all 6 `wasm/tests/node/incremental-reslicing.test.mjs` test groups (verified with `wasm/scripts/compare-gcode.mjs` and `hashGcode`).
- Speedups:
  - `repeatSamePath` (unchanged cached fast-path): `32.6 ms` vs `1013.3 ms` (`31.08x`)
  - `repeatNewPath` (G-code export only): `676.3 ms` vs `1029.3 ms` (`1.52x`)
  - `gcodeSettingChange` (`fan_max_speed`): `661.3 ms` vs `1014.4 ms` (`1.53x`)
  - `skirtSettingChange` (`skirt_loops`): `675.7 ms` vs `1043.5 ms` (`1.54x`)
  - `infillDensityChange` (`sparse_infill_density`): `805.1 ms` vs `1029.3 ms` (`1.28x`)
  - `moveObject` (XY shift): `693.3 ms` vs `1028.7 ms` (`1.48x`)
  - `layerHeightChange` (`layer_height`): `950.5 ms` vs `981.4 ms` (`1.03x`, full reslice)
- Memory check: 10 consecutive `sparse_infill_density` reslices on `3DBenchy.stl` completed with `rssDeltaBytes: 2437120` (~2.3 MiB).

## Verified test suites

All WASM Node suites passed under `MEMCAP=6G wasm/scripts/memcap.sh` against `wasm/build/orca-v250-wasm64/wasm/engine/orca_engine.mjs`:

- `wasm/tests/node/incremental-reslicing.test.mjs` (6/6, 5/5 consecutive stability runs)
- `wasm/tests/node/bed-boundary-slicing.test.mjs` (14/14)
- `wasm/tests/node/preflight-cancellation.test.mjs`
- `wasm/tests/node/engine.test.mjs` (12/12)
- `wasm/tests/node/slicing-threads.test.mjs` (2/2)
- `wasm/tests/node/layers.test.mjs` (9/9)
- `wasm/tests/node/plates.test.mjs` (15/15)

WASM Catch2 `fff_print_tests`:

- 5/5 new `[Print][Regression]` and `[Print][PurgeTower][Regression]` test cases (33 assertions) passed.
- Full `fff_print_tests --order rand` passed 634/635 test cases (611717/611726 assertions); the sole failure (`tests/fff_print/test_perimeters.cpp:1041`) is a pre-existing upstream Arachne open-wall test (`709ff3ecd0`) unrelated to incremental reslicing.
