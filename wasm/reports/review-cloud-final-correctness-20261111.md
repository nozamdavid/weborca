# Final correctness review: cloud startup (2026-11-11)

Scope: `account.ts`, `client.ts`, `CloudStartup.tsx`, `journal.ts`, `presets/presetStorage.ts`, `appEntry.tsx` against `8e21361611`. This was a read-only review of the code. I ran no tests, builds or services.

## The four prior defects are resolved

1. **Unverified persisted `activeAccount` enrolling edits.** `journalLocalChanges` (journal.ts:277) uses `activeAccount` only when `enrollmentVerified` is true. That flag is set true only at account.ts:120, after status and activation succeed for the current check. Logout and every check start reset it to false.
2. **Canceled or timed-out transaction reactivating.**
   - `transactPresetStorage` checks the signal after the read, after `handle()`, after `stream.write` and before the localStorage write. An abort during `close()` is caught by the post-write `throwIfAborted`. The catch then restores `original` through `write(original)` under the same `lock()`. The module queue and `navigator.locks` keep concurrent transactions from observing or overwriting the interim state.
   - A rollback after the OPFS commit writes a new `updatedAt` of at least `original.updatedAt + 1`. Because the failed write never reached localStorage, `read()` picks the rollback.
   - A stale result cannot publish: every step after an await is guarded by `current()`, and `sync` and `accountId` are assigned only after that check.
3. **Passive focus canceling explicit login.** The passive path joins `activeResult` with its own deadline and signal, and it does not abort `activeCheck`. When no check is active, a passive call starts a normal check.
4. **Deadlines and `checking`.** The timer starts at call time, and checks no longer pass through the serial queue. `finally` clears `checking` only for the current generation, and logout clears it directly.

Logout, callback and offline-journal paths are otherwise unchanged. Rollback is safe against concurrent edits because it runs inside the transaction lock.

## Concrete bug found

### 1. `enrollmentVerified` is a single global flag that is cleared at the start of every check and never restored on failure

Locations: `account.ts:90` (`verifyCloudEnrollment(false)` on every non-joined check) and `account.ts:120`, which is the only place it is set true again.

Repro A (failed recheck):
1. Sign in and complete a successful check. Enrollment is now verified.
2. Go offline, or hit a gateway timeout.
3. Focus the window, so a passive check runs and fails.
4. Create or edit an unlinked local preset.

Result: `owner` is undefined, so `p.cloudRef` is never set and no record is journaled. After reconnect the preset never syncs. The user stays signed in, and `useCloudAccount.status` and `sync` still describe the verified account. Only presets that already have a `cloudRef` keep journaling. The old `activeAccount` check journaled these edits.

Repro B (in-flight recheck): focus or visibility triggers a check that can run up to 8 s on a slow gateway. A save of an unlinked preset in that window is not enrolled, and it is not retried because the journal only runs on change.

Minimal fix: scope the unverified state to unproven sessions. Keep the verified flag across rechecks and clear it only when:
- the check ends with `status.accountId` null or different from the module's `accountId`, or
- logout runs, or
- the page starts (the default).

In `account.ts`, remove line 90's `verifyCloudEnrollment(false)`. After `status` returns at line 104, call `verifyCloudEnrollment(false)` if `status.accountId !== accountId`. Keep line 120's `verifyCloudEnrollment(true)`. A failed check then keeps the earlier verification for the same account, and a first-ever startup check stays unverified until success, as intended.

## Minor note (not a required fix)

`checkCloudSession` no longer goes through `serial()`, but `signOutCloud` still does. An explicit check started after `signOutCloud()` begins (for example from `CloudAutoSync`) is not aborted. It can set `sync` and `accountId` between the logout transaction and `logout()` resolving. The next status poll corrects this. If it is fixed, make `signOutCloud` track a `loggingOut` flag that makes `checkCloudSession` reject until the logout completes.

No files were changed except this report.
