# Prepare viewer before engine readiness

The [combined startup publication](startup-publication.md) now records completed
packaged-candidate and public desktop/mobile acceptance. The implementation-only
evidence below predates that publication.

Implemented in `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1` on the
v2.5 integration source. No native changes, production build, commit or deployment.
Combined production acceptance remains pending the two owners' completed batch.

## Reproduction and cause

The focused browser target proxies the actual app and pauses the successful
`/engine/orca_engine.wasm` response before forwarding its body. A fresh browser
context has no engine cache. It asserts a mounted, visible Prepare canvas with
visible bed/grid geometry while `isEngineReady` is false, then drives real mouse
orbit, pan and wheel zoom.

Before the fix, the capped `prepare-early-viewer-red` invocation failed in 1.6s:

```text
AssertionError: Prepare build plate/grid visible before engine readiness
false !== true
```

`PlateScene` already constructed its JS scene and camera controls independently
of native startup. Its bed starts hidden; `PlateView` also unconditionally hid
the bed in its artwork layout effect. Artwork loading returns early while
`bedConfigLoading` includes `!isEngineReady`, leaving the built plate/grid hidden
through the whole engine download and on a failed download.

## Assigned changes

- [PlateView.tsx](../../wasm/app/src/plate/PlateView.tsx): reveal the existing JS
  bed immediately when mounting before engine readiness and retain that fallback
  through configuration updates during startup. Keep the selected printer's
  existing artwork loading, cancellation and bed updates after readiness.
  Run the initial native object refresh at the ready transition, rather than
  clearing the mesh cache and scheduling a native query on viewer mount.
  Scene creation/destruction, object synchronization and native action gates
  retain their existing lifecycle. No early empty object state is published.
- [background-engine.mjs](../../wasm/tests/app/background-engine.mjs): focused
  browser coverage for held startup and real HTTP failure/retry. Checks camera
  interaction, disabled Slice/native text tools, eventual ready transition and
  native cube hydration, a single canvas, stable scene/canvas/controls identity,
  one engine worker per startup attempt, one successful WASM response, and no
  page errors. Failure is tested before retry and again while retry is held.
- This report.

The engine cache/progress pipeline, shared store progress types, server headers
and top download indicator belong to the other owner. Existing unrelated docs
edits were preserved.

## Executed verification

Used a development server on `127.0.0.1:5396` with these existing v2.5 inputs:

```text
ORCA_ENGINE_DIR=wasm/build/v250-engine-module-s2
ORCA_PROFILES_DIR=wasm/build/v250-config-evidence/catalog/profiles
ORCA_SETTINGS_DIR=wasm/build/v250-config-evidence/settings
```

The server received absolute paths for these overrides. No native rebuild or
standalone production build was run. The worktree needed a temporary local
`wasm/tests/node_modules` link to the original checkout's installed Playwright
dependencies; the link was removed after verification.

Final command (runner starts in the original checkout, so explicitly change cwd):

```sh
bash /mnt/appdata/workspace/OrcaSlicer/wasm/build/tests-mobile-polish/qa/run-capped.sh prepare-early-viewer-final 2G bash -c 'cd /home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1 && node wasm/tests/app/background-engine.mjs && node --test wasm/tests/node/background-engine.test.mjs && cd wasm/app && ./node_modules/.bin/tsc --noEmit'
```

Passed: both browser scenarios, all 3 existing background-engine unit checks,
and affected app TypeScript compilation. Final runner log:
`/mnt/appdata/workspace/OrcaSlicer/wasm/build/tests-mobile-polish/qa/prepare-early-viewer-final.log`.
Peak memory **985,083,904 bytes**, swap **0**, task-limit hits **0**.
The browser scenarios took about 9s together. The test permits native loader
HTTP retry attempts after a failed response; worker startup count guards duplicate
app initialization. Changed test syntax and owned diff whitespace also pass.

## Later combined candidate QA

1. After both owners finish, perform the one coordinated incremental integrated
   build with the same v2.5 engine/Preview/STEP/data inputs recorded in
   [browser-integration.md](browser-integration.md). Freeze and reuse that output.
2. Serve that immutable gated output locally with synthetic admin/state and
   its matching `ORCA_PUBLIC_ORIGIN`. The focused target accepts
   `ORCA_QA_PASSWORD` for this synthetic authorization; a production gate build
   cannot use an ungated development session. With Playwright available, run
   through the same serialized 2GiB runner. `PORT` is the candidate server port.

   ```sh
   ORCA_QA_PASSWORD=synthetic-password ORCA_APP_URL=http://127.0.0.1:PORT node wasm/tests/app/background-engine.mjs
   ```

   Repeat with `ORCA_QA_WIDTH=390` for mobile. The proxy translates its local
   Origin to the upstream synthetic server's Origin for the actual gate checks.

3. Run the existing gated `wasm/build/v250-browser-integration/startup.mjs` and
   `integrated.mjs gated` harnesses against that same coordinated output (update
   their candidate path if needed). These cover desktop/mobile startup, native
   slice/Preview, real unmount/worker cleanup, reauthorization, and the persisted
   unsaved-geometry/revocation/recovery restore workflow. The focused check above
   does not claim production or persisted recovery acceptance.
4. In the shared browser, hold the engine response on desktop and mobile Prepare:
   confirm the plate/grid and camera work, native actions remain disabled, failure
   leaves the viewer usable, and Retry completes without a second canvas. Verify
   selected-device bed changes and restored geometry after readiness. Include
   the other owner's cache/progress assertions in this same candidate QA batch.
