# Simpler workflow implementation — 2026-11-10

Implemented on shared `feat/simpler-ui`, base `6773b526d0`. No commit, push,
parent checkout changes, deployment, browser QA, README or Taproot update.
Existing EasyPrint research and screenshots retained.

## Behaviors and files

- `shell/QuickSettings.tsx`, `quickSettingDefinitions.ts`, `workflow.css`: compact
  layer height, infill density, supports and exact brim enum with geometric SVG
  explanations. Desktop Prepare and mobile Process Settings reuse `SettingInput`,
  native definitions/rules, pending options, apply action and reset/modified state.
  Exact process names, full Settings and saved expert mode remain available.
  `settings/SettingInput.tsx` accepts an ID prefix to avoid duplicate input IDs.
- `slicePrerequisites.ts` adds a recovery action mapping without changing existing
  prerequisite order or messages. `ReadinessAction.tsx` expands/focuses desktop
  preset sections or invokes import; mobile opens existing presets/import sheets.
  Engine, busy, restore and slicing statuses have no invented action.
- `PlateScope.tsx`, `plates/resultState.ts`, desktop `PrepareSidebar.tsx` and
  mobile `MobilePrepare.tsx`: active plate name, each plate's empty/current/needs
  slicing state and explicit this/all scope through existing store operations.
  Desktop Slice stays visible after completion; Send is a separate action.
- `engine/types.ts`, `store/appStore.ts`, `plates/platesStore.ts`: generated slice
  results capture selected printer, nozzle, material names and configuration.
  Existing invalidation clears the result and its provenance together.
- `preview/OutputReview.tsx`, `SliceStatsPanel.tsx/.css`, `MobilePreview.tsx`:
  plate, captured selections, existing time formatter and actual grams accompany
  output controls. Unknown imported provenance is labelled unavailable. Filament
  breakdown uses captured metadata rather than changed live settings. Desktop
  and mobile output controls require matching retained plate output. Existing
  Send dialog retains Upload and explicit upload/start confirmation.
- `mobile/MobileShell.tsx` exports its existing menu for readiness recovery;
  `MobileProcessSettings.tsx` includes quick controls. English and Spanish strings
  follow existing catalog fallback conventions.

## Verification

- `node --test wasm/tests/node/quick-settings.test.mjs wasm/tests/node/modified-settings.test.mjs`: **6 passed**.
  Covers exact native mappings, every shared prerequisite blocker, nonactionable
  engine/busy states, retained/mismatched/empty output, and real `SettingInput`
  rendering with a pending value, custom overrides, modified/reset state and
  native min/max validation. External store/engine boundaries are stubbed only
  for that input render. No source-regex assertions.
- `npx tsc --noEmit`: passed (affected TypeScript/TSX compilation).
- `npm run check:locales`: all 22 catalogs passed.
- `git diff --check`: passed.
- Impeccable detect ran once on ten touched UI targets: no findings. Static
  regex scan only; rendered contrast, text size and layout were not evaluated.
- One integrated build, Vite phase **8.77s**, native packaging completed. Existing
  large-chunk warning remains. Read-only native/dependency inputs reused.

## Immutable QA candidate

`wasm/build/ui-simpler-workflow-20261110` (121 MB), generated once with:

```sh
cd wasm/app
ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine npx vite build --outDir ../build/ui-simpler-workflow-20261110
```

Evidence: `wasm/build/tests-simpler-workflow-20261110/` contains build, compile,
locale, tests and detector logs plus `candidate.sha256`. Manifest SHA-256:
`c779c6aefdb40a7f38dd2259ea9e9efb3340c9214561b5fca32cf0be533f2cac`.
Candidate and evidence files frozen read-only after hashing. Temporary
`wasm/app/node_modules` symlink removed. Preview PID 450690 on 5064 was preserved;
no listener or HTTPS/Tailscale configuration changed.

## QA handoff and limitations

Browser verification is **pending**, with no browser pass claimed. Reuse this
candidate for desktop/mobile, en/es and dark/light checks, keyboard focus after
collapsed-section recovery, input edits/reset and pending feedback, narrow layout,
native import/slice, cancellation, all-plate sequencing, changed-setting output
invalidation, plate switching and Send confirmation/capability checks.

