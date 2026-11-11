# Independent CI/provenance correctness review — 2026-11-11

Reviewed the uncommitted scope against `8e21361611`, including AGENTS.md and `review-ci-provenance-20261111.md`. Read-only review except this report and temporary files under /tmp. No builds, servers, commits, or child agents.

## Findings

### P1 — Preview generation invalidates the source identity used by the pipeline

`wasm/scripts/runtime-manifest.mjs:7-18,36-37` recursively hashes all of `wasm/preview`, including demo runtime output. `wasm/preview/CMakeLists.txt:51-59` copies newly linked JS/WASM into that directory. `.github/workflows/wasm.yml:133-152` captures the hash before this build, so the first cold build or any changed preview output fails stamping with “Source changed during native build”. The engine stamped earlier also becomes stale. A subsequent stable incremental build might converge; this is not necessarily infinite, but a clean single-pass workflow cannot rely on convergence. Unrelated demo/test edits also invalidate every runtime.

Reproduced without compilation using a temporary root with src/a.cpp and wasm/preview/demo/orca_preview.js: stamping an engine then replacing only demo JS changed the fingerprint from `a4906d00b61685020b5709446996cb5da58baaaa45b713bbd57c6373b83a53e4` to `f83ad4409d3eb9db3825733ce53292bc6e13f3314a453804dbdc6aeb4489d5b8`; verification rejected the engine as stale. Minimal fix: exclude generated demo assets from source inputs, or move POST_BUILD outputs outside source roots. Define the source input inventory explicitly and test build-output stability.

### P1 — Node classifier still launches browsers on a runner without browser provisioning

`wasm/ci/run-node-tests.mjs:6-10` excludes eight browser suites but selects `alpha-access-ui.test.mjs`, `octoeverywhere-ui.test.mjs`, and `preview-values.test.mjs`. They call chromium.launch at lines 33, 60, and 65 respectively. `.github/workflows/wasm.yml` test-node installs npm packages only; browser installation occurs in the separate test-browser job. Clean runners therefore fail the selected suites for missing Chromium. preview-values additionally serves `wasm/preview/demo`, while test-node downloads neither preview artifacts nor demo runtime output.

Minimal fix: run all browser suites in the provisioned browser job, with preview runtime copied to the demo path where required, and run the remaining Node-only suites in test-node. Do not just expand the exclusion list without adding their CI consumer.

### P2 — Eight excluded feature harnesses lose their CI execution entirely

`wasm/ci/run-node-tests.mjs:6-9` removes calibration-dialog-validation, desktop-design-polish, mobile-device-webui, mobile-object-spacing, mobile-preview-lifecycle, mobile-preview, preset-inheritance-save, and ui-section-spacing from the previous glob execution. Neither browser/run.mjs nor app/smoke.mjs invokes these files, and no workflow runs them separately. Several use in-memory React fixtures and page interception, so the “separately served candidate required” explanation is inaccurate for those suites. Minimal fix: add explicit execution in test-browser after Chromium provisioning; provide PRESET_SOURCE_ROOT if that harness needs an external source tree, or make its repository-local source selection explicit.

### P2 — Dependency/architecture provenance does not constrain selected binaries

`wasm/scripts/runtime-manifest.mjs:44,48-52` records dependency content, architecture and flags but verification only checks dependency hash syntax. With unchanged source and a valid stamped runtime, changing a dependency prefix's header from `dependency` to `changed` still passed verifyManifest in a temporary fixture. A previously stamped wasm32 or old-prefix runtime can therefore pass production packaging against the same source, despite being stale for the selected build configuration. Emscripten version/link configuration are also not validated.

Minimal fix: define an expected build identity (dependency content or pinned dependency recipe/toolchain identity, architecture and relevant flags), pass it to verification, and reject mismatches. Packaging need not carry full dependency prefixes if a trusted expected identity is supplied. Keep the distinction explicit: current verification proves source fingerprint agreement and artifact integrity, not a reproducible dependency/toolchain build. This is a stale-binary selection defect; signing manifests is not required to fix it.

### P2 — Runtime artifact uploads discard the new manifests

