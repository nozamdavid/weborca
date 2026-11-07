# v2.5 browser integration acceptance

The [combined startup publication](startup-publication.md) records the successor
candidate and current deployment, reusing these exact native/data inputs.

Chromium acceptance passed on **one immutable gated production candidate** with
Engine S2, the frozen v2.5 Preview pair, patched standalone STEP and merged
profiles/settings. No native builds/suites, deployment, commits, push or branch
operations were performed by this browser owner. Overall native/core acceptance
remains the separate core owner's responsibility.

Worktree: `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`.
Read original `AGENTS.md`, the original
`wasm/build/tests-background-engine-20261107/report.md`, and this worktree's
[foundation](merge-foundation.md), [config](config-adapters.md),
[Preview runtime](preview-runtime.md) and [STEP](step-integration.md) reports.
No delegation occurred. All evidence below is under
[`wasm/build/v250-browser-integration`](../../wasm/build/v250-browser-integration/)
(abbreviated `OUT`).

## Owned changes

- `wasm/app/vite.config.ts`: add optional `ORCA_PREVIEW_DIR`,
  `ORCA_PROFILES_DIR` and `ORCA_SETTINGS_DIR`. Both development serving and
  production packaging use those same resolved directories. Existing defaults,
  root/`preview/` duplicate assets and static-off behavior remain supported.
- `wasm/tests/node/asset-packaging.test.mjs`: invoke the real Vite asset plugin
  with distinguishable explicit engine/STEP/Preview/catalog/layout fixtures;
  check exact bytes in every packaged location for gated and static-off modes,
  including presence/absence of public alpha bootstrap assets. This specifically
  guards the otherwise silent use of old hardcoded Preview/catalog inputs.
- `wasm/tests/app/lib/dist.mjs`: an explicitly gated test server's HTTP 401
  counts as responding during readiness/occupied-port probes.
- `wasm/tests/app/step.mjs`: synthetic optional gated login, bounded browser
  threads, lazy-startup assertion, production STEP-client cancellation/retry
  coverage, all-worker cleanup and page-error checks. Use the visible
  `#slice-plate-btn` and actual slice result for the existing slicing check.
- This report. Ignored evidence scripts: `OUT/{build-candidate.sh,
  check-preparation.sh,check-integrated.sh,check-step.sh,startup.mjs,
  workflows.mjs,integrated.mjs,supplement.mjs,server.mjs}`.

The copied original release startup/recovery harnesses received minimal path
changes and the assigned workflow assertions. Existing adapter/core/Preview/STEP
owner changes were retained. No app interaction source needed a browser fix.

## Exact candidate inputs and outputs

Candidate: `OUT/candidate-gated`, recursively nonwritable. Build script:
`OUT/build-candidate.sh`. It verifies supplied pair hashes, records input hashes,
builds once, verifies inputs again, compares packaged assets byte for byte, and
freezes the candidate. All retries use that tree; no old engine fallback.

| Input relative to worktree | JS SHA256 | WASM SHA256 |
| --- | --- | --- |
| `wasm/build/v250-engine-module-s2/orca_engine.{mjs,wasm}` | `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7` | `452c0ab51a0b935f691384e629d73ad0005fda99733b059d18cc600c0d4c1f19` |
| `wasm/build/v250-preview-adapters/frozen-preview/orca_preview.{js,wasm}` | `9d3e9b4b3662704302a19e5c93d6923790702317770f9eedf08b51627f56c0b2` | `e068d00989f8daa23f1fe7454ed1f7bdb4b3fc589facecbeb0f9a4d65607e038` |
| `wasm/build/v250-step-module/step_tessellate.{mjs,wasm}` | `ae275fd99181db06e7c3d6d6d8c78fc012b10781009f5cff76e9c4fd0b876423` | `a97f5444cf5cee49c1e2cfa8a58bc0b7c2dc53eb27b25350daa6a7eada1117aa` |

STEP packaging includes `LICENSE_LGPL_21.txt` and `OCCT_LGPL_EXCEPTION.txt`.
The candidate was built after the STEP pair arrived; no candidate used old STEP.
STEP owner subsequently confirmed unchanged hashes and passing geometry 5/5
plus import/slicing 5/5. Their report records the failing old-module cone control,
patched 67-object TKMesh archive and unchanged-toolkit provenance.

