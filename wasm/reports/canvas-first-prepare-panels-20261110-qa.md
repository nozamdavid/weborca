# Panels candidate QA — scoped PASS after followup, 2026-11-10

## Bounded followup disposition

The earlier strict `elementFromPoint(center) === button` requirement was a QA
false positive. Correct gate: `button.contains(hit)` or
`hit.closest('button') === button`, plus an actual pointer click opening the real
action. SVG children are expected. At390 both enabled actions passed that gate
(Edit x30,y300.5,30×30; Manage x62,y300.5,30×30); real clicks opened Manage
Presets and Filament Settings. Escape closed nested dialogs; prior320 parent and
focus restoration evidence below remains valid. No CSS/source workaround.

Same immutable panels candidate, manifest
`9c6ed9a5fa7ae1537319aa63de5a45f3dc1cf20fbeefd48940474c7de150552e`:

- Fresh settled1280×800 and390×844 canvas rects exactly fill viewport at0,0.
  Representative dark390 and light1280 captures retained; earlier1325/320/resize
  passes and main's visual acceptance remain recognized.
- Real desktop numeric Position X input committed native Cube instance offset
  from[150,150,15] to[155,150,15]. Support painting pointer-opened actual Painting
  Tools and Done closed it. No exhaustive geometry/painting acceptance claimed.
- Real canvas pointer drag after Iso changed camera from[-330,-1038,792] to a
  manual orbit, settling at[329.998637,150.000786,1572.961538]. Supports open/Escape
  preserved settled position within floating-point tolerance (<1e-7).
- Actual two-plate batch completed2/2. Objects exposed Download all plate G-code
  ZIP; pointer retrieved202378-byte archive, inspected with unzip:783074-byte
  Plate1 G-code,780283-byte Plate2 G-code and64248-byte provenance.json.
  Cancellation/partial-output preservation uses unchanged historical native
  evidence in simpler-workflow-20261110.md; no new cancel run claimed.

Scoped PASS. Earlier9 tests/tsc/22 locales, native PETG/tree/0.6 slice and780124-byte
download, material search/selection, support/nozzle commit, Quick reset/invalid/
Expert, Undo/Redo, routes/keyboard and resize passes remain recognized. Broader
Full validation, every shortcut/preset combination, physical touch/Safari and
physical send/start remain outside this bounded acceptance. Earlier failures
below are historical findings, not rewritten as passes. Tool selector/role
timeouts during followup were harness targeting errors, not product failures.

Private preview refreshed after scoped PASS. Inspected old pidfile/live32500
quick-final command before replacement. Persistent PID402821 serves SAME panels
candidate on100.105.38.125:5064, log `wasm/build/preview-5064.log`, pidfile
`wasm/build/preview-5064.pid`. Initial launch exited (temporary502); detached
replacement settled HTTPS200 with COOP same-origin, COEP require-corp, no-cache.
Actual https://server-1.barbel-hops.ts.net:5065/ screenshot inspected; canvas-first
390×844 confirmed. Served HTML SHA256 equals candidate index:
`b69453ad92b952cb215cdd5ddab6113e51b7e09a29f638c3e54fb34047fe12d5`.
Stop after checking process identity: `kill $(cat wasm/build/preview-5064.pid)`.
Evidence: `canvas-first-prepare-panels-followup-20261110/` contains dark390,
light1280, private-https-390 PNGs and actual all-plates-gcode.zip.
README and DESIGN updated; Taproot simpler milestone updated with evidence/hash,
version126, completed branches collapsed while preserving completion status.
Own QA5067 server and both owned tabs closed; no temporary dependency link used.
Persistent402821 left running. Documentation whitespace check passed; no tests or
builds repeated for documentation.
No build/source edits, commits/push/PR/main/public5070/Funnel or parent writes.

## Historical initial review (superseded disposition only)

Read both AGENTS files and latest blocked final QA. Viewed authoritative reference
and current desktop/mobile captures with view_image. No source edits.

One integrated build: `wasm/build/ui-canvas-first-prepare-panels-20261110`.
Vite7.89s; native packaging completed. Existing focused tests **9/9 pass**;
TypeScript, all22 locales and git diff --check pass. Frozen logs/full manifest:
`wasm/build/tests-canvas-first-prepare-panels-20261110/`.
Manifest SHA256: `9c6ed9a5fa7ae1537319aa63de5a45f3dc1cf20fbeefd48940474c7de150552e`.
Parent dependencies/engine reused read-only. Candidate/evidence frozen read-only.
Source hashes captured at review end, not before build; source stability throughout
packaging was not established with a prebuild source freeze.

## Requested exact hit-test gate fails; functional panel fixes pass

