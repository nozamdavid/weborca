# MakerWorld and STLFinder investigation — 2026-11-17

Neither source passed direct browser integration from WebOrca. No adapter was added. MakerWorld has a working anonymous internal search route, but WebOrca could not read it; the sampled thumbnail also failed under app isolation. STLFinder's pages and discovery files were challenged. This is a point-in-time integration result, not proof that every endpoint or origin is blocked.

## Method and limits

Called T3 `preview_status` first, then opened owned tabs for both providers, WebOrca and public code/documentation discovery. All website inspection and requests used the preview browser. WebOrca was actually loaded at `https://server-1.barbel-hops.ts.net:18974/models`; `location.origin` matched that origin and `crossOriginIsolated` was `true`.

Cross-origin tests used ordinary GET `fetch(url, {credentials: 'omit', signal: AbortSignal.timeout(10000)})` (the initial pair used 12000 ms). No proxy, opaque `no-cors` response, authorization, extracted credentials, security changes or extension was used. Same-origin diagnostic requests are explicitly identified below and are not evidence of app compatibility.

The actual first-party search frontend could **not** be inspected beyond the challenge: MakerWorld `/`, `/en`, `/en/search/models?keyword=bench` and STLFinder `/` and `/3dmodels/bench/` displayed Cloudflare verification. Their resource timing entries contained challenge scripts/frames, not model search requests. Fetching MakerWorld `/en` also returned 403 challenge HTML. Consequently no claim is made to have captured a successful frontend search transaction or its complete headers. Public source leads supplied additional routes, which were then tested directly against the first-party host.

## MakerWorld: concrete route and parameters

Primary tested endpoint: <https://makerworld.com/api/v1/search-service/select/design2?keyword=bench&limit=2&offset=0>.

