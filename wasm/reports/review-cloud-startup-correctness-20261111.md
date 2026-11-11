# Cloud startup correctness review — 2026-11-11

Read-only review of the uncommitted cloud startup work in this shared worktree against `8e21361611`, branch `fix/weborca-review-followups`.

Scope: `wasm/app/src/appEntry.tsx`, `wasm/app/src/orcaCloud/{account.ts,client.ts,CloudStartup.tsx,cloud.css}`, `wasm/tests/node/cloud-startup.test.mjs`, and the preset sync/enrollment contracts in `sync.ts`, `journal.ts`, `presetStorage.ts`, `CloudDialog.tsx`, `CloudAutoSync.tsx`, `CloudCallback.tsx`.

Method: line-by-line trace of the changed paths and their callers, plus the focused existing test file. No source edits, builds, browser session, service, commits or tracking.

## Findings

### 1. High — local edits can be journaled against a stale enrollment before the background check confirms logout

`start()` now renders `App` before the session check (`appEntry.tsx:17-22`; the base awaited the check before importing/rendering `App`). The checking indicator no longer blocks input either: `CloudStartup.tsx:20` renders a chip and `cloud.css:16` sets `pointer-events: none`.

The durable envelope can still contain `cloud.activeAccount` from the previous session. Until the status response arrives (up to the 8 s deadline, longer when queued), any preset save/delete/rename runs `transactPresetStorage` → `journalLocalChanges`, which resolves the owner from `state.cloud.activeAccount` (`journal.ts:28`) and writes a `cloudRef` plus a dirty record (`journal.ts:31-40`). Only after the status response does `checkCloudSession` delete that stale `activeAccount` (`account.ts:99-101`), and it does not clear `cloudRef`s already written to presets.

Consequences when the server session is gone or now belongs to another account:

- Edits made in the window stay permanently linked to the old account. `backupLocal` skips any preset with `cloudRef` (`sync.ts:54`), so a later sign-in as a different account cannot back them up.
- If the old account signs in again, those edits are already dirty records under it and can be pushed as if they were made while signed in.
- The comment at `account.ts:74-75` ("A confirmed logout disables enrollment before editing resumes") is no longer true for startup. Keeping the journal on a network failure is still correct; the problem is allowing writes before the first bounded check settles.

Minimal fix: render immediately, but gate enrollment journaling until the first check settles. Add a module flag/awaitable such as `enrollmentChecked`, set in the check's `finally`, and make preset mutation paths wait for it (or have `journalLocalChanges` treat a stale persisted `activeAccount` as unconfirmed until the first status response). Do not delete `activeAccount` eagerly at startup; that would break the documented offline-retention behavior.

The test at `cloud-startup.test.mjs:268-282` only checks that a signed-out status clears `activeAccount`. It never performs an edit during the pending window, and the appEntry test stubs `./orcaCloud/account` entirely (`cloud-startup.test.mjs:55-60`), so the production interaction is untested.

### 2. High — an abandoned `activate()` can commit after the check has timed out or been aborted, leaving durable state and in-memory sync out of sync

`checkCloudSession` races activation with the check signal:

```
if (next) await untilAborted(next.activate(), signal);   // account.ts:105
if (!current()) throw abortError();                       // account.ts:106
sync = next; accountId = status.accountId;                // account.ts:107-108
```

`untilAborted` only rejects its waiting promise; it does not cancel `work` (`account.ts:57-66`). `createPresetSync().activate()` has no signal and writes `state.cloud.activeAccount = accountId` in a durable transaction (`sync.ts:43-44`). If the 8 s timer (`account.ts:91-92`) or an appEntry teardown abort (`appEntry.tsx:24`) fires while `activate()` is waiting for the preset lock or writing, the outer check rejects and its `finally` clears `checking`, but `activate()` continues and later commits.

Resulting state on that path: `activeAccount` is set in the durable journal, while `status` stays null/old, `error` is true (or the caller sees AbortError), and `sync`/`accountId` remain old or undefined. Subsequent local edits are then attributed to the account that was never published (`journal.ts:28`), and `cloudSync()` either throws or operates on the old account. A later successful check may repair this, but a canceled check, a failed follow-up, or teardown can leave the ghost enrollment behind. This is the concrete "mutates after timeout despite outer stale guards" case.

The same class of problem exists at `account.ts:99-101`: `await transactPresetStorage(...)` is neither signal-aware nor raced, so a stalled preset lock can keep the check pending past its deadline and still commit the deletion afterwards.

Minimal fix: do not race a non-cancellable mutation. Either await `activate()` to completion and, if the check is no longer current, `await next.deactivate()` (guarded by `activeAccount === accountId`, so it cannot clobber a newer account) before throwing, or add a signal/current-generation predicate to `activate()` and `transactPresetStorage` and check it immediately before the durable write. In both cases, reset `sync`/`accountId` to match the durable `activeAccount` on every aborted path.

The "late response after timeout" test (`cloud-startup.test.mjs:195-208`) does not cover this: it releases the status response after the timeout has already rejected, so `activate()` is never reached. There is no test where status resolves and the storage/activation work outlives the deadline or an abort.

