# Paint-exit publication

Published 2026-11-07 17:07:46 UTC at https://server-1.barbel-hops.ts.net:5070/.
Live immutable root: `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/v250-paint-exit/candidate`.
Source baseline is the existing integration worktree at that path's repository root.

Only the paint-exit patch from the root checkout was applied to
`wasm/app/src/plate/PlateView.tsx`; its existing early-viewer changes were retained.
The focused `wasm/tests/node/prepare-painted-exit.test.mjs` was added.
Prepare reads color overlays across volumes, merges object-local geometry and uses
current filament colors after leaving painting. Existing newer recovery, startup,
cache, progress and background engine source remains intact.

Evidence: `wasm/build/v250-paint-exit` in the integration worktree. `paint.patch`
and `plate-before.diff` record the exact addition and prior edits. One integrated
build (`build.log`) passed TypeScript and 22 locale catalogs. `input.sha256`
records native/data/source inputs; `input-after-build.log` verifies them.
`node.log`: 8/8 focused paint, background-engine and engine-assets checks pass.
`candidate.sha256` and `immutable-check.log` retain the immutable artifact manifest.
No native rebuild occurred. Engine, both Preview locations, STEP and backend
bundles compare byte-identical to the shipped empty-recovery root. The build also
compared frozen native inputs, profiles and settings directly. `previous.sha256`
retains every previous release file hash.

Local `empty.log` passes desktop/mobile untouched refresh, interval/preset hydration,
admin/logout/expiry, real geometry/settings recovery, unanswered backup and denied
backup/retry checks. `cache.log` passes both widths: early camera, bounded percent,
cold compressed transfer, warm authorized HEAD with zero WASM requests, revoked
cache denial and real slice/Preview.

`acceptance.log` and `deploy.log` record actual framebuffer samples on the painted
facet: [248,221,93,255] during paint, Prepare selected, deselected and re-entry.
Public harness asserts yellow at every stage. Local and public slicing produces
1,627,681 bytes, 100 layers and T0/T1 commands. Local `preview.png` was visually
inspected in Filament mode; blue base and yellow painted regions are visible.
`public/` contains the corresponding public captures. Public authenticated exact
bytes, health, authorization separation, engine cache/version headers, COEP,
backend protection and logout/revocation all pass. Durable invites were unchanged.

Deployment adds only the lexical-last root override in `override-path.txt`.
`release.sh` guards candidate/previous manifests, prior overrides, routes, frozen
server and runtime environment, and automatically rolls back on activation or
public acceptance failure. The retained frozen server is
`wasm/build/v250-empty-recovery/server.mjs`. Private alpha environment hash,
provider settings, routes and caps compare unchanged; durable state was retained.
No rollback was needed. `runtime.txt` records PID/invocation and limits.

Rollback command:

```sh
bash /home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/v250-paint-exit/release.sh --rollback
```

It removes only its matching root override and verifies the exact previous
empty-recovery root with the same frozen server and current durable state.
Restart resets in-memory sessions. No commit, push or delegation occurred.

Limits: Chromium software GPU; physical GPU, Firefox/Safari and multi-volume
browser painting remain unverified. Synthetic multi-volume merging is covered by
the focused regression. Existing native parity and provider qualification limits
remain open. Shared preview automation could not connect; the existing requested
Playwright acceptance harness supplied the browser evidence. Candidate was never
rebuilt or modified after verification.
