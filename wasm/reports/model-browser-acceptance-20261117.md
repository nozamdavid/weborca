# Models browser local acceptance — 2026-11-17

Implemented Models immediately before Prepare in desktop and mobile navigation, with `/models` history routing. Prepare and the browser remain mounted across navigation. The new surface inherits the app's design tokens, controls and translation lookup; new English messages fall back to English in other catalogs.
Current transport and private candidate: [catalog acceptance, 2026-11-18](model-catalog-acceptance-20261118.md). The provider transport described below is historical.

## Sources and behavior

The [source research](model-browser-source-research-20261117.md) was read before finalizing adapters. Sketchfab anonymous search and Commons `intitle:/\.stl$/` search use direct cross-origin fetch with `credentials: omit`. No proxy, key, secret or bypass was added. Both run independently and report partial-source failures. Search returns up to 24 results per source; filters apply to that fetched batch. Pagination is not implemented. New searches abort older requests.

Sketchfab extensions remain Unknown: derivative archive names do not establish original extensions. Commons accepts only `.stl` filename suffixes, rejecting unrelated results. Both retain available author/license text. Commons HTML attribution is stripped to text and never inserted as HTML. Validated HTTPS provider URLs are used for navigation and images. Cards open originals with `target=_blank` and `rel=noopener noreferrer`; images use anonymous CORS and no referrer, with missing/error placeholders. Printables and Thingiverse are separate outbound searches.

## Checks and candidate

`node --test wasm/tests/node/model-browser.test.mjs` passes four focused tests: metadata/Unknown handling, unsafe URLs and missing images, direct anonymous request construction/cancellation, and Commons suffix/attribution parsing. The locale check and TypeScript compilation pass. Impeccable context, new-work and craft-floor were read; the mechanical detector returned `[]` for changed UI targets. Existing tokens and controls supplied the visual direction.

`npm --prefix wasm/app run build` was run. Vite bundling succeeds, but final asset packaging fails because this checkout has no native build outputs. Supplying retained assets and identity receipts from sibling `prototype-html-in-canva-dace8cac6451aa94/wasm/build/ui-review-followups-20261111` reaches the integrity guard and fails with **Stale engine runtime: source/build inputs changed; rebuild this runtime**. The guard was preserved. This is not a passing full npm build or a release-qualified native combination.

For requested full-app local acceptance, the bundled UI was overlaid onto that retained full runtime in `wasm/build/model-browser-candidate-20261117`, served using the documented `wasm/deploy/server.mjs` with `ORCA_ROOT` and port 18973. The UI-only thumbnail correction uses a separate final candidate described below. No deployment or publication occurred. Build logs, focused results, detector output and candidate checksums are retained under `wasm/build/tests-model-browser-20261117/` (ignored local artifacts).

## T3 preview observations

Called `preview_status` before opening the local app. Acceptance used `http://localhost:18973`, crossOriginIsolated true, at 1280×800 and 390×844. The first-run configuration dialog was dismissed.

- Desktop tab order: Models, Prepare, Preview, Device. Mobile has the same order; Models content scroll width was 390 at a 390px viewport. Mobile inherits the existing dark shell; desktop light and dark were inspected.
- Empty query returned 48 real cards (24 each). Both API URLs were visible in resource timing. A typed/submitted `skull` query returned 48 real cards including Sketchfab Voodoo Skull and Commons High quality skull.stl, Archaeotherium skull and facial reconstruction records. Commons and Sketchfab thumbnails loaded with positive natural image widths (Commons 330px); the first five sampled Sketchfab images loaded successfully under app COEP.
- Selecting Commons and STL reduced the batch to 24 cards, all labeled `.stl`. Unknown remains a separate format option. Injecting a real image `error` event produced the No preview available fallback; missing-image behavior is covered by adapter tests.
- Clicking Voodoo Skull opened `https://sketchfab.com/3d-models/voodoo-skull-9fba7c12454a45499557b6281eb61b34` in another tab. That tab reported `window.opener === null`.
- Imported an in-memory tetrahedron OBJ via the app's model input. Prepare displayed `acceptance-tetra.obj` without alerts. After Models and back, the same canvas element, model name and all sampled Prepare input/select values remained. Models retained `skull` and its 48 cards.

The first visual pass exposed intrinsic images stretching some thumbnail boxes; CSS now positions images inside the fixed aspect-ratio frame. No source adapter changes followed the real-data checks.

Final UI candidate: `wasm/build/model-browser-candidate-20261117-r2`, served on port 18974. Its checksum-list SHA-256 is `338360a6500347a6858fbb25db9bef12223fe7a7f31340286df4e1d4ffdd9844`; every listed file passed the post-QA integrity check. The final npm invocation again passed locale checking, TS and Vite bundling, then failed missing local runtime identity during packaging. Final browser recheck returned 48 real cards, with the first five thumbnail frames consistently 232×174 at desktop width. Dark desktop rendering was visually inspected; 390px recheck retained four navigation items and no horizontal content overflow. Only the image positioning changed from the earlier behavioral acceptance candidate.

## Limits

Final review identified that a stalled provider could hold the combined search open indefinitely. Each source now has a 15-second abort timeout covering fetch and response-body reading, with caller cancellation forwarded and timers/listeners cleaned up. Two additional focused regressions verify partial results after timeout and cancellation of both requests; all six tests and TypeScript compilation pass. This transport-only follow-up was validated by those regressions; the browser candidate above predates it.

No production-origin acceptance, publication, automated download/import from providers, physical-device or non-Chromium acceptance is claimed. Provider availability can change. Search covers model metadata, including models that may require source-site authentication or licensing review to download. Native packaging remains blocked until matching engine assets/receipts are available or native outputs are rebuilt. No research-report or Taproot edits were made.
