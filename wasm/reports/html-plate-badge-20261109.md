# HTML plate active badge experiment

Current acceptance: independent final PASS on Chrome 157 for frozen
`ui-html-plate-badge-gpu-fixed-20261109`. Approved private testing preview refreshed
on 5064/HTTPS5065; this is not a shipped deployment. Earlier failed candidates
are recorded below.
The existing `?htmlPlateTitle=1` bridge now adds a CSS outlined Active/Inactive
badge from `plate.index === activePlateIndex`. Existing Active translations are
reused; Inactive is added to English and Spanish (other catalogs use English
fallback). This describes plate selection, with no slicing or print-readiness claim.

The title and badge use textContent. The badge inherits the incumbent state color,
uses a smaller font, and has measured width plus border/padding clearance. The
incumbent pencil remains drawn from the original canvas. Successful paint expands
the mesh width and shifts its center to retain its left edge and rename hit area.
Missing capabilities retain original dimensions; throwing title/badge paint
restores original texture and mesh width. Height, camera code, naming/truncation,
theme path and per-plate rebuild/disposal remain on the existing path. Chrome 157
viewport-origin opacity-zero source placement is preserved.

Changed files: `wasm/app/src/plate/htmlPlateTitle.ts`,
`wasm/app/src/plate/PlateScene.ts`, `wasm/app/src/locales/en.json`,
`wasm/app/src/locales/es.json`, `wasm/tests/node/html-plate-title.test.mjs`,
and this report. Existing parent edits retained.

## Checks

Commands from repository root unless stated otherwise:

```sh
node --test wasm/tests/node/html-plate-title.test.mjs
cd wasm/app
npm run check:locales
npx tsc --noEmit
```

Six tests pass: opt-in/capability gates, both passed active states with localized
HTML-like text safely inserted, badge bounds, paint publication, badge-draw
failure fallback, first/later draw failure, disposal and existing naming.
The two added checks target clipping/state and failure risks introduced by the
additional drawable. All 22 locale catalogs pass; TypeScript exits 0.
`git diff --check` passes.

Final UI source detector command:

```sh
/home/david/.agents/skills/impeccable/scripts/impeccable detect wasm/app/src/plate/htmlPlateTitle.ts wasm/app/src/plate/PlateScene.ts
```

No source findings. Regex-only detection does not establish rendered contrast,
geometry or interaction acceptance. Context was already loaded by main; skill,
craft-floor and incumbent DESIGN.md were read for this refinement.

## Immutable build for independent QA

One integrated incremental build succeeded (6.85 seconds Vite compilation plus
successful native asset packaging):

```sh
cd wasm/app
ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine npx vite build --outDir ../build/ui-html-plate-badge-candidate-20261109
```

Candidate: `wasm/build/ui-html-plate-badge-candidate-20261109`, made read-only.
Full file manifest: `wasm/build/tests-html-plate-badge/candidate.sha256`.
Manifest SHA-256:
`4ac35d108cb8db0c4964bc95837cadebd38e4440a5662579397db42d2f60aa8c`.
Logs: `wasm/build/tests-html-plate-badge/{tests.txt,locales.txt,detect.txt,build.log}`.
Build retained runtime URL, browser externalization and large-chunk warnings.

Native inputs reused read-only from the prior report's ORCA_ENGINE_DIR and
existing local native build symlinks. A temporary dependency symlink to the
parent's node_modules was removed after verification. Parent checkout untouched.
No browser QA, server refresh, README/Taproot update, commit, push or deployment.
Independent QA should reuse this candidate for native badge pixels, both states,
themes, title rename/pencil, camera controls, multi-plate, fallback and teardown.

## Review fix verification and corrected immutable candidate

Main corrected the badge draw destination to `fallback.width + 16,
(canvas.height - 48) / 2`. The existing badge test now asserts the second draw
destination `[256, 21, { preserveElementGeometry: true }]`. Main reported that
assertion red before the fix and all six tests green afterward; this test agent
independently reran the corrected source: six pass, zero fail. `npx tsc --noEmit`
also exited 0. Logs: `wasm/build/tests-html-plate-badge/fixed-tests.txt` and
`fixed-tsc.txt`. The pre-fix red result is main's supplied evidence, not a rerun
by this agent; no source edits were made during verification.

Exactly one corrected integrated build completed successfully (Vite 10.15 seconds
plus successful native asset packaging), using the prior command with its new
output directory:

