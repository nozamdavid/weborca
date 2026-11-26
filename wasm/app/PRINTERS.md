# Printer connections

CURRENT5070 serves `ui-settings-routing-candidate-20261106` (2026-11-06), active/enabled PID2068973. Printer connections use the app server only; local gateway address/discovery/download controls are removed, legacy addresses migrate away, and static hosting needs a compatible backend. The frozen CURRENT5070 server retains four cloud providers with generic LAN proxying disabled. Device preserves saved readings and their receive timestamp on errors/pause. Returning to Device/focus waits until the last successful snapshot reaches 15 seconds before refreshing; manual Retry stays immediate, and healthy monitoring does not reconnect every 15 seconds. Focus within the embedded Web UI keeps monitoring live. Desktop divider drag, keyboard bounds and persisted width retain usable 320/390px stacked mobile layouts and four extruder cards with validated physical tool pairing. Acceptance is **CHROMIUM_SYNTHETIC_ONLY**, including actual browser focus; the remote Snapmaker root cause remains unproven. Historical real Snapmaker telemetry and idle material confirmation below remain separate; physical unload/reassignment/job lifetime, Mac/Safari/Firefox and hardware acceptance remain open. See the [current publication/guarded rollback report](../build/tests-settings-routing-batch/publication/report.md) and [sealed QA](../build/tests-settings-routing-batch/qa-corrected/report.md). Prusa assigned material/vendor/product/RGBA with current-poll REST fallback and Creality CFS/rack inventory retain their [synthetic acceptance](../build/tests-connected-filaments/publication/report.md); real Prusa OAuth/physical MMU and Creality hardware remain open. User preset overwrite preserves inheritance, and settings tabs/help/mobile controls/modal spacing are improved. Four providers and lighting are preserved. Restart clears OrcaCloud RAM sign-in; browser presets remain.

CURRENT5070 includes experimental **Snapmaker Cloud**, International accounts only: email/password
or email-code login, refresh, profile, already-bound device selection and direct read-only monitoring.
The real-tested filament candidate is published with the HTTP201 fix, exact checkAuth binding,
fixed stage/reason diagnostics and manual Retry. Real read-only standby status, five finite heater
temperatures and fresh nonretained heater deltas passed on 2026-11-05. Restart cleared OrcaCloud RAM sign-in;
browser presets remain.
Select Snapmaker Cloud as Host type; `id.snapmaker.com` and global scope are fixed, and the
same-origin gateway is required. Agree to the terms before login or explicitly sending a code;
changing sign-in method sends no email. Cancel discards unsaved device fields; cached accounts and
explicitly saved printers can restore. Durable access/refresh tokens stay in browser storage;
passwords/codes are transient. Monitoring uses connection-only Node TLS credential memory without
persistence and a bounded connector with authenticated API broker/topic provenance. Official Control
is not required. One password login and two bounded real connections passed device/client authorization,
strict TLS, CONNACK, four QoS1 SUBACKs and read-only object RPCs. Optional setSubscribeFilter -32601
uses the existing fallback. Job progress and manual Retry remain synthetic-tested, with 101 sealed QA tests.
Published Preview lighting, desktop UI and native assets are retained. Other accounts, broader provider
capabilities, external-session behavior, Bambu China and physical Safari/accessibility acceptance remain open.
Device shows printer-reported material, vendor, subtype, color and presence by physical tool index.
The real idle comparator matched all four tools, each explicitly present: Grey PLA/Generic,
Blue PLA/Bambu Lab Silk, Black PLA/Bambu Lab Matte and White PLA/Generic. Heater deltas and a fresh query
retained these assignments. Physical unload/reassignment and job lifetime remain unvalidated.
Only read-only `filamentSlots` are exposed; `filaments` is omitted. Project sync, uploads, controls and a device WebUI
are unsupported. Earlier availability-only claims describe the historical account release.
See the [actual report](../build/tests-snapmaker-filaments/actual/report.md),
[reconstructed source and sealed QA](../build/tests-snapmaker-filaments/qa-recovered/report.md),
[publication/rollback report](../build/tests-snapmaker-filaments/publication/report.md) and
[pinned research](../../docs/snapmaker-cloud-integration.md).

