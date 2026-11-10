# Automatic HTML plate titles — 2026-11-09

HTML title and Active/Inactive badge now enable automatically when the drawable
canvas APIs are available. Removed the search argument and URL opt-in entirely;
the old htmlPlateTitle query has no control. PlateScene passes status directly.
Capability detection, first/later paint failure fallback, GPU texture replacement
on dimension changes, disposal, state, rename and camera paths are preserved.
Incumbent styling is unchanged; Impeccable craft-floor was read before editing.

Changed files for this batch: `wasm/app/src/plate/htmlPlateTitle.ts`,
`wasm/app/src/plate/PlateScene.ts`,
`wasm/tests/node/html-plate-title.test.mjs`, and this report.

## Verification

```sh
node --test wasm/tests/node/html-plate-title.test.mjs
cd wasm/app
npx tsc --noEmit
ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine npx vite build --outDir ../build/ui-html-plate-default-20261109
```

Seven focused tests pass. Automatic enable is called without optional arguments
while a throwing location getter proves there is no URL read. Tests cover missing
drawable content, context, drawElementImage and requestPaint, both localized badge
states, safe text, geometry, first/later draw failures, cleanup and naming.
TypeScript exits 0; git diff --check passes. Impeccable source detection reports
no findings (regex only; rendered checks remain pending).

Exactly one integrated build succeeded (Vite phase 7.23 seconds plus successful
asset packaging). Existing runtime URL, externalization and chunk warnings remain.
Reused parent dependencies and native inputs read-only, using the prior report's
ORCA_ENGINE_DIR and existing native build symlinks. Temporary node_modules symlink
was removed. No parent files were written.

## Candidate ready for QA

Read-only candidate: `wasm/build/ui-html-plate-default-20261109`.
Full 1,114-file manifest: `wasm/build/tests-html-plate-default/candidate.sha256`;
all entries verified successfully. Manifest SHA-256:
`909c75406676db464fbd887c8f07f24570385eb00c4eeb446f2348f93827aed4`.
Logs in `wasm/build/tests-html-plate-default/`: `tests.txt`, `tsc.txt`,
`build.log`, `detect.txt`, and `manifest-check.txt`.

Reuse this immutable candidate for browser acceptance. No browser QA or Tailscale
refresh performed. README and Taproot await browser acceptance. No dependency,
renderer or WASM changes, commit, push, or deployment.

## Independent browser acceptance — PASS

Test agent read both AGENTS files and the preceding badge report. Reused this
frozen candidate without source edits, rebuilds or test repeats. Manifest hash
above matches and every entry passes (`/tmp/default-independent-manifest.txt`).
First browser call was T3 preview_status; own tab and Vite port 5066 used real
Chrome/157.0.0.0 Linux native drawElementImage, 1280×800, WebGL scene.

Plain `/` visibly renders title, pencil and Active badge. Add Plate produced
Inactive/Active sources with GPU material-map widths 489/466. Framebuffer reads
of the last 137 columns returned 1876/1794 alpha pixels, GL error 0. Actual
setPlates(active=0) at `?htmlPlateTitle=0` retained two native sources and reversed
widths/counts to 466/489 and 1794/1876. Old query has no control.
Projected title click opened Rename plate; submitted `Default QA`. Projected
pencil-area click opened the second rename dialog; Cancel worked. Dark theme
rendered both states and renamed title; GPU widths 613/466 and counts 1876/1794.
Synthetic left/right drags and wheel changed camera from approximately
[870,-300,360] to [852,-277.5,342], with titles still visible.

Temporarily missing drawElementImage disconnected both previous sources and
left zero sources, fallback map widths 437/313. A throwing drawElementImage
also settled to zero sources and widths 437/313; final scene screenshots show
both fallback titles and pencils at correct dimensions. Native API restored;
plain URL rebuild gave widths 590/489, GPU badge counts 1794/1876, GL error 0.
Actual scene.destroy set isDestroyed=true, disconnected both sources, left zero
sources and dispatched two current title-map dispose events.

Rendered screenshot evidence in `/home/david/.t3/userdata/browser-artifacts/`:
- `browser-screenshot-localhost-mw9k430q-d1197f7a.png`: light two states.
- `browser-screenshot-localhost-mw9k4m1a-77050d4e.png`: dark renamed title and badges.
- `browser-screenshot-localhost-mw9k5197-8b014b1f.png`: missing API fallback.
- `browser-screenshot-localhost-mw9k56cx-d43c371e.png`: throwing draw fallback.

Acceptance uses rendered screenshots and actual GPU maps, not backing pixels
alone. Limits: empty scene, synthetic input, one native browser; actual
unsupported engines, hardware devices and performance remain unverified.
Own QA tab/server closed; temporary node_modules symlink removed.

After PASS inspected PID file and actual old PID 3893802 command, replaced only
the owned private preview with this candidate. Persistent PID **4010885**;
pidfile `wasm/build/preview-5064.pid`, log `wasm/build/preview-5064.log`.
Stop: `kill $(cat wasm/build/preview-5064.pid)` after checking process identity.
Plain main test URL: https://server-1.barbel-hops.ts.net:5065/ . Settled HTTPS 200,
COOP same-origin, COEP require-corp. HTML SHA-256
`725c25ebad29805165906744a2f6389bb7b85826555874409f723e24fb4594a6`
matches candidate. Existing private routes retained; no Funnel/public release.
Entry `/assets/index-K2G61g-D.js` SHA-256
`d85345c4e21caa36448b9c75d8e234a7a497572f69981ad5b09680984dc1a460`
also matches HTTPS bytes. Initial probe before persistent startup returned 502;
the settled probe above is 200.

README current note now describes automatic capability behavior and plain URL.
Taproot tools were absent in this client; authenticated HTTP MCP read the project,
then documented REST ops updated both existing title/badge milestones with this
followup evidence and collapsed complete branches recursively without changing
completion statuses. This records private local acceptance only. Documentation
links, process command, candidate paths and diff whitespace checked; no builds,
test repeats, parent writes, commits, push or merge.