The store retains one result, not a per-plate result cache. Therefore only that
retained result's plate can be Current; switching plates invalidates it. Slice all
retains its final output under the existing store semantics. No historical
provenance is fabricated for opened G-code. Physical printers, assistive technology,
touch/Safari behavior and rendered overflow/contrast remain unverified. Research
references describe documentation-backed EasyPrint behavior, not live app evidence.

## Review fix: completed batch output — 2026-11-10

This section supersedes the single-output Slice all limitation above. Slice all
now retains each completed target's G-code bytes and provenance captured before
its slice, without retaining per-plate preview geometry. One explicit download
produces `all-plates-gcode.zip`, or `partial-completed-plates-gcode.zip` when
cancellation/failure leaves fewer completed outputs than nonempty target plates.
Each completed plate is labelled Included in ZIP separately from the active
result's Current/Needs slicing state. The archive includes `provenance.json` and
numbered, sanitized, distinct G-code filenames. Empty plates are excluded.

Only the current batch is retained: a new batch replaces it. Existing model,
history and settings invalidation clears the batch; direct model/config/preset
state changes also clear it. Plate structural/config actions invalidate it.
Switching the active plate preserves the batch but clears an incompatible active
preview. Intermediate sequential slice state updates do not invalidate it.
An invalidation revision rejects a late plate result after a model/config edit.
Cancellation/failure preserves completed batch bytes, with a partial label;
active-plate export still requires the sole matching retained result.

Focused regression: `wasm/tests/node/plate-batch-output.test.mjs` first failed
because the missing batch export implementation could not bundle, then passed.
It checks two distinct ZIP entries and their original bytes, partial archives,
the real plates store's sequential success, captured printer provenance,
cancellation/failure retaining the first output, and invalidation during a run.
Engine/app boundaries are stubbed for this Node test; no real native slice or
browser acceptance is claimed by these tests.

Verification: batch + quick-settings + modified-settings: **8 passed**;
`npx tsc --noEmit` passed for the full app including the main agent's desktop
filament/mobile Cancel changes; `npm run check:locales` passed all 22 catalogs;
`git diff --check` passed. Impeccable detector: zero findings on PlateScope.
Browser QA remains on original immutable candidate5067; no browser/server was
touched. No README, Taproot, commits, pushes or deployment.

New integrated candidate: `wasm/build/ui-simpler-workflow-fixed-20261110`.
Build used the same command/native inputs as above with this new outDir, Vite
8.74s, native packaging successful, existing chunk-size warning only.
`wasm/build/tests-simpler-workflow-fixed-20261110/` holds tests, compile, locales,
detector, build log and candidate SHA-256 manifest. An initial attempt stopped
before compilation because the shared temporary dependency link had disappeared;
its separate log is retained. The link was restored for the successful build
and removed afterward. Candidate files are frozen read-only.
Manifest SHA-256: `b82bd1225fc89f69da9a0b442fc1185ccbe9b78a207146a54021cf660a20ab33`.

## independentQA — original frozen candidate, 2026-11-10

Independent browser acceptance used only `ui-simpler-workflow-20261110` on owned
Vite preview port 5067. Manifest hash matched
`c779c6aefdb40a7f38dd2259ea9e9efb3340c9214561b5fca32cf0be533f2cac`;
`sha256sum -c` completed successfully. No build, source refresh, implementation,
README or Taproot changes. Later source corrections announced during QA were
not served or tested. Native engine initialized, `crossOriginIsolated === true`.

### Passed with concrete runtime evidence

- Desktop 1280×800: actual quick-input edits reached currentConfig and native
  G-code: `layer_height = 0.24`, `sparse_infill_density = 23%`,
  `enable_support = 1`, `brim_type = outer_only`. Pending brim state was observed
  before native completion, then cleared. Orange modified markers and reset
  controls appeared. Exact process name and original full settings remained.
  Geometric layer/infill/support/brim descriptions were sensible on visual inspection.
- Generated a closed 10 mm cube File and imported through the real app's
  `importModelFile`, then clicked actual Slice Plate 1. Native output: 146084
  bytes, 42 layers, 202.5769 seconds, 0.8297367 g. G-code footer and visible review
  agreed at 3m 22s / 0.83 g. Native preview initialized and showed 42 layers.
  Captured provenance contained Voron 2.4 300 0.4 nozzle, nozzle 0.4, Generic
  PLA @System, and the edited configuration. Export and Send were separate;
  explanatory copy explicitly required confirmation to start. No delivery action ran.
