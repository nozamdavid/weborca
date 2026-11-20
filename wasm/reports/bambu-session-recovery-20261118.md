# Bambu session recovery — private rollout, 2026-11-18

Private `weborca-models-preview-18974.service` now serves `wasm/build/bambu-session-recovery-candidate-20261118` via `90-bambu-session-recovery.conf`. Existing `80-makerworld-relay.conf` remains byte-identical. No commits or public deployment. Existing dirty work is preserved.

The supplied fix in `wasm/app/src/printers/bambuAccount.ts` and existing `wasm/tests/node/bambu-account.test.mjs` preserves stored sessions on transient network/gateway failures. Only established invalid sessions clear credentials; model permissions do not establish account expiry. This supersedes the earlier standalone account report's statement that network failures clear sessions. Existing relay functionality remains packaged unchanged.

## Build and validation

Commands from repository root (logs in [evidence](bambu-session-recovery-20261118/)):

```sh
cd wasm/app
npm run check:locales
npx tsc --noEmit
npx vite build --config vite.session-recovery.config.ts --outDir ../build/bambu-session-recovery-ui-20261118
cd ../..
node --experimental-strip-types --test wasm/tests/node/bambu-account.test.mjs wasm/tests/node/bambu-cloud-client.test.mjs wasm/tests/node/makerworld-relay.test.mjs
bash wasm/reports/bambu-session-recovery-20261118/rollout.sh
```

All 22 locale catalogs and TypeScript passed; 14 tests passed, including four account tests. One integrated UI batch built in 7.32 seconds, with Vite's bundle-size warning. Temporary config imported the original and filtered only `orca-assets-plugin`:

```ts
import original from './vite.config';
import { defineConfig } from 'vite';
export default defineConfig(async env => {
  const config = await (original as Function)(env);
  return { ...config, plugins: config.plugins.filter((plugin: any) => plugin?.name !== 'orca-assets-plugin') };
});
```

The temporary config was removed. Native packaging was deliberately skipped because of the pre-existing missing `wasm/build/runtime-identities/engine.json`. This rollout retains the base's native qualification limits.

[Rollout commands](bambu-session-recovery-20261118/rollout.sh) copy the entire immutable `makerworld-relay-candidate-20261118-r2`, overlay only generated assets and index, and preserve every old hashed asset. Sorted SHA-256 manifests for every non-index/assets file compare exactly; old assets pass `sha256sum -c`. [Verification commands](bambu-session-recovery-20261118/verify.sh) and [results](bambu-session-recovery-20261118/rollout.log) record the served checks. Service is active. One initial connection refusal during restart was recovered by curl's configured retry.

Actual HTTP requests use loopback transport with canonical Host `server-1.barbel-hops.ts.net:18974` and Origin `https://server-1.barbel-hops.ts.net:18974`. `/`, `/models`, `/prepare`, `/preview` equal the candidate index byte for byte. The index's referenced entry bundle equals candidate bytes. Those routes, the entry asset and `/engine/orca_engine.mjs` have no Clear-Site-Data header; loader bytes also match. Canonical `/_printer/status` returns 200 with Bambu enabled. Relay rejects foreign destination (400), foreign Origin (403), and foreign Host status request (421).

SHA-256:

- Index and served index: `39515591b684f6efd26b41e3deb6c6afac6462397a80b605273e25c36aa69e48`.
- Entry `assets/index-C0pX-Y3H.js` and served bundle: `6e8ab978e58e503f54abcdf6323275f2c49c3bcf9d40af957500bd5885311d31`.
- Retained `printer-cloud-bridge.mjs`: `708cb015be444c2b9709ba31ddae570d275cf6ba3d98f14bbd045c047dac00c7`.

T3 preview verification on the canonical HTTPS origin used an incognito tab. The page loaded `assets/index-C0pX-Y3H.js`; browser fetch SHA-256 matched the index and bundle hashes above. `/models`, `/prepare`, `/preview`, the entry bundle, `/engine/orca_engine.mjs` and `/_printer/status` all returned 200 without Clear-Site-Data. The native loader hash was `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7`. The tab was closed afterward. No browser storage or account tokens were read, and no service environment secrets were accessed. Successful live provider renewal/CDN delivery remain unverified. The authorized Taproot token was used without printing it.

## Rollback

Run from any directory:

```sh
rm ~/.config/systemd/user/weborca-models-preview-18974.service.d/90-bambu-session-recovery.conf
systemctl --user daemon-reload
systemctl --user restart weborca-models-preview-18974.service
```

This restores the retained 80 override and relay r2 candidate. The rollout installed an error trap executing this rollback on failed service/HTTP verification; verification passed, so rollback was not invoked. Both immutable releases remain available.

Canonical Taproot completed milestone `bNbtzA6Ax90u7Z` was added beneath `models_local_20261117` with evidence. Completion/collapse audit across the project found zero expanded branches whose children are all complete; Models parent is already collapsed. README and prior standalone account/byte-relay reports point here.
