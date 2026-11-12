# Scene followups — 2026-11-11

## Implemented behavior

`PlateScene.setObjects` stages both mesh representations before any scene mutation. Every awaited continuation checks the request generation and destroyed state. The accepted commit contains no awaits; stale requests cannot insert/delete scene nodes or allocate GPU geometries. It returns an acceptance boolean. PlateView publishes meshRevision only after accepted completion, with effect cleanup and scene identity checks. Retrieval failures propagate to the view error handler rather than publishing a revision.

`plateStore.refreshObjects(true)` preserves both mesh caches. Single and batch instance transforms use this path. Ordinary refresh invalidates both caches, covering existing cut, repair, part-transform, restore/import/delete/undo callers conservatively. In-flight cache loads cannot repopulate a replaced cache. Accepted parsed-buffer identity avoids full vertex comparisons and viewer geometry rebuilding on transforms. Changed buffers still update geometry. Transform/move/rotate/scale preserve mesh identity.

Integration action outside this ownership boundary: `objectListStore.renameObject` still calls `refreshObjects()`; its owner should change that call to `refreshObjects(true)` for rename cache retention. Volume rename does not refresh plate objects. No unsafe inference from equal bounds or vertex counts was introduced to classify geometry mutations.

Rendering now schedules coalesced frames on mutations, pointer input, OrbitControls changes, preferences, cut/measurement subscriptions, asynchronous label paints, bed assets, overlays, and resize/visibility changes. OrbitControls update continues frames while damping changes the camera. Theme attributes have a MutationObserver disconnected on destroy. Existing hidden/destroy cancellation remains. Cut preview frame follows current transforms when rendering; it has no independent time animation.

## Verification and measurements

Commands:

- `node --test wasm/tests/node/scene-performance.test.mjs wasm/tests/node/group-transform-gizmos.test.mjs`: 8/8 pass, 179.239 ms total in the recorded run.
- `SCENE_BASELINE=1 node --test wasm/tests/node/scene-performance.test.mjs`: baseline store loaded from `8e21361611` through the same bundled method seam. Other scene tests use current source; the idle comparison separately loads baseline scheduler methods.
- `cd wasm/app && npx tsc --noEmit`: pass.
- `git diff --check`: pass.

The initial scheduler test failed with missing requestDraw before demand rendering implementation. Deferred stale/destroy tests and accepted geometry identity tests exercise actual scene methods, with renderer and unrelated UI boundaries substituted. Group release tests exercise actual TransformControls handlers; the fixture now supplies requestDraw because it intentionally bypasses scene construction.

Small fixed workload: one 64-byte binary triangle, regular + viewer warmup, 20 instance transforms with both representations requested after each, then one geometry refresh with both requested. RPCs and returned binary bytes are counted at the engine boundary; engine execution and network latency are substituted.

| Measurement | Baseline | Current |
| --- | ---: | ---: |
| Mesh RPCs | 23 | 4 |
| Binary bytes returned | 1,472 | 256 |
| Workload elapsed ms (one run) | 0.998189 | 0.863751 |
| Additional transform RPCs | 20 | 0 |
| Idle renders over 20 scheduler ticks | 20 | 1 |
| Pending frame after ticks | 1 | 0 |

These timings are harness observations, not hardware performance claims or browser frame latency. Baseline regular mesh remained cached even across ordinary refresh; its stale-cache risk is corrected by default invalidation. Baseline viewer mesh was fetched every transform. Current geometry refresh refetches both representations.

Damping test requests two dirty frames together and verifies a single initial render, then two changing control updates plus a settling update and no pending frame. Deferred older request completes after a newer accepted empty update, or after destroyed state, and creates no scene geometry. Accepted mesh and object identities survive a transform; a changed mesh buffer updates the rendered positions.

No C++ source changed. No integrated UI build, services, deployment, commits or browser/physical QA were performed. The accepted immutable HTTPS candidate remains untouched. Final combined candidate needs visual QA for damping/gestures, all paint overlays/cursors, asynchronous HTML labels, theme changes, cut/measurement controls, hidden/resumed viewport and asset loading. Rename cache retention needs the caller integration above before claiming all requested behaviors complete.

## Parent integration corrections

Rename now uses refreshObjects(true); the rename regression asserts cache preservation. Mesh fills publish the guarded cache update so paint volume subscribers are notified. Group and touch cancellation request a frame after restoring transforms. Scene/group focused tests pass (9 checks); rename check passes, and TypeScript compilation passes. Measurements above remain harness evidence, not physical GPU claims.