```sh
cd wasm/app
ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine npx vite build --outDir ../build/ui-html-plate-badge-fixed-20261109
```

Corrected candidate: `wasm/build/ui-html-plate-badge-fixed-20261109`.
All files and directories were made read-only. The 1,114-file manifest is
`wasm/build/tests-html-plate-badge/fixed-candidate.sha256`; all entries verified
successfully (`fixed-manifest-check.txt`). Manifest SHA-256:
`125ea01293f7ffbb66a8fadf7e75e3a122d3f913b13d476a1544b7f6cb95a55b`.
Build log: `wasm/build/tests-html-plate-badge/fixed-build.log`. Existing runtime
URL, browser externalization, mixed import and large-chunk warnings remain.
The temporary dependency symlink was removed after verification. Parallel browser
QA uses the original candidate; this corrected candidate has not had browser QA.
No deployment or Tailscale refresh was performed.

## Independent browser QA — original badge candidate, 2026-11-09

**Acceptance: FAIL; corrected candidate requires fresh verification.** Tested the
frozen `ui-html-plate-badge-candidate-20261109` without rebuilding or editing source.
Own Vite preview used port 5066 through the parent's existing binary; temporary
local dependency symlink was used for config resolution. Existing 5064/5065
servers were left untouched. T3 preview_status was the first browser call; browser
work used only T3 preview. Chrome/157.0.0.0 on Linux, viewport 1280×800. Native
`drawElementImage` and `requestPaint` were functions, with connected drawable
sources; no native-support mocks were used for the pixel checks.

### Blocking reproduction and pixels

Open `http://localhost:5066/?htmlPlateTitle=1`, close Configuration Wizard.
Title and pencil appear, but the intended Active badge region is empty. Add Plate:
Plate 1 source says Inactive and Plate 2 source says Active, but both intended badge
regions remain empty. After paint settled, source bitmap alpha counts were:

- Plate 1 Active: badge x=329..457, y=0..89: **0** nontransparent pixels.
- Plate 1 Inactive: badge x=329..480, y=0..89: **0**.
- Plate 2 Active: badge x=329..457, y=0..89: **0**.

The title-side regions contain 5253, 5532 and 5425 pixels respectively (the
badge contaminates that area, so these counts are not title-only correctness
assertions). Both drawable child bounding rects resolve to x=0,y=0 despite the
badge's CSS left/top. Together with the zero expected-region counts, this agrees
with the review finding that drawElementImage badge coordinates (0,0) overlap the
title. Visual placement acceptance fails in both dark and light themes. No patch
was injected to conceal the failure. Main reported an explicit-coordinate fix in
progress during this run; this section describes only the original candidate.

### Additional executed checks

- Projected title click at (829,298) opened Rename plate. Entered
  `QA long plate title ABCDEFGHIJKLMNOPQRSTUVWXYZ 123456789` and clicked OK.
  Drawable title became `QA long plate title ABCDEFGHIJKLMNOPQR...`; screenshot
  shows existing truncation and pencil. Badge region x=1531..1659 still had 0
  pixels. Pencil click at (1241,434) opened Rename plate; cancelled.
- Two plates produced Inactive/Active source labels. State labels change in DOM;
  actual status pixels fail, so state rendering is not accepted. Explicit switch
  back to plate 1 remains for corrected-candidate verification.
- Saved references to both sources before rename; after rebuild both were
  disconnected and exactly two replacements existed.
- **Simulated missing API:** temporarily set prototype drawElementImage to
  undefined, called scene.rebuildPlates, then restored it. Zero drawable sources
  remained and both previous sources disconnected. This establishes the forced
  gate, not an actual unsupported-engine result. Fallback screenshot/pixel
  acceptance should be repeated on the corrected candidate.
- `?htmlPlateTitle=0` plus scene.rebuildPlates left zero drawable sources.
- Called actual exposed `__plateScene.destroy()`: isDestroyed=true, zero drawable
  sources, both saved sources disconnected. Reload recreated the scene.
- Light preference was set through persisted display.theme and reload; confirmed
  root data-theme=light. Dark was the original actual app theme.
- Synthetic left/right pointer gestures (10 moves each) and canvas wheel -450
  changed camera position from [150,-300,360] to approximately
  [54.817,-147.915,335.607]. Title remains visible after orbit/pan/zoom;
  badge remains absent. Physical-device interaction is outside this run.