- Desktop collapsed printer/process recovery expanded their real sections and
  focused `printer-select` / `process-select`. Missing selections were injected
  via the exposed store to isolate recovery, not by altering the candidate.
- Mobile 390×844 dark English preview showed the same output review, separate
  export/send, and no document horizontal overflow. Mobile 320×700 dark Spanish
  Prepare and Process Settings sheet had no document horizontal overflow and
  exposed all four quick controls plus Basic/Advanced/Expert access.
- Mobile missing-printer recovery opened existing Menu & presets sheet with
  printer/filament/process controls; focus landed on Close. Busy-state injection
  exposed no bogus prerequisite recovery action. Main Slicing button was disabled,
  but the existing progress area provided a separate enabled Cancel button.
- Two actual cube plates were populated using native import; Slice all invoked
  existing sequencing and completed with retained result `plateIndex: 1`.
  Active second plate was Current; first was Needs slicing. Switching to first
  cleared the retained result and removed Export/Send controls.
- Opening generated G-code through real `openGcodeFile` produced a native preview
  whose review explicitly read “Printer and material metadata unavailable for this
  G-code.” It did not borrow the live Voron/PLA selection.
- 1440×900 desktop preview had no document overflow. Plate names, object labels,
  active/inactive plate decorations and native preview remained present.

### Findings against this original candidate

1. **FAIL — empty filament recovery has no picker.** Set `selectedFilaments: []`,
   `selectedFilament: ''` with model/printer/process present, collapse filament,
   click Choose filament. Section expands but `filament-select` does not exist;
   focus remains on prior printer selector. Parent reports source fix underway;
   correction is unverified here.
2. **FAIL — all-plate retention limitation is unexplained.** With populated Plate 1
   and QA second, click Slice all plates. Only QA second output remains; Prepare
   calls Plate 1 Needs slicing. Neither scope nor output review explains that
   first output was discarded or that only final output can be downloaded.
   Parent reports replacement ZIP retention underway; unverified here.
3. **Observation — validation feedback is delayed.** Type `-1` in quick layer
   height and Tab. `currentConfig.layer_height` becomes `-1`, pending clears,
   native input `checkValidity()` is false (“Value must be greater than or equal
   to 0.”), with no immediate inline alert. Later a native conflict dialog recommends
   0.2. Reset restores preset 0.2. This establishes transient invalid committed
   state, not missing native validation or a successful invalid slice.
4. **Localization gaps:** Spanish quick sheet includes English “Supports”,
   “Settings mode”, “Basic”, and brim choice “Outer brim only”; mobile Add model
   and Menu also remain English. Some are existing catalog fallbacks; no blanket
   Spanish acceptance is claimed.

### Screenshot evidence

Paths under `/home/david/.t3/userdata/browser-artifacts/`:

- `browser-screenshot-localhost-mwb1im5a-d0c0588f.png`: 1280 light edited quick settings, cube and scope.
- `browser-screenshot-localhost-mwb1iydv-ccb3bbb4.png`: successful native preview/output.
- `browser-screenshot-localhost-mwb1j7cr-156fdc67.png`: 1440 desktop preview.
- `browser-screenshot-localhost-mwb1jdak-065c1960.png`: 390 dark mobile preview.
- `browser-screenshot-localhost-mwb1jhmv-0851e5aa.png`: 320 Spanish dark Prepare.
- `browser-screenshot-localhost-mwb1joql-59d5df8b.png`: 320 Spanish quick settings sheet.
- `browser-screenshot-localhost-mwb1kfb2-4f92da3a.png`: final-only two-plate output.
- `browser-screenshot-localhost-mwb1ksqv-9764ac9d.png`: missing filament recovery.
- `browser-screenshot-localhost-mwb1l773-6a88aa0f.png`: negative layer input.
- `browser-screenshot-localhost-mwb1ljb6-56801302.png`: unknown imported provenance and delayed native conflict.
- `browser-screenshot-localhost-mwb1lqa6-5b6efe48.png`: mobile busy state with separate Cancel.

