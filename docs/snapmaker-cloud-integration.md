# Snapmaker Cloud integration research

Current release, 2026-11-05: the exact real-tested filament candidate is published on CURRENT5070. Device shows read-only printer-reported material/vendor/subtype/color/presence by tool index. The actual idle comparator matched Grey PLA/Generic, Blue PLA/Bambu Lab Silk, Black PLA/Bambu Lab Matte and White PLA/Generic, all explicitly present. Source/gateway/decoder binding and retention across heater deltas/fresh query passed. Physical unload/reassignment, job lifetime and other accounts remain open. `filaments` stays omitted; read-only `filamentSlots` enables no project sync, uploads or controls. See [actual acceptance](../wasm/build/tests-snapmaker-filaments/actual/report.md), [reconstructed provenance and sealed QA](../wasm/build/tests-snapmaker-filaments/qa-recovered/report.md) and [publication/rollback](../wasm/build/tests-snapmaker-filaments/publication/report.md). Restart cleared OrcaCloud RAM sign-in; browser presets remain. Bambu China and physical Safari/accessibility TODOs remain open.

The bootstrap status paragraph and pinned investigation below are historical, preceding this filament release.

Historical bootstrap release, 2026-11-05: the exact real-tested bootstrap candidate is published to CURRENT5070, alongside International login, refresh, profile and bound-device selection. One password login and two bounded connections passed exact checkAuth device/issued-client/serial binding before public DNS and strict TLS, MQTT CONNACK, four QoS1 SUBACKs and read-only objects.list/subscribe/query. An eight-object snapshot reported standby status and five finite heater temperatures; fresh nonretained heater deltas passed. Optional setSubscribeFilter -32601 uses the existing fallback. TLS credentials remain in connection-only Node memory and durable tokens in browser storage; official Control is not required. Job progress, cleanup and manual Retry passed synthetic acceptance. Other accounts, broader provider capabilities and external-session behavior remain open; materials, uploads and controls are unsupported. See the [real-test report](../wasm/build/tests-snapmaker-monitor-bootstrap/actual-r2/report.md), [publication receipt](../wasm/build/tests-snapmaker-monitor-bootstrap/publication/verification.txt) and [release/rollback report](../wasm/build/tests-snapmaker-monitor-bootstrap/publication/report.md). The earlier [availability-only follow-up](../wasm/build/tests-snapmaker-cloud/live-status-followup/report.md) and pinned investigation below record research history; their implementation blockers describe that earlier state.

Investigated 2026-11-05. **A small international-region login/session/device-list prototype is feasible from first-party source. A complete U1 cloud monitor requires an MQTT/TLS bridge; browser access and third-party client acceptance remain unverified.** No authentication requests, hardware calls, personal sessions, credentials, or private configuration were inspected.

## Evidence and confidence

The contract below is **first-party client behavior**, not a published third-party API guarantee. No public developer registration instructions, WebOrca client registration, or granted third-party access were established in this bounded investigation. Do not label the integration provider-approved or working until an explicitly authorized acceptance run succeeds.

Sources:

