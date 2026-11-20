# Standalone Bambu account — 2026-11-18
Current private release: [Bambu session recovery](bambu-session-recovery-20261118.md) supersedes the rollout below and the original network-failure clearing behavior; prior verification remains historical evidence.


Help → Bambu Cloud account and mobile Menu → Bambu Cloud account work with zero saved printers. Email/password or email/verification code uses the existing global Bambu gateway login route. Password/code are transient and cleared after submission. Separate `weborca.bambu-account.v1` browser storage holds only access/refresh tokens and provider-supplied `expiresIn`/`refreshExpiresIn` deadlines. Missing expiry stays unknown; preference validation runs on load and focus/visible resume. Known access expiry schedules renewal while open. Established invalid sessions clear credentials and request sign-in. Transient network/gateway failures preserve the session for recovery; see the [superseding session recovery rollout](bambu-session-recovery-20261118.md). HTTP 401 permits one refresh/retry; known-expired requests refresh first and cannot refresh again on 401. Refresh is shared; generation and identity checks prevent logout/replacement races from restoring credentials. Cross-tab storage events invalidate pending work. MakerWorld prefers this account and retains the saved global printer fallback.

## Checks

- `npx tsc --noEmit` passed for the app.
- 13 focused tests passed across `bambu-account.test.mjs`, `bambu-cloud-client.test.mjs`, and `bambuCloud.test.mjs`. New mock-only tests cover zero-printer sign-in/download, restored expired account renewal, open-tab timer and resume, missing expiry, refusal, concurrent refresh and logout during refresh. Existing tests cover saved-printer behavior, gateway routes and bounded 401 retry. A temporary node_modules symlink supplied existing app dependencies for gateway tests and was removed afterward.
- All 22 locale catalogs pass. New English account messages use the existing translation fallback.
- Vite emitted the UI in 6.95s; its native packaging hook then failed on the pre-existing missing `wasm/build/runtime-identities/engine.json`. This is a compiled UI with retained native assets, not a qualified native release build.
- T3 preview actual browser at localhost:18974/models: zero saved printers, Help account form, mock-password sign-in, automatic renewal exactly once after a three-second mock provider expiry, MakerWorld default-profile resolution and intercepted CDN navigation passed. Password absent from account storage. Sign out then actual page reload remained signed out. Mobile 390×844 Menu opened the labelled account dialog; fields fit with no document overflow. Browser used an incognito tab, closed afterward; no real account credentials were used. Reload-expiry renewal is covered by module restoration tests, not a browser interception across navigation. Real provider renewal and completed CDN download remain unverified.
- Impeccable mechanical detector returned no findings for changed UI targets. `git diff --check` passed.

## Private rollout and rollback

Existing user service `weborca-models-preview-18974.service` now serves `wasm/build/bambu-account-candidate-20261118` via `70-bambu-account.conf`. The candidate copies the previous `makerworld-candidate-20261118`, overlays only compiled assets/index, and preserves runtime/bridge/config. Engine directories compare identical; bridge SHA-256 remains `631048e2244d068c7fec2012eeb1d60cfdf41fec2f3b0b5a602fdc006bda0f13`. Served index compares exactly to candidate. Public deployments were untouched.

Rollback: remove `~/.config/systemd/user/weborca-models-preview-18974.service.d/70-bambu-account.conf`, run `systemctl --user daemon-reload`, then `systemctl --user restart weborca-models-preview-18974.service`. The retained 60-makerworld override selects the previous immutable candidate. Existing runtime and gateway environment remain configured. No commits were made; earlier dirty changes remain.

Changed files in this task: `wasm/app/src/printers/bambuAccount.ts`, `BambuAccountDialog.tsx`, `bambuCloud.ts`; `wasm/app/src/shell/HelpDialogs.tsx`, `TopBar.tsx`; `wasm/app/src/mobile/MobileShell.tsx`; `wasm/app/src/models/ModelBrowser.tsx`; `wasm/app/src/App.tsx`; `wasm/app/src/locales/en.json`; `wasm/tests/node/bambu-account.test.mjs`; README and this/current MakerWorld report.

Canonical Taproot milestone `Adwtq0eMPUXD5m` is done with evidence under `models_local_20261117`; recursive completion audit found no expanded completed branches requiring collapse (the parent is already collapsed). Candidate index SHA-256: `fc790e4ab9beec905a5ce2087980cc9a63d0186e0e92e39b550634097cde5cbd`.
