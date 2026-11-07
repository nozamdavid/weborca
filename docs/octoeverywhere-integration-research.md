# OctoEverywhere integration research

Investigated **2026-11-05**. Research only: official public documentation and first-party source, plus a brief reading of WebOrca's existing printer interfaces. No accounts, credentials, authorization flows, devices, or API mutations were used.

**Recommendation:** keep adding printers normally, then offer an optional OctoEverywhere connection on that saved printer. First ship a user-provided **Open printer in OctoEverywhere** external link. Full remote monitoring, transfers, and control are a separate App Connection integration: OctoEverywhere assigns the app an ID, the user authorizes one printer through its portal, and **the printer owner currently needs Supporter Perks**. “OctoEverywhere is installed” alone supplies neither credentials nor a safe association with a particular saved printer. [App Connections][app] [Portal][portal] [Info API][info]

## Evidence and confidence

All external references below were accessed on 2026-11-05. These are published contracts and source observations, **not verified WebOrca interoperability**. The official documentation source was pinned at [`OctoEverywhere/api-docs` commit `8ff913a96c96eb0dfe141d352cf78cd0d3dc9850`](https://github.com/OctoEverywhere/api-docs/tree/8ff913a96c96eb0dfe141d352cf78cd0d3dc9850). Implementation observations use [`QuinnDamerell/OctoPrint-OctoEverywhere` commit `0f19f5dcca23a5047938cb3c2aeb30691ed4d238`](https://github.com/QuinnDamerell/OctoPrint-OctoEverywhere/tree/0f19f5dcca23a5047938cb3c2aeb30691ed4d238), linked by the official project. Installed versions can differ.

### Three different access contracts

| Access | User experience / capabilities | Integrator requirements |
| --- | --- | --- |
| Normal consumer browser access | Opens OctoEverywhere's printer page; the user signs in there. Free accounts have browser remote access with plan limits. | An external link requires no App Connection, app token, or developer integration. User supplies the printer's normal access URL unless it was obtained from an earlier authorized connection. This is a technical conclusion, not a claim of partner endorsement. |
| Shared Connection | User-created remote URL usable for native printer APIs and Plugin APIs; holder can access the printer, subject to host authentication and configured expiry. | Manual setup can avoid App Portal enrollment, but Shared Connections also currently require Supporter Perks. Treat the URL and any auth as sensitive; do not call this a free or restricted read-only alternative. |
| App Connection | Per-user, per-printer remote endpoint and credentials; hosted login, printer selection, authorization; App APIs for connection/account context and extras. | Assigned app ID and portal integration; Supporter Perks for the printer owner; secure credential handling and error recovery. |

Sources: [pricing][pricing], [Shared Connections][shared], [App Connections][app], [Info API][info]. `userPrinterAccessUrl` / `UserFacingPrinterUrl` is expressly a user-facing link requiring login, **not** the authenticated App Connection URL. An ordinary browser tab can open that link without exposing WebOrca's own tokens. An iframe needs separate technical and terms review. [Portal][portal] [Terms][terms]

## App Portal, credentials, and saved-printer association

This is documented as an **OAuth-style hosted flow**, not a documented OAuth 2 authorization-code/PKCE API. Do not invent token exchange, scopes, refresh tokens, discovery endpoints, or account-wide device-list access. [App Connections][app] [Portal][portal]

1. Open `GET https://octoeverywhere.com/appportal/v1/?appid=<assigned_app_id>`. Optional parameters: URL-encoded `returnUrl`, `appLogoUrl`, `octoPrintApiKeyAppName`, and `printerId`.
2. Portal handles sign-in/account creation, printer installation/linking if needed, Supporter upgrade if needed, then printer selection and app authorization.
3. Capture the completion navigation to the custom return URL or default `https://octoeverywhere.com/appportal/v1/complete`; process `success` before storing anything.
4. Success returns `id`, `url`, `appApiToken`, `printername`, `userPrinterAccessUrl`, optional `printerLastKnownLocalIp`, and conditional `authBasicHttpUser`/`authBasicHttpPassword` or `authBearerToken`. Optional `octoPrintApiKey` is separate host authentication. Store the connection on the intended saved printer after confirming the selected printer.

Source: [Portal][portal]. Crucial enrollment excerpt: **“The App ID assigned to your app by OctoEverywhere.”** The docs provide a demo ID (`devtest`), but no production self-service registration procedure, approval checklist, fee, client-secret requirement, redirect allowlist rules, or documented bearer-versus-basic selection mechanism. Contacting the [developer team](https://octoeverywhere.com/support) to obtain an ID and clarify browser callbacks is a prerequisite before promising production App Connections. No contact was made for this research.

The completion parameters are returned **once** and cannot be fetched later; loss requires another App Connection. A connection normally survives until account deletion, printer removal, or user revocation; error docs also describe expiration without specifying a universal lifetime. Supporter loss suspends access and restoring perks reactivates the existing connection. There is no documented refresh-token dance. [Portal][portal] [App Connections][app] [Errors][errors]

**Discovery:** the portal selects a printer; each additional printer needs its own connection. A locally reachable OctoPrint instance exposes its OctoEverywhere Printer ID through `GET /api/plugin/octoeverywhere`, which can preselect `printerId`. Returned LAN IPs are hints, not stable identity or proof of current reachability. No general account printer-list API or corresponding local discovery contract for every host was established. Portal completion does not document a host-type field, so preserve the existing host choice and verify compatibility rather than infer it from a name/IP. [Portal][portal] [Info API][info]

**OctoPrint key assistance:** request `octoPrintApiKeyAppName` (2–60 characters). Generation is best effort; missing keys require manual host credentials. The portal can require an additional email challenge; logged-in OctoEverywhere authorization does not guarantee key generation. [OctoPrint key generation][keygen]

## Native relay versus common Plugin APIs

**Native relay:** substitute the App Connection HTTPS host for the local printer origin, preserving native routes and semantics. Documentation supports HTTP methods, request/response bodies and headers, uploads/downloads, webcam streaming, and WebSockets. Keep OctoPrint/Moonraker authentication as required in addition to OctoEverywhere authentication. This does not convert a printer into another protocol or make Bambu MQTT/FTPS into OctoPrint REST. [Remote access][remote] [Using connections][usage]

**Common Plugin APIs:** use `/octoeverywhere-command-api/...` on an App or Shared Connection host. They normalize status, cameras, controls, and selected filesystem operations across platforms. Coverage varies; generic overview language does not guarantee every command on every printer. [Plugin overview][plugin] [Files][files] [Controls][control]

### Feature matrix by underlying host

“Common” below means OctoEverywhere Plugin API, not the host's native API. Read actual `Features` and handle unsupported responses on each installed plugin.

| Underlying host | Native transport / applicability | Common status and camera | Common optional controls observed in pinned source | Common files / start |
| --- | --- | --- | --- | --- |
| OctoPrint | HTTP native API and WebSocket relay; closest match to WebOrca's existing HTTP adapter. | Documented, fields/cameras depend on host. | Start bit only. Native OctoPrint controls remain a separate route to broader control. | G-code list/upload/download/delete/details; logs list/download/delete. Start supported. |
| Klipper / Moonraker | Native HTTP and `/websocket` JSON-RPC relay; existing adapter can inform reuse. | Documented; host configuration matters. | Lights, move, home, extrude, temperature, start. | G-code/config/log listing; G-code/config upload/delete; downloads include logs; G-code metadata and start. |
| Bambu Lab | MQTT via OE's WSS proxy; files via Plugin APIs. Not a transparent raw FTPS connection or reuse of WebOrca's LAN MQTT bridge URL. | Documented; optional material topology available when reported. | Lights and start; no common move/home/extrude/temp bits in pinned handler. | G-code root list/upload/download/delete/basic details; start includes Bambu `.3mf` plate/AMS options. |
| PrusaLink | Native HTTP relay documented; native authentication remains applicable. | Documented. | Start bit only. | Common Files API explicitly unsupported; common start supports an existing path and optional storage. Native PrusaLink file routes are a separate possibility to verify. |
| Elegoo Centauri Carbon (CC1) | Official remote-access support; do not assume Moonraker or Bambu protocol compatibility. | Documented. | Lights and home. | Common Files API and common start unsupported. Native transfer behavior needs separate host research. |
| Elegoo Centauri Carbon 2 (CC2) | Official support plus MQTT WSS proxy. | Documented. | Lights, home, move, temperature. | Common Files API and common start unsupported. MQTT command access does not prove upload support. |
| Other supported printers | Plugin docs name Sovol, Snapmaker; status/webcam docs also name Creality. | Broad support stated, conditional fields. | Unestablished per-model coverage; query feature flags. | No blanket transfer/start promise. Match the actual host and installation mode. |

Sources: [native supported hosts][remote], [Plugin overview][plugin], [status][status], [webcams][webcam], [files matrix][files], [control contract][control], [MQTT contract][mqtt]. Source feature handlers: [OctoPrint](https://github.com/QuinnDamerell/OctoPrint-OctoEverywhere/blob/0f19f5dcca23a5047938cb3c2aeb30691ed4d238/octoprint_octoeverywhere/octoprintcommandhandler.py#L223), [Moonraker](https://github.com/QuinnDamerell/OctoPrint-OctoEverywhere/blob/0f19f5dcca23a5047938cb3c2aeb30691ed4d238/moonraker_octoeverywhere/moonrakercommandhandler.py#L395), [Bambu](https://github.com/QuinnDamerell/OctoPrint-OctoEverywhere/blob/0f19f5dcca23a5047938cb3c2aeb30691ed4d238/bambu_octoeverywhere/bambucommandhandler.py#L338), [PrusaLink](https://github.com/QuinnDamerell/OctoPrint-OctoEverywhere/blob/0f19f5dcca23a5047938cb3c2aeb30691ed4d238/prusalink_octoeverywhere/prusalinkcommandhandler.py#L108), [CC1](https://github.com/QuinnDamerell/OctoPrint-OctoEverywhere/blob/0f19f5dcca23a5047938cb3c2aeb30691ed4d238/elegoo_octoeverywhere/elegoocommandhandler.py#L148), [CC2](https://github.com/QuinnDamerell/OctoPrint-OctoEverywhere/blob/0f19f5dcca23a5047938cb3c2aeb30691ed4d238/elegoo_cc2_octoeverywhere/elegoocc2commandhandler.py#L121).

### Protocol and mapping details that affect scope

- **Authentication layers:** use `Authorization: Basic ...` or `Authorization: Bearer ...` for App Connection requests, including WebSocket upgrades and cameras. `AppToken` carries the separate `appApiToken` to App APIs at `octoeverywhere.com`. Never substitute an OctoPrint key, relay bearer token, and App API token for each other. Conflicts where a native host also needs `Authorization` need explicit resolution. [Usage][usage] [Info][info]
- **HTTP/WebSocket/socket.io:** HTTP and WebSockets are expressly supported. No socket.io-specific compatibility/version/upgrade guarantee was found. socket.io includes HTTP polling/upgrade behavior and cannot be treated as an ordinary standalone WebSocket API without verification. WebOrca's OctoPrint adapter currently polls HTTP, so it does not need a new socket.io client. [Usage][usage] [Local OctoPrint adapter](../wasm/app/src/printers/octoprint.ts)
- **MQTT:** `wss://<connection-host>/octoeverywhere-command-api/proxy/mqtt` supports MQTT 3.1.1 (protocol level 4), not MQTT 5. It exposes native publish/subscribe topics for Bambu and CC2. No printer-side MQTT credentials are required by the client: the plugin handles them. Clients unable to set upgrade headers may use documented `oe_api_key` query auth (bearer token, or base64 basic credentials). The proxy shares one underlying printer MQTT connection; this is not a documented unlimited client quota. Local MQTT listeners are a different raw TCP/TLS service and are not browser APIs. [MQTT][mqtt]
- **Status/materials:** common `status` returns normalized state, progress in **0–100**, temperatures, print/layer/timing details, features, and camera summary; some fields can be absent/null/zero. `IncludeMaterialSystem=true` opts into source/tool/unit/route topology. Preserve source-to-tool links and unknown presence; do not flatten by matching slot indices. WebOrca progress expects **0–1** and has distinct filament and physical slot interfaces. A read-only material display is possible; preset synchronization and valid AMS print mapping need separate work. [Status][status] [Local types](../wasm/app/src/printers/types.ts)
- **Controls:** optional feature bits cover lights, move, home, extrude, temperature, start. Pause/resume/cancel depend on state and have no feature bits. The common temperature endpoint currently accepts bed/chamber targets only through **75°C**, tool through **260°C**; this can constrain workflows relative to a native API. Common controls do not document WebOrca's fan/speed controls. [Controls][control]
- **Files:** use returned `VirtualPath`; upload is raw file bytes via `PUT .../files/upload?path=<VirtualPath>`, separate from `POST .../start`. Native Moonraker/OctoPrint multipart upload code is not the common upload format. Bambu `.3mf` start accepts plate, AMS mapping and calibration options; this does not establish WebOrca export compatibility. [Files][files] [Controls][control]
- **Cameras:** list cameras, request JPEG snapshot or MJPEG stream by index; preserve camera flips/rotation. Returned host-local camera URLs are not automatically suitable remote URLs; use the common snapshot/stream commands. Native webcam relay support does not imply WebRTC/RTSP/HLS contracts. [Webcam][webcam]
- **Errors:** inspect HTTP service `6xx` and JSON plugin `Status`; HTTP 200 alone is not command success. Handle offline/timeouts, revoked connections, missing perks/auth, size and webcam limits, old plugins, and unsupported commands. Plugin `788` means unsupported; `787` can mean the printer's direct-client limit. [Errors][errors] [Plugin errors][pluginerrors]

## Plans, limits, and additional features

Crucial restriction excerpt: **“App Connections currently require the printer owner to have Supporter Perks.”** (`App Connections`, Supporter Status). The pricing page independently labels free accounts **“No App Remote Access”**. Free consumer remote access, AI detection, or notifications therefore do not establish free third-party App Connection access. [App Connections][app] [Pricing][pricing]

Public pricing observed: free browser accounts include 3 printers, 20-second streams and 20 MB file transfers; Supporter advertises 5 printers, 2-minute streams and 500 MB transfers; Elite advertises 10 printers, 5 GB transfers and unlimited streaming, with a 24-hour per-stream safeguard. These are marketing plan values, not byte-exact API constants or guarantees for every endpoint. The page also advertises unlimited back-to-back streams for paid tiers. [Pricing][pricing]

For integration, query `GET https://octoeverywhere.com/api/appconnection/info` with `AppToken`. Use current `PrinterLimits.MaxUploadFileSizeBytes`, `MaxDownloadFileSizeBytes`, and `MaxSingleWebcamStreamLengthSeconds`; the documented example values are not defaults or quotas to hard-code. Service errors `607`/`608` identify exceeded download/upload body limits, `609` a webcam back-to-back restriction, `602` a plugin response timeout. No numeric global request rate, generic timeout duration, remote session duration, simultaneous App Connection/client/stream cap, or upload-resumption contract was established. The error docs mention current webcam limits in Info, but its published schema does not expose a back-to-back window/count. [Info][info] [Errors][errors]

| Additional feature | Published access / requirement | WebOrca implication |
| --- | --- | --- |
| Gadget AI status | App API using `AppToken`; at most one poll every 10 seconds per App Connection while visible and printing; reduce/stop otherwise. | Show existing detection status; does not grant training/model access or every paid auto-pause feature. [Gadget][gadget] |
| Create shareable Live Link | `POST /api/live/createfromappconnection`; AppToken; expiry or track active print; metadata such as model URL/title not accepted. | Explicit user sharing action; separate from a full-control Shared/App Connection. [Live Links][live] |
| App-owned notifications | Set/delete/test webhook APIs; public HTTPS callback; event filter; renew registration at least every 180 days. | Requires backend delivery and callback authentication design; a static browser app cannot receive background server POSTs. No signing/retry/delivery-order guarantee was established. [App webhook][hook] |
| Separate AI processing API | Official landing page advertises 500 free print hours monthly for its distinct AI failure-detection API product. | Do not interpret this quota as App Connection usage, consumer Gadget entitlement, or free remote printer access. [API index](https://docs.octoeverywhere.com/) |

## Browser, security, and terms constraints

The docs primarily describe native app WebViews. No complete CORS/preflight policy, COEP/CORP response guarantee, browser popup/COOP recipe, or iframe embedding contract was found. Browser `WebSocket` and `<img>` cannot simply attach arbitrary authentication headers like server/native clients can. MQTT has the specific query-auth escape hatch above; do not assume it applies to Moonraker WebSockets, webcam routes, or all HTTP paths. These are browser applicability conclusions, not observed OctoEverywhere failures. [Portal][portal] [Usage][usage] [MQTT][mqtt]

For WebOrca, plan a scoped HTTPS/WSS gateway unless OctoEverywhere confirms a complete browser contract. Verify direct Fetch CORS (Authorization/AppToken/native key), WebSocket authentication and Origin handling, authenticated image streaming under the actual COEP policy, and return navigation under the app's isolation headers. A same-origin relay can attach credentials but creates server authorization, credential-storage, target-validation, and log-redaction responsibilities; adding a public host to the LAN gateway without that design is insufficient. Existing private-host gateway restrictions and direct-connection limitations are documented in [PRINTERS.md](../wasm/app/PRINTERS.md). No browser verification was performed.

App Connections provide broad printer access, not a documented granular OAuth read-only scope. A WebOrca read-only mode must enforce its own allowed operations; hiding buttons does not narrow provider credentials. Completion URLs contain one-time secrets: keep them out of logs, analytics, referrers, screenshots and shareable URLs; securely bind completion to the initiating saved-printer setup. The portal documentation does not specify OAuth `state` or PKCE support, token rotation/revocation APIs, or callback signature validation. Resolve callback protections and allowed return URLs with OctoEverywhere. [App][app] [Portal][portal]

[Terms][terms] limit acceptable use to printer remote access/control and printing-related webcam monitoring. The wording still names OctoPrint/Klipper although newer API docs support additional platforms; clarify that mismatch for production. The terms say **“Without prior approval and written permission, you may not create frames around our Webpages”** that alter presentation. Prefer external navigation for the first phase, and confirm iframe permission before embedding the website. A simple external Open action has no technical need for partner API integration; that does not imply a general branding, endorsement, or website-framing license.

## Grounding in the current WebOrca code

Read [PRINTERS.md](../wasm/app/PRINTERS.md), [types.ts](../wasm/app/src/printers/types.ts), [api.ts](../wasm/app/src/printers/api.ts), [octoprint.ts](../wasm/app/src/printers/octoprint.ts), [moonraker.ts](../wasm/app/src/printers/moonraker.ts), and the transport helper [gatewayUrl.ts](../wasm/app/src/printers/gatewayUrl.ts), as present in the dirty working tree.

- Saved printers already distinguish `host_type`, native `print_host`, and `print_host_webui`. This supports retaining the underlying host and adding optional remote access after normal creation; this report does not prescribe the parent's final schema.
- Factory dispatch is by underlying host. OctoPrint polls native HTTP status and uses multipart uploads; Moonraker uses JSON-RPC WebSockets, native HTTP operations, and camera discovery. Neither currently models the separate OE relay auth/App API token/connection ID.
- `HostCapabilities` is currently host-based, while common OE capabilities are runtime feature-based. Existing native control availability must not be copied wholesale into an OE common adapter.
- The helper emits native `X-Api-Key` and selected PrusaLink gateway digest metadata, not a full OE credential strategy. Moonraker's browser WebSocket currently has no custom header mechanism. Existing APIs therefore provide reuse opportunities, not an already working URL-only integration.

## Phased scope and prerequisites

1. **External Open action:** after adding a printer, mark OctoEverywhere configured and save a user-supplied normal printer access URL. Open a separate tab to its own login/session. Our prerequisites: URL validation and clear distinction between external opening and integrated connectivity. User prerequisites: supported connected printer, OE installation/companion and account; plan limits apply there. No app enrollment or partner credentials are technically needed.
2. **Authorized remote monitoring:** obtain an assigned WebOrca app ID; settle browser return/auth behavior; integrate per-printer portal authorization; display online state, status, temperatures/progress and snapshots/streams with limit/error recovery. Start with OctoPrint/Moonraker native relay or one deliberate common adapter. User additionally needs Supporter Perks and possibly native host credentials. Keep local access available and prefer it when reliably reachable. [Usage][usage]
3. **Uploads and deliberate control:** add only operations evidenced for the chosen host/plugin; separate upload from start, preserve existing confirmation requirements, map runtime features and size limits. Test host-specific native versus common behavior before enabling Bambu/PrusaLink/Elegoo actions.
4. **Optional extras:** Gadget indicator, explicit Live Link creation, read-only material topology, backend notifications; later Bambu/CC2 MQTT where low-level access is required. Do not make account linking imply these extras were enabled or supported.

Installation prerequisite evidence: the [official pinned README](https://github.com/QuinnDamerell/OctoPrint-OctoEverywhere/blob/0f19f5dcca23a5047938cb3c2aeb30691ed4d238/README.md) documents an OctoPrint plugin, direct Klipper installation, and companion/Windows/Linux/Docker setup for Klipper, PrusaLink, Bambu and Elegoo CC1/CC2. For companion modes, an always-running reachable machine and valid printer-side setup remain necessary. Do not assume the user's existing WebOrca LAN connection itself installs or configures OctoEverywhere.

### Questions to resolve before integrated access

- How does WebOrca obtain a production app ID; what approval, commercial terms, app listing, callback registration, and auth-type choices apply?
- Is a web SPA a supported client; which CORS, Origin, COOP/COEP/CORP, callback correlation, and auth-header collision patterns are supported?
- Which exact installed plugin/firmware versions and per-model feature/files/material mappings are supported, particularly Bambu firmware/LAN/cloud modes, PrusaLink native uploads and Elegoo native transfers?
- What are the current per-account/app concurrency, request-rate, generic timeout, upload-body accounting, stream-reconnect/back-to-back, and token lifecycle rules beyond documented Info fields?
- What signed or secret-based callback validation, retry/deduplication behavior, and data handling terms apply to app webhooks and stored printer credentials?

## Verification

Verified public documentation/reference URLs and pinned first-party source URLs through successful read-only fetches; checked referenced local files exist. No builds or test suites were run for this documentation-only task. Existing dirty files were preserved; only this report was added. No README, Taproot, or commit changes were made.

[app]: https://docs.octoeverywhere.com/app-connections/overview/
[portal]: https://docs.octoeverywhere.com/app-connections/portal/
[usage]: https://docs.octoeverywhere.com/app-connections/usage/
[keygen]: https://docs.octoeverywhere.com/app-connections/octoprint-api-key-generation/
[info]: https://docs.octoeverywhere.com/app-connections/apis/info-api/
[remote]: https://docs.octoeverywhere.com/printer-api-remote-access/
[plugin]: https://docs.octoeverywhere.com/plugin-api/overview/
[status]: https://docs.octoeverywhere.com/plugin-api/printer-status/
[control]: https://docs.octoeverywhere.com/plugin-api/printer-control/
[files]: https://docs.octoeverywhere.com/plugin-api/files-api/
[webcam]: https://docs.octoeverywhere.com/plugin-api/webcam-api/
[mqtt]: https://docs.octoeverywhere.com/plugin-api/mqtt-websocket-proxy/
[pluginerrors]: https://docs.octoeverywhere.com/plugin-api/plugin-api-errors/
[errors]: https://docs.octoeverywhere.com/error-codes/
[gadget]: https://docs.octoeverywhere.com/app-connections/apis/gadget-status/
[live]: https://docs.octoeverywhere.com/app-connections/apis/live-links/
[hook]: https://docs.octoeverywhere.com/app-connections/apis/notification-webhook/
[pricing]: https://octoeverywhere.com/supporter
[shared]: https://octoeverywhere.com/sharedconnections
[terms]: https://octoeverywhere.com/tos/
