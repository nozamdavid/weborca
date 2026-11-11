# Shift rectangle selection candidate — 2026-11-10

Current verdict: **scoped PASS** for the guarded candidate's busy gates,
captured rectangle selection, instrumented Escape and cleanup. This is not
whole-browser or physical-device certification. Final bounded QA and private
service receipt are below; earlier candidate failures remain as historical evidence.

Implemented on the shared `prototype/html-in-canvas-plate-title` worktree, based
on 6773b526d0. Native sources were read only. No acceptance, publication,
README/Taproot update, commit, or server replacement performed.

## Native evidence and chosen behavior

`GLCanvas3D::on_mouse` starts Shift+left rectangle selection before navigation,
excluding paint/cut tools; Alt controls native volume mode.
`GLSelectionRectangle` normalizes corners and draws an Orca-colored dashed line.
The actual membership path is `GLCanvas3D::_rectangular_selection_picking_pass`,
which renders volumes into a rectangle camera and decodes covered pixels;
`GLSelectionRectangle::contains` is not the membership path used there.
`_update_selection_from_hover` replaces selection without Control, adds with
Control. Although a Deselect state exists, the inspected start condition requires
Shift and therefore always starts Select. No subtract modifier added here.

Web Shift+primary drag adds whole object instances, preserving existing primary
and extras and ignoring duplicates. Shift-click and Ctrl/Cmd-click retain their
toggle behavior. Part meshes map to their owning instance; separate instances of
the same object remain separate selections. Rectangle results clear volume focus
to whole-instance mode, while ordinary click volume selection is retained.
Only references assigned to the active plate are added.

Membership clips actual triangles against the normalized rectangle camera
frustum, including near/far planes; it does not require an object's center or
bounding box to fit. Both cameras use client CSS coordinates and actual canvas
dimensions, independent of backing-store DPR. A camera-frustum sphere rejection
precedes triangle clipping. This geometric method includes occluded triangles;
it does not reproduce native depth-tested pixel picking or pixel-size thresholds.
Cost is linear in candidate triangle count at release, with no per-frame scan.

Capture-phase pointer-down consumes the Shift gesture before OrbitControls or
body drag, including starts over models. The overlay appears after the existing
5 CSS-pixel threshold. Capture release/cancel/loss, Escape and destroy remove it
and restore the previous orbit enabled state. Canceled pointer-up cannot select.
Paint/erase, measure, cut, explode, brim, flatten and hovered/dragging gizmo
handles retain their gestures. Touch remains on its incumbent path.

## Files and checks

- `PlateScene.ts`: gesture capture, overlay lifecycle and membership callback.
- `PlateView.tsx`: active-plate eligibility and additive store selection.
- `boxSelection.ts` / `.css`: bounded triangle clipping, union and dashed accent overlay.
- `wasm/tests/node/box-selection.test.mjs`: reverse normalization, viewport offsets,
  DPR independence, perspective/orthographic triangle crossing, near/far/behind
  and offscreen rejection, instance dedupe and additive union.

Focused box tests plus existing HTML object-label and plate-title tests: **15/15
pass**. TypeScript compilation passes. Detector: `[]`; whitespace check passes.
Logs are in `wasm/build/tests-box-selection-20261110/`.
Pointer lifecycle, threshold and camera immobility require integrated acceptance;
no WebGL mock infrastructure was added and those checks are not claimed as tested.
No strings or dependencies added.

One integrated Vite build: `wasm/build/ui-box-selection-20261110`, using read-only
`ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine`.
Vite phase 6.64s; packaging succeeded. Candidate files are read-only. Manifest:
`wasm/build/tests-box-selection-20261110/candidate.sha256`, SHA-256
`fd71fe4927ec956ed7a9cbd372ffa854547eb54e618fe1f5969755601e583e6d`.
Existing private 5064/HTTPS5065 server preserved. Temporary dependency link removed.

## Pending acceptance

