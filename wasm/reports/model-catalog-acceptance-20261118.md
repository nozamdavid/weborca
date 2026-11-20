# Models catalog acceptance — 2026-11-18

Supersedes the provider transport and counts in the November 17 acceptance report. The existing navigation, mounted Prepare runtime, cards and design tokens remain. Models now fetches the full catalog once on first use, with explicit retry after failure and a 30-second timeout. Query and dynamic source/verified-format filtering are local. Estimates appear separately and never qualify a verified format filter. Links allow HTTP(S), open a new tab with noopener/noreferrer; images are restricted to the catalog service origin and fall back to placeholders. Authors and model license names remain visible.

Default endpoint: https://server-1.barbel-hops.ts.net:4184/catalog/releases/private-demo-1794944672500/catalog-0.json. The single build-time override is `VITE_MODEL_CATALOG_URL`. An alternate service must supply an array with the same schema and permit browser CORS and cross-origin isolated image use.

## Evidence

- Live feed and `/tmp/orca-catalog-sample`: 32 records, one source (`makerworld`). Real schema fixture retains the first three records.
- `node --test wasm/tests/node/model-browser.test.mjs`: 3 passing tests for attribution, estimates, local search, unsafe metadata and single-endpoint transport/failure.
- `npm run build --prefix wasm/app`: all 22 locale catalogs and TypeScript pass; Vite emits the UI bundle. Final native packaging fails because `wasm/build/runtime-identities/engine.json` is absent. No native build success is claimed.
- Impeccable detector: no findings. Logs under ignored `wasm/build/tests-model-catalog-20261118/`.
- T3 `preview_status` initially unavailable, then `preview_open` succeeded. Actual native runtime at localhost:18974 rendered 32 cards and service thumbnails. Resource timing showed one catalog request and thumbnails from `https://server-1.barbel-hops.ts.net:4184`; no provider API requests. Verified `.3mf` filter returned four records, matching the live JSON. Empty state was observed with a nonmatching source. At 390px the Models scroll width was 390px. Prepare/Models navigation retained the canvas and did not refetch the catalog.

## Candidate and limits

UI bundle overlaid onto the retained native runtime in `wasm/build/model-catalog-candidate-20261118`. The existing private Tailscale :18974 service continues using `wasm/build/model-browser-candidate-20261117-r2`, updated with the same UI assets/index. Complete prior candidate preserved in `wasm/build/model-browser-rollback-20261118`; restore its assets and index to roll back. Public hosting was not changed. Candidate index SHA-256: `1de71870514495287330f8c706c2a542054204fab878db25e04c14a96cb20e06`.

This is a private demo with a single source, not a complete provider index. Production packaging/identity receipts and production-origin acceptance remain open. Error/retry transport is covered by focused tests; a real service outage and timeout were not induced in the browser. No new slicing qualification or source-site download/import acceptance is claimed.
