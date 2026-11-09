# Desktop UI polish acceptance — 2026-11-08

**Final r2 accepted and published.** See the final r2 section below for current status, release evidence and rollback. The original partial acceptance below is historical.

## Candidate and provenance

Checkout: `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`.
Candidate: `wasm/build/tests-desktop-ui-polish-20261108/candidate` (read-only).
Evidence directory: [tests-desktop-ui-polish-20261108](../../wasm/build/tests-desktop-ui-polish-20261108/).

Derived `ORCA_ROOT` from `systemctl --user show weborca-tailscale.service`: `wasm/build/native-compatibility-publication-20261108/candidate`. Live service uses frozen `wasm/build/v250-empty-recovery/server.mjs`; its root was not changed. Local verification used that server on loopback port 5188 with alpha enabled, isolated alpha state and an isolated browser profile. Owned servers and browsers were closed.

Build inputs explicitly point engine, STEP, preview, profiles and settings to the live candidate. `VITE_ALPHA_GATE_ENABLED=1`. Every incumbent file outside generated `assets/`, `index.html` and `alpha-bootstrap.js` was copied byte-for-byte from live after packaging: **1125 retained files**, including engine WASM/JS, nativePreview, STEP, profiles, worker libraries and other non-UI assets. [retained.sha256](../../wasm/build/tests-desktop-ui-polish-20261108/retained.sha256), [retained-check.log](../../wasm/build/tests-desktop-ui-polish-20261108/retained-check.log), [candidate.sha256](../../wasm/build/tests-desktop-ui-polish-20261108/candidate.sha256) and [final-integrity.log](../../wasm/build/tests-desktop-ui-polish-20261108/final-integrity.log) bind the artifact. Candidate has 1224 files. No native compilation occurred.

Four incremental frontend builds: initial integrated batch; restore menu visibility after measurement; move the occluded axis triad below the cube; increase clearance after screenshot review found remaining overlap with cube faces. Every rebuild followed a source change; QA retries reused the same candidate. Build logs `build-1.log` through `build-4.log` include locale validation (22 catalogs), TypeScript compilation and Vite packaging. Final build succeeded. Existing warnings concern dynamic URLs, Draco node imports and bundle size.

## Startup and bed

Final warm refresh User Timing (milliseconds from navigation):

| Stage | Time |
|---|---:|
| orca-engine:start | 89.235 |
| checking | 200.910 |
| cached | 222.400 |
| initializing | 235.165 |
| runtime-ready | 247.085 |
| true app readiness, sampled from isEngineReady | 904.930 |

Runtime initialization after `initializing` took 11.920ms; start to runtime-ready took 157.850ms. The largest measured interval was runtime-ready to app-ready, approximately 657.845ms. This includes app preset/configuration startup; these marks do not isolate individual preset operations. Readiness sampling is at 50ms intervals and screenshot activity perturbs timing.

Warm request capture includes module HEAD/GET but **zero engine WASM requests**, hence zero binary transfer for the cached engine. Cache hits still create a fresh worker, memory/native runtime and app preset state on each reload. These local results do not reproduce or explain a particular remote 2–3 second observation and establish no speed improvement. Runtime-ready is not app-ready; neither is instant.

[results.json](../../wasm/build/tests-desktop-ui-polish-20261108/results.json) records marks, requests, resource transfer sizes, 50ms samples, canvas identity and actual bed group visibility/child counts. The sampled canvas identity stays stable and the bed remains visible after mount through readiness and artwork settlement. Filmstrip `warm-00.png`–`warm-17.png` includes a blank initial frame before app mount; no claim of an always-visible bed across full-document navigation. Subsequent frames show the default bed, selected-printer shape/artwork settlement and ready bed without an observed hide/clear frame. This is bounded screenshot/sampling evidence, not a guarantee against sub-frame flashes. Default-to-selected geometry and camera fitting can change.

[edge.json](../../wasm/build/tests-desktop-ui-polish-20261108/edge.json): forced engine module failure produced `isEngineReady=false` and a fetch error; Retry recovered to readiness. No spurious recovery dialog was observed during successful warm reloads. [engine-error.png](../../wasm/build/tests-desktop-ui-polish-20261108/engine-error.png).

## Browser acceptance

Actual `/opt/helium/helium`, headed on DISPLAY=:0, Playwright core from the existing T3 runtime, private temporary profiles. No borrowed session. Preview status reported unavailable; preview open rejected `about:blank` as unsupported protocol. User explicitly authorized Helium. No Firefox claim: browser test copies remove the Firefox invocation even though their incumbent final log line still mentions Firefox.

