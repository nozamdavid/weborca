# Build, startup and verification pipeline audit — 2026-11-11

Baseline: local worktree `prototype/html-in-canvas-plate-title`, HEAD `6773b526d06b8e7933e18955b508a7d5d1022fee`, plus the accepted uncommitted box-selection, group-gizmo, bed-boundary and selection-release changes present during inspection. This is a development checkout, not a production or main-branch baseline. Line references describe the current working files.

Read-only audit of `wasm/scripts`, `wasm/ci`, `.github/workflows`, package/build configuration, engine loader/worker startup, test harnesses, deploy configuration and existing reports. No builds, test suites, browser automation, service changes, commits or deployments were run. The running private preview on PID 592057 / HTTPS 5065 was not touched. Two small read-only measurements were used to resolve concrete uncertainty: `bash wasm/ci/check.sh --check`, and one engine slice to hash the current cube output against the committed references. Artifact sizes and hashes were read from existing build directories, not from a new build.

Existing audits `wasm/reports/codebase-review-engine-20261111.md` (engine source) and `wasm/reports/codebase-review-frontend-20261111.md` (scene, selection and preview) are not repeated here. This report covers delivery: CI, packaging, startup and the verification harnesses.

## 1. The `test-node` CI job cannot pass from a clean checkout

**Confirmed CI defect; high confidence from source; the hosted workflow has not been executed in this environment.** The job checks out the repository, installs no npm dependencies, downloads only the `orca-wasm64` engine/profile artifacts, and then runs every file matching `wasm/tests/node/*.test.mjs` (`.github/workflows/wasm.yml:215-283`, run at `:277-279`). The suite does not match that environment:

- Tests import dependencies through `../../app/node_modules/...`: `wasm/tests/node/alpha-access.test.mjs:12-13`, `archive-models.test.mjs:3-4`, `bed-boundary-slicing.test.mjs:4`, `box-selection.test.mjs:3`, and many others. Those dependencies are declared in `wasm/app/package.json`; `wasm/tests/node/package.json` declares only metadata (`name`, `type`, `main`) and no dependencies.
- Eight tests import Playwright from the untracked build directory `wasm/build/web-smoke/node_modules` (`calibration-dialog-validation.test.mjs:4`, `desktop-design-polish.test.mjs:4`, `mobile-device-webui.test.mjs:6`, `mobile-object-spacing.test.mjs:4`, `mobile-preview-lifecycle.test.mjs:4`, `mobile-preview.test.mjs:5`, `preset-inheritance-save.test.mjs:4`, `ui-section-spacing.test.mjs:4`). The build job never creates that directory; the sibling `test-browser` job installs dependencies and browsers at `:412-416`, but `test-node` does not.
- Three tests default to `wasm/build/orca-step-runtime/...` (`edit-ops.test.mjs:11-19`, `grouped-option-settings.test.mjs:8-9`, `svg-units.test.mjs:11-12`), and `step-module.test.mjs:29-36` additionally requires `wasm/build/step-module/step_tessellate.mjs`. The build job produces `wasm/build/orca-wasm64` and the preview runtime, but not `orca-step-runtime` or the STEP module; `wasm/build` is ignored by git (`wasm/.gitignore:1`).

Trigger: any clean runner executing the prepared workflow. Consequence: the suite fails at the first unresolved import or missing engine, so its result is not evidence about the current source. A developer machine can appear green because `/mnt/appdata/...` dependencies happen to be present locally.

Smallest fix: add `npm ci` for `wasm/app` and `wasm/tests` to `test-node`; import `playwright` as a normal package; move the eight browser-dependent files into `test-browser` (which already installs Chromium/Firefox) or install a browser in `test-node`; and either build the STEP variants or explicitly set/skip them. **Effort M.** Validation: clean checkout/container, install the two lockfiles, run the suite and confirm it reports real pass/fail rather than module-resolution errors; then run one browser-dependent file in `test-browser`.

## 2. The CI web-app artifact omits the STEP module that deployment requires

**Confirmed artifact/production-qualification gap; high confidence.** The `build` job compiles the main engine, preview engine, settings layout, profiles and web bundle (`.github/workflows/wasm.yml:126-165`). It never runs `wasm/scripts/build_step_module.sh` or produces the OCCT prefix that script requires. The Vite packaging hook silently skips the STEP directory when it is absent (`wasm/app/vite.config.ts:233-238`), so the build still succeeds. The Dockerfile instead copies `wasm/build/step-module/step_tessellate.{mjs,wasm}` and the license texts (`wasm/deploy/Dockerfile:10`) and asserts they are present in `dist/` (`:24-30`).

Trigger: consuming the CI `orca-wasm-app-dist` artifact or building the image from a clean artifact set. Consequence: the CI-distributed app has no STEP import assets and is not the deployable bundle the Dockerfile expects; image builds depend on manually rebuilt local files. The browser smoke test does not exercise STEP import, so this gap can remain green.

