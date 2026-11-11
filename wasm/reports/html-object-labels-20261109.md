# HTML object-name labels — 2026-11-09

Current status: independent native Chrome 157 browser acceptance passed on
`ui-html-object-labels-rename-20261109`. Private preview refresh and final evidence
are recorded below. Earlier blocked candidates are retained as historical evidence.
Other engines, physical camera gestures and hardware performance remain unverified.

Object names automatically use drawable HTML on capable browsers, retaining the
incumbent canvas until successful paint and restoring it after any paint error.
No URL flag. Plate titles/badges and their authorized uncommitted work retained.

Changed in this batch: `wasm/app/src/plate/htmlObjectLabel.ts`,
`wasm/app/src/plate/PlateScene.ts`,
`wasm/tests/node/html-object-label.test.mjs`, and this report.

The safe full name is assigned through textContent. A 240×48 CSS box uses the
incumbent dark background, cyan rounded border, bold white 20px sans text, and
bounded single-line ellipsis. Raster destination is explicitly (8,8) within a
fixed 256×64 canvas. Texture dimensions remain fixed across fallback/publication;
the existing 30×8 sprite, object-instance cache, position updates, visibility and
picking paths remain intact. No default visibility change or label cap.

## Resources and lifetime

HTML sources allocate lazily on first visible update, so default-hidden labels
allocate no drawable DOM sources. Each attempted label requests paint once;
position updates and render frames do not request paint or recreate sources.
After first show a successful source stays connected even if labels are hidden,
allowing subsequent toggles to reuse it. Browser-originated paint events can still
update that source; there is no timer or animation loop in the helper.

Each successfully enhanced instance retains a canvas, span and paint listener,
plus its legacy fallback canvas and existing GPU texture. At 256×64, each RGBA
raster is nominally 64 KiB before browser/GPU overhead; actual backing allocation
and workload are browser dependent and unmeasured. There is no sharing across
instances. Rename, removal and scene destruction detach the source/listener;
paint failure also detaches it and stays on fallback until label recreation.
The isolated helper avoids changing the plate-title lifecycle or introducing a
shared framework.

## Verification

```sh
node --test wasm/tests/node/html-object-label.test.mjs wasm/tests/node/html-plate-title.test.mjs
cd wasm/app
npx tsc --noEmit
ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine npx vite build --outDir ../build/ui-html-object-labels-20261109
```

11 tests passed (four new object-label tests, seven retained title tests).
Coverage: every capability gate, no URL read, full mixed-script/markup text,
CSS bounds/ellipsis, paint-event publication, one request across repeated paints,
first/later failure fallback, request failure and idempotent cleanup.
TypeScript and diff whitespace checks passed. No locales changed by this batch.
Read both AGENTS files, impeccable skill/craft-floor and app DESIGN.md; main's
previous context run and incumbent authority retained. Final impeccable detect
ran once on both UI targets: no findings, regex-only; rendered rules did not run.

One integrated incremental Vite build succeeded (8.57s Vite phase plus asset
packaging). Existing chunk/runtime asset warnings remain in build.log. Parent
node_modules and ORCA_ENGINE_DIR/native build symlink inputs reused read-only;
no parent writes. Temporary dependency symlink removed.

## Immutable candidate for separate browser QA

Candidate: `wasm/build/ui-html-object-labels-20261109` (recursively read-only).
Manifest: `wasm/build/tests-html-object-labels/candidate.sha256`, 1,114 entries,
all verified. Manifest SHA-256:
`821fe6664ca64026c5d803ae0995467acb1439bc9e25f0a2bb994366c2717a45`.
Logs in `wasm/build/tests-html-object-labels/`: tests.txt, tsc.txt, build.log,
detect.txt and manifest-check.txt.

For the separate QA operator, from wasm/app with dependencies available:

```sh
npx vite preview --host 0.0.0.0 --port 5066 --outDir ../build/ui-html-object-labels-20261109
```

No browser QA or server launch performed. Existing accepted default-plate preview
PID 4010885 and https://server-1.barbel-hops.ts.net:5065/ left untouched.
Native Chrome157 rendering, actual GPU content, mixed-script ellipsis appearance,
object rename/remove/destroy/toggle and picking remain for browser acceptance.
Unsupported engines and many-instance resource performance remain unverified.
No README/Taproot update, commit, push, merge or public deployment.

## Review fix and final candidate verification

