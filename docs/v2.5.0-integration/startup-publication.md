# Combined engine startup and early Prepare publication

Published **2026-11-07 14:42:41 UTC** at
<https://server-1.barbel-hops.ts.net:5070/>. Service PID **2695741**, invocation
`8df332650a614a2da3157e0a7e40be50`. Public desktop/mobile acceptance passed.

Worktree: `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`, on the existing
v2.5 integration branch. Source remains uncommitted. No native rebuild,
delegation, commit, push or main-branch operation was performed.

The [cache/progress](startup-cache-progress.md) and
[early Prepare](prepare-early-viewer.md) changes share one production candidate.
Evidence is local ignored data under `wasm/build/v250-startup-publication`
(`OUT` below). The original checkout's user source changes were preserved.

## Exact inputs and serving

One incremental production build completed, including app TypeScript and all
22 locale checks. The earlier precheck attempt failed before reaching the build.
All later harness retries reuse the recursively nonwritable `OUT/candidate-gated`.
The release is an exact copy at
`/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/ui-v250-startup-release-20261107`.

Engine S2, frozen Preview, patched STEP and notices, regenerated 72-vendor
profiles/resources and settings/layout are the exact prior inputs listed in
[browser integration](browser-integration.md). `OUT/build-inputs.env` and
`OUT/build-candidate.sh` select all five directories explicitly. Packaged trees,
pairs, layout duplicates and Preview aliases compare byte for byte. The new
`engine-assets.js` compares equal to source at both root and `web/` paths.

| Manifest/file | SHA256 |
| --- | --- |
| `OUT/input.sha256` | `1e55e13255fe9f0602407546f7413018d87e67b19f271cf3d6bda0226eb5e0c5` |
| `OUT/candidate.sha256` | `187d23fe789cf9957a22790726dd03a3f795651ac9a392e61374151dff13502b` |
| `OUT/release.sha256` | `1bedc841a33df8a0e544c3d0b09072f2f2bd37afc335382d87024ef2848f35eb` |
| `OUT/server.mjs` | `08015d5420821522bfa9838b581cd7b4f9d192e425b5ef71a7de92bf72efe2a4` |
| `OUT/previous.sha256` | `13925492023ae4d8ff26b7c8a41485c7241c01b508e79413b43fcb8b21be3121` |

The server is a frozen copy of **updated `wasm/deploy/server.mjs`**. Its diff
against the incumbent server contains only the assigned engine pair/version,
cache exception, decoded-length and validator changes. All four newly packaged
backend bundles (`alpha-access`, printer cloud, Orca Cloud, OctoEverywhere)
compare byte-identical to the previous published v2.5 release. This preserves
provider dispatch and HTTP201 compatibility. The old frozen server is retained
for rollback; it cannot provide the new cache/progress contract.

## QA evidence

All heavy runs use the existing serialized
`/mnt/appdata/workspace/OrcaSlicer/wasm/build/tests-mobile-polish/qa/run-capped.sh`,
with 2 GiB, zero swap, Tasks128 and two CPUs. Runner logs remain in that original
checkout directory. No additional production build was used for harness repairs.

- `v250-startup-build`: cache/progress, alpha, packaging and cloud checks passed;
  five printer fixture startup checks failed because their ad hoc bundle omitted
  the production `createRequire` banner. `v250-startup-backend-diagnosis` exposed
  the startup failure; `v250-startup-build-r2` passed all six printer checks with
  the actual incumbent production bundle, then completed the sole build.
  Build peak **1,936,285,696 bytes**, swap0, task-limit hits0.
- `v250-startup-local-r2`: **61/61** packaged printer/monitor checks pass with the
  new candidate bundle, including HTTP201 and exact monitor upgrade barriers.
- `v250-startup-local-r4`: **four** focused browser scenarios pass: held transfer
  and HTTP failure/retry at **1280/390px**. Visible bed/grid, mouse orbit/pan/wheel
  zoom, disabled native text/Slice, eventual cube hydration, single worker per
  attempt and stable scene/canvas/controls identity are checked.