### Limits

This is partial acceptance with concrete failures, not a full matrix pass. Real
in-flight cancellation timing, custom saved process creation, every reset, mobile
filament/process recovery, import chooser activation, mismatched-result injection,
provenance under later live selection changes, detailed keyboard traversal and
contrast were not exhaustively tested. No printer send/start or account action.
The negative input check was stopped before attempting an invalid native slice.
Browser harness used exposed stores only for stated prerequisites/busy states;
actual model import, slicing, settings edits and G-code opening used real app paths.

## Scoped QA corrections and final candidate — 2026-11-10

- `settings/SettingInput.tsx`, `settings/numericValidation.ts`,
  `shell/QuickSettings.tsx`, `shell/workflow.css`: Quick settings opt into strict
  finite scalar numeric/int/percent checks against actual definition min/max
  before calling the existing apply action. Invalid values remain local drafts
  with localized inline error, aria-invalid and aria-describedby. Empty typing
  stays a draft; blur discards the draft and reset uses the existing preset action.
  Pending, modified and valid custom values retain their existing paths. Full
  expert inputs retain their existing editing semantics. Native validation still
  owns relationships beyond basic ranges. Enum labels now pass through `t` while
  their native option values remain unchanged.
- `shell/ReadinessAction.tsx`: an open mobile recovery sheet captures its opening
  action independently of transient prerequisite reasons. Busy states therefore
  keep the sheet mounted; explicit close clears it. Close focuses the recovery
  trigger when present, falling back to the mobile Menu control when absent.
  Browser focus/lifecycle verification remains pending.
- `locales/en.json`, `locales/es.json`: exact Supports, Settings mode, Basic,
  Add model, Menu and numeric error strings added; existing brim translations
  now render through the translated enum label.
- Included the main agent's final archive corrections: `platesStore.slicePlate`
  captures merged currentConfig and target plate.config provenance; `sliceAll`
  reserves stable batch ownership before awaiting fetchPlates and checks identity
  afterward. The updated batch regression checks distinct per-plate layer heights
  and overlapping deferred-fetch ownership with both outputs retained.

Verification on final source: quick + batch + modified tests **9 passed**;
`npx tsc --noEmit` passed; `npm run check:locales` passed all 22 catalogs;
`git diff --check` passed. The added quick-settings regression exercises the actual
numeric commit seam for negative, nonfinite, over-max, fractional-int, empty and
intermediate invalid values (no commit), plus valid float and percent commits.
Impeccable detector returned zero findings on the four changed UI targets.
No new recovery lifecycle test was added: actual focus and sheet behavior require
the later browser QA rather than a synthetic DOM mock.

One integrated immutable candidate was built after all fixes:
`wasm/build/ui-simpler-workflow-validated-20261110`, using the command above with
that outDir and the same read-only native/dependency inputs. Vite **8.38s**;
native assets packaged successfully; existing chunk-size warning only.
Evidence: `wasm/build/tests-simpler-workflow-validated-20261110/` contains tests,
compile, locales, detector, diff, build log and `candidate.sha256`.
Manifest SHA-256:
`92f017ec7b8df4e3803a53a8c0b632d4901913869e62b8c36826c65a0bcfc13d`.
Candidate and evidence frozen read-only; temporary dependency link removed.
Historical browser QA failures above remain failures against the original
candidate. No browser acceptance is claimed for this replacement candidate.
No browser/server refresh, README, Taproot, commit, push or PR actions performed.

## finalQA — validated frozen candidate, 2026-11-10

Representative browser acceptance **PASS**, with the limits below. No source edits,
rebuilds or test-suite repeats. Manifest verified as
`92f017ec7b8df4e3803a53a8c0b632d4901913869e62b8c36826c65a0bcfc13d`;
all candidate files passed sha256sum -c. Prior 9 focused tests, TypeScript and
22-catalog checks remain the source verification evidence.

- Owned browser tab and Vite5067 served the immutable validated directory through
  the parent's read-only Vite config/dependencies. Native engine ready and
  crossOriginIsolated true. No dependency symlink was needed.
