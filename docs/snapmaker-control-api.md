# Reading Snapmaker Control's local APIs

Investigated 2026-11-05. **Yes: an already running, user-owned Control instance exposes a concrete local read boundary for its selected printer.** The pinned v1.8.5 web client uses same-origin `/ws` JSON-RPC for current-device state and printer object subscriptions, including bed/nozzle temperatures and print progress. Native Orca also reads `/api/health` and `/api/cache/all[/<serial>]`. This is sufficient to prepare a narrow reader, but access from hosted WebOrca and live cache freshness remain unverified. We do not yet have the user's Control URL or confirmation of where it runs. No local service or device was contacted.

This follows [the native integration report](snapmaker-cloud-native-ui.md). It replaces that report's uncertainty about the **packaged web client's** transport with inspected release evidence; it does not establish the proprietary server's implementation or a new cloud telemetry API.

## Verified release and evidence

The [Orca packaging lock][lock] at commit `6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c` selects Control **v1.8.5**. Its [staging script][stage] replaces the checked-in Flutter directory with the release's `web/flutter_web`. I downloaded the [official Linux x64 archive][archive], verified its locked SHA-256 **before extraction**, and extracted only that static web directory. No executable was extracted, installed or run.

| Artifact | SHA-256 |
| --- | --- |
| `snapmaker_control-1.8.5-linux-x64.tar.gz` | `7517626d127adcc057982b22c353ee38043bbe0bdece41c5df5e2d52dce3dd96` |
| `web/flutter_web/main.dart.js` | `96109093573873627edd92bc538d46eaa0f46470f337a8d1f281e0f4db07f657` |
| `web/flutter_web/version.json` | `e13a328ffaef1c949e1754c7fba37579c74d98ac1c027fb76c1d66570c806548` |

The release's `version.json` says `version:1.8.5`, `build_number:20261023182959`. Below, **W:L…** means original line numbers in this hash-identified `main.dart.js`. The ignored [evidence directory](../wasm/build/tests-snapmaker-cloud/control-api-research/) retains that file, version/HTML, hashes, archive listing and numbered [client excerpts](../wasm/build/tests-snapmaker-cloud/control-api-research/release-client-excerpts.txt). The archive and unrelated static media were removed after inspection. Release URLs can be replaced by their publisher; the locked digest identifies the inspected bytes.

## Exact access requirements

1. **Control must run on the machine making the connection.** The official README says its pages are served only on `127.0.0.1`; a Control on another workstation is not available through that workstation's LAN IP. For cloud-connected printers, the user must sign in and connect/select the printer in official Control. A bound or cloud-online device alone does not prove that Control's current connection is ready. Local PIN-authorized connections are also supported by the official UI. [official use][readme], [local pages][local-pages]
2. **Obtain the actual origin from the user's open Control page or Orca's discovery.** Native launches the companion, reads `PORT:<decimal>`, then reads health metadata; the web client derives scheme, hostname and port from its own page URL and opens `/ws` there. Do not scan ports or assume `8767`: that number appears in a helper's explicit override branch, while the active initialization calls the helper with `null` and uses the page origin. W:L42625–42662, L50634–50642; [native discovery][discovery], [native health][health].
3. **Use the official page's origin first.** `new WebSocket(url)` has only the URL argument: no subprotocol, Bearer header, query token or authentication frame is added in the traced transport. The local HTTP provider inherits a token callback returning `null` and empty extra headers (`ze` → `xw`, W:L161820–161830, L148177–148204, L177919–177920, L179327). This establishes that the shipped client does not explicitly supply WebOrca's cloud token to these reads. It does **not** prove the server is unauthenticated: cookies may be attached by the browser, and server origin/cookie checks are unavailable in this binary-only distribution. W:L42636–42638, L164529–164549; [distribution statement][readme].
4. **An arbitrary WebOrca origin is not yet a verified client.** Cross-origin HTTP reads need appropriate CORS responses; WebSockets send a browser-controlled `Origin` which the server can reject. HTTPS/loopback access also depends on the browser's mixed-content/local-network rules and permissions. The same-origin packaged client does not reveal the server's allowlist, CORS headers, cookie policy or remote HTTPS acceptance. Native explicitly removes `Origin` and sets `User-Agent: Snapmaker_Orca`, which browser JavaScript cannot reproduce. [native handshake][handshake], [WebSocket standard][ws-standard], [Fetch CORS][cors]. Do not infer cross-origin permission from native success or successful top-level page navigation.

Record both the native discovered IPC origin and health's page `base_url` if they differ. Native sends health/cache and its `/ws` traffic to the discovered port; the packaged browser sends `/ws` to its page origin. Static inspection does not prove every native HTTP route is exposed on a distinct page port. [native health][health], [cache][cache]; W:L42636–42638.

The precise unresolved access check is therefore **same-origin read acceptance and freshness at the user-supplied Control origin, followed by acceptance from the actual WebOrca origin if direct browser integration is desired**. Public assets resolve the request contract, not these runtime server policies. No claim of remote browser access, permissive CORS or an auth bypass is made.

