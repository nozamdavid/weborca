# Engine startup cache and download progress — 2026-11-07

Combined candidate/public deployment is now verified in the
[combined startup publication](startup-publication.md), including the updated
server. The implementation-only evidence below predates that publication.

Prepared in `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1` on checkpoint
`77a15ff9238d9b9404b1da4256a575929380401e`. Source changes are uncommitted.
No deployment, integrated UI build, native rebuild or provider operation occurred.
The combined candidate and publication remain with the parent owner.

## Reproduction and cause

The actual deployed server is the frozen server recorded in [publication](publication.md),
serving `/mnt/appdata/workspace/OrcaSlicer/wasm/build/ui-v250-release-20261107`.
The source server is not the running server.

Red command, already executed:

```sh
bash /mnt/appdata/workspace/OrcaSlicer/wasm/build/tests-mobile-polish/qa/run-capped.sh startup-cache-red2 2G node /home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/startup-cache-progress/deployed-reload.mjs
```

A normal Chromium page reload, with browser caching enabled and no request routing,
fetches the actual protected engine twice in the same authenticated context.
Both requests report `Cache-Control: no-store`, Brotli body length 4,243,909,
decoded body length 17,139,421 and transfer size 4,244,209. The assertion fails:
`warm normal reload retransfers the engine body`. This measures real body transfer,
not repeated module initialization. No credentials appear in the evidence.

Ranked hypotheses were alpha's cache override, changing asset URLs, and initialization
mislabeled as transfer. Identical URLs and full warm body transfer ruled out the latter
two as the download cause. `alphaAccess.guard()` sets `no-store` on every protected
response; existing static ETags cannot make the browser retain a forbidden response.
The worker deliberately omits a total for encoded responses, so it has no percentage:
Brotli `Content-Length` measures 4,243,909 wire bytes while stream chunks total 17,139,421.

## Change and consumer contract

Only the canonical `/engine/orca_engine.mjs` and `/engine/orca_engine.wasm` routes
receive `private, no-cache`, after alpha authorization. HTML, alpha/API responses,
other static assets and private backend files retain their gate behavior. Conditional
and HEAD requests still pass alpha authorization. A streamed SHA256 of the loader
and WASM pair supplies `X-Orca-Engine-Version` and a pair-specific ETag. A loader-only
change invalidates the pair. A request with stale `?v=` receives 409. File metadata
memoizes hashes; accepted deployment roots must remain immutable.
`X-Orca-Decoded-Length` supplies the original file size independently of compression.

`prepareEngineAssets` first performs a network `HEAD` of the loader with
`cache: no-store` and same-origin credentials. Denial fails startup before accessing
cached bytes. Valid pair metadata binds the loader import and WASM URL to `?v=<SHA256>`.
Only that engine binary is stored in origin-local CacheStorage `orca-engine-assets-v1`.
There is no HTML, API, session, credential or profile cache in this helper.
Missing/disabled/full CacheStorage permits a download. Missing version metadata
(e.g. Vite or the old frozen server) disables persistent reuse. Offline/denied HEAD
never falls back to cached access. Old binary entries cannot satisfy a different pair
key; browser quota/eviction may require a later fresh download.

The generated loader retains streaming compilation and consumes one fetch body.
The decoded stream is counted, checked for expected length and copied into CacheStorage;
failed/incomplete streams are not committed. Its stored Response strips the wire
encoding and wire length because it contains decoded bytes. A network body uses
`cache: no-store` so CacheStorage owns reuse and `downloading` has a clear meaning.
Normal HTTP revalidation also works independently for the engine pair.

The existing `onProgress` callback/RPC transports this shape to `engineLoad`:

```ts
{
  phase: 'checking' | 'cached' | 'downloading' | 'initializing';
  loaded?: number;
  total?: number;
}
```

- `checking`: authorization/version lookup and loader import; no download claim.
- `cached`: reading a verified pair's stored binary; no download percentage.
- `downloading`: actual body transfer. `loaded` counts decoded bytes monotonically.
  `total` is the authoritative decoded length, or an identity response's Content-Length.
  An encoded response without decoded length has unknown total and no percentage.
  Invalid/overrun totals never generate an unbounded percentage; length mismatch fails.
