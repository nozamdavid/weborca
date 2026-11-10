# HTML-in-Canvas plate title prototype

Chrome 157 native missing-text failure fixed; browser acceptance passes on the
immutable native-fix candidate (manifest SHA-256
`4cd4a2e1c1a1a99025126400988f46df69b64f92948eca767f2c1e24e4103281`).
This is a local verified prototype, with no performance gain claimed or other-browser
verification. Forced API absence passes; an actual unsupported engine and full scene
destroy remain unverified. Earlier failed candidates remain documented below.
Base: `413cb95cb6`. No commit or publication. README and Taproot record this local milestone.

## Implementation and API evidence

- Explicit `?htmlPlateTitle=1` enables HTML rasterization for Prepare titles only.
  Capability gates require reflected `content="drawable"`, `drawElementImage`
  and `requestPaint`. Default and unsupported browsers retain the existing texture.
- Connected offscreen backing canvas owns a drawable text span. Its `paint` handler
  redraws the incumbent pencil/padding, draws HTML text and publishes the canvas to
  the existing CanvasTexture. Until successful paint, the original stays visible.
  Any draw failure restores the original and removes the source/listener.
  Texture disposal removes the source when plates rebuild or the scene closes.
- Existing title truncation, plane dimensions, raycast, rename input, orbit,
  active/inactive colour and multi-plate layout remain on the incumbent path.
  Font, colour and dimensions passed into HTML styles are runtime raster parameters.
- Installed Three is **0.186.1**, inspected through the parent's read-only dependency
  directory. HTMLTexture exists, but its WebGL upload uses `texElementImage2D`;
  current Chrome documents the newer element upload API. CanvasTexture avoids that
  dependency and renderer migration. No dependency or WASM changes.