Smallest fix: build the STEP module in the `build` job (or a separate job that uploads `orca-wasm-app-dist` plus the STEP artifact) and make `vite.config.ts` fail when a required STEP module directory is missing; add one STEP-import smoke assertion to `wasm/tests/app/smoke.mjs`. **Effort M-L** because the OCCT prefix/dependencies must be provisioned. Validation: clean-runner build, assert `dist/engine/step/step_tessellate.{mjs,wasm}` exist and are non-empty, import a STEP fixture, then build the Docker image from only the CI artifacts.

## 3. The only local verification entrypoint is stale, and CI is manual-only

**Confirmed defect, measured; process gap.** `wasm/ci/check.sh` requires exactly 15 test files (`wasm/ci/check.sh:227-235`), but the directory currently contains 102 `*.test.mjs` files. Running `bash wasm/ci/check.sh --check` exits 1 with `[ERROR] Expected exactly 15 Node unit test suites under wasm/tests/node/, found 102`. The bundled README repeats the stale inventory (`wasm/ci/README.md:22`, `:77`, `:86`). Separately, the active workflow triggers only on `workflow_dispatch`; the push and pull-request blocks are commented out (`.github/workflows/wasm.yml:3-16`), and no step invokes `check.sh`.

Trigger: running the documented local gate, or changing a wasm file without manually dispatching CI. Consequence: the documented validation command is red on the current checkout, and there is no automatic gate for the 102 node tests, packaging, or parity. A manual run that skips these suites can still look green because the workflow was never entered.

Smallest fix: replace the exact count with a lower-bound or per-suite check; update the README; invoke `check.sh --check` in a cheap, paths-filtered pull-request job (static checks, locale check and `tsc --noEmit`, plus engine-independent node tests). Keep the full toolchain build manual or nightly. **Effort S-M.** Validation: `bash wasm/ci/check.sh --check` exits 0 on the current tree while a deliberately removed expected suite still fails; a wasm-only pull request triggers the static job.

## 4. Browser and engine parity checks still compare against the historical macOS reference

**Confirmed test/reference mismatch; the reference hashes were measured, the suites were not executed.** `wasm/tests/parity/README.md:26-28` states that the old macOS references predate the current portable ordering and do not describe current output, and that browser smoke uses `refs-portable/cube-voron.json`. The app smoke does use the portable hash (`wasm/tests/app/smoke.mjs:41`, `:158-159`), but the other consumers still use the historical file:

- `wasm/tests/browser/run.mjs:22` sets `P6_CUBE_GCODE` to `refs-macos-x86_64/cube-voron.gcode` and requires exact/tolerant equality at `:285`, `:383` and `:472`.
- `wasm/tests/node/engine.test.mjs:28` uses the same historical file and invokes `compare_gcode.sh` at `:288` and `:348`.

Measurement: slicing the cube with the current default engine produced 100 layers and normalized hash `d2a7f956defad1b12b1b1f1effb06fcac4081dd4e01e3345505558babd518bb6`, identical to `refs-portable/cube-voron.json`. The committed macOS reference hashes to `61faefab5f3fa758808a0891372f29e2db9b2fff62c24f8265db7acc9b9aecd1`. `compare_gcode.sh` exits 1 or 2 for any normalized difference, and `execFileSync` throws on a nonzero exit, so these checks reject the current output.

Consequence: the browser and engine suites either fail at the reference step or are skipped, while a report that tests "parity" can still be read as green. Matching current WASM alone cannot bless a replacement oracle. Require independently matched native output at the same source/configuration and preserve the historical mismatch investigation.

Smallest fix: independently establish the same-source native oracle, then use the qualified portable hash (or regenerate matched references) in `engine.test.mjs` and the browser suite, and keep the macOS file clearly labeled historical. **Effort S.** Validation: run both checks against the downloaded engine and require a pass; perturb one slicing option and require a failure.

## 5. A machine-local `node_modules` symlink is tracked in git

**Confirmed repository defect; effort S.** `git ls-files -s wasm/tests/node/node_modules` reports a mode-`120000` entry whose target is the absolute path `/mnt/appdata/workspace/OrcaSlicer/wasm/app/node_modules`. The target exists on this host but not on a clean runner or another developer machine. `wasm/tests/.gitignore` ignores `node_modules/`, but the tracked entry overrides that rule.

Trigger: any clean clone. Consequence: test dependency resolution depends on one host's filesystem layout; the repository carries an untracked build artifact as a source path. This combines badly with finding 1, where the CI job relies on the same undeclared dependency tree.

Smallest fix: remove the symlink from the index (`git rm --cached wasm/tests/node/node_modules`) and install dependencies with the lockfiles. **Effort S.** Validation: a fresh clone contains no such symlink; after `npm ci` for `wasm/app` and `wasm/tests`, the focused tests resolve their imports.

