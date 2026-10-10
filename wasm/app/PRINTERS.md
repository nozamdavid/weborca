# Printer connections

The web app can read from and send jobs to printers on your network: Klipper (Moonraker), PrusaLink,
OctoPrint and Bambu Lab (LAN mode). Add a printer from the sidebar's connect button or the Device tab;
the dialog asks for the API address (`print_host`) and the printer's own web UI address (`print_host_webui`),
like desktop's physical printer dialog.

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

The gateway is **off** unless the server is started with `ORCA_PRINTER_PROXY`:

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
  GET/HEAD/OPTIONS, the few Moonraker paths that act on a GET (`/printer/gcode/script`, `/printer/print/*`,
  `/printer/emergency_stop`, restarts, ...), and every websocket JSON-RPC request outside a read-only
  allow-list. Frames that are not valid JSON, batches containing a refused request and binary frames are
  dropped, so the filter fails closed. On Bambu only `info.get_version` and `pushing.pushall` pass.
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
- `wasm/tests/node/printer-gateway.test.mjs`: address policy, read-only filters, streaming, websocket
  relay, Digest, the MQTT bridge.
- `wasm/tests/node/printer-drivers.test.mjs`: the app's drivers against mock Moonraker, OctoPrint,
  PrusaLink and a Bambu broker through the real gateway.
- `wasm/tests/node/printer-live.test.mjs`: read-only check of a real Moonraker printer, only when
  `ORCA_LIVE_PRINTER=<address>` is set. It runs through a read-only gateway and never calls upload.
