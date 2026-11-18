# Model browser source research — 2026-11-17

## Actionable recommendation

Use **Sketchfab Data API v3 for anonymous search and source-page links**. A real browser fetch from `https://example.com` returned HTTP 200, `Response.type === "cors"`, and populated model results without credentials, headers, keys, proxies or CORS bypasses. This meets the search-tab constraint. It does **not** establish anonymous model download/import: the official Download API requires end-user authentication and provides glTF, GLB and USDZ rather than original STL/OBJ files.

Recommended first adapter request:

```js
const url = new URL('https://api.sketchfab.com/v3/search');
url.search = new URLSearchParams({type: 'models', q: query, count: '24'});
const response = await fetch(url, {credentials: 'omit'});
if (!response.ok) throw new Error(`Sketchfab: ${response.status}`);
const page = await response.json();
// page.results; page.next / page.cursors.next for pagination
```

Map `uid` to ID, `name` to title, `thumbnails.images[].url` to thumbnail, `viewerUrl` to source URL, `user.displayName` to author, `license.label` to license and `isDownloadable` to a source-site availability hint. `archives` keys describe derivative/archive formats; `source` does not reveal original filename extensions. Keep extensions unknown unless explicitly provided; never label all Sketchfab results STL. Use source-page navigation for downloads. Revalidate from the deployed WebOrca origin and its CSP before shipping.