## 6. Packaged engine provenance is not bound to source or to the accepted candidate

**Confirmed provenance gap; high confidence, measured artifact divergence.** The Dockerfile packages prebuilt runtime files from `wasm/build/...` without a build stamp or hash check (`wasm/deploy/Dockerfile:9-13`). The README tells operators to rebuild engines manually when C++ changes (`wasm/deploy/README.md:76`, `:85`). The Vite build defaults to `wasm/build/orca-wasm64/wasm/engine` (`wasm/app/vite.config.ts:54-58`) and only rejects empty files or a missing WASM magic header (`:222-238`).

Current artifacts differ:

- Default `wasm/build/orca-wasm64/wasm/engine/orca_engine.wasm`: 12,102,451 bytes, mtime 2026-11-06, SHA-256 `f13c2eb82092b31e97b0505050d9798bfbfe0cc6ed7f51feabeab831561544cd`.
- Accepted bed-boundary candidate `wasm/build/engine-bed-boundary-20261111/wasm/engine/orca_engine.wasm`: 12,104,280 bytes, mtime 2026-11-11, SHA-256 `35707f0c38c6c83def0b2ce112c7ef2017d3e405d844644ccccc03182f371405`.
- The source `wasm/engine/Engine.cpp` was modified 2026-11-11, after the default engine was built.
- A separate existing `wasm/app/dist` engine is 12,099,659 bytes, mtime 2026-11-04, a third build.

Trigger: `npm run build` or `docker compose build` in a tree whose default build directory has not been refreshed. Consequence: current React code can be packaged with an older WASM engine, silently omitting engine fixes; the produced image has no auditable source-to-binary link. This is a delivery risk, not proof that the current staging image is wrong.

Smallest fix: emit a build manifest (git revision, build directory, SHA-256 for engine, STEP module and preview) during the engine build; make the Docker build verify the manifest and fail when the packaged engine lacks a matching stamp. A source-mtime check is weaker and should not replace hashes. **Effort S-M.** Validation: change `Engine.cpp` while leaving a stale default engine and confirm the image build fails; build from the accepted candidate and confirm the manifest matches the packaged bytes.

## 7. First render and engine download wait on an optional cloud status request

**Confirmed startup serialization; latency impact not measured.** `wasm/app/src/appEntry.tsx:17-19` awaits `checkCloudSession()` before importing and rendering `App`. That call reaches the same-origin `/_orca-cloud/status` endpoint (`wasm/app/src/orcaCloud/account.ts:48-67`; `wasm/app/src/orcaCloud/client.ts:51-66`) with no timeout and no `AbortSignal`. Only after the React tree mounts does `App.tsx:96-104` call `initApp`, which starts the engine worker and its 12.1 MB WASM download (`wasm/app/src/engine/orcaEngine.ts:53-72`; `wasm/web/engine-worker.js:42-84`). `wasm/app/index.html` has no preload/modulepreload for the engine.

Trigger: a slow, stalled or blocked cloud status endpoint, including static hosting where the bridge is disabled. Consequence: the page root stays empty until the cloud request settles, and the engine fetch cannot begin until the request and the app chunk load finish. On a hung endpoint the wait is unbounded; `CloudStartup.tsx` already has UI for the checking state but never gets a chance to render.

Smallest fix: render checking/error UI independently and bound the optional request while preserving intended account state and authentication gating. If isolation allows, start the engine prefetch independently of the cloud result. **Effort S.** Validation: delay `/_orca-cloud/status` by several seconds or block it, measure first paint and the first engine request, and confirm cloud presets still activate when the delayed check succeeds.

## Coverage and remaining limits

Inspected the wasm build/deploy scripts, both CI workflow copies, package/lock configuration, engine loader and worker, startup path, node/browser/parity/stress/perf harnesses, Docker/compose/server packaging, and the existing engine/frontend/feature reports. The hosted workflow was not executed; these findings combine source inspection with one static-check run, one engine slice/hash measurement, reference hashes, and artifact sizes/mtimes. Docker image builds, browser suites, and build-time measurements were not run, so no percentage speedup is claimed.

Package inventory from existing artifacts: engine 12.1 MB, STEP module 10.2 MB, preview 2.34 MB, packed profiles 29 MB (including 17 MB covers and 8.1 MB assets), locale sources 23 MB. The 29 MB profile tree is not all fetched at startup; the worker fetches the profile index, resources bundle, `OrcaFilamentLibrary` (1.8 MB) and the selected vendor. The startup finding concerns ordering and blocking, not those transfer sizes alone.

Gaps left open: no measured cold/warm build breakdown, no object-cache evaluation, no startup trace, no hosted CI run, and no image content manifest. The `wasm/build` tree is untracked and partly symlinked outside this worktree, so artifact hashes describe this checkout's visible files, not a release record. Production/main equivalence remains unknown.