Explicit data inputs: all **72 vendor packs**, resources/index/assets/covers in
`wasm/build/v250-config-evidence/catalog/profiles`, and
`wasm/build/v250-config-evidence/settings/layout.json`. Their complete copied
trees/layout duplicates compare equal. Worker/client source is this worktree's
`wasm/web`; backend bundles come from this worktree's app gateways.

`OUT/build-inputs.env` records all five directory overrides and the enabled gate.
`OUT/input.sha256` captures native/data directories, app/store/gateway/web source,
Vite configuration, package lock and server inputs before packaging; checks pass
after building. SHA256 of that manifest:
`a67c9fca29a99079289ea919bff7f3d7e8922dcc975e0459fbfd92142e85290d`.
`OUT/candidate.sha256` hashes every output file; SHA256 of the manifest:
`d666a64185fbe5801c8a6f955fa10e708672cd7d792c7b8fff863ac0e32089d8`.
`candidate-before-qa.log`, `candidate-after-qa.log` and `candidate-final.log`
verify the frozen outputs. `OUT/server.mjs` is the copied release server,
SHA256 `77b7fd311a1b93e62b3744501833c50f91131ffec42ce0674b93d1877cb442bd`.

## Executed checks

All heavy commands use the original shared runner:
`bash /mnt/appdata/workspace/OrcaSlicer/wasm/build/tests-mobile-polish/qa/run-capped.sh LABEL 2G COMMAND`.
It serializes `/tmp/webslicer-heavy.lock`, limits tasks to 128, CPU to two cores,
Node heap to 1536 MiB and swap to zero. Commands explicitly change into this
integration worktree because the runner starts in the original checkout.

| Accepted runner / evidence | Result | Peak bytes |
| --- | --- | ---: |
| `v250-browser-preparation`, `preparation-capped.log` | App TypeScript; packaging, background-engine, worker-bridge and alpha UI **34/34** | 973471744 |
| `v250-browser-build`, `build-capped.log` | 22 locale catalogs, TypeScript, one production build, exact asset comparisons and freeze | 2147483648 |
| `v250-browser-startup-r1`, `startup-r1-capped.log` | **16 scenario assertions**, real engine, desktop/mobile workflows and Preview | 1055551488 |
| `v250-browser-integrated-r1`, `integrated-r1.log` | Gated protection/admin/tester/recovery suite passed; combined batch later failed only on STEP server readiness | 1211961344 |
| `v250-browser-step-r3`, `step-r3-capped.log` | Existing STEP browser suite plus cancellation/lazy checks, **9 recorded checks** | 1252319232 |
| `v250-browser-supplement-r2`, `supplement-r2-capped.log` | Fresh cube slice/download, STL append and all four Preview widths | 1042837504 |

All rows have zero swap and zero task-limit hits. The build reached its 2 GiB
limit but completed with exit 0; browser tests stayed below 1.22 GiB. Existing
Vite large-chunk, Draco externalization and mixed-import warnings remain.
Changed `.mjs` syntax and owned `git diff --check` pass. Vite configuration is
compiled/executed by the focused packaging test and production build.

The original combined STEP attempt retains `step-r1.log`: the readiness probe
rejected expected unauthenticated 401. R2 reached real STEP checks then timed out
clicking the incumbent hidden `#slice-btn`; R3 uses the visible plate control.
Supplement R1 selected an incumbent hidden export link; R2 selects the accessible
visible Export G-code link. These are harness corrections; no candidate rebuild.
Accepted startup, alpha/recovery and Preview scenarios were not rerun for them.

Static-off acceptance is the real plugin packaging branch plus the existing
alpha UI `static off mounts directly with zero alpha API or bootstrap code`
case. No second static production build: the explicit asset-directory change
has exact-byte tests for both modes, and gate logic/source did not change.

## Browser behavior and evidence

Chromium **153.0.8010.12**, SwiftShader, emulated viewports. Synthetic loopback
admin/invite state only; real providers/printers/external requests are blocked.
COOP same-origin / COEP **require-corp** and isolation are verified.

`startup-results.json` records shell navigation/preferences completed at
**793/1067 ms**, before held engine responses completed at **2880/2408 ms**
(1280/390). Native configuration ready at 3863/3168 ms. Each downloads exactly
one engine; neither requests the catalog before Add printer. These controlled
ordering samples do not measure deployment/network speed. Actual engine failure
Retry, catalog 503/Retry/reopen reuse, first-run discovery and close-during-
download worker disposal/reopen pass with zero page errors.

