# Untouched-session recovery fix

Published **2026-11-07 15:03:59 UTC** to
<https://server-1.barbel-hops.ts.net:5070/>; public acceptance finished
**15:05:18 UTC**. PID **2815051**, invocation
`1371f2ebc7a5462a94d395cdf3434ccd`.

Worktree: `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`.
Existing dirty startup/cache/viewer code and documentation were preserved.
No delegation, native rebuild, commit, push or main change occurred.
Original/worktree AGENTS instructions and the diagnosing-bugs skill were read;
no applicable CONTEXT or ADR was found.

## Cause and narrow change

The production writer treated the presence of a saved user preset as unsaved
work, even when `currentConfig` exactly equaled `presetConfig`. After startup,
native plate hydration replaces an absent `filamentMaps` with `[]`; the plate
subscription marked this dirty and scheduled the first write after 500 ms.
Forced alpha cleanup independently reached the same writer, including when
periodic autosave was disabled. Both paths could save an untouched empty scene.
Native geometry serialization was not responsible: this writer exports a 3MF
only when objects are present.

The writer now compares empty scenes with a baseline captured after startup
preset and native scene hydration, before readiness enables editing. Empty
filament maps compare consistently. Settings/preset/plate changes after startup
still count, including settings-only projects and deleting the last model.
Backup ownership is recorded after a successful write or restore, so returning
to the original empty state can retire that session's previous geometry backup
without deleting an older unanswered recovery.

Legacy records are retired only when they have zero objects, **no project
bytes**, complete saved baseline settings, matching preset selections, and
settings/plates equal to the hydrated startup state. Empty native archives,
incomplete or ambiguous records, and differing settings remain offered.
Byte-free legacy offers wait for readiness to establish that proof.

`appEntry.tsx` is unchanged: forced cleanup still ignores the autosave preference,
waits before unmounting, retains blocked memory on busy/failure for retry, and
preserves an unanswered valid recovery. Startup cancellation is checked around
the additional hydration await.

## Evidence

Ignored evidence is `wasm/build/v250-empty-recovery` (`OUT`) in this worktree.
All heavy runs used the original serialized `tests-mobile-polish/qa/run-capped.sh`
with **2 GiB, swap0, Tasks128, two CPUs**. Logs remain in that original checkout.

- Before editing, `v250-empty-red-preset` failed at the real production
  `window.__autosave.writeAutosave()` seam: **true instead of false**, zero objects,
  remembered process, no config differences. The initial default-preset control
  passed. The native-map difference was isolated with a targeted browser probe.
- The retained `OUT/check-normal-regression.sh` selects an immutable artifact via
  `ORCA_TEST_ROOT`. `v250-empty-normal-before`, against the exact previous release,
  fails the normal-refresh assertion with **one recovery dialog instead of zero**.
  `v250-empty-normal-after`, against the final candidate, passes the identical
  scenario and forced-cleanup check. No source or output mutation is involved.
- `v250-empty-autosave-final`: existing Chromium autosave suite passes, including
  remembered startup, redundant legacy record, disabled/enabled interval,
  settings-only restore, geometry/notes restore, writer cancellation, Escape,
  deleting the last model, named/locked multi-plate settings and Discard.
- `v250-empty-node`: **23/23** alpha UI and background-engine tests pass.
- `v250-empty-focus-local` and `v250-empty-activate-public`: **1280/390 px** pass
  untouched refresh, interval/equivalent config hydration, remembered preset,
  admin navigation, logout, rejected-session expiry, real geometry plus notes
  restore, unanswered recovery through another gate closure, denied IndexedDB,
  blocked scene retention and successful Retry. Public recovery retains
  **1 object / 11053 bytes** and the edited notes on both viewports; zero page errors.
- `v250-empty-cache-local` and public acceptance reuse the previous cache/early
  Prepare harness: visible early bed/grid, camera before readiness, native action
  gating, bounded percentages, **4243909 compressed / 17139421 decoded bytes**,
  warm authorization HEAD with **zero WASM requests**, revoked-cache denial and
  real slice/Preview **383170 bytes / 100 layers** on both viewports. Public
  restored-scene captures were visually inspected.

