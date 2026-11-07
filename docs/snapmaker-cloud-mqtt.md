# Snapmaker U1 Cloud MQTT monitoring contract

Current release, 2026-11-05: CURRENT5070 publishes read-only printer-reported material, vendor, subtype, color and presence through `filamentSlots`; `filaments` remains omitted. The real idle four-tool comparator matched all assignments, explicit indices 0–3 and true presence; exact source/gateway/decoder mapping and retention across heater deltas/fresh query passed. Physical unload/reassignment, job lifetime and other accounts remain open. No project sync, uploads or controls are enabled. See [actual acceptance](../wasm/build/tests-snapmaker-filaments/actual/report.md), [sealed QA/provenance](../wasm/build/tests-snapmaker-filaments/qa-recovered/report.md) and [publication/rollback](../wasm/build/tests-snapmaker-filaments/publication/report.md). Restart cleared OrcaCloud RAM sign-in; browser presets remain. Bambu China and physical Safari/accessibility TODOs remain open.

The bootstrap status paragraph and source investigation below are historical, preceding this filament release. The subsequent [filament trace and bounded acceptance](snapmaker-cloud-filaments.md) establish the implemented index/color/presence mapping.

Historical bootstrap status, 2026-11-05: the exact real-tested bootstrap candidate is published on CURRENT5070; see the [real-test report](../wasm/build/tests-snapmaker-monitor-bootstrap/actual-r2/report.md) and [publication evidence](../wasm/build/tests-snapmaker-monitor-bootstrap/publication/report.md). One password login and two bounded connections passed exact checkAuth binding before public DNS/strict TLS, CONNACK, four QoS1 SUBACKs and read-only objects.list/subscribe/query. An eight-object snapshot reported standby status and five finite heater temperatures; fresh nonretained heater deltas passed. Optional setSubscribeFilter returned -32601 and used the existing fallback. The connector binds broker/topic configuration to the fixed authenticated API, accepts narrow ATS/non-ATS AWS IoT data-host forms and selected-device topics, and keeps TLS credentials in connection-only Node memory without persistence. Durable tokens remain in browser storage; official Control is not required. Other accounts, broader provider capabilities and external-session acceptance remain open; materials, uploads and controls are unsupported. The blocked-connector conclusion and working-tree observations below are historical research, preceding the implemented provenance-based connector.

Investigated 2026-11-05 against Snapmaker/OrcaSlicer commit **`6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c`**. This follows [the account/device research](snapmaker-cloud-integration.md). Evidence is public static source, not a captured authenticated exchange or a provider-supported third-party API specification.

**Result: the monitoring protocol is substantially traceable, but a secure hosted connector remains blocked.** The examined sources provide no exact cloud broker hostname or permitted hostname suffix. Port `8883` is a parser default, not a demonstrated fixed server port. Amazon Root CA 1 is established; that CA does not identify Snapmaker's AWS tenant. Do not enable a relay to arbitrary response-supplied hosts or `*.amazonaws.com`. No first-party cloud WSS alternative was established.

No login, email, certificate issuance, broker/device probe, private account/configuration, service, production edit, build, or test suite was used. Only this document and [public evidence](../tests-snapmaker-cloud/mqtt-research/manifest.md) were written. Line numbers below refer to original pinned source; retained excerpts preserve those numbers.

## Credential retrieval and TLS

