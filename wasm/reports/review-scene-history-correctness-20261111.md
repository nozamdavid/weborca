# Scene and history correctness review — 2026-11-11

Branch `fix/weborca-review-followups`, base `8e21361611`. Read-only review of uncommitted `PlateScene.ts`, `PlateView.tsx`, `plateStore.ts`, `objectListStore.ts` rename call, and `history/{types,historyStore}.ts`. No source edits, UI build, browser run, server or commit was made for this report.

Three defects are actionable from the code alone. The first two need a browser to confirm user-visible impact; the third is a latent mismatch in the changed paint restore path. Existing focused tests pass, so these are gaps those tests do not cover.

## 1. Mesh cache fills no longer notify subscribers; the paint volume list can go stale

Location: `wasm/app/src/plate/plateStore.ts:423`, trigger at `plateStore.ts:231`, consumer at `wasm/app/src/paint-tools/PaintToolsPanel.tsx:47-48,131`.

`getMesh` now writes the parsed buffer into the existing map in place. Base did `set({ meshCache: new Map(meshCache) })` after filling, which re-rendered every `meshCache` subscriber. Now a fill only re-renders the panel for the fill that happens during `startPainting`, because that action separately updates the paint store.

Concrete failure: while painting a multipart object, any action that clears the caches calls `refreshObjects()` with `preserveGeometry` false (import, duplicate, delete another object, merge, part transform, undo restore, etc.). That publishes an empty map, `PaintToolsPanel` re-renders with `volumes.length === 0`, and its `#paint-volume-select` disappears. The scene then refills the map silently through `getMesh`, so the dropdown remains hidden until an unrelated paint or plate store field changes.

Minimal fix, keep the late-RPC identity guard and publish the fill:

```ts
if (get().meshCache === meshCache) {
  meshCache.set(objectId, parsed);
  set({ meshCache: new Map(meshCache) });
}
```

`getViewerMesh` (`plateStore.ts:437`) has no subscribed consumers, so its in-place write can stay as is. Publishing on fill keeps the late-write rejection because the identity check still runs first.

## 2. Cancelling a group transform restores meshes without requesting a frame

Location: `wasm/app/src/plate/PlateScene.ts:76-78` (`cancelGroupKey`), restore at `PlateScene.ts:119-123`, and the touch rollback at `PlateScene.ts:556` into `finishPlaneDrag` (`PlateScene.ts:2577`).

`finishGroupDrag(false)` copies the saved positions, quaternions and scales back onto the meshes. The Escape handler calls it and stops, and no `objectChange` follows because `dragging` and `axis` were cleared. With continuous RAF removed, the canvas keeps the last dragged frame until the next pointer, camera or theme event. The cancel test in `group-transform-gizmos.test.mjs` asserts the restored transforms but stubs `requestDraw` to a no-op.

The same gap exists for touch: `bindCanvasTouch` calls `singleEnd(false)` on rollback, window blur and longpress, and its capture listener stops propagation before `PlateScene.onPointerCancel` runs. `finishPlaneDrag(false)` restores the origins without a draw.

Minimal fix: request one frame where the rollback happens. `this.requestDraw()` at the end of `finishGroupDrag` when `!commit`, and at the start of the `singleEnd` callback (or at the end of `finishPlaneDrag` after the restore). Requests during `destroy()` are no-ops because `isDestroyed` is already set there.

## 3. Painting restore ignores the captured paint volume and uses the object-list selection volume

Location: capture at `wasm/app/src/history/historyStore.ts:387-393`, restore at `historyStore.ts:806-814`, type at `wasm/app/src/history/types.ts:22-26`.

`HistoryPaintState.selectedVolumeId` is captured and then never read. Restore passes `restoredSelection.volumeId`, which comes from `useObjectListStore.selectedVolumeId` (`captureSelection`, `historyStore.ts:184-195`). The paint panel's volume selector only writes `usePaintToolsStore.selectedVolumeId` / `usePaintingStore.selectVolume`; it does not update the object-list selection. When the painted volume is not the object-list-selected volume (the common case is no object-list volume selected, so the first partition wins), undo/redo starts painting on a different volume. A raw captured ID cannot be used directly because native 3MF restore reallocates volume IDs.

Minimal fix: capture `selectedVolumeIndex` for the painted volume in `HistoryPaintState` (look it up in `useObjectListStore.getState().objects` for `paintStateObj.selectedObjectId`), and in restore resolve that index against the refreshed object tree for the primary object, falling back to `restoredSelection.volumeId` for snapshots without the new field.

Scope note: the capture reads `usePaintingStore`, while the live painting UI uses `usePaintToolsStore`; `SupportPaintingPanel` is exported but not mounted anywhere under `wasm/app/src`, and `usePaintingStore.startPainting` is only called by this restore path. Snapshots therefore carry `paintState: null` in the current app, so the wrong-volume outcome is latent until that store is driven again. The field still needs the index mapping when it is.

## Verified behavior, not flagged

- `setObjects` staging and generation guard hold: every await is followed by a destroyed/generation check and the commit body has no awaits. `scene-performance.test.mjs` exercises stale and destroyed completions.
- Transform reuse works: `refreshObjects(true)` keeps both caches, `geo.userData.meshData` and `node.userData.viewer` identity keep geometry and volume nodes; an ordinary refresh replaces both maps and late fills are rejected by the identity guards.
- Rename's `refreshObjects(true)` integration is present and `object-rename-sync.test.mjs` asserts it.
- Selection capture/restore for duplicate names, recreated IDs, primary/extras ordering and volume index/ID fallback matches `history-selection.test.mjs`.

## Considered and left out

- A single failing `getMesh` now rejects the whole `setObjects` call instead of skipping one object. That was the stated design in the scene report ("retrieval failures propagate ... rather than publishing a revision"), so it is recorded as a consequence, not a defect.
- Duplicate-name objects whose restored order no longer matches the captured index fall back to the first name match. The history report calls out this ordering assumption and the tests encode the fallback.

## Checks run

- `node --experimental-strip-types --test wasm/tests/node/history-selection.test.mjs wasm/tests/node/object-rename-sync.test.mjs wasm/tests/node/group-transform-gizmos.test.mjs` — 8/8 pass.
- `node --experimental-strip-types --test wasm/tests/node/scene-performance.test.mjs` — 5/5 pass.
- `cd wasm/app && npx tsc --noEmit` — pass.

These were run to establish that the defects above are outside existing coverage, not to validate the proposed fixes. The cache-notification and Escape-cancel issues are static call-chain findings and remain browser-unverified.