Use this candidate without rebuilding. In both themes and perspective/orthographic
views, Shift-drag from blank canvas and from a model in both directions; check
rectangle alignment with viewer offset and DPR 1/2, partial triangle membership,
separate instances, duplicate part hits and active-plate eligibility. Verify
tree, outlines and subsequent group manipulation. Confirm existing selection
survives empty/additive drags and Shift-click toggles below threshold.

Record camera/model transforms before and after gestures. Cancel with Escape,
pointercancel, lost capture and scene destruction; confirm no selection commit,
overlay or disabled navigation remains. Check release outside canvas. Recheck
plain orbit/body drag, Ctrl/Cmd clicks, right pan/wheel, touch navigation/selection,
paint Shift erase, gizmo handles, measurement/cut, plate rename and HTML labels.
Browser, physical-device and performance acceptance remain pending.

## Independent QA of original frozen candidate

Tested on private loopback port 5067 using T3 preview, default sidebar, 1280×800
CSS viewport, DPR 2. Manifest file hash independently matches
`fd71fe4927ec956ed7a9cbd372ffa854547eb54e618fe1f5969755601e583e6d`.
No rebuild or source edits performed. This is partial QA, not acceptance of the
subsequently corrected busy-guard candidate.

Fixture setup used ordinary engine/store import and transform operations: three
four-triangle tetrahedron STL objects, one duplicated instance, separated at
(70,90), (70,180), (135,90), (200,90). Selection was driven through canvas
pointer listeners, never by calling the box callback or selection helper.
T3 lacks modifier-aware pointer down/move/up; rectangle events were synthetic
PointerEvents (mouse, primary, Shift, pointerId 901). This is not physical input.

- Perspective forward box (500,250)→(1100,650) selected primary 26/43 plus
  66/83, 106/123 and 26/125. Reverse preserved exactly that union without duplicates.
- Model transforms remained byte-for-byte equal. Camera matrix maximum component
  change was 1.09e-10; orbit target stayed (150,150,0).
- Orthographic repeated union retained four instances; model transforms unchanged,
  camera delta 1.20e-10. Canvas rect was (360,41,919,759); overlay rect was exactly
  (500,250,600,400), confirming CSS viewport alignment at DPR 2.
- Pointercancel and lostpointercapture removed the box before pointerup and
  restored prior orbit enabled true/false. Later pointerup preserved selection.
- Added second engine plate, moved object 106/123 to (430,90), fetched plate
  assignments, activated plate 0. Broad box selected only 26/43, 26/125, 66/83.
  Other-plate membership was independently confirmed by listPlates.
- Tree primary highlight, selection panel and white aggregate outline are visible
  in [selection evidence](box-selection-20261110-qa/selection-active-plate.png).
  [Orthographic rectangle](box-selection-20261110-qa/orthographic-drag.png) shows
  the rectangle during drag and separated low-poly geometry.

### Method limits and remaining cases

Synthetic pointerdown causes setPointerCapture to reject a non-active pointer.
The box exists before that call, allowing movement/release and membership checks,
but the subsequent Escape listener is not installed. An initial apparent Escape
pass was invalidated by checking before pointerup: the box was still present.
This is a harness limitation, not a confirmed Escape product defect. Actual
capture, outside release, cancellation selection with different membership,
destroy cleanup and browser navigation restoration need trusted pointer input.
Initial screenshots were obscured by the configuration wizard; the retained
screenshots were captured after dismissing it. Synthetic starts at estimated
model coordinates and below-threshold clicks did not establish reliable hit
coverage. Trusted Shift/Control clicks changed selection, but the hit/volume
transition was ambiguous; toggle semantics are not signed off.

Still unverified: partial-triangle-only membership, occluded geometry fixture,
true model-start drag, actual group move, plain orbit/body drag/right pan/wheel,
Meta click, DPR 1, light theme, paint Shift erase, gizmo/measure/cut guards,
touch, native HTML title click/rename and label interaction. Occluded triangle
inclusion is the documented geometric limitation versus native depth picking;
this run does not add empirical occlusion evidence.

