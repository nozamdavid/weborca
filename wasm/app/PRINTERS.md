# Printer connections

The web app can read from and send jobs to printers on your network: Klipper (Moonraker), PrusaLink,
OctoPrint, Bambu Lab (LAN mode), and the modern Flashforge HTTP API. Add a printer from the sidebar's connect button or the Device tab;
the dialog asks for the API address (`print_host`) and the printer's own web UI address (`print_host_webui`),
like desktop's physical printer dialog.

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
relays to the printer. Printers can also be used in "direct" mode (untick the gateway option in the dialog)
when the printer allows the app's origin, which is the only option on static hosting.

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
- Bambu uploads accept plain `.gcode` / `.3mf` names only.
- API keys, access codes and passwords are stored in this browser's local storage and sent only to the gateway.

## Gateway on your own computer

When the app is hosted somewhere else (a VPS), its server cannot reach a printer on your LAN. For that case the
same gateway also runs as a small program on your computer, bound to loopback only:

```bash
node orca-gateway.mjs --allow-origin https://slicer.example.com   # file is served at <app>/orca-gateway.mjs
# or, from a checkout: npm run gateway -- --allow-origin http://127.0.0.1:5173
```

Options: `--port` (default 5199), `--proxy private|<hosts>`, `--readonly`, `--allow-origin` (repeatable, or
`ORCA_GATEWAY_ORIGINS`). In the printer dialog choose "Use the gateway program on this computer" and enter its
address. The browser asks once to allow access to the local network (Chrome's Local Network Access prompt).

- Only the allowed origins may call it: it checks `Origin` (or `Referer` for images), answers CORS and the
  private-network preflight for them only, and rejects any `Host` that is not a loopback name.
- The printer's web UI is served at the root of its own `http://<label>.localhost:<port>/` origin, where the label
  is 16 random hex digits created for one session (12 h, at most 50). `*.localhost` is a secure context and
  loopback in Chrome and Firefox, so an https page may frame it, and the framed UI cannot read the app's storage.
  Only the app's origin (or the UI itself) may load that host.
- Everything else (private-address policy, read-only filters, DNS pinning) is the server gateway's code.

## Discovering printers

With the gateway program running on your computer, **Discover printers in this network** in the Add printer
dialog lists what it finds; **Add** fills the form (type, address, Bambu serial number) and you enter the key
or access code. The gateway scans the /24 of each private network interface (nothing else) with plain GET
requests, so it also works in read-only mode: Moonraker `/server/info`, then `/api/version` for PrusaLink
(`PrusaLink` text or a Digest challenge) and OctoPrint (`OctoPrint` text, or its login page when the key is
required), on ports 7125, 80 and 5000. Bambu Lab printers are found by an SSDP search on UDP 1990. There is no mDNS:
the scan reaches the same printers. The app server's own gateway cannot discover anything, since it is not on your
network. The SSDP part has only been tested against a mock.

## Printing from the app

After slicing, **Send to printer** (Preview) uploads the G-code. "Upload and print" needs a second click to
confirm, because it starts a real machine. Moonraker uses `POST /server/files/upload`, PrusaLink
`PUT /api/v1/files/<storage>/<name>` with `Print-After-Upload`, OctoPrint `POST /api/files/local`.

## Prusa Connect (cloud)

Prusa Connect is reached the way desktop OrcaSlicer reaches it: the PrusaLink-style upload API on
`https://connect.prusa3d.com` with the API key from the printer's page in Connect. The browser cannot call it
directly, so the gateway needs a cloud allowance, separate from the LAN modes:

```bash
ORCA_PRINTER_CLOUD=prusa-connect npx vite preview          # server gateway
node orca-gateway.mjs --allow-origin <app origin> --cloud prusa-connect   # gateway on your computer
```

The allowance names a service, not a host: only that service's hostname, only over https, and it does not
open the LAN (combine with `ORCA_PRINTER_PROXY` for that). The upload is a `PUT` when `/api/version` reports
`upload-by-put`, otherwise a multipart `POST`, as on desktop. Connect shows no live state to slicers, so the
Device tab only confirms the service answers and offers a link to open Connect. Read-only mode refuses uploads.
**Only tested against a mock; it has not been tried against the real service.**

## Bambu Lab

LAN mode must be on; the dialog needs the printer's IP, serial number and access code. The bridge and the
status mapping follow the community-documented MQTT messages and are tested against a mock broker only;
**they have not been tried on a real Bambu printer.** Plain G-code is started from the SD card with
`print.gcode_file`; Bambu `.gcode.3mf` projects would use `print.project_file`, which is not implemented.

## Tests

- `wasm/tests/node/local-gateway.test.mjs`: origin and Host policy, CORS and preflight, the UI host,
  redirects, websockets, read-only mode.
- `wasm/tests/app/printers-local.mjs`: Chromium and Firefox with the app served without a gateway and the
  local gateway in front of a mock Moonraker (status, live updates, camera, framed UI).
- `wasm/tests/node/discover.test.mjs`: the probes, the SSDP search and the `/_gw/discover` stream.
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

Creality Cloud account integrations are not implemented.

## Bambu Cloud

The cloud account driver connects to Bambu Cloud to monitor bound devices. Cloud uploading and printing are unsupported (read-only). To enable the cloud endpoints, you must opt-in by setting `ORCA_PRINTER_CLOUD=bambu-cloud` on the app server gateway, or `--cloud bambu-cloud` on the local gateway program.

```bash
ORCA_PRINTER_CLOUD=bambu-cloud npx vite preview          # server gateway
node orca-gateway.mjs --allow-origin <app origin> --cloud bambu-cloud   # local gateway
```

The connection picker offers "Bambu Cloud" and explains whether its gateway is enabled. You log in with your account and password or verification code. The credentials are exchanged for an access token stored locally and never sent to the printer. The token allows fetching your user ID and bound devices. Once a device is chosen, the gateway connects to the cloud MQTT broker to receive live status and filament inventory.

The login API currently uses `api.bambulab.com`; the broker picker selects the MQTT endpoint separately. China and legacy broker choices require regional account verification. Passwords and verification codes are cleared after successful login; the saved email remains separate from the MQTT username for re-login. HTTPS and MQTT TLS verify certificates. Only the three account API routes and read-only MQTT information requests are allowed by the dedicated bridge; cloud opt-in does not open the generic HTTP proxy to Bambu's API.

Isolated gateway and client mocks cover authentication errors, code challenges, bound devices, incremental AMS/status reports, malformed messages, rejected broker/print requests and reconnect cleanup. Chromium and Firefox exercise password login, code login and re-login. Real account challenges, token expiration and printer/AMS compatibility remain unverified.

## Creality Cloud

The Creality Cloud connection uses regional HTTPS account login and read-only polling for bound printers. It supports password login and a QR code scanned by the Creality Cloud app. Global and China regions use separate fixed account/API hosts. The saved token, user ID, device name and telemetry ID recover the connection after a refresh; passwords are cleared after login.

Enable the dedicated bridge using `ORCA_PRINTER_CLOUD=creality-cloud` on the app server or `--cloud creality-cloud` on the local gateway. Multiple cloud services use a comma-separated list. Monitoring provides state, progress, temperatures, fans, layers and reported CFS/external-spool material/color inventory. Empty or unavailable CFS slots are excluded. Inventory can be mapped to Prepare filament presets using the existing sync dialog.

The gateway allows account authentication, device enumeration, telemetry and the exact CFS query `{ "method": "get", "params": { "cfsList": 1 } }`. Uploads, dispatch, feeding and other device-control RPCs are unsupported and rejected. Cloud opt-in does not grant generic HTTP proxy access to Creality hosts. Certificate verification remains enabled, and upstream requests time out after 15 seconds. Requests stop when the connection or login flow closes.

The response contracts come from Creality's published Cura integration and current Creality Print device-manager sources. Mock tests validate these contracts and the gateway boundaries; real account login, regional availability, firmware telemetry and CFS inventory remain unverified. The API does not provide a model support guarantee, so support is determined by which account-bound printers expose the expected telemetry.