- Official sources inspected 2026-11-09:
  [Chrome announcement](https://developer.chrome.com/blog/html-in-canvas),
  [2D drawing](https://developer.chrome.com/docs/web-platform/html-in-canvas/2d),
  [lifecycle/geometry](https://developer.chrome.com/docs/web-platform/html-in-canvas/concepts),
  [Three CanvasTexture](https://threejs.org/docs/pages/CanvasTexture.html).
  Current docs specify `content="drawable"`, descendant `drawable`, `paint` and
  `requestPaint`, with optional `preserveElementGeometry` used here.

## Verification

From repository root:

```sh
node --test wasm/tests/node/html-plate-title.test.mjs
cd wasm/app
npm run check:locales
npx tsc --noEmit
```

All pass: four focused tests cover opt-in/capability gates, connected paint lifecycle,
safe text insertion, disposal, first and later throwing draws, and existing title
naming. Mock lifecycle tests do not establish actual browser API support or pixels.
`git diff --check` passes. Impeccable source detect ran once successfully on both UI
targets, with no findings; regex-only scan excludes rendered contrast/layout.
An initial incorrect `--target` invocation failed before scanning; corrected to
positional file arguments. No browser QA performed at this initial stage.

## Immutable candidate

Single integrated build (7.63s Vite compilation, asset packaging completed):

```sh
cd wasm/app
ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine npx vite build --outDir ../build/ui-html-plate-title-candidate-20261109
```

Candidate: `wasm/build/ui-html-plate-title-candidate-20261109` (121 MiB,
made read-only). Native runtime inputs reused from read-only paths under the parent
build through local build symlinks; parent checkout was not edited.
Logs: `wasm/build/tests-html-plate-title/{build.log,tests.txt,detect.txt}`.
Full file hash manifest: `wasm/build/tests-html-plate-title/candidate.sha256`.
Manifest SHA-256: `fc81b3196f483189727a13493bc7d6ae793b0c2f09c71bf31a84bf18f4aa09e9`.

Serve the same candidate without rebuilding:

```sh
# If dependencies are absent, recreate the local read-only dependency link first:
ln -s /mnt/appdata/workspace/OrcaSlicer/wasm/app/node_modules wasm/app/node_modules
cd wasm/app
npx vite preview --host 0.0.0.0 --port 5064 --outDir ../build/ui-html-plate-title-candidate-20261109
```

QA URL: `http://localhost:5064/?htmlPlateTitle=1` (baseline: omit query).
No server started by implementation.

## Limits and initial QA scope

This is a raster bridge, not native DOM interaction inside the 3D renderer.
Offscreen HTML is aria-hidden and receives no input; Three raycasting and the
existing rename input retain interaction. Browser geometry synchronization across
the texture and 3D mesh, screen-reader semantics and HTML selection are not provided.
The experiment retains the fixed incumbent raster resolution and truncation.
There is one small canvas/span per title with opt-in enabled, removed on disposal.
If an implementation exposes the API but never emits paint, legacy pixels remain.
At this initial stage, actual browser version/capabilities, successful HTML paint, rename, orbit,
multi-plate rebuild/disposal, both themes and viewport sizes require separate QA.
Use this immutable candidate for retries; rebuild only after source/input changes.

## Initial browser QA status (superseded below)

QA was pending at this stage; native Chrome 157 acceptance now passes as recorded
in “Native Chrome 157 diagnosis and fix” below.

## Teardown fix verification and final candidate

Review found scene shutdown omitted title disposal. The main agent added
`this.disposeChildren(this.plateLabelGroup)` at `PlateScene.destroy()` entry.
Inspected lifecycle: `destroy()` calls `disposeChildren`; that method removes each
label mesh, disposes its geometry and material map; the title CanvasTexture's
`dispose` listener invokes the cleanup returned by `attachHtmlPlateTitle`, which
removes the connected HTML source and paint listener. This is source inspection
evidence for scene integration, not an executed scene teardown assertion.

No redundant helper test or source-regex assertion added. A direct scene test
requires WebGLRenderer construction and DOM/observer support, or a prototype
fixture stubbing controls, renderer, drag cleanup, observers, selection outline,
overlay cleanup, materials and scene collections used by `destroy()`. That exceeds
the requested minimal lifecycle fixture. Existing executed helper tests establish
source/listener removal on cleanup and both initial/later paint failure cleanup;
they do not establish that a real scene teardown reaches that cleanup.

Re-ran `node --test wasm/tests/node/html-plate-title.test.mjs`: **4/4 pass**,
log `wasm/build/tests-html-plate-title/tests-final.txt`. Ran `npx tsc --noEmit`
in `wasm/app`: exit 0. `git diff --check`: exit 0.

Built exactly one updated integrated candidate with the report command's new output:

```sh
cd wasm/app
ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine npx vite build --outDir ../build/ui-html-plate-title-candidate-final-20261109
```

Build succeeded (9.65s Vite compilation and successful asset packaging).
Log: `wasm/build/tests-html-plate-title/build-final.log`. Vite reported runtime URL,
Node-module externalization and chunk-size warnings; no build errors.
Final candidate: `wasm/build/ui-html-plate-title-candidate-final-20261109`
(121 MiB). All candidate files/directories made read-only; a writable-mode search
returned no entries. Full file hash manifest:
`wasm/build/tests-html-plate-title/candidate-final.sha256`.
Manifest SHA-256:
`ca8a24e5cbe23a9671335e143c94acf99b3ea0abbf11f33de1fa5bddea0918cf`.
Parallel browser QA should use this final candidate with Vite preview's `--outDir`
set to `../build/ui-html-plate-title-candidate-final-20261109` and reuse it for retries.
No browser verification performed by the test sub-agent.

## Independent browser QA — 2026-11-09

**Acceptance: FAIL on native text pixels.** T3 preview Chrome exposes the real APIs,
but opt-in erases title text and leaves the pencil. No support mocks were used.
No source changed, no build, publication or commit performed by this QA task.

Environment: T3 preview, Linux x86_64, viewport 1280×800, device raster scale 2.
UA: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36`.
UA brands report Google Chrome/Chromium 157. Exact patch/build was not exposed.
`HTMLCanvasElement.prototype.content` exists; setting drawable reflects drawable;
`CanvasRenderingContext2D.prototype.drawElementImage` and
`HTMLCanvasElement.prototype.requestPaint` are functions. These are actual browser
capabilities, not proof of correct raster output. Native source remains connected,
with text `Plate 1`, dimensions 313×90, and only 1464 nontransparent pixels
consistent with the remaining pencil. No thrown-draw cleanup occurred. Native
paint produces missing text in this runtime; successful HTML text rendering is
not verified. An actually unsupported browser was unavailable; unsupported-API
fallback remains covered only by the previously documented mock tests.

### Earlier candidate (before final teardown fix)

Served the immutable original through report's Vite preview on port 5064.
Default retained readable title. Native opt-in showed pencil without text.
Click at CSS (704,279) opened rename, entering `QA title` and Enter updated the
plate tab and connected source. Add Plate produced two sources `QA title` and
`Plate 2`; rebuilt sources replaced previous ones. Synthetic pointer orbit and
right-button pan changed camera framing; wheel input required dispatch directly
to scene canvas (preview scroll alone did not establish zoom).
Dark native screenshot:
`/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9fxzjj-5f82e79b.png`.
Renamed multi-plate/orbit screenshot:
`/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9fyzmw-50b9ae2d.png`.
These observations do not verify the later destroy fix.

### Final candidate smoke

Restarted own Vite preview on 5064 with
`--outDir ../build/ui-html-plate-title-candidate-final-20261109`; no rebuild.
Native missing-text failure reproduced. Changed theme through File → Preferences
→ Appearance → Theme → Light; confirmed root data-theme=light. OS color-scheme
emulation alone did not override explicit dark preference. Default path retains
readable text at initial framing and after a canvas wheel deltaY=-450 zoom.
Native text remains absent, so native zoom readability fails. Native title-area
click opens rename; `Final QA` plus Enter updates tab and drawable source. Add
Plate yields exactly two sources `Final QA`, `Plate 2`. Synthetic left and right
pointer gestures (10 moves each) and canvas wheel change camera framing without
blocking UI. These are synthetic browser input checks, not physical-device QA.
Switching to Preview retains two sources; that navigation does not demonstrate
scene destroy. The destroy fix has a same-browser interaction smoke, but actual
destroy/disposal invocation remains unverified by this run.

Final screenshots:
- Native light, initial: `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9g0ity-5c0df8ff.png`
- Default light, initial: `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9g1dwl-99f9af4d.png`
- Default light, zoom: `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9g1is8-c98f8f24.png`
- Native light renamed multi-plate: `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9g1v62-adcaffd9.png`
- Native light orbit/pan/zoom: `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9g225b-31602a82.png`

### Timing method and limits

Earlier candidate: 180 consecutive requestAnimationFrame intervals per mode,
same empty one-plate initial dark scene. Baseline mean/median/p95
16.666/16.665/16.670 ms; opt-in 16.666/16.665/16.670 ms. This is pacing, not cost.

Final candidate: same empty one-plate initial light scene, no geometry imported.
Temporarily wrapped requestAnimationFrame scheduling in page memory, timed callback
execution with performance.now, summed callbacks sharing a frame timestamp over
4 seconds, discarded first 10 timestamps, restored scheduling afterward.
Baseline n=225: mean 0.2922 ms, median 0.2900 ms, p95 0.3850 ms.
Opt-in n=229: mean 0.2990 ms, median 0.3000 ms, p95 0.3650 ms.
These are aggregate instrumented RAF JavaScript CPU durations, not full frame
cost, GPU time, compositor/raster time, or title-update cost. One short sample per
mode, sequential order, automation overhead and empty scene limit comparison.
**No performance gain claimed.** Loaded-model and repeated active-camera cost,
other engines, mobile sizes and actual unsupported browser remain unverified.

## Native Chrome 157 diagnosis and fix

2026-11-09, implementation follow-up. Read both applicable AGENTS files,
diagnosing-bugs and Impeccable craft-floor. T3 preview_status was the first browser
call. Initial open attempts returned connection refused before the own preview
server was ready; subsequent calls used only T3 preview. Same Chrome/157.0.0.0,
1280×800 viewport. No parent writes, dependency changes, commit or publication.

Ranked hypotheses communicated before probes: preserved geometry displaces text;
offscreen source culling; paint/layout timing; span dimensions. Minimized in page
memory to one connected drawable canvas, one drawable span, native paint callback,
drawElementImage and getImageData alpha count. Text-only bitmap assertion:
`pixels > 500`; original style produced **0**. Removing preserveElementGeometry:
0; waiting 100 ms before requestPaint: 0; explicit span width/height: 0. Moving
left to zero alone: 0 (implicit top was 800). Setting left/top zero: **4062**;
left -100000/top zero: 0. At viewport origin both preserved and unpreserved
geometry produced 4062. Origin with opacity zero: **4062**, repeated. Negative
z-index also produced 4062. A visibility-hidden probe never emitted paint and
hit the evaluate timeout; it was discarded. All throwaway probes were removed
by navigation before integrated verification.

Root cause experimentally isolated to source placement outside the viewport in
this Chrome implementation; offscreen raster culling is the supported explanation.
Timing, explicit dimensions and geometry preservation did not rescue that source.
Patch keeps the connected canvas at fixed left/top zero with opacity zero and
pointer-events none. Descendant rasterization remains available while the backing
canvas contributes no visible overlay. Existing paint failure fallback, default
opt-out, disposal and PlateScene.destroy teardown fix are retained.

No mock regression added: existing DOM mocks cannot reproduce browser raster
culling. The real browser pixel assertion is the regression seam. Integrated
assertion reads alpha values from x=0 through canvas.width-100 (excludes pencil),
y=0 through canvas.height, and throws if fewer than 500 pixels are nontransparent.
On native final candidate: Plate 1 **4062**, Plate 2 **4234**, renamed Native QA
**6444**. This catches the observed missing-text symptom independently of API
presence, source textContent or callback success.

Final verification used exactly one new integrated build:
`ui-html-plate-title-native-fix-20261109` under wasm/build; files made read-only.
Build successful, 8.50s Vite phase. Log:
`wasm/build/tests-html-plate-title/build-native-fix.log`.
Full manifest: `wasm/build/tests-html-plate-title/candidate-native-fix.sha256`.
Manifest SHA-256:
`4cd4a2e1c1a1a99025126400988f46df69b64f92948eca767f2c1e24e4103281`.
Previous failed final candidate manifest:
`ca8a24e5cbe23a9671335e143c94acf99b3ea0abbf11f33de1fa5bddea0918cf`.
Reused this new candidate for all integrated checks, served with Vite preview
on 5064. Helper tests 4/4 pass; `npx tsc --noEmit` exit 0; diff whitespace check
passes. No new test infrastructure.

Browser results:
- Light initial title visibly readable, native alpha assertion 4062. Screenshot:
  `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9g6a68-433b638f.png`
  (restore-session dialog still present in this initial capture).
- Click on projected title opens incumbent rename input; entering Native QA and
  clicking OK updates title source, alpha assertion 6444. Enter dispatch alone
  did not establish rename acceptance; OK is the verified commit action.
- Add Plate creates two native sources, 4062/4234 pixels. Plate rebuild removes
  prior sources. Synthetic left/right pointer gestures (10 steps each) plus
  canvas wheel deltaY=-450 change camera from approximately [870,-300,360] to
  [672.708,-249.945,327.110]. Text remains visible/readable at resulting zoom:
  `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9g7q2t-15d2d25a.png`.
- Set persisted preference to dark then reload: root data-theme dark, native
  assertion 4062 and readable title:
  `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mw9g8fc8-86327208.png`.
- **Simulated API absence:** temporarily replace prototype drawElementImage with
  undefined in page memory, Add Plate, then restore it. Rebuild leaves zero
  drawable sources and legacy title texture alpha counts 4062/4234. This is a
  forced-absent capability gate check, not evidence from an unsupported engine.
- `?htmlPlateTitle=0`: zero drawable sources, legacy texture alpha 4062.

Reuse earlier same-scene RAF CPU evidence above; this placement-only fix adds no
per-frame JS work. No performance improvement claimed; those samples still do
not measure raster/compositor cost. Actual scene-destroy invocation remains
unverified; the retained source fix and prior helper cleanup tests are unchanged.
Own server and tab closed at completion. README/Taproot left to parent task.