Persisted legacy boolean arc process selects and displays its saved name;
native values normalize to `enabled`, modified values reset to the saved
baseline, and switching back to the current system process works. Filament
add/delete controls complete the native transaction and disable final-slot
deletion. Numeric model movement, UI undo/redo, context-menu repair and real
3MF project download/reopen pass. `repair-result.json`, `editor-project.png`
and `v250-browser-project.3mf` retain evidence. STL append imports a second
20×20×20 object without changing the first or reporting a native error.

Alpha suite covers desktop/mobile admin Open slicer and return, tester invite
login/privilege separation, protection and logout/revocation. Forced denied
IndexedDB backup exposes Retry, then durably saves **1 object / 11095 bytes**;
reauthorization offers and restores the named unsaved geometry. See
`integrated-r1.log` and `qa/gated-{backup-denied,recovery-offer,recovered}.png`.

Both desktop/mobile slices use Voron 2.4 300 0.4 nozzle, 0.20mm Standard @Voron,
Generic PLA @System. Both produce **383170 raw G-code bytes, 100 layers,
29094 Preview moves, 573.37 s, 1307.61 mm / 3.90 g**. Integrated layer/view
controls and all four lighting/quality combinations preserve metrics. Desktop
FPS publication displays **1 FPS / CPU 1.2 ms** during software-rendered scrubs.
This exercises publication; CPU submission excludes GPU time and establishes no
hardware performance parity. Frozen Preview's separate pixel/shadow acceptance
is in [preview-runtime.md](preview-runtime.md); this integration checks UI state,
metadata and rendering with that exact pair rather than a new pixel oracle.

`preview-metrics-{1280,390}.json` verifies raw export-link bytes equal the current
slice. The visible export action also downloads thumbnail-bearing G-code in
`cube-v250.gcode`, SHA256
`4608b4312e3cf0f16412b7f36c50c34981ae63062d262176053cf8b8453eab13`.
`supplement-results.json` retains fresh-preset metrics/STL bounds. Inspected
`preview-fit-{1440,1280,390,320}.png` show fitting Preview canvases and reachable
controls. Alpha and Prepare fit/no-header-overlap assertions at all four widths
have captures in `qa/`. Waiting captures: `waiting-{1280,390}.png`.

STEP remains lazy through startup. Cancellation holds the actual WASM response,
calls production `cancelStepTessellation`, checks `AbortError` and worker close,
then retries successfully through the actual app import dialog. The cancellation
client is bundled from unchanged production TS into a test-only page namespace;
its URLs use the frozen candidate's actual worker/module. There is no exposed
in-progress STEP Cancel UI, so this is client/worker cancellation coverage.
Valid/malformed/offline-module imports preserve or append project objects as
appropriate; every completed/failed worker terminates. Actual STEP slicing and
plate-store append pass. Deliberately blocked downloads produce expected console
errors, with zero uncaught page errors. Firefox was skipped as instructed.

## Upstream changes and limits

`legacy-gcode-comparison.log` compares the downloaded current-preset cube against
the retained macOS legacy fixture. Both have 100 layers and identical XYZ motion
bounds. G1 count is **9091 → 8802**, summed extrusion **1304.9417 → 1306.8087**;
12331 normalized lines differ. The leading change adds
`MINIMUM_CRUISE_RATIO=0.5` to Klipper velocity limits, emitted deliberately by
merged `GCodeWriter.cpp:479`; the merged planner parses that field. Travel
coordinates/infill paths also change. Native footer estimate is **9m20s →
9m33s**; old-fixture Preview runtime reports 575.43 s whereas the newly sliced
cube reports 573.37 s. These are different toolpaths and estimator contracts,
not interchangeable timing oracles. The original release startup report's raw
376009-byte output also differs from the current 383170-byte result.

Upstream planner/command changes are deliberate; this browser QA does not prove
every geometry delta intentional or establish same-source native/WASM parity.
No legacy golden was replaced, no differing output was labeled a byte-parity
pass, and core semantic acceptance stays with its owner. Browser workflows and
current-preset export consistency pass independently of that legacy mismatch.

No new belt, IMEX, mixing/Hybrid, physical printer, hardware/mobile Safari,
Firefox, transparency or same-source native OCCT8 qualification is claimed.
See the separate STEP report for unavailable native OCCT8 and historical
two-engine comparison OOM limits. No service/private configuration was changed;
all test servers close and the shared-browser inspection tab was closed.
The candidate is ready for parent review, with deployment and project tracking
milestones left to the coordinating owner.