Verified the review fix in the shared worktree: `htmlObjectLabel.ts` uses
`whiteSpace: 'nowrap'`; the focused fixture includes an embedded newline and
asserts `nowrap`, preserving a bounded single line for multiline object names.
No source edits were made by this verification task.

Final focused run passed all 11 html-object-label and html-plate-title tests;
`npx tsc --noEmit` passed. Exactly one integrated build was run for this source
change, from `wasm/app`:

```sh
ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine npx vite build --outDir ../build/ui-html-object-labels-final-20261109
```

Build exited 0, with Vite compilation in 8.78s and successful asset packaging.
Existing chunk/runtime asset warnings are retained in `final-build.log`.
The new candidate `wasm/build/ui-html-object-labels-final-20261109` is recursively
read-only (no writable files or directories found). Its 1,114-file manifest was
fully verified: `wasm/build/tests-html-object-labels/final-candidate.sha256`.
Manifest SHA-256:
`15b595b151a533ffaf712f72134c024053be44826987a3ae3183f996c79dd740`.

Evidence under `wasm/build/tests-html-object-labels/`: `final-tests.txt`,
`final-tsc.txt`, `final-build.log`, `final-candidate.sha256`, and
`final-manifest-check.txt`. The temporary dependency symlink was removed.
No browser/server refresh, README/Taproot update, or commit was performed.

## Final immutable candidate browser QA (5067)

Fresh final candidate inspected in owned T3 tab, Chrome 157.0.0.0, 1280×800.
Read both AGENTS files; preview_status was the first browser call. Served
`ui-html-object-labels-final-20261109` with Vite preview on unused port 5067.
No source edits, rebuilds, test repeats, or parent writes.

**Acceptance blocked: application rename does not propagate to scene labels.**
Imported four real, watertight, four-triangle STL tetrahedra through the engine.
Calling the actual object-list action
`__objectListStore.getState().renameObject(id, 'QA renamed second')` updated the
visible object-list row, but after settling the plate store still held the old
name, the WebGL sprite still displayed the old name, and its original drawable
source remained connected. Reproduced on a second object untouched by the earlier
direct scene fault probes. `objectListStore.ts` renameObject refreshes its own
tree but does not refresh the plate store. This is a concrete acceptance blocker;
no claim about when it was introduced. Screenshot captures the renamed row beside
the unchanged long-name sprite.

Fresh WebGL screenshot evidence (absolute paths):

- Dark, short/long/mixed-script/newline labels on actual geometry:
  `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9nnag3-3c2af11b.png`
- Light, orthographic, selected geometry and forced legacy fallback:
  `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9nnuf9-2a14daec.png`
- Rename mismatch:
  `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9nocxe-4137cd4a.png`

Executed checks:

- Default hidden: zero object drawable sources (one separate plate source).
  Ctrl+E application shortcut showed labels and requested paint once for the first
  object. Native HTML source became the actual sprite texture image.
- Four names rendered as one line, white bold text, bounded cyan border, CSS
  ellipsis for long/mixed-script/newline names. DOM confirms nowrap and fixed box.
  Plate title, pencil and Active badge remained visible in both theme screenshots.
- Twenty hide/show updates retained all four sources with zero new requestPaint.
  Direct mesh movement moved its label by 12 mm with zero new requests.
- Direct scene-name change detached the previous source and emitted exactly one
  old GPU texture dispose event. This lower-level success does not resolve the
  application rename blocker above.
- Forced missing drawElementImage before recreation retained disconnected legacy
  canvas. Forced drawElementImage exception during paint also retained legacy
  canvas and detached failed source. Prototypes restored after probes.
- Selection through the store displayed the selection outline; synthetic projected
  pointer probe did not establish picking (selectedObjectId remained null).
  Light/dark and perspective/orthographic smoke completed; physical camera gestures
  and full plate badge state-switch regression remain unaccepted.
- Bounded many-object probe sampled 30 actual meshes, 30 sprites and exactly 30
  object sources. 100 updateLabels calls took 1.74 ms CPU, zero requestPaint growth,
  and retained all sources. Imports were still settling: later destruction saw 32
  sprites. Timing excludes paint, GPU work and import; no performance guarantee.
- A delete action sampled after 100 ms had not yet removed its sprite/source;
  asynchronous removal acceptance is inconclusive, not a confirmed separate bug.
- Actual scene.destroy: isDestroyed true, zero drawable sources, all saved sources
  disconnected, and all 32 current object textures emitted dispose events.