## Read contract: native cache versus shipped web telemetry

| Read | Exact request | Established behavior and limitation |
| --- | --- | --- |
| Readiness | `GET /api/health` | Native expects ready IPC/web components and `server_url.base_url`; optional device metadata is not a heater snapshot. [health parser][health-parser] |
| Cached device data | `GET /api/cache/all` or `/api/cache/all/<URL-encoded-serial>` | Native explicitly supports both. Its device reader consumes `data.info.product` and `data.objects`. The shipped web JS contains neither cache URL nor a polling loop for it. No cache TTL, timestamp or guarantee that a disconnected cache is fresh was established. [cache][cache], [cache consumer][cache-consumer] |
| Current device | `/ws`: `query.device.current`, params `{}` | Web parser expects `sn` and `connected` (boolean, numeric or supported string forms). Web initialization and reconnect refresh it; only nonempty serial plus connected produces a ready current device. W:L42980–43007, L164615–164659. [native current][current] |
| Native object snapshot/watch | `/ws`: `query.device.objects`, `{}`; `action.device.watch`, `{"sn":"<current serial>"}` | Native issues these after current-device discovery; its parser accepts `objects` or a legacy direct map. Neither method string appears in the shipped JS. Watch is a monitoring registration, not evidence of a browser's required telemetry subscription sequence. [native current][current], [native object parser][objects-parser] |
| Web object discovery | `/ws`: `printer.objects.list`, params omitted/empty | Response parser accepts an `objects` list or map, optionally under another `result` member. W:L42138–42151, L150234–150239. |
| Web initial snapshot and updates | `/ws`: `printer.objects.subscribe`, `{"objects":{…}}` | Main status synchronization calls object discovery, builds the field map, then subscribes. It accepts a nonempty returned `status` as the initial snapshot, queues deltas while awaiting it, then applies queued deltas. W:L150833–150989. |
| Additional query implementation | `/ws`: `printer.objects.query`, `{"objects":{"defect_detection":null}}` | The literal shipped query class requests this object only. Its presence is not evidence that the primary temperature view polls this RPC. W:L150240–150250, L180500–180506. |

Web requests use ordinary JSON-RPC 2.0 `{jsonrpc,id,method,params}` with unique numeric IDs. Empty params may be omitted. The transport also supports a top-level `timeout_ms`; replies are correlated by ID and parsed as `result` or `error`. `notify…` messages have `method` and `params`, without a request ID. W:L150328–150365, L164470–164526. Do not treat WS-open as printer-connected, or a JSON-RPC error as telemetry.

For example, these are the read requests for current-device discovery and a **narrow subscription using the shipped field-map shape**. The narrowed map is an integration candidate, not a live-tested transcript:

```json
{"jsonrpc":"2.0","id":1,"method":"query.device.current","params":{}}
{"jsonrpc":"2.0","id":2,"method":"printer.objects.list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"printer.objects.subscribe","params":{"objects":{"heater_bed":["temperature","target"],"extruder":["temperature","target"],"extruder1":["temperature","target"],"print_stats":["state","filename","print_duration","total_duration"],"display_status":["progress","message"],"machine_state_manager":["main_state","action_code"]}}}
```

Include actual advertised extruder keys. The shipped client starts with a broader known list (`extruder` through `extruder3`, heaters, progress, fans, filament and other objects), adds discovered keys matching `^extruder(\d*)$`, and maps each to selected fields or `null`. A `null` entry requests the whole named object. W:L42065–42115, L182386, L190437. Monitoring subscriptions change delivery state; they do not issue a heater, motion or print command. No connect/select action is needed in this proposed read slice because the user establishes the selected connection in Control first.

## Temperature, status and delta handling

- **Initial data:** the subscription result parser accepts `status` directly in the RPC result or under a nested `result.status`. It returns no snapshot for other shapes. W:L42123–42137. The reader must distinguish missing/failed synchronization from a valid zero temperature.
- **Updates:** `notify.device.object.changed` params are accepted as an object map or an array whose first element is an object map. The map is emitted into the status stream. Preserve the object keys and merge fields into the existing snapshot; omitted fields retain their previous values. Do not replace the snapshot with each notification or invent a serial wrapper. W:L42116–42122, L164609–164613, L150299–150326, L150487–150522. This parsing does not establish an event timestamp, sequence number or guaranteed update interval.
- **Heaters:** `heater_bed.temperature` / `.target`; `extruder`, `extruder1`, etc. `.temperature` / `.target`, plus available `power`, `state`, `can_extrude`, `nozzle_diameter`, `nozzle_volume_type`, `extruder_index`. Numeric strings are accepted by the shipped decoder. `extruder` maps to index 0; suffix numbers map to their integer value; the explicit `extruder_index` can resolve the displayed index. W:L41701–41753, L42092–42105, L150487–150522. Do not infer physical tool numbering solely from the key.
- **Print state:** subscribed fields include `print_stats.state`, `filename`, durations and message; `display_status.progress` and message; `virtual_sdcard.progress` / `is_active`; `machine_state_manager.main_state` / `action_code`. These are actual field names, not a certified exhaustive enum or a live printer payload. W:L42068–42105.
- **Connection changes:** connected/disconnected/current-changed notifications update readiness; reconnect re-queries the current device. Clear or mark old values stale when the connection or selected serial changes. The shipped status synchronizer resets its snapshot, queues incoming changes during resubscription and retries failed synchronization. `notify_klippy_ready` also triggers synchronization. W:L164575–164659, L150833–150989. No observed freshness bound exists, so an adapter needs its own received-at and stale indicators.