- `initializing`: body fully consumed; engine compilation/native initialization and
  existing configuration startup continue. This is separate from `isEngineReady`.

The status component floors byte ratio to an integer percent bounded at 100, keeps
byte counts for unknown totals, and explicitly labels checking/cached/initializing.
Viewer owner: retain `isEngineReady` for native tool gating; none of these phases means
native readiness. Prepare rendering must not depend on `engineLoad`. Shared appStore
edits here are limited to its progress type and the initial/retry `checking` value.
There are no App.tsx or Prepare lifecycle edits from this owner.

## Verification

The red reproduction and retained browser source probes live in ignored
`wasm/build/startup-cache-progress/`. All heavy probes and application type compilation
used the original serialized 2 GiB, zero-swap runner. Its logs are under
`/mnt/appdata/workspace/OrcaSlicer/wasm/build/tests-mobile-polish/qa/`.

| Check | Result | Peak bytes |
| --- | --- | ---: |
| `startup-cache-red2` against frozen deployed server | Expected assertion failure; two full transfers | 281882624 |
| `startup-cache-final` source server, published unchanged engine bytes | Cold 4,244,209 transfer bytes; warm 300; persistent warm zero WASM requests | 378011648 |
| `startup-cache-worker` actual source worker with published v2.5 module pair | Cold checking/downloading/initializing; warm checking/cached/initializing; both init RPCs succeed | 480894976 |
| `startup-cache-types` `tsc --noEmit --project <worktree>/wasm/app/tsconfig.json` | Pass | 974733312 |

Source server/browser probes use loopback and the existing immutable engine inputs;
they do not build or replace the UI. The actual-worker probe substitutes source
worker/helper imports in a browser blob solely to test the changed fetch integration
against the real published native module. The final source probe was rerun after the
last server validator change. All successful capped runs report swap peak 0 and
`pids.events max 0`.

Focused regression command (28 passed):

```sh
node --experimental-strip-types --test wasm/tests/node/background-engine.test.mjs wasm/tests/node/engine-assets.test.mjs wasm/tests/node/alpha-access.test.mjs
```

The added server regression went red before the server fix. Coverage includes warm
reuse following a fresh authorization check, loader-only release invalidation,
stale pair rejection, conditional auth denial, logout denial, unchanged HTML/API
no-store, decoded compressed totals, unknown totals, monotonic/bounded byte progress,
truncated/oversized streams, unavailable storage and distinct status labels/percent.
The small component check exists to catch incorrect percentage/phase presentation.
Existing startup cancellation/retry and alpha access checks also pass.

JavaScript syntax checks pass for server, worker and helper. Vite configuration and
its imported TS graph pass standalone compilation with `--noEmit --skipLibCheck
--moduleResolution bundler --module esnext --target es2022 --esModuleInterop
--allowImportingTsExtensions`. The first standalone invocation lacked the last flag
and rejected the repo's existing `.ts` imports; the corrected invocation passes.
Application TS compilation passes separately under the cap. `git diff --check` passes;
no temporary debug logging was added.

## Exact files owned by this change

- `wasm/deploy/server.mjs`
- `wasm/web/engine-assets.js` (new)
- `wasm/web/engine-worker.js`
- `wasm/web/orca-engine.d.ts`
- `wasm/app/vite.config.ts` (serve/copy helper at root and under web)
- `wasm/app/src/engine/orcaEngine.ts`
- `wasm/app/src/store/appStore.ts` (type and initial phase only)
- `wasm/app/src/components/EngineLoadingIndicator.tsx`
- `wasm/tests/node/engine-assets.test.mjs` (new)
- `wasm/tests/node/alpha-access.test.mjs`
- `wasm/tests/node/background-engine.test.mjs`
- `docs/v2.5.0-integration/startup-cache-progress.md` (this report)

Existing unrelated documentation edits and the viewer owner's files are preserved.
Publication must select the updated source server instead of the incumbent frozen
server, and the combined UI build must copy `engine-assets.js` along with its worker.
The [combined publication](startup-publication.md) completes candidate browser
acceptance, updated-server deployment and milestone tracking.