- Negative layer -1, infill 101%, and nonfinite NaN remained drafts, aria-invalid
  true with an existing error description ID, unchanged currentConfig and empty
  pendingOptions. Tab discarded invalid infill back to 23%. Valid 0.24, 23%,
  support 1 and outer_only reached native G-code. Modified controls stayed visible;
  reset eventually restored layer 0.2 (the immediate async store read still showed
  0.25; the settled screenshot shows 0.2). Custom 0.25 survived unrelated edits.
- Injected missing desktop printer/process with collapsed sections focused
  printer-select/process-select. Empty filament recovery focused the new populated
  filament-select; keyboard input/Enter and explicit native select selected PLA.
  Mobile printer, filament and process recovery sheets remained mounted through
  injected isSelectingPreset busy state, then closed to Menu focus. Busy state
  supplied no invented recovery action. Add model opened the real file chooser;
  canceled chooser without importing an unrelated file.
- Actual generated closed 10mm STL cube imported using importModelFile and sliced
  natively. First output 146591 bytes, 42 layers, 202.58 seconds, 0.83g. Preview
  review showed 3m22s, captured Voron 2.4 300, nozzle0.4 and Generic PLA. Download
  and Send were separate, with explicit start-requires-confirmation copy. No send
  or start operation executed. Opening generated bytes via openGcodeFile labelled
  printer/material metadata unavailable. Later plate switch cleared retained output.
- TWO populated native plates sliced successfully. Plate 1 output 146591 bytes,
  layer0.24; QA second 132777 bytes, layer0.28. Native setPlateConfig supplied the
  second override; both G-code footers matched captured provenance. Actual downloaded
  all-plates-gcode.zip (51721 bytes) unzipped into distinct numbered Gcodes and
  provenance.json with both configurations. Included in ZIP was distinct from
  Current/Needs slicing. No populated output disappeared.
- Actual uncached second slice (layer0.12) canceled by clicking the rendered mobile
  Cancel during `Slicing Plate 2...`, scheduled from real store notification. No
  AbortError injection. Batch stopped, running false, one output retained. Actual
  partial-completed-plates-gcode.zip (29779 bytes) unzipped into only completed
  Plate1 G-code plus provenance.json. UI said 1/2, partial completed plates only;
  incompatible active Export was disabled. A later actual layer edit cleared batch
  and result. A cached retry completed before Cancel could render; it was retried
  with the same immutable build and uncached native settings.
- Desktop1280/1440 light and mobile390/320 dark, English/Spanish sampled. No
  document horizontal overflow. Spanish quick help, Supports, mode and brim labels
  translated; full settings and expert access remained. Camera controls, object
  names, plate titles and Active/Inactive badges remained in the native scene.

Screenshots under `/home/david/.t3/userdata/browser-artifacts/`:
`browser-screenshot-localhost-mwb1vcxa-b415f900.png` (390 completed batch),
`browser-screenshot-localhost-mwb1wrbx-eaea2117.png` (320 Spanish dark quick sheet),
`browser-screenshot-localhost-mwb1xolv-748215e3.png` (1440 light native two-plate scene).
Actual ZIP downloads remain under server-browser/downloads, directory
`0b0ff370ad7040f9fddb9bf4162b1f7681f26af8b138f8ce453c91959379a531`,
files `6464bb5c-08be-4a7d-88b5-b392a8b50822` (complete) and
`0b1429c7-f449-40bc-a7c2-c8a3bfa09fe1` (partial).

Limits: representative acceptance, not a complete combinatorial matrix. No physical
printer, real send/start, unsupported engine, mobile Safari, touch or assistive
technology claim. Missing prerequisite and busy states were explicitly injected;
imports, slices, overrides, ZIP downloads and cancellation used actual app/native
paths. Initial resize logged a transient preview-not-initialized error followed by
successful G-code loading. No sustained rendering failure observed. Saved custom
preset creation and exhaustive pending/reset timing were not separately exercised.

