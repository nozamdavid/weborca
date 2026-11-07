# Connecting WebOrca to Orca Cloud

Researched **2026-11-04**, with anonymous production probes at **10:32–10:33 UTC** and live Tailscale origin checks at **10:36:52 UTC**. Workspace HEAD: `571aee86bacdc0b986a72e6e4dad69fc01286e84`. Research only: no account login, existing credentials, authenticated requests, upstream API writes, application edits, builds, or test suites.

## Recommendation

**Remove the manual gateway address by providing an automatically configured, same-origin Orca Cloud backend.** The desktop client connects directly to Orca's authentication and sync services using HTTPS, PKCE and bearer tokens. It has native HTTP and a localhost callback listener, which a normal browser page does not have. The web app can use the same upstream protocol through its deployment backend without asking each user to install or address a local gateway.

**Fully direct browser sync from `https://weborca.noz.am` and the live `https://server-1.barbel-hops.ts.net:5070` origin is currently obstructed by the observed API CORS policy.** Anonymous preflight responses for pull and push omitted `Access-Control-Allow-Origin` for both origins; the same pull preflight allowed `https://cloud.orcaslicer.com`. Auth token preflight separately allowed `*`. This is a measured distinction, not a claim that every Orca endpoint rejects browsers. No browser execution or completed login was performed. See the probe record and [Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol).

Both designs still need an upstream-approved application callback. A redirect to a provider's login screen does **not** establish that Orca accepts the final WebOrca callback. An alternative is the user's proposed manual return: use the native localhost callback and paste the failed navigation's complete URL into WebOrca. The backend recommendation removes the address field and upstream CORS dependency; it does not remove OAuth authorization or redirect configuration.

## Sources and reproducibility

The native implementation below is Orca's own cloud agent, independent of Bambu Cloud. Legacy `BAMBU_NETWORK_*` return-code names in that class do not change the destination services. The factory describes Orca as the primary cloud agent in [NetworkAgentFactory.hpp](../../src/slic3r/Utils/NetworkAgentFactory.hpp#L185).