### Known original candidate failure: busy guard

With isSlicing=true injected into the app store, synthetic Shift pointerdown at
(500,250), move to (1100,650) still creates a rectangle and disables orbit.
Busy transition injected after pointermove also reaches release cleanup. Since
the selection already contained all eligible instances, that transition does
not prove whether a new selection would commit. Main reports source start and
commit guards now fixed via canMoveObjects; those changes are absent from this
frozen candidate and require a corrected immutable candidate and recheck.

QA private server and owned preview tab closed. No dependency link created;
original 5064/5065 service preserved. No publication, commit, README or Taproot write.

## Busy-transition guard verification — 2026-11-10

Verified the main review fix: `callbacks.canMoveObjects?.() !== false` gates
rectangle start and selection commit in `PlateScene.ts`. Cleanup and orbit
restoration run before the commit guard, so a busy transition during a gesture
suppresses selection while preserving cleanup. No source or test edits made by
this verification task. Actual browser busy-transition acceptance remains with
the original QA owner; no WebGL mock test added.

Existing box-selection, HTML object-label and HTML plate-title focused tests:
**15/15 pass**. `npx --no-install tsc --noEmit` and `git diff --check` pass.
One integrated Vite candidate built and packaged successfully (Vite phase 9.41s):
`wasm/build/ui-box-selection-guarded-20261110`. Used read-only parent dependencies
and `ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine`.
Build emits existing browser externalization and large-chunk warnings.

Candidate files and directories are read-only. SHA-256 manifest:
`wasm/build/tests-box-selection-guarded-20261110/candidate.sha256`; manifest hash:
`0cda7d1a0609f17c5b987872c36585c3ac29af912eeed6bf76d95ac9d92b494c`.
Logs (`tests.log`, `tsc.log`, `build.log`) and `source.sha256` are in the same
verification directory. Four feature source hashes matched before and after
building. The temporary dependency symlink created by this task was removed
only after checking its inode and target. Reuse this immutable candidate for QA.

## Final bounded acceptance of guarded candidate

2026-11-10, scoped PASS. Reused immutable
`ui-box-selection-guarded-20261110`; manifest hash
`0cda7d1a0609f17c5b987872c36585c3ac29af912eeed6bf76d95ac9d92b494c`
and all manifest entries verified. Existing 15 focused tests and tsc pass are
reused, not rerun. No source edits, builds, commits or parent checkout writes.

Owned T3 default-profile tab on loopback 5067, 1280×800 CSS, DPR 2. Three real
watertight tetrahedron STL imports and actual duplicateInstance/store operations
made objects 26/43, 66/83, 106/123 and 26/125, all confirmed on active plate 0.
Positions were (70,90), (135,90), (200,90), (150,150); z=12.5.
Selection callbacks were never bypassed.

### Input method and results

T3 preview_act drag accepted modifiers Shift but trusted marker pointerdown had
shiftKey=false. Trusted clicks likewise did not establish modifier coverage.
Temporary 4px DOM markers therefore forwarded Shift pointerdown to the canvas
using the SAME real active pointerId=1. The original marker pointerdown also
prevented default: without that, HTML dragstart caused native pointercancel,
which correctly cleaned up but could not test commit. No capture API was patched.
hasPointerCapture was true immediately after forwarded down, during trusted
canvas move and at trusted pointerup. Move/up were native captured events.

- Idle (500,250)→(1100,650) selected all four distinct instances. Camera matrix
  maximum delta 8.53e-12 perspective and 9.95e-12 orthographic; model matrices
  were exactly equal before/after. Active tree row, aggregate outline and
  “+3 more selected” rendered. Light root theme was explicitly assigned.
- Each of isSlicing, isModelLoading, isSelectingPreset and history.isRestoring
  true at start produced no rectangle or new selection. These rejected starts
  can still reach incumbent navigation; camera was reset with fitBed afterward.