After acceptance, verified old pidfile450690 and process command before replacing.
Private persistent PID **4089101**, pidfile `wasm/build/preview-5064.pid`, log
`wasm/build/preview-5064.log`, serves the validated candidate. Settled HTTPS200;
HTML SHA256 `ce8727f9a0d270f721e83e7848989f2963f51dafab9ff543d97e6cf2c93faea8`
and entry bytes match candidate. COOP same-origin/COEP require-corp retained.
Existing Tailscale routes unchanged. URL https://server-1.barbel-hops.ts.net:5065/ .
Stop with `kill $(cat wasm/build/preview-5064.pid)` after checking process identity.
Own QA tab/server5067 closed; persistent5064 left running. No public/Funnel5070,
main promotion, commit, push, PR5 edit, rebase or merge.

Tracking updated: README local milestone and Taproot completed simpler workflow
branch `pUAFlqRw0lVwbC` with two completed evidence nodes. Taproot version124
collapsed the completed branch; recursive scan preserved all done statuses.
README/report links and stop command paths checked; doc whitespace check passed.
Persistent entry SHA256
`5af8897ec2ba217640c8a6e9c2283647cd994d95a3499574279a668c8a568a63`.

## Quick-default hierarchy correction — 2026-11-10

The private5065 diagnosis established that the delivered validated build still
rendered a 3712px desktop sidebar in a 607px viewport. Earlier representative QA
above did not establish that the default hierarchy was simpler. This correction
addresses that source-visible failure; historical QA remains unchanged.

Before: desktop printer/material/process selectors and preset management, Quick
settings, duplicate support/brim QuickToggles, Objects, then the entire full
SettingsPanel rendered together. Mobile Quick settings required Prepare → Settings.
Every plate footer repeated the active plate in the complete plate list and showed
Slice all even for one plate.

After: desktop starts with printer/material/process selection, Quick settings,
Objects, and the existing fixed context/Slice footer. Preset Edit/Save/Manage/Delete
remain inside keyboard-operable native details disclosures. The explicit localized
Full settings / Quick settings button switches the editor view. Full settings
retains the existing QuickToggles (including prime tower, ironing, flushing and
Modified) and entire SettingsPanel. The view is local React state, default false;
it never calls a store configuration, preset, pending-option or settings-mode
setter. The newly displayed editor receives focus after the render; the preceding
view toggle remains reachable by Shift+Tab. Readiness targets stay outside this
view and retain their existing expand-then-animation-frame focus behavior.

Mobile Prepare renders QuickSettings directly below process context as a compact
two-column, four-control grid; the full sheet no longer duplicates QuickSettings.
Full settings opens the existing full editor sheet. Existing model tools, viewport,
import, and top/bottom Slice routes remain. Single-plate footer shows current name
and result status; multiple populated plates or an existing batch expose a native
batch disclosure. Existing complete/partial ZIP status and downloads stay outside
that disclosure, including a single retained partial output. No engine, setting
semantics, provenance or batch validity changes were made.

Changed implementation files: shell/PrepareSidebar.tsx, shell/QuickSettings.tsx,
shell/PlateScope.tsx, shell/workflow.css, mobile/MobilePrepare.tsx,
mobile/MobileProcessSettings.tsx, locales/en.json and locales/es.json.

Verification: existing quick/batch/modified regressions **9 passed**; TypeScript
compile passed; all 22 locale catalogs passed; diff whitespace passed; finalUI
Impeccable detector **zero findings**. No new helper logic or synthetic JSX-count
tests were added. No browser QA or rendered size/focus acceptance is claimed;
320/390px and keyboard behavior require independent QA of this candidate.

One integrated build targets `wasm/build/ui-simpler-workflow-quick-default-20261110`.
Logs, finalUI detector and candidate SHA-256 manifest are in
`wasm/build/tests-simpler-workflow-quick-default-20261110/`. Existing preview5064 /
HTTPS5065 PID4089101 remains untouched. No README, Taproot, commit, push, PR, main
promotion or parent-owned files were changed. The temporary dependency symlink
is removed after packaging; candidate and evidence are frozen read-only.

Packaging completed successfully (Vite 8.11s, existing chunk-size warning).
Manifest SHA-256:
`b2f63730585e6067f33aa59a737b466f9a8c190569482a85446062ce482a61dd`.
Candidate/evidence frozen read-only and dependency link removed.

## Independent quick-default visible acceptance — 2026-11-10 — BLOCKED

