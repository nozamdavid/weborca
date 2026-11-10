# Canvas-first Prepare candidate — 2026-11-10

Current local disposition: panels candidate scoped PASS; see
[bounded followup QA](canvas-first-prepare-panels-20261110-qa.md#bounded-followup-disposition).
The private5065 preview now serves immutable panels manifest
`9c6ed9a5fa7ae1537319aa63de5a45f3dc1cf20fbeefd48940474c7de150552e`.
Historical blockers below retain their original candidate-specific findings.

The earlier sidebar interpretation misunderstood the requested architecture. The
pinned screenshot is authoritative: nearly full-window real plate, top-centred
compact dark toolbar islands, lower-left scene tools, secondary panels on demand.
Reference inspected with view_image:
`/home/david/.t3/userdata/attachments/mcp-launch-9ef354c0b9bc2ecc898f40e8708349e8c2c486dc2a9cb60830c9092aae75da22-89e09d37-7a23-45c3-bb9a-902768186542.png`.
Impeccable context, craft-floor, operate and existing DESIGN.md consulted. The
explicit pinned brief substitutes for concept selection in this implementation
sub-agent. No image composition generated.

## Implementation

- New `src/shell/CanvasPrepare.tsx` and `canvasPrepare.css`: default Prepare shell
  with floating Projects, real history, printer/nozzle/process summary, material,
  Supports, Settings and Slice/output islands. The real PlateView fills the shell.
  Responsive grouping keeps Slice at the top and printer context on a second row.
- `src/App.tsx`: incumbent desktop/mobile header and mobile navigation mount on
  other routes. Prepare mounts the new shell only while active, avoiding duplicate
  file-input ownership with the incumbent top bar on other routes. Projects exposes
  Prepare, Preview, Device, Calibration and Preferences plus real import/save.
- `src/shell/PrepareSidebar.tsx`: optional panel scope mounts only requested
  printer, material, process/quick/full settings, objects or output sections.
  It is not a CSS-hidden full sidebar. Existing selectors, management, native
  validation/pending/reset/expert logic and batch ZIP paths are reused.
- `src/plate/PlateView.tsx`: floating-shell prop excludes its duplicate history
  group; all remaining scene tools, labels and actual renderer remain intact.
- `src/mobile/MobileShell.tsx`: optional import input ID and ZIP acceptance.
  Existing uncommitted functional changes retained.

Panels have Escape/outside dismissal, trigger restoration on explicit close and
Escape, focus entry and Tab wrapping within the panel. Outside canvas interaction
closes the panel without a blocking scrim. Only one shell panel mounts at a time.
Printer nozzle and support fields use SettingInput with actual definitions/actions.
File import and Ctrl/Cmd I/O/S/G/P/E/0 and camera K now have Prepare ownership;
PlateView retains its existing transform/paint/history keyboard handlers. Native
3MF/G-code handlers remain distinct. Scene ResizeObserver remains responsible for
canvas sizing; shell mount also dispatches resize.

## Verification and immutable candidate

Existing quick-settings, modified-settings and plate-batch-output tests: **9 pass**.
`npx tsc --noEmit`: pass. `npm run check:locales`: all 22 pass.
`git diff --check`: pass. One final-target Impeccable detector run: zero findings.
No new synthetic component-count or source-regex tests added. Panel interaction
and route ownership need real browser verification rather than mocked DOM claims.

One integrated build, Vite 8.32s; native assets successfully packaged. Existing
chunk-size and browser-externalization warnings only. Build used:

```sh
cd wasm/app
ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine npx vite build --outDir ../build/ui-canvas-first-prepare-20261110
```

Read-only parent dependencies reused through a temporary node_modules symlink,
removed after packaging. Candidate and evidence frozen read-only:
`wasm/build/ui-canvas-first-prepare-20261110`
`wasm/build/tests-canvas-first-prepare-20261110/`
Manifest SHA256:
`b2ad2f0098a902b1030c62cfe86df4156dfc742b6abec920e466c91b424a6b88`.

## Independent visual acceptance required

This is an unaccepted implementation candidate. Tests do not establish visual or
interaction acceptance. No browser QA, preview refresh, Tailscale changes, commit,
push, PR or parent-owned writes performed. Existing preview PID32500 untouched.
DESIGN.md remains unchanged pending acceptance of the durable composition.

Reviewer checklist against the reference:

- At 1325×1100 and 1280×800, compare island spacing, width, density, canvas
  dominance and lower-left rail. Verify no persistent sidebar/global header.
- Verify real light/dark bed and model, object labels and plate decorations.
  Existing renderer background was preserved; CSS canvas token alone does not
  recolor the WebGL background. Neutral stage matching needs visual judgment.
- Check compact mobile at 320/390px, touch targets, reachable Slice and scene-tool
  overflow. Confirm global mobile styles do not suppress the reused rail.
- Verify Projects navigation/import/save and native keyboard ownership after route
  roundtrips. Verify file chooser from the empty plate and selected objects.
- Verify printer/vendor/device and actual nozzle commits, material slots, support
  enable/type, quick/full validation, pending edits, reset and expert retention.
- Verify panel focus, Escape, outside click, nested preset dialogs, no duplicate
  IDs/popovers, and orbit interaction outside panels. Check restoration when a
  panel switch removes its previous trigger and when nested dialogs close.
- Verify output provenance/readiness, distinct Preview/export/send, batch ZIP and
  cancellation. No physical send/start actions were performed.

Known scope limits: no newly exposed recent-project list; Projects uses the
existing file import/open/save operations. New Projects label uses translation
fallback. Panel surfaces inherit existing theme tokens; the reference's dark
panel treatment and all computed contrast remain subject to visual acceptance.

## Independent visual QA — BLOCKED (frozen candidate)

Inspected the supplied reference with view_image and actual rendered candidate
on isolated port5067/incognito preview. Candidate manifest remains the one above;
no rebuild or refresh. Main reported subsequent source fixes for portal/Escape
ownership and Projects mobile Undo/Redo during this review; those fixes are not
in this candidate and are not accepted by this run.

Reference comparison at CSS1325×1100: the centered 50px dark islands and wide
printer/material summary are close in geometry, and Prepare has no fixed global
header/sidebar. However, acceptance is blocked by the scene composition:

1. Reference has a medium neutral grey stage and large solid dark tilted bed
   extending almost to the bottom/right. Candidate has a near-black stage in
   dark mode, pale stage and transparent-looking grid bed in light mode, with
   a smaller centered bed and large margins. At1280×800 this is stronger.
   Smallest fix: tune the real renderer's background, bed surface and default
   camera framing together; CSS background alone is insufficient. Preserve the
   actual selected printer geometry rather than copying the Prusa branding.
2. Reference has a short lower-left scene rail. Candidate retains a 717px
   desktop tool rail (34px targets), persistent camera-view strip/view cube,
   bottom plate/settings/slice bar and central empty-bed import CTA. These
   compete with the requested sparse stage. Smallest fix: collapse secondary
   tools/camera/plate controls behind the lower-left rail, leaving essential
   scene actions reachable on demand. The top island structure can remain.
3. Printer icon renders as a solid white rounded square. No broken img elements
   or404s appeared in captured network entries; this is a rendered asset/style
   failure, not proven missing download. Replace with a legible printer glyph.
   G-code currently uses a settings gear; a delivery/disclosure glyph is clearer.
4. At390 and320px, islands wrap without document horizontal overflow (320px
   scrollWidth=320). At320 they occupy three rows. Main buttons are about46–50px
   tall, but the actual Tools rail is display:none and bed edges/labels crop.
   Objects remains accessible; it does not replace transform/paint scene tools.
   Smallest fix: expose a touch-sized scene-tools overflow entry and fit the bed
   to available mobile viewport. Do not count hiding the rail as responsive pass.

Screenshots (CSS viewport sizes; preview PNGs may use device scaling):

- [1325 dark](canvas-first-prepare-20261110-qa/desktop-dark-1325.png)
- [1325 light](canvas-first-prepare-20261110-qa/desktop-light-1325.png)
- [1280 light](canvas-first-prepare-20261110-qa/desktop-light-1280.png)
- [390 light](canvas-first-prepare-20261110-qa/mobile-light-390.png)
- [320 light](canvas-first-prepare-20261110-qa/mobile-light-320.png)
- [320 dark, cube/labels](canvas-first-prepare-20261110-qa/mobile-dark-320.png)

Interaction smoke: engine ready=true/error=null; actual native bed assets loaded,
WebGL initialized. Added native30mm Cube via canvas Add Primitive and sliced via
the top Slice action:150 layers,19m20s,10.48g,3.51m; navigated automatically to
real toolpath Preview. Preview exposes Export G-code, Send to Printer and explicit
download-versus-delivery explanation. Back in Prepare, G-code panel exposes
Plate1 Current, export/send and Preview. No physical send/start performed.
Projects successfully navigated Preview, Device and Calibration, returning to
Prepare each time, and opened Preferences. Undo removed cube; Redo restored one
cube after asynchronous restoration (initial click while restoring was disabled).
Objects panel exposes plate scope and cube rows; labels toggle worked.

Settings panel enters focus on Close; Escape restores Projects trigger in the
Projects smoke. Quick and Full settings open; Full exposes Simple/Advanced/Expert
and existing categories. Printer opens actual profile selector and numeric native
nozzle input0.4mm. Supports opens enable/type fields. Filament opens real selector
and slot add/remove controls on mobile. Clicking outside Supports dismisses it and
elementFromPoint returns CANVAS: no invisible full-window scrim at that point.
After route roundtrips, Ctrl+E toggled labels once, K changed perspective to
orthographic once, Ctrl+P opened Preferences, Ctrl+O opened the accepted-format
file chooser. Ctrl+I during restoration did not open one; do not infer regression
from that busy-state attempt.

Limits: not a full functional acceptance. No actual nozzle/material/support edit,
invalid Quick/Full input, expert retention, Tab loop, orbit drag, rename, save/
download, Ctrl+S/G/0, or complete mobile selector lifecycle was verified here.
Portal/Escape and absent mobile history remain known frozen-candidate failures
with source fixes pending rebuilt QA. The preexisting preset-bundle initialization
warning appeared once at startup, then engine initialized and sliced successfully.
Rail suppression and renderer defaults are inherited surfaces exposed by this
rewrite; their origin does not waive visual acceptance. Historical complete and
partial ZIP native evidence remains in simpler-workflow-20261110.md; new batch
exposure smoke is still required. No claim of matching the reference or full
interaction pass is made.

## Visual blocker implementation batch — fixed candidate

Inspected the pinned reference and actual desktop-light-1325/mobile-light-390
captures with view_image. Read Impeccable context, craft-floor, operate and app
DESIGN.md. Changed files in this batch:

- `app/src/plate/PlateScene.ts`: optional canvas-first renderer mode, real light
  WebGL background #9e9e9e (dark #727272), dark opaque foundation using the real
  selected bed outline beneath transparent printer SVG artwork. Suppresses initial
  grid/axes/build-volume clutter locally; subsequent Preferences changes remain
  connected. Uses a diagonal initial bed fit and repeats fitting on viewport
  changes until OrbitControls interaction or explicit camera command. Other
  PlateScene callers and WASM Preview retain their renderer path.
- `app/src/plate/PlateView.tsx`: floating shell structurally omits the long toolbar,
  cube/viewstrip, centered import CTA and persistent plate bar. Short lower-left
  rail owns Add model, real Arrange, Tools and contextual Delete; Objects remains
  the adjacent shell entry. Tools mounts actual existing transform, orientation,
  measure, edit, paint, camera and plate actions in a bounded scrolling panel.
  No duplicate input or duplicate tool IDs mount. Nonfloating composition retained.
- `app/src/shell/CanvasPrepare.tsx`: authored line printer glyph, small output
  chevron, guarded immediate Slice/Cancel/Download G-code action using matching
  nonempty plate output. Output panel retains Preview/export/send/batch access.
  Main's modalOpen guards and Projects Undo/Redo remain present and compile.
- `app/src/shell/canvasPrepare.css`: short touch-size rail, responsive toolbox,
  compact disclosure/output and mobile top grouping.

Verification: TypeScript passed after the completed batch; existing focused
quick-settings/modified-settings/plate-batch-output tests **9/9 passed**; all22
locale catalogs pass; diff whitespace check passes. Impeccable detector returned
zero findings. No new test seam/infrastructure introduced.

Exactly one integrated Vite build (8.36s), including native asset packaging,
completed at `wasm/build/ui-canvas-first-prepare-fixed-20261110`.
Build log and full file manifest are frozen in
`wasm/build/tests-canvas-first-prepare-fixed-20261110/`.
Manifest SHA256: `d0a5a9f32fb7b653490f923763d442f135a7fc179206c697abe899a4d2e65887`.
Both directories are read-only; temporary node_modules link removed.

Parent reference checklist: inspect real solid artwork/outline in both themes;
check bed framing at1325/1280 and full initial/resize fit at320/390; verify orbit
stops automatic fitting; check touch toolbox transforms/painting/measure/camera,
plate settings and batch/cancel/output access; compare mobile two-row grouping;
exercise valid-output immediate download versus stale-result Slice and nested
modal Escape/history. No browser QA or preview refresh performed in this batch.

Remaining constraints: the camera fits the legitimate selected printer geometry
with safe viewport margins; it does not reproduce the reference's deliberately
off-center lower/right framing or its physical Prusa slab model. Additional plate
surfaces reuse the existing material path; the new opaque foundation currently
belongs to the primary bed. Exact visual match and mobile tool-panel behavior
require parent rendered review. No screenshot acceptance claimed. Existing5064/
5065 PID32500, README, Taproot, commits and deployment remain untouched.

## Independent fixed-candidate review — BLOCKED by viewport sizing

Reviewed immutable fixed candidate with manifest SHA256
`d0a5a9f32fb7b653490f923763d442f135a7fc179206c697abe899a4d2e65887`.
Viewed the supplied reference plus old desktop-light-1325 and mobile-light-390
captures using view_image. Used own incognito browser and localhost5067 Vite
preview, retaining the native packaged assets. No source edits or rebuild.

Desktop1325×1100 dark composition is substantially improved: solid dark real
Voron outline on neutral gray, compact dark top islands, legible printer glyph,
short rail, no old toolbar/viewcube/strip/center CTA/bottom bar. Legitimate Voron
geometry and safe margins are acceptable differences from the physical Prusa
reference. This is a partial visual finding, not acceptance.

Material blocker: viewport height does not propagate reliably to the scene.
After1325×1100 ->320×800 resize, actual main canvas CSS rect was319×1100,
with backing buffer638×2200. The rail remained beneath the visible viewport;
the rendered320 capture has Objects but no visible Add model/Arrange/Tools.
Programmatically opening Tools proved its content exists, but does not establish
user reachability. Closing Tools did not restore visible rail access.
On a fresh reload at390×844, main canvas CSS rect was389×600; the gray stage
stopped at y600 and left a244px dark unused region beneath it. Objects remained
anchored near the viewport bottom, separated from the rail. This is a substantial
layout defect in the required fullcanvas composition and resize behavior.
Smallest next investigation: scene container height ownership and ResizeObserver
feedback between canvas sizing and its flex/absolute ancestors. No patch made.

Fresh screenshots (CSS dimensions; PNGs use browser device scaling):

- [1325×1100 dark](canvas-first-prepare-fixed-20261110-qa/desktop-dark-1325.png)
- [320×800 after desktop resize, missing visible rail](canvas-first-prepare-fixed-20261110-qa/resize-dark-320.png)
- [390×844 fresh load, stage ends at600](canvas-first-prepare-fixed-20261110-qa/fresh-dark-390.png)
- [320 Tools content, programmatically opened](canvas-first-prepare-fixed-20261110-qa/tools-dark-320.png)
- [320 light after resize](canvas-first-prepare-fixed-20261110-qa/resize-light-320.png)

Stopped at the material blocker as instructed. No inherited functional pass:
native cube/slice, output provenance, edits/validation, mobile selectors, nested
Escape, history/routes/shortcuts, orbit stability, Tab/focus restoration, additional
plate surfaces and ZIP were not accepted by this run.1280×800 and complete
both-theme coverage remain unverified. The initial Configuration Wizard was
closed normally; native bed subsequently rendered. No send/start performed.

Persistent pidfile wasm/build/preview-5064.pid and live PID32500 were inspected:
identity was Vite preview serving ui-simpler-workflow-quick-final-20261110 on
100.105.38.125:5064 using the parent Vite config. Left untouched; HTTPS5065 was
not refreshed or claimed verified. No README/DESIGN/Taproot acceptance update,
commit, push, PR, public route or Funnel change. QA tab/server5067 closed at end.

## Independent viewport-candidate review — BLOCKED by mobile Tools controls

Inspected App.tsx canvas-prepare-page ownership and the first three rules of
canvasPrepare.css. Viewed the authoritative reference image above with view_image.
No source edits. Existing quick-settings, modified-settings and plate-batch-output
tests passed **9/9**; npx tsc --noEmit, all22 locale checks and git diff --check passed.

Exactly one integrated build produced `wasm/build/ui-canvas-first-prepare-viewport-20261110`.
Vite took9.69s; native packaging completed successfully. Parent dependencies were
read-only inputs through a temporary node_modules symlink; native build symlinks
were retained. Candidate and evidence are frozen read-only. Build log, tests and
full manifest: `wasm/build/tests-canvas-first-prepare-viewport-20261110/`.
Manifest SHA256: `86833234b694347b2fdf26288fcbd2ccfd3bf5a77bfc6f4d7cd328f763169083`.

Actual browser findings, incognito localhost5067, DPR2:

- At1325×1100, workspace, Prepare parent, canvas stage and PlateView all measured
 1325×1100 at0,0. Canvas measured1324×1100, backing2648×2200.
- After resizing directly to320×800 without reload, all four containers measured
 320×800; canvas319×800, backing638×1600. The one-pixel width difference is
 explained by PlateView's computed1px right border. Thus height ownership is
 corrected in this tested transition, but literal full-width canvas equality
 remains unmet. Document scroll dimensions equaled viewport dimensions.
- Add model, Arrange and Tools centers all hit their own buttons with
 elementFromPoint at both sizes. Real pointer click on mobile Tools opened a
 bounded303×390 panel at8,130, scrollHeight392/clientHeight390.
- Concrete blocker: `.canvas-scene-tools .view-buttons` and
 `.canvas-scene-tools #plate-selector-bar` compute display:none. Their children
 `#view-top` and `#plate-settings-btn` have zero-size client rects. Camera views,
 Add Plate and Plate settings are unreachable through this mobile panel.
 `src/mobile/mobile.css:11–12` applies legacy Prepare display:none!important;
 the new Tools camera display:flex rule is insufficient to override it.
 Repro: load candidate, close Configuration Wizard normally, resize1325×1100
 to320×800, pointer-click Tools. Panel ends after painting tools; camera and
 plate actions are absent, including after scrolling.

Desktop composition retains the substantial improvement against the reference:
real solid dark Voron bed on gray, dark top islands, short rail and no sidebar.
Legitimate printer geometry differences are acceptable. This is a partial visual
finding, not final acceptance. Mobile bed is fully visible in the captured resized
view and no old-height/lower-blank region appears.

Screenshots for parent visual inspection:

- [1325 dark](canvas-first-prepare-viewport-20261110-qa/desktop-dark-1325.png)
- [320 dark after resize](canvas-first-prepare-viewport-20261110-qa/resize-dark-320.png)
- [320 Tools blocker](canvas-first-prepare-viewport-20261110-qa/tools-dark-320.png)

Stopped on the concrete blocker without patch or deployment refresh. Fresh loads
at1280/390/320, resize back to desktop, both-theme matrix, orbit stability, remaining
selector/modal/settings/history/routes/shortcuts and native cube/slice/output/batch
acceptance remain unverified by this run. No physical send/start. Historical
native evidence remains historical; this candidate receives no inherited pass.

Inspected preview-5064.pid and actual PID32500 command: still the quick-final
candidate on100.105.38.125:5064. Left running unchanged. Private URL
`https://server-1.barbel-hops.ts.net:5065/` was not refreshed or visually verified.
README, DESIGN and Taproot acceptance updates remain pending PASS. No parent
writes, commit, push, PR, main/public promotion, Funnel or other route changes.
Own QA tab/server5067 closed; temporary node_modules symlink removed.

## Independent final-candidate acceptance — BLOCKED (2026-11-10)

Read both AGENTS files and this entire report, and inspected the authoritative
reference with view_image. No source edits. Exactly one new integrated build:
`wasm/build/ui-canvas-first-prepare-final-20261110`, Vite8.63s, native packaging
successful. Read-only parent dependency/engine inputs reused; temporary dependency
link removed on completion. Candidate and evidence directory frozen read-only.
Full manifest SHA256:
`6360ae4b5728a0809403273c36b7fbce77da25f4299433b04b1fd3a8ed8263d4`.
Logs/manifest: `wasm/build/tests-canvas-first-prepare-final-20261110/`.
Existing quick-settings/modified-settings/plate-batch-output tests **9/9 pass**;
TypeScript, all22 locale catalogs and git diff --check passed.

### Confirmed fixes and further material defects

Own incognito actual browser at localhost5067. At320×800, pointer-click Tools,
scroll its real container, pointer-click Top, Add Plate, then Plate settings all
succeeded. Camera and plate controls have nonzero rects and are no longer hidden.
Add Plate produced an active Plate2; settings exposed actual bed/sequence/vase.

Remaining material mobile panel defect: Filament at320 mounts the desktop native
select, rather than a searchable MobileSelect. Its enabled Edit/Manage actions
are clipped below the content. Manage rect x292,y258.5,w30,h30 extends to322;
panel x8,y120,w304,h168.5. At its center307,273, elementFromPoint returns the
outer SECTION, not the button. Actual pointer click opens no dialog, and the
selector-based browser click times out. This was reproduced with default native
Voron + Generic PLA after a successful slice, not just imported project presets.
Thus mobile preset management is inaccessible; search/Material MobileSelect
pointerdown lifecycle cannot be accepted because that surface does not mount.

Additional mobile overflow: with two plates, Plate settings dialog measured
x143,y509,w280,h172, extending to423 on a320 viewport; bed/sequence/vase controls
extend past the right edge. Reaching its trigger is fixed; the popup itself is
not responsive. These are functional layout defects, not renderer geometry
preferences. Tools can also remain open underneath a shell Supports panel and
its Plate settings popup; opening a top panel does not close the scene toolbox.

### Other checks completed despite the panel findings

- Canvas after1325×1100 ->320×800 ->1280×800 measured exactly viewport width and
 height at0,0, with DPR2 backing2650×2200,640×1600,2560×1600 respectively.
 The earlier1px border is removed. Rail remained visible/reachable in these
 transitions.390×844 fresh navigation completed initialization and session restore
 prompt; transient engine/error banners consume height while present. A complete
 fresh-load four-size matrix is not claimed.
- Desktop dark screenshot has gray stage, compact dark islands, short rail and
 no persistent old bars/sidebar. Additional Plate2 has visible outline, label and
 artwork and is selectable, although its surface lacks the primary opaque fill.
 Top camera persisted through resize, so the desktop two-plate capture is a
 manual-camera view, not evidence of default reference framing.
- Supports checkbox committed; mobile Type selector opened real options and an
 actual pointer click Tree(auto) committed the trigger text with parent retained.
 Filament native select committed Generic PLA. Nozzle input0.6 committed and the
 top summary changed. Quick layer height0.24 showed override/reset affordance;
 invalid-1 was exercised but no definitive pending-state assertion was captured.
 Full settings exposed real categories and Simple/Advanced/Expert. Full validation,
 reset execution and expert retention remain unaccepted.
- Projects navigated Preview, Device, Calibration and returned through actual
 route tabs. Preferences opened; Escape closed it and focus returned to Projects,
 but the Projects panel was already removed when Preferences opened. Therefore
 this does not satisfy the requested nested modal retaining its parent panel.
 Mobile Projects Undo/Redo received pointer clicks; asynchronous geometry/history
 restoration was not conclusively measured and receives no functional pass.
 Ctrl+O after roundtrips opened the accepted-format chooser; Ctrl+P opened
 Preferences. Ctrl+E/K were exercised, without measured duplicate-handler proof.
- Imported native two_cubes_multi.3mf successfully. Its imported Bambu printer
 settings failed native validation requiring G92 E0 in layer_gcode; this fixture
 failure is not attributed to the shell. Reloaded, discarded its backup normally,
 then pointer-used canvas context menu Add Primitive -> Cube with default Voron.
 Top Slice successfully produced actual toolpath Preview:150 layers,19m20s,
 10.48g. Preview exposed separate Export and Send; no physical delivery/start.
- Returned Prepare: main action became Download G-code and actually downloaded
 `Cube_PLA_19m20s.gcode`,787796 bytes. Disclosure showed Plate1 Current with
 export/send/Preview. After adding empty Plate2, disclosure showed Plate2 Empty
 and omitted export/send, while the main action reverted to Slice. This exercises
 matching-output versus empty-plate behavior, not every invalidation route.
- Switched theme through actual Preferences Theme selector: light mobile390 and
 desktop1280 screenshots captured. No complete both-theme four-size acceptance.

### Screenshots and remaining gates

All paths relative to this report:

- [320 Tools/Plate settings](canvas-first-prepare-final-20261110-qa/tools-plate-settings-320.png)
- [320 clipped Filament actions](canvas-first-prepare-final-20261110-qa/filament-clipped-320.png)
- [1325 dark two plates/manual Top camera](canvas-first-prepare-final-20261110-qa/two-plates-top-camera-1325.png)
- [390 native Cube toolpath Preview](canvas-first-prepare-final-20261110-qa/native-cube-preview-390.png)
- [390 light](canvas-first-prepare-final-20261110-qa/light-390.png)
- [1280 light](canvas-first-prepare-final-20261110-qa/light-1280.png)

Unaccepted gates: mobile searchable Material selection and nested preset lifecycle,
full quick/full validation/pending/reset/expert retention, selected-object transform/
paint/measure popup interactions, outside-panel orbit drag and camera preservation
measurement, full keyboard ownership matrix, conclusive mobile history, fresh-load
matrix, and changed-shell batch scope/completed/partial ZIP exposure. The9 focused
tests exercise unchanged native batch logic; historical batch evidence in
simpler-workflow-20261110.md is historical and does not waive these shell gates.
No inherited overall acceptance. No crash occurred; remaining gaps are explicitly
open, not passed. This run completed additional independent checks after finding
the panel defects, but did not finish every requested acceptance workflow.

PID file and live PID32500 command inspected: still quick-final Vite preview on
100.105.38.125:5064. Left untouched. Private
`https://server-1.barbel-hops.ts.net:5065/` was not refreshed or claimed verified.
No README/DESIGN/Taproot PASS updates, commit, push, PR, parent writes, public
routes or Funnel changes. Own QA server5067/tab closed; temporary dependency link
removed. Candidate retained for reproducible follow-up; do not rebuild without
changed source/build inputs. Verdict: BLOCKED; private promotion forbidden.