- `v250-startup-cache-local`: normal cache-enabled Chromium, no request routing
  or cache disabling, **1280/390px**. Each cold startup transfers **4,243,909
  Brotli body bytes**, separately measured from **17,139,421 decoded bytes**.
  Visible percentages include intermediate values; decoded progress is monotonic,
  bounded, and completes exactly at the decoded total. Warm normal reload performs
  a fresh loader HEAD, reports checking/cached/initializing and makes **zero WASM
  network requests**. Loader GETs and repeated module initialization are recorded
  separately. Each viewport slices **383170 bytes / 100 Preview layers** and
  denies cached UI startup after logout. Peak **1,144,426,496 bytes**, swap0,
  task-limit hits0. See `local-cache-results.json` and percentage/Preview captures.

The focused target gained optional synthetic gated authorization, proxy Origin
translation and a viewport override: the production gate build cannot be tested
as an ungated development app. The copied older startup harness now recognizes
version-query WASM URLs and waits for the status element while response headers
are held: the new contract truthfully reports checking before a body starts.
These are harness changes; no product source repair was required.

The retained `local`/`local-r2`/`focus-r3` logs include failed production-proxy
attempts before synthetic authorization/Origin translation was added. The four
focused scenarios in `local-r4` passed; that batch then exited on the older
startup harness's premature downloading-label assertion. The corrected
`v250-startup-integrated` run below completes the remaining checks. These failed
harness attempts did not alter or rebuild the candidate.

The owner's focused regressions cover loader-only pair invalidation, stale pair
409, denied/expired HEAD and conditional requests, unknown/encoded totals,
truncated/oversized bodies and unavailable storage. Expiry uses synthetic clocks;
public sessions are not left running for their full lifetime. Public release
invalidation is checked via exact pair metadata and stale-version rejection;
no deliberately altered engine is activated publicly.

`v250-startup-integrated` passed the existing startup suite's **16 assertions**
and full gated integration/recovery suite. Both viewports slice/Preview;
desktop preset/filament editing, native move/undo/redo, repair and 3MF reopen,
all Preview lighting/quality combinations, layer/view/export consistency and FPS
publication pass. Failed download/retry, close during held transfer, worker
cleanup/reopen and first-run deferred discovery pass. Recovery retains
**1 object / 11095 bytes** through revoked access, denied IndexedDB, backup Retry
and restore. Peak **1,296,891,904 bytes**, swap0, task-limit hits0.
`candidate-after-qa.log` verifies unchanged output. The lengthy existing FPS
exercise completed under the original caps; no hardware performance claim follows.

## Public activation and acceptance

`OUT/release.sh --check` passed. The sole new installed file is the lexical-last
override named in `OUT/override-path.txt` (65 `z` characters before
`-v250-startup.conf`). It explicitly resets `ExecStart` to the new frozen server
and selects the new release root. Every previous override, unit and Tailscale
route compares unchanged. Active runtime settings compare equal for all four
providers, Orca Cloud enablement/callback/preset writes, alpha gate/private paths,
bind/host/origin/port. Service caps remain **512 MiB / swap0 / CPU100% / Tasks64**.
Private environment and durable alpha state compare byte-identical before
activation, after restart and after public QA; their modes remain 600. No invite
was added or edited by public QA. RAM admin and Orca Cloud sessions reset on restart.

`v250-startup-activate` passed bounded readiness, health/bootstrap protection and
the public authenticated exact-byte/header checks. These cover app JS, engine,
STEP/notices, both Preview locations, profiles/resources, both layouts, workers
and both helper locations. Engine pair HEAD metadata equals the independently
computed pair hash; stale pair requests return **409**, authenticated conditional
requests **304**, revoked conditional HEAD **401**. HTML/API/other assets retain
`no-store`; the engine pair alone is `private, no-cache`. COOP `same-origin`,
COEP **require-corp**, Secure/Strict/HttpOnly cookies, admin/app separation,
logout/revocation and hidden backend bundles pass. Peak **116,424,704 bytes**,
swap0, task-limit hits0. Automatic rollback was not needed.