### Screenshot evidence

All paths are under `/home/david/.t3/userdata/browser-artifacts/`:

- Dark initial: `browser-screenshot-localhost-mw9j0npt-acf00d3f.png`
- Dark two plates: `browser-screenshot-localhost-mw9j0u4x-0698d7a9.png`
- Dark long renamed title: `browser-screenshot-localhost-mw9j1agr-105f2b8e.png`
- Light initial: `browser-screenshot-localhost-mw9j24pg-ae1e60fe.png`
- Light camera gesture result: `browser-screenshot-localhost-mw9j2hht-d3a908b7.png`

### Short frame-cost sample and limits

Same empty one-plate light scene, original candidate, no imported geometry.
Wrapped requestAnimationFrame scheduling temporarily in page memory, timed callback
execution using performance.now, summed callbacks at the same timestamp, sampled
2.5 seconds, discarded first ten timestamps and restored the original function.
Opt-in first: n=125, mean/median/p95 **0.3555/0.3500/0.4900 ms**.
Opt-out second (query changed with history.replaceState and plates rebuilt, same
scene/camera): n=141, **0.3036/0.3000/0.3800 ms**.
These are instrumented aggregate RAF JavaScript durations, not complete frame,
GPU, raster/compositor or title-update cost. Short sequential samples, automation
and empty scene limit comparison. **No improvement claim.** Corrected candidate
needs its own acceptance and cannot inherit original pixel results.

## Corrected candidate browser verification — 2026-11-09

**Acceptance: FAIL; persistent private test server was not refreshed.** No build
or source edits. Read both workspace AGENTS files. First browser tool was T3
preview_status; owned tab used isolated port 5066, parent Vite binary and temporary
dependency symlink. Manifest SHA-256 matched
`125ea01293f7ffbb66a8fadf7e75e3a122d3f913b13d476a1544b7f6cb95a55b`;
all 1,114 manifest entries passed sha256sum verification.

Chrome/157.0.0.0 Linux, 1280×800, real native drawElementImage/requestPaint.
The explicit-coordinate correction succeeds in the drawable canvas bitmap:

- Active: title region x=0..239 contains 4,241 alpha pixels; badge contains 1,794,
  with occupied bounds x=329..457, y=21..68.
- After Add Plate, Plate 1 Inactive has 2,176 badge alpha pixels, bounds
  x=329..480, y=21..68; Plate 2 Active has 1,794. Title-side total counts
  including pencil were 5,526 and 5,698 respectively.
- Actual title mesh maps reference these drawable canvases, widths 489/466,
  texture version 2, geometry widths 122.25/116.5.
- Nevertheless screenshots show title and pencil followed by empty space for
  both plates. Light and dark both reproduce. Calling the actual renderer's
  render(scene,camera) after paint did not reveal the badge; document.hidden=false.
  This is a rendered texture acceptance failure despite successful source pixels.
  No rendering patch or substitute texture was injected. Root cause remains open.
- Calling actual setPlates with existing plates and active index 0 switched sources
  from Inactive/Active to Active/Inactive. Visible badge state cannot be accepted.
- Forced missing drawElementImage followed by actual rebuildPlates produced zero
  drawable sources, disconnected old sources, and original width 313. Restored
  prototype immediately. This is a simulated capability gate, not another engine.
- Default query without opt-in plus rebuild produced zero drawable sources.
- Actual scene.destroy returned isDestroyed=true, zero sources, all saved sources
  disconnected.

Screenshots under `/home/david/.t3/userdata/browser-artifacts/`:

- Light one plate: `browser-screenshot-localhost-mw9j4e9j-d84fd386.png`
- Light two plates: `browser-screenshot-localhost-mw9j4p9b-d940bdcf.png`
- Dark after explicit render (restore prompt): `browser-screenshot-localhost-mw9j5g2x-a91c1fa0.png`
- Dark prompt dismissed: `browser-screenshot-localhost-mw9j5s1u-d45b5eaa.png`

Stopped acceptance expansion at this concrete blocker. Long-title rename/pencil,
camera gestures and final frame-cost comparison were not repeated on this
candidate; original failed-build evidence above remains failure-only evidence.
No performance claim. Own QA tab/server closed and dependency symlink removed.
Existing private 5064/HTTPS5065 serving was left untouched as acceptance failed.

## GPU allocation diagnosis and minimal fix — 2026-11-09

