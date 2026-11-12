# Docker packaging preparation — 2026-11-11

Final result: **PASS, built/pushed/deployed** with gate disabled. See [Docker and Arcane publication](docker-arcane-publication-20261111.md) for the successful image/digest, minimal Dockerfile ignore correction, browser/HTTP acceptance and rollback. The preparation notes below describe the earlier state; their pending actions are completed by that publication receipt.

Prepared and verified the isolated, ignored context `wasm/build/docker-package-dc7c38f183` from `git archive dc7c38f183d21b625c2524efab6538da9b260830`. Final Docker build is pending confirmation of the production `VITE_ALPHA_GATE_ENABLED` build argument by the Arcane discovery owner. No image was built, pushed, or deployed; no container was created. No default build tree or existing preview service was modified.

Docker daemon is available (29.8.0). The running staging container uses `dmarcosm/orcaweb`, its packaged server runs as `node`, and it exposes port 8932. Only selected image metadata and the two gate environment variable names were inspected; secrets were not captured. Neither gate variable is present, and the old image lacks `/app/dist/alpha-access.mjs`. This suggests a disabled gate but does not establish the intended build flag for the new deployment. The checked-in Dockerfile defaults to `VITE_ALPHA_GATE_ENABLED=0`.

`compose.staging.yaml` defines only `web`, built with target `web` from `wasm/deploy/Dockerfile`. It requires no additional gateway image. Actual Arcane configuration remains the discovery owner's responsibility.

## Qualified inputs

The context contains committed source only, plus explicitly copied runtime inputs. Its native source fingerprint is exactly `6b861c25f9246e7abdb92b5079527816a5423c7888c9da17cd4a7ef065535635`. Qualified engine and Preview pairs/manifests were copied from `wasm/build/review-preview-native/wasm/{engine,preview}` into the Dockerfile's expected default paths within this context only. STEP came from `wasm/build/review-step`, including both nonempty license notices and its manifest. All three existing identity receipts were copied unchanged.

All three original manifests passed verification with actual `prefix-review` and `prefix-review-occt` dependency inputs. All three context manifests then passed verification against the archived source and copied identity receipts. No manifest was generated or relabeled. Verification logs and manifest hashes are in `wasm/build/docker-verification-dc7c38f183/` (ignored local evidence).

| Runtime | JS/MJS SHA256 | WASM SHA256 |
| --- | --- | --- |
| engine | `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7` | `ad970ff002e908008cf77a0cc8b8bc31819c61c6e367a8a3e37930e0f9ef4dab` |
| Preview | `6e55011e44a53fdbad7f9aae704d82e95ce6a4bb92b5eefc7de1bdfc55402b71` | `7107d91b30c12a132da3e702af19acd3f9977cff1052022e41c28e7ec8db5976` |
| STEP | `ae275fd99181db06e7c3d6d6d8c78fc012b10781009f5cff76e9c4fd0b876423` | `a97f5444cf5cee49c1e2cfa8a58bc0b7c2dc53eb27b25350daa6a7eada1117aa` |

Profiles and settings were copied from qualified defaults. Recursive profiles comparison and byte comparison of `settings/layout.json` against frozen `wasm/build/ui-review-followups-final-20261111` passed. The frozen candidate remains unchanged. A Docker build will compile its frontend once from the archived committed source; it does not package the frozen frontend output. Dockerfile and ignore rules need no correction at this preparation stage.

## Pending build and verification

Proposed local immutable tag: `weborca:review-dc7c38f183-20261111` (not created; image ID unavailable). Explicit arguments should be `WASM_ARCH=64`, `WASM_CFLAGS=-sMEMORY64=1 -pthread -fwasm-exceptions -O2`, `ORCA_EMSCRIPTEN_VERSION=6.0.11`, the checked-in `MOBILE_SLICE_STEPS` default, and the confirmed production gate flag. Build with the isolated context and its `wasm/deploy/Dockerfile`, target `web`.

After the flag is known, build once and run the resulting image on an unused loopback port. Still required: startup/health, static and SPA routes, COOP/COEP and cache headers, packaged runtime/manifests hashes, engine/Preview worker asset URLs, STEP notices, and cleanup of that owned container. No claim of passing image verification is made here. No native build, browser smoke, README/Taproot update, commit, or push was performed.

Owned tracked change: this report only. The pre-existing untracked native oracle CMakeCache.txt was preserved.