`.github/workflows/wasm.yml:189-203` uploads explicit engine and preview filenames without runtime-manifest.json. Downloads cannot be verified with the newly introduced verifier, and these artifacts cannot later be used as production packaging inputs without rebuilding or improperly restamping old bytes. Consumers currently check only nonempty files. Minimal fix: include each manifest, download it beside its runtime and verify before tests/package reuse. Apply the same change to wasm/ci/wasm.yml. STEP upload's common ancestor is wasm/build and its download to wasm/build preserves both required STEP directories correctly; do not flatten them.

### P2 — Automatic checks omit fingerprint inputs and do not enforce schema validation

`.github/workflows/weborca-check.yml:4,7` omits `deps_src/**` and `version.inc`, both explicit source fingerprint inputs. Changes confined to those paths receive no automatic check. Its line 24 invokes check.sh, but `wasm/ci/check.sh:58-100` validates only the WASM workflow/template and merely warns if actionlint is absent. It never validates the new automatic workflow. Minimal fix: cover the missing inputs and install a pinned actionlint binary in CI, then validate every active workflow with failure propagation. Local schema validation passed; this finding concerns the continuing CI contract, not a current YAML schema error.

## Docker and filesystem assessment

Dockerfile COPY includes all listed source roots and the three manifests. However, the hash walker includes every file while `.dockerignore` excludes `*.o`, `*.log`, deps/build and other generated paths. A dirty source root containing these files produces a host fingerprint that cannot match Docker's filtered copy. No specific currently present excluded source file was established, so this is a conditional reproducibility risk rather than an additional confirmed cold-checkout failure. Minimal direction: share an explicit source inventory between fingerprinting and packaging. Runtime copying is also narrower than runtimeFiles' recursive JS/MJS/WASM/TXT inventory; future sidecars must be copied or rejected explicitly.

No symlinks were found by find in the inspected source roots. The walker uses statSync and follows symlink directories without cycle detection or a root containment check (`runtime-manifest.mjs:11-14`); user-supplied dependency prefixes can consequently include outside-machine content or loops. Relative manifest keys avoid printing absolute paths but do not make those inputs portable. Reject escaping/cyclic links or define canonical link handling before claiming arbitrary-prefix reproducibility.

## Existing parity debt and expensive limits

The obsolete native reference remains a required consumer in engine.test.mjs:288,348 and browser/run.mjs:285,383,472, independent of the optional native CLI steps. run_parity.mjs also uses refs-macos-x86_64, and native-parity.mjs performs its macOS comparison around line 463. An independent current-source native oracle is still required before replacing these expectations. WASM output is not a valid replacement golden by itself. This is existing qualification debt, not a newly introduced toolpath regression.

The new cloud-startup, history-selection and scene-performance Node tests are reachable through the manual runner's discovery; the automatic workflow still runs only its three named method suites. Preview packet/worker tests outside wasm/tests/node are not picked up by that discovery and need explicit focused CI wiring to qualify those features.

Authorized desktop workflow removal is not a finding. No remaining workflow references to removed reusable workflows were found. Native analysis/unit coverage is lost as described in the implementation report; retained profile/locale checks remain.

## Validation performed

- Official actionlint v1.7.7 binary: `actionlint -shellcheck= .github/workflows/*.yml` passed all active workflows. Shellcheck was deliberately disabled; this proves schema/expression validation, not hosted execution.
- Copied wasm/tests package/lock files to a temporary directory and ran `npm ci --ignore-scripts --no-audit --no-fund`: 146 packages installed successfully. This validates lockfile resolution; lifecycle/native install behavior was not exercised.
- `node --test wasm/ci/runtime-manifest.test.mjs`: one test passed.
- Temporary manifest fixture reproduced generated-output invalidation and dependency-change acceptance. Shell performed all fixture writes; Node only exercised application APIs.
- Workflow/template `cmp` passed. Inspected STEP directory defaults and upload/download ancestor pairing; they agree.

No full Node/browser suite, Docker image build, hosted Actions run, cold dependency toolchain, OCCT link, native oracle, or integrated UI/native build was executed. Findings above rely on concrete control/data flow or the focused fixtures, not an assertion that those expensive checks passed.
