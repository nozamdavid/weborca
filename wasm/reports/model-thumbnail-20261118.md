# Thumbnail fix — private :18974, 2026-11-18

## Resize/WebP follow-up

Real appended `<img>` probes in the isolated private HTTPS preview failed both without crossOrigin and with crossOrigin=anonymous. Kept the same-origin route; server appends exactly `?x-oss-process=image/resize,w_400/format,webp` after validating the original query-free URL. Caller queries remain rejected. Placeholder/error behavior is retained.

Decoded example: WebP 400×300, 11,052 bytes (original PNG 2,639,359 bytes). The previous `.jfif` URL ignores this transform and returns a 3,878,085-byte PNG, 1912×1434, with binary/octet-stream MIME. Generic binary responses now pass through the existing raster signature check and are served with detected image MIME; invalid binary still fails. This concrete CDN behavior required the additional focused assertions.

`node --check` passed for server.mjs and model-thumbnail.mjs; the 8 existing image/catalog tests pass with fixed upstream query and valid/invalid binary assertions ([log](model-thumbnail-20261118/webp-tests.log)). Real lazy scrolling at desktop 1280×800 and mobile 390×844 decoded 24/24 covers: 23 widths of 400 and the PNG fallback at 1912; document widths equal viewport widths; crossOriginIsolated true.

Private deployment uses frozen `wasm/build/model-thumbnail-webp-server-20261118` and override 98; existing frontend/index/runtime reused with no frontend build. [Rollout](model-thumbnail-20261118/webp-rollout.sh) verifies the served index against the existing candidate; [rollback](model-thumbnail-20261118/webp-rollback.sh) removes only 98, restoring the prior 97 server. Initial transient proxy 502 recovered through retry. [WebP headers](model-thumbnail-20261118/webp.headers), [decoded WebP](model-thumbnail-20261118/cover.webp), [JFIF upstream headers](model-thumbnail-20261118/jfif-upstream.headers), [PNG response headers](model-thumbnail-20261118/jfif-webp.headers). Taproot milestone 11QrSirCgVy1q2 updated with follow-up evidence.

Follow-up changed files: README.md, wasm/deploy/model-thumbnail.mjs, wasm/tests/node/model-thumbnail.test.mjs, this report, and follow-up evidence/scripts in model-thumbnail-20261118/. Earlier verification below describes the original rollout.

Private HTTPS preview serves `wasm/build/model-thumbnail-candidate-20261118` via frozen `wasm/build/model-thumbnail-server-20261118/server.mjs` and `97-model-thumbnail.conf`. No public deployment or commit; existing dirty work preserved.

Investigation: models.noz.am root, `/openapi.json` and `/thumbnail/3211810` return the supported routes `/health`, `/stats`, `/models`, `/models/:id`. Live metadata supplies CDN URLs without a first-party image variant. CDN PNG is HTTP200 without ACAO/CORP. Original real page: 24 cards, 24 placeholders, crossOriginIsolated true. No supported first-party image route was found.

The app server route `/_model-thumbnail?url=...` accepts GET only, HTTPS exact makerworld.bblmw.com, public model/design raster paths (PNG/JPEG/JFIF/GIF/WebP), no credentials, ports, fragments or queries. It needs no Bambu authentication and forwards no caller headers. Redirects are rejected. Fetch timeout 15s; declared and streamed limit 24 MiB; four active fetches, 24 queued requests; cache 64 MiB/64 entries/five minutes. Errors no-store; successful images actual validated raster MIME, nosniff, CORP same-origin, public max-age=300. Unexpected MIME and non-raster signatures are rejected. CDN sometimes labels PNG as JPEG; actual raster signature determines the served type. Live GIF is 17 MB. Global isolation and placeholders retained.

Validation:

- `node --test wasm/tests/node/model-thumbnail.test.mjs wasm/tests/node/model-browser.test.mjs wasm/tests/node/bambu-account.test.mjs wasm/tests/node/bambu-cloud-client.test.mjs wasm/tests/node/makerworld-relay.test.mjs`: 22 pass ([log](model-thumbnail-20261118/tests.log)). Restrictions, invalid MIME/signatures, redirect responses, declared/streamed oversize, caching and mislabeled PNG covered.
- `node --check wasm/deploy/server.mjs`, `node --check wasm/deploy/model-thumbnail.mjs`, `npm run check:locales` (22 catalogs), `npx tsc --noEmit` pass.
- One integrated UI Vite build passed in 7s, temporary config excluding only native asset packaging then removed. Existing native runtime retained; prior missing runtime identity packaging constraint and bundle warnings remain. Server corrections reused the same UI candidate without rebuilding.
- Real canonical HTTPS browser `/models`: 2,339,502 total, 24 cards, sequential lazy scroll and decode. Desktop 1280×800: 23 decoded, natural widths 618–1920, render widths about 231.6px, no overflow, crossOriginIsolated true. Mobile 390×844: same 23 decoded, render width 356px, document width 390px, isolation true. [Desktop](model-thumbnail-20261118/desktop.png), [mobile](model-thumbnail-20261118/mobile.png).
- One live JFIF is served by CDN as `binary/octet-stream`; rejected with 502, readable placeholder retained. Full 24/24 pixel availability is not claimed.
- Filter/download/session paths unchanged except thumbnail mapping; focused regressions pass. Live authenticated download was not repeated.
- [Runtime manifest](model-thumbnail-20261118/runtime.sha256) and [verification](model-thumbnail-20261118/runtime-check.log) preserve every non-index/assets file from the canonical base; old hashed assets retained. Served index equals candidate. [PNG headers](model-thumbnail-20261118/thumbnail.headers), [corrected JPEG-label headers](model-thumbnail-20261118/jpeg.headers).

Index SHA-256 `4b483ff1c3e84c38ffb9be7fa25fa0ba79c497f89be01d8ad622d0d6f3bd0e6d`.

[Guarded rollout](model-thumbnail-20261118/rollout.sh) installs only 97, verifies runtime/index/real image, rolls back on failure. Transient proxy 502 during restart recovered by curl retry. Service active. [Rollback](model-thumbnail-20261118/rollback.sh) removes only 97 and restarts, restoring the 96 canonical root and original ExecStart; prior 80/90/95/96 overrides and environment retained.

Taproot milestone `11QrSirCgVy1q2` done under `models_local_20261117` with evidence. Recursive completion/collapse audit: zero expanded branches with all children complete; Models remains collapsed.

Exact task source/doc files: README.md; wasm/app/src/models/sources.ts; wasm/deploy/server.mjs; new wasm/deploy/model-thumbnail.mjs; wasm/tests/node/model-browser.test.mjs; new wasm/tests/node/model-thumbnail.test.mjs; this report; evidence directory (rollout.sh, rollback.sh, tests.log, runtime.sha256, runtime-check.log, served.html, thumbnail.headers, thumbnail.png, jpeg.headers, desktop.png, mobile.png). Generated candidates and private systemd 97 override also created.
