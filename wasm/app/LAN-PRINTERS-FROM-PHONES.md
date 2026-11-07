# Connecting to LAN printers from a phone without a local gateway

Findings from a research pass on 2026-10-18. The full report with sources is
`docs/superpowers/wasm/lan-printers-without-gateway.md` (gitignored). Claims below come from that report and
were not re-checked individually; the one live probe was run against the read-only Klipper test printer.

## Constraints

- The app must be served over HTTPS and cross-origin isolated (COOP `same-origin`, COEP `require-corp`) so the
  wasm engine can use `SharedArrayBuffer`. It cannot be served over plain HTTP except on localhost.
- A secure page may not call `http://` or `ws://` addresses (mixed content). `localhost` is exempt, but on a
  phone that is the phone itself.
- The printer must also answer CORS for our origin, including the preflight for `X-Api-Key` or `Authorization`.
- Opening `http://printer` as a top-level link is allowed. Embedding it in a frame is not.

## Browser support

| Browser | Reaches `http://192.168.x.x` from our HTTPS page? |
|---|---|
| iOS Safari and every iOS browser (WebKit) | No. There is no Local Network Access permission and no mixed-content exemption (WebKit bug 171934 is still open). |
| Android Chrome, desktop Chrome and Edge | Yes, after the user grants the Local Network Access permission (Chrome 142, Edge 143). WebSockets need Chrome 147, and only work with an IP literal such as `ws://192.168.0.238:7125/websocket`, not `printer.local`. |
| Firefox | Likely, with its own permission prompt since Firefox 144. WebSocket support is not confirmed. |
| Android WebView, in-app browsers | Treat as unsupported. |

So Android and desktop are a CORS-configuration problem. iOS is an HTTPS-origin problem.

## Printer side

| Printer | CORS and auth | Direct from browser |
|---|---|---|
| Moonraker (Klipper) | `cors_domains` under `[authorization]` covers HTTP and WebSocket origins. Preflight skips authentication. Can serve TLS itself (`ssl_port`). | Yes, once our origin is listed |
| OctoPrint | "Allow Cross Origin Resource Sharing" setting, API key required | Yes, once enabled |
| PrusaLink | Digest authentication, no CORS support | No. Needs the gateway or a relay. |
| Flashforge, Bambu | No usable browser API | No. Needs a bridge. |

Probe of the test printer at 192.168.0.238 (GET and OPTIONS only): `GET /server/info` returns 200 with no
`Access-Control-Allow-Origin`, and `OPTIONS` returns 405. Ports 7130 and 443 are closed. It is HTTP only today.

## Options, ranked

| # | Option | iOS | Android and desktop | User setup | Covers |
|---|---|---|---|---|---|
| 1 | Tailscale Serve on the printer host (real TLS, add our site to `cors_domains`) | Yes | Yes | Tailscale on the Pi and phone, HTTPS enabled, one `tailscale serve` command, one config line | Moonraker, OctoPrint. Not Bambu or PrusaLink. |
| 2 | Direct request plus the Chrome permission | No | Yes | One line in `moonraker.conf` or an OctoPrint checkbox | Moonraker, OctoPrint |
| 3 | Hosted relay (OctoEverywhere, Obico) | Yes | Yes | Vendor plugin and account | Also PrusaLink and Bambu. A third party gets full control. |
| 4 | Cloudflare Tunnel plus Access | Yes | Yes | A domain and `cloudflared` | Any HTTP service, exposed to the internet |
| 5 | Native wrapper (Capacitor) | Yes | Yes | Install an app | Everything. 3–6 weeks of work. |
| 6 | Local CA and HTTPS on the printer | Yes | Likely | Install a root CA on each phone | Moonraker only. Large trust grant. |
| 7 | Browser extension | No | Desktop only | Install the extension | Moonraker, OctoPrint, Flashforge HTTP |

PWA installs, WebRTC, WebTransport and Web Bluetooth do not solve the phone problem.

## Plan

1. Document option 1 as the way to connect from a phone, since it is the only private and low-effort path that
   covers iOS.
2. Keep the existing direct mode for Android and desktop Chrome, and document the `cors_domains` line it needs.
3. PrusaLink, Flashforge and Bambu printers still need the gateway or a relay.

## First experiment

1. Reproduce the CORS probe against the test printer (GET and OPTIONS only, never POST).
2. Run a mock Moonraker with CORS enabled on this host and connect to it from the demo with direct mode.
3. Add the one-line `cors_domains` entry on a test Moonraker and repeat.

## Unverified

- Firefox behaviour and its WebSocket support.
- Whether the Chrome permission prompt is acceptable to users for a connection dialog.
- Anything about iOS beyond the WebKit bug status and the lack of a permission, which was read from vendor pages,
  not tested on a device.