Four incremental builds correspond to the changed source batches; final
`candidate-gated-r4` was reused for all later retries and deployment. TypeScript
and all 22 locale checks pass. The first candidate exposed empty-map inequality;
the legacy-record check subsequently exposed property-order inequality. The
final existing-suite retries corrected two obsolete test locators (hidden Cancel
and the confirmation container), without rebuilding product code.
Final build peak **2144235520 bytes**; public activation/QA peak **1357729792**;
all runs have swap0 and zero task-limit hits. Debug probes are confined to
`OUT/debug`; no production debug instrumentation remains.

## Exact release and rollback

Release: `wasm/build/ui-v250-empty-recovery-release-20261107`, recursively
nonwritable and byte-identical to the final candidate. Exact S2 engine, frozen
Preview, patched STEP/notices, profiles and settings are reused from the
[startup publication](startup-publication.md). All four backend bundles compare
identical to that release. The frozen source server remains SHA256
`08015d5420821522bfa9838b581cd7b4f9d192e425b5ef71a7de92bf72efe2a4`.

| Manifest | SHA256 |
| --- | --- |
| `OUT/input.sha256` | `ad6ccd290a126a666a551a79d88e778b0fa0b37ef6babe978fda30adbead35d4` |
| `OUT/candidate.sha256` | `ac47355a6da4517e485991ac6e10100c5da303558a9cfa67ffd0431bd5ff1e36` |
| `OUT/release.sha256` | `ad07096844b410c03c0cb9aa824ea959465d6e20f219e411ca46361e7b05c4c6` |
| `OUT/previous.sha256` | `1bedc841a33df8a0e544c3d0b09072f2f2bd37afc335382d87024ef2848f35eb` |

The sole installed change is the lexical-last override recorded in
`OUT/override-path.txt`, ending `-v250-empty-recovery.conf`. Previous units and
Tailscale routes compare unchanged. Runtime provider settings, private env and
durable alpha state match before/after; private modes remain 600. Service caps
remain 512 MiB/swap0/CPU100%/Tasks64. Public exact-byte auth checks pass, including
admin/app separation, Secure/Strict/HttpOnly cookies, COEP **require-corp**, engine
metadata/cache exceptions, backend protection and logout/revocation. No durable
invite, printer or provider action was performed.

```sh
bash /home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/v250-empty-recovery/release.sh --rollback
```

This removes only its matching override, restores the exact previous
`ui-v250-startup-release-20261107` with `v250-startup-publication/server.mjs`, and
checks the root, runtime settings, manifests, routes and public protection.
Readiness is bounded to 20 requests with two-second HTTP timeouts. Activation
or public QA failure invokes rollback automatically; none was needed. Current
durable state is retained, never restored from a stale snapshot.

## Changed files and limits

Assigned source/test changes:

- `wasm/app/src/shell/autosave.ts`
- `wasm/app/src/shell/RecoveryDialog.tsx`
- `wasm/app/src/store/appStore.ts` (startup baseline only; prior edits retained)
- `wasm/tests/app/autosave.mjs`

Documentation: this report, root `README.md`, and this directory's `README.md`.
Taproot milestone/readback receipts are in `OUT/taproot-*.json`.
Readback confirms **version 85 → 86**, completed/collapsed milestone
`v250_empty_recovery_20261107`, current root/shipped pointers, and no expanded
branch whose subtasks are all complete. Open qualification statuses are retained.

Chromium/SwiftShader and emulated mobile qualify these sampled workflows.
Expiry uses backend rejection/focus and the existing synthetic timer test;
public sessions were not held for their entire lifetime. Opaque legacy project
bytes remain recoverable. Physical mobile/Safari, Firefox, hardware performance,
provider/printer lifecycle, upstream feature qualification and native parity
retain their previous open status. Restart resets RAM admin/Orca Cloud sessions;
durable user state retains its existing paths.