- Tabs geometrically centered: at 1440/1366/1280px, tab group x/width is 598.25/243.5, 561.25/243.5, 518.25/243.5 respectively: centers exactly 720, 683, 640. Heights tested: 900/768/800. Separate File/Edit/View/Calibration/Help menus remain visible. Pre-fix forced-expanded measurement found 260.219px of menu content with ample clearance; restored collapse threshold to 1200px and hid logo text below 1600px. Final menu right edge 314.219px is before tabs even at 1280px.
- Calibration remains a dropdown and opens the actual Flow Rate dialog. Historical `/calibration` redirects to Prepare in route regression. Top-right Import is removed by source inspection. Model-file import loaded the real Corner bracket STL in the edge check; File/Add model picker activation was not separately replayed.
- Flushing controls precede +/−; updated regression asserts exact order and single-filament absence, then successfully changes matrix/multiplier in native config. Button fits sidebar widths 220/300/360px: right edges 151/231/291px within header widths 219/299/359px. Dialog opens with the section collapsed. Spanish `Purgando volúmenes...` wraps at representative 125% root text. The Spanish enlargement capture is at 360px sidebar, not a full width × language × zoom matrix. Busy/multi-material combinations were not exhaustively replayed.
- Real pointer drag changes camera, release outside is exercised, and imported model instance offset/rotation/scale/mirror remain equal. Synthetic pointercancel/lostcapture were dispatched; actual hardware cancellation is not established. Keyboard Top works. Existing viewcube regression passes Top/Front/Left camera direction, face orientation and View-menu hiding. Stationary physical face click has not been independently accepted (regression uses programmatic click).
- Three native plates: scene boundary colors for active 0/1/2 are `[38bdf8,475569,475569]`, `[475569,38bdf8,475569]`, `[475569,475569,38bdf8]`. Exactly one blue outline including the main plate. Screenshots cover all three.
- Desktop dark/light and 390×844 mobile smoke screenshots reviewed. Mobile document width equals viewport width (390), cube is hidden and navigation/action buttons fit. Spanish/enlarged desktop menus remain separate. This is representative smoke coverage, not every menu or dialog in all themes.

Screenshots: [1280 desktop](../../wasm/build/tests-desktop-ui-polish-20261108/desktop-1280.png), [1440 desktop](../../wasm/build/tests-desktop-ui-polish-20261108/desktop-1440.png), [1366 desktop](../../wasm/build/tests-desktop-ui-polish-20261108/desktop-1366.png), [calibration dialog](../../wasm/build/tests-desktop-ui-polish-20261108/calibration-dialog.png), [flush dialog](../../wasm/build/tests-desktop-ui-polish-20261108/flush-dialog.png), [Spanish enlarged](../../wasm/build/tests-desktop-ui-polish-20261108/spanish-125.png), [model drag](../../wasm/build/tests-desktop-ui-polish-20261108/model-drag.png), [dark](../../wasm/build/tests-desktop-ui-polish-20261108/dark.png), [light](../../wasm/build/tests-desktop-ui-polish-20261108/light.png), [mobile](../../wasm/build/tests-desktop-ui-polish-20261108/mobile.png). Reference attachment was inspected.

## Checks and remaining findings

- PASS final build TypeScript/locales; `git diff --check`; focused node flush 4/4; engine-assets 3/3; scene lifetime fixture (visible pending bed, atomic settlement, stale cancellation, active/inactive plate boundary).
- PASS `bed_assets.mjs`: temporarily linked absent `wasm/build/web/profiles` to retained live profiles, ran unchanged test, removed link and temporary directory. No generated whole engine.
- PASS routes and viewcube regressions on final candidate through headed Helium adapter. Copies in the evidence directory preserve assertions, replace server/browser imports and remove Firefox invocation. They use frozen local candidate and alpha login; no test-triggered build.
- FAIL shell regression: immediately after switching language, expected `Mover`, observed `Move`. Catalogs load lazily; the later Spanish capture renders translated UI after waiting. Full shell suite does not pass and later assertions are unexecuted. Test needs an explicit catalog/render wait before its assertion.
- FAIL flush regression: native matrix/multiplier checks and ordering pass, then timeout at removed `#save-filament-btn-2`. Current UI saves through another flow; remaining save/autocalculation assertions were not executed. No unrelated save workflow rewrite was attempted.
- Axis legibility remains a visual concern: moving the triad fixes cube occlusion, but Y/Z project almost collinearly at the initial camera angle and labels crowd each other. Full XYZ legibility across real camera orientations is **not accepted**. RGB values and quaternion projection are present; reference-level clarity remains unfinished. Mesh bytes were not independently hashed around the gesture; instance transforms were compared.
- Detector ran **once** over changed UI targets. Three warnings are incumbent shell.css 4px colored banner borders (`accent`, `danger`, `muted`), unchanged by this batch. No detector warning points to newly added UI. Visual axis crowding was found by screenshot review despite detector output.
- No live public reload, physical touch, Safari/Firefox, assistive technology or complete menu/translation/zoom matrix acceptance. Alpha local retry initially hit rate limiting after repeated fresh-profile logins; restarting only the owned staging server reset that state. One QA retry hit an exited staging server; subsequent runs used a server with lifecycle bound to the test shell. These harness retries did not rebuild.

## Changed files

This test pass changes `wasm/app/src/shell/shell.css` (menu threshold/logo layout), restores `TopBar.tsx` breakpoint logic to 1200px from the implementation's 1600px, and changes new `wasm/app/src/plate/viewCube.css` (axis clearance). Adds this report. All implementation edits listed in the two implementation notes remain in the shared checkout; no other implementation was replaced. Raw scripts, logs, manifests, screenshots and adapted tests are ignored under the evidence directory.

