# Cloud startup follow-up — 2026-11-11

Branch `fix/weborca-review-followups`, HEAD `8e21361611`, main base `bb0848ad06`. This batch implements priority 4 of [codebase-review-20261111.md](codebase-review-20261111.md): bound optional cloud startup without weakening authorization.

## Reproduction

`appEntry.start()` awaited `checkCloudSession()` before importing `App` and rendering. A stalled credential, Web Lock or status response therefore prevented first render. `checkCloudSession` had no request deadline of its own beyond the shared 15 s fetch timeout, and its serialized body had no stale-response or cancellation guard.

A temporary harness in `/tmp` bundled the pre-change `appEntry.tsx` from `git show HEAD:...` with virtual React/App/account modules whose status promise never settles. After 200 ms the result was:

```
{"outcome":"blocked","events":["createRoot","check"]}
```

No render occurred. The new startup test records `["createRoot","render","check"]`, and `start()` settles while the fixture status is still pending. This is a harness ordering signal, not a hardware or browser timing claim.

## Change

- `appEntry.tsx` imports and renders `App` first, then starts the optional session check in the background with an 8 s timeout and an abort controller that is cancelled by the existing teardown.
- `account.ts` `checkCloudSession` accepts `{ signal, timeoutMs }`. The timeout starts when the serialized work runs, aborts the status request through the client, and races the request against the signal so a hanging credential or fetch cannot hold startup.
- Generation and controller guards drop late results from timed-out, cancelled or superseded checks. A newer check aborts the in-flight one. Module `sync`/`accountId` state is published only after activation and only while the check is current.
- Cancellation by the caller rejects with `AbortError` without setting the connection error flag. Timeouts and failures set `error` and keep unauthenticated startup state at `status: null`, `automatic: false`.
- `client.ts` forwards an optional signal on the status call. The per-request provider timeout remains 15 s; only the startup/focus checks add the 8 s bound.
- `CloudStartup.tsx` keeps the checking indicator but no longer captures global keydown. Focus/visibility rechecks are abortable and bounded. `cloud.css` renders the indicator as a small nonblocking status chip instead of a full-screen input blocking overlay.
- The OAuth callback branch remains before the app path and starts no app session check. The alpha authorization gate in `main.tsx`, engine initialization and delayed preset loading/sync behavior are unchanged.

## Verification

- PASS: 10 focused tests via `source wasm/scripts/env.sh` then `bash wasm/scripts/memcap.sh node --experimental-strip-types --test wasm/tests/node/cloud-startup.test.mjs`.
  - startup renders before the pending status request and teardown aborts it
  - callback route renders the callback component, strips the URL, and starts no app check
  - delayed success activates the account and honours the stored sync preference
  - stalled status times out, aborts fetch and leaves `status: null`, `error: true`, `automatic: false`
  - late response after timeout does not publish status or touch the preset journal
  - caller cancellation rejects without a connection error
  - superseded late response yields to the newer check
  - a check cancelled while queued does not leave `checking` stuck
  - unauthenticated status clears `activeAccount` and never enables automation
  - failed status reports an error with unknown account state
- PASS: 19 existing cloud tests via `node --experimental-strip-types --test wasm/tests/node/orca-cloud-sync.test.mjs wasm/tests/node/orca-cloud-gateway.test.mjs`, including browser identity, session isolation and same-origin credential behavior.
- PASS: app `tsc --noEmit` under `wasm/scripts/memcap.sh` after the final edit.

No integrated UI build, browser session, preview tool or hardware run was performed. No service, preview process, commit, branch, push, PR or deployment was changed. Private HTTPS 5065 / PID 592057 remains untouched.

## Files changed

- `wasm/app/src/appEntry.tsx`
- `wasm/app/src/orcaCloud/account.ts`
- `wasm/app/src/orcaCloud/client.ts`
- `wasm/app/src/orcaCloud/CloudStartup.tsx`
- `wasm/app/src/orcaCloud/cloud.css`
- `wasm/tests/node/cloud-startup.test.mjs`
- `wasm/reports/review-cloud-startup-20261111.md`

## Correctness follow-up — 2026-11-11

Implemented the four findings in `review-cloud-startup-correctness-20261111.md`.

- Persisted activeAccount alone no longer enrolls unlinked local edits. Successful session verification enables enrollment; existing linked records retain offline journaling and existing journal data remains intact.
- Session mutations pass cancellation into the production preset transaction. Checks run after lock/read and at durable write boundaries. An OPFS close already underway is restored to the prior envelope under the same storage lock before another transaction can observe it. Late network results cannot publish session state.
- Focus/visibility checks use passive mode and await the active explicit check without canceling login/polling. Passive callers retain their own deadline/cancellation.
- Explicit checks start their timer at invocation, abort superseded work immediately and do not wait in the account serial queue. All checks have a default 15-second bound; startup/focus retain 8 seconds. Logout invalidates active checks. Credential initialization cannot issue a late request after cancellation.

Regression evidence uses bundled production account/client/journal/preset storage, controlled fetch and OPFS deferred boundaries. Pending startup edits followed by confirmed logout or account switch retain no stale cloudRef. Durable activation delayed at createWritable or close past deadline/caller abort cannot leave enrollment in either OPFS or fallback storage. Passive focus preserves explicit login results; an unresolved check cannot block a bounded subsequent caller or leave checking stuck.

Red: `bash wasm/scripts/memcap.sh node --experimental-strip-types --test --test-name-pattern='passive focus' wasm/tests/node/cloud-startup.test.mjs` failed before the fix with AbortError on the explicit caller (1 failed).

Green: `bash wasm/scripts/memcap.sh node --experimental-strip-types --test wasm/tests/node/cloud-startup.test.mjs wasm/tests/node/orca-cloud-sync.test.mjs wasm/tests/node/orca-cloud-gateway.test.mjs wasm/tests/node/orca-cloud-native-pull.test.mjs` — 41 passed, 0 failed.

TypeScript: `./wasm/app/node_modules/.bin/tsc --noEmit -p wasm/app/tsconfig.json` — passed. No UI build, browser, services, commits or tracking changes.

Files changed in this follow-up: `wasm/app/src/orcaCloud/{account.ts,client.ts,CloudStartup.tsx,journal.ts}`, `wasm/app/src/presets/presetStorage.ts`, `wasm/tests/node/cloud-startup.test.mjs`, and this report. Parallel changes preserved.

## Parent offline enrollment correction

An already verified account now remains eligible for new preset journaling during a passive recheck and after a network timeout. Enrollment is revoked on confirmed logout/account change and explicit logout; fresh startup remains unverified. A production-store regression covers edits both during and after a failed recheck. All 42 cloud tests pass. TypeScript verification is currently awaiting the parallel Preview worker owner's literal-runtime-import typing correction.
