# EasyPrint UI research — 2026-11-10

The strongest adoption candidates are a small illustrated settings surface, actionable slicing warnings, and a result summary that makes material and quality consequences visible. These are **documentation-backed candidates**, pending hands-on validation: the live EasyPrint application was inaccessible in this session.

## Method and limits

- Read both requested AGENTS.md files and the research skill. Acted as the assigned research sub-agent; no further delegation.
- Used T3 preview only, starting with preview_status, then one fresh Default-profile tab with reuseExistingTab:false. Browser engine/version was not reported by the tools. Closed that tab after research.
- Live URL: <https://www.printables.com/slice>. Desktop CSS viewport 1280×800; mobile CSS viewport 390×844. Resizing changes CSS dimensions, not the user agent or physical touch capabilities.
- Both sizes stopped at Cloudflare's “Performing security verification,” before application entry, import, or sign-in. Snapshot network diagnostics reported HTTP 403 and a challenge-host DNS failure. This is an access boundary, not evidence of EasyPrint's own error handling. No challenge bypass attempted.
- Actual authentication state behind the challenge is unknown. The accessible [official guide](https://help.prusa3d.com/article/easyprint_898029#accessing-easyprint) says a Prusa Account login is required. No login or registration attempted.
- Guide viewed at 1440×1000 CSS pixels; tool-saved guide screenshots are scaled to 1280×889. The guide header displayed an update age of two months. Embedded examples vary in age and toolbar labels; they do not establish the exact current application layout.
- No model imported, slicing started, print sent, account configuration changed, paid action used, or asset published. The help cookie banner was dismissed with rejection. No implementation, README, Taproot, tests, or builds changed/run.

## Live observations

| State | Direct source | Evidence |
|---|---|---|
| Desktop entry shows a security-verification page, spinner, explanatory text and Cloudflare footer; no EasyPrint controls | [Live entry](https://www.printables.com/slice) | [01 desktop](easyprint-ui-research-20261110/01-live-desktop.png) |
| Mobile size reaches the same boundary, with wrapped domain heading; this says nothing about EasyPrint's responsive workspace | [Live entry](https://www.printables.com/slice) | [02 mobile](easyprint-ui-research-20261110/02-live-mobile.png) |

The live empty state, acquisition, printer/material setup, transforms, settings, slicing/progress, result/download/send and back/recovery flows were therefore **not exercised**. No live timing, engine performance, printer compatibility list, accessibility quality or mobile usability conclusion can be drawn.

## Official illustrated workflow — documentation claims only

Each row records what the official page describes and its examples show; no row represents a completed interaction in the application.

| Stage | Documented behavior and visible pattern | Official source / screenshot |
|---|---|---|
| Entry and workspace | Account prerequisite. Top controls group projects, undo/redo, printer/material/settings and output. Bed tools sit alongside the scene, with model-list access near the bottom. The image shows a bed with an object, not a tested empty state. | [Access](https://help.prusa3d.com/article/easyprint_898029#accessing-easyprint); [03 prerequisite](easyprint-ui-research-20261110/03-guide-access.png), [04 workspace](easyprint-ui-research-20261110/04-guide-workspace.png) |
| Model acquisition | A Printables selection list collects models before arranging them onto the bed. Local uploads and repository search are reached through the model panel or bed add control. Guide lists STL/3MF support as of April 2026. | [Import](https://help.prusa3d.com/article/easyprint_898029#model-import-and-upload); [05 import](easyprint-ui-research-20261110/05-guide-import.png) |
| Printer and material | Connected printer selection exposes status. Offline printer setup includes exact model and nozzle selection. Guide also describes third-party offline profiles and desktop LAN delivery with connection configuration/optional extension; no supported-model inventory was accessed. Spool search/favorites and loaded material inform assignment, with an unknown-color fallback after filament changes. | [Printer](https://help.prusa3d.com/article/easyprint_898029#selecting-printer), [spools](https://help.prusa3d.com/article/easyprint_898029#spools-menu); [06 printer](easyprint-ui-research-20261110/06-guide-printer.png) |
| Transform and arrange | Face placement, three-axis rotation with snapping or numeric input, uniform/nonuniform scaling and reset are described. Long press enters multiple selection; cloning automatically arranges copies, spilling across beds if needed. These gestures were not tested. | [Orientation](https://help.prusa3d.com/article/easyprint_898029#model-orientation-and-scale), [copies](https://help.prusa3d.com/article/easyprint_898029#copying-objects); illustrated workspace context in [04](easyprint-ui-research-20261110/04-guide-workspace.png); detailed behavior supported by guide text |
| Settings disclosure and guidance | Main quality choices show layer heights; additional profiles sit behind a secondary control. Infill has a structural illustration and density; shell values pair physical thickness with layer/perimeter counts and a reset. Support/adhesion choices have illustrations. Guide describes hover/tap help icons. | [Settings](https://help.prusa3d.com/article/easyprint_898029#adjusting-print-settings), [support](https://help.prusa3d.com/article/easyprint_898029#enabling-supports-and-increased-adhesion), [tooltips](https://help.prusa3d.com/article/easyprint_898029#tooltips); [07 support](easyprint-ui-research-20261110/07-guide-supports.png), [08 settings](easyprint-ui-research-20261110/08-guide-settings.png) |
| Slice boundary | Print initiates a material-assignment confirmation before server slicing. Example compares intended and assigned colors, with a Back control and a separate confirmation. Guide mentions queue/complexity-dependent waiting; actual progress UI, cancellation and retry behavior remain unknown. | [Printing](https://help.prusa3d.com/article/easyprint_898029#printing); [09 confirmation](easyprint-ui-research-20261110/09-guide-material-confirmation.png) |
| Result and recovery | Overview combines time/material estimates, printer state and delivery choices. A quality comparison can trigger re-slicing. Warning example offers a support fix/retry and an override. Preview example distinguishes supports in green. Guide describes a per-bed server time limit and desktop-project escape route; no speed claim is validated. | [Printing](https://help.prusa3d.com/article/easyprint_898029#printing); [10 result/warning](easyprint-ui-research-20261110/10-guide-results-recovery.png), [11 preview](easyprint-ui-research-20261110/11-guide-preview.png) |
| Multiple beds | Guide describes overflow arrangement, creating beds by dragging into empty space, explicit destination selection, active/inactive bed styling, current/all-bed output scope and sliced-state indicators. Settings are shared across beds, with separate output files. | [Multiple beds](https://help.prusa3d.com/article/easyprint_898029#working-with-multiple-beds); [12 plates](easyprint-ui-research-20261110/12-guide-plates.png) |
| Export and project recovery | Output menu example exposes G-code and project download. Guide describes 3MF handoff to desktop, cloud project saving, duplication and a 30-day deleted-project recovery window. No download or cross-device persistence tested. | [Projects](https://help.prusa3d.com/article/easyprint_898029#view-and-download-projects); [13 export/projects](easyprint-ui-research-20261110/13-guide-projects.png) |

## Ranked WebOrca adoption shortlist

These are design recommendations inferred from the cited evidence, not claims about WebOrca's present implementation. Scope is relative implementation size, not an estimate.

| Rank | Candidate | Impact / scope | WebOrca adaptation and tradeoff | Evidence |
|---|---|---|---|---|
| 1 | Compact quality, infill and shell summary with visual explanations | High / medium | Offer a quick surface retaining named profiles, actual values, override visibility and access to full Orca settings. Do not discard custom profiles or silently rewrite expert values. | [Settings source](https://help.prusa3d.com/article/easyprint_898029#adjusting-print-settings), 08 |
| 2 | Explain a detected problem beside an explicit fix/re-slice action | High / medium–large | Preserve expert override, identify affected objects/plates and disclose settings changed by the fix. Warning detection is a separate engine capability; a screenshot does not prove WebOrca already has it. | [Printing source](https://help.prusa3d.com/article/easyprint_898029#printing), 10–11 |
| 3 | Result summary joining estimates, material mapping and output | High / medium | Make download, queue and physical print distinct actions. Include vendor, nozzle, plate scope and stale-slice status; avoid implying readiness from connection alone. | [Printing source](https://help.prusa3d.com/article/easyprint_898029#printing), 09–10 |
| 4 | Explicit active-plate context and current/all-plate action scope | High / medium | Retain per-plate exceptions and visible slice validity. Provide a destination menu as well as spatial drag; avoid accidental plate creation and surprise rearrangement. | [Beds source](https://help.prusa3d.com/article/easyprint_898029#working-with-multiple-beds), 12 |
| 5 | Illustrated support/adhesion choices and touch-accessible explanations | Medium–high / small–medium | Pair illustrations with text and keyboard access; preserve exact support algorithms and parameters for experts. Help must work without hover. | [Supports source](https://help.prusa3d.com/article/easyprint_898029#enabling-supports-and-increased-adhesion), [tooltip source](https://help.prusa3d.com/article/easyprint_898029#tooltips), 07 |
| 6 | Searchable model acquisition plus portable project handoff | Medium / medium | Put local import in immediate reach; repository integrations remain optional and identify upload/storage consequences. Validate Orca 3MF round trips before promising desktop continuity. | [Import source](https://help.prusa3d.com/article/easyprint_898029#model-import-and-upload), [project source](https://help.prusa3d.com/article/easyprint_898029#view-and-download-projects), 05/13 |

## Patterns to avoid copying directly

- Mandatory account/cloud processing would add a dependency to local browser slicing. Treat EasyPrint's documented account and server workflow as product context, not a prerequisite for WebOrca. [Access](https://help.prusa3d.com/article/easyprint_898029#accessing-easyprint), [printing](https://help.prusa3d.com/article/easyprint_898029#printing), 03/11.
- One global settings set across beds can conflict with expert plate-specific needs. Preserve inheritance and overrides explicitly. [Beds](https://help.prusa3d.com/article/easyprint_898029#working-with-multiple-beds), 12.
- A print-labelled action that first slices introduces ambiguity for users who only want a file. Prefer labels that describe the immediate operation and separate machine delivery. [Printing](https://help.prusa3d.com/article/easyprint_898029#printing), 09–10.
- Automatic grouping when objects touch, long-press multi-selection and automatic placement changes need explicit alternatives/undo for precise desktop work. These are documented behaviors, not tested interaction defects. [Groups](https://help.prusa3d.com/article/easyprint_898029#working-with-groups), [orientation](https://help.prusa3d.com/article/easyprint_898029#model-orientation-and-scale), [beds](https://help.prusa3d.com/article/easyprint_898029#working-with-multiple-beds); text evidence.
- Do not conclude EasyPrint is Prusa-only: the current guide explicitly describes third-party printers. Conversely, do not infer universal vendor support, extension availability or mobile LAN parity from that statement. [Printer](https://help.prusa3d.com/article/easyprint_898029#selecting-printer), 06.

## Remaining validation

A future authorized session that clears ordinary site access should verify the actual empty state, local import, mobile transforms, preset changes, plate-specific scope, back/undo persistence, slice progress/cancellation, warning recovery and offline G-code download using a generic test model. Stop before physical print delivery. The present evidence supports design exploration, not a hands-on competitive benchmark.

Screenshots are browser captures stored beside this report; 03–13 capture official documentation and its embedded examples, not an authenticated EasyPrint session. All cited official pages/anchors were read in that browser. No secondary sources used.