Candidate: `wasm/build/ui-simpler-workflow-quick-default-20261110`, manifest
`b2f63730585e6067f33aa59a737b466f9a8c190569482a85446062ce482a61dd`.
No source edits or rebuild. QA used its own localhost5067 Vite preview with the
existing parent config/dependencies and owned browser tab.

Visible blocker: at 320×740, Spanish/dark Prepare, the native Adhesion control
renders “Automático” as “Automátic” followed by “o” on the next line. This is an
actual screenshot readability failure in the new four-control grid, with ordinary
100% font scale. Reproduction: Prepare → scroll to Ajustes rápidos → Adherencia,
with default Auto brim. Screenshot:
`/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwb2j94x-cda8bec0.png`.
No patch or private-preview refresh performed after this blocker.

Checks completed before blocking:
- Existing selected Voron 2.4 300 / Generic PLA / 0.20mm Standard context opens
  desktop Quick by default. At 1280×800 the sidebar scroll content is 811px in a
  667px viewport; controls span y389–647.5, all inside the initial viewport.
  Full SettingsPanel is absent. This establishes a noticeable hierarchy change
  compared with the historical 3712px content. Screenshot:
  `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwb2g8nu-8e06aa28.png`.
- Desktop1440×900 valid layer edit 0.24 survives Full → Quick, and Full receives
  focus in prepare-settings-view. Invalid -2 reverts to 0.24; reset restores 0.2.
  Setting expert mode through the exposed store and switching Full → Quick keeps
  expert mode. Preset selection remains unchanged. Quick has four native IDs and
  no duplicate support/brim toggle set.
- Desktop missing prerequisites injected through the exposed store with collapsed
  sections: Choose printer/filament/process expand their matching sections and
  focus printer-select/filament-select/process-select. Empty filament select shows
  the localized placeholder, value empty. Original selections restored afterward.
- Mobile390×844 renders Quick inline without opening a sheet. Initial controls
  start at y680.8; Supports/Adhesion at y784.8 lie behind/below bottom navigation,
  requiring a short scroll. Full settings sheet opens, contains no duplicate
  Quick controls or duplicate IDs, and fits320px without document overflow.
  At320 after scrolling, all Quick controls and Slice are reachable together.
- Native generated closed10mm STL imported through importModelFile; actual
  Slice Plate1 completed, 50 layers, 3m41s, 0.71g. Output review shows selected
  printer/material and distinct Export/Send actions plus confirmation copy.
  Spanish320 dark screenshot:
  `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwb2if8b-5137ecd5.png`.
- Document width equals viewport at1280,390,320; HTML title OrcaSlicer Web and
  object label qa-cube.stl retained.

Limits: acceptance stopped on the visible320px copy defect. Fresh preference
reload, keyboard activation of preset management, custom override expert-mode
roundtrip, and batch availability smoke were not fully completed. Prior native
complete/partial two-plate ZIP/cancel evidence above remains historical evidence.
This candidate is not accepted for private refresh. README and Taproot were not
advanced. Existing persistent PID4089101 and private5064/HTTPS5065 remain unchanged;
stop only after checking identity: `kill $(cat wasm/build/preview-5064.pid)`.
Own QA server5067 and tab closed. No temporary dependency symlink was created.

## Quick-final visible acceptance — 2026-11-10

Representative final acceptance PASS. This supersedes the quick-default blocked
candidate, and does not change historical results. Main agent's source changes
are QuickSettings wrapper `data-setting` and workflow.css: mobile brim spans both
columns; selected labels use nowrap, overflow hidden and ellipsis. QA made no
source edits or new tests.

One new integrated build: `wasm/build/ui-simpler-workflow-quick-final-20261110`.
Read-only parent dependencies and ORCA_ENGINE_DIR reused as documented above.
Vite 7.01s, native packaging successful; existing chunk-size warning only.
`wasm/build/tests-simpler-workflow-quick-final-20261110/` contains logs and frozen
candidate.sha256. Manifest SHA256:
`9417320f940082fd8d7101f7c5d72a5a091dbfcee1135ce263da2373371e5209`.
All 9 existing quick/batch/modified tests passed, tsc --noEmit passed, all 22
locale catalogs passed, git diff --check passed. Candidate/evidence frozen
read-only; temporary dependency symlink removed.