Private persistent PID 4010885 on 5064/HTTPS5065 was left untouched because
acceptance failed. No README current-state update or completed Taproot milestone
was added. No release, commit, push or merge. Own QA tab and 5067 server closed;
temporary dependency symlink was already absent at cleanup (unlink returned
ENOENT), so no further dependency cleanup was performed.

## Independent browser QA of original candidate — conditional acceptance

Read both AGENTS files and default-plate QA report. First browser operation was
preview_status. Used own Default-profile Chrome/157.0.0.0 Linux tab, 1280×800,
plain localhost:5066, no experimental flags, frozen candidate above. Manifest
hash matched and all entries verified (`/tmp/object-qa-manifest.txt`). No rebuild.

Injected real four-face tetrahedron geometry and instances through exposed
PlateScene.setObjects/getMesh/getViewerMesh callbacks (simulation of engine
input; app object store remained empty, so its Add model overlay remains in
screenshots). Three default-hidden sprites allocated zero object drawable DOM
sources and zero requestPaint calls. View > Object labels enabled the real scene
and created three native sources. Short, long and Japanese/Arabic/markup names
rendered inside cyan borders; long names visibly ellipsized. Markup remained
text (zero child elements). GPU texture framebuffer reads after explicit render
returned 11,484 nonzero-alpha pixels per native object map, GL error 0. An earlier
probe before a texture had been uploaded returned no texture / GL 1286; repeated
after explicit render successfully. Screenshots confirm final scene content.

Ten hide/show cycles plus updateLabels calls preserved source identity and made
zero additional paint requests. Moving a mesh moved its sprite from [80,150,30]
to [80,110,30] without source replacement. Projected hitTest returned object 901;
viewerTargets contained three meshes and no sprites. Scene-level rename disposed
the old texture once and detached its source; removal did the same. Full app
object-context-menu rename/import/picking gestures were not covered by these
scene API checks. Zoom and orbit camera position changes retained readable labels
at the closer view; labels become small when fitting two entire plates.

Known failure in this original candidate: `New\nSecond line` uses white-space:pre
and the second line is clipped. Main reported the nowrap correction and focused
assertion underway; corrected candidate needs final smoke. This report does not
accept that correction or authorize a preview refresh.

Dark CSS rendering was simulated by setting documentElement.dataset.theme=dark.
Browser prefers-color-scheme and setGeneralPref(theme,dark) alone left the root
light during this session; theme preference routing was not investigated as part
of object-label QA. Both light and simulated dark scene screenshots are recorded.

Bounded 36-instance check: four-face geometry, exactly 36 object sources. After
settling, 30 RAF samples per visibility state called updateLabels and renderer
render: hidden mean/max 0.162/0.270 ms, visible 0.178/0.275 ms. Both had zero new
requestPaint calls and zero captured paint events; all source identities retained.
These measure short synchronous JS submission work, exclude GPU completion and
browser overhead, and support no performance claim. No resource failure observed.

Simulated missing drawElementImage, then removed/recreated labels: both object
maps used legacy canvases with no connected object sources. Native API restored
and labels recreated successfully. Simulated later draw failure by replacing the
native method with a throw and dispatching paint on all three successful sources:
all detached and all maps reverted to legacy; screenshot shows fallback labels.
Restored API afterward. These are fault injections, not tests on another engine.
Plate scene smoke via setPlates renamed first title and selected second plate;
DOM titles read `QA renamed plateInactive` and `SecondActive`, map widths 830/491,
and both rendered with pencils/badges. Actual scene.destroy disconnected all five
current drawable sources, disposed all eight tracked maps, cleared label cache,
and left renderer memory textures=0.

Screenshot evidence (all under `/home/david/.t3/userdata/browser-artifacts/`):
- `browser-screenshot-localhost-mw9njnly-5908195b.png`: initial visible light labels.
- `browser-screenshot-localhost-mw9njxav-6d3aafc7.png`: close light ellipsis and safe markup.
- `browser-screenshot-localhost-mw9nkf52-a771be55.png`: multiline clipping after rename/orbit.
- `browser-screenshot-localhost-mw9nl92k-443b278b.png`: restored native labels, simulated dark.
- `browser-screenshot-localhost-mw9nlfsn-3544a0c8.png`: later failure legacy scene.
- `browser-screenshot-localhost-mw9nloqs-bbca3259.png`: renamed plate and both badge states.