Root cause: the initial fallback CanvasTexture had already allocated GPU storage
at width 313 before HTML paint replaced its image with width 466/489. Setting
image and needsUpdate did not reallocate that storage. The badge was outside the
uploaded texture. The installed Three WebGLTextures implementation uses immutable
texStorage2D followed by texSubImage2D. This is independent of drawable raster
support: a fresh raw WebGL texture uploaded directly from the same drawable
canvas contained all 1,794 Active badge alpha pixels.

Browser-memory isolation used native Chrome 157 on own preview 5066 and an owned
T3 tab. No source changes preceded the probes. Ranked predictions were stale GPU
dimensions (new texture fixes), drawable snapshot mismatch (regular 2D copy fixes),
separate drawable draws (fresh upload also fails), and mipmap/paint scheduling
(filter/delay changes result). Fresh upload falsified the separate-draw theory.
Attaching the original Three texture to a temporary framebuffer and reading the
requested 466x90 returned zero badge pixels and GL INVALID_VALUE (1281). Cloning
the texture shared its source and still gave zero badge pixels. Constructing a
new CanvasTexture from the unchanged drawable returned 1,794 badge pixels, GL
error 0, and revealed Active in the actual rendered scene. Temporary framebuffer
probes restored the default framebuffer and deleted their resources. All probes
were in page memory and disappeared on reload.

Implementation only changes PlateScene's title texture publication: replace the
CanvasTexture when image dimensions differ, move the drawable cleanup listener
to the replacement, and dispose the old GPU allocation. Same-size paints retain
the texture. This also handles shrinking back to legacy dimensions on errors.
No staging copy, renderer migration, dependency or WASM change was needed.

Final immutable candidate: `wasm/build/ui-html-plate-badge-gpu-fixed-20261109`.
Exactly one integrated build (Vite 9.15 seconds, asset packaging successful),
using the preceding ORCA_ENGINE_DIR command with this output directory. All
candidate files/directories made read-only. Manifest:
`wasm/build/tests-html-plate-badge/gpu-fixed-candidate.sha256`; manifest SHA-256
`c9912ca53c71bb03f73edec48a55db6fb5deb819d0229402ae4626836e12a733`.
Build log: `wasm/build/tests-html-plate-badge/gpu-fixed-build.log`.

Final build checks, with no injected rendering fix:

- Dark final scene shows both Inactive and Active. Actual material-map GPU
  framebuffer readback: 2,176 and 1,794 badge alpha pixels, GL error 0, widths
  489 and 466. Actual setPlates(active=0) reverses labels with the same counts.
- Light final scene also shows both outlined badges. Incumbent orange color and
  inactive opacity are preserved; this does not establish contrast certification.
- Projected title click opens Rename plate. Submitted long name
  `QA long plate title ABCDEFGHIJKLMNOPQRSTUVWXYZ 123456789`; native HTML title
  truncates to `QA long plate title ABCDEFGHIJKLMNOPQR...`. Its badge GPU count
  is 2,176 at width 1691. Badge begins after title/pencil plus 16px clearance.
  Projected pencil click opens Rename plate again; cancelled successfully.
- Synthetic left/right pointer gestures plus wheel change camera position from
  approximately [870,-300,360] to [714.67,-274.21,344.19]; rendered title/badge
  remain present. This is automation evidence, not physical-device acceptance.
- Forced throwing drawElementImage after successful paint disconnects both
  sources, restores both map widths to 313 and removes drawable sources.
  Simulated missing API and query opt-out each rebuild with zero sources.
- Restored APIs/opt-in recreate two sources. Actual scene.destroy marks destroyed,
  disconnects both sources, leaves zero drawable canvases and emits disposal on
  both current title maps. This exercises the transferred cleanup listener.

Screenshots in `/home/david/.t3/userdata/browser-artifacts/`:
`browser-screenshot-localhost-mw9jap0e-4befecfa.png` (dark two states),
`browser-screenshot-localhost-mw9jbkc0-f2823e93.png` (long title/camera gestures),
`browser-screenshot-localhost-mw9jby2f-6c8c3daf.png` (light two states).

Six existing focused tests pass (`node --test wasm/tests/node/html-plate-title.test.mjs`)
and `cd wasm/app && npx tsc --noEmit` exits 0. No locale source changed.
No new Node assertion: that file mocks canvas and cannot catch GPU allocation;
the browser framebuffer/readback and final-scene screenshots are the regression
seam. Detector reports no regex findings; git diff --check passes. Existing
runtime/large chunk build warnings remain. No performance claim.