## Existing cloud token and credential ownership

The existing WebOrca Snapmaker cloud token does not locate a local Control process, start it, establish its account session, select/connect a device, or bypass its origin policy. There is no release-client evidence of passing that token as `/ws` authorization or of using `/api/cache/all` on the remote identity service.

The shipped UI has a separate local login handoff: `POST /api/login` takes **`access_token`, `refresh_token`, `id_token`, `token_type`, `expires_in`**. Its builder requires nonempty access/refresh/type strings and positive expiry; absent `id_token` falls back to the access token. It also reads `GET /api/account` and posts `/api/logout`. W:L163031–163086. Thus one existing access token is insufficient for the demonstrated login payload, and attempting a token-only login would be an invented contract. We did not call any of these account endpoints or extract any account state.

**The smallest path compatible with no WebOrca server credential persistence is a user-local Control reader.** The user retains their official Control installation and account, establishes its printer connection through its UI, and supplies its actual local origin. First verify the read sequence in that same-origin context; keep only normalized telemetry in the adapter/browser connection's memory. Do not send cloud tokens to a hosted relay or read `/api/account` to bootstrap the telemetry reader. If a bridge is later required, limit it to this identified local instance and the agreed read methods; it needs a separate reviewed transport/access design.

Control is an account owner with its own storage policy. Its [README documents per-user settings, device-list and log storage][storage], and the release UI hands it a refresh token. The inspected material does not establish whether/how credentials are persisted, encrypted or disabled. Do not claim Control is stateless or that its persistence is disabled. If “no server credential persistence” includes **every companion backend**, rather than WebOrca's server, compliance remains unresolved and this path cannot yet be approved under that interpretation.

A hosted WebOrca server cannot reach the user's loopback Control directly. A hosted browser page might reach its own machine's loopback only if the actual browser and Control origin policies allow it; those checks remain outstanding. Opening the official Control page is the currently documented browser path. Do not redistribute its proprietary assets into WebOrca to manufacture a same-origin solution.

## Verification and next evidence needed

Verified the package digest, static asset identities, cited source paths/line spans and local document links. No builds or test suites were appropriate for this documentation-only change. No companion launch, private account access, authenticated API call, browser credential access, local/device probe, port scan, restart or deployment occurred. User instructions restrict writes to this document and ignored evidence, so project tracking and README updates belong to the parent task.

Once the user identifies their running Control origin and authorizes its read check, capture only health readiness, current `sn`/`connected`, sanitized cache structure, a subscription snapshot, a subsequent temperature/status delta and disconnect behavior. Check same-origin acceptance first, then the intended WebOrca origin without suppressing browser security controls. Record response CORS headers and WS acceptance/rejection without collecting account tokens or cookies. Until then, **the live access/freshness check is blocked by the missing user-owned running endpoint; cross-origin support and Control credential persistence remain unresolved server contracts**.

[lock]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/.github/connect-bundle.lock.json#L1-L11
[stage]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/scripts/packaging/stage_connect_bundle.py#L210-L245
[archive]: https://github.com/Snapmaker/snapmaker_control/releases/download/v1.8.5/snapmaker_control-1.8.5-linux-x64.tar.gz
[readme]: https://github.com/Snapmaker/snapmaker_control/blob/e664cba6adf7cd5cda9a164401662ea263aad6bf/README.md#L8-L22
[local-pages]: https://github.com/Snapmaker/snapmaker_control/blob/e664cba6adf7cd5cda9a164401662ea263aad6bf/README.md#L69-L85
[discovery]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/ConnectionProcessManager.cpp#L389-L453
[health]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayService.cpp#L807-L901
[health-parser]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayProtocol.cpp#L51-L102
[handshake]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayService.cpp#L221-L239
[cache]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayService.cpp#L655-L671
[cache-consumer]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayDevice.cpp#L59-L121
[current]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/GUI_App.cpp#L5889-L5990
[objects-parser]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayProtocol.cpp#L135-L149
[storage]: https://github.com/Snapmaker/snapmaker_control/blob/e664cba6adf7cd5cda9a164401662ea263aad6bf/README.md#L113-L125
[ws-standard]: https://websockets.spec.whatwg.org/#dom-websocket-websocket
[cors]: https://fetch.spec.whatwg.org/#http-cors-protocol