The web app can read from and send jobs to printers on your network: Klipper (Moonraker), PrusaLink,
OctoPrint, Bambu Lab (LAN mode), and the modern Flashforge HTTP API. Add a printer from the sidebar's connect button or the Device tab;
the dialog asks for the API address (`print_host`) and the printer's own web UI address (`print_host_webui`),
like desktop's physical printer dialog.
Klipper (Moonraker) API addresses use port 7125 when no port is entered. Explicit ports, including 80 and 443, are preserved. The printer's web UI address is separate.

Choosing a printer profile in the Prepare sidebar associates it with the selected device and saves
the current filament presets and colors. For an unbound device, **Use current profile for device**
keeps the settings already displayed. Saved user printer profiles use their system parent's brand
and defaults before restoring the device's filament setup. Project loading and programmatic profile
selection do not change the saved device profile.

## Why there is a gateway

A browser cannot reach most printers directly:

- Moonraker only sends CORS headers for a short list of origins and checks the `Origin` of websockets.
- An https page cannot call an http printer (mixed content).
- Bambu Lab printers speak MQTT over TLS and FTPS, which browsers cannot.

The Vite dev and preview servers therefore carry a **printer gateway** (`printerGateway.ts`,
rules in `gateway/policy.ts`). The app talks to `/_printer/...` on its own origin and the gateway
relays to the printer. Printer traffic always uses this same-origin backend. Static hosting without
a printer backend cannot connect to printers. Saved legacy gateway addresses are discarded on reload
without deleting printers, account tokens, or filament settings.

| Route | What it does |
| --- | --- |
| `GET /_printer/status` | `{ enabled, mode, readOnly }`, used by the dialog to explain what is wrong |
| `/_printer/<http\|https>/<host[:port]>/<path>` | Streaming reverse proxy (uploads, MJPEG cameras). Strips `Origin`, `Cookie` |
| `WS /_printer/<ws\|wss>/<host[:port]>/<path>` | Websocket relay (Moonraker `/websocket`). Frames sent before the upstream is open are queued |
| `WS /_printer/bambu/mqtt/<host>` | MQTT bridge. First frame `{type:"connect", serial, accessCode}`; then `{type:"publish", payload}` goes to `device/<serial>/request` only |
| `POST /_printer/bambu/ftp/<host>` | FTPS upload (`x-bambu-filename`, `x-bambu-access-code`) |

PrusaLink's default HTTP Digest login is done by the gateway: the app sends `x-orca-auth: digest user:password`,
which is never forwarded to the printer.

## Turning it on

LAN forwarding is **off** unless the server is started with `ORCA_PRINTER_PROXY`. Cloud bridges can be enabled separately with `ORCA_PRINTER_CLOUD`:

```bash
ORCA_PRINTER_PROXY=private npx vite preview --host 0.0.0.0 --port 5070
ORCA_PRINTER_PROXY=printer.local,192.168.0.20 npx vite preview   # only these hosts
ORCA_PRINTER_PROXY=private ORCA_PRINTER_PROXY_READONLY=1 npx vite preview   # reading only
ORCA_PRINTER_PROXY=private ORCA_PRINTER_PROXY_READONLY=1 ORCA_PRINTER_PROXY_ALLOW_UPLOAD=1 npx vite preview   # plain Moonraker uploads too
```

## Security model

Anyone who can reach the app server can use the gateway, so it is restricted:

- `private` allows only private, loopback, link-local and tailnet addresses (10/8, 172.16/12, 192.168/16,
  100.64/10, 127/8, 169.254/16, fc00::/7, fe80::/10, ::1). A host name must resolve to private addresses
  only, and the gateway connects to the address it checked, so DNS rebinding cannot swap it afterwards.
- A comma list restricts the gateway to exactly those hosts.
- `ORCA_PRINTER_PROXY_READONLY=1` refuses everything that could change a printer: any HTTP method but
  GET/HEAD/OPTIONS (plus the read-only Flashforge `POST /detail` query), the few Moonraker paths that act on a GET (`/printer/gcode/script`, `/printer/print/*`,
  `/printer/emergency_stop`, restarts, ...), and every websocket JSON-RPC request outside a read-only
  allow-list. Frames that are not valid JSON, batches containing a refused request and binary frames are
  dropped, so the filter fails closed. On Bambu only `info.get_version` and `pushing.pushall` pass.
  HTTP path checks inspect every segment after bounded decoding of nested escaping, so prefixes and
  encoded separators cannot hide command names. Method-override headers are refused for mutating verbs
  in read-only mode and are stripped before forwarding in every mode.