`GET /user/device/getMqttCert` uses the regional account/device HTTP client and Bearer session described in the prior research (`https://id.snapmaker.com/api` internationally, `https://api.snapmaker.cn/api` for CN). The request has no body, serial, device ID, or user-ID query parameter. `fetchUserAwsIoTConfig(userid)` logs its argument but does not pass it to the request. It parses successful envelope `data` as follows; the shared HTTP success parser accepts business code `0` or `200`. [F1][F2] [Prior HTTP evidence](snapmaker-cloud-integration.md#bound-devices).

| Normalized field | Exact source behavior |
| --- | --- |
| `endpoint` | Non-null/nonempty `endpoint`, otherwise nonempty `ip`, otherwise `""` |
| `port` | Non-null/nonempty `port`, otherwise numeric `8883`; parser does not enforce numeric type/range |
| `cert` | Nonempty `cert`, otherwise `secretId`, otherwise `""` |
| `key` | Nonempty `key`, otherwise `secretKey`, otherwise `""` |
| `ca` | Initially nonempty `ca`, otherwise `trustCert`, otherwise `""`; then **unconditionally replaced** with the embedded Amazon Root CA 1 by the credential-fetch helper |
| `clientId` | Nonempty `clientId`, otherwise `clientid`, otherwise `""` |
| Subscribe suffix list | `topics.subscribe` when non-null, otherwise flat `subscribeTopics`, otherwise `[]`; converted to a list of strings |
| Publish suffix list | `topics.publish` when non-null, otherwise flat `publishTopics`, otherwise `[]`; converted to a list of strings |

The names `secretId`/`secretKey` are aliases for certificate/key material here, not evidence of AWS access-key/SigV4 authentication. The transport constructs `mqtts://<endpoint>:<port>` when CA, certificate and key are nonempty, then passes both `clientId` and `clientid` with the **returned ID unchanged**, `keepAlivePeriod:30`, `clean_session:false`, CA/cert/key and printer serial to the native client. There is no cloud client-ID prefix, random suffix, or timestamp added in this path. `mock-<Date.now()>` is an internal agent handle when reusing an existing connection, not a new MQTT client ID. The model getter uses a local fallback only when its credential client ID is empty. [F1][F3][F4]

The native engine also uses the returned ID, CA, certificate and private key. Its username/password default to empty; OAuth Bearer is for HTTP credential retrieval, not the shown MQTT CONNECT authentication. Native connect creates `mqtts://<host>:<port>`. [N1]

CA provenance is resolved: Flutter's embedded PEM [F2] is byte-for-byte equal to the public [Amazon Root CA 1 PEM](https://www.amazontrust.com/repository/AmazonRootCA1.pem), subject/issuer `C=US, O=Amazon, CN=Amazon Root CA 1`, valid 2015-05-26 through 2038-01-17. DER SHA-256 fingerprint:

```text
8E:CD:E6:88:4F:3D:87:B1:12:5B:A3:1A:C3:FC:B1:3D:70:16:DE:7F:57:CC:90:4F:E1:CB:97:C6:AE:98:19:6E
```

Native `MQTT.cpp` enables server certificate authentication but calls `ssl_opts.set_verify(false)` (hostname verification), selects TLS 1.2, and writes the PEM inputs to temporary files. **These are observations, not suitable bridge requirements.** A WebOrca implementation must verify the selected server's certificate chain and hostname/SNI against its fixed trusted CA, and use in-memory PEM buffers. No fallback to plaintext, arbitrary supplied CA, disabled verification, or credential files. [N2]

## Topic construction, without guessed normalization

Credential topic arrays are not a map. `bQW()` splits each string on `/` and, if there is more than one component, stores **the original entire string** under key `parts[1]`; later duplicates overwrite earlier ones. It does not trim a prefix or strip the printer serial. Thus `/request` maps to key `request`, value `/request`; do not assume a complete topic may safely be concatenated twice. The actual issued arrays remain unobserved. [F5]

For a WAN model, let `P=bQW(publishTopics)`, `S=bQW(subscribeTopics)`, `C=returned clientId`, `SN=selected bound-device sn`. `Dp()` constructs these maps, then `bdt()` constructs subscriptions: [F6][F7]

| Purpose | Source-derived final topic |
| --- | --- |
| Request publish | `SN + (P.request ?? "/request")` |
| Response subscribe | `SN + (S.response ?? "/response")` |
| Status subscribe | `SN + (S.status ?? "/status")` |
| Notification subscribe | `SN + (S.notification ?? "/notification")` |
| Config subscribe | `SN + S.config + "/" + C` |
| Config publish map entry | `P.config + "/" + C` is created, but this WcpClient publish path reads `request`, not this entry |
| Data/error entries | Carried in maps, but not subscribed by the shown WcpClient startup |

The WAN config expression has no fallback before string conversion. Missing `S.config` yields a `"null/<C>"` suffix in the compiled Dart path. This is not a topic to invent for a new connector: fail closed on missing/unrecognized required config rather than copying malformed fallback behavior.

There is a separate access-code/LAN branch using `accessCode + authRequest/authResponse/config`, with defaults `/config/request`, `/config/response`, `/config/notification`. WAN `Dp()` carries `authCode`/`code` metadata but does **not** pass an `accessCode` key; do not trigger this LAN authorization branch for cloud monitoring. [F6][F7]

Cloud `WcpClient` subscribes sequentially to status, response, notification, then its config topic, each with QoS **1**. It publishes JSON-encoded JSON-RPC to its request topic with QoS **1**. Native engine handoff is an additional path: connect subscribes `SN/notification` and `SN/response`, while state registration adds `SN/status` and `SN/notification`; these native topics use fixed suffixes. Do not collapse these two paths into an assertion that every issued topic array is known. [F8][N1][N3]

## Requests, responses, startup

At the MQTT boundary the request payload is JSON-RPC 2.0, not the desktop WebView's WCP `header`/`payload` envelope. The WcpClient direct path serializes the original command map as JSON. The native MoonRaker engine constructs `{jsonrpc:"2.0",method,params?,id}` and publishes it to `SN/request`; its native/WCP callback wrapper is internal to the desktop application. [F8][N4]

The app correlates pending JSON-RPC requests using the string representation of `id` and removes the pending entry on completion/timeout. Its native engine's own sequence IDs are numeric `int64_t`, and native responses are looked up by numeric `id`; WCP `seqid` is a separate wrapper identifier. A bridge should use bounded safe integer IDs and match the exact pending ID within its connection, without exposing wrapper IDs to the broker. Expect `{jsonrpc:"2.0",id,result:...}` or `{jsonrpc:"2.0",id,error:...}`. An MQTT PUBACK only acknowledges transport delivery. [F9][N4][N5]

The native engine adds top-level `cli_time` (Unix seconds) and `dev_time` (`-1` before synchronization, then estimated device Unix seconds). `TimeSyncManager` derives the offset from response time fields and RTT, resets after clock rollback or three invalid/missing time responses. Flutter's direct MQTT publish map does not add these fields. Whether firmware requires them in every cloud session is not established; preserve this difference when choosing the engine-compatible implementation. [N4][T1]

The observed recovery flow is: establish transport/subscriptions, `printer.objects.list`, `printer.objects.subscribe`, `printer.objects.setSubscribeFilter`, then `printer.objects.query`. The subscribe call occurs inside the filter helper before the filter request. The list result's `objects` array intersects the default requested set and adds matching `^extruder(\d*)$` objects. Both subscription/filter helpers tolerate JSON-RPC `-32601` (method unavailable). That tolerance does not prove a printer supplies live updates without those methods. [F10][F11]

| Method | Exact params shape | Use for the minimal monitor |
| --- | --- | --- |
| `printer.objects.list` | No params | Discover supported objects; result contains `objects:[...]` |
| `printer.objects.subscribe` | `{objects: objectFieldMap}` | Establish object update stream |
| `printer.objects.setSubscribeFilter` | `{objects: objectFieldMap, sn:SN}` | Observed filter registration; same field-map construction |
| `printer.objects.query` | `{objects: objectFieldMap}` | Initial snapshot, read `result.status` |
| `machine.heartbeat` | No params | Available read-only liveness method; exact necessity/cadence for a new monitor is not established |

Method encoders are in [F12]; `objectFieldMap` is generated by `bNG()` [F13]. A minimal proposed field set, restricted to discovered objects, is:

```json
{
  "print_stats": ["filename", "state", "total_duration", "print_duration", "filament_used", "message", "info"],
  "display_status": ["progress", "message"],
  "heater_bed": ["temperature", "target"],
  "extruder": ["temperature", "target", "power", "can_extrude", "pressure_advance", "smooth_time", "state", "nozzle_diameter", "nozzle_volume_type", "extruder_index"]
}
```

Add discovered `extruder1`, etc. with the same fields. This is a source-derived proposal, not a captured payload. For example, a query is `{ "jsonrpc":"2.0", "id":1, "method":"printer.objects.query", "params":{"objects":<the map above>} }`; the filter additionally has `params.sn`. Receive-only MQTT subscriptions are insufficient to reproduce the official startup: these narrowly allowed monitoring requests must be published. The bridge must generate them itself or strictly validate method, fields, ID, selected serial and topic. No arbitrary method/params/topic publish API.

## Status and material data

The Flutter observer requires `jsonrpc:"2.0"`. It recognizes `notify_status_update` and processes two-element `params` whose first element is an object map and second a number: `[changedObjects, eventTime]`. Updates merge into existing per-object state; absent fields are not cleared. Query results are read as `result.status`. Native status and notification handlers also accept either `params` or `result.status`, then wrap that value for WCP callbacks. Do not mistake their internal `data` field for an outer MQTT requirement. [F14][F15][N5]

Source-derived notification shape (no real device data):

```json
{"jsonrpc":"2.0","method":"notify_status_update","params":[{"heater_bed":{"temperature":45.5,"target":60}},123.5]}
```

| Object/data | Established fields and limits |
| --- | --- |
| `print_stats` | `filename`, `state`, `total_duration`, `print_duration`, `filament_used`, `message`, `info`; parser preserves supplied values. No units/complete state enum are established here. |
| Layers | UI reads `print_stats.info.current_layer` and `.total_layer`; missing becomes `NA`. Do not manufacture a layer count from progress. |
| `display_status` | Requests `progress`, `message`. The compiled model's updater reads but does not assign progress, while storing message; use the wire field conservatively, not that implementation quirk as a protocol rule. |
| `virtual_sdcard` | Requests `progress`, `file_position`, `is_active`, `file_size`, `file_path`; useful optional progress source. |
| `heater_bed` | `temperature`, `target`; UI model suppresses temperature changes of at most 0.5, which a raw monitor need not copy. |
| `extruder`, `extruderN` | Field list above; discovery uses the name regex. Preserve `extruder_index` as reported. This identifies objects/tools, not proven spool slots. |
| `print_task_config` | Requests filament vendor/type/SKU/official/subtype/color/RGBA, `extruder_map_table`, `extruders_used`, existence/edit/soft flags, multicolor/replenishment fields and calibration settings. This is task configuration; field names alone do not establish installed spool topology. |
| `filament_detect`, `filament_feed left/right` | Requested with `null` field selector (all fields); parsers exist, including index/detection/channel state/error. No source-backed mapping from these objects to physical U1 spool slots was established in this followup. |

Sources: field selectors [F13], incremental object parser [F15], print/material model [F16], bed parser [F17], layer UI [F18]. A minimal live monitor can show file/state/progress/temperatures/layers when present. Keep material data as raw provider configuration until a separate trace proves array indexing, tool mapping and physical slot semantics. Do not label four inferred filament slots.

## Delivery, teardown and session isolation

Native publishes are QoS 1 and **retain=false**: `MqttClient::Publish` creates a Paho message with default retained flag `false`, then sets only QoS. Flutter's native publish command supplies QoS 1 without a retain option. This does not establish whether provider status messages themselves are retained or their publishing QoS. Expect possible duplicate delivery; match responses once and merge notifications idempotently. [N6][P1][F8]

The native constructor sets persistent sessions (`clean_session=false`), keepalive 30 seconds and connect timeout 10 seconds. After a successful connection it enables automatic reconnect with 2–30 second bounds; it records subscriptions for resubscription. The Flutter command layer uses bounded attempts/timeouts, generally two attempts for subscribe/filter/list and three for query, each 3 seconds or 10 seconds depending on connection state. IDs remain the same across retries and pending entries are cleaned. These are client behaviors, not a server expiry/replay guarantee. [N2][N7][F9][F10][F11]

Flutter disconnect releases its native engine/client and removes its event-stream listener. Native state unsubscription removes its local callback and unsubscribes the status topic when appropriate. Nothing traced establishes remote certificate expiry/revocation, per-browser client-ID allocation, concurrent client-ID acceptance, tenant/device MQTT ACLs, or expiry of server-side subscribe filters. [F19][N3]

**Isolation blocker:** the credential fetch is user-scoped and its client ID is reused unchanged. There is no proven suffix rule permitting an independent browser/tab/connection ID. Persistent broker sessions plus duplicate client IDs can collide; the desktop's shared native-engine reuse is not a multi-user hosted isolation contract. Do not guess that a random client ID is authorized, share one broker connection across users, or let one browser connection alter another's serial/filter. A provider statement or separately authorized acceptance must establish credential scope, allowed IDs and simultaneous sessions.

## Exact feasible minimum and missing contract

A same-origin WS-to-native-MQTT/TLS bridge is technically feasible with Node's MQTT/TLS support and in-memory certificate/key buffers. [The existing Bambu cloud connector](../wasm/app/printerGateway.ts#L503) demonstrates one WS connection owning one broker client, no automatic reconnect, a ten-second initial-message/connect timeout, fixed cloud host validation, read-only publication checks, and broker termination on WS close. Its local connector's disabled TLS verification must not be reused. The [hosted dispatcher](../wasm/app/gateway/hostedPrinterCloud.ts) currently exposes HTTP handlers; [the deployment server](../wasm/deploy/server.mjs#L80) validates HTTP origin/authority but has no printer WS upgrade handler. These are local working-tree observations, not Snapmaker contract evidence.

Once destination and isolation are established, the narrow implementation would:

1. Allow one exact upgrade route with explicit configured Host and Origin checks, provider feature gate, size/rate/connection limits, and rejection of unknown paths/origins before upgrade. HTTP CORS/COOP/COEP is not WS authorization.
2. Accept credentials in one initial WS frame, never in URLs. Keep durable account tokens browser-owned; hold certificate/key only in browser memory and that connection's volatile Node/MQTT/TLS objects. No disk, database, cache, logs, shared session registry or durable queue.
3. Use an exact provider-specific broker allowlist and supported port, fixed verified CA, SNI/hostname verification, and public-address validation/pinned DNS resolution. Bind endpoint/serial/topics to provider-issued configuration through a trusted validation path; accepting a browser's claim that an arbitrary endpoint came from `getMqttCert` is insufficient. A response obtained directly from the fixed provider API and consumed only during connection setup could provide provenance, but is a different implementation choice from trusting a submitted JSON map.
4. Subscribe only to the selected printer's validated topics, publish only the monitoring methods above with bounded fields, correlate responses, merge deltas and expose stale/disconnected state. Do not forward other printers' traffic. Require acknowledgement/snapshot before reporting live monitoring.
5. Disable automatic reconnect initially. On browser close, upstream failure, timeout, logout or explicit disconnect: end/destroy broker and WS, cancel timers, clear pending requests/buffers/references to credentials and TLS options. JavaScript/OpenSSL cannot promise physical zeroization of every copied secret; removal of reachability and no persistence are the enforceable lifecycle. Reconnection must start from a fresh browser-owned connection context.

**Do not implement this connector yet under the stated evidence constraint.** Required missing contract:

- Exact Snapmaker-controlled broker hostname(s), or sufficiently narrow provider-specific suffix/tenant identity, and permitted port(s). The examined Flutter/MQTT/MoonRaker sources contain no `amazonaws`, `.iot.` or `wss://` literals; they consume dynamic endpoint/port values. `8883` alone does not solve destination binding. A pinned CA authenticates a CA chain, not a Snapmaker tenant.
- Authorized cloud client-ID/session isolation and account/device topic ACL scope, plus the actual issued topic-array shape. The transformations are exact above; their real input values were not obtained under this no-auth scope.
- If choosing browser-direct transport: an actual provider WSS URL/path, authentication method and origin support. Do not turn `mqtts://host:8883` into an invented `wss://host/...`; the native transport here uses returned client certificate/private key, which browser WebSocket does not expose as per-connection TLS options.

The CA is **not** a remaining unknown. The HTTP login/device work can continue independently. This investigation does not establish live acceptance, firmware-wide subscription behavior, or a permission to reuse Snapmaker's public client identity.

## Evidence references

All Snapmaker links below pin the commit named above. [Evidence manifest](../tests-snapmaker-cloud/mqtt-research/manifest.md) records original URLs, hashes, retained line ranges and verification commands. Documentation references and PEM equality were checked; no production tests/builds were run for this documentation-only work.

[F1]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L35322-L35348
[F2]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L36648-L36722
[F3]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L168100-L168165
[F4]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L139069-L139072
[F5]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L35405-L35410
[F6]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L139215-L139250
[F7]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L43802-L43848
[F8]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L168510-L168644
[F9]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L156406-L156552
[F10]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L139748-L139953
[F11]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L35575-L35614
[F12]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L138675-L138758
[F13]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L35185-L35224
[F14]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L141650-L141866
[F15]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L141968-L142117
[F16]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L142250-L142290
[F17]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L142188-L142198
[F18]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L159369-L159375
[F19]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L168390-L168433
[N1]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/MoonRaker.cpp#L1132-L1332
[N2]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/MQTT.cpp#L21-L140
[N3]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/MoonRaker.cpp#L1402-L1687
[N4]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/MoonRaker.cpp#L2544-L2600
[N5]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/MoonRaker.cpp#L2749-L2887
[N6]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/MQTT.cpp#L345-L358
[N7]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/MQTT.cpp#L591-L632
[P1]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/mqtt/include/mqtt/message.h#L56-L143
[T1]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/TimeSyncManager.cpp#L6-L106
