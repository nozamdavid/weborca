# OctoEverywhere implementation contract

Authorized 2026-11-05: implement the documented integration while the user requests a production App ID. Research: [integration research](octoeverywhere-integration-research.md). No production App ID is available yet. Never substitute the demo ID or invent provider contracts. Live 5070 publication is outside this implementation batch.

## Ownership and sequence

1. Backend task owns `wasm/app/gateway/octoEverywhere.ts`, backend tests, `wasm/deploy/server.mjs`, Vite packaging/configuration and local gateway wiring. It must preserve existing providers, isolation headers, release artifacts, and their tests.
2. Client task owns new browser API/normalization modules, `printers/types.ts` optional fields and `printers/api.ts` dispatch, and client tests. It does not edit Device or connection UI, server/Vite, documentation, or other provider adapters.
3. UI integration follows the completed backend/client contracts. It owns connection setup, Device features, Send-to-Printer capability handling, scoped styles, and UI tests. One integrated production candidate follows the completed feature batch.
4. Review and documentation/tracking follow verification. Each task records exact changed paths and evidence. Work shares a dirty checkout; preserve all unrelated edits.

## Product scope

Preserve the saved printer's underlying host type, local address, credentials and preset. Add optional `octoeverywhere` settings with an explicit `mode: 'local' | 'remote'`; remote mode is only usable with an authorized connection. Reverting to Local retains the authorized link. Do not silently replay a mutation across transports. Connection removal detaches WebOrca; provider revocation is a separate action on OctoEverywhere's website.

Support hosted portal linking, reconnect/detach, external Open printer, connection/account state and limits, normalized monitoring, snapshots and MJPEG cameras, material topology, capability-gated controls, files list/details/upload/download/delete and start, Gadget status, Live Link creation, and notification webhook set/delete/test. Provide native HTTP/WebSocket relay and MQTT-over-WebSocket infrastructure for supported uses, without adding an arbitrary command console. Common APIs are the default remote adapter. Browser-native push notifications and the separate AI processing product are not implied by this printer integration.

Webhook configuration sends explicit user-provided HTTPS callback settings to OctoEverywhere; this batch need not introduce a new push provider or publicly expose the Tailscale app. Show the public callback requirement. No real account, printer command, file mutation, sharing, or webhook request may be used as a test; use synthetic upstream fixtures.

## Saved connection and gateway boundary

The connection payload uses:

```ts
interface OctoEverywhereConnection {
  connectionId: string;
  url: string; // provider-returned HTTPS root, exactly one subdomain of octoeverywhere.com
  appApiToken: string;
  auth: { type: 'bearer'; token: string } | { type: 'basic'; username: string; password: string };
  printerName: string;
  userFacingUrl: string;
  printerId?: string;
  nativeApiKey?: string; // optional portal-generated OctoPrint API key
}
interface OctoEverywhereSettings {
  mode: 'local' | 'remote';
  connection?: OctoEverywhereConnection;
  userFacingUrl?: string;
}
```

Browser credentials follow the existing per-printer persistence model and must never enter query strings, logs, errors, user-facing links, or fixtures copied from personal data. Backend sessions retain credentials only in bounded RAM and are scoped by unguessable session tokens, with TTL and cancellation cleanup. Native host credentials are separate from provider auth; do not forward unrelated cloud credentials.

All routes are beneath `/_octoeverywhere`. Runtime configuration is `ORCA_OCTOEVERYWHERE_ENABLED=1`, optional `ORCA_OCTOEVERYWHERE_APP_ID`, and existing canonical `ORCA_PUBLIC_ORIGIN`. Missing App ID disables portal creation with an actionable configuration state; other synthetic/session tests can run. Production stays disabled unless explicitly configured. Vite/local support must use the same implementation and origin rules.

JSON responses use documented upstream payloads where possible, with gateway failures `{error: string, code?: number}` and HTTP status. The client must inspect plugin JSON `Status` even when HTTP is 200. Gateway-only responses:

