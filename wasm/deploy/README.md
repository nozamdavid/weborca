# WebOrca staging container

By default, one container serves the built web app on port **8080**, accepting `weborca.noz.am`.
There is no Caddy, TLS service or LAN printer gateway running in the container; hosted cloud
adapters require explicit opt-in as described below. Slicing runs in browser
WASM; autosave stores recovery 3MF files in the browser's IndexedDB. The HTTP server sends the
COOP/COEP headers needed for multithreaded slicing.

## Optional alpha access

Alpha access and the sampled bug/engine repairs are published on CURRENT5070 as `wasm/build/ui-alpha-design-release-20261107`. The [alpha design publication](../build/tests-alpha-design-20261107/report.md) binds the current release and guarded rollback to the previous gated alpha release. On the authenticated admin page, **Open slicer** issues a separate app token/cookie without creating an invite. Its deadline is the authorizing admin session's original 8-hour expiry. Admin logout or a server restart (including password rotation) invalidates that access and closes owned connections; ordinary app logout leaves admin management signed in. Password changes require restart. Tester/app tokens cannot authorize admin launch or management.

The [previous publication](../build/tests-alpha-access-20261106/publication/report.md) records the initial gated deployment; its rollback disables the gate and is historical. The companion `wasm/build/tests-alpha-access-20261106/candidate-static` remains locally verified. The [integrated report](../build/tests-alpha-access-20261106/integrated.md) records 113 selected passes, packaged-server/full-app recovery, and file-only import/slice/Preview with zero alpha requests. The sampled audit retains the known 804-line legacy macOS oracle mismatch on both pre/post native artifacts; native parity is bounded to the recorded fixtures and retained dependency archives. Real-provider/hardware acceptance remains open.

Gating requires both build-time `VITE_ALPHA_GATE_ENABLED=1` and runtime `ORCA_ALPHA_GATE_ENABLED=1`. From the repository root, the build command is:

```sh
VITE_ALPHA_GATE_ENABLED=1 npm --prefix wasm/app run build
```

This produces `wasm/app/dist`, including the independent public bootstrap and packaged `alpha-access.mjs`. Existing native/profile build inputs listed below must exist. Docker supports `--build-arg VITE_ALPHA_GATE_ENABLED=1`; the base Compose file supplies neither this build arg nor alpha runtime configuration, env file or durable-state mount, so an operator override is required.

Set the following on the server process:

- `ORCA_ALPHA_GATE_ENABLED=1` enables runtime authorization.
- `ORCA_ALPHA_ADMIN_PASSWORD` is required from the environment, with no default or code secret. The user-requested initial password is already privately provisioned in `/home/david/.config/weborca/alpha.env`, mode 600; `weborca-tailscale.service` consumes it through `EnvironmentFile`. Keep its value private and outside the repository and frontend build.
- `ORCA_ALPHA_DATA_FILE` must be an absolute durable path outside the served root; for example `/home/david/.local/share/weborca/alpha/state.json`. Its parent must exist and be writable by the server user. Use one server process per state file on a local durable filesystem; container deployments need a writable durable mount. For Vite development, the file must also be outside the repository because dev asset mappings extend beyond the HTML root.
- `ORCA_PUBLIC_ORIGIN` is the canonical external origin, including a nonstandard port if used, without path/query/fragment or trailing slash. Use HTTPS except HTTP loopback development. Preserve the configured Host and Origin through ingress.

The server reads `process.env`; it does not automatically load `.env` or `alpha.env`. The following is an operator launch example from the repository root with Node 22 (replace the example origin). It is configuration guidance; it has not been run or installed as a service:

```sh
mkdir -p /home/david/.local/share/weborca/alpha
chmod 700 /home/david/.local/share/weborca/alpha
ORCA_ALPHA_GATE_ENABLED=1 \
ORCA_ALPHA_DATA_FILE=/home/david/.local/share/weborca/alpha/state.json \
ORCA_PUBLIC_ORIGIN=https://your-weborca-host.example \
ORCA_ROOT=/mnt/appdata/workspace/OrcaSlicer/wasm/app/dist \
node --env-file=/home/david/.config/weborca/alpha.env wasm/deploy/server.mjs
```

`--env-file` loads the private password into the process; an existing process environment takes precedence. The current systemd service explicitly loads `EnvironmentFile=/home/david/.config/weborca/alpha.env`. Rotate the password privately in that file, retain mode 600, and restart the consuming process after reloading its environment; existing admin sessions then fail. Missing/invalid settings or corrupt state stop startup; unavailable bootstrap returns 503 without exposing the app. Persisted state stores hashes rather than raw passwords/invite codes.