Limits: one native browser, synthetic engine input and fault injection; app-level
object rename workflow, actual unsupported browsers, and hardware performance
remain unverified. Acceptance remains conditional on corrected newline smoke.
Own QA tab/server closed and temporary dependency symlink removed. Existing
5064/5065 previews untouched. No source/README/Taproot/deploy/commit changes.

## Actual application rename synchronization fix — implementation verification

Read both AGENTS files and diagnosing-bugs skill. No CONTEXT.md or ADR files
found in repository search. No UI styling changed; incumbent DESIGN retained.
First browser operation was preview_status; used own Default-profile tab and
5067 Vite server. Existing 5064/5065 previews were left untouched.

Red repro against frozen `ui-html-object-labels-final-20261109`: import a real
watertight tetrahedron STL through `__plateStore.getState().importFile`, show
labels, then await `__objectListStore.getState().renameObject(id, name)`.
The row changed while plate object, mesh and connected drawable retained
`Before.stl`. Ranked hypotheses were missing plate refresh, scene name update,
and label invalidation. One explicit `refreshObjects()` probe updated all three
and disconnected the old source, isolating the first hypothesis.

Root cause: the rename action refreshed its own object tree but omitted the
plate object publication consumed by PlateView/setObjects. Added one existing
`usePlateStore.getState().refreshObjects()` call after engine rename and before
tree refresh/history. No scene or rendering changes in this fix.

New `wasm/tests/node/object-rename-sync.test.mjs` bundles the real rename action,
with engine/store boundaries stubbed, covering direct and call-based engine APIs,
updated names in both stores, and preserved instance data. It failed before the
fix with actual `Before`, expected `After 日本語\nlong`, then passed. This locks
the changed action seam; it does not claim to test WebGL with mocks.

Verification: 12 tests passed via `node --test
wasm/tests/node/object-rename-sync.test.mjs
wasm/tests/node/html-object-label.test.mjs
wasm/tests/node/html-plate-title.test.mjs`; app `tsc --noEmit` and focused diff
whitespace check passed. Logs: `wasm/build/tests-html-object-labels/rename-tests.txt`,
`rename-tsc.txt`, `rename-build.log`, `rename-manifest-check.txt`.
Exactly one incremental integrated Vite build for this change, using the existing
ORCA_ENGINE_DIR input, succeeded (8.78s Vite phase plus packaging).

New recursively read-only candidate:
`wasm/build/ui-html-object-labels-rename-20261109`.
Manifest `wasm/build/tests-html-object-labels/rename-candidate.sha256` fully
verified; manifest SHA-256
`7ecb26d58296a204a7a26e24e260c5e9b64aeacdf41c21fa88e99f60c7993e9b`.

Fresh navigation to rebuilt candidate on 5067: actual engine import and actual
rename action updated list row, plate object, mesh userData, sprite name and
native texture source. Old source disconnected; tracked texture disposed exactly
once. Repeated actual renames covered short and newline/long/Japanese/Arabic/
markup text, retained nowrap and 256×64 raster dimensions. Two real engine
instances retained their IDs and both sprite names followed subsequent renames.
Ten hide/show cycles and twenty explicit updateLabels/render calls produced zero
additional requestPaint calls. Rendered screenshot with row and two renamed
sprites: `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9nu131-ad5fde09.png`.
Plate title, pencil, Active badge and numbered default remained visible.

Actual delete disconnected both saved sources. A subsequent real tetrahedron
import while hidden allocated no object drawable source (only Plate 1Active).
Showing then injecting a drawElementImage throw on paint detached its source and
restored a disconnected 256×64 legacy map. Restored browser API. Actual destroy
left zero drawable sources and disconnected every saved current source.

Picking/camera limits: projected mesh-center probes returned null; a bounded
screen hitTest sweep found object 26/instance 43 with two viewer targets and no
sprites among targets. Engine duplicates overlapped; independent picking of both
instances remains for parent acceptance. Camera API fit and position smoke ran,
but physical camera gestures and plate state switching were not repeated.
An initial screenshot was obscured by the saved-session prompt; dismissed it
before final rendered evidence. Initial visibility reflected persisted user
preferences; lazy allocation was verified explicitly after hiding before import.
A single-triangle import probe was rejected by engine; the valid tetrahedron
retry passed. No claim of unsupported-browser or performance acceptance.

Own tab/server and temporary dependency symlink cleaned up. No README/Taproot,
Tailscale refresh, parent writes, commit, push or deployment performed.

## Independent final acceptance — rename candidate

