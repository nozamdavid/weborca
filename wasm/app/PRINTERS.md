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

## The printer's own web UI in the Device tab

An https page cannot embed an `http://` printer UI (mixed content). With the gateway on, the Device tab
loads the UI from `/_printer/ui/<scheme>/<host[:port]>/` instead, on the app's own origin. Mainsail, Fluidd
and similar UIs assume they live at the root of their origin, so the gateway makes that true for them:

- root-relative `src`/`href`/`action` attributes in HTML and `url(/...)` in CSS are rewritten, and a
  `<base>` plus a small script are injected into every HTML page;
- the script sends `fetch`, XHR, `EventSource`, `Worker`, `sendBeacon`, dynamically set `src`/`href` and
  `WebSocket` through the gateway (websockets to `/_printer/ws/...`, so the read-only filter applies) and gives
  the page's router a root-relative `location`;
- `X-Frame-Options` and `Content-Security-Policy` are dropped and the response is marked
  `Cross-Origin-Embedder-Policy: require-corp`, as the app is cross-origin isolated; responses are fetched
  uncompressed so they can be rewritten, and cookies are not forwarded;
- JavaScript files are streamed unchanged.

Limits: this is a best-effort rewrite, not a general web proxy. Service workers are disabled, absolute URLs
built from string concatenation that do not use the page's host are not rewritten, and in read-only mode the
UI's own writes (for example the camera's WebRTC handshake, a POST) are refused. **The embedded UI runs on the
app's origin, so its scripts can read this browser's local storage, including saved printer API keys. Only
open the UI of printers you trust.** "Open in new tab" still opens the printer's own address.

## Printing from the app

After slicing, **Send to printer** (Preview) uploads the G-code. "Upload and print" needs a second click to
confirm, because it starts a real machine. Moonraker uses `POST /server/files/upload`, PrusaLink
`PUT /api/v1/files/<storage>/<name>` with `Print-After-Upload`, OctoPrint `POST /api/files/local`.

## Bambu Lab

LAN mode must be on; the dialog needs the printer's IP, serial number and access code. The bridge and the
status mapping follow the community-documented MQTT messages and are tested against a mock broker only;
**they have not been tried on a real Bambu printer.** Plain G-code is started from the SD card with
`print.gcode_file`; Bambu `.gcode.3mf` projects would use `print.project_file`, which is not implemented.

## Tests

- `wasm/tests/node/printer-gateway.test.mjs`: address policy, read-only filters, streaming, websocket
  relay, Digest, the MQTT bridge.
- `wasm/tests/node/printer-drivers.test.mjs`: the app's drivers against mock Moonraker, OctoPrint,
  PrusaLink and a Bambu broker through the real gateway.
- `wasm/tests/app/printer-ui.mjs`: a mock Mainsail-style UI (root-absolute assets, `fetch`, XHR, a websocket
  and a script added at run time) opened through the UI proxy in Chromium and Firefox.
- `wasm/tests/node/printer-live.test.mjs`: read-only check of a real Moonraker printer, only when
  `ORCA_LIVE_PRINTER=<address>` is set. It runs through a read-only gateway and never calls upload.