### 3. High — a passive focus/visibility recheck rejects an in-flight explicit caller, stopping login polling and closing the OAuth popup

Every call increments `checkGeneration` immediately (`account.ts:77`), and any older check that subsequently completes treats itself as canceled (`account.ts:94,98,102,113`). Because the check body is serialized (`account.ts:78`), the older check normally completes first; the newer check has not even started yet. So a mere enqueue of another check reliably converts a successful older result into `AbortError`.

`CloudStartup` enqueues such checks on every focus/visibility event (`CloudStartup.tsx:8-13`). Concrete callers affected:

- Pending-login polling calls `checkCloudSession()` without a timeout (`CloudDialog.tsx:63-72`). Its catch at line 71 sets "Cloud connection failed" and never schedules the next poll, so a focus or visibility event during any poll permanently stops the poll loop while the login is still pending. The effect does not restart because `status.pending`/`accountId` did not change.
- `begin()` calls `checkCloudSession()` after opening the OAuth popup (`CloudDialog.tsx:91-105`). A superseding focus check (for example when focus returns to the app or another passive check runs) makes that call throw, and the catch at line 104 runs `tab?.close()`, closing the login popup.
- `authenticated()` (`CloudDialog.tsx:84-90`) and `CloudAutoSync` (`CloudAutoSync.tsx:17-25`) report "Cloud operation failed" / "Cloud auto failed" when their checks are superseded, even though the newer check succeeds.

This is a new ordering regression: the base had no generation guard, so the older caller's result was simply used. The startup report's claim that "A newer check aborts the in-flight one" (`review-cloud-startup-20261111.md:21`) is also not what the code does; because `activeCheck?.abort()` is inside the serial task (`account.ts:84`), it never aborts a live request. The supersede test (`cloud-startup.test.mjs:226-247`) manually releases both requests and does not assert any abort.

Minimal fix: reserve rejection for real cancellation. Coalesce `checkCloudSession` into one in-flight promise so passive rechecks await the same result, or add a `refresh`/`supersede: false` mode for passive checks that does not bump the generation used to reject explicit callers. Treat a superseded `AbortError` at the dialog call sites as retry/cancel rather than failure: restart polling and do not close the popup.

### 4. Medium — the 8 s deadline starts inside the serial queue, so a bounded check can wait indefinitely and leave `checking` on

The timeout is created only when the serialized body begins (`account.ts:78,91-92`). Earlier queued work — another check, `signOutCloud`, or an unbounded `checkCloudSession()` from `CloudDialog` (`CloudDialog.tsx:48,69,86`), `CloudAutoSync` (`CloudAutoSync.tsx:17`) or `CloudCallback` (`CloudCallback.tsx:14`) — delays the start of the deadline. A bounded startup/focus check queued behind a check that never settles never starts its timer.

That is reachable because `browserCredential()` awaits `navigator.locks.request` without a signal or timeout (`client.ts:26-44,46`), and the shared 15 s fetch timeout does not cover the credential/lock wait. If an unbounded dialog check is stuck there, a later 8 s check waits in `serial` forever; `checking` remains true from the stuck check and no status is published. Even in the ordinary case, an earlier 15 s request makes the "8 s" check start its deadline only after that request finishes.

The intended supersession abort cannot help: `activeCheck?.abort()` at `account.ts:84` can only point at an already-finished task because the queue is serial and the prior task clears `activeCheck` in `finally` (`account.ts:120`) before the next task starts.

Minimal fix: create the deadline and abort wiring synchronously at call time, before `serial`, and abort the previous controller when a check actually supersedes; move the `activeCheck` abort out of the serialized body (after fixing finding 2 so activation cannot be left running). Also make the credential lock acquisition signal-aware, or coalesce passive checks so one stalled check cannot occupy the shared queue. Cover a timed check queued behind a never-settling check and assert the timed caller settles and `checking` clears.

## Test coverage

The focused file passes: `bash wasm/scripts/memcap.sh node --experimental-strip-types --test wasm/tests/node/cloud-startup.test.mjs` — 10 passed.

Coverage gaps relevant to the findings:

- The appEntry ordering test uses a virtual `./orcaCloud/account` whose check never settles (`cloud-startup.test.mjs:55-60,108-129`), so it verifies render order but not the real enrollment/journal interaction.
- No test edits a preset while status is pending or timed out, which is the finding 1 boundary.
- No test resolves status before the deadline and then delays `activate()` past it or aborts during activation (finding 2).
- No test runs a focus/visibility recheck while a dialog-initiated check is in flight (finding 3).
- The timeout is only tested with an empty queue; the supersede test uses bounded checks that it resolves manually, and the queued-cancel test has nothing occupying the queue indefinitely (finding 4).

## Verification

- Read the diff against `8e21361611` for the scoped files and traced the sync, journal, dialog, auto-sync and callback call paths.
- Ran the focused existing cloud-startup test file; 10/10 passed, which is why the gaps above matter.
- No source edits, builds, browser, service, commit or Taproot updates were made.

## Files changed

- `wasm/reports/review-cloud-startup-correctness-20261111.md` (this report)