- 320×740 Spanish dark: Automático is fully visible on one line. Actual
  outer_and_inner selection shows “Borde de adherencia exterior e interior” in
  the choice dialog; selected text is one 19px line, 226px client width versus
  273px scroll width, with computed nowrap/ellipsis. No document overflow (320px).
  Adhesion occupies the full 296px content width; no overlap. All four controls
  and Slice are reachable together after scrolling. Screenshot
  `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwb2r5wi-458e329b.png`
  shows settled Auto and Slice; long selection screenshot
  `browser-screenshot-localhost-mwb2mur1-08a147cf.png` in the same directory.
- 390×844 Full settings sheet contains no Quick section and no duplicate IDs.
  Quick remains inline in Prepare. Existing preferences open Quick by default;
  a separate fresh incognito profile and reload open the setup wizard as expected,
  then Quick after Cancel, with full panel absent and background interactive.
- Desktop1280 initial Quick controls occupy y347.5–647.5 on the actual HTTPS URL;
  full SettingsPanel absent. 1440 also fits without horizontal overflow. Full →
  Quick preserves actual native layer override0.25 and Expert mode; focus returns
  to prepare-settings-view. Enter opens the native preset disclosure, and Enter
  on Manage opens the actual preset-management dialog. Injected missing printer,
  filament and process each recover focus to their matching native select.
- Negative layer -2 remains aria-invalid draft while config stays0.25. Valid0.24
  commits; reset settles at0.2. A generated closed10mm STL imported via real
  importModelFile and native startSlice produced123634 bytes,42 layers,
  187.5299 seconds,0.71434g. Review shows3m7s/0.71g with Voron300/nozzle0.4/PLA
  captured provenance and separate export/send confirmation copy. Screenshot
  `browser-screenshot-localhost-mwb2ps4o-4e2a7f9e.png`.
- Compact batch availability smoke injected this real native result into completed
  and partial batch states (one retained output, totals1 and2). With disclosure
  closed, both correctly named ZIP downloads remain enabled and visible. Both
  downloaded24751-byte archives pass unzip -t with Gcode and provenance.json.
  Downloads under server-browser/downloads/ae6e56c5f9539da4282706b2dc6b19c682d5745947b8438b43a03375695011ac:
  ecbd56f2-34d9-46b4-ba21-835de6dc99a1 (partial),
  3481e5ac-8194-4a46-b5bf-2731d8f116e8 (complete).
  Prior finalQA actual two-plate ZIP and native cancellation evidence is reused;
  this smoke does not claim another real multi-plate/cancel run.
- Object/plate names and camera controls remain visible. Screenshot
  `browser-screenshot-localhost-mwb2qgsg-66d7c714.png` shows desktop scene.

After checking old PID4089101 and its pidfile/command, refreshed private5064.
Current persistent PID **32500**, pidfile `wasm/build/preview-5064.pid`, log
`wasm/build/preview-5064.log`, command targets the immutable quick-final directory.
Verified https://server-1.barbel-hops.ts.net:5065/ actually renders Quick default
at1280 and inline mobile at320. HTTPS200, no-cache, COOP same-origin and COEP
require-corp. Served HTML SHA256
`33172de0c66033ed800991e91f97d7a2cc6a017ae72aa136916abf78959f6df8`;
entry assets/index-C4E7cX8I.js SHA256
`85533e8a12fd4da4ffa5c82ce2426fd1f96d9bf203ec6e06f3d31eaaa9261f2c`;
both match candidate bytes. Headers and served HTML saved in wasm/build/quick-final-*.
Stop after checking identity: `kill $(cat wasm/build/preview-5064.pid)`.
No Tailscale route changes, Funnel/public5070, main/shipped claim, commit/push
or PR5 changes. Own QA tabs/server5067 closed. Persistent32500 left running.

Limits: representative browser coverage; no physical printer/send/start, Safari,
touch or assistive technology claim. Prerequisites and batch availability use
explicit store injection; native import/slice and downloads use real app paths.
An early programmatic overlapping-dialog sequence left the first QA tab inert;
that harness sequence was discarded. A clean existing-preference tab and fresh
profile passed keyboard interaction; no product inertness acceptance is inferred
from the discarded sequence. Fresh wizard completion/saved custom preset creation
were not exercised; actual custom configuration override roundtrip was exercised.