`v250-startup-public-browser` passed on HTTPS Chromium 153.0.8010.12 at
**1280/390px**, using normal cache-enabled contexts with **no Playwright routing
or cache disabling**. CDP bandwidth throttling exposes intermediate percentages
while the actual engine transfers. Public captures show **1%** alongside the
visible early bed/grid and disabled native actions; both mouse camera checks
finish before readiness. Each cold response advertises **4,243,909 Brotli entity
bytes**, decoded total **17,139,421**; the helper observes **2681/2814** progress
samples and 116 distinct percentage/byte labels. Playwright HTTPS request-size
accounting reports **4,246,301/4,246,359** bytes and zero separate header bytes;
that transport accounting is retained verbatim, not equated with decoded length
or the entity Content-Length. Warm normal reload requests loader HEAD/GETs but
**zero WASM requests**, so transferred WASM body bytes are zero. Status phases
are checking/cached/initializing, with no downloading label. Each viewport
imports the cube and slices **383170 bytes / 100 Preview layers**. Logout followed
by conditional HEAD/reload denies access despite the retained binary cache.
There are zero uncaught page errors. Peak **1,002,192,896 bytes**, swap0,
task-limit hits0. See `public-cache-results.json`, `public-percent-{1280,390}.png`
and `public-preview-{1280,390}.png`; the percentage captures were visually inspected.

The browser QA uses fresh origin storage with no provider credentials or printer
configuration. Public native modules are verified by exact bytes; STEP's current
browser workflow acceptance remains the same-pair prior publication evidence.

## Rollback and limits

The guarded script is:

```sh
bash /home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/v250-startup-publication/release.sh --rollback
```

It verifies both immutable trees, the frozen servers, previous units and Tailscale
routes, removes only its byte-identical new override, restarts and verifies the
exact previous **v2.5** root
`/mnt/appdata/workspace/OrcaSlicer/wasm/build/ui-v250-release-20261107`
with `tests-alpha-design-20261107/server.mjs`. Readiness is bounded to 20 requests
with two-second HTTP timeouts. Activation failure invokes rollback automatically.
Current durable state is retained; no stale state snapshot is restored.

Chromium/SwiftShader and emulated mobile establish the sampled workflows only.
Physical touch/Safari, hardware GPU performance, Firefox, real provider/printer
lifecycle, native/WASM toolpath parity, OCCT parity and new upstream feature
qualification remain open. Restart invalidates RAM admin/Orca Cloud sessions;
existing durable tester sessions/invites and browser presets retain their paths.

Taproot readback confirms **version 84 → 85**, completed/collapsed milestone
`v250_startup_publication_20261107` and current root/shipped pointers. Completed
branches are recursively collapsed; open qualification statuses are retained.
The first update was rejected before mutation because metadata values are capped
at 500 characters; the successful update uses a concise metadata pointer and
full evidence in notes. Previous root/shipped notes are retained in
`OUT/taproot-tree-before.json`; update/readback receipts are in `OUT/taproot-*.json`.

## Exact changed files

Combined implementation and focused checks:

- `wasm/deploy/server.mjs`
- `wasm/web/engine-assets.js`
- `wasm/web/engine-worker.js`
- `wasm/web/orca-engine.d.ts`
- `wasm/app/vite.config.ts`
- `wasm/app/src/engine/orcaEngine.ts`
- `wasm/app/src/store/appStore.ts`
- `wasm/app/src/components/EngineLoadingIndicator.tsx`
- `wasm/app/src/plate/PlateView.tsx`
- `wasm/tests/node/engine-assets.test.mjs`
- `wasm/tests/node/alpha-access.test.mjs`
- `wasm/tests/node/background-engine.test.mjs`
- `wasm/tests/app/background-engine.mjs`

Documentation, including retained earlier integration/publication edits:

- `README.md`
- `wasm/deploy/README.md`
- `docs/v2.5.0-integration/README.md`
- `docs/v2.5.0-integration/tracking.md`
- `docs/v2.5.0-integration/browser-integration.md`
- `docs/v2.5.0-integration/publication.md`
- `docs/v2.5.0-integration/startup-cache-progress.md`
- `docs/v2.5.0-integration/prepare-early-viewer.md`
- `docs/v2.5.0-integration/startup-publication.md`

Coordinator source changes are confined to the focused browser harness's gated
session/Origin/viewport support. No app/server implementation repair was needed.
The ignored `OUT` directory contains build/QA/release/Taproot scripts, immutable
manifests, receipts and captures, rather than additional tracked source changes.
