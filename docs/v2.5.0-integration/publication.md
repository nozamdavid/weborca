# v2.5 CURRENT5070 publication — 2026-11-07

Superseded by the [combined startup publication](startup-publication.md), which
retains this exact v2.5 release/server as its rollback. This report records the
original 14:04 publication and its historical rollback procedure.

Published at **14:04:56 UTC** to <https://server-1.barbel-hops.ts.net:5070/>.
Service PID **2493964**, invocation `0ca824543e324e5ab7e5c2fbdb7515ef`.
The release is `/mnt/appdata/workspace/OrcaSlicer/wasm/build/ui-v250-release-20261107`,
a byte-identical, recursively nonwritable copy of the accepted gated candidate.
No rebuild, commit, push, main promotion, printer or provider operation occurred.

## Exact inputs

Source worktree `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`, branch
`t3/merge-upstream-v250-foundation`, signed checkpoint
`77a15ff9238d9b9404b1da4256a575929380401e`. Candidate and input selection are
recorded in [browser integration](browser-integration.md) and [summary](README.md).
Engine S2, frozen Preview, patched STEP, both LGPL notices, all 72 vendor packs
and matching settings/layout travel together. No fallback to older modules.

| Manifest/input | SHA256 |
| --- | --- |
| `wasm/build/v250-browser-integration/candidate.sha256` | `d666a64185fbe5801c8a6f955fa10e708672cd7d792c7b8fff863ac0e32089d8` |
| `wasm/build/v250-browser-integration/input.sha256` | `a67c9fca29a99079289ea919bff7f3d7e8922dcc975e0459fbfd92142e85290d` |
| `wasm/build/v250-publication/release.sha256` | `ff43e2698abae56cd3e1d036cfdfff59427137a29f3611d95ddb31aa2723068c` |
| Frozen `tests-alpha-design-20261107/server.mjs` | `77b7fd311a1b93e62b3744501833c50f91131ffec42ce0674b93d1877cb442bd` |
| `alpha-access.mjs` | `e494215b41778d29d1dd1422d16fa6f53a71b8f14b514be393c87c74f66f0ca2` |
| `printer-cloud-bridge.mjs` | `a234159faa76dcd54734e0f738f2046c01b87e87c602fcd9007c3b959f4444d6` |
| `orca-cloud-bridge.mjs` | `3622ef1e37d3665500f2ed89f2784347b8420e1dbd0745f03cd2def4a872b3fc` |
| `octoeverywhere-bridge.mjs` | `ae2ed425c9aa27bee0a6cad1a5515d3d5f0cba8447ece1d72e888f4d14756b34` |

Evidence is local ignored data under `wasm/build/v250-publication` in the
integration worktree. Release manifest paths point into the original checkout.
The four backend bundles compare byte-identical to the incumbent background
release, retaining provider and HTTP201 behavior. Frozen server bytes match.

## Activation and verification

`release.sh --check` passed before activation. The sole installed change is
the root-only `v250.conf`, installed as
`~/.config/systemd/user/weborca-tailscale.service.d/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-v250.conf`.
Existing service/Tailscale configuration, private env, durable alpha file,
providers, callback settings and caps 512 MiB/swap0/CPU100%/Tasks64 remain.
The password/state file hashes matched immediately after restart; modes remain
600. Existing units and Tailscale routes compare unchanged. No secrets are
included in reports. Restart invalidates RAM admin/OrcaCloud sessions; durable
tester sessions/invites and browser presets/storage retain their paths/origin.

All heavy checks used the shared `tests-mobile-polish/qa/run-capped.sh` runner,
serialized with 2 GiB, swap0 and Tasks128. Logs are in that runner's original
checkout directory; scripts/results are in integration `wasm/build/v250-publication`.

| Runner label | Accepted result | Peak bytes |
| --- | --- | ---: |
| `v250-publication-activate` | Bounded readiness, health, public bootstrap bytes, protected assets/backend denial and isolation | 45871104 |
| `v250-public-auth` | Private-env admin launch/expiry/cookie, app/admin separation, exact protected bytes, logout/revocation; tester login/access/admin denial/revocation | 121458688 |
| `v250-public-browser-r3` | HTTPS desktop1280/mobile390 startup, slicing/Preview, desktop STEP append, logout | 1100738560 |

All accepted runs exited 0, with zero swap and task-limit events. Public checks
compare HTML/main JS, engine JS/WASM, STEP pair/notices, both Preview aliases,
catalog/resources, both layouts and worker bytes. COOP `same-origin`, COEP
**require-corp**, no-store, Secure/HttpOnly/Strict cookies and hidden backend
files pass. Unauthenticated protected requests return 401; authenticated backend
file requests return 404. Original durable invites/sessions compare unchanged;
one clearly labeled **revoked QA invite** remains as an audit record.

Public browser contexts block provider/printer/external routes. Each viewport
requests one engine and zero catalog directories before Add printer; shell
navigation/Preferences complete before the held actual engine response. Both
real slices produce **383170 bytes / 100 Preview layers**, matching local
candidate acceptance, with zero page errors. Desktop imports real STEP via the
production dialog and appends a named second geometry object. Evidence includes
`public-startup-results.json` and desktop/mobile waiting/Preview captures.
Local full STEP slicing/cancel/retry and gated durable-recovery acceptance remain
bound to the same immutable candidate in [browser integration](browser-integration.md).

Initial browser attempts retain logs: R1 lacked the worktree Playwright dependency;
the harness now resolves the existing original-checkout installation. R2 reached
desktop slicing but compared native BigInt layers against Number; R3 normalizes
that evidence value. These harness-only corrections required no product rebuild.

## Exact rollback

From any directory:

```sh
bash /home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/v250-publication/release.sh --rollback
```

The script verifies candidate/release, retained previous release, frozen server,
prior units and routes, removes only its byte-identical matching override,
restarts and verifies the previous gated background-engine release. Readiness
is limited to 20 requests with two-second HTTP timeouts. Failed activation
automatically rolls back. The prior root remains
`/mnt/appdata/workspace/OrcaSlicer/wasm/build/ui-background-engine-release-20261107`.
Rollback preserves the current private durable state, including subsequent user
activity; it never restores an old state snapshot. Rollback was not needed.

## Limits and tracking

Chromium/SwiftShader and emulated mobile acceptance do not qualify physical
mobile/Safari, hardware GPU performance, printers or real providers. Firefox
fails before module load under the existing task cap. Same-source native/WASM
toolpath parity and native OCCT8 parity remain open; legacy differences were
retained. New belt, IMEX, mixing/Hybrid and other upstream feature UI workflows
remain unqualified. No broad reruns or increased caps were used.

Taproot readback confirms version **83 → 84**, completed/collapsed publication
milestone `v250_publication_20261107` and updated root/shipped pointers.
Main promotion and all existing qualification work remain pending. The first
update was rejected before mutation because accumulated root notes exceeded
the server's 20,000-character limit; the successful update uses a concise root
pointer and retains previous root notes in `taproot-tree-before.json`.
Tracking receipts are in `wasm/build/v250-publication/taproot-*.json`.
