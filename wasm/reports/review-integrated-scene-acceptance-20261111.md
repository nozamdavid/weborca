# Integrated scene acceptance — 2026-11-11

Acceptance blocked: Escape during an actual mouse object drag commits the moved position on release instead of rolling back. Stopped focused acceptance at this concrete product defect. No source changes or rebuilds.

Branch: fix/weborca-review-followups. Read repository AGENTS.md and /mnt/appdata/workspace/OrcaSlicer/AGENTS.md, Preview final, scene performance, history selection and box-selection implementation reports.

Candidate: `wasm/build/ui-review-followups-20261111`. All inventory entries pass SHA256 verification; evidence: [candidate-verify.log](integrated-scene-acceptance-20261111/candidate-verify.log). Inventory SHA256: `36f93718d08527eec23ef0f5265cdebe988ba5f4bdec568ff1f79bf4c51cee11`. Frozen bytes reused for both browser runs.

Reproduce from repository root:

```sh
node --check wasm/reports/integrated-scene-acceptance-20261111/smoke.mjs
node wasm/reports/integrated-scene-acceptance-20261111/smoke.mjs
```

The owned HTTP server binds loopback port 5068 and supplies COOP same-origin / COEP require-corp. A fresh headless Chromium context loads the real packaged application, engine and imported tests/data/20mm_cube.obj. crossOriginIsolated is true. Printer setup uses the existing public store helper (Voron 2.4 300); no engine/geometry responses are mocked. Screenshots were inspected locally.

## Blocker reproduction

1. Import cube; select and drag with real Playwright mouse events. Selection remains after release.
2. Clear with a genuine background click. Select again via public store action; apply native move, Z rotation and scale through the real store actions.
3. At position [170,150,10], start a real pointer drag on the cube and move 45 screen pixels. Existing accessible scene interface confirms planeDrag is active.
4. Send Playwright keyboard Escape while mouse is down; release mouse.
5. Expected: original transform restored. Actual native instance and rendered mesh both become [190.2706409150585,148.51412856665613,10]; selection becomes empty. The new position persists after 500 ms. This is an actual browser keyboard event, not a directly invoked cancellation callback.

Evidence: [run.log](integrated-scene-acceptance-20261111/run.log), [before Escape](integrated-scene-acceptance-20261111/transforms.png), [after Escape](integrated-scene-acceptance-20261111/escape.png). Focused run exits 1 with explicit PRODUCT BLOCKER assertion. Source inspection is consistent: cancelGroupKey handles groupDrag; planeDrag release calls finishPlaneDrag(true), while the general Escape handler clears selection. This observation concerns plane dragging; it does not establish that group gizmo rollback is broken.

## Observed checks before blocker

- Actual imported geometry visible on native bed. Plate 1 title and object name in tree/selection panel visible; canvas object-label overlay behavior was not exercised.
- Actual right-button camera gesture plus wheel input changes camera from [150,-300,360] to approximately [120.139,-257.348,344.999]. 79 renderer calls recorded through a wrapper on the existing exposed scene renderer. Gesture combines orbit/pan and zoom; no independent orbit-only assertion.
- After settling two seconds, zero renderer calls over the next bounded 2000 ms. This is a single browser demand-render observation, not a performance improvement estimate or hardware benchmark.
- Actual mouse cube drag changes native XY from [150,150] to approximately [179.213,147.862], retaining selected instance 26/43. A subsequent genuine background click clears it.
- Explicitly injected selection through public selectObject action, followed by real native setInstanceTransform actions, updates rendered/native move [170,150,10], rotation Z=0.4 rad and scale approximately [1.2,1.1,1]. Screenshots show matching redraw and selection panel. These actions do not certify UI gizmo rotation/scale gestures.

## Retained evidence and limits

Existing [scene report](review-scene-performance-20261111.md), [history report](review-history-selection-20261111.md), [box-selection report](review-box-selection-performance-20261111.md) and [Preview final report](review-preview-worker-final-20261111.md) retain focused lifecycle/race/identity checks. Final classified evidence records stale/destroyed retrievals, accepted mesh identity and group rollback redraw passing; 733 tests / 730 pass / three documented skips. These are focused harness results, not this browser acceptance.

An initial exploratory run logged Escape failure without asserting it immediately and continued into store-driven duplicate/group undo/redo. Retained verbatim in [initial-observations.log](integrated-scene-acceptance-20261111/initial-observations.log). Its Undo extra-selection difference is not classified as a defect: selection was changed after the prior history snapshot. The initial run subsequently timed out clicking hidden #slice-btn; this is a harness locator failure, not a native slicing result. The focused repeat added the concrete Escape assertion and stopped there. No broader acceptance or slicing success is claimed from that initial run.

Pending because acceptance stopped: duplicate-name group history browser validation, box selection instance correctness, model replacement/rapid-update integration, unmount/remount cleanup, live multi-volume paint selector after cache fill, paint/tool redraw, HTML object overlay redraw, and native slicing/export with inside/outside instances. No fault harness, repeat bed matrix or native build was added.

Owned browsers and HTTP servers closed in finally after both runs. Port 5068 is free. Existing private-preview PID 592057 remains alive and untouched. No preview tools, persistent service refresh, public5070, commit/push, README or Taproot changes.

Changed files: this report and supporting `integrated-scene-acceptance-20261111/` harness, logs and four PNG screenshots only.