- **[O]** Snapmaker/OrcaSlicer commit `6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c`, [compiled official Flutter client](https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js). Citations below give original line ranges. A small extract retaining original line numbers is in `wasm/build/tests-snapmaker-cloud/research/orca-cloud-excerpts.txt`.
- **[A]** Public official identity site [id.snapmaker.com](https://id.snapmaker.com/), observed at `2026-11-05T11:45:39Z`. Its deployed, mutable assets were retained verbatim in the evidence directory: [D7vx6uhb.js](https://id.snapmaker.com/_nuxt/D7vx6uhb.js) (API/auth functions `es`, `ts`, `ns`, `Lr`, `Nr`); [M8tIeOvb.js](https://id.snapmaker.com/_nuxt/M8tIeOvb.js) (login component, `Ee`, `handleLoginResult`, `handleLogin`, `refreshToken`); [u57cwtEB.js](https://id.snapmaker.com/_nuxt/u57cwtEB.js) (redirect allowlist and OIDC continuation); [DT7kNLqo.js](https://id.snapmaker.com/_nuxt/DT7kNLqo.js) (API host). These are minified single-line assets; named functions and retained SHA-256 hashes bound the evidence instead of misleading line ranges.
- **[M]** Snapmaker/server-api-test commit `6a11b67f57ab48d5c1cb4fa1514c0a516fff90a0`: [config.py](https://github.com/Snapmaker/server-api-test/blob/6a11b67f57ab48d5c1cb4fa1514c0a516fff90a0/Api_Check/src/config.py#L10-L35), [monitor.py Basic auth](https://github.com/Snapmaker/server-api-test/blob/6a11b67f57ab48d5c1cb4fa1514c0a516fff90a0/Api_Check/src/monitor.py#L85-L88), [password login monitor](https://github.com/Snapmaker/server-api-test/blob/6a11b67f57ab48d5c1cb4fa1514c0a516fff90a0/Api_Check/src/monitor.py#L1146-L1186). Corroborates hosts and client authentication, but its query-string password transport is not the proposed WebOrca implementation.

## Hosts, regions, and headers

| Use | Exact observed base | Evidence / limitation |
| --- | --- | --- |
| Current international identity web client | `https://api.snapmaker.com`, routes include `/api` | [A] `DT7kNLqo.js`; runtime `window.__APP_CONFIG__.apiBaseURL` can override it. |
| Orca international account/device client | `https://id.snapmaker.com/api` | [O, L34267–34299](https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L34267-L34299). Device calls use `E6()` → configuration `.c` [O, L36810–36816]. |
| Orca China account/device client | `https://api.snapmaker.cn/api` | Same [O] range and [M]. Orca config selects `app-cn` for CN and `mall-app` otherwise. Current CN login flow/client acceptance was not independently established. |

These bases are separately observed; equivalence of `api.snapmaker.com` and `id.snapmaker.com` for every route is unverified. Keep auth and device bases explicit. Start with the international region. Do not infer geographic routing from printer IP or treat the account portal as the device API.

The identity web client sets `accept-language: en-US,en;q=0.9`, `X-Custom-Site` from its public page's `from` setting, optional `X-GA-ID`, and either Basic or Bearer authorization. Basic-auth requests default to `multipart/form-data`; Axios builds the multipart body/boundary. [A, `D7vx6uhb.js` request interceptor and `es`/`ns`]

Orca device requests carry `Authorization: Bearer <access token>`, `Content-Type: application/json`, `App-Version`, `OS: Orca`, `Device-Type: Orca-Web`, `Accept-Language`, `X-Trace-ID`, `X-Custom-Site: Lava-Orca`. These are observed headers; which metadata fields the provider requires is unverified. WebOrca should identify itself honestly instead of claiming to be Orca's packaged client. [O, L137240–137266, L169058–169067]

## Exact minimal authentication/session contract

All routes in this section use the current identity web base `https://api.snapmaker.com`.

| Operation | Method/path | Body / authorization | Parsed response |
| --- | --- | --- | --- |
| Request email login code | `POST /api/common/accounts/sendVerificationCode` | `{account: email, action: "oauth"}`; no Basic authorization; a previously present Bearer cookie may be attached by the official client | Envelope `code === 200`; no code-delivery payload required by UI |
| Exchange email code | `POST /api/oauth2/token` | Multipart fields `scope="profile openid"`, `email`, `grant_type="urn:ietf:params:oauth:grant-type:email"`, `code`; Basic header below | `{code:200, data:{access_token, refresh_token, ...}, ...}` |
| Password login | `POST /api/oauth2/token` | Multipart fields `scope="profile openid"`, `username=email`, `password=sha256Hex(email + "$sm-nonce@" + enteredPassword)`, `grant_type="password"`; same Basic header | Same envelope |
| Refresh | `POST /api/oauth2/token` | Multipart `grant_type="refresh_token"`, `refresh_token`; same Basic header; official refresh helper does not add `scope` | Same envelope; official UI replaces both access and refresh tokens |
| Validate session/profile | `GET /api/common/accounts/current` | `Authorization: Bearer <access_token>` | Envelope `code===200`, `data.id` truthy is the official UI's logged-in check |

Evidence: [A] `D7vx6uhb.js` functions `es`, `ts`, `ns`, `Lr`; `M8tIeOvb.js` `Ee`, `handleLogin`, `handleLoginResult`, `checkStatus`, `refreshToken`. `es` adds the scope and hashes a supplied password before sending. It does not hash an email code. Bodies above specify fields, not literal multipart wire boundaries.

The public client embeds `Authorization: Basic bWFsbC1hcHA6MTIzNDU2` (`mall-app:123456`). This is a published first-party web-client identifier/credential, **not a WebOrca registration or proof of permission to reuse it**. [A, `D7vx6uhb.js`, `Ir`/`jr`] [M] obtains its client ID/secret from its own environment instead. No self-service registration URL or evidence that every third-party integration must obtain a new registration was established. Reuse permission and acceptance of this identity from WebOrca remain unresolved before production use.

The UI requires acceptance of Snapmaker terms before sending a code or logging in. Preserve that user decision. [A, `M8tIeOvb.js`, `checkAgree`]

No access-token lifetime, refresh-token lifetime, rotation grace period, JWT claim contract, or revocation endpoint was established. The official UI stores a refresh cookie for 30 days; that cookie setting does **not** establish server token lifetime. Its error parser recognizes HTTP/business `401`, `110002` (authorization missing), `110003` (expired), `110004` (authentication failed), and clears cookies on these auth failures. [A, `D7vx6uhb.js`, `Nr`; `M8tIeOvb.js`, `setCookies`] Orca also treats business codes `100000..199999` as token invalidation [O, L137842–137877]. Proposed behavior: one serialized refresh/retry for a positively identified auth error, then require login; retain rotated tokens in the browser and never retry mutations automatically without an idempotency contract.

### Hosted login / OAuth limits

The login UI accepts `?redirect=...` and can append `?token=<access token>` to the return URL. Its allowlist is `snapmaker.com`, `kuaizao.org`, `s.com` and their subdomains, plus `localhost`, `127.0.0.1`, `[::1]`. HTTPS is allowed; HTTP requires a loopback hostname. A normal WebOrca deployment is excluded. The redirect returns an access token, not the refresh token. [A, `u57cwtEB.js`, `Z`/`Q`, `te`, `ne`, `b`; `M8tIeOvb.js`, `redirectWithToken`]

The site also contains an OIDC continuation bridge: same-origin `/oauth2/authorize` continuation, `POST /api/oauth2/login/ticket` with Bearer authorization, then `/api/oauth2/login/establish?ticket=...&continue=...`. This is evidence of an internal account bridge, not an established third-party PKCE/client-registration contract. [A, `u57cwtEB.js`, `w`, `Pe`] Do not bypass the redirect allowlist or assume a generic OAuth authorization-code flow works for WebOrca.

## Bound devices

Use the Orca regional device base above:

```text
POST /user/device/list
Authorization: Bearer <access token>
Content-Type: application/json

{"name":null,"mac":null,"sn":null,"productName":null,
 "productCode":null,"pageIndex":null,"pageRows":null}
```

The client accepts successful envelopes with `code: 0` or `200`, reads `data` as a **list**, and reads an optional envelope `page`. Do not assume `data.records` or `data.devices`. [O, L36773–36795; L138184–138224]

Each list item is consumed using `name`, `deviceId`, `sn`, `mac`, `productId`, `status`, `online`, `ip`, `port`. `deviceId`, `sn`, and `productId` are converted to strings; default status/online are numeric `0`; default port is `8883`. Their numeric enum meanings are not established by this list parser. An IP field is not permission to connect to an arbitrary LAN destination. [O, L145476–145504]

`GET /user/device/info?deviceId=<id>&sn=<serial>` returns successful `data` as a map; its complete schema was not established. [O, L36796–36809] Bind/unbind are present (`POST /user/device/bind`, `/user/device/unbind`, legacy `/user/device/connect/auth`) but are unnecessary for an MVP that lists already-bound printers [O, L36658–36769]. Bind through the official app initially.

## U1 status, materials, uploads, and controls

| Capability | First-party evidence | Implementation consequence |
| --- | --- | --- |
| MQTT credentials | `GET /user/device/getMqttCert`, no body, Bearer; `data` parsed into endpoint/port/client ID/certificate/private key/topics. Parser accepts `endpoint` or `ip`, default port `8883`, `cert` or `secretId`, `key` or `secretKey`, `ca` or `trustCert`, `clientId` or `clientid`, `topics.subscribe`/`topics.publish` or flat `subscribeTopics`/`publishTopics`. Official code supplies Amazon Root CA 1 after parsing. [O, L36699–36722, L35322–35342] | These are sensitive user-scoped credentials. Their issue/expiry/revocation behavior and browser WebSocket alternative were not established. Do not invent a fixed IoT hostname. |
| Cloud transport | Orca builds `mqtts://<returned endpoint>:<returned port>` when certificate/key/CA are present. Requests/responses/status/notifications use serial plus supplied topic suffixes; defaults include `<sn>/request`, `<sn>/response`, `<sn>/status`, `<sn>/notification`. It also has config/client-ID topics. [O, L168100–168125, L139215–139250, L43800–43864] | Ordinary browsers cannot open raw MQTT/TLS sockets or present these client certificates through Fetch/WebSocket. No supported `wss://` cloud endpoint was established. A native/gateway bridge is required unless Snapmaker supplies a browser transport. Topic transforms/handshake need a focused follow-up before a relay implementation. |
| Telemetry | JSON-RPC 2.0 methods `printer.objects.list`, `printer.objects.query`, `printer.objects.subscribe`, `printer.objects.setSubscribeFilter`; query/subscribe `params.objects` maps object names to field arrays/null; filter also has `params.sn`. [O, L138679–138757] `print_stats` fields include `filename,state,total_duration,print_duration,filament_used,message,info`; `display_status.progress`; `heater_bed.temperature/target`; extruder temperature/target/nozzle diameter/index. [O, L35185–35224] | Live monitoring is source-backed over the MQTT command transport. No equivalent cloud HTTP telemetry route was established. Treat list `online` separately from live connection and printing state. |
| Filament metadata | `print_task_config` includes `filament_vendor`, `filament_type`, `filament_sku`, `filament_official`, `filament_sub_type`, `filament_color`, `filament_color_rgba`, `extruder_map_table`, `extruders_used`, `filament_exist`, `filament_soft`, `filament_color_multi`, replenishment fields; `filament_feed left/right` and `filament_detect` are query objects. [O, L35185–35224] | Queryable fields are evidenced; an authoritative mapping to physical U1 loaded slots, array indexing, emptiness, and color encoding still needs source tracing or sanitized acceptance fixtures. Do not enable automatic filament sync from field names alone. |
| Upload | `POST /user/device/upload/create` with JSON `fileName`, `checkSum`, `contentType:"application/octet-stream"`, optional `deviceId`, optional `ownerId`; files over 5 MiB add `uploadParts:[{partNumber,checkSum},...]`. Successful direct response contains `url` and `method`. Upload bytes to that returned URL using that method and `Content-Type` plus `x-amz-checksum-sha256`; then `POST /user/device/upload/completed` with original metadata; successful `data.url` or `data.filePath` identifies uploaded file. [O, L138447–138514, L156660–156705] | Direct presigned upload is evidenced. Multipart finalization, checksum encoding, URL host policy, expiry, maximum size, cancellation and cleanup need completing before enabling uploads. Upload alone does not prove a print began. |
| Start/control | MQTT JSON-RPC `printer.print.start` with `params.filename`; pause/resume/cancel; `printer.gcode.script` with `params.script`. Cloud-aware methods `server.files.pull` and `server.files.start_cloud_print` accept `type,url,auto_start` plus optional `checksum,size,print_plate`; cloud print also accepts `options,extra_info`. [O, L138548–138757] | Command vocabulary is evidenced; `type` values, transport envelope/handshake, authorization, completion/error semantics and safe retry behavior remain to be pinned. Do not expose arbitrary G-code or mark cloud control supported yet. |

The device-list constructor explicitly uses `snapmakerU1Cover.png`, and the same client's preset fallback is `Snapmaker U1 (0.4 nozzle)` [O, L145476–145504, L139077–139089]. This connects the investigated cloud client to U1; it does not establish identical cloud support for J1, Artisan, or Snapmaker 2.0.

## Concrete next implementation

1. Build an international-only experimental **email-code login → refresh → validate account → list already-bound printers** adapter using the exact contracts above. Password login is source-backed but unnecessary for this minimal slice. Gate a supported-provider claim on successful acceptance; resolve client identity reuse with Snapmaker before production use. Do not claim the public embedded identity is an independent registration.
2. Store durable access/refresh tokens only in the browser's existing cloud-session storage. Keep email codes/passwords in memory only. If cross-origin requests fail, use a narrowly allowlisted stateless HTTPS relay; forward credentials only for the current request and return `Cache-Control: no-store`. Never store tokens in server sessions, databases, files, logs, tracing, URLs, or durable queues. This is the WebOrca design requirement, not a claim about Snapmaker's implementation.
3. Validate cross-host token audience (`api.snapmaker.com` login token → `id.snapmaker.com/api/user/device/list`) and origin/CORS acceptance in a separately authorized account run. This research made no auth or preflight probes. Do not silently switch API hosts on auth failures. If the provider rejects the client/origin or cross-host token, obtain an approved client and routing contract before proceeding.
4. Present the account-bound printer list and raw provider availability conservatively. Full status/filament/control requires a subsequent bounded investigation of the MQTT handshake/topic transforms and bridge integration. Keep certificates/keys in browser storage or connection-scoped gateway memory only; tear down and erase the gateway's memory on disconnect. Server credential/token persistence is not required by the observed HTTP flows, but durable refresh does require browser ownership of the refresh token.

**Actual blockers:** hosted login cannot redirect to a normal WebOrca origin under its current allowlist, and raw MQTT/TLS is a concrete browser transport limitation for full U1 monitoring. Direct-login client acceptance, cross-host token audience and deployment-origin access are validation prerequisites, not proven failures or proof that registration is mandatory. The HTTP account/device-list prototype can be prepared now; calling it a functioning full cloud integration would exceed the evidence.

## Checks and retained evidence

Public GitHub source URLs and the four live identity assets were fetched successfully with `curl -LfsS`. A speculative `/login` page and unrelated strings encountered while enumerating asset names returned 404; neither is used as a contract or dependency. No builds/tests were run because only research documentation and public source evidence were added. No production source, runtime, commits, or Taproot state changed.

The evidence directory is ignored by the repository's build-output rules; retain it as the local research artifact rather than assuming it will be included in a future commit. Its [manifest](../wasm/build/tests-snapmaker-cloud/research/manifest.md) records source URLs, original line ranges and SHA-256 hashes. Re-fetch only the public static sources to reproduce the findings; no API invocation commands are needed.