PASS, 2026-11-09. Both AGENTS files read; preview_status was the first browser
operation. Owned Chrome157 Default-profile tab, 1280×800, candidate served on 5067.
Manifest SHA256 `7ecb26d58296a204a7a26e24e260c5e9b64aeacdf41c21fa88e99f60c7993e9b`
matched; every entry verified (`/tmp/object-rename-final-manifest.txt`). No source
edits, rebuild, or repeated tests. Reused implementation evidence: 12 focused
rename/object/title tests and tsc pass, plus native QA above.

Actual engine import accepted three watertight tetrahedron STL files. Explicitly
hidden before import: only plate drawable source present, zero object sources.
Showing created native connected 256×64 object texture sources. Long, short,
Japanese/Arabic/literal markup/newline names rendered in WebGL as bounded single
lines with visible ellipsis. CSS confirmed nowrap, 240×48 box, hidden overflow.
Theme screenshots use explicit document root light/dark assignment; preference
routing was not retested. Actual context menu Add Primitive > Cube succeeded.

Actual duplicate action made overlapping instances. Actual object-list rename
was repeated (`Rename one`, then `Rename twice`): object row, plate names and both
instance sprite names updated. Both generations of old sources disconnected.
Volume child rows retain their separate volume names, as expected. Twenty
hide/show cycles made zero new requestPaint calls and retained source identities.
Moving the duplicate through setInstanceTransform retained its source and moved
its label. Screen hitTest sweep found all three objects; overlap picked instance
43 consistently with labels hidden or shown (zero changed hits). After separating
the duplicate, the sweep found both 43 and 125. All four targets were meshes;
zero sprites. Fully occluded duplicates have the same nearest-surface limitation
with labels hidden; no label-induced picking regression observed. Sweep is an
API probe, not a physical pointer gesture acceptance claim.

Forced missing drawElementImage on Cube rename detached the old source and left
a disconnected 256×64 legacy map. Restored API, renamed, then forced a paint-time
throw: native source detached and current map became disconnected 256×64 legacy.
API restored. Actual deleteObject disconnected both renamed instance sources and
disposed both maps. Actual scene.destroy disconnected every current source,
disposed all three tracked current object maps (including fallback), and left
zero drawable sources. Added an actual second plate and activated it: both
plate titles, pencils, numbered plates and Active/Inactive badges rendered.

Reused the recorded 36-instance resource evidence above: the intervening fix
only adds plate-store refresh to rename, with no label helper/render lifecycle
changes. No performance gain claim. Limits: one browser, fault-injected API
absence rather than an actual unsupported engine, synthetic action/API probes,
no hardware performance measurement or physical camera gesture coverage.

Rendered WebGL screenshot evidence (under `/home/david/.t3/userdata/browser-artifacts/`):
- `browser-screenshot-localhost-mw9nxhpb-52524c09.png`: dark names and title/badge.
- `browser-screenshot-localhost-mw9nxx7i-51f4af51.png`: light renamed row and labels.
- `browser-screenshot-localhost-mw9ny5e1-4bea6131.png`: closer light, both renamed instances.
- `browser-screenshot-localhost-mw9nye1m-4515f5e2.png`: closer dark, long/mixed ellipsis.
- `browser-screenshot-localhost-mw9nzjp3-2a388a54.png`: actual Cube/fallback and two-plate badge smoke.
These are final scene screenshots, not source-canvas-only evidence.

After acceptance inspected pidfile and PID 4010885 command before replacing the
5064 process. Persistent replacement PID **450690** serves this immutable candidate.
Pidfile `wasm/build/preview-5064.pid`, log `wasm/build/preview-5064.log`.
Stop: `kill $(cat wasm/build/preview-5064.pid)` after checking process identity.
Private URL: https://server-1.barbel-hops.ts.net:5065/ (plain URL, no flags).
Existing Tailscale routes retained; no Funnel/public release. Initial detached
launch exited before serving (transient HTTPS502); setsid replacement verified
HTTPS200, COOP same-origin, COEP require-corp. Served HTML SHA256
`df6d609b890bf250fb9d2da7c41e05e0e93fb39e989cb07af987f3f4a279d7f5`
and entry `/assets/index-MwCreZCz.js` SHA256
`5b163ffe3f3c9e56020984ffbb8ccae59bb1c155d893b7eb1d7e8e1cd9cc4a84`
match candidate files. Own QA tab/server closed, 5067 has no listener, temporary
dependency link absent. README and Taproot local followup updated; no parent
writes, commit, push, merge or shipped-baseline promotion.