Primary documentation: [Data API overview](https://sketchfab.com/developers/data-api/v3), [API reference](https://docs.sketchfab.com/data-api/v3/index.html), [Download API](https://sketchfab.com/developers/download-api), [developer guidelines](https://sketchfab.com/developers/guidelines). These pages were opened with T3 preview and read in the browser. The Download API page explicitly distinguishes authenticated download from public metadata.

## Browser method and evidence

T3 `preview_status` was called first, then `preview_open` opened `https://example.com/`; `preview_evaluate` ran standard browser `fetch` with `credentials: 'omit'` and an 18-second abort timeout. No custom authorization headers, cookies, proxy, `no-cors`, injected token or browser security changes were used. The origin was recorded as `https://example.com`. Successful responses below were actually readable JSON/text, not opaque responses. Tests are point-in-time observations; `TypeError: Failed to fetch` alone does not distinguish CORS denial, network failure and challenge behavior. It must not be reported as proof of a particular missing header.

| Source | Exact tested GET URL | Browser result | Decision |
| --- | --- | --- | --- |
| Sketchfab | `https://api.sketchfab.com/v3/search?type=models&q=bench&count=2` | 200, cors, populated JSON | Usable public search |
| Thingiverse | `https://api.thingiverse.com/search/bench?page=1&per_page=2` | 401, cors; `NO_TOKEN_PROVIDED`, “Unauthorized access. No authentication was provided.” | No anonymous search in this test |
| Wikimedia Commons | `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=filetype:stl&gsrnamespace=6&gsrlimit=3&prop=imageinfo&iiprop=url%7Cmime%7Cextmetadata&format=json&origin=*` | 200, cors; `{"batchcomplete":""}` | CORS works; this STL query supplied no models |
| Yeggi | `https://www.yeggi.com/q/bench/` | TypeError: Failed to fetch | No validated adapter |
| STLFinder | `https://www.stlfinder.com/3dmodels/bench/` | TypeError: Failed to fetch | No validated adapter |
| MakerWorld | `https://makerworld.com/api/v1/search-service/select/design?keyword=bench&limit=2` | TypeError: Failed to fetch | No validated adapter |
| Printables | `https://www.printables.com/graphql/` | TypeError: Failed to fetch | No validated adapter; GET is not a GraphQL search operation |
| Cults3D | `https://cults3d.com/graphql` | TypeError: Failed to fetch | No validated adapter; GET is not a GraphQL search operation |
| Thangs | `https://thangs.com/api/search?searchTerm=bench` | 404, cors, `Not Found` | This candidate route is invalid; CORS alone is insufficient |

Sketchfab sample: `uid=3c2b1ebcba444ec58c00dc2d89e69db6`, title `The Kungsåra Bench`, author `Historiska`, license `CC Attribution`, `isDownloadable=true`, source `https://sketchfab.com/3d-models/none-3c2b1ebcba444ec58c00dc2d89e69db6`. Thumbnail variants were 1920, 1024, 720, 256 and 64 pixels wide. `archives` contained `glb`, `gltf`, `gltf-ar`, `source`, `usdz`, with sizes and geometry counts. The second result was `HoloTech Bench`; pagination returned cursor `2` and a next URL.

## Other provider findings

These are conservative integration decisions, not claims that no private/partner API exists. Unverified internal route candidates above are not official contracts and must not be shipped based on guesses.

| Provider and primary page visited | Official/browser observation | Metadata and extension outcome |
| --- | --- | --- |
| [Yeggi](https://www.yeggi.com/) | Browser displayed its bot-protection holding page. No public API contract verified. | No readable search response/schema; title, image, source and extensions unverified. Use external search navigation only. |
| [STLFinder](https://www.stlfinder.com/) | Cloudflare security verification in browser. No public API contract verified. | No validated API metadata or extensions. External navigation only. |
| [MakerWorld](https://makerworld.com/) | Official homepage rendered model cards and authors; that is not cross-origin API access. Candidate API fetch failed. | Website has titles/images/model links; no readable cross-origin schema or extension field verified. |
| [Printables](https://www.printables.com/) | Cloudflare verification in browser. | No public search contract or cross-origin model metadata validated. |
| [Cults3D API candidate documentation](https://cults3d.com/en/pages/api) | Cloudflare verification prevented reading documentation. | GraphQL auth/schema not established from official docs in this session; do not invent an anonymous supported API. |
| [Thangs](https://thangs.com/) | Homepage rendered models and stated maintenance was underway; no developer/API links in inspected page links. | Public HTML cards do not establish reusable API schema; tested route was 404. |
| [Thingiverse developers](https://www.thingiverse.com/developers) | Browser body was empty when inspected. First-party API itself returned explicit authentication requirement. | No authenticated schema tested. No bundled/shared application token allowed under the constraint. User-owned OAuth would require separate design and validation. |

## Wikimedia Commons — second validated source, including STL metadata

[Official MediaWiki CORS documentation](https://www.mediawiki.org/wiki/API:Cross-site_requests), read via preview, documents anonymous cross-origin requests with `origin=*` and provides a browser fetch example. This is an explicit supported mechanism, not a CORS bypass. Follow-up browser validation demonstrated actual STL inventory and thumbnail URLs. Use Commons as a second adapter, or prioritize it if known STL extensions matter more than catalog size. The earlier `filetype:stl` query was empty; use the validated title suffix query below.

Validated request: [Commons STL search](https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=intitle%3A%2F%5C.stl%24%2F&gsrnamespace=6&gsrlimit=2&prop=imageinfo&iiprop=url%7Cmime%7Cextmetadata&iiurlwidth=320&format=json&origin=*). Decoded `gsrsearch` is `intitle:/\.stl$/`. Browser fetch from example.com returned **200, cors**, two STL records and `continue.gsroffset=2`. An earlier `intitle:stl` search also returned an SVG logo, demonstrating why a suffix filter and client-side extension check are necessary. Append the user's search text to the suffix constraint and URL-encode it; that combined free-text query was not separately tested.

Schema: `query.pages` is a page-ID-keyed object; sort by each page's `index`. Map `pageid` to ID, `title` (remove `File:`) or `imageinfo[0].extmetadata.ObjectName.value` to title, `imageinfo[0].thumburl` to thumbnail, `descriptionurl` to source page, `url` to original file URL, and extension from the title/URL pathname. `mime` was `application/sla`. Continuation is a top-level `continue` object; forward its fields on the next request. Metadata `extmetadata.Artist.value` can contain HTML; render as text or sanitize. Preserve license and attribution metadata.

Observed records:

- `67106444`, `File:High quality skull.stl`, [source page](https://commons.wikimedia.org/wiki/File:High_quality_skull.stl), artist Mariano Coretti, `LicenseShortName.value=CC BY-SA 4.0`, `AttributionRequired.value=true`.
- `66751246`, `File:Puchar Wikipedia 10 cm.stl`, [source page](https://commons.wikimedia.org/wiki/File:Puchar_Wikipedia_10_cm.stl), artist Polimerek, same license.

Both had PNG thumbnail URLs at requested dimensions 320×240 and original `.stl` URLs on upload.wikimedia.org. Thumbnail pixels and model binary fetches were not tested; this validates search metadata, not import. Example thumbnail: `https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d8/High_quality_skull.stl/330px-High_quality_skull.stl.png?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail`.

## Additional Sketchfab confirmation

`https://api.sketchfab.com/v3/search?type=models&q=bench&count=1&downloadable=true` returned 200/cors and the Kungsåra result. `https://api.sketchfab.com/v3/models/3c2b1ebcba444ec58c00dc2d89e69db6/download` returned 401/cors with `Authentication credentials were not provided.` Both used anonymous browser fetch from example.com.

The official [Swagger schema](https://docs.sketchfab.com/data-api/v3/swagger.json) was read using browser fetch from its documentation page. Its overview documents cursor pagination, default/maximum page size 24 and throttling via HTTP 429. Debounce queries, cancel stale requests and back off on 429. No fixed numeric request quota is claimed here.

## Scope and limitations

Research only; no application changes. No tests or compilation are required for this Markdown report. Browser fetches are the focused validation. Do not turn failure observations into a global claim that a provider blocks every origin or has no API. No live API rate limit was inferred from these few requests. Search/source linking is the demonstrated viable feature; automatic STL/3MF import remains unproven.
