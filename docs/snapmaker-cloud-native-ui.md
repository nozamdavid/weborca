# Snapmaker Orca native UI and connection architecture

Investigated 2026-11-05. **The current first-party integration runs a separate local Snapmaker Control gateway. Orca embeds pages served by that process and consumes its HTTP/WebSocket API. The native UI bridge does not reveal a fixed cloud broker, issued topics or an independent MQTT client/session allocation rule.** There is a reusable local integration boundary, but adopting the official gateway would change WebOrca's browser-owned, stateless account architecture.

This follows [account research](snapmaker-cloud-integration.md), [MQTT research](snapmaker-cloud-mqtt.md) and the [availability-only follow-up](../wasm/build/tests-snapmaker-cloud/live-status-followup/report.md). Those documents were read first. Their Flutter/MQTT findings remain evidence about the checked-in client; they must not be presented as a complete trace of the currently packaged connection backend.

## Pinned evidence and a consequential packaging difference

All Orca references below pin `Snapmaker/OrcaSlicer` **`6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c`**. Its complete recursive GitHub tree has 15,060 entries (`truncated:false`). The packaging lock selects **Snapmaker Control v1.8.5**, including SHA-256 values for six platform archives. The Linux x64 archive hash is `7517626d127adcc057982b22c353ee38043bbe0bdece41c5df5e2d52dce3dd96`. [P1]

`build_linux.sh` stages this bundle before configuring Orca. `stage_connect_bundle.py` downloads from `Snapmaker/snapmaker_control` releases, verifies the archive against the lock, copies the platform executable into resources and **replaces `resources/web/flutter_web` with the archive's web directory**. Consequently, the checked-in `main.b347974c91352c2f.js` is not proof of the JavaScript shipped by that build. The checked-in web manifest says `2.3.40`, build `20260930162817`; that is not the Control v1.8.5 backend version. [P2][P3][P4][P5][P6]

The Control tag resolves to **`e664cba6adf7cd5cda9a164401662ea263aad6bf`**. Its complete tree contains only `README.md`, `README.zh-CN.md`, `LICENSE.txt`, and `THIRD_PARTY_NOTICES.txt`. Its README explicitly describes a binary distribution repository without source and says the program communicates with printers and serves Orca's device pages. It also supports standalone U1 use through a browser, with pages restricted to `127.0.0.1`. [C1][C4]

This investigation inspected public source and documentation only. It did not download/run release executables or inspect an installed Control instance. The exact v1.8.5 release web assets, its internal connection implementation and its runtime `/api/health` response remain unexamined.

## Native startup and page loading

The source-supported call flow is:

1. **`GUI_App::OnInit` startup:** after `load_language`, call `start_gateway_service()`. `gateway_locale()` reduces language to `en` or `zh` and country to `US` or `CN`, producing e.g. `en-US`. `start_gateway_service()` constructs the process manager, libcurl HTTP client and Beast WebSocket client; callbacks dispatch through `CallAfter` and check shutdown state. [U1][U2]
2. **Start/discover the companion:** choose `resources_dir()/snapmaker_control_<platform>_<arch>[.exe]`, then launch with **`--locale=<locale> --orca`**. Parse one stdout frame **`PORT:<decimal>\r\n\r\n`**, rejecting zero, out-of-range or multiple ports. Current executable names use `snapmaker_control`; `snapmaker_connection` is a legacy packaging name. This port is a local IPC port, not the MQTT broker port. [U3][P3]
3. **Wait for local readiness:** `GatewayService::connect_once()` fetches **`http://127.0.0.1:<discovered-port>/api/health`**. The parser requires `status:"ok"` or `ok:true`, `components.ipc_server:"ok"`, `components.web_server:"ok"`, and `server_url.base_url`. Other string entries in `server_url` become page paths. `cli_version`, `device_connected` and `sn` are optional metadata. The URL validator requires an HTTP base beginning `http://127.0.0.1:` with a decimal port and nonempty page paths starting `/`. No cloud broker configuration is parsed here. [U4][U5][U12][U13]
4. **Connect native IPC:** open **`ws://127.0.0.1:<discovered-port>/ws`**. Native handshake removes `Origin` and supplies `User-Agent: Snapmaker_Orca`; the shown handshake has no cloud Bearer token. Native traffic uses JSON-RPC 2.0. The health `base_url` is used for page URLs; it is not assumed identical to a cloud API URL, and the page paths are runtime values rather than native hardcoded Flutter routes. [U4][U6]
5. **Load the pages:** `MainFrame` creates `WebViewPanel` for Home and `PrinterWebView` for Device. Home requests `gateway_web_url("home_page")`; `reload_gateway_pages()` loads the health-provided `home_page` and `device_control` URLs. `WebDeviceDialog` also requests `device_control`. Device/Add Device WebViews start at `about:blank` and explicitly load the chosen URL. `GatewayService::web_url()` can return pages after health readiness while the control WebSocket is still connecting. On connection, account/device refresh runs and changed gateway bases trigger page reloads. [U7][U8][U9][U10][U14][U15]
6. **Missing companion:** `gateway_web_url()` falls back to the native page server's **`http://127.0.0.1:<page-port>/web/orca/missing_connection.html`** (using `LOCALHOST_URL`). The native `HttpServer::map_url_to_file_path()` explicitly rejects `/` and `/web/flutter_web/`; other ordinary resources map beneath `resources_dir()`, with separate local-file/download handlers. The old commented `localhost:13619/web/flutter_web/index.html?path=1` example is not the active Home loading path. [U10][U11][U16]

Thus the device UI is locally hosted HTTP content. It is not loaded from `id.snapmaker.com`, an external hosted device dashboard, or a `file://` Flutter entry point in this path. Remote account/cloud service calls occur behind or within the local application; the native loader itself receives only local page URLs. Exact page suffixes such as `/device_control` or `?path=2` cannot be certified for v1.8.5 without its health response/assets. [U5][U7][U9][C1]

## WebView bridge and configuration

`WebView::CreateWebView()` chooses Edge on Windows, the custom WebKit wrapper on macOS, and the wx default backend elsewhere. It sets an `SM-Slicer/v…` user agent with theme information and registers **`AddScriptMessageHandler("wx")`**. macOS defers real navigation until its script handler is installed and gates overlapping Flutter navigations. These are the fork's implementation choices; the local skill's newer wx pin is not evidence of this upstream fork's wx version. [B1]

Two distinct channels coexist:

| Channel | Message and native entry | Purpose established by source |
| --- | --- | --- |
| Web page → wx | Checked-in HTML defines `window.sendMessage(message)` → `window.wx.postMessage(message)`. Device `OnScriptMessage` → `SSWCP::handle_web_message`. | Desktop operations exposed through WCP. |
| wx → page | `SSWCP_Instance::send_to_js()` invokes `window.postMessage(JSON.stringify({header,payload:{code,message,data}}), '*')` through `WebView::RunScript`, scheduled with `CallAfter`. | WCP replies/events; original header is preserved. |
| Native ↔ Control | Beast `/ws`, `{jsonrpc:"2.0",id,method,params}` and result/error/notification classification. | Account/device/cache integration independent of wx script messages. |

WCP ingress requires `header`, `payload` and `payload.cmd`; reads `payload.params` and optional `payload.event_id`, then dispatches an `SSWCP_Instance`. Home additionally calls `GUI_App::handle_web_request` for the older desktop web command path. `sw_GetSoftwareInfo` returns app version and the native resource server's `http_host`; it supplies no broker host, MQTT port, topic list, certificate, or client-ID policy. In the loading/bridge entry points examined, no injected JavaScript MQTT/account configuration object was found. This is a bounded source finding, not a claim about all code inside the release assets. [B2][B3][B4][B5][B6]