| Route | Input | Output / behavior |
| --- | --- | --- |
| `GET /config` | none | `{enabled, appId?, portalAvailable}`; public nonsecret configuration |
| `POST /portal/start` | `{printerId?, requestOctoPrintApiKey?: boolean}` | `{portalUrl, flowId, pollToken}` |
| `GET /portal/result/:flowId` | `X-OctoEverywhere-Flow: <pollToken>` | `{status:'pending'}` or `{status:'complete', connection}` or `{status:'failed', error}`; complete credentials consumed once |
| `DELETE /portal/result/:flowId` | flow header | cancels pending flow and disposes result |
| `GET /portal/callback` | provider completion params plus correlated state in returnUrl | validates flow, stores bounded result, redirects to a clean completion page without secrets; rejects unsolicited/replayed callbacks |
| `POST /sessions` | `{connection, nativeApiKey?}` | `{sessionId, sessionToken, expiresAt}` |
| `DELETE /sessions/:id` | session header | closes streams/upgrades and destroys credentials |
| `/sessions/:id/plugin/<command>` | session header; native documented method/body/query | fixed allowlist of documented common plugin routes, methods, and bounded schemas |
| `GET /sessions/:id/info` | session header | raw App Connection Info JSON |
| `POST /sessions/:id/gadget` | session header; documented JSON | raw Gadget response; enforce provider polling guidance |
| `POST /sessions/:id/live-link` | session header; documented JSON | raw Live Link response |
| `POST /sessions/:id/notifications` | session header; documented webhook settings | SetNotificationWebhook |
| `DELETE /sessions/:id/notifications` | session header | DeleteNotificationWebhook |
| `POST /sessions/:id/notifications/test` | session header | TestWebhook |
| `POST /sessions/:id/ticket` | session header; `{kind:'snapshot'|'stream'|'websocket'|'mqtt', index?:number, path?:string}` | `{url, expiresAt}`; short-lived opaque ticket bound to session and fixed operation, no provider secrets |

Authenticated HTTP session header is `X-OctoEverywhere-Session: <sessionToken>`. A ticket endpoint serves camera images or upgrades without arbitrary browser auth headers; cross-origin access is rejected. Tickets cannot grant a different operation, target, or path. Backend task documents final ticket consumption URLs, session lifetime and native relay allowlist in its handoff. Client uses returned ticket URLs without constructing them.

Native relay HTTP route: `/sessions/:id/native/<native-path>` with session header, preserving method/body and explicitly allowed native API paths for OctoPrint/Moonraker/PrusaLink. Native websocket ticket path is `/websocket` (Moonraker) or a documented supported OctoPrint socket route; MQTT ticket maps only to `/octoeverywhere-command-api/proxy/mqtt`. Never accept arbitrary external URLs, redirects, private resolved addresses, credential-bearing path segments, or unrestricted methods. Do not invent an auth-header collision workaround for native Authorization; common APIs remain available.

Portal opens by external navigation, not iframe. Original page polls the one-time result using its separate poll token, so COOP opener separation is harmless. Callback state is an unguessable transaction identifier embedded in the documented custom returnUrl; it is not an invented provider OAuth state/PKCE parameter. Both resulting flow secrets and returned URLs are validated, no-store and no-referrer. Confirm this callback contract with the provider before real acceptance.

## Client integration

Export typed connection/configuration helpers and `OctoEverywhereApi` implementing `PrinterApi`; factory selects it only for remote mode with a connection. Keep optional additions to common types backwards compatible. The client task supplies typed remote metadata and method contracts for the later UI task: capabilities/limits, lights, cameras and rotation, material topology, file methods, Gadget, Live Links and webhooks. Where existing `PrinterApi` lacks an operation, add a small optional method or an OctoEverywhere-specific helper; avoid a new general framework.

A session is established lazily and destroyed/cancelled on disposal, printer switch, or disconnect. Retry safe reads after session expiration only; never retry a command/upload/start implicitly. Abort polling and downloads on disconnect. Query connection info and use its file/stream limits. Feature availability starts conservative and is updated from actual data. Unknown/null values stay unknown. Progress maps from provider percent to existing 0–1. Preserve material source/tool/route identities and presence; do not invent loaded filament.

Files use returned VirtualPath and documented raw PUT uploads. Separate Upload and Start. Handle Bambu 3MF plate/AMS options explicitly; do not label raw slicer G-code as a compatible Bambu package. Common controls obey documented limits and runtime flags; native-only fan/speed controls must not leak into common mode. Gadget polling is at most once per 10 seconds per connection, only while relevant. Camera streaming has bounded lifetime and reconnect behavior respecting account limits.

## Verification

Backend focused test target: `wasm/tests/node/octoeverywhere-gateway.test.mjs` (synthetic transport) covering disabled/missing-ID states, correlated portal lifecycle and replay, same-origin/session/ticket isolation, exact relay allowlists/DNS/redirect rejection, upstream auth separation, binary/stream transfer, cleanup, limits and errors. Compile gateway TS and check server syntax.

Client target: `wasm/tests/node/octoeverywhere-client.test.mjs` covering actual documented fixture mapping, runtime capability gating, unknown materials, limits/errors, uploads/start separation, session disposal and read-only retries, Gadget polling, camera tickets, extras and unchanged local dispatch. Compile affected TS; defer integrated Vite build to UI completion.

UI target: `wasm/tests/node/octoeverywhere-ui.test.mjs` and one synthetic integrated browser scenario for connect/edit/local-remote switching, failed linking, Device monitoring/controls/files/cameras/extras, missing App ID, desktop/mobile layout and no secrets in rendered URLs/errors. Build one immutable candidate and reuse it for retries unless inputs change. Resource caps use existing 2 GiB/2 CPU app/test runners; no native rebuild.