At320x800 opened Filament, then actual Gear disclosure FIRST. Closed details
descendants can report rectangles without being hit-testable: these are not valid
clipping evidence. With Gear open, enabled Edit rect x30,y315.5,w30,h30; Manage
x62,y315.5,w30,h30. Both fit within panel. Actual pointer Manage opens real Manage
Presets; Escape closes only nested dialog, preserves Filament, restores focus to
manage-filament-btn. Pointer Edit opens real filament editor; Escape preserves
parent and restores edit-filament-btn.

Explicit strict gate `elementFromPoint(center) === button` **fails for both**:
hit is SVG child; `closest('button')` returns the correct action. This is a literal
acceptance mismatch, **not the prior inaccessible-action bug**. Both clicks work.
No source workaround or synthetic CSS test added. Unconditional PASS withheld.

MobileSelect pointer-open/search Generic PETG/pointer-select Generic PETG @System
committed native store and trigger value, preserving parent. Desktop1280 uses
native SELECT; actual Generic PLA @System selection commits and preserves parent.

Tools Plate settings after scroll measures x33,y257,w254,h200 at320. Native
selectors fit x46..227.5 and x46..171.5. By layer selection commits. Top Supports
pointer closes Tools and popup. Existing viewport/camera/plate display fixes remain.

## Independent checks completed after the hit-test finding

- Supports enabled; Tree(auto) pointer-selected, parent retained. Nozzle0.6 input
  committed, summary updated. Native cube added via context-menu primitive. Actual
  final Slice with PETG/tree/0.6:150 layers,25m14s,11.10g, real toolpath Preview.
  Back in Prepare Download G-code exported Cube_PETG_25m14s.gcode, **780124 bytes**.
  Disclosure showed matching Plate1 Current/export/send/Preview. Empty Plate2 showed
  Empty, omitted export/send and main action reverted Slice.
- Quick0.24 committed; reset executed to0.2. Invalid-1 left native config0.2;
  blur restored0.2, pendingOptions empty. Expert chosen via real mode select and
  retained through Quick/Full switching. No asynchronous pending-state assertion
  or complete Full validation pass.
- Mobile Projects Undo settled to objects=[]; Redo after restoration enabled
  restored Cube.obj id51. Preview/Device/Calibration roundtrips returned Prepare.
  Ctrl+O opened accepted-format native chooser, canceled. Ctrl+P opened Preferences.
  K toggled OrthographicCamera then PerspectiveCamera. Ctrl+E toggled showLabels
  true then false, with no duplicate net toggle.
- Resize1325x1100 ->320x800 ->390x844 ->1280x800: canvas exactly viewport at0,0;
  document scroll dimensions matched. All three rail centers hit correct button
  through closest(button). Fresh320 settled320x800; fresh1325 settled1325x1100.
  Fresh390/1280 were sampled while transient startup banners consumed56/42px;
  these samples do not establish settled full viewport acceptance.
- Inspected default1325 and resize320/390 images: neutral stage, solid real dark
  Voron bed, compact dark islands, short rail; no old sidebar/bars. Legitimate
  printer geometry differs from reference. Mobile bed remains visible.
- Tools Top camera pointer works. Measure pointer opens real panel; at320 its
  Close center hits button and actual click closes. Transform/paint entries exist;
  selected-object transform/paint execution remains unaccepted.
- Two populated native plates expose Objects -> Slice all plates with both plate
  states and batch action. Historical completed/partial ZIP and cancel evidence
  remains in simpler-workflow-20261110.md; current archive buttons not exercised.

## Remaining gates and disposition

**NOT ACCEPTED** under literal exact-hit requirement. Functional Filament and Plate
settings fixes pass; no material inaccessible-action regression reproduced at the
correct open-disclosure seam. Remaining checks: settled fresh390/1280, both-theme
matrix, pending/Full validation, selected-object transform/paint, complete shortcut
ownership, orbit preservation, current completed/partial ZIP access. These are
open checks, not alleged bugs. No inherited overall pass or speculative new pass.

Evidence directory `canvas-first-prepare-panels-20261110-qa/` contains:

- `default-1325.png`, `resize-320.png`, `resize-390.png`, `fresh-320.png`
- `filament-gear-open-320.png`, `screenshots.sha256`, `source-at-review.sha256`

Inspected pidfile/live PID32500 identity: quick-final Vite on100.105.38.125:5064.
Left untouched. Private https://server-1.barbel-hops.ts.net:5065/ not refreshed or
claimed verified. No PASS README/DESIGN/Taproot updates, public5070/Funnel/other
routes, physical delivery/start, commits, pushes, PRs, source or parent writes.
Own QA5067 server/tab closed; temporary node_modules link removed.
Changed docs: this report only; new screenshot/hash evidence directory retained.