The checked-in HTML and older MQTT bundle are useful for understanding WCP and historical transport, but packaging replaces them. The source does not establish that the current Control-served UI still performs the same credential bootstrap through wx. Standalone browser operation documented by Control further establishes that a wx host is not required for its core device pages. [P3][C1]

## Account and selected-device propagation

The C++ source explicitly says **“SM login state is owned by the connection gateway”**. Upon gateway connection it fetches local **`GET /api/account`**. `notify.account.changed` supplies account state; when a logged-in notification omits its token, native fetches `/api/account` again. `GatewayAccount::parse` accepts a flat account frame or `{code,data:{…}}`; token aliases are `token`, `access_token`, `accessToken`, with user-ID/profile fields. `GUI_App::apply_gateway_account` stores the snapshot in native memory and passes its token/user ID to SnapLog. This is account state moving **from Control to native**, not native injecting a broker credential into the page. Refresh-token storage/rotation inside Control is not exposed here. The separate `ZUserLogin` Bambu network-agent dialog is not evidence of Snapmaker's current account bootstrap. [A1][A2][A3][A4][U10]

After gateway connection or `notify.device.connected` / `notify.device.current_changed`, native calls **`query.device.current` with `{}`**, parses a selected serial and `connected`, calls **`query.device.objects` with `{}`**, then registers **`action.device.watch` with `{sn:<selected-serial>}`** when the watched serial changes. These methods operate on the gateway's current device. `notify.device.object.changed` triggers a fresh object query when machine-slot fields changed; `notify.device.disconnected` clears the selected native state. [D1][A3]

Additional read boundary: **`GET /api/cache/all`**, or `/api/cache/all/<URL-encoded-serial>`, is available through `GatewayService::get_device`. `GatewayDevice::query_machine_info` reads `data.info.product` and `data.objects` from that cache. `query.device.objects` parsing accepts `{objects:{…}}` or a legacy direct object map containing `print_task_config`. These are concrete companion protocols, not routes on Snapmaker's cloud identity API. They demonstrate access to printer state through an already connected local backend; they do not document how a new third-party client should log in or select/connect a device. [D2][D3][D5][U12]

One additional finding reduces the previous material ambiguity: native `GatewayDevice::parse_machine_slots` builds zero-based `ConnectMachineInfo.index` entries from `print_task_config` parallel vendor/type arrays, applies `filament_exist`, corresponding color/subtype/multicolor entries, and nozzle information. Its numeric color conversion treats the supplied value as ARGB and rotates it to RGBA. This proves the native display mapping, including missing/false existence behavior; it does not establish physical slot numbering or validate a live printer's payload. It is separate work from getting heater telemetry. [D4]

## Native MQTT/TLS implementation and its limits

The public Orca tree still contains `Moonraker_Mqtt` and the Paho C++-based `MqttClient`. Their contract is concrete, but the active page-loading path above crosses into the proprietary Control process. No call sequence in the inspected loader/gateway sources establishes that Control v1.8.5 uses those same C++ implementations internally.

| Concern | Public Orca implementation | What it fails to establish |
| --- | --- | --- |
| Supplied TLS connection | `Moonraker_Mqtt::connect` consumes `ca`, `cert`, `key`, `port`, `clientId`, `sn`, uses its configured host, and creates `mqtts://<host>:<port>`. Returned client ID is used directly. | No fixed Snapmaker cloud endpoint or authorized new client-ID suffix. [M1] |
| Missing TLS data | `ask_for_tls_info` connects its existing MQTT client, requires an access `code`, subscribes to the code-prefixed auth topic, publishes `server.request_key` with that client's ID, and reads `sn,clientid,ca,cert,key,port` from the reply. | This access-code/device authorization path is not an additional public cloud broker discovery API. It still needs an existing host/client and must not replace the cloud credential flow. [M2] |
| Topics/startup | TLS connect subscribes serial + `/notification` and `/response`; state registration adds `/status` and `/notification`; requests publish serial + `/request`, QoS 1. JSON-RPC request generation includes time-sync fields. | No actual cloud-issued topic arrays, cloud ACLs or Control session rules. [M3][M4] |
| TLS/session options | Paho async client; persistent session (`clean_session=false`), keepalive 30 seconds, connect timeout 10 seconds; TLS 1.2 and server-cert authentication, but `set_verify(false)`; CA/cert/private key written to temporary PEM files. | This implementation does not meet WebOrca's connection-memory-only credentials and verified-hostname requirements. Do not copy its file handling, logging or verification choices into a hosted relay. [M5] |

