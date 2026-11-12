# Review integration — 2026-11-11

Branch: `fix/weborca-review-followups`. Integration is local; no push, PR, main merge, preview rebuild or Taproot update.

## Preserved history

- Initial source HEAD: `6773b526d0` on `prototype/html-in-canvas-plate-title`.
- Signed checkpoint: `7953eb51007c16b7b7bfd7bdf0cd34ea0c7e5cbd`, retained on that original branch. All 32 accepted tracked/untracked files, including QA PNGs, tests and audit reports, were committed; ignored build/runtime artifacts were excluded.
- Fetched main base: `bb0848ad065fd5facb52f1891dba03c73def53ce`. PR5 (`afcf3da987`) and PR6 (`bb0848ad06`) are present in its history; fetch found no newer main changes.
- Three-way cherry-pick result: `00a682a8320294025d6387d187c0c84b25bce9be`. The following documentation commit contains this receipt and root `todo.md`; its identity is available from `git log -1`.
- Checkpoint and integration signatures verified with `git log --show-signature`: good ED25519 signature, author and committer `nozamdavid <davidmarcosg98@gmail.com>`. No attribution trailers.

## Integration decisions

README conflict retained main's native/parity/publication documentation and appended the accepted prototype descriptions. SliceStatsPanel.css retained main's `display: inline-flex`, which already provides the accepted export alignment behavior; the stale-base removal of `display: block` adds no further main diff. Engine.cpp merged cleanly: only the accepted boundary includes/filter/restoration and empty-print check were applied over main's v2.5 engine. PlateScene/PlateView merged automatically; HTML labels and main adaptations remain present alongside box/group selection and release fixes. No wholesale old engine restoration.

## Verification

- PASS: 13 tests via `source wasm/scripts/env.sh` then `bash wasm/scripts/memcap.sh node --experimental-strip-types --test wasm/tests/node/{box-selection,group-transform-gizmos,multi-scale}.test.mjs`. Includes empty-selection tool clear, scale batching, group cancellation and TransformControls release before viewer picking.
- PASS: app `tsc --noEmit` under memcap and `npm run check:locales` (22 catalogs).
- PASS: `git diff --check origin/main`; no conflict markers in resolved README, plate sources or Engine.cpp. Root todo links point to the tracked consolidated audit and verified archived branch commit `0e178a4fbe36f2147f91173627255fedbf27efd8`.
- BLOCKED: isolated Engine.cpp TU target. Existing cache home is this worktree; `cmake --build wasm/build/engine-bed-boundary-20261111 --target wasm/engine/CMakeFiles/orca_engine.dir/Engine.cpp.o -j1` under memcap triggered required regeneration and failed: main requests CGAL 6.2, while `/mnt/appdata/workspace/OrcaSlicer/wasm/build/prefix-wasm64/lib/cmake/CGAL/CGALConfig.cmake` reports 5.6.3. Log: `wasm/build/tests-review-integration-20261111/engine-tu.log` (ignored runtime evidence). Compilation did not start. No claim of a verified integrated engine or fresh bed-boundary runtime test is made.

## Next build prerequisites

Provide a compatible WASM dependency prefix with CGAL 6.2, then reconfigure the isolated build against this worktree and compile Engine.cpp before linking the upcoming combined feature batch. The reused cache also references parent dependency source paths; freshly configure those against this checkout rather than copying parent uncommitted source. Parent dependency binaries were only read. Do not reuse the older isolated runtime as proof of main integration. No full engine link or integrated UI build was attempted.

Existing dependency node_modules was temporarily symlinked for checks, then removed. Private preview PID592057 was verified to still serve `ui-transform-release-selection-20261111` on port5064 behind HTTPS5065; no stop, repoint or service changes. Parent checkout source was not modified. Deferred work is recorded only in [todo.md](../../todo.md); approved immediate follow-up fixes remain for the parent's subsequent batches.

## Files changed from main by the accepted integration

README.md
wasm/app/src/locales/en.json
wasm/app/src/locales/es.json
wasm/app/src/mobile/MobilePrepare.tsx
wasm/app/src/plate/NumericTransform.tsx
wasm/app/src/plate/PlateScene.ts
wasm/app/src/plate/PlateView.tsx
wasm/app/src/plate/boxSelection.css
wasm/app/src/plate/boxSelection.ts
wasm/app/src/plate/multiScale.ts
wasm/app/src/plate/plateStore.ts
wasm/engine/Engine.cpp
wasm/reports/bed-boundary-slicing-20261111.md
wasm/reports/box-selection-20261110-qa/orthographic-drag.png
wasm/reports/box-selection-20261110-qa/selection-active-plate.png
wasm/reports/box-selection-20261110.md
wasm/reports/codebase-review-20261111.md
wasm/reports/codebase-review-backlog-20261111.md
wasm/reports/codebase-review-delivery-20261111.md
wasm/reports/codebase-review-engine-20261111.md
wasm/reports/codebase-review-frontend-20261111.md
wasm/reports/codebase-review-product-20261111.md
wasm/reports/empty-selection-tool-20261111.md
wasm/reports/export-button-alignment-20261111.md
wasm/reports/group-transform-gizmos-20261111.md
wasm/reports/multi-scale-20261110.md
wasm/reports/transform-release-selection-20261111.md
wasm/tests/node/bed-boundary-slicing.test.mjs
wasm/tests/node/box-selection.test.mjs
wasm/tests/node/group-transform-gizmos.test.mjs
wasm/tests/node/multi-scale.test.mjs
