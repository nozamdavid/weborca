# Printables direct browser investigation — 2026-11-17

## Decision

No usable direct Printables search route was established for WebOrca. Do not add an adapter: valid anonymous operations return JSON from `https://api.printables.com/graphql/`, but that endpoint supplies no CORS permission for `https://server-1.barbel-hops.ts.net:18974`. Both preflighted JSON POST and a valid GET fail as standard browser fetches from the actual `/models` page. This is stronger evidence than the earlier guessed GET to `www.printables.com/graphql/`.

Only this report was added. No application changes, deployment, extension, proxy, authentication extraction, security changes or `no-cors` requests. No compilation or unit tests apply to this documentation-only change; live requests below are the focused checks.

## Method and inspection limit

Called T3 `preview_status` first, then opened the [Printables search page](https://www.printables.com/search/models?q=benchy) and [WebOrca models](https://server-1.barbel-hops.ts.net:18974/models). WebOrca reported its exact origin and `crossOriginIsolated === true`.

Printables remained at “Performing security verification” / “Just a moment...”. Browser resource inspection (`performance.getEntriesByType('resource')` and script URLs) showed Cloudflare challenge resources, not the application bundle or frontend GraphQL requests. No current frontend operation was captured. A fetch attempted from the challenged Printables page also failed; this does not establish how its functioning frontend behaves. We did not bypass the challenge. Thus the endpoint and operations below are live-validated first-party API behavior, **not a claim to have captured today's frontend requests**.

[GhostTypes' public client source](https://github.com/GhostTypes/printables-cli-api/blob/main/printables_api.py), read in the preview browser via its raw source, supplied a lead: `api.printables.com/graphql/`, `searchPrints2`, `print`, user and image fields. It is third-party source, not an official contract. Its scraping/bypass code was not run. The decisive schema and access evidence came from requests directly to the first-party API.

The [Prusa-hosted API forum thread](https://forum.prusa3d.com/forum/general-discussion-user-experience-ideas/is-there-a-publicly-available-rest-api/), read in preview, contains a 2 May 2022 reply by Tojik stating that GraphQL exists but documentation is not provided and referring readers to the website request formats. This is historical forum evidence, not a current published API specification or verified staff commitment. No current official supported public search API documentation was located. Anonymous reachability must not be called an officially supported integration API.

## Valid operations and response bodies

Direct diagnostic curl requests used no cookies or authorization and sent `Origin: https://server-1.barbel-hops.ts.net:18974`. Curl does not enforce CORS; its success alone cannot qualify a browser adapter.

POST `https://api.printables.com/graphql/`, `Content-Type: application/json`, body:

```json
{"query":"query { print(id: \"3161\") { id name images { filePath } } }"}
```

Returned HTTP 200, `Content-Type: application/json`, body:

```json
{"data":{"print":{"id":"3161","name":"3D BENCHY","images":[{"filePath":"media/prints/3161/images/20206_70fde6a0-6da1-4522-ba46-25f1bece7199/benchy.jpg"},{"filePath":"media/prints/3161/images/20205_d6fc9f43-aa8d-466d-8f44-e0d20fe84f01/benchy-02.jpg"}]}}}
```

Search POST with this body also returned HTTP 200 and two actual results, not GraphQL errors:

```json
{"query":"query { searchPrints2(query: \"benchy\", limit: 2) { items { id name } } }"}
```

```json
{"data":{"searchPrints2":{"items":[{"id":"3161","name":"3D BENCHY"},{"id":"1192178","name":"All Terrain Assault Benchy"}]}}}
```

A GET to the same endpoint with URLSearchParams-encoded `query` validated additional fields:

```graphql
query {
  searchPrints2(query: "benchy", limit: 2) {
    items { id name slug user { publicUsername } image { filePath } }
  }
}
```

Returned HTTP 200 and the same models. First result: `slug=3d-benchy`, `user.publicUsername=Prusa Research`, cover path equal to the first image above. Second: `slug=all-terrain-assault-benchy`, author `soozafone`, image path `media/prints/1192178/images/8960591_c320f4d9-30fe-4592-bf98-82b3f83d956e_c522336c-e156-433d-9a44-46388b0036d9/img_1899.jpeg`.

These fields could supply titles, attribution, source links (`https://www.printables.com/model/3161-3d-benchy`) and images if access becomes available. Search results do not prove STL/3MF extensions. Pagination, limits, downloads and licensing were not validated; no download mutation was invoked.

## CORS and preflight, separately

At approximately 01:11 UTC, JSON POSTs above returned these relevant diagnostic response headers:

```text
HTTP/2 200
content-type: application/json
vary: Cookie, Accept-Language, origin
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: same-origin
cross-origin-opener-policy: same-origin
```

`Access-Control-Allow-Origin` was absent. The valid GET response had the same relevant header pattern and no ACAO. Response cookies were not reused; their values are omitted.

Explicit diagnostic preflight:

```sh
curl -i -X OPTIONS https://api.printables.com/graphql/ \
  -H 'Origin: https://server-1.barbel-hops.ts.net:18974' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

Response:

```text
HTTP/2 200
content-type: text/html; charset=utf-8
vary: origin
```

Empty body; **no** `Access-Control-Allow-Origin`, `Access-Control-Allow-Headers` or `Access-Control-Allow-Methods`. An HTTP 200 preflight is insufficient without those permissions.

Control: identical OPTIONS with `Origin: https://www.printables.com` returned:

```text
HTTP/2 200
vary: origin
access-control-allow-origin: https://www.printables.com
access-control-allow-credentials: true
access-control-allow-headers: accept, authorization, content-type, user-agent, x-csrftoken, x-requested-with, client-uid, userid, accountid, operation, x-authorization, x-user-agent, apollographql-client-version, graphql-client-version
access-control-allow-methods: DELETE, GET, OPTIONS, PATCH, POST, PUT
access-control-max-age: 86400
```

This control supports origin-selective CORS behavior. It does not prove that only one origin is allowed globally. Manually supplying Origin in curl is diagnostic, not an integration workaround; browser JavaScript cannot substitute the Printables origin.

Actual standard fetches from WebOrca used `credentials: 'omit'`, default CORS mode and 15–20 second abort timeouts. Both valid JSON POST operations, and the validated richer GET operation, rejected with `TypeError: Failed to fetch`. JavaScript could not read status, headers or body; the HTTP diagnostics above are separate curl observations, not invented browser-visible responses. The GET check rules out a solution based solely on avoiding preflight. These results and the missing permission establish that the tested routes are unsuitable; no global claim about every possible endpoint is made.

A simple POST with `Content-Type: text/plain` and JSON body also failed in WebOrca. Direct diagnostic response was HTTP 400, no ACAO, body `{"errors":[{"message":"Must provide query string."}]}`. Changing the media type does not provide a usable route.

## Images under isolation

Tested the API-derived cover:

`https://media.printables.com/media/prints/3161/images/20206_70fde6a0-6da1-4522-ba46-25f1bece7199/benchy.jpg`

On the actual isolated WebOrca page, separate `new Image()` loads produced:

- Default image mode: `onerror`, no successful load.
- Set `image.crossOrigin = 'anonymous'` **before** `src`: `onload`, `naturalWidth=5184`, `naturalHeight=2920`.

A diagnostic HEAD returned HTTP 200, `Content-Type: image/jpeg`, `Content-Length: 6775166`, `Access-Control-Allow-Origin: *`, and no `Cross-Origin-Resource-Policy` header. This is consistent with CORS image loading succeeding under isolation while default embedding fails. It verifies this specific cover, not every thumbnail variant, redirect or media host. The original cover is large; no transformed thumbnail URL was guessed or validated. Image availability does not solve metadata access.

## Realistic no-service alternatives

1. User opens Printables search/model pages, downloads files through its normal interface, then imports local files into WebOrca. This requires no new network service and respects the direct-browser constraint. It does not automatically populate an in-app search catalog. A user-provided metadata export could likewise be imported locally, but its format and import behavior require an explicit scope choice before implementation.
2. An explicitly installed browser extension with deliberate host permissions could potentially bridge selected public metadata into WebOrca. This changes the permission and distribution model; it is a proposal requiring explicit scope approval and fresh validation, not a tested solution. No extension was installed or built.
3. Printables could provide a documented integration endpoint or allow WebOrca's origin. That requires provider participation; neither is currently established by this investigation.

No adapter should be wired into shared sources or UI based on these results. A server proxy, hidden service, security disabling, origin spoofing or opaque response would violate the requested constraints.
