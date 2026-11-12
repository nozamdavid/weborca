# CI final qualification — 2026-11-11

Status: scoped verification finished with unresolved failures; full CI is **not qualified**. Qualified runtime bytes were not modified. No application/native production source, build script, workflow, UI build, service, commit, README or Taproot edits in this task.

Evidence directory: `wasm/reports/ci-final-qualification-20261111/`.

## Passed

`source.log` records the automatic workflow's commands, executed in order: `PATH=/tmp/orca-review-actionlint:$PATH bash wasm/ci/check.sh --check`, locale validation, app TypeScript compile, manifest/classification tests (2), native C++ packet compile/run, and all seven engine independent method suites (56 tests: 55 passed, one optional historical measurement skipped). The optional historical measurement requires `SCENE_COMPARE_BASELINE=1`; no skip was added here.

Focused fixture corrections:

- `asset-packaging.test.mjs`: synthetic runtime fixtures now carry manifests, independently captured fixture receipts and STEP license files. Production verification stays enabled. `packaging.log`: 1 pass.
- `deploy-printer-cloud.test.mjs`: test-only ESM bundle provides `createRequire` for bundled CommonJS dependencies. First startup assertion includes captured stderr. `deploy-fixed.log`: all 6 pass.
- `thumbnail-cache-lifecycle.test.mjs`: catalogue store stub includes the subscription interface now consumed by appStore. `thumbnail-fixed.log`: both pass.
- `printerConnectionDialog.test.mjs`: bounded component fixture stubs catalogue discovery instead of making a real fetch under its explicit no-network guard. `printer-dialog-fixed.log`: all 3 pass.
- `paint-tools.test.mjs`: VM worker harness supplies the newly imported real asset helper, Uint8Array and AbortController, matching worker-bridge's loader. `paint-final.log`: all pass.
- `calibration.test.mjs`: fixture provisioning explicitly checks and packs BBL in addition to Voron and OrcaFilamentLibrary. Previously a fresh shared bundle containing resources.json alone caused all tests to be cancelled on missing BBL.json. Actual qualified-engine calibration slicing still fails; assertions retained.
- `snapmaker-cloud-reconnect.test.mjs`: teardown always deselects the printer, including assertion failures, releasing the session timer. `reconnect.log`: genuine assertion failure remains (`1 !== 2`, expected another socket); process now exits.

These are Node test files; no native translation unit changed. Modified tests received focused execution. `node --check` and `git diff --check` pass.

## Runtime inputs and failed evidence

Initial classified command:

```
ORCA_ENGINE_MODULE=$PWD/wasm/build/review-preview-native/wasm/engine/orca_engine.mjs \
PREVIEW_MODULE_DIR=$PWD/wasm/build/review-preview-native/wasm/preview \
STEP_MODULE_DIR=$PWD/wasm/build/review-step node wasm/ci/run-node-tests.mjs
```

`node-initial.log`: 728 tests, 681 passed, 30 failed, 14 cancelled, 3 skipped. This exploratory command used the wrong STEP selector (tests consume ORCA_STEP_MODULE), lacked provisioned Benchy at its start, and required terminating the stuck Snapmaker reconnect test after its recorded assertion failure. It is **not a complete clean pass or an accurate final failure count**.

`bash wasm/tests/data/fetch_models.sh` then provisioned/verified the existing 3DBenchy fixture by SHA256 (see fetch-models.log). Correct standalone STEP selector is `ORCA_STEP_MODULE=$PWD/wasm/build/review-step/step_tessellate.mjs`. With this selector, `step-module-current.log` passes all five STEP release regressions; two comparison tests remain cancelled until the separately built OCCT comparison engine is supplied through ORCA_OCCT_ENGINE_MODULE.

`node-final.log` records a fresh classified run with both correct engine and standalone STEP selectors after fixture provisioning. Further result below once complete.

Observed genuine unresolved results include obsolete macOS cube reference differences; calibration/large-project/mirror/layer-height/SVG empty-print errors; connector/object assertion differences; surface-wrapped text no-intersection error; Snapmaker reconnect socket assertion; preview tests importing extensionless previewWorkerClient relative to a data URL. No assertion was weakened and no expected G-code was derived from WASM.

## Independent oracle and comparison builds

Native configure uses this checkout's current source and isolated `wasm/build/review-native-oracle`, read-only native dependency prefix `/mnt/appdata/workspace/OrcaSlicer/wasm/build/native-deps-headless/OrcaSlicer_dep/usr/local`, and this checkout's downloaded official CGAL6.2.1 headers/config (`-DCGAL_DIR=$PWD/wasm/build/src/CGAL-6.2.1`). GUI/CAD/PCH/OCCT/OpenVDB/OpenCV/Assimp/Draco/OpenSSL/Freetype off, static Release. Initial configure correctly exposed missing OpenVDB and CGAL selections; corrected configuration succeeds. Build target is `OrcaSlicer` (orca_slice_driver exists only in Emscripten configuration). Logs: native-configure.log, native-build.log. No parent source or binary copied as oracle.