- Each flag was then set after overlay threshold, before pointerup, using an
  overlay MutationObserver. With initially empty selection and a rectangle
  independently proven to include all four, release left selection empty,
  overlay count zero and orbit restored true. Repeated after camera reset.
- Escape was injected as a KeyboardEvent from that observer AFTER threshold
  and verified capture. Immediate state BEFORE release: no box, no overlay,
  unchanged empty selection, orbit true. Subsequent trusted release was ignored.
  This tests the installed Escape listener; it is instrumented keyboard input.
- Injected pointercancel and actual releasePointerCapture after threshold
  canceled selection. Both, and Escape, preserved saved orbit=false.
- A captured release at (302,650), outside canvas left edge 360, preserved
  existing selection and left zero overlays and orbit true.
- A hitTest sweep found actual model pixels, including 26/43 at (674,464).
  Forwarded Shift drag from that hit selected three intersecting instances,
  without model movement. Later refreshed hit at (682,464) tested two stationary
  forwarded Shift clicks: selection toggled 26/43 on, then off. For those clicks
  pointerup was also forwarded with Shift and the active ID; this is not
  trusted modifier input.
- Store moveSelection([5,0,0]) moved the three selected instances by exactly
  +5mm once; unselected duplicate stayed fixed. Engine-backed offsets and
  scene positions were checked after React refresh. This is API group movement,
  not physical gizmo/body translation acceptance.
- Measure guard sampled on the canvas: forwarded Shift drag made no rectangle.
  Paint/Shift, gizmo axis/dragging and measure exclusions were read in the start
  predicate. Other tool gestures were not exhaustively exercised.
- Ordinary forwarded primary down with trusted move/up changed camera afterward
  and left navigation enabled, no box or selection. Wheel tool call completed;
  no quantified wheel zoom or right-pan acceptance is claimed.
- Actual scene.destroy during a captured rectangle left isDestroyed=true,
  zero overlays, no selection and restored orbit. Reload removed all probe DOM,
  listeners and observers before tab closure.

Retained screenshots:
- Perspective selection:
  /home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwb8uuuw-7f373cbc.png
- Light orthographic selection:
  /home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwb8v43f-42ddbe6e.png

Limits: physical Shift, hardware touch, right-pan, quantified wheel, dark-theme
gesture coverage, DPR 1, physical group manipulation and empirical occlusion
fixture remain unverified. Native additive differences and occluded-triangle
inclusion described above remain intentional limits; no depth-picking parity
claim. Original active-other-plate QA is reused, not repeated. This verdict
covers the corrected busy gates, captured rectangle lifecycle and ordinary
selection; it is not complete certification of every pending original QA case.

### Private service receipt

After scoped PASS, inspected pidfile and command of PID 1018361 before stopping
only that 5064 Vite process. Replacement persistent PID **1134442** serves the
guarded immutable candidate. Existing HTTPS5065 route retained; no Funnel,
5070/public route or other service changes.
URL: https://server-1.barbel-hops.ts.net:5065/
Pidfile: wasm/build/preview-5064.pid; log: wasm/build/preview-5064.log.
Stop: inspect `ps -p $(cat wasm/build/preview-5064.pid) -o args=`, then
`kill $(cat wasm/build/preview-5064.pid)`.

HTTPS200, COOP same-origin, COEP require-corp, Cache-Control no-cache verified.
Served HTML matches candidate SHA256
47386661ffc84b18bccf826ec6c45e31735d3bf7425e6f02e05896145e842d7a.
Served assets/index-ClWy8ZMm.js matches candidate SHA256
642b30241c666dfaa613340b746c27564a25e668033f305d929ca3eb09adc859.

README updated with behavior and explicit limits. Taproot completed milestone
bDtBcwfd8EZbqo verified done, project version 128. Recursive completion check
found all existing branches with fully completed descendants already collapsed;
no completion status changed. Owned QA tab closed and 5067 server stopped.
No temporary dependency link was created. Persistent 5064/5065 service remains.
Documentation whitespace check passed; local report and screenshot links exist.