Public source lead: [OpenBambuAPI cloud-http.md](https://github.com/Doridian/OpenBambuAPI/blob/main/cloud-http.md). Its undocumented endpoint section lists `/v1/search-service/select/design2`, `/select/all`, `/suggest2`, `/searchlist` and other routes. That section explicitly describes APK-derived path strings and inferred methods with no request/response schemas. It is community reverse engineering, **not supported MakerWorld API documentation**. The `/api` prefix on makerworld.com was validated experimentally.

| Request on makerworld.com, credentials omitted | Same-origin result | Fetch from WebOrca |
| --- | --- | --- |
| `/api/v1/search-service/select/design?keyword=bench&limit=2` | 200 JSON, `total:0`, `hits:[]` | `TypeError: Failed to fetch` |
| `/api/v1/search-service/select/design2?keyword=bench&limit=2&offset=0` | 200 JSON, total 2848, two populated hits | `TypeError: Failed to fetch` |
| `/api/v1/search-service/select/design2?keyword=bench&limit=2&offset=2` | 200 JSON, total 2848, different pair | Not separately tested |
| `/api/v1/search-service/select/all?keyword=bench&limit=2&offset=0` | 200 JSON, aggregate counts; design hits null | `TypeError: Failed to fetch` |
| `/api/v1/search-service/suggest2?keyword=bench&limit=2&offset=0` | 200 JSON, empty suggestion arrays | `TypeError: Failed to fetch` |
| `/api/v1/search-service/searchlist?keyword=bench&limit=2&offset=0` | 200 JSON, hot/custom word lists | `TypeError: Failed to fetch` |

The older `select/design` also returned empty hits for `keyword=benchy&limit=2`, and for bench with `offset=0`, `orderBy=downloadCount` or `searchMode=all`. Those variants are unsuccessful parameter probes, not validated search options. For `design2`, only `keyword=bench`, `limit=2`, and offsets 0/2 are established here; no maximum, sorting contract or quota was inferred.

The first `design2` pair was:

- ID 880921, `1/10 Scale Park Bench with Wood Texture`, slug `1-10-scale-park-bench-with-wood-texture`, creator `3Dylan`, license `BY-NC-SA`.
- ID 1115073, `3dbenchy`, slug `3dbenchy`, creator `SamBamdesigns`, license `Standard Digital File License`.

Offset 2 returned IDs 1936921 (`Configurable bench for displaying figurines`) and 2472873 (`Modular Bench: Glue-Free Fast-Print & Robust Stand`).

Useful response fields are `hits[].id`, `title`, `slug`, `cover`, `designCreator.name`, `license`, and `designExtension.model_files`. The first record had no model files; the second included `modelName: "3dbenchy.stl"`, `modelType: "stl"` and an empty `modelUrl`. Thus known STL metadata exists for some results, but search does not establish downloadable binary URLs. Empty file arrays must remain unknown format. No download was attempted.

### CORS, authentication and preflight

The successful same-origin JSON responses had `Content-Type: application/json; charset=utf-8` and no `Access-Control-Allow-Origin` header. `design2` explicitly returned null for that header. The earlier route's `Vary` was `Accept-Encoding`. These observations and failed cross-origin reads establish that this route is unusable by the tested app; they do not establish the precise response sent for a request carrying the app's Origin header, which JavaScript could not read.

The app tests were simple GETs with no custom headers and therefore did not require CORS preflight. A separate same-origin diagnostic OPTIONS request to the exact `design2` URL returned 405 with no allow-origin/allow-methods headers. It was **not a browser-generated cross-origin preflight** and should not be reported as one. Adding custom headers would introduce another requirement, not fix the failed simple GET.

Anonymous same-origin `design2` worked with cookies omitted, so authentication is not required for that demonstrated public metadata request. The frontend HTML itself remained challenged. These are separate facts: do not call the JSON result an authentication failure or infer that solving a challenge would enable CORS. No CSP violation event was observed during a further app fetch batch (older route, sitemap and STLFinder robots); generic fetch errors alone cannot conclusively distinguish CORS, challenge, network or other browser policy failures.

### Thumbnails under WebOrca isolation

Exact real result URL tested:

<https://makerworld.bblmw.com/makerworld/model/USc5fdef05719d9/design/2024-12-14_2f7f51fed1ba1.jpg>

In the isolated app, `new Image()` failed with crossOrigin unset; a second `Image` with `crossOrigin='anonymous'` also failed. Ordinary credential-free fetch returned `TypeError: Failed to fetch`. There was no image load or decoded size. This validates failure of this sample, not all CDN variants. No readable CDN response headers were available to attribute failure specifically to CORP/COEP versus CORS, network or challenge. Do not ship thumbnails based only on the presence of a cover URL in JSON. STLFinder supplied no real thumbnail URL, so its thumbnails remain unverified.

## Documentation and feeds

MakerWorld's [robots.txt](https://makerworld.com/robots.txt) resolved to `/en/robots.txt` and returned 200, allowing crawling except account/policy paths and advertising [sitemap.xml](https://makerworld.com/sitemap.xml). The sitemap index returned 200 with links to `https://makerworld.com/sitemap-0.xml` and `https://makerworld.com/sitemaps/index.xml`. A request to `/sitemap-0.xml` resolved into challenge HTML (403). WebOrca could not fetch the sitemap index. An index of page URLs is not a search API or an RSS feed and does not resolve CORS.

Read the [API/RSS feature request on Bambu's forum](https://forum.bambulab.com/t/feature-request-makerworld-api-or-rss-feed-for-user-data/205669). It contains user requests for an API/feed and follow-up requests for search/collection operations, not an API specification or a vendor commitment. No supported first-party search API/feed contract was found. Public search also surfaced third-party hosted APIs/scrapers; those require another service and were excluded by the hard constraint.

## STLFinder

Primary URLs inspected: [homepage](https://www.stlfinder.com/), [bench search](https://www.stlfinder.com/3dmodels/bench/), [robots.txt](https://www.stlfinder.com/robots.txt), [sitemap.xml](https://www.stlfinder.com/sitemap.xml).

Same-origin GETs to bench search, robots and sitemap returned **403**, `cf-mitigated: challenge`, `Content-Type: text/html; charset=UTF-8`, and title `Just a moment...`. This is positive bot-challenge evidence, not a JSON schema or an authentication-required response. Cross-origin fetches from WebOrca to bench search and robots both failed with `TypeError: Failed to fetch`. No first-party model-search request, valid JSON parameters, supported API documentation, feed discovery links or thumbnail URLs could be recovered from these challenged pages.

Public browser searches for `STLFinder API github search RSS` and `"stlfinder" "github" scraper` did not produce an actionable current implementation or supported contract. GitHub references found in search results were general site links/historical markup, not a verified API lead. This limited discovery result does not prove no API exists. Guessing additional routes would not supply the requested first-party evidence.

## Realistic choices within no-service operation

1. Open provider search pages externally; let the user download allowed files and import local STL/3MF into WebOrca. This avoids cross-origin metadata fetching and needs no new service. Challenge/login handling remains on the provider's page.
2. If an in-app catalog is required, explicitly scope a user export/import format: metadata plus locally supplied thumbnail files, preserving source links, authors and licenses. No existing provider catalog export was verified, so do not promise an automatic export. Local thumbnail bytes avoid depending on unverified remote embedding.
3. A user-approved browser extension could potentially collect metadata from pages the user visits and hand it to the app. This requires an explicit scope decision for host permissions, data transfer and browser support. It is a different architecture; no extension was built or installed, and it cannot be promised to bypass provider challenges.

No TypeScript, shared sources or UI files changed, so compilation and unit tests were not applicable. Focused verification consisted of the live browser requests above. No deployment occurred. Only this report was added by this investigation; pre-existing workspace changes belong to other work.