- `ORCA_PRINTER_PROXY_ALLOW_UPLOAD=1` is an optional server policy, **off by default**. With read-only
  enabled, it allows only exact `POST /server/files/upload` to an allowed private address, without
  query parameters or method overrides. It accepts the app's plain Upload multipart body: exactly
  `root=gcodes` and one `file` with a plain `.gcode` filename (at most 255 UTF-8 bytes). All print/start
  fields, even `print=false`, duplicate or unknown fields, other upload routes and commands remain
  refused. The complete multipart body defaults to 1 GiB (1073741824 bytes), each part's headers to 4096 bytes and
  its boundary to 70 characters; receiving the body has a 60-second inactivity timeout.
  `ORCA_PRINTER_PROXY_UPLOAD_MAX_BYTES` accepts decimal integers from 1 to 8589934592 (8 GiB),
  including multipart framing. Invalid configuration refuses uploads with 503. Validation spools to
  a private temporary directory, keeps only a received chunk and a small parser tail in memory, and
  forwards the same file after acceptance. Temporary files are removed on completion, refusal,
  interruption or forwarding error; abrupt process termination can leave a file under the OS temp
  directory. Provide temporary disk capacity for the configured limit per concurrent upload.
  Malformed bodies return 400, oversized bodies 413, and refused options/routes 403. This opt-in does not enable cloud or Bambu uploads.
- Bambu uploads accept plain `.gcode` / `.3mf` names only.
- API keys, access codes and passwords are stored in this browser's local storage and sent only to the gateway.

## Server reachability

The deployment server must be able to reach LAN printers. Configure an administrator-managed
private network route or an existing supported remote provider. The browser cannot discover the
user's LAN through a remote deployment; enter the printer address manually.

## Printing from the app

After slicing, **Send to printer** (Preview) uploads the G-code. "Upload and print" needs a second click to
confirm, because it starts a real machine. Moonraker uses `POST /server/files/upload`, PrusaLink
`PUT /api/v1/files/<storage>/<name>` with `Print-After-Upload`, OctoPrint `POST /api/files/local`.

## OctoEverywhere optional remote connection

Configured with the assigned production App ID `weborca`. OctoEverywhere App Connections currently
require the printer owner's [Supporter Perks](https://docs.octoeverywhere.com/app-connections/overview/),
plus a supported printer with OctoEverywhere installed/configured and connected.

1. Open **Add a printer** (Step 2) to connect directly through OctoEverywhere without needing a local
   IP address, or open an existing saved printer's settings / the Device remote-connection section to
   add OctoEverywhere while keeping its underlying host type, local address, credentials and preset.
