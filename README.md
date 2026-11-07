<div align="center">

<picture>
  <img alt="OrcaSlicer logo" src="resources/images/OrcaSlicer.png" width="15%" height="15%">
</picture>

<a href="https://trendshift.io/repositories/15552" target="_blank"><img src="https://trendshift.io/api/badge/repositories/15552" alt="OrcaSlicer%2FOrcaSlicer | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[![GitHub Repo stars](https://img.shields.io/github/stars/OrcaSlicer/OrcaSlicer)](https://github.com/OrcaSlicer/OrcaSlicer/stargazers) [![Build all](https://img.shields.io/github/actions/workflow/status/OrcaSlicer/OrcaSlicer/main_build_status.yml?label=Build%20all)](https://github.com/OrcaSlicer/OrcaSlicer/actions/workflows/build_all.yml)

OrcaSlicer: an open source Next-Gen Slicing Software for Precision 3D Prints.  
Optimize your prints with ultra-fast slicing, intelligent support generation, and seamless printer compatibility—engineered for perfection.

This checkout also includes a browser-based WebAssembly port in [wasm/app](wasm/app). See [wasm/deploy/README.md](wasm/deploy/README.md) for web deployment instructions.

The accumulated WebOrca app, alpha access and startup work is captured on the private
[`nozamdavid/weborca` main branch](https://github.com/nozamdavid/weborca/tree/main).
Verification reports and immutable release directories under `wasm/build` are local,
ignored evidence; they are not included in the source snapshot. Git publication
does not change the running CURRENT5070 deployment.

CURRENT5070 now keeps navigation and Preferences usable during engine download.
Native model tools, process edits and Slice wait for completed initialization.
Printer discovery loads in Add printer/configuration; saved printer startup uses
its current vendor dependencies. The [startup publication report](wasm/build/tests-background-engine-20261107/report.md)
records measured ordering, catalog reuse, desktop/mobile native checks and the
current guarded rollback to the alpha design release.

The alpha access and admin UI now uses WebOrca's dark/teal palette, focused sign-in
forms and a compact invite workspace with responsive status and usage details.
The [design report](wasm/build/tests-alpha-design-20261107/report.md) includes before/after
captures, 39 passing alpha tests, production desktop/mobile recovery checks and
its historical guarded rollback.

Alpha access and the sampled bug/engine repairs are published on CURRENT5070; the current immutable release is `wasm/build/ui-background-engine-release-20261107`. Signed-in admins can choose **Open slicer** without creating an invite. The [alpha design publication](wasm/build/tests-alpha-design-20261107/report.md) records the verified change and rollback to the previous gated release. Visit [WebOrca](https://server-1.barbel-hops.ts.net:5070) for the invite-code gate and **Login as admin**. The [alpha publication report](wasm/build/tests-alpha-access-20261106/publication/report.md) records the compatible frozen server, private environment loading, durable state, public HTTPS checks and explicit rollback. The companion `wasm/build/tests-alpha-access-20261106/candidate-static` remains locally verified. The [integrated report](wasm/build/tests-alpha-access-20261106/integrated.md) records 113 selected passes (34 alpha, 65 application regressions, 9 filament/project, 5 native), production builds, full-app durable recovery after revocation/write failure/retry, and file-only import/slice/Preview with zero alpha requests. Admin invite creation, internal email/username labels, usage and revocation are covered; tester and admin authorization are separate. See [configuration and environment loading](wasm/deploy/README.md#optional-alpha-access) and [UI/recovery behavior](wasm/app/DESIGN.md#optional-alpha-access--local-verification-2026-11-06).

This is sampled audit/acceptance. The known legacy macOS cube oracle still differs by 804 normalized lines on both pre/post native artifacts, which match each other after normalization. Native parity is limited to the recorded inputs and retained dependency archives; no complete-codebase, all-suites-green or performance claim is established. Public Tailscale HTTPS gate, native bytes, desktop/mobile slice/Preview and revocation checks pass; real provider/OAuth/printer lifecycle and hardware/browser acceptance remain open. The [tracking receipt](wasm/build/tests-alpha-access-20261106/tracking.md) records documentation and Taproot updates.

Whole-app desktop/mobile polish was published on CURRENT5070 (2026-11-06 21:20:53 UTC), previous immutable release [ui-app-polish-release-20261106](wasm/build/ui-app-polish-release-20261106/). The alpha publication above is current. This historical release combines the verified r11 UI with all 1059 current non-UI files, including the HTTP201 backend and native binaries. Compact desktop More navigation, semantic Preview/override/error text, calibration units/field errors/actions, mobile Send and Preferences, bounded sheets/touch targets, plate scrolling and object keyboard/focus paths are covered; mobile retains its neutral treatment. The [integrated report](wasm/build/tests-app-polish-20261106/integrated.md) records D1–D7/M1–M11 scoped acceptance, final app compile/locale/build checks and 10 focused regressions passing. The [publication report](wasm/build/tests-app-polish-20261106/publication/report.md) records public HTTPS bytes/encodings/headers, desktop/mobile startup and navigation checks, preservation manifests and guarded rollback.

The representative Chromium matrix spans 320–1440px, both themes, English/Spanish and enlarged text. Final r11 replays affected surfaces and retains earlier matrix evidence where applicable. Two detector scans preceded the last plate CSS repair; no once-only detector pass after the final edit is claimed. Physical Safari/touch devices, assistive technology, exhaustive accessibility/settings coverage and real provider/account/printer acceptance remain open. See the report for provenance and limits, [design rules](wasm/app/DESIGN.md#local-app-polish--2026-11-06) and [tracking receipt](wasm/build/tests-app-polish-20261106/tracking.md).

Optional OctoEverywhere client code is shipped in the polished UI; its backend is **unconfigured and unavailable** on CURRENT5070. The four enabled providers and HTTP201 behavior are retained. No production App ID was supplied and no placeholder ID was installed. The current frozen server includes the optional backend bundle and denies its download, including compressed representations. The full implementation is verified locally with synthetic fixtures. The final immutable candidate is `wasm/build/tests-octoeverywhere-20261105/candidate-final`; its [integrated verification](wasm/build/tests-octoeverywhere-20261105/integrated.md) records 42 focused checks, compilation/build and Chromium integration passing. Monitoring, cameras, material display, controls, files and optional sharing/webhook actions depend on the installed provider's capabilities and account limits. Linking requires an assigned production App ID and the printer owner's Supporter Perks; real portal/callback, account/plugin/printer and deployed-browser acceptance remain pending. See [printer setup and limits](wasm/app/PRINTERS.md#octoeverywhere-optional-remote-connection) and [server configuration](wasm/deploy/README.md#optional-octoeverywhere-remote-connection).

WebOrca's hosted Orca Cloud connection is live with automatic browser configuration and manual callback completion. The user confirmed live login and authenticated reads. The [native printer import fix](wasm/build/tests-orca-cloud-native-import/verification.txt) preserves ordinary printer address settings; [imported preset parent/vendor selection and override application passed fixture checks in Chromium/Firefox and HTTPS publication](wasm/build/tests-cloud-preset-vendor/verification.txt). Successful process/filament resolution is helper-tested; the browser success fixture is a printer. The user's actual imported preset selection, live token refresh and upstream writes remain unconfirmed.

The [U1 cube print-time diagnosis](wasm/build/tests-print-time-estimate/uploaded-cube/report.md) is complete: the 27 mm, 0.08 mm High Quality ABS cube replays at 3h49m03s; custom layer-change G-code adds 3h02m02s, with 47m01s after resetting only that option to stock. No estimator/source bug or production fix/deployment is established; the agent has not applied the browser/preset correction, and the user must reset Layer change G-code and re-slice. The override's origin is unproven; physical printer timing is untested.

Hosted Prusa Connect, Creality Cloud and the repaired Bambu Cloud route are live on 5070. Prusa defaults to automatic email/password → optional OTP: WebOrca's server forwards credentials to Prusa Account and captures the registered callback without DevTools. Manual callback completion remains available; social/passkey authentication is unsupported. The existing Connect client retains `https://connect.prusa3d.com/login/auth-callback`. See the [setup flow](wasm/app/PRINTERS.md#authentication--setup-flow).

CURRENT5070 serves `wasm/build/ui-alpha-design-release-20261107` with the alpha override, compatible frozen server and durable gate enabled. It retains the settings/routing batch described here; the [alpha design publication](wasm/build/tests-alpha-design-20261107/report.md) binds the current root and rollback. Printer connections use the app server only; legacy local gateway addresses migrate away, and static hosts require a compatible backend. User presets retain parent inheritance when overwritten, including normalized numeric values, with current-name prefill and explicit overwrite. Settings tabs stay in one row and reveal the selected tab; native descriptions/wiki help, mobile controls, modified tables and modal spacing are improved. Device preserves saved readings/time through inactivity and errors; returning to Device/focus waits until the last successful snapshot is at least 15 seconds old before refreshing. Manual Retry remains immediate and healthy monitoring stays connected. See the [publication and preservation report](wasm/build/tests-settings-routing-batch/publication/report.md) and [sealed synthetic acceptance](wasm/build/tests-settings-routing-batch/qa-corrected/report.md). Acceptance is **CHROMIUM_SYNTHETIC_ONLY**, including actual browser focus checks; the remote Snapmaker root cause remains unproven. Historical physical telemetry is separate, and physical Mac/Safari/Firefox/hardware acceptance remains open. Four extruder cards, the desktop divider, collapsible selected-object panel and text Copy are retained; the alpha publication binds the verified native repairs. Restart clears OrcaCloud RAM sign-in; browser presets remain.

Selected webpage text retains priority for Copy even while a model object is selected; without text selection, object Copy still works. Inputs, textareas and contenteditable fields keep native shortcuts. The [prior Copy publication](wasm/build/tests-text-copy-priority/publication/report.md) and [sealed Copy QA](wasm/build/tests-text-copy-priority/qa/report.md) retain its implementation evidence; [Device publication](wasm/build/tests-device-refresh-resize/publication/report.md) and the current sealed QA retain selected-text Copy and object Copy/Paste/Undo checks.

Retained Objects/clipboard/Handy r2 behavior includes Objects fitting its contents (131–142px empty on desktop), tree caps of 260px desktop/240px mobile and reachable override fields. Clicking or dragging a model restores viewer focus after editing. Built-in Handy models preserve original geometry and skip only automatic simplification; ordinary uploads still offer Simplify and manual Simplify remains functional. Desktop slice results sit below the camera buttons. The [prior publication](wasm/build/tests-objects-clipboard-handy/publication/report.md) and [sealed r2 QA](wasm/build/tests-objects-clipboard-handy/qa-r2/report.md) remain evidence for those features. The current candidate retains the reconstructed UI source baseline, lighting, native assets, four providers and caps 512MiB/swap0/CPU100%/Tasks64; the r11 UI also ships its optional Show FPS control. Restart cleared OrcaCloud RAM sign-in; browser presets remain. Physical Mac/Safari and Firefox acceptance remain unverified.

The retained connected Prusa/Creality filament behavior remains **SYNTHETIC_ONLY**: representative source-contract fixtures verify Prusa assigned material/vendor/product/RGBA with current-poll REST fallback and Creality CFS/rack inventory; real Prusa OAuth/physical MMU, Creality hardware and unload/reassignment acceptance remain open. Its [sealed QA](wasm/build/tests-connected-filaments/qa/report.md) and [prior publication report](wasm/build/tests-connected-filaments/publication/report.md) retain 184 focused tests and 72 integrated layouts.

The retained Snapmaker baseline is `wasm/build/ui-snapmaker-filaments-candidate-20261105`. Device displays read-only printer-reported assignments: material, vendor, subtype, color and explicit presence, labeled by physical tool index. Its [actual idle four-tool comparator](wasm/build/tests-snapmaker-filaments/actual/report.md) verified Grey PLA/Generic, Blue PLA/Bambu Lab Silk, Black PLA/Bambu Lab Matte and White PLA/Generic, all explicitly present, with retention across heater deltas and a fresh query. Physical unload/reassignment, job lifetime and other accounts remain open. Snapmaker `filamentSlots` remains read-only, with no project synchronization, uploads or controls. Its [reconstructed source and sealed QA](wasm/build/tests-snapmaker-filaments/qa-recovered/report.md) and [prior publication](wasm/build/tests-snapmaker-filaments/publication/report.md) remain historical evidence. Broader provider capabilities, Bambu China and physical Safari/accessibility acceptance remain open.

[Doop design polish](https://doop.design/c/w9eUegMkVU) is now implemented and published in the app with real-app adaptations: native toolpaths and metrics, full setting/calibration actions, desktop playback, one mobile layer slider and working export. The design history retains 11 mobile frames ([mobile evidence](wasm/build/tests-doop-design-polish/mobile/report.txt)) and six editable desktop counterparts ([desktop evidence](wasm/build/tests-doop-design-polish/desktop/verification.txt)). Static design captures remain references; the native canvas still renders models and G-code. The [mobile](https://doop.design/c/w9eUegMkVU/proto?frame=C-uhr12eGM) and [desktop](https://doop.design/c/w9eUegMkVU/proto?frame=vEytJlzoX2) canvas drafts have separate approval status. App publication authorization does not approve those drafts. Physical accessibility and Doop player runtime remain incompletely verified.

The additional desktop refinement requested on 2026-11-05 is complete in those six Doop drafts and published in the app: Add model and consistent Slice readiness, visible preset overrides/reset and save scope, collapsible Preview timing, distinct layer/move controls, calibration cues and readable units/help. Desktop teal actions and stable workspace navigation are verified; mobile keeps its neutral treatment. [Doop verification](wasm/build/tests-desktop-polish-20261105/doop/report.md) records 166 checks and preserved anchors/captured values. The [app verification](wasm/build/tests-desktop-polish-20261105/app/final-review.md) covers 1440×900, 1366×768 and 1280×800, native Benchy metrics, focused tests and TypeScript/build checks. Its UI is included in the current Preview lighting release below; publication does not approve the Doop drafts.

Preview now has an independent, persisted **Lighting & shadows** toggle beside Low quality and in mobile Preview controls. It defaults on; switching it off uses basic shading and skips toolpath/bed shadows while preserving quality, camera, ranges and loaded data. The [verification report](wasm/build/tests-preview-lighting-toggle-20261105/report.md) records native compilation, six focused tests, Chromium/Firefox rendering and persistence/layout checks. Originally published to CURRENT5070 at 2026-11-05 15:08:43 UTC as `wasm/build/ui-preview-lighting-toggle-release-20261105`, its native assets and lighting behavior survive the current release; reconstructed UI provenance and preserved shipped desktop CSS are documented in sealed QA. Its original [publication evidence and rollback](wasm/build/tests-preview-lighting-toggle-20261105/publication/report.md) records 123 public asset/encoding checks, 16 Preview routes and live desktop/mobile persistence checks. The initial readiness race rolled back automatically; bounded retries and final integrity passed. Use the current Device publication's guarded rollback reference for the active release. Restart clears OrcaCloud RAM sign-in; browser presets remain.

Preview **Show FPS** is complete in the verified local immutable candidate `wasm/build/ui-preview-fps-candidate-20261105` (loopback port 5384), **not published**. The persisted, default-off desktop/mobile control reports completed-draw cadence, Idle at rest and explicit CPU submission milliseconds, with bounded updates and no extra redraw loop. The [verification report](wasm/build/tests-preview-fps-20261105/report.md) records all eight focused tests, TypeScript/Vite build and 1440/1280/390/320 viewport checks passing.

Earlier Creality contract candidate: published 2026-11-04 at 17:05:26 UTC, PID 2622253, immutable root `wasm/build/ui-creality-login-contract-candidate-20261104` via root-only `zz-creality-login-contract.conf`. Regional login hosts, request fields and QR identity handling follow the inspected embedded China login contract. One integrated build, 20/20 focused tests, gateway compile, headed Chromium and 117 served checks passed. Independent review found no concrete blockers; public HTTPS bytes/health/headers, providers, caps and exclusions passed publication verification. Live global/password/QR account login remains unverified; the pinned upstream global UI uses a separate account-center flow. See the [receipt](wasm/build/tests-creality-login-invalid-parameter/verification.txt) and [publication report](wasm/build/tests-creality-login-invalid-parameter/publication/report.md). Release99 and prior roots, frozen server and guarded rollback remain available. Restart reset OrcaCloud RAM sign-in; browser presets remain.

Earlier release99: published 2026-11-04 at 16:21:00 UTC, PID 2432462, immutable root `wasm/build/ui-printer-settings-connection-candidate-20261104` via root-only `99-printer-settings-connection.conf`. The green sidebar connection button opens the selected physical printer's saved settings, including its host, credentials and preset; explicit Add opens a blank connection. Its [receipt](wasm/build/tests-printer-settings-connection/verification.txt) and [publication report](wasm/build/tests-printer-settings-connection/publication/report.md) remain historical.

Earlier release98: published 2026-11-04 at 15:49:24 UTC, PID 2302979, immutable root `wasm/build/ui-prusa-login-reload-candidate-20261104` via the root-only `98-prusa-login-reload.conf`. Successful Prusa login caches browser tokens immediately before selecting or saving a printer; reload and host switching restore the account/device list, and received token rotations persist immediately. Unsaved device selection survives switching away and back. Sign in once if the prior session was already lost. Switching host type or opening an existing connection also checks browser-saved Bambu Global and Creality tokens: rejected tokens offer login and network failures offer Retry. Tokens remain in browser storage with no server persistence. Bambu China reuse remains safely unsupported pending regional routing; real account compatibility remains unverified. The [receipt](wasm/build/tests-prusa-login-reload/verification.txt) and [publication report](wasm/build/tests-prusa-login-reload/publication/report.md) record live byte/header/integrity checks and synthetic QA. Releases97/96, the frozen server and all settings are retained. Restart reset in-memory OrcaCloud sign-in; local presets are retained. Earlier release history follows.

Release97 was published 2026-11-04 at 15:13:13 UTC, PID 2151273, immutable root `wasm/build/ui-cloud-host-session-reuse-candidate-20261104` via `97-cloud-host-session-reuse.conf`. Its [receipt](wasm/build/tests-cloud-host-session-reuse/verification.txt) and [publication report](wasm/build/tests-cloud-host-session-reuse/publication/report.md) remain historical.

Published on 2026-11-04 at 14:18:14 UTC, PID 1924128: immutable root `wasm/build/ui-prusa-automatic-bambu-candidate-20261104` and frozen server `wasm/build/tests-prusa-automatic-login/publication/server.approved.mjs`. `96-prusa-automatic-bambu.conf` overrides server/root and sets `ORCA_PRINTER_CLOUD=prusa-connect,creality-cloud,bambu-cloud`; retained `95-prusa-capture.conf` is superseded. [Verification](wasm/build/tests-prusa-automatic-login/verification.txt) and the [publication report](wasm/build/tests-prusa-automatic-login/publication/report.md) record 55/55 synthetic checks, compile, Chromium fixtures and public health/UI checks passing. Real Prusa/Bambu account authentication and Creality login/devices remain unverified. The restart reset OrcaCloud sign-in; local presets are retained. Arcane on port 8932 and native Prusa on port 8243 are unchanged.

[PrusaSlicer source research](docs/prusa-connect-automatic-callback.md) informed the implemented narrow TypeScript adaptation of its server-side password/OTP and callback capture behavior. The findings and original proposal are retained as history.

WebOrca is a working browser/WASM app, privately available at https://server-1.barbel-hops.ts.net:5070/. The [WebOrca project in Taproot](http://192.168.0.199:8789/p/YPttwK6VZASSDf) tracks verified milestones, work in progress, and TODOs. G-code preview per-fragment lighting and toolpath/bed shadows are live, with [Chromium/Firefox software renderer QA and HTTPS publication verified on r2](wasm/build/tests-preview-lighting/verification.txt).

# Official links and community

#### Official Website:

<a href="https://www.orcaslicer.com/" style="font-size:2em;">OrcaSlicer.com</a>

#### Github Repository:

<a href="https://github.com/OrcaSlicer/OrcaSlicer"><img src="https://img.shields.io/badge/OrcaSlicer-181717?style=flat&logo=github&logoColor=white" width="200" alt="GitHub Logo"/> </a>

#### Follow us:

<a href="https://twitter.com/real_OrcaSlicer"><img src="https://img.shields.io/badge/real__OrcaSlicer-000000?style=flat&logo=x&logoColor=white" width="200" alt="X Logo"/> </a>  
<a href="https://www.youtube.com/@OfficialOrcaSlicer"><img src="https://img.shields.io/badge/OfficialOrcaSlicer-FF0000?style=flat&logo=youtube&logoColor=white" width="200" alt="YouTube Logo"/> </a>

#### Join our Discord community:

<a href="https://discord.gg/P4VE9UY9gJ"><img src="https://img.shields.io/badge/-Discord-5865F2?style=flat&logo=discord&logoColor=fff" width="200" alt="discord logo"/> </a>

<table border="2" style="border-color: #ffa500; background-color:rgb(232, 220, 180); color: #856404;">
<tr>
<td>
<strong>⚠️ CAUTION:</strong><br>
Several clickbait and malicious websites, such as <b>orca-slicer[.]com</b> and <b>orcaslicer[.]net</b>, are pretending to be the official OrcaSlicer site. These sites may redirect you to dangerous downloads or contain misleading information.<br>
<b>Our only official website is <a href="https://www.orcaslicer.com/">www.orcaslicer.com</a>.</b><br><br>
If you come across any of these in search results, please <b>report them</b> as unsafe or phishing to help keep the community secure with:<br>
 - <a href="https://safebrowsing.google.com/safebrowsing/report_phish/">Google Safe Browsing</a><br>
 - <a href="https://www.microsoft.com/en-us/wdsi/support/report-unsafe-site">Microsoft Security Intelligence</a><br>
 - <a href="https://ipthreat.net/tools/reportphishing">IPThreat</a>
</td>
</tr>
</table>

</div>

# Main features

- **[Advanced Calibration Tools](https://www.orcaslicer.com/wiki/calibration_guide)**  
  Comprehensive suite: temperature towers, flow rate, retraction & more for optimal performance.
- **[Precise Wall](https://www.orcaslicer.com/wiki/quality_settings_precision#precise-wall) and [Seam Control](https://www.orcaslicer.com/wiki/quality_settings_seam)**  
  Adjust outer wall spacing and apply scarf seams to enhance print accuracy.
- **[Sandwich Mode](https://www.orcaslicer.com/wiki/quality_settings_wall_and_surfaces#innerouterinner) and [Polyholes](https://www.orcaslicer.com/wiki/quality_settings_precision#polyholes) Support**  
  Use varied infill [patterns](https://www.orcaslicer.com/wiki/strength_settings_patterns) and accurate hole shapes for improved clarity.
- **[Overhang](https://www.orcaslicer.com/wiki/quality_settings_overhangs) and [Support Optimization](https://www.orcaslicer.com/wiki#support-settings)**  
  Modify geometry for printable overhangs with precise support placement.
- **[Granular Controls and Customization](https://www.orcaslicer.com/wiki#process-settings)**  
  Fine-tune print speed, layer height, pressure, and temperature with precision.
- **Network Printer Support**  
  Seamless integration with Klipper, PrusaLink, and OctoPrint for remote control.
- **[Mouse Ear Brims](https://www.orcaslicer.com/wiki/others_settings_brim) & [Adaptive Bed Mesh](https://www.orcaslicer.com/wiki/printer_basic_information_adaptive_bed_mesh)**  
  Automatic brims and adaptive mesh calibration ensure consistent adhesion.
- **User-Friendly Interface**  
  Intuitive drag-and-drop design with pre-made profiles for popular printers.
- **[Open-Source](https://github.com/OrcaSlicer/OrcaSlicer) & [Community Driven](https://discord.gg/P4VE9UY9gJ)**  
  Regular updates fueled by continuous community contributions.
- **Wide Printer Compatibility**  
  Supports a broad range of printers: Bambu Lab, Prusa, Creality, Voron, and more.
- Additional features can be found in the [change notes](https://github.com/OrcaSlicer/OrcaSlicer/releases/).

# Wiki

The [wiki](https://www.orcaslicer.com/wiki) aims to provide a detailed explanation of the slicer settings, including how to maximize their use and how to calibrate and set up your printer.

- **[Access the wiki here](https://www.orcaslicer.com/wiki)**
- **[Contribute to the wiki](https://www.orcaslicer.com/wiki/how_to_wiki)**

# Download

## Stable Release

📥 **[Download the Latest Stable Release](https://github.com/OrcaSlicer/OrcaSlicer/releases/latest)**  
Visit our GitHub Releases page for the latest stable version of OrcaSlicer, recommended for most users.

## Nightly Builds

🌙 **[Download the Latest Nightly Build](https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/nightly-builds)**  
Explore the latest developments in OrcaSlicer with our nightly builds. Feedback on these versions is highly appreciated.

### Belt Printer Builds

The [nightly release](https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/nightly-builds) ships **two parallel builds**: the standard build and a belt-printer build. Both are attached to the same release — tell them apart by the filename suffix:

- **Standard** — no suffix (e.g. `OrcaSlicer_Windows_Installer_x64_nightly.exe`)
- **Belt** — `_belt` suffix (e.g. `OrcaSlicer_Windows_Installer_x64_nightly_belt.exe`)

The `_belt` builds add **experimental support for belt / conveyor (infinite-Z) printers**, where the model is sliced against a tilted belt surface instead of a flat horizontal bed. They include ready-to-use belt printer profiles, the full belt slicing pipeline (mesh rotation and G-code transforms), belt-aware support generation, and a tilted-bed preview.

> ⚠️ Belt printer support is under active development and is **not yet merged into `main`** — it currently ships only in these parallel `_belt` builds, produced from the [`belt-printer`](https://github.com/OrcaSlicer/OrcaSlicer/tree/belt-printer) branch. See tracking PR [#14394](https://github.com/OrcaSlicer/OrcaSlicer/pull/14394) and the original documentation in [#12998](https://github.com/OrcaSlicer/OrcaSlicer/pull/12998).

# How to install

## Windows

Download the **Windows Installer exe** for your preferred version from the [releases page](https://github.com/OrcaSlicer/OrcaSlicer/releases). Both `x64` and `arm64` installers are published — pick the one matching your CPU.

- *For convenience there is also a portable build available.*
    <details>
    <summary>Troubleshooting</summary>

  - *If you have troubles to run the build, you might need to install following runtimes:*
  - [MicrosoftEdgeWebView2RuntimeInstallerX64](https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v1.0.10-sf2/MicrosoftEdgeWebView2RuntimeInstallerX64.exe)
    - [Details of this runtime](https://aka.ms/webview2)
    - [Alternative Download Link Hosted by Microsoft](https://go.microsoft.com/fwlink/p/?LinkId=2124703)
  - [vcredist2019_x64](https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v1.0.10-sf2/vcredist2019_x64.exe)
    - [Alternative Download Link Hosted by Microsoft](https://aka.ms/vs/17/release/vc_redist.x64.exe)
    - This file may already be available on your computer if you've installed visual studio.  Check the following location: `%VCINSTALLDIR%Redist\MSVC\v142`
    </details>

### Microsoft Store

Install from the [Microsoft Store](https://apps.microsoft.com/detail/9mv6gl23xm59) when you prefer a Store-signed package (helps on Windows 11 Smart App Control).

### Windows Package Manager

```shell
winget install --id=SoftFever.OrcaSlicer -e
```

## Mac

1. Download the universal DMG, which runs on both Apple Silicon and Intel Macs.
2. Drag OrcaSlicer.app to Application folder.
3. *If you want to run a build from a PR, you also need to follow the instructions below:*

    <details>
    <summary>Quarantine</summary>

    - Option 1 (You only need to do this once. After that the app can be opened normally.):
      - Step 1: Hold _cmd_ and right click the app, from the context menu choose **Open**.
      - Step 2: A warning window will pop up, click _Open_

    - Option 2:
      Execute this command in terminal:

      ```shell
      xattr -dr com.apple.quarantine /Applications/OrcaSlicer.app
      ```

    - Option 3:
        - Step 1: open the app, a warning window will pop up  
            ![mac_cant_open](./SoftFever_doc/mac_cant_open.png)
        - Step 2: in `System Settings` -> `Privacy & Security`, click `Open Anyway`:  
            ![mac_security_setting](./SoftFever_doc/mac_security_setting.png)
    </details>

### Homebrew Cask

```shell
brew install --cask orcaslicer
```

The [Homebrew cask](https://formulae.brew.sh/cask/orcaslicer) installs the official macOS DMG from [GitHub Releases](https://github.com/OrcaSlicer/OrcaSlicer/releases).

## Linux

### Flathub (Recommended)

OrcaSlicer is available through FlatHub:

<a href='https://flathub.org/apps/com.orcaslicer.OrcaSlicer'><img width='240' alt='Download on Flathub' src='https://dl.flathub.org/assets/badges/flathub-badge-en.png'/></a>

Install from the command line:

```shell
flatpak install flathub com.orcaslicer.OrcaSlicer
flatpak run com.orcaslicer.OrcaSlicer
```

It can also be installed through graphical software managers (KDE Discover, GNOME Software, etc.) when Flathub is enabled. Search for **OrcaSlicer** in your software center.

### AppImage

AppImages are published for both **x86_64** and **aarch64** (ARM64). Pick the file matching your CPU — the ARM64 build has `aarch64` in its name (e.g. `OrcaSlicer_Linux_AppImage_Ubuntu2404_aarch64_*.AppImage`).

 1. Download App image from the [releases page](https://github.com/OrcaSlicer/OrcaSlicer/releases).
 2. Double click the downloaded file to run it.

 3. If you run into trouble executing it, try this command in the terminal:
    `chmod +x /path_to_appimage/OrcaSlicer_Linux.AppImage`

# How to Compile

All updated build instructions for Windows, macOS, and Linux are now available on the official [OrcaSlicer Wiki - How to build](https://www.orcaslicer.com/wiki/how_to_build) page.

Please refer to the wiki to ensure you're following the latest and most accurate steps for your platform.

# Klipper Note

If you're running Klipper, it's recommended to add the following configuration to your `printer.cfg` file.

```gcode
# Enable object exclusion
[exclude_object]

# Enable arcs support
[gcode_arcs]
resolution: 0.1
```

# Supports

**OrcaSlicer** is an open-source project, and we're deeply grateful to all our sponsors and backers.  
Their generous support helps fund filaments and other essential 3D printing materials for the project.  
Thank you! :)

## Sponsors

<table>
<tr>
<td>
<a href="https://qidi3d.com/" style="display:inline-block; border-radius:8px; background:#fff;">
  <img src="SoftFever_doc\sponsor_logos\QIDI.png" alt="QIDI" width="100" height="100">
</a>
</td>
<td>
<a href="https://bigtree-tech.com/" style="display:inline-block; border-radius:8px; background:#222;">
    <img src="SoftFever_doc\sponsor_logos\BigTreeTech.png" alt="BIGTREE TECH" width="100" height="100">
</a>
</td>
</tr>
</table>

## Backers:

**Ko-fi supporters** ☕: [Backers list](https://github.com/user-attachments/files/16147016/Supporters_638561417699952499.csv)

## Support the project

<a href="https://github.com/sponsors/SoftFever"><img src="https://img.shields.io/badge/GitHub%20Sponsors-30363D?style=flat&logo=GitHub-Sponsors&logoColor=EA4AAA" height="50"></a>  
<a href="https://ko-fi.com/G2G5IP3CP"><img src="https://img.shields.io/badge/Support_me_on_Ko--fi-FF5E5B?style=flat&logo=ko-fi&logoColor=white" height="50"></a>  
<a href="https://paypal.me/softfever3d"><img src="https://img.shields.io/badge/PayPal-003087?style=flat&logo=paypal&logoColor=fff" height="50"></a>

## Some Background

Open-source slicing has always been built on a tradition of collaboration and attribution. [Slic3r](https://github.com/Slic3r/Slic3r), created by Alessandro Ranellucci and the RepRap community, laid the foundation. [PrusaSlicer](https://github.com/prusa3d/PrusaSlicer) by Prusa Research built on Slic3r and acknowledged that heritage. [Bambu Studio](https://github.com/bambulab/BambuStudio) in turn forked from PrusaSlicer, and [SuperSlicer](https://github.com/supermerill/SuperSlicer) by @supermerill extended PrusaSlicer with community-driven enhancements. Each project carried the work of its predecessors forward, crediting those who came before.

OrcaSlicer began in that same spirit, drawing from BambuStudio, PrusaSlicer, and ideas inspired by CuraSlicer and SuperSlicer. But it has since grown far beyond its origins. Through relentless innovation — introducing advanced calibration tools, precise wall and seam control, tree supports, adaptive slicing, and hundreds of other features — OrcaSlicer has become the most widely used and actively developed open-source slicer in the 3D printing community. Many of its innovations have been adopted by other slicers, making it a driving force for the entire industry.

The OrcaSlicer logo was designed by community member [Justin Levine](https://github.com/jal-co).

# License

- **OrcaSlicer** is licensed under the GNU Affero General Public License, version 3.
- The **GNU Affero General Public License**, version 3 ensures that if you use any part of this software in any way (even behind a web server), your software must be released under the same license.
- OrcaSlicer includes a **pressure advance calibration pattern test** adapted from Andrew Ellis' generator, which is licensed under GNU General Public License, version 3. Ellis' generator is itself adapted from a generator developed by Sineos for Marlin, which is licensed under GNU General Public License, version 3.
- The **Bambu networking plugin** is based on non-free libraries from BambuLab. It is optional to the OrcaSlicer and provides extended functionalities for Bambulab printer users.