Use **Login as admin** on the login page (or `/_alpha/admin`), enter the configured password, add optional internal email/username/note labels, and choose **Create code**. Copy the once-visible code before dismissing it; it cannot be retrieved later. The admin list shows usage status, first/last use and count, label editing and Revoke/Restore. Revocation invalidates tester sessions and closes their owned streams/sockets; restoring an invite does not restore old sessions. Admin and tester authorization are separate. Tester localStorage credentials require backend validation; the companion cookie protects assets/workers. See [UI and durable recovery behavior](../app/DESIGN.md#optional-alpha-access--local-verification-2026-11-06), including Retry saving recovery before app disposal.

For static mode, build with `VITE_ALPHA_GATE_ENABLED=0` (default) and leave runtime `ORCA_ALPHA_GATE_ENABLED` unset or `0`. Static slicing needs no login or application backend; printer/cloud features still require their compatible backend. Retain COOP `same-origin` and COEP `require-corp` on a file-only host for multithreaded slicing. Local static acceptance confirms cross-origin isolation, slicing and Preview without alpha calls. Public Tailscale HTTPS and gate protection pass the linked publication checks; real OAuth/provider/printer lifecycle and hardware/browser acceptance remain unverified; local synthetic callback/socket checks do not establish real-provider acceptance.

## Build and run

From the repository root:

```sh
docker compose -f compose.staging.yaml up -d --build
```

Port 8080 is published on all interfaces. Route **https://weborca.noz.am** through your existing
HTTPS ingress/reverse proxy to the staging host's port 8080, preserving the Host header. Configure
DNS and TLS on that ingress. Public browser slicing needs HTTPS; localhost works over HTTP for
local checks.

To change the published port or bind only locally:

```sh
ORCA_PORT=8081 docker compose -f compose.staging.yaml up -d
ORCA_BIND_ADDRESS=127.0.0.1 docker compose -f compose.staging.yaml up -d
```

`ORCA_HOST` changes the accepted domain (default `weborca.noz.am`). Localhost and loopback addresses
are also accepted for health checks. Other Host headers return HTTP 421. App routes such as
`/calibration` use the SPA; missing WASM/profile files return 404 rather than HTML.

## Deploy the images elsewhere

The Dockerfile builds the frontend from current source with `npm ci` and `npm run build`, packaging
the existing Release WASM binaries, profiles, custom bed assets and example models. It does not
compile C++ inside Docker. The following build inputs must already exist:

- `wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs` and `orca_engine.wasm` (built with `SLIC3R_WITH_OCCT=OFF`)
- `wasm/build/step-module/step_tessellate.mjs`, `step_tessellate.wasm` and the OCCT license texts (lazily loaded STEP module, served under `/engine/step/`)
- `wasm/build/orca-wasm64-preview/wasm/preview/orca_preview.js` and `orca_preview.wasm`
- `wasm/build/web/profiles/`, including `index.json`, covers and bed assets
- `wasm/build/settings/layout.json`

Required packaged outputs and matching root/preview module aliases are checked during the image build. The dedicated Dockerfile ignore file
excludes native source/build trees, node_modules and environment files. Rebuild the Release engines
before rebuilding the image when C++ slicing or preview code changes.

To transfer the current image without copying the WASM build trees:

```sh
docker image save weborca-staging-web:latest | gzip > weborca-staging-images.tar.gz
# Copy this archive and compose.staging.yaml to the staging host, then:
gunzip -c weborca-staging-images.tar.gz | docker image load
docker compose -f compose.staging.yaml up -d --no-build
```

You can also tag and push the image to your registry. Browser projects/settings survive container
restarts and updates as long as browser storage and the site origin remain the same. Recovery from
port 5070 does not automatically transfer to `https://weborca.noz.am`; export/import a 3MF to move
a project between these origins.

## Tailscale access

The `weborca-tailscale.service` systemd user unit serves immutable
`wasm/build/ui-alpha-design-release-20261107` at **https://server-1.barbel-hops.ts.net:5070**.
The lexical-last `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-alpha-design.conf` selects the release root
and byte-identical frozen `wasm/build/tests-alpha-design-20261107/server.mjs`.
The retained `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-alpha.conf` selects the compatible frozen
`wasm/build/tests-alpha-access-20261106/publication/server.mjs` baseline and runtime gate.
It loads `EnvironmentFile=/home/david/.config/weborca/alpha.env` (mode 600), with durable
`ORCA_ALPHA_DATA_FILE=/home/david/.local/share/weborca-alpha/state.json` (mode 600, parent 700).
One process owns this state file. All prior drop-ins, caps, listeners and Tailscale routes are retained,
including `ORCA_PRINTER_CLOUD=prusa-connect,creality-cloud,bambu-cloud,snapmaker-cloud` and Orca Cloud
callback/preset-write settings. OctoEverywhere remains disabled without a production App ID.
Visitors see the invite-code gate and **Login as admin**; signed-in admins can choose **Open slicer**.
See the [current publication report](../build/tests-alpha-design-20261107/report.md)
for exact manifests, public checks and the explicit rollback command. Rollback restores
the previous **gated** alpha release while preserving private state/environment.
The settings/routing batch is published on CURRENT5070 with **CHROMIUM_SYNTHETIC_ONLY** acceptance.
Preset overwrite preserves inheritance, including normalized numbers; settings tabs/help, mobile controls,
modified tables and modal spacing are improved. Printer traffic uses the same-origin app backend;
legacy local gateway settings migrate away and the standalone gateway download is removed.
Static hosting requires a compatible printer backend; this frozen server enables only the four cloud providers,
with generic LAN proxying disabled. Saved readings keep their original receive timestamp through
errors or pause; Device/focus return waits for snapshot age ≥15 seconds, manual Retry is immediate,
and healthy monitoring stays connected. An embedded Web UI retains live monitoring while its document has focus. Desktop divider drag,
keyboard bounds and persistence, four cards and 320/390px mobile fit passed bounded headed Chromium checks.
The remote Snapmaker root cause remains unproven; historical physical telemetry remains separate.
Unique validated physical Snapmaker indices join material and current/target temperature; unknown/empty/unavailable
states remain neutral. Bed readings and CFS/MMU feeder inventory remain separate. Historical real Snapmaker
telemetry/material confirmation below does not verify this UI on physical hardware or unload/reassignment/job lifetime.
The retained selected-object panel sits bottom right inside the viewer with action-bar clearance,
expanded by default, collapsible to the name/ID/header toggle, with controls restored on expansion and collapse state
retained across object selection changes. Mobile hides the panel and retains external Move/Scale controls.
The [current publication and guarded rollback limits](../build/tests-settings-routing-batch/publication/report.md) and
[sealed QA](../build/tests-settings-routing-batch/qa-corrected/report.md) bind the exact immutable candidate and public acceptance.
The text Copy correction is retained. Selected webpage text takes precedence
even while an object is selected; without text selection, object Copy still works. Inputs, textareas and
contenteditable fields keep native shortcuts. The [Copy publication](../build/tests-text-copy-priority/publication/report.md)
and [sealed QA](../build/tests-text-copy-priority/qa/report.md) retain the prior implementation evidence; current sealed QA repeats Copy preservation.
Retained Objects/clipboard/Handy r2 behavior includes Objects growing naturally
(131–142px desktop empty; tree cap260px desktop/240px mobile); model interaction restores viewer focus for
Cmd/Ctrl+C while editable text keeps its shortcuts. Built-in Handy imports retain original geometry and skip
only automatic Simplify; normal upload offers and manual Simplify remain. Desktop results clear the camera band.
Publication reused the frozen candidate, with no rebuild. Its [sealed QA](../build/tests-objects-clipboard-handy/qa-r2/report.md)
retains explicit reconstructed baseline provenance and exact1060 non-UI file equality with the connected-filaments incumbent.
Retained connected Prusa/Creality filament behavior remains **SYNTHETIC_ONLY**.
Representative source-contract fixtures cover rich Prusa assignments and REST fallback, Creality CFS/racks and
Snapmaker regressions. Real Prusa OAuth/physical MMU, Creality hardware and unload/reassignment remain open.
For that prior connected-filaments release, all 1,058 other non-UI files matched the bootstrap baseline.
Its sealed QA records reconstructed UI provenance, preserved desktop CSS/lighting, exactly one Vite build,
zero native builds, 184 focused tests without skips and 72 integrated layouts. That evidence is inherited by r2.
Fixed checkAuth device/client binding precedes public DNS, strict TLS and MQTT. Diagnostic suffixes exclude secrets and raw upstream messages.
Experimental International email/password or email-code login, refresh, profile, bound devices and
direct read-only monitoring are included. Durable account tokens belong to the browser; monitoring
TLS credentials use connection-only Node memory without persistence. Official Control is not required.
The bounded connector validates broker/topic provenance from the fixed authenticated API.
One real password login and two bounded connections passed exact authorization binding, strict TLS, CONNACK,
four QoS1 SUBACKs and read-only objects.list/subscribe/query. An eight-object snapshot reported standby and
five finite heater temperatures; fresh nonretained heater deltas passed. Optional setSubscribeFilter -32601 uses the existing fallback.
Synthetic status/temperature/progress, cleanup and manual Retry acceptance passed. Other accounts, broader provider
capabilities, external-session behavior, Bambu China and physical Safari/accessibility acceptance remain open.
Device now displays read-only reported material/vendor/subtype/color/presence. The real idle four-tool
comparator and retention across heater deltas/fresh query passed. Physical unload/reassignment, job lifetime
and other accounts remain open; no project sync, uploads or controls are enabled.
See the [actual report](../build/tests-snapmaker-filaments/actual/report.md),
[sealed QA/provenance](../build/tests-snapmaker-filaments/qa-recovered/report.md)
and [publication/rollback report](../build/tests-snapmaker-filaments/publication/report.md).
Current [publication evidence](../build/tests-extruder-cards/publication/report.md) retains a [guarded rollback reference](../build/tests-extruder-cards/publication/rollback-reference.md):
`bash wasm/build/tests-extruder-cards/qa/rollback.sh --rollback-5070`, requiring its distinct exact parent authorization, currently absent.
It removes only twenty-four-z and restores the retained twenty-three-z selected-object panel root. Earlier release evidence remains historical.
Physical Mac/Safari and Firefox r2 acceptance remain unverified; no Firefox retry or cap increase was made.
Restart cleared OrcaCloud RAM sign-in; browser presets remain.
Original origins/callbacks/settings and caps 512MiB/swap0/CPU100%/Tasks64 are preserved.
Retained mobile field consistency r2 uses regular
semantic secondary stacked labels: 8px label/control gap, 16px related-field spacing and 24px
between groups. Control/unit rows fill the available width; boolean/domain rows and desktop
layout remain preserved, including 13px Creality controls and 12px labels. The public field
matrix covers Menu, Process/Quality, Settings, Objects and provider forms at 320/390px,
both themes and 100/125% root text. See the publication report for browser-run limits.
Retained mobile model tools r2 adds selected-object
body Move/Scale and relevant numeric controls below the viewer. Empty-canvas gestures and pinch
control the camera; mobile hides the view cube, view shortcuts and selection info inside the viewport.
Menu action chrome is neutral while status/material/toolpath colors retain their meaning.
Fresh public headed Chromium at 320/390 verifies native touch transforms, camera isolation,
external numeric controls and desktop Light → mobile contrast. Desktop transforms/layout and
the verified Doop desktop/mobile polish remain included.
Desktop Process tabs, unit/Reset reach and native Preview statistics/export; mobile readable
Calibration after Light theme, rounded Preview switches, Quality insets and populated Objects
scrolling passed fresh public headed Chromium at desktop 1024/1280 and mobile 320/390.
Mobile checks include 100/125% root text; desktop unit/Reset uses actual 100/130/150% preferences.
Public 117 byte/header checks and 16 Preview routes plus security/provider checks passed.
Canvas draft approval remains separate; static Doop captures remain design references.
Mobile Process, Quality and Preview native
selects have a painted arrow 16px inside the edge; mobile Preview has one layer slider and no
move/playback row. Desktop move/playback remains available. Included mobile polish adds Device Web UI below
controls with narrow fan fit, neutral shell/Preview/picker chrome preserving data colors, and
aligned shared dropdown chevrons for long labels/enlarged text. The first mobile batch covers
shell, Prepare, Menu, Objects, Process/Quality and Preview controls/statistics. Direct `/preview`,
`/preview/` and query GET/HEAD requests return HTML; missing preview assets remain 404.
Detailed Device/Calibration adaptations are included; physical-device accessibility/Safari,
real-account validation and Bambu China remain open.
Existing backend/auth functionality, callbacks, providers, origins and service limits are retained.
The prior `zz-creality-login-contract.conf`, Creality root, original server and all earlier drop-ins
remain installed. The guarded rollback command is
`DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus bash wasm/build/tests-snapmaker-monitor-upstream/publication/run-capped.sh rollback 2G bash wasm/build/tests-snapmaker-monitor-upstream/qa-final/rollback.sh --rollback-5070`
from the repository root; it removes only the byte-matching fourteen-z override and restores
the thirteen-z monitor r2 root with the original frozen server and same four providers. Restart clears OrcaCloud RAM sign-in;
browser presets remain. All earlier roots and overrides are retained.
The monitor source manifest excludes reader Markdown, so these documentation updates preserve
the exact sealed guard and rollback inputs without a documentation wrapper.
See the [current receipt](../build/tests-snapmaker-monitor-upstream/publication/verification.txt) and
[publication report](../build/tests-snapmaker-monitor-upstream/publication/report.md).
Release99's `99-printer-settings-connection.conf` and immutable root remain installed for guarded rollback.
Release98's `98-prusa-login-reload.conf` and immutable root, alongside release97's `97-cloud-host-session-reuse.conf` and immutable root are retained for rollback.
Retained `96-prusa-automatic-bambu.conf` overrides `ExecStart` with frozen server
`wasm/build/tests-prusa-automatic-login/publication/server.approved.mjs`, sets `ORCA_ROOT`
and `ORCA_PRINTER_CLOUD=prusa-connect,creality-cloud,bambu-cloud`. Retained
`95-prusa-capture.conf` and the earlier server selection in `90-printer-cloud.conf` are superseded.
The rejected trial's `95-prusa-localhost.conf` is absent; there is no `PRUSA_REDIRECT_URI` override.
The earlier Creality contract root was published on 2026-11-04 at 17:05:26 UTC, MainPID 2622253.
Regional login hosts, request fields and QR identity handling were corrected against the inspected embedded China login contract.
One integrated build, 20/20 focused tests, gateway compile, headed Chromium and 117 served checks passed;
independent review found no concrete blockers. Live global/password/QR account login remains unverified.
The pinned upstream global UI uses a separate account-center flow; synthetic regional contract checks do not establish global service acceptance.
The green sidebar connection button edits the selected saved physical connection; explicit Add opens a blank connection.
Successful Prusa login immediately caches browser tokens before printer selection or Save.
Reload restores the account/device list; received token rotations persist immediately, including
while device listing is pending. Unsaved device selection survives switching host away and back.
Sign in once if the prior session was already lost. Restart clears OrcaCloud RAM sign-in;
local presets are retained.
Switching host type or opening an existing connection checks browser-saved Prusa, Bambu Global
and Creality tokens. Valid tokens restore the account/device; rejected tokens offer login;
network failures offer Retry. There is no server token persistence. Bambu China reuse remains
safely unsupported pending regional routing, and real account compatibility remains unverified.
The [Creality receipt](../build/tests-creality-login-invalid-parameter/verification.txt) and
[publication report](../build/tests-creality-login-invalid-parameter/publication/report.md) record the
guarded activation, exact live bytes/headers and preserved settings/caps. Release 96's original
publication at 14:18:14 UTC (PID 1924128) and its evidence below remain historical.
The original unit/drop-ins, prior immutable candidates and original
`wasm/app/dist` are preserved. The service binds to
`127.0.0.1:5070`. Its private tailnet HTTPS URL is
[https://server-1.barbel-hops.ts.net:5070/](https://server-1.barbel-hops.ts.net:5070/); access requires Tailscale.

This deployment enables automatic Prusa login and repaired hosted Bambu routing alongside Creality
Cloud, preserving the existing Orca Cloud settings. The
[release receipt](../build/tests-prusa-automatic-login/verification.txt),
[QA report](../build/tests-prusa-automatic-login/qa/report.md) and
[publication report](../build/tests-prusa-automatic-login/publication/report.md) record 55/55 synthetic
checks, compile, Chromium fixtures, public health/UI checks, resource integrity and service caps passing.
Prusa requires the existing public client and its registered callback
`https://connect.prusa3d.com/login/auth-callback`; authorization and exchange use the same original
redirect. Only provider-registered overrides are supported; the
[provider-rejected localhost trial and rollback](../build/tests-prusa-redirect-mismatch/rollback/report.md)
remain historical evidence.

Prusa defaults to email/password → optional OTP in WebOrca. The server forwards credentials to
Prusa Account and captures the registered callback automatically; DevTools is unnecessary.
State, PKCE and the original registered redirect remain enforced. Manual callback completion is
available as a fallback; social/passkey authentication is unsupported. See the
[setup flow](../app/PRINTERS.md#authentication--setup-flow) and
[adaptation/source research](../../docs/prusa-connect-automatic-callback.md).

Real Prusa/Bambu account authentication and Creality login/devices remain unverified.
Public Bambu checks proved dispatch and guards without upstream authentication; the exact allowed
login POST passed only against a synthetic fixture. The restart reset in-memory OrcaCloud sign-in;
sign back in to Orca Cloud. Local presets are retained.
Arcane's `weborca.noz.am` deployment on port 8932 and native Prusa on port 8243 are
unchanged; the Compose defaults above do not describe Arcane's current port mapping.

Check or control the user service and view its recent logs with:

```sh
systemctl --user status weborca-tailscale.service
systemctl --user restart weborca-tailscale.service
systemctl --user stop weborca-tailscale.service
journalctl --user -u weborca-tailscale.service -n50
```

## Mobile slicing settings

At widths up to 800 CSS pixels, Prepare uses a guided printer, mode, process/filament,
settings and review flow. Desktop keeps its full editing interface. Selecting a process
restores its process defaults; Back preserves edits until a preset is explicitly selected
again. Settings and model recovery use the existing app stores and recovery dialog.

`MOBILE_SLICE_STEPS` is a comma-separated list of Orca setting keys, in step order.
The default is `layer_height,wall_loops,sparse_infill_density,sparse_infill_pattern,enable_support,support_type`.
`support_type` is asked only while `enable_support` is checked, including custom
step orders. Skipping it preserves its native value.
`infill_pct` aliases `sparse_infill_density`; `infill_pattern` aliases
`sparse_infill_pattern`. Empty entries and duplicates are removed. An explicitly empty
value means no advanced setting steps. Unknown, read-only, dedicated geometry/vector
editor and unavailable settings show a skip reason and retain their existing values.
Layout context determines whether a change belongs to print, filament or printer settings;
indexed vectors use the native setting serialization and preserve other cells.

For dev/build, set the environment variable or add it to `wasm/app/.env.local`.
For Docker runtime, set it before `docker compose up -d`; no rebuild is needed:

```sh
MOBILE_SLICE_STEPS=enable_support,support_type,infill_pct,infill_pattern docker compose -f compose.staging.yaml up -d
```

The `/app-config.json` endpoint exposes only `mobileSliceSteps`, never the remaining
environment. Vite dev and preview serve the same endpoint. Static hosts without this
endpoint fall back to the value compiled into the frontend. Docker build accepts the same
build argument for that fallback. Runtime configuration takes precedence over build config.

## Hosted Orca Cloud preset login and sync

Orca Cloud is the first choice in Add printer and is available later in Preferences.
It synchronizes saved printer/filament/process profiles, without creating a physical
printer or applying received profiles to the current project. The recommended deployment
enables the bridge in [server.mjs](server.mjs) at the app's own `/_orca-cloud/*`
routes. The server talks directly to Orca Auth and the sync API; the browser uses
the current site automatically, with no address field or per-user gateway setup.
The [Orca Cloud research](../app/ORCA-CLOUD-RESEARCH.md) records the upstream CORS
restriction and callback evidence limits; its implementation comparison describes
the earlier gateway setup.

Cloud is disabled unless the operator enables it. From the repository root, use
this Compose override with the existing HTTPS ingress described above:

```sh
docker compose -f compose.staging.yaml -f - up -d --build <<'YAML'
services:
  web:
    environment:
      ORCA_CLOUD_ENABLED: "1"
      ORCA_PUBLIC_ORIGIN: https://weborca.noz.am
      ORCA_CLOUD_CALLBACK: http://localhost:41172/callback
      ORCA_CLOUD_PRESET_WRITES: "1"
YAML
```

Keep the override in an operator-managed Compose file for subsequent deployments
and pass it as the second `-f` argument. The base Compose file does not forward
these variables from the shell. `ORCA_CLOUD_ENABLED=1` requires a canonical
`ORCA_PUBLIC_ORIGIN`: the exact external HTTPS origin, including any port, without
a path, query or fragment (HTTP is allowed only for loopback development).
Set `ORCA_HOST` to its hostname when using another domain. Preserve the public
Host header, Origin and browser fetch metadata at the ingress; forwarded headers
do not override the configured origin.

The frontend build packages `dist/orca-cloud-bridge.mjs`, which the server imports
from `ORCA_ROOT` (default `/app/dist` in the container). Enabling cloud without that
bundle or a valid public origin fails startup. For an existing built checkout,
the equivalent server command from the repository root is:

```sh
ORCA_ROOT=wasm/app/dist \
ORCA_CLOUD_ENABLED=1 \
ORCA_PUBLIC_ORIGIN=https://weborca.noz.am \
ORCA_CLOUD_CALLBACK=http://localhost:41172/callback \
ORCA_CLOUD_PRESET_WRITES=1 \
node wasm/deploy/server.mjs
```

`ORCA_CLOUD_CALLBACK` defaults to `http://localhost:41172/callback`. Leave
`ORCA_CLOUD_CALLBACK_CONFIRMED` unset until there is evidence that upstream accepts
the exact callback and completes the flow. Setting it to `1` is only an operator
assertion; neither it nor `ORCA_CLOUD_ENABLED` registers a new callback with Orca.
`ORCA_CLOUD_PRESET_WRITES=1` permits the existing explicitly consented UI writes;
omit it for pull/import-only access. Secure browser storage, WebCrypto and Web
Locks are required. Static-only or cloud-disabled sites require operator enablement
of these same-origin routes before users can sign in.

### Sign in with manual return

1. Open Orca Cloud from Add printer or Preferences and choose Continue with Google,
   Apple or GitHub. Complete sign-in in the provider tab opened by WebOrca.
2. With the default callback, the browser may finish on a localhost page that fails
   to load. Copy the **COMPLETE URL from that tab's address bar**, starting with
   `http://localhost:41172/callback` and including everything after `?`.
3. Return to the original WebOrca tab, paste it into the callback URL field under
   “Finish sign-in with the callback URL”, and choose **Complete sign-in**.

No local listener is required for this manual return, including on mobile. Complete
the pending flow within five minutes in the same browser profile. A callback from
an independently started desktop login will not match WebOrca's PKCE/state. The
URL is private, used once, cleared from the input immediately and never displayed
in errors. The user reports successful live login through manual return and an
authenticated upstream pull (HTTP 200, six native printer profiles, cursor
`1790531056`). This establishes live login and authenticated upstream read for
that reported flow; it does not establish acceptance of the optional HTTPS callback.

The reported pull failed at local import because the shared codec classified
ordinary native `print_host` and `print_host_webui` address settings as credentials.
The corrected codec supports and retains those exact fields, while actual
passwords, tokens, API keys and embedded URL credentials remain rejected. The
[six-profile regression and 25 focused tests passed](../build/tests-orca-cloud-native-import/fix/results.txt).
The [fix passed Chromium/Firefox import checks and HTTPS publication](../build/tests-orca-cloud-native-import/verification.txt).
Import into the user's account browser, live refresh and upstream writes still
await confirmation. After this update, refresh WebOrca, sign in again and choose
**Sync / Pull**; existing local presets and the previous failed-pull cursor are retained.

### Optional approved HTTPS callback

For automatic return, set
`ORCA_CLOUD_CALLBACK=https://weborca.noz.am/orca-cloud/callback` only after Orca's
operators approve that exact URL, including the flow's `orca_state` parameter.
Use the callback on the same origin as WebOrca. A successful automatic return
completes sign-in without pasting a URL.

The exact `/orca-cloud/callback` response must carry `Referrer-Policy: no-referrer`
and `Cache-Control: no-store` before assets load. The included static server and
Vite dev/preview middleware set these headers, retaining COOP/COEP and host
restrictions. Reverse proxies must retain these headers, avoid callback query/body
logging, and serve only this app's own assets on the callback route. The first
inline script captures the URL in memory and removes query/hash before assets;
the callback completes before the WASM engine is imported or initialized.
For an operator-managed separate bridge behind the same origin, proxy only
`/_orca-cloud/*`, retain Origin,
`x-orca-cloud` and `x-orca-cloud-session`, and redact the session header and bodies
from logs. Never restore sessions by Origin alone.

Google/Apple/GitHub buttons navigate to the official PKCE authorize URL. Tokens
and verifiers remain in server memory; a server restart requires sign-in again.
The latest printer cloud publication restarted the service; sign back into Orca Cloud
if needed. Local browser presets remain.
Same-browser-profile tabs share a credential safely; different profiles isolate
accounts. Sign out before switching accounts. Local presets and account journals
remain after logout. Pulls update saved choices only. Backup and Push require
explicit consent. Automatic sync is opt-in, persisted per account/site origin, runs
every 60 seconds and on focus while visible, and stops on logout. Automatic uploads
also require server preset writes; unresolved conflicts are skipped and never
automatically forced. Live login and authenticated upstream read are supported by
the user's report above. Successful actual-browser import, refresh and writes,
and allowlisting of the optional HTTPS callback remain unverified; mocked tests
do not establish those facts.

## Optional hosted Prusa Connect, Creality Cloud and Bambu Cloud routing

The hosted server enables these restricted adapters only when explicitly configured with
`ORCA_PRINTER_CLOUD=prusa-connect,creality-cloud,bambu-cloud` (or a subset) and a canonical
`ORCA_PUBLIC_ORIGIN`, including the external port. This opt-in is independent of
`ORCA_CLOUD_ENABLED`; Orca Cloud preset login/sync requires its own opt-in above. With Compose,
put these settings in an operator-managed environment override, since the base file does not
forward them from the shell.

The frontend build packages `dist/printer-cloud-bridge.mjs`; the server loads it from
`ORCA_ROOT` and fails startup if an enabled adapter lacks the bundle or a valid origin.
Backend bridge modules and their compressed variants are hidden from HTTP access.
The adapter exposes only the supported Prusa/Creality/Bambu cloud routes and status, with canonical
Host/Origin checks. The generic LAN/discovery/HTTP/WebSocket gateway remains a separate process.

The [routing receipt](../build/tests-prusa-connect-login-405/verification.txt) records the original
gateway checks; the current [automatic Prusa/Bambu release](../build/tests-prusa-automatic-login/verification.txt)
is described under [Tailscale access](#tailscale-access). Real account authorization, token exchange
and cloud devices remain unverified for these three printer providers.

## Optional OctoEverywhere remote connection

The optional gateway is implemented and verified locally with synthetic fixtures. Its backend bundle
ships in the current alpha release but remains **disabled/unconfigured** without a production App ID.
The sole final review candidate is `wasm/build/tests-octoeverywhere-20261105/candidate-final`
(1,097 files; [manifest](../build/tests-octoeverywhere-20261105/candidate-final.sha256) SHA-256
`cd0cc5d82fff94220d78241ac4f6d0f5a8e39bdf240cc2ba5cd4ea1fc19069b9`).
The [integrated report](../build/tests-octoeverywhere-20261105/integrated.md) records the passing
final build, packaged gateway/browser integration and post-run integrity check. Existing live
CURRENT5070 status is described above. Production enrollment and real acceptance are pending.

Runtime configuration, verified against `wasm/app/gateway/octoEverywhere.ts` and this directory's
`server.mjs` (set these on the server process; this is configuration guidance, not a deployment receipt):

```sh
ORCA_OCTOEVERYWHERE_ENABLED=1
ORCA_OCTOEVERYWHERE_APP_ID='<assigned-production-app-id>'
ORCA_PUBLIC_ORIGIN=https://your-weborca-host.example
```

Replace the placeholders with the assigned production App ID and canonical browser origin. The
origin includes any nonstandard external port and has no path, query, fragment or trailing slash.
HTTPS is required except for HTTP loopback development. No production App ID is available yet;
there is no demo fallback, and the provider demo ID is rejected. Missing App ID exposes
`portalAvailable:false` and refuses portal creation with HTTP 503; saved sessions can still operate
when otherwise enabled. Missing/invalid origin fails enabled startup. Without the explicit `=1`
opt-in, remote gateway operations remain disabled. This opt-in is independent of `ORCA_CLOUD_ENABLED`,
`ORCA_PRINTER_CLOUD` and LAN proxy settings. With Compose, pass these variables through an
operator-managed environment override; the base file does not forward them.

The enabled packaged server loads `octoeverywhere-bridge.mjs` from `ORCA_ROOT` and fails startup if
it cannot load it. It serves the same-origin `/_octoeverywhere` routes, validates canonical
Host/Origin and hides the bridge artifact and compressed variants from HTTP access. Vite dev/preview
use the same gateway and runtime environment. A standalone LAN gateway's general CORS allowance
does not grant cross-origin OctoEverywhere access. Preserve COOP `same-origin` and COEP `require-corp`;
use the app's same-origin gateway for authenticated images and sockets.

Saved-printer setup and capability-dependent features/limits are documented in
[Printer connections](../app/PRINTERS.md#octoeverywhere-optional-remote-connection).
App Connections require the printer owner's Supporter Perks. Credentials persist with the saved
printer in browser storage; server sessions retain credentials in bounded RAM only. The provider's
portal callback contains one-time credentials in query parameters by its documented contract.
The gateway immediately redirects to a clean URL; configure any deploying reverse proxy/access
logging to exclude callback query strings from logs and analytics.

Before production acceptance, obtain an assigned App ID and confirm provider callback registration
and preservation of custom returnUrl correlation parameters. Real Supporter/account/plugin/platform
compatibility, public TLS/DNS, camera playback/concurrency and the deployed isolation/proxy/browser
environment remain unverified. Webhook tools configure a user-provided public HTTPS receiver;
they do not create a receiver or verify provider delivery/signing/retry behavior. See the
[research](../../docs/octoeverywhere-integration-research.md) and
[implementation contract](../../docs/octoeverywhere-implementation-plan.md).

## Printer backend reachability

Printer connections use the deployment's same-origin backend. Enable only the required
`ORCA_PRINTER_CLOUD` providers or configure the app server gateway described in
[printer connection details](../app/PRINTERS.md). A remote deployment needs a network route
to LAN printers; a browser-local gateway is no longer supported. Missing backend capabilities
are reported in printer settings.

## Check and operate

```sh
docker compose -f compose.staging.yaml ps
docker compose -f compose.staging.yaml logs --tail=100
node wasm/deploy/smoke.mjs http://127.0.0.1:8080
docker compose -f compose.staging.yaml down
```

The smoke check verifies real WASM delivery, matching preview aliases, isolation headers, app routes, Host restrictions and
the absence of a generic app-server LAN/WebSocket gateway. The container runs as a non-root user, has a health
check and restarts automatically. Compose caps the static web container at 512 MiB with no extra
swap allowance; slicing memory is allocated in the browser. Unversioned assets use revalidation caching; hashed Vite assets
are immutable.