## Final r2 acceptance — supersedes the historical partial acceptance above

**Published 2026-11-08 22:46:30 UTC** to https://server-1.barbel-hops.ts.net:5070/. Immutable root: `wasm/build/tests-desktop-ui-polish-20261108-r2/candidate`; scripts, logs and screenshots live beside it. No commit, push, PR, native build or engine change.

Manifest SHA256: `f6af2c7fccfb599fc1e1bd90d8eb4da9c81e751263ac550e8f8405dd0e5c7624`. Index SHA256: `347c16758d72855b8adccf15a5199558e53a3c608fb049648457a887995cb23a`. `candidate.sha256` binds every file. All **1125 retained non-UI files** pass `retained.sha256`, including the unchanged native compatibility pair/version `5de92b21195943b3f68ceadc7f73fc89be78b324c2b4127d72f496c7f41cf3ea`. Original read-only candidate preserved.

Axes project the actual quaternion's exterior negative corner and three positive edges, with modest radial label clearance and bounded pairwise separation. RGB tokens and camera gesture handlers are retained. SVG stacking keeps Z visible in Iso. Reviewed dark/light screenshots cover Iso, Top, Front, Left and arbitrary real drag at 1280×800 (`axes-*.png`), plus initial camera at three desktop widths. No face/label clipping observed. Two r2 integrated frontend builds passed TypeScript/22 locales; the second followed the concrete Iso Z occlusion finding. QA retries reused the final immutable artifact.

Shell now waits for the requested accessible language label after lazy catalog loading; its Calibration comment is current. The 700px desktop resize assertion moved to 820px, above the actual 800px mobile breakpoint, retaining the 30% cap keyboard check (246px to 236px). Flush uses slot 2 Settings → Save Preset and the current dialog input. Product Save flow was not rewritten. Final headed Helium shell, flush, routes and viewcube suites pass all assertions. Flush checks slot-2 temperature, preset exclusion of project flush values, native matrix/multiplier retention, save lock/autosave guard and autocalculate/cancel. Adapted harness copies identify Helium accurately; Firefox was not run.

`pointer.json` confirms Add model and File → Import model activated actual file choosers and imported real bracket STLs. Stationary Top click verifies the hit-tested face at the actual point before pointer click and camera-direction assertion. Real drag changes camera with complete serialized model state unchanged. `results.json` refreshes centered tabs/visible menus at 1440/1366/1280, flush control fit and opening while collapsed, exactly one active blue plate of three, mobile fit, and stable sampled mounted canvas/visible bed. Focused flush node 4/4, engine-assets 3/3 and scene lifetime checks pass; test syntax and diff whitespace pass. Prior bed-assets and failure/retry evidence is reused.

Local final warm runtime-ready: 192.225ms; sampled app-ready: 567.040ms. Public warm cached: 246.385ms, initializing: 251.675ms, runtime-ready: 400.240ms, sampled app-ready: 803.795ms. `public/results.json` records zero engine WASM requests/transfer and fresh module authorization traffic. Cache reuse still creates runtime and app/preset state. Sampling is 50ms and screenshot overhead perturbs timing; no instant startup, speed improvement or explanation of every remote 2–3 second observation is claimed. Stable mounted bed/canvas samples do not guarantee sub-frame visibility or remove the pre-mount blank frame.

`release.sh` derives current PID/root, snapshots previous manifests, hashes all existing service overrides/private env inputs/frozen server and normalized process environment, and guards Tailscale routes. Only an ORCA_ROOT override changes. First activation failed its root guard because a hyphen sorted before the old override's `.conf`; automatic rollback restored and publicly verified the previous release (`rollback-verified.txt`). Corrected lexical-last ordering passed. `deploy.log`, `deployed.txt`, `public-all-assets.log` and `public/` retain public access protection, authenticated bytes for all generated assets and native pair/version, headers, authorization separation, logout revocation, unchanged durable invites and actual headed public startup/UI checks. Backend/private alpha/provider configuration/routes remain guarded.

Rollback: `bash wasm/build/tests-desktop-ui-polish-20261108-r2/release.sh --rollback`. It removes only the matching override and verifies previous manifests/root/authenticated public bytes. Owned browser/server sessions are closed after acceptance; live service stays active. README/KNOWLEDGE and Taproot record the milestone. General native parity/speed work remains open. Physical touch, Firefox/Safari, assistive technology, exhaustive orientation/language/zoom combinations remain outside this bounded acceptance.

Tracking receipt: completed node `wrw7OSmSjPqQM1`, project version 115. Recursive completed-branch audit found zero expanded eligible branches (`collapse-audit.json`); completion statuses and open work were preserved. Local harness retries corrected a relative helper import and a nonexistent camera-controls property; repeated isolated logins also required restarting only the owned staging server to reset alpha rate limiting. Those harness retries did not rebuild. Final all-asset public check and candidate manifest verification pass.