The [earlier MQTT report](snapmaker-cloud-mqtt.md#credential-retrieval-and-tls) establishes the checked-in Flutter path: Bearer `GET /user/device/getMqttCert`, response-derived endpoint/port/cert/key/client ID/topic arrays, and embedded Amazon Root CA 1. This native trace supplies **no new literal cloud broker, permitted cloud port, per-session client-ID allocation or cloud WSS transport**. It also exposes no REST cloud heater endpoint. A local `/ws` carrying gateway JSON-RPC is not an MQTT-over-WebSocket broker URL.

## Feasibility changes, remaining gaps and smallest next step

**New feasible boundary:** a user-installed official Control companion already provides local pages plus HTTP/JSON-RPC device state. An integration targeting that companion can potentially consume its cache/query/watch boundary without reimplementing mutual TLS. The official README supports standalone browser use. This is a concrete alternative architecture, with its own account/session owner and local process requirement. It does not establish access from a remotely hosted WebOrca page: browser origin, HTTPS-to-loopback restrictions, local API authorization and the gateway's browser handshake need validation. Native deliberately omits `Origin`; browsers cannot reproduce that handshake behavior. [C1][U6]

**Hosted stateless MQTT assessment:** unchanged. Native/Control loading does not close these exact gaps:

- Actual Snapmaker broker tenant/hostname and supported port(s); a local gateway URL or generic Amazon root CA does not identify the cloud destination.
- Actual issued publish/subscribe arrays and permission scope; server-issued client-ID reuse/allocation, simultaneous-session behavior, certificate expiry/revocation and device ACLs.
- Control v1.8.5 internals and its packaged UI's exact login/device-connect API use. Checked-in Flutter strings must not be promoted to current release evidence without comparing the pinned release assets.
- If choosing the companion route: browser origin/access contract, precise connect/select methods, cache freshness and notification payload semantics. The native query/watch calls alone do not complete these contracts.
- Runtime acceptance of monitoring RPCs and real heater/status schemas. Successful account login and bound-device selection still provide no telemetry transport.

Control's public license covers its binary and bundled web assets separately from Orca's AGPL source; it restricts redistribution. Treat it as a separately installed provider component, not code/assets to copy into WebOrca's hosted build. Its README documents per-user settings/device-list/log storage; neither it nor the C++ account mirror establishes a browser-owned, stateless credential lifecycle. [C2][C3][C5]

**Smallest practical next integration step under the existing browser-owned design:** prepare the disabled telemetry snapshot/delta decoder described in the [follow-up](../wasm/build/tests-snapmaker-cloud/live-status-followup/report.md#safe-minimum-next-implementation), with synthetic query/status fixtures only. Keep account availability semantics until a separately authorized contract check resolves the credential-response destination/topic/session fields. Once established, implement the narrow connection-scoped WS-to-MQTT/TLS monitor already specified in the MQTT report. This investigation does not justify adding arbitrary broker forwarding or silently adopting Control as a server account store.

If the user instead chooses an installed companion integration, the first small contract slice is its existing **cache/current-device/object-query/watch** interface. Verify browser access and the current release's selection/connection contract before writing that adapter. No companion was installed or contacted in this research.

## Documentation verification

Read AGENTS.md, the research skill, and the Orca wxWidgets skill. Followed the explicit sub-agent restriction against delegation. Fetched only public GitHub metadata, pinned source and documentation using `curl -LfsS --max-time 60`; inspected original line numbers for every reference below. Both recursive trees were complete; the Control v1.8.5 tag resolved as recorded above. One speculative separate `GatewayWebSocketTransport.cpp` fetch returned 404; the implementation is in `GatewayService.cpp`, which is cited instead. No commands from downloaded scripts/docs were executed.

Only this document was added to the repository. No source/runtime changes, credentials, account/browser data, login, broker/device probes, builds, tests, deployment, commit or project-tracking update were used. No evidence snapshots are needed because the source references are immutable; fetched working copies were temporary. Local report links and cited paths/line bounds were checked.

## Immutable source references

[P1]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/.github/connect-bundle.lock.json#L1-L11
[P2]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/build_linux.sh#L245-L263
[P3]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/scripts/packaging/stage_connect_bundle.py#L20-L40
[P4]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/scripts/packaging/stage_connect_bundle.py#L106-L132
[P5]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/scripts/packaging/stage_connect_bundle.py#L210-L245
[P6]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/version.json#L1
[U1]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/GUI_App.cpp#L2624-L2627
[U2]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/GUI_App.cpp#L5802-L5857
[U3]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/ConnectionProcessManager.cpp#L389-L453
[U4]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayService.cpp#L807-L901
[U5]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayProtocol.cpp#L51-L102
[U6]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayService.cpp#L221-L239
[U7]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/MainFrame.cpp#L4092-L4103
[U8]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/WebViewDialog.cpp#L37-L44
[U9]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/PrinterWebView.cpp#L25-L85
[U10]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/GUI_App.cpp#L6087-L6131
[U11]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/HttpServer.cpp#L997-L1044
[U12]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayService.hpp#L97-L111
[U13]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayService.cpp#L51-L69
[U14]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayService.cpp#L542-L561
[U15]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/WebDeviceDialog.cpp#L16-L35
[U16]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/HttpServer.hpp#L17-L22
[B1]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/Widgets/WebView.cpp#L408-L515
[B2]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/index.html#L1-L7
[B3]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/SSWCP.cpp#L5658-L5703
[B4]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/SSWCP.cpp#L1096-L1133
[B5]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/SSWCP.cpp#L646-L654
[B6]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/WebViewDialog.cpp#L656-L684
[A1]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/GUI_App.cpp#L4229-L4265
[A2]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayAccount.cpp#L66-L97
[A3]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/GUI_App.cpp#L6040-L6072
[A4]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/WebUserLoginDialog.cpp#L78-L106
[D1]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/GUI_App.cpp#L5889-L5990
[D2]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayService.cpp#L655-L684
[D3]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayDevice.cpp#L59-L121
[D4]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayDevice.cpp#L138-L287
[D5]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayProtocol.cpp#L135-L149
[M1]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/MoonRaker.cpp#L1130-L1263
[M2]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/MoonRaker.cpp#L1018-L1128
[M3]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/MoonRaker.cpp#L1301-L1450
[M4]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/MoonRaker.cpp#L2544-L2600
[M5]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/MQTT.cpp#L21-L140
[C1]: https://github.com/Snapmaker/snapmaker_control/blob/e664cba6adf7cd5cda9a164401662ea263aad6bf/README.md#L8-L16
[C2]: https://github.com/Snapmaker/snapmaker_control/blob/e664cba6adf7cd5cda9a164401662ea263aad6bf/LICENSE.txt#L28-L33
[C3]: https://github.com/Snapmaker/snapmaker_control/blob/e664cba6adf7cd5cda9a164401662ea263aad6bf/LICENSE.txt#L87-L108
[C4]: https://github.com/Snapmaker/snapmaker_control/blob/e664cba6adf7cd5cda9a164401662ea263aad6bf/README.md#L65-L85
[C5]: https://github.com/Snapmaker/snapmaker_control/blob/e664cba6adf7cd5cda9a164401662ea263aad6bf/README.md#L113-L123