Native agent citations use the last upstream commit changing that file, `e5324ae319708367540a648e8591261ab1136e5e`. Its [raw source](https://raw.githubusercontent.com/OrcaSlicer/OrcaSlicer/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp) returned HTTP 200 and compared byte-for-byte equal to the workspace file. The workspace HEAD itself was unavailable through upstream's raw GitHub URL (404), so it is not used for upstream permalinks. Web implementation links are relative to this report and describe the existing working tree, including uncommitted files, rather than a published revision.

Additional primary sources:

- [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls): application `redirectTo` URLs must match the project's configured Redirect URLs; production should use an exact path. This is platform documentation, not access to Orca's private project settings.
- [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow): code exchange needs the original verifier; codes are single use and valid for five minutes.
- [Fetch CORS-preflight algorithm](https://fetch.spec.whatwg.org/#cors-preflight-fetch): browser enforcement depends on the response's allowed origin, method and headers.
- Orca's deployed [login page](https://cloud.orcaslicer.com/orcaslicer-login) and the [JavaScript asset it referenced during research](https://cloud.orcaslicer.com/assets/index-BQcUuEFi.js). The minified asset is a mutable deployment artifact, not a stable source permalink. Searchable symbols/strings below identify the relevant code without pretending it has repository line numbers.

## How native Orca Cloud works

### Origins and application identity

The [native constants](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L85-L114) are:

| Purpose | Default |
| --- | --- |
| Sync/data API | `https://api.orcaslicer.com` |
| Supabase/GoTrue Auth | `https://auth.orcaslicer.com` |
| Hosted cloud/login UI | `https://cloud.orcaslicer.com` |
| Hosted slicer login page | `/orcaslicer-login` |
| Public application key (`apikey`) | `sb_publishable_lvVe_whOi80SU9BPSxM1kA_tbt9AbR_` |

The source explicitly labels the publishable key as public and without a secret. It is placed into `auth_headers` in the [constructor](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L511-L521). URLs and key can be overridden with `orca_api_url`, `orca_auth_url`, `orca_cloud_url`, `orca_pub_key` in [configure_urls](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L549-L575).

There is no separate slicer OAuth `client_id` or client secret in the traced PKCE exchange. The publishable key identifies access to Orca's Supabase project; social-provider client IDs belong to Orca's upstream auth integration. Anonymous authorize redirects exposed these public provider IDs:

| Provider | Observed `client_id` | Provider return destination |
| --- | --- | --- |
| Google | `981945582967-kufsjtuqhbbhm8kfodk4c4nspoqd5dbg.apps.googleusercontent.com` | `https://auth.orcaslicer.com/auth/v1/callback` |
| GitHub | `Ov23liqrUPDEcJExDAA0` | same |
| Apple | `com.orcaslicer.auth` | same; `response_mode=form_post` |

These IDs were observed in HTTP 302 `Location` headers, not inferred from Bambu code. WebOrca should initiate Orca Auth's authorize flow; a provider authorization code is not the Supabase code the slicer exchanges.

### Login, callback and refresh

1. Native [WebUserLoginDialog](../../src/slic3r/GUI/WebUserLoginDialog.cpp#L168) opens the cloud agent's hosted login URL. On `get_login_cmd`, it calls `build_login_cmd` ([bridge handler](../../src/slic3r/GUI/WebUserLoginDialog.cpp#L344)). The agent generates a verifier, SHA-256 base64url challenge and random state, with `http://localhost:<port>/callback` as redirect ([PKCE generation](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L1532-L1546)). Default port is 41172 ([header constants](../../src/slic3r/Utils/OrcaCloudServiceAgent.hpp#L55)); selection tries the configured/default port and the next two ports, with `ORCA_LOOPBACK_PORT` as an override ([port selection](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L389-L407)).
2. [build_login_cmd](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L895-L919) sends `action: login_config`, auth backend URL, publishable key and PKCE bundle to the hosted WebView. The deployed login asset handles `login_config`, builds `/auth/v1/authorize` with `provider`, `code_challenge`, `code_challenge_method=S256`, and `redirect_to`; its `Bg` helper appends `orca_state` to the redirect. It sends the resulting URL through `thirdparty_login`.
3. Native [thirdparty_login handling](../../src/slic3r/GUI/WebUserLoginDialog.cpp#L509) starts its loopback server and launches the system browser. Orca Auth mediates social login through its own `/auth/v1/callback`, then returns a Supabase `code` to the slicer callback. Native [callback handling](../../src/slic3r/GUI/HttpServer.cpp#L225) reads `code` and `orca_state` (falling back to `state`) and passes them to the cloud agent.
4. [exchange_auth_code](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L691-L729) validates expected state, then POSTs JSON `{"auth_code":"…","code_verifier":"…"}` to `https://auth.orcaslicer.com/auth/v1/token?grant_type=pkce`. [http_post_token](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L2346-L2389) sends the `apikey`, JSON content type and verified TLS, and explicitly removes `Authorization` for token exchange.
5. The returned access/refresh tokens and user identity establish the session ([session parsing](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L1995-L2036)). Native [build_login_info](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L924-L939) deliberately leaves tokens empty in the WebView payload. Refresh-token persistence uses a secret store or encrypted fallback ([persistence implementation](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L1553)).
6. Refresh POSTs `{"refresh_token":"…"}` to `/auth/v1/token?grant_type=refresh_token` ([refresh implementation](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L1869-L1898)). The native skew is 900 seconds; refresh-token rotation is serialized across native processes ([constants and locking rationale](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L116-L125)). Data requests refresh before use and retry after an unauthorized result ([HTTP helpers](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L2082-L2146)).

A browser page cannot reproduce the native localhost listener by navigating to `localhost`: that address refers to the browser user's machine. Automatic return to a hosted backend needs a hosted HTTPS callback. A manual return can instead use `http://localhost:41172/callback`: after provider login, the user copies the complete URL from the failed localhost navigation and pastes it into WebOrca. WebOrca must have initiated that flow and retained its PKCE verifier; a callback from an independently initiated desktop login will not work. The current bridge already accepts this callback base and the dialog already offers manual completion ([complete](gateway/orcaCloud.ts#L137), [manual callback field](src/orcaCloud/CloudDialog.tsx#L131)). State, callback base, expiry and one-time code validation remain required. This fallback avoids requiring a newly registered hosted redirect if Orca accepts its native callback for this flow; it does not bypass the sync API's CORS restriction. No completed login was performed to verify that assumption. Supabase redirect documentation establishes the allowlist requirement, but this research did not inspect Orca's private allowlist or prove registration of WebOrca's URL.

### Profile synchronization and signing

| Request on `api.orcaslicer.com` | Native behavior/source |
| --- | --- |
| `GET /api/v1/health` | Connectivity check ([connect_server](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L966-L979)). |
| `GET /api/v1/sync/pull[?cursor=<timestamp>]` | Response has `next_cursor`, `upserts` (`id`, `name`, `content`, `updated_time`, `created_time`), and deleted IDs. 304 means no changes; 410 clears cursor and repeats a full pull ([sync_pull](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L1315-L1378)). |
| `POST /api/v1/sync/push` | JSON `id`, `name`, `content`; existing profiles include `original_updated_time`. Client enforces 1,048,576-byte payload limit; 200 returns `updated_time`, 409 is a conflict ([sync_push](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L1388-L1468)). |
| `POST /api/v1/sync/force-push` | Same payload with force selected; conflict handling must remain explicit (same source). |
| `DELETE /api/v1/sync/delete?resource=profiles&id=<setting_id>` | Native profile deletion ([delete_setting](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L1290-L1309)). |

`/api/v1/sync/profiles` is declared as a constant but has no call site in this agent; it should not be substituted for pull based on its name. Native new profile IDs use UUIDv5 over the preset name, scoped by user ID when present ([generate_uuid_for_setting_id](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L531-L546)).

The traced native data helpers send **`Authorization: Bearer <access_token>`**, inherited auth headers (including the public `apikey`) and JSON content type when applicable ([data_headers and GET](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L2072-L2123), [POST](https://github.com/OrcaSlicer/OrcaSlicer/blob/e5324ae319708367540a648e8591261ab1136e5e/src/slic3r/Utils/OrcaCloudServiceAgent.cpp#L2160-L2185)). **No HMAC, device signature, timestamp signature or private application signing key appears in these request paths.** PKCE's SHA-256 challenge proves possession of the verifier during auth; it is not per-request API signing. This conclusion concerns the traced client protocol, not uninspected backend internals.

## Comparison with the current web implementation

| Area | Current implementation and consequence |
| --- | --- |
| Manual gateway | [account.ts](src/orcaCloud/account.ts#L4) reads `orca-cloud-gateway` from localStorage with an empty default; [cloudClient](src/orcaCloud/account.ts#L38) rejects missing configuration. [CloudDialog](src/orcaCloud/CloudDialog.tsx#L117) exposes the address input. This is WebOrca's own requirement. Entering Orca's API URL would fail because the client calls WebOrca-specific `/_orca-cloud/*` routes. |
| Browser transport | [client.ts](src/orcaCloud/client.ts#L21) calls gateway status/begin/complete/logout/api routes, using a random 32-byte browser session credential, custom headers, no cookies and Web Locks. OAuth tokens stay at the gateway; this browser credential is not an Orca upstream token. |
| Upstream auth | [gateway/orcaCloud.ts](gateway/orcaCloud.ts#L78) already uses the native publishable key, auth endpoint and PKCE/refresh JSON bodies. [begin/complete](gateway/orcaCloud.ts#L115) creates a five-minute flow, appends `orca_state`, validates callback base/state and exchanges the code. It navigates directly to Orca Auth's authorize endpoint instead of embedding the hosted slicer login page. |
| Callback configuration | [callbackUrl](gateway/orcaCloud.ts#L25) permits HTTPS or the exact desktop-style localhost callback. `callbackConfirmed` is an operator assertion, not an upstream check: [status](gateway/orcaCloud.ts#L106) reports it; [begin](gateway/orcaCloud.ts#L115) requires a callback but does not block an unconfirmed one. |
| Session/refresh | [gateway session management](gateway/orcaCloud.ts#L52) keeps tokens in memory, separates clients by app origin and browser credential, serializes operations, rotates refresh tokens, refreshes within 30 seconds of expiry and retries once after 401 ([api](gateway/orcaCloud.ts#L191)). Restart loses sessions. This differs from native durable refresh storage and 15-minute skew. |
| Upstream sync | [apiPath](gateway/orcaCloud.ts#L36) permits fixed sync routes and optional writes. [api](gateway/orcaCloud.ts#L177) enforces schema/size and sends a bearer token; it omits native's `apikey` on data requests. Whether authenticated data calls require that key was not tested. Browser [sync.ts](src/orcaCloud/sync.ts#L60) already implements cursor reset, conflicts, revisions and acknowledgements. |
| Preset compatibility | [codec.ts](src/orcaCloud/codec.ts#L3) maps native `print` profiles to web `process`, preserves raw content, and refuses credential-bearing keys. Web [backupLocal](src/orcaCloud/sync.ts#L49) uses random UUIDs rather than native deterministic IDs. These are local compatibility choices, not evidence of a different cloud service. |
| Deployment | The [deployment server](../deploy/server.mjs) mounts the same-origin [cloud bridge](gateway/orcaCloud.ts), enabled with `ORCA_PRINTER_CLOUD=orca-cloud`; callback and write flags come from `ORCA_CLOUD_CALLBACK`, `ORCA_CLOUD_CALLBACK_CONFIRMED`, `ORCA_CLOUD_PRESET_WRITES`. |

The existing [main callback route](src/main.tsx#L8) removes callback parameters from browser history, then [CloudCallback](src/orcaCloud/CloudCallback.tsx#L6) submits the captured URL to the gateway. A remote deployment cannot receive callbacks arriving on the user's localhost; use the configured public callback or the manual callback flow.

## Anonymous HTTP evidence

Requests used curl with TLS verification, no cookie jar, no Authorization token, no account session and a 25-second timeout. Redirect probes were **not followed** to social providers. Synthetic RFC 7636 example challenge and `anonymous-research` state were used, not a real user's authorization flow. Headers below are the relevant returned headers; cookies, transient OAuth state and Cloudflare reporting headers are omitted. Status success alone does not establish CORS success.

| Time UTC | Request | Status and relevant response |
| --- | --- | --- |
| 10:32:01 | `GET https://cloud.orcaslicer.com/orcaslicer-login` | HTTP/2 200; `Content-Type: text/html; charset=utf-8`; `Access-Control-Allow-Origin: *`; `X-Frame-Options: DENY`; `Content-Security-Policy: frame-ancestors 'none'`. |
| 10:32:01 | API `GET /api/v1/health`, Origin WebOrca | HTTP/2 200; JSON; `Vary: Origin, accept-encoding`; **no ACAO**. |
| 10:32:01 | API `GET /api/v1/sync/pull`, Origin WebOrca | HTTP/2 401; body `{"error":"missing_authorization"}`; `Vary: Origin, accept-encoding`; **no ACAO**. |
| 10:32:20 | API pull `OPTIONS`, Origin WebOrca, requested method GET, header `authorization` | HTTP/2 204; **no ACAO**; allowed methods `GET,POST,PUT,PATCH,DELETE,OPTIONS`; allowed headers `Authorization,Content-Type,X-Provider-Key,X-Model-Url`; max-age 86400; `Vary: Origin, Access-Control-Request-Headers, accept-encoding`. |
| 10:32:19 | Same API pull preflight, Origin `https://cloud.orcaslicer.com` | HTTP/2 204; **`Access-Control-Allow-Origin: https://cloud.orcaslicer.com`**; same allowed methods/headers and max-age. |
| 10:32:19 | API push `OPTIONS`, Origin WebOrca, method POST, headers `authorization,content-type` | HTTP/2 204; **no ACAO**; same API allowed methods/headers and max-age. No POST was sent. |
| 10:32:19 | Auth `/auth/v1/token?grant_type=pkce` `OPTIONS`, Origin WebOrca, method POST, headers `apikey,content-type` | HTTP/2 200; **ACAO `*`**; allowed headers `apikey,content-type`; allowed methods `GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS,TRACE,CONNECT`; max-age 3600; `sb-project-ref: kmaujjxeqrqungoncqzv`. No token POST was sent. |
| 10:32:46 | Auth authorize GET, Google, S256 challenge, WebOrca redirect | HTTP/2 302 to Google; `redirect_uri=https://auth.orcaslicer.com/auth/v1/callback`; client ID recorded above; requested `redirect_to` echoed. |
| 10:33:01 | Equivalent authorize GET, GitHub | HTTP/2 302 to GitHub; same auth callback; client ID above; requested `redirect_to` echoed. |
| 10:33:01 | Equivalent authorize GET, Apple | HTTP/2 302 to Apple; same auth callback; client ID above; `response_mode=form_post`. |
| 10:36:52 | API pull `OPTIONS`, Origin `https://server-1.barbel-hops.ts.net:5070`, method GET, header `authorization` | HTTP/2 204; **no ACAO**; same API allowed methods/headers as above. |
| 10:36:52 | API push `OPTIONS`, same live Tailscale origin, method POST, headers `authorization,content-type` | HTTP/2 204; **no ACAO**; same API allowed methods/headers. No POST was sent. |
| 10:36:52 | Auth token `OPTIONS`, same live Tailscale origin, method POST, headers `apikey,content-type` | HTTP/2 200; **ACAO `*`**; allowed headers `apikey,content-type`; same Auth allowed methods. No token POST was sent. |

Here “Origin WebOrca” means exactly `Origin: https://weborca.noz.am`; the later rows explicitly name the live Tailscale origin. API and Auth mean the origins listed earlier. These probes do not establish authenticated response headers, callback allowlisting, token exchange success, refresh success, write authorization, untested deployment origins, or all browser policy interactions. They do establish that the sampled WebOrca preflights lack the required allowed-origin header. Curl does not enforce browser CORS; the predicted browser restriction follows from the measured headers plus the Fetch specification.

The API preflight also omitted `apikey` from allowed headers, including for Orca's own cloud origin. Blindly copying every native header into a browser implementation would introduce another preflight concern. The current backend's omission of that header on sync is plausible, but authenticated validation remains necessary.

### Reproduce the non-mutating probes

These commands inspect headers without sending a token exchange or preset write:

```sh
curl -sS --max-time 25 -D - -o /dev/null \
  -H 'Origin: https://weborca.noz.am' \
  https://api.orcaslicer.com/api/v1/sync/pull

curl -sS --max-time 25 -D - -o /dev/null -X OPTIONS \
  -H 'Origin: https://weborca.noz.am' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization' \
  https://api.orcaslicer.com/api/v1/sync/pull

curl -sS --max-time 25 -D - -o /dev/null -X OPTIONS \
  -H 'Origin: https://cloud.orcaslicer.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization' \
  https://api.orcaslicer.com/api/v1/sync/pull

curl -sS --max-time 25 -D - -o /dev/null -X OPTIONS \
  -H 'Origin: https://weborca.noz.am' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type' \
  https://api.orcaslicer.com/api/v1/sync/push

curl -sS --max-time 25 -D - -o /dev/null -X OPTIONS \
  -H 'Origin: https://weborca.noz.am' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: apikey,content-type' \
  'https://auth.orcaslicer.com/auth/v1/token?grant_type=pkce'

# Deliberately no -L: inspect only the first redirect, without visiting Google.
curl -sS --max-time 25 -G -D - -o /dev/null \
  --data-urlencode 'provider=google' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'redirect_to=https://weborca.noz.am/orca-cloud/callback?orca_state=anonymous-research' \
  https://auth.orcaslicer.com/auth/v1/authorize
```

Replace `provider=google` with `provider=github` or `provider=apple` for the other recorded first redirects. The example challenge is public test data, not a reusable real login verifier. Do not interpret a 302 or an echoed `redirect_to` as approval of the final callback.

The three live-origin preflights used the same pull, push and token commands above with only the `Origin` header replaced by `https://server-1.barbel-hops.ts.net:5070`.

## Practical next implementation

1. Mount the existing restricted Orca bridge behind the WebOrca origin at `/_orca-cloud/*`, or reverse-proxy those routes to an operator-run backend. The static deployment server must forward/handle these routes before its GET/HEAD-only check. Default the browser transport to `location.origin` (or deployment-provided configuration), then replace the address input with connection/sign-in status. Keep any operator override outside the ordinary user flow.
2. For automatic return, ask Orca's auth project operator to approve the exact deployed HTTPS callback, including compatibility with the flow's `orca_state` query parameter. For a manual fallback, configure the native `http://localhost:41172/callback` redirect and let users paste the failed callback URL into WebOrca's existing completion field. This could reuse the desktop redirect without registering a new hosted URL; verify the complete flow before claiming it works. Keep the code transient and preserve state/PKCE checks. Set backend callback configuration automatically per deployment. Treat `callbackConfirmed` as an assertion requiring evidence; the flag cannot register a URL upstream.
3. Retain server-held tokens, PKCE/state validation, fixed upstream destinations, per-client isolation and refresh serialization. Account for the current in-memory sessions when deploying multiple instances or restarting. The current bridge requires an explicit matching `Origin` header even for status GET ([handle](gateway/orcaCloud.ts#L207)); when making the browser request same-origin, verify/adapt that check because same-origin GETs need not carry Origin. Do not solve that by removing request/session binding.
4. With a consenting test account in a subsequent authorized task, verify the entire callback/code exchange and authenticated pull in a real browser, then refresh/restart behavior and explicitly enabled writes. That is the remaining validation gate for claiming the integration works; it was outside this research's anonymous scope.

A fully direct browser design remains possible **if** Orca approves both the hosted callback and browser API origins/headers, and subsequent browser validation succeeds. It would need browser-side verifier/token lifecycle and cross-tab refresh coordination instead of the server-held token lifecycle. The publishable key is suitable for public clients; neither its presence nor a successful auth preflight grants permission to read private presets without login. With the presently observed sync CORS policy, the same-origin backend is the practical route to removing manual gateway setup.

## Documentation verification

Relative source targets and line anchors were checked against the working tree. The upstream agent raw source was fetched and compared equal; first-party Supabase and Fetch documents returned HTTP 200 and their referenced sections were inspected. Probe commands above correspond to the executed anonymous requests; their shell syntax was checked separately. No application tests or builds were run because the only change is this report.