Own preview server/tab and temporary dependency symlink closed/removed after QA.
5064/5065 untouched. No README/Taproot update, commit, push or parent writes.

## Independent final acceptance and private preview — 2026-11-09

**PASS.** Independent test agent read both AGENTS files and reused the frozen GPU
fixed candidate without source edits or rebuilds. Manifest SHA-256 matched
`c9912ca53c71bb03f73edec48a55db6fb5deb819d0229402ae4626836e12a733`;
all manifest entries passed (`/tmp/badge-independent-manifest.txt`). First browser
call was preview_status; own T3 tab and Vite port 5066, Chrome 157 Linux 1280×800.
Native drawElementImage was a function; no rendering replacement was injected.

Actual scene screenshots show separate title, pencil and outlined badge in dark
and light. Actual material-map framebuffer reads returned Active 1,794 alpha
pixels in its final 137 columns, Inactive 1,876 in its final 137 columns (this
narrow region excludes part of the wider Inactive badge), GL error 0. Widths were
466/489; actual setPlates(active=0) reversed them to 466/489 in plate order after
initial 489/466. Title mesh click opened Rename plate; submitted long title
`QA long plate title ABCDEFGHIJKLMNOPQRSTUVWXYZ 123456789`. It retained incumbent
truncation; GPU width 1668 and Active count 1,794, GL error 0. Projected pencil-area
click opened Rename plate again and Cancel closed it. Synthetic left/right
pointer drags plus wheel changed camera [870,-300,360] to approximately
[795.80,-207.25,285.80]. Long title extends outside this viewport after zoom;
this run does not claim viewport containment for that existing layout.

Temporarily missing drawElementImage plus actual rebuild disconnected both old
sources, left zero canvas[content] sources and legacy map widths 313/313. API
restored immediately. Query opt-out plus rebuild also left zero sources. Restored
opt-in recreated sources. Actual destroy returned isDestroyed=true, disconnected
both sources, zero remaining sources, and two dispose events on the two current
replacement title maps. No backing-canvas-only acceptance was used.

Screenshots under `/home/david/.t3/userdata/browser-artifacts/`:
- `browser-screenshot-localhost-mw9jerjz-29d48d0e.png`: dark two states.
- `browser-screenshot-localhost-mw9jflvg-b1608d5e.png`: long title/camera result.
- `browser-screenshot-localhost-mw9jfutk-52e8ce0f.png`: light two states.

Limits: synthetic input, empty scene, one native browser; actual unsupported
engine, physical devices, contrast certification and performance unverified.
Previous six tests/tsc and developer native QA are supporting evidence above;
this run did not rerun builds or tests. Own tab/server closed and temporary
node_modules symlink removed.

After PASS, inspected recorded PID 3469318 and its old title-candidate command,
stopped it, and relaunched persistent Vite with the existing parent config against
this accepted immutable badge candidate. Initial HTTPS probes during startup
returned 502; settled endpoint returned HTTPS 200 with COOP same-origin and COEP
require-corp. Existing Tailscale tailnet-only HTTPS5065 route retained unchanged.
URL: https://server-1.barbel-hops.ts.net:5065/?htmlPlateTitle=1 .
HTML SHA-256 `9724a4017266a33b508110e5659d9ca6715011f5f6b56ca47b82603e504cf5dd`
and entry `/assets/index-D1MlQQNQ.js` SHA-256
`327903411f75389a00455899e9804b7f7605764763f3b5606e784534ccb88dac`
match candidate files. Process PID **3893802**, PID file `wasm/build/preview-5064.pid`,
log `wasm/build/preview-5064.log`. Stop from repo root:
`kill $(cat wasm/build/preview-5064.pid)` after checking the process identity.
No other routes, Funnel, public publication, commit, push or merge.

README experiment note updated. Taproot MCP tools were unavailable in this client;
authenticated HTTP MCP added completed badge followup `LJ71g1WP0KF89s` beside
`Rk4M4xYoKroJeq` under optional rendering. Evidence and manifest hash recorded in
the same creation. Complete branches recursively inspected and collapsed through
REST fallback preserving statuses; optional rendering remains open. This records
local prototype acceptance and private testing, not shipped-baseline promotion.