STEP diagnostic configure uses existing build_step_engine.sh with BASE_PREFIX=wasm/build/prefix-review, OCCT_PREFIX=wasm/build/prefix-review-occt, ORCA_STEP_BUILD_DIR=wasm/build/review-ci-step-engine, COMBINED_PREFIX=wasm/build/review-ci-step-prefix. Log: step-engine-build.log. All qualified directories and identity receipts remain untouched. Build concurrency was raised from 2 to 4 after a clean interruption/resume, solely in these diagnostic directories.

Current-source oracle consumers remain unchanged pending successful independent native output and comparison. General native/WASM speed qualification, browser UI suites, hosted Actions and Docker execution remain unverified; no full CI pass is claimed.

## Classified run result

The final classified command completed with 730 tests: 698 passed, 27 failed, 2 cancelled, 3 skipped (230.15 seconds). Preview-import-overlap produced no further output for over two minutes; its test process was terminated with SIGTERM so remaining suites could execute, recorded as a failed test, not success. `node-final.log` contains all diagnostics. The separately rerun printer-dialog fixture subsequently passes all 3 tests. The run's STEP comparison cancellations will be superseded only by the provisioned comparison result below.

Changed owned source files (all test fixtures): `wasm/tests/node/asset-packaging.test.mjs`, `calibration.test.mjs`, `deploy-printer-cloud.test.mjs`, `paint-tools.test.mjs`, `printerConnectionDialog.test.mjs`, `snapmaker-cloud-reconnect.test.mjs`, `thumbnail-cache-lifecycle.test.mjs`. Added this report and the evidence logs directory. No manifest-fingerprinted source/build input was edited; fingerprint remains `757eb10026bc7d34e114ae8c298203b0c6ba6cee147bef88ba6a349a140ca8c2`.

## Final build and oracle disposition

PASS: isolated STEP comparison engine linked successfully with actual Emscripten6.0.11 and current source. Re-ran:

```
ORCA_ENGINE_MODULE=$PWD/wasm/build/review-preview-native/wasm/engine/orca_engine.mjs \
ORCA_STEP_MODULE=$PWD/wasm/build/review-step/step_tessellate.mjs \
ORCA_OCCT_ENGINE_MODULE=$PWD/wasm/build/review-ci-step-engine/wasm/engine/orca_engine.mjs \
node --test wasm/tests/node/step-module.test.mjs
```

`step-comparison-final.log`: all 7 tests pass, zero failures/cancellations/skips. Both UTF-8 names and security-classification comparison fixtures match facet positions, bounds and engine getMesh bytes exactly. This supersedes the two missing-comparison-runtime cancellations; it does not repair the other classified failures. Diagnostic engine has no packaging manifest contract and was never substituted for the qualified production engine.

PASS: actual `npm ci --prefix wasm/app --no-audit --no-fund` (136 packages) and `npm ci --prefix wasm/tests --no-audit --no-fund` (146 packages). Local npm reports the app esbuild postinstall is not approved under this machine's install-script policy; installed optional platform executable supports the focused esbuild tests. This is not proof of hosted runner lifecycle behavior.

FAIL: independent native CLI `cmake --build wasm/build/review-native-oracle --target OrcaSlicer -j4`. At `src/OrcaSlicer.cpp.o`, unconditional GUI imports reach `src/slic3r/GUI/I18N.hpp:1`, then `fatal error: wx/string.h: No such file or directory`, despite SLIC3R_GUI=OFF. All output is preserved in native-build.log. Prerequisite: provision compatible wxWidgets/GUI development dependencies required by these current unconditional headers, or authorize a native production entry-point correction to support a headless CLI. The latter is outside this assignment's explicit prohibition on native production source changes. No old native binary was substituted, and no current-source native oracle output exists from this build. Consequently engine.test/browser/run/run_parity/native-parity obsolete-reference consumers and expected data remain unchanged.

Concrete followups:

1. Native owner must resolve the headless CLI prerequisite above, obtain independent current-source cube output, compare normalized output and only then migrate obsolete macOS consumers (including recovery cube comparison). Never derive expected output from WASM.
2. Preview owner must update the data-URL test loaders for the new previewWorkerClient import and investigate preview-import-overlap's >2 minute noncompletion. No preview owner files were edited here.
3. Native/product owners must triage the retained empty-print fixture failures (calibration, large project, mirror, adaptive layer-height, SVG), connector/object assertions and surface-text error against stricter current bed checks; no production correction or blanket arrange bypass applied here.
4. Printer owner must resolve the retained Snapmaker reconnect assertion (one socket where two expected); cleanup now ensures that failure cannot hang the classified process.
5. After those fixes, rerun classified suites with all three explicit module selectors above and execute browser harnesses only against a provisioned candidate. Full hosted CI, Docker, browser harnesses and general native/WASM speed qualification remain unverified.

All owned build/test processes completed. No browser/server was opened by this task. No manifest-fingerprinted source changed and qualified runtime bytes/receipts remain untouched. No full CI pass claimed.