2. The server must have the [optional gateway configuration](../deploy/README.md#optional-octoeverywhere-remote-connection)
   (`ORCA_OCTOEVERYWHERE_ENABLED=1`, `ORCA_PUBLIC_ORIGIN`, and `ORCA_OCTOEVERYWHERE_APP_ID=weborca`,
   which is the default when enabled).
3. Authorize a printer in the external provider portal. Keep the original WebOrca page open;
   it polls for completion. Confirm that the returned physical printer matches before saving the
   connection. Cancel discards the pending authorization in WebOrca.
4. Choose Local or OctoEverywhere explicitly. Local retains the authorized link (available when a
   local address is configured). Detach removes the WebOrca link and returns to the native
   configuration; revoke provider access separately on OctoEverywhere. Open printer uses the
   user-facing provider page and its login session.

The common adapter exposes only supported runtime operations:

- Monitoring includes reported status, progress, temperatures, health/recovery, exact known account
  limits and read-only material sources/tools/routes. Unknown fields remain unknown; material display
  does not synchronize presets. Gadget status is polled only while visible and printing, at most once
  per ten seconds per connection.
- Pause/resume/cancel depend on current state; lights, move, all-axis home, extrusion, temperatures
  and start depend on provider feature flags. Common controls have no fan, print-speed or partial-axis
  home operation. Tool targets are limited to 260 °C and bed/chamber targets to 75 °C.
- Files support listing, details, upload, download and confirmed deletion where the host/plugin allows
  them. Moonraker exposes gcode/config/log roots with per-operation restrictions; OctoPrint gcode/logs;
  Bambu gcode. PrusaLink common files are unavailable, but feature-gated existing-path start with
  optional Storage is exposed. Elegoo common files/start are unavailable. Unknown hosts receive no
  common file support. Unsupported/old-plugin responses can disable operations further.
- Send to printer offers upload only where raw G-code transfers are supported. Start is a separate
  confirmed action in Printer files, using the returned VirtualPath. Bambu start requires a compatible
  existing `.3mf` and explicit plate/AMS/calibration choices; this integration does not package slicer
  G-code as a Bambu project or validate a preset/AMS workflow.
- The OctoEverywhere Device dashboard shows print status, temperatures, cameras, controls, material, and files.
  Reported filament colors appear as swatches. Opening Device for an online printer loads one camera snapshot.
  On mobile, the printer picker shows connection status and ends with Add printer. Printer settings sit at the bottom of Device,
  and the Materials panel focuses on filament while the temperatures panel shows hotend readings.
  Cameras support selection, fresh snapshots, reported transforms and explicit MJPEG start, stop and reconnect.
  Streams stop after at most five minutes, further reduced by the reported provider limit; unknown
  limits use a conservative 20-second client bound. No automatic reconnection bypasses provider limits.
  Transfers use current Info byte limits with a 5 GiB gateway safety ceiling, not marketing plan quotas.
- Expert tools expose confirmed Live Link creation and notification webhook set/delete/test. Webhooks
  require a public HTTPS receiver and renewal within 180 days; WebOrca adds no receiver or browser push
  service. Native HTTP/WebSocket/MQTT relay infrastructure has bounded allowlists, without a command console.

Provider connection credentials follow the saved-printer browser-storage model; the `/_octoeverywhere`
gateway is stateless and retains no credentials, sessions, flows, or tickets in server RAM between
requests (snapshots and MJPEG streams are fetched directly with per-request headers and rendered via
revocable browser `Blob` URLs). Local/cloud credentials are kept separate. Explicit remote mode with
invalid authorization fails safely; commands are not replayed on a local transport.

The final candidate's [manifest](../build/tests-octoeverywhere-20261105/candidate-final.sha256)
contains 1,097 files; manifest SHA-256 is
`cd0cc5d82fff94220d78241ac4f6d0f5a8e39bdf240cc2ba5cd4ea1fc19069b9`.
The [post-run hash record](../build/tests-octoeverywhere-20261105/candidate-final-verified.txt)
and [UI](../build/tests-octoeverywhere-20261105/ui.md),
[backend](../build/tests-octoeverywhere-20261105/backend.md),
[client](../build/tests-octoeverywhere-20261105/client.md) and
[boundary repair](../build/tests-octoeverywhere-20261105/boundary-fixes.md) reports retain the evidence.
The integrated report supersedes earlier pending-build notes in those handoffs.

All provider actions in this verification were synthetic. Production App ID enrollment, custom
returnUrl query preservation/callback registration, real Supporter entitlements, plugin/firmware and
hardware compatibility, actual camera playback/concurrency, public TLS/DNS and deployed proxy/browser
behavior remain unverified. Desktop Chromium emulation does not establish Safari, physical touch or
accessibility acceptance. See the [research](../../docs/octoeverywhere-integration-research.md) and
[implementation contract](../../docs/octoeverywhere-implementation-plan.md).

## Prusa Connect (cloud)

Prusa has no official third-party API or OAuth client credentials for Prusa Connect. OrcaSlicer's web port
ports the reverse-engineered approach from the MIT-licensed [prusactl](https://github.com/trevin-lee/prusactl)
project (by trevin-lee) to authenticate against Prusa Account via OAuth2 PKCE and interact with the Prusa Connect
web app API.

### Starting the Gateway
Because browsers block direct cross-origin calls and require SSRF/token protection, the gateway must be
started with the `prusa-connect` cloud allowance:

```bash
ORCA_PRINTER_CLOUD=prusa-connect npx vite preview          # server gateway
```

The gateway enforces trusted-host rules (HTTPS on `prusa3d.com` or `*.prusa3d.com` only, SSRF-safe), path and
command allowlists, payload size limits, upstream timeouts, and transparent rotating refresh token rotation on 401s.

### Authentication & Setup Flow

1. In the **Add / Edit Printer** dialog, select **Prusa Connect**.
2. Use the default email/password form. WebOrca's server forwards these credentials to Prusa
   Account; the password is masked in the UI. Social/passkey authentication is unsupported.
3. Enter a one-time code if requested. The server captures the registered callback automatically
   and completes the pending PKCE exchange without DevTools or copying callback URLs.
4. Choose an account printer after login. Real account authentication and printer compatibility
   remain unverified; the completed flow is covered by synthetic fixtures.

Manual callback completion remains available as a fallback: generate and copy one sign-in link,
keep the pending WebOrca dialog open, and sign in in a separate tab. If the address bar no longer
shows the callback, record that tab's DevTools Network requests before navigating (Chrome
**Preserve log** or Firefox **Persist Logs**) and copy the callback request's full URL. Paste the
URL including `code` and `state` into the same pending attempt. Bare codes are rejected; do not
share callback URLs in chat or reports. See [manual capture details](../../docs/prusa-connect-redirect-capture.md).

The default and current [5070 deployment](../deploy/README.md#tailscale-access) use Connect's
public client ID `MRHTlZhZqkNrrQ6FUPtjyusAz8nc59ErHXP8XkS4` and registered callback
`https://connect.prusa3d.com/login/auth-callback`. The gateway validates a full callback URL matching the
active unexpired pending attempt's callback and state, rejects conflicting verifiers, and uses
the stored verifier and original redirect for exchange. `PRUSA_REDIRECT_URI` configuration
supports only provider-registered URIs.

The [localhost callback trial](../build/tests-prusa-localhost-callback/verification.txt) passed local
checks, but the provider rejected it with `invalid_request / Mismatching redirect URI.` Its override
was [rolled back](../build/tests-prusa-redirect-mismatch/rollback/report.md); localhost is not a
supported callback for the existing client. Automatic login is
[implemented and published on 5070](../build/tests-prusa-automatic-login/verification.txt) through a
narrow TypeScript adaptation of the [PrusaSlicer behavior](../../docs/prusa-connect-automatic-callback.md).
The [QA](../build/tests-prusa-automatic-login/qa/report.md) and
[publication report](../build/tests-prusa-automatic-login/publication/report.md) record 55/55 synthetic
checks, compile, Chromium fixtures and public health/UI checks passing. Real Prusa code redemption,
account access and physical printer operations remain unverified. The restart reset OrcaCloud
sign-in; local presets are retained.

### Features Supported
- **Device Status & Monitoring**: Real-time polling of printer state, nozzle, bed, and chamber temperatures, active print
  file name, progress percentage, time elapsed, and estimated time remaining.
- **Camera Snapshot**: If a camera is connected to the printer in Prusa Connect, the Device tab displays live camera snapshots
  refreshed via the gateway camera snapshot proxy.
- **Print Job Controls**: Direct job control buttons on the Device tab for **Pause** (`PAUSE_PRINT`), **Resume**
  (`RESUME_PRINT`), and **Cancel** (`STOP_PRINT` with confirmation dialog). Note that manual axis jog, homing, and target
  heating are not exposed by the Prusa Connect commands API and are disabled.
- **Web UI Shortcut**: An `Open in Prusa Connect` link opens the printer's dashboard on Connect in a new tab.
- **Upload and Queue / Print**: G-code uploads follow the Connect 3-step sequence:
  1. `POST /app/users/teams/{team}/uploads` to reserve the upload slot and obtain a hash.
  2. `PUT /app/teams/{team}/files/raw?upload_id={id}` to stream the raw G-code.
  3. `POST /app/printers/{uuid}/queue` to add to queue, or immediately start printing if "Upload and print" was selected.
- **Legacy Fallback**: If a printer profile was configured using the legacy API-key style without OAuth credentials,
  the driver falls back to the PrusaLink-compatible `PUT` / multipart `POST` upload flow.

### Privacy & Token Custody
- **Token Scope**: Tokens obtained via the Connect web client ID carry full account permissions within Prusa Connect.
- **Token Custody**: All access and refresh tokens are stored purely client-side in the browser's local storage
  (managed by zustand). The gateway never stores, persists, or logs tokens.
- **Signing Out & Revocation**: Removing the printer from OrcaSlicer clears the tokens from browser storage. To fully
  revoke access, sign out of your sessions or change your password at [account.prusa3d.com](https://account.prusa3d.com).

### Disclaimer
Prusa Connect does not provide a documented or supported third-party API. This integration relies on the reverse-engineered
internal API used by the Prusa Connect web interface. Changes made by Prusa to their Account or Connect services may alter
or break compatibility without notice.

**Notice on Testing**: Automatic password/OTP fixtures and public health/UI checks passed; real
Prusa code redemption, account devices and physical printer actions remain unverified.

## Bambu Lab

LAN mode must be on; the dialog needs the printer's IP, serial number and access code. The bridge and the
status mapping follow the community-documented MQTT messages and are tested against a mock broker only;
**they have not been tried on a real Bambu printer.** Plain G-code is started from the SD card with
`print.gcode_file`; Bambu `.gcode.3mf` projects would use `print.project_file`, which is not implemented.

## Tests

- `wasm/tests/node/server-gateway-routing.test.mjs`: same-origin routing, legacy config migration,
  account scope and missing-backend behavior.
- `wasm/tests/node/printer-gateway.test.mjs`: address policy, read-only filters, streaming, websocket
  relay, Digest, the MQTT bridge.
- `wasm/tests/node/printer-drivers.test.mjs`: the app's drivers against mock Moonraker, OctoPrint,
  PrusaLink and a Bambu broker through the real gateway.
- `wasm/tests/node/printer-live.test.mjs`: read-only check of a real Moonraker printer, only when
  `ORCA_LIVE_PRINTER=<address>` is set. It runs through a read-only gateway and never calls upload.

## Filament inventory and Flashforge

Prepare's filament sync dialog reads material/color inventory and lets you map each loaded slot to a compatible local preset before applying it. Bambu LAN reports support AMS trays and the external spool. Moonraker supports Snapmaker U1's `print_task_config` assignments (including manually configured non-RFID spools), with `filament_detect` metadata as a fallback and feeder presence checks, Happy Hare MMU gate metadata, and the active spool from Moonraker's Spoolman integration. U1 and Happy Hare tool numbers are preserved even when some tools have no filament. Loaded U1 slots without material metadata require a manual preset choice; their existing colors are preserved. Standard Spoolman exposes one active spool, which maps to the first slicer slot, rather than a per-tool inventory. Spoolman changes update the available inventory; clicking Sync applies it to the project.

Generic extruder temperatures and tool counts do not identify loaded materials. PrusaLink/OctoPrint inventory sync is not available without a supported metadata source. Filament presets and colors chosen in Prepare are remembered on the selected saved device. Inventory sync only reads the printer and updates the slicer; it does not load filament or send G-code. The read-only gateway permits the Spoolman active-spool query and proxy GET requests for individual spool records, but refuses proxy writes and unrelated routes.

Flashforge connections use the modern HTTP API (default port 8898), a serial number and check code, through the gateway. The driver reads loaded material-station slots from `/detail` and uploads to `/uploadGcode`. This is the API used by modern material-station printers such as AD5X; it does not implement older Flashforge TCP protocols. Mocks verify status, temperatures, progress, fans and multi-nozzle reports; unrecognized states remain unknown. Availability depends on printer firmware and has not been tested on physical Flashforge hardware.

## Saved cloud sessions

Switching host type or opening an existing connection checks browser-saved tokens for Prusa,
Bambu Global and Creality, matched to provider, region, gateway and specified account. Valid
tokens restore the account/device; rejected tokens offer login; network failures retain the
tokens and offer Retry. Successful Prusa login immediately caches browser tokens before
printer selection or Save, so reload restores the account/device list. Received token rotations
persist immediately, including while the printer list is pending, and survive a later timeout.
Unsaved device selection survives switching away and back. Sign in once if the prior session
was already lost. Creality
device selection uses bounded complete pagination. Tokens stay in browser storage with no
server persistence. Bambu China reuse remains safely unsupported pending regional routing.
Real account compatibility remains unverified; behavior was checked with synthetic accounts.
The green sidebar connection button opens the selected physical printer's saved host, credentials and preset;
explicit Add opens a blank/default connection. Prior98/97/96 are retained.
The current 5070 root is `ui-creality-login-contract-candidate-20261104` through the root-only
`zz-creality-login-contract.conf`; release99's root and override remain available for guarded rollback.
See the [receipt](../build/tests-creality-login-invalid-parameter/verification.txt)
and [publication report](../build/tests-creality-login-invalid-parameter/publication/report.md).
Restart clears OrcaCloud RAM sign-in; local presets are retained.

## Bambu Cloud

The cloud account driver connects to Bambu Cloud to monitor bound devices. Cloud uploading and printing are unsupported (read-only). To enable the cloud endpoints, you must opt-in by setting `ORCA_PRINTER_CLOUD=bambu-cloud` on the app server gateway.

The [current 5070 deployment](../deploy/README.md#tailscale-access) has repaired the hosted login
route's 404 and explicitly enables `prusa-connect,creality-cloud,bambu-cloud` through
`96-prusa-automatic-bambu.conf`. The exact login POST passed synthetic Chromium fixture QA;
public checks proved dispatch and Host/Origin/allowlist guards without upstream authentication.
Real Bambu account authentication remains unverified.

```bash
ORCA_PRINTER_CLOUD=bambu-cloud npx vite preview          # server gateway
```

The connection picker offers "Bambu Cloud" and explains whether its gateway is enabled. You log in with your account and password or verification code. The credentials are exchanged for an access token stored locally and never sent to the printer. The token allows fetching your user ID and bound devices. Once a device is chosen, the gateway connects to the cloud MQTT broker to receive live status and filament inventory.

The login API currently uses `api.bambulab.com`; the broker picker selects the MQTT endpoint separately. China and legacy broker choices require regional account verification. Passwords and verification codes are cleared after successful login; the saved email remains separate from the MQTT username for re-login. HTTPS and MQTT TLS verify certificates. Only the three account API routes and read-only MQTT information requests are allowed by the dedicated bridge; cloud opt-in does not open the generic HTTP proxy to Bambu's API.

Isolated gateway and client mocks cover authentication errors, code challenges, bound devices, incremental AMS/status reports, malformed messages, rejected broker/print requests and reconnect cleanup. Chromium and Firefox exercise password login, code login and re-login. Real account challenges, token expiration and printer/AMS compatibility remain unverified.

## Creality Cloud

The Creality Cloud connection uses regional HTTPS account login and read-only polling for bound printers. It supports password login and a QR code scanned by the Creality Cloud app. Global and China regions use separate fixed account/API hosts. The saved token, user ID, device name and telemetry ID recover the connection after a refresh; passwords are cleared after login.

The current candidate corrects regional hosts, login request fields and QR state-2/state-3 identity handling against the inspected embedded China login contract. Both-region synthetic transport/contract checks passed; live global/password/QR account login remains unverified. The pinned upstream global UI uses a separate account-center flow, so these checks do not establish supported global account login or resolution of the user's live error. See the [independent review](../build/tests-creality-login-invalid-parameter/review/report.md) and [QA evidence](../build/tests-creality-login-invalid-parameter/qa/report.md).

Enable the dedicated bridge using `ORCA_PRINTER_CLOUD=creality-cloud` on the app server. Multiple cloud services use a comma-separated list. Monitoring provides state, progress, temperatures, fans, layers and reported CFS/external-spool material/color inventory. Empty or unavailable CFS slots are excluded. Inventory can be mapped to Prepare filament presets using the existing sync dialog.

The gateway allows account authentication, device enumeration, telemetry and the exact CFS query `{ "method": "get", "params": { "cfsList": 1 } }`. Uploads, dispatch, feeding and other device-control RPCs are unsupported and rejected. Cloud opt-in does not grant generic HTTP proxy access to Creality hosts. Certificate verification remains enabled, and upstream requests time out after 15 seconds. Requests stop when the connection or login flow closes.

The response contracts come from Creality's published Cura integration and current Creality Print device-manager sources. Mock tests validate these contracts and the gateway boundaries; real account login, regional availability, firmware telemetry and CFS inventory remain unverified. The API does not provide a model support guarantee, so support is determined by which account-bound printers expose the expected telemetry.
