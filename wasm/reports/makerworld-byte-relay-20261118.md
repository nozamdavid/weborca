# MakerWorld byte relay — 2026-11-18
Current private release: [Bambu session recovery](bambu-session-recovery-20261118.md) preserves transiently interrupted sessions, superseding the earlier network-clears-session behavior. It retains this relay bridge and all native assets; the 80 override remains for rollback. Deployment details below describe the preceding release.


Open in slicer resolves the default profile with the existing Bambu account flow, POSTs its signed URL to `/_printer/bambu-cloud/api/v1/design-service/model-bytes`, and hands a ZIP-checked `.3mf` File to `requestImportFile`, the desktop File → Import handler. This retains normal native import decisions/prompts without bypass flags. Prepare selection uses App's shared desktop/mobile tab callback. Download 3MF remains available. Transfer failures leave controls available to retry; engine readiness/loading/slicing is checked before import.

The route reuses Bambu opt-in and the deployed server's canonical Host/Origin guard. Only HTTPS `makerworld.bblmw.com`, default port, `/makerworld/model/... .3mf` paths (without the space), no credentials/fragments or encoded/traversal paths are accepted. Signed query bytes are retained in the body and outbound CDN request only. Fresh CDN headers contain only Accept; no account bearer, cookie or inbound headers are forwarded. Redirects are rejected. The gateway streams with backpressure, caps declared and actual bytes at 100 MiB including unknown lengths, bounds POST bodies at 16 KiB and total time at 60 seconds, aborts on downstream disconnect, and sends `no-store`. Errors never echo upstream URLs. Partial stream failures terminate the response; client timeout is 65 seconds. No signed URL logging or caching was added.

## Validation

- 12 tests pass: `node --experimental-strip-types --test wasm/tests/node/makerworld-relay.test.mjs wasm/tests/node/bambu-cloud-client.test.mjs wasm/tests/node/bambu-account.test.mjs`. Tests cover normal bridge bytes with mock HTTPS transport, fresh CDN headers, redirects, exact destination guard, unknown-length size bound, private client POST and File bytes, plus prior account/login/renewal behavior. [Output](makerworld-relay-20261118/makerworld-relay-tests.log).
- Five existing Bambu gateway tests pass using a temporary root node_modules symlink to app dependencies, removed afterward. [Output](makerworld-relay-20261118/makerworld-gateway-tests.log).
- `npx tsc --noEmit`, all 22 locale catalogs and Vite UI compilation pass. `npm run build` fails afterward on the pre-existing missing `wasm/build/runtime-identities/engine.json`; this is not a qualified native rebuild. Hosted bridge compiles with esbuild (Node 20 ESM; existing createRequire banner and optional websocket externals).
- Deployed route returns 400 for foreign destination and 403 for foreign Origin. Served index SHA-256 matches candidate. Native engine directory compares identical to preceding candidate. `git diff --check` passes.
- T3 preview status/open used an incognito profile with no saved user credentials. Page-local fetch fixtures supplied mock login/metadata and substituted bundled `OrcaBadge.3mf` for byte delivery. Desktop Open in slicer selected `/prepare`, imported three objects and visibly rendered the badges on Plate 1. At 390×844, simulated HTTP 502 displayed retry text and re-enabled controls, with no horizontal overflow. Retrying with the fixture selected mobile Prepare and showed six objects (second import). [Mobile evidence](makerworld-relay-20261118/mobile.png). This verifies real UI/native file import with controlled data; it does not verify live CDN/account delivery or an import prompt particular to another project's contents.

## Private deployment and rollback

`weborca-models-preview-18974.service` is active with `80-makerworld-relay.conf` selecting `wasm/build/makerworld-relay-candidate-20261118-r2`. It overlays compiled UI and bridge on the prior `bambu-account-candidate-20261118` and retains its native assets. Initial candidate remains retained; r2 adds request-body timeout cleanup. Browser UI bytes are identical across these candidates; final bridge focused checks pass.

Rollback from repository root:

```sh
rm ~/.config/systemd/user/weborca-models-preview-18974.service.d/80-makerworld-relay.conf
systemctl --user daemon-reload
systemctl --user restart weborca-models-preview-18974.service
```

The retained `70-bambu-account.conf` selects the preceding private candidate. No public deployment or commit. Final index SHA-256 `24ec65e8ca30d8888f6f90d6638bb49b97420e2d94bd8f130d55b29e60bc9e21`; bridge `708cb015be444c2b9709ba31ddae570d275cf6ba3d98f14bbd045c047dac00c7`.

Live successful MakerWorld delivery and renewal remain unverified. Timeout/disconnect cleanup is implemented but not tested with a full 60-second stalled transport. Native runtime source qualification remains inherited. No real secrets or saved credentials were accessed; only the authorized Taproot tracking token was used. [Desktop evidence after both fixture imports](makerworld-relay-20261118/desktop.png).

Canonical Taproot milestone `ZE9UF60wPLdlDg` is done with this evidence under `models_local_20261117`. Recursive completion audit found zero completed expanded branches needing collapse; the Models parent remains collapsed.

Changed by this task: `gateway/bambuCloud.ts`, `src/printers/bambuCloud.ts`, `src/models/ModelBrowser.tsx`, `src/App.tsx` under wasm/app; `wasm/tests/node/bambu-cloud-client.test.mjs`, new `makerworld-relay.test.mjs`; README, this report and evidence. Prior dirty work is preserved. No C++ GUI changes.
