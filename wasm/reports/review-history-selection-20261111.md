# History selection identity restore — 2026-11-11

Branch: `fix/weborca-review-followups`, base `8e21361611` (main `bb0848ad06` merged). Scope: `wasm/app/src/history/*` and focused history selection tests. No store edits, commits, builds or preview changes.

## Defect

Undo/redo snapshots captured a single selected instance and restored it by object name. With duplicate object names, restore picked the first name match even when the snapshot held a later object index. Group selections (`extraSelection`) were not captured at all, and painting restore repeated the same name lookup. Restoring a snapshot with nothing selected fell back to the first object.

## Change

- `HistorySelection` now carries an optional ordered `instances` list of `{ objectName, objectIndex, instanceIndex }`; the primary fields remain for older snapshots.
- `captureSelection` records the primary then `extraSelection` in order, deduplicates them, keeps the validated primary object/instance indices, and records the primary volume index/ID.
- `restoreSelectionSafely` resolves each captured entry against the recreated native objects. It prefers an in-range snapshot object index whose name still matches, falls back to the captured name when the index no longer identifies that object, and resolves the instance by captured index. Members that no longer exist are skipped.
- The first surviving member becomes the primary selection and remaining members restore through the existing public `selectObject` and `toggleSelect` actions. No store edits were needed. The volume resolves by validated volume index, then by captured volume ID.
- When the snapshot has no selection, or no captured member survives, both stores clear; the existing empty-selection path clears the transform tool. No unrelated object is selected.
- Painting restoration now targets the resolved primary object and remapped volume instead of a duplicate-name lookup.
- Capture and restore still run inside the single existing undo/redo transaction; no additional `commitTransaction` calls were added.

## Verification

- RED: reintroducing the old name-first object lookup failed the duplicate-name snapshot test (`actual` primary object index 0 instead of 1) and the legacy duplicate-name volume test (selection cleared).
- GREEN: `node --experimental-strip-types --test wasm/tests/node/history-selection.test.mjs` — 4/4 pass. Covers duplicate names, multiple instances of one object, selection across objects, recreated native IDs, removed primary/extra members, stale-index name fallback, empty selection clearing the tool, old single-instance snapshots, valid volume restore, volume-ID fallback, and duplicate/stale capture refs.
- GREEN: existing `wasm/tests/node/history-empty-settings.test.mjs` — 1/1 pass.
- PASS: `wasm/app` `tsc --noEmit`.
- Logs: `wasm/build/tests-review-history-selection-20261111/{green,history-empty-green,tsc}.log` (ignored runtime evidence).

The test bundles the real `historyStore`, `plateStore` and `objectListStore` modules with engine/app/painting/plates boundaries and exercises the exported production capture/restore seam; it does not copy function bodies.

No integrated UI build, browser automation, physical-device QA, service changes or private preview changes. Native object/instance ordering is expected to match the same restored project; when an index no longer matches the captured name, name fallback applies, and unresolvable members are skipped.

## Parent review correction

Painting captures its own volume index and resolves that index against recreated IDs independently of object-list volume selection. A focused test covers differing tree/paint selections and unknown legacy IDs. History selection plus empty-settings checks pass (6); TypeScript passes.
