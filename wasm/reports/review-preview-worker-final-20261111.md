# Preview worker frontend completion — 2026-11-11

Retained the partial worker implementation. Native parseGcode(inputPath, packetPath) runs in the module worker and transfers prepared packet bytes and statistics. Renderer mounting reuses the packet through loadParsedGcode. Worker and renderer staging files are cleaned up.

New import initiation synchronously invalidates renderer generation and preview-store publication, terminates the superseded worker and rejects pending requests before awaiting arrayBuffer. App publication checks ownership after asynchronous import boundaries. Parser errors reach the app toast without zero-statistics success; previous valid output survives parser and pre-mutation load failures. Native traps invalidate loaded identity because mutation may have happened. Worker failures, undecodable responses and disposal reject pending requests; later requests create a fresh worker. Late events from replaced workers cannot affect replacements.

## Diagnosis and verification

Evidence directory: preview-worker-final-20261111/.

Initial command: timeout 25s node --test wasm/tests/node/preview-worker-client-lifecycle.test.mjs wasm/tests/node/preview-import-overlap.test.mjs wasm/tests/node/mobile-preview-lifecycle.test.mjs

Result: 7 tests, 6 pass, 1 fail, under one second (initial.log). The earlier hang did not recur with the preserved partial fixture edits. The remaining fixture error was a renderer returning constant 42-layer statistics while assertions expected its worker packet's 7 layers. The fixture now returns the driven packet statistics. Cancellation assertions expect a replacement worker, matching immediate cancellation.

Older data-URL fixtures imported extensionless previewWorkerClient from a data URL and assumed synchronous raw G-code loads. Their explicit worker boundary now supplies asynchronous prepared packets and exercises loadParsedGcode, staging cleanup, failure semantics and weak source ownership. Backing-buffer immutability and failure assertions remain.

Final focused command: timeout 30s node --expose-gc --test wasm/tests/node/preview-*.test.mjs wasm/tests/node/mobile-preview*.test.mjs

22 tests pass, zero failures/cancellations/skips (focused.log), including existing mobile UI/lifecycle tests. Added undecodable-response coverage because that concrete worker failure otherwise leaves requests pending indefinitely.

TypeScript: wasm/app/node_modules/.bin/tsc -p wasm/app --noEmit passed (tsc.log).
Locales: npm --prefix wasm/app run check:locales passed (locales.log).
Source/workflow: PATH=/tmp/orca-review-actionlint:$PATH bash wasm/ci/check.sh --check passed, zero errors and two existing warnings (source.log).
Whitespace: git diff --check passed (whitespace.log).
No C++ translation unit changed; TypeScript compilation covers affected frontend modules.

Automatic source CI's existing focused command includes finalized worker/import, packet ownership, viewport, scheduling, performance and mobile Preview suites.

## Changed files

- wasm/app/src/preview/previewWorker.ts (preserved partial implementation)
- wasm/app/src/preview/previewWorkerClient.ts
- wasm/app/src/preview/orcaPreviewModule.ts
- wasm/app/src/preview/previewStore.ts
- wasm/app/src/store/appStore.ts (G-code import only)
- wasm/tests/node/preview-worker-client-lifecycle.test.mjs
- wasm/tests/node/preview-import-overlap.test.mjs
- wasm/tests/node/preview-input-ownership.test.mjs
- wasm/tests/node/preview-initial-viewport.test.mjs
- wasm/tests/node/preview-performance-counter.test.mjs
- wasm/tests/node/preview-render-scheduling.test.mjs
- .github/workflows/weborca-check.yml (focused command only)
- This report and preview-worker-final-20261111 evidence logs.

Existing mobile test edits and other shared changes preserved. No native, scene, history, cloud, runtime-manifest implementation, README, Taproot, goldens, service, commit or push work performed. Browser acceptance remains for the separate owner.

## Classified CI and integrated candidate

Classified command (from repository root):

    ORCA_ENGINE_MODULE=$PWD/wasm/build/review-preview-native/wasm/engine/orca_engine.mjs PREVIEW_MODULE_DIR=$PWD/wasm/build/review-preview-native/wasm/preview ORCA_STEP_MODULE=$PWD/wasm/build/review-step/step_tessellate.mjs ORCA_OCCT_ENGINE_MODULE=$PWD/wasm/build/review-ci-step-engine/wasm/engine/orca_engine.mjs timeout 360s node wasm/ci/run-node-tests.mjs

First run: 733 tests, 730 pass, zero failures/cancellations, three existing skips, 103.05 seconds (classified.log). Skips: weak ownership without --expose-gc (covered in focused run), optional historical scheduler comparison, optional packaged monitor deployment.

Packaging exposed a concrete Rollup error resolving the literal preview runtime URL despite @vite-ignore (build-initial.log). Both production Preview loaders now use URL variables for their served-asset dynamic imports; the import fixture explicitly substitutes its native boundary. All 22 focused checks and TypeScript passed again. Source/workflow and whitespace checks also reran successfully. A final classified repeat is recorded separately in classified-final.log.

Build environment: ORCA_EMSCRIPTEN_VERSION=6.0.11, WASM_ARCH=64, WASM_CFLAGS='-sMEMORY64=1 -pthread -fwasm-exceptions -O2', WASM_PREFIX=$PWD/wasm/build/prefix-review, OCCT_PREFIX=$PWD/wasm/build/prefix-review-occt, source wasm/scripts/env.sh. Vite selectors: ORCA_ENGINE_DIR=$PWD/wasm/build/review-preview-native/wasm/engine, ORCA_PREVIEW_DIR=$PWD/wasm/build/review-preview-native/wasm/preview, ORCA_STEP_MODULE_DIR=$PWD/wasm/build/review-step. Profiles/settings use qualified defaults. Each runtime manifest verified before packaging; Vite verifies manifests and copied assets too. Fingerprint remains 6b861c25f9246e7abdb92b5079527816a5423c7888c9da17cd4a7ef065535635 (manifests.log).

From wasm/app: npm run build -- --outDir ../build/ui-review-followups-20261111 succeeded (build.log), including locale/TypeScript checks and asset packaging. One successful candidate was produced; the initial attempt failed before output generation. Existing unresolved build-URL, Draco browser-externalization and chunk-size warnings remain. No native rebuild performed.

Candidate: wasm/build/ui-review-followups-20261111 (126 MiB), recursively chmod a-w after packaging. The sorted relative-path SHA256 inventory is preview-worker-final-20261111/candidate-files.sha256. Its SHA256 is 36f93718d08527eec23ef0f5265cdebe988ba5f4bdec568ff1f79bf4c51cee11 (candidate.sha256). Reuse these exact bytes for acceptance; do not refresh a private preview. No browser acceptance, heartbeat/performance measurement or general speedup claim. Read-only permissions prevent accidental writes, not privileged modification.

Final classified repeat after the loader correction: PASS, 733 tests, 730 passed, zero failures/cancellations, the same three skips, 103.75 seconds (classified-final.log). No unrelated failure remained in this run. Frozen candidate inventory reverified in full with sha256sum -c (candidate-verify.log); no writable files/directories remain. Final whitespace check passed. All owned test/build processes completed.
