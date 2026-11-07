# Orca Web design system

The [background engine publication](../build/tests-background-engine-20261107/report.md)
is current on CURRENT5070. Engine download/initialization uses an in-flow status
and actionable retry. Navigation, Preferences and camera controls remain available;
native model/import/configuration operations and every Slice control wait for
actual readiness. Add printer/configuration discovers and session-caches the
vendor directory; startup keeps the current printer's vendor dependencies.
Older ambiguous saved names retain the compatibility resolver described in the
report. First-run configuration, auth cancellation and forced recovery are verified.

The visual and interaction rules for the browser build of OrcaSlicer (`wasm/app`). Desktop OrcaSlicer is the reference for *what* the app does and how it looks; this document says how that translates to the web, on a desktop browser and on a phone.

CURRENT5070 serves immutable `ui-background-engine-release-20261107` with the alpha gate and sampled bug/engine repairs enabled. The [alpha publication](../build/tests-alpha-access-20261106/publication/report.md) records the compatible frozen server, durable private state, public HTTPS login/revocation, desktop/mobile native slice/Preview and rollback. The [polish publication](../build/tests-app-polish-20261106/publication/report.md) binds the verified r11 UI, all 1059 retained current non-UI files, public/browser checks and rollback. Optional OctoEverywhere client code ships, but the backend remains unconfigured/unavailable without a production App ID; the new frozen alpha-compatible server preserves the four providers and HTTP201 behavior. Device labels cached values as saved readings and preserves their receive timestamp during errors and pause. Returning to Device/focus waits until the last successful snapshot reaches 15 seconds; manual Retry is immediate and healthy monitoring stays connected. Actual document focus includes the embedded Web UI. Desktop status/Web UI width supports drag, bounded keyboard controls and persistence; mobile keeps its stacked layout. Four read-only extruder cards retain validated physical tool pairing and neutral unknown/empty states; bed and CFS/MMU inventory remain separate. The [current publication](../build/tests-settings-routing-batch/publication/report.md) and [sealed QA](../build/tests-settings-routing-batch/qa-corrected/report.md) establish Chromium synthetic acceptance, including actual browser focus. Remote Snapmaker root cause remains unproven; physical Mac/Safari/Firefox/hardware and unload/reassignment/job lifetime remain open. Historical real Snapmaker telemetry/material confirmation is separate. Restart clears OrcaCloud RAM sign-in; browser presets remain.

User presets expose parent inheritance and preserve inherited values on overwrite, including numeric normalization in the native engine. Save prefills the current name and labels an existing user target as Overwrite Preset; system names stay protected. Process tabs stay on one row and scroll the selected tab into view. Desktop help pairs native metadata descriptions with wiki links; mobile hides these help links. Modified-setting columns align, filament modals use the shared body/action spacing, and Edit 3D Text has one heading icon. Filament rows omit Save; desktop uses its existing slice action while mobile retains Slice plate. Printer connections use the app server only, with no local gateway address/discovery/download flow; static hosting needs a compatible backend.

The selected-object panel remains at the bottom right inside the viewer with action-bar clearance. It starts expanded and collapses to a 44px header containing the object name, ID/selection count and native header toggle. Expansion restores size, transforms, proportions and mesh health controls. Collapse state survives object selection changes; the header stays reachable while the body scrolls in short viewers. Mobile keeps the panel hidden and Move/Scale numeric controls outside the viewer. See the [panel evidence](../build/tests-selection-panel-collapse/publication/report.md).

Selected webpage text retains priority for Copy even while an object is selected. Without text selection, native object Copy still works; inputs, textareas and contenteditable fields keep native shortcuts. The [Device publication](../build/tests-device-refresh-resize/publication/report.md) retains public Chromium pointer selection/native paste and object Copy/Paste/Undo checks; the current sealed QA also checks built Copy behavior. The [prior Copy publication](../build/tests-text-copy-priority/publication/report.md) and [sealed Copy QA](../build/tests-text-copy-priority/qa/report.md) retain implementation evidence. Linux Meta verifies event behavior; physical Mac Command+C remains unverified.

Retained Objects fits contents (131–142px desktop empty), with tree caps260px desktop/240px mobile; long overrides remain reachable through the outer scroll. Clicking or dragging a model restores viewer focus after editing. Built-in Handy imports skip only automatic simplification, retaining original geometry; normal uploads and manual Simplify remain functional. Desktop completed-slice results sit below camera buttons. The [prior publication report](../build/tests-objects-clipboard-handy/publication/report.md) and [sealed r2 QA](../build/tests-objects-clipboard-handy/qa-r2/report.md) retain that acceptance and reconstructed UI baseline provenance. Physical Mac/Safari and Firefox remain unverified.

Retained Prusa rich assigned materials/current-poll REST fallback and Creality CFS/rack inventory remain **SYNTHETIC_ONLY**. The [prior publication report](../build/tests-connected-filaments/publication/report.md) records 72 integrated en/es layouts across both themes, 320/390/1280px and 100/125% text, plus retained native lighting persistence. Real Prusa OAuth/physical MMU, Creality hardware and unload/reassignment acceptance remain open.

The published Snapmaker Device display shows printer-reported material/vendor/subtype/color/presence by physical tool index. Sparse indices retain their tool labels; only explicit true means present, false means empty, and missing/invalid presence stays unknown. Long labels wrap and black swatches remain visible on both themes. This is read-only `filamentSlots`, with no project sync or controls. Actual idle four-tool comparison passed; physical unload/reassignment and job lifetime remain open. See [sealed layouts and reconstructed lighting/desktop provenance](../build/tests-snapmaker-filaments/qa-recovered/report.md) and [prior publication evidence](../build/tests-snapmaker-filaments/publication/report.md).

## Local app polish — 2026-11-06

The immutable [r11 candidate](../build/ui-app-polish-candidate-20261106-r11/) supplied the UI previously published in [ui-app-polish-release-20261106](../build/ui-app-polish-release-20261106/), retaining the current compatible backend and native assets. The [integrated report](../build/tests-app-polish-20261106/integrated.md) supersedes the pending integrated-QA sections in the [desktop](../build/tests-app-polish-20261106/implementation-desktop.md) and [mobile/Device](../build/tests-app-polish-20261106/implementation-mobile-device.md) implementation reports. These durable interaction rules apply to the published implementation:

- At 801–1199px, the logo icon and translated More disclosure expose the same five desktop menus while keeping all four workspace tabs on one row. Wide desktop retains its menu row. Popovers stay bounded; Escape closes them and returns focus to their trigger.
- Preview readings/G-code metadata and object/part/layer override headings use semantic text and surfaces. Toolbar clearance accommodates enlarged text without covering legend/statistics. Device command errors use readable opaque semantic danger surfaces and wrap long text. Native geometry, lighting choices, material and toolpath colors remain data colors.
- Calibration fields show accessible, noneditable mm, mm³/s, °C and mm/s suffixes without converting payload values. Invalid submission names the fields, associates an alert with `aria-invalid` inputs and focuses the first invalid field; editing clears stale feedback. Shaping guidance uses readable secondary text. Generate Calibration Plate, busy and Close Calibration dialog labels are explicit; footer actions wrap and remain reachable.
- Mobile Preview mounts one existing Send dialog using the current active-plate G-code and filename, including direct footer entry. Export/readiness and capability guards retain their disabled explanations. Menu exposes Preferences and its account flow. Loaded settings search reports No matching settings without moving focus; counts use singular/plural forms and Slice explains the active-plate readiness failure.
- Preserve neutral mobile selection, menus and focus treatments. Touched mobile/coarse controls and clickable label rows meet the 44px minimum; primary/footer actions retain generous sizing. Account uses a bounded bottom sheet with scrolling body, safe-area insets and pinned reachable footer; shared dialog actions remain reachable at enlarged text. The existing Preferences checkbox glyph remains 14px with a touch-size clickable label.
- Mobile plate actions wrap around a bounded scrolling tab row; long names ellipsize while plate number/delete remain visible. Reveal the active tab by scrolling its row. Plate tabs expose busy/pressed state and Enter/Space activation; Objects plate headers retain 44px targets. Object/volume actions have contextual names and expanded state. Object menus use button menuitems, roving arrows and submenu return, remain inside the owning dialog, and restore trigger focus on Escape. Shared dialogs capture the opening trigger before autoFocus so nested dismissal restores the correct focus.

Acceptance is representative Chromium verification across 320–1440px, both themes, English/Spanish and enlarged text, with final app compile/locale/build and 10 focused regressions passing. r11 replays affected surfaces using earlier matrix evidence for unchanged surfaces. Two detector scans reported the same four incumbent exceptions before the last plate CSS fix; final plate measurements/screenshots followed that fix, with no third scan. Physical Safari/touch devices, safe-area hardware, assistive technology, every settings leaf and real provider/account/printer actions remain unverified; no accessibility certification or fresh native slice/calibration generation is established. See the integrated report for exact provenance, exceptions and lifecycle observations, and the [tracking receipt](../build/tests-app-polish-20261106/tracking.md).

Files:

| File | What it holds |
|---|---|
| `src/design/tokens.css` | All colours, type, spacing, radius, shadows, motion, z-index, density and slicer-domain colours. Light and dark. |
| `src/design/components.css` | `ds-*` component classes built only from tokens. |
| `DESIGN.md` | This spec. |

Neither CSS file is imported yet. See [Migration](#migration).

## Optional alpha access — local verification 2026-11-06

The 2026-11-07 alpha redesign uses restrained Operate styling in the independent
`src/alpha` bootstrap. It retains the dark desktop identity: background `#202124`,
surface `#292b2f`, control `#1c1e21`, text `#f0f1f2`, secondary `#b2b8bf`,
primary action `#63c9bf` on `#102b29`, and focus `#7bd8d0`. These are scoped
`--alpha-*` tokens in `src/alpha/tokens.css`, with 6px corners and 42px desktop /
48px touch controls. System sans typography uses 28px desktop / 25px mobile
headings, 14px body and 13px field labels. No app CSS or external fonts are required.

Access forms have a 472px maximum measure, a shared WebOrca header and quiet
secondary navigation. Admin management uses a 1200px maximum workspace with a
300px creation column and flexible invite registry. At 800px it becomes one
column; at 600px labels and actions stack for touch. Invite identity wraps beside
explicit Active/Revoked and Used/Unused text; disclosure exposes dates, count,
editable internal labels and revocation guidance. The once-visible code remains
beside its creation form with Copy/Dismiss controls. Empty feedback explains the
next action. Focus rings, errors, disabled controls and reduced motion are scoped
to the bootstrap. The [design report](../build/tests-alpha-design-20261107/report.md)
records desktop/mobile captures, functional checks and the current rollback.

The optional gate is published on CURRENT5070 as immutable `wasm/build/ui-alpha-design-release-20261107`. The [alpha design publication](../build/tests-alpha-design-20261107/report.md) records its single incremental build, native input reuse and rollback to the previous gated release. The companion `tests-alpha-access-20261106/candidate-static` starts without login or alpha/backend requests. Build/runtime configuration is documented in [deployment guidance](../deploy/README.md#optional-alpha-access).

The public login accepts an invite code and offers **Login as admin**. Admin password login opens invite management: optional internal email/username/note labels, **Create code**, a once-visible code with Copy/Dismiss, editable labels, unused/used status, first/last use and use count, and Revoke/Restore. Labels stay behind admin authorization. Dismissing the code erases it from the view and returns focus to Create code; it cannot be retrieved later. The primary **Open slicer** button explicitly issues a separate app credential without an invite, validates it and restores the local app destination. It disables while opening and offers an inline error with retry on failure. The credential ends with its authorizing admin session, admin logout or server restart; app logout leaves admin management signed in. Tester/app credentials do not grant invite management. Existing recovery transitions apply to this app session too.

Tester sessions persist in localStorage and must pass backend validation before mounting the app. The HttpOnly companion cookie authorizes assets/workers; restored localStorage credentials revalidate to recover that cookie. Checks on focus, visibility, expiry and the visible-page interval close access when invalid; late responses cannot overwrite a newer session. Login preserves the local path/query/fragment, including the protected callback return flow. Backend logout, revoke and expiry also terminate owned active streams/sockets; real provider lifecycle acceptance remains open.

When access closes, logout occurs or the user enters admin management, hide and make the app/portals inert immediately. Keep the native model alive until durable IndexedDB recovery is saved, even with periodic autosave disabled. Failed preservation or a busy operation leaves only the locked status screen with **Retry saving recovery**; keep the tab open, retry after storage/operation recovery, and complete the transition only after preservation succeeds. Logout revokes server access immediately. Reauthentication offers **Restore your last session?** with Restore/Discard; restoration is explicit, and an unanswered recovery offer keeps its existing record. Closing/navigating away from a tab while saving is denied can still lose in-memory edits.

The [integrated report](../build/tests-alpha-access-20261106/integrated.md) records full rendered App/native-worker/IndexedDB recovery and file-only slicing/Preview, 113 selected passes, responsive containment at 320/390/820/1024/1280px and a final source detector with zero findings. Busy operations and repeat closure retain focused/seam coverage. Public Tailscale HTTPS acceptance additionally verifies the real admin login, tester cookie/localStorage, exact protected bytes, revocation and a local cube slice with 100 Preview layers. Acceptance is sampled Chromium/SwiftShader; real OAuth/provider/printer actions, hardware GPU, Safari/Firefox, physical touch and comprehensive accessibility remain open. The legacy native macOS oracle mismatch remains documented; this does not establish general native parity or an all-suites-green result.

## Rules for agents

1. **No raw colours in TSX or CSS outside `tokens.css`.** Use a semantic token (`var(--text-secondary)`). The app currently has ~440 hard-coded hex values in TSX in inline styles, many of them Tailwind slate/sky (`#94a3b8`, `#38bdf8`) that don't belong to the palette. Replace them when you touch a file; don't add new ones.
2. **Use semantic tokens, not primitives.** `--p-teal-500` exists so the semantic layer can point at it. Components use `--accent`.
3. **No new inline `style={{…}}` for static styling.** Inline styles are for runtime values only (positions, a filament colour via `--swatch`, a progress `--value`). Static styles go in a CSS file using `ds-*` classes or a feature stylesheet.
4. **Sizes come from density tokens.** Use `--ctl-h`, `--icon-btn`, `--row-h`, `--ctl-font` instead of pixel heights, so the same component is 26px on desktop and 48px on a phone.
5. **Neutral action chrome.** Menus, context actions, preset pickers and mobile controls use neutral text, selection, hover and focus treatments. This supersedes the teal action guideline on these surfaces. Status, material and toolpath colors remain semantic data colors.
6. **Status colours mean status.** Green success, orange warning, red error/destructive, blue info. Never use them for branding or category colouring.
7. **G-code and viewport colours are data, not UI.** `--gc-*` and `--vp-*` are only for legends, swatches and canvas overlays.
8. **Both themes, both densities.** Check every change in dark + light and at 1280px + 390px wide before calling it done.
9. **Every string through `t()`**, and leave room for Spanish (about 30% longer than English). No fixed-width buttons around text.

## Principles

- **The model is the hero.** The 3D canvas gets the space. Chrome is quiet: neutral greys, one accent, thin borders, no gradients.
- **Dense on desktop, generous on touch.** Desktop users tune hundreds of settings, so rows are compact (26px controls, 13px text) like desktop Orca. Phones get a reduced, guided flow with 48px targets.
- **Familiar to Orca users.** Same tab names (Prepare, Preview, Device, Calibration), same sidebar order (Printer → Filament → Process → Objects), same teal, same feature colours in Preview. A user switching from desktop shouldn't have to relearn anything.
- **Progressive disclosure.** Simple/Advanced/Expert setting levels stay. Mobile defaults to presets and only offers a handful of settings.
- **State is always visible.** Modified settings, slicing progress, printer connection and errors are shown where they happen, not only in a toast.

## Foundations

### Colour

Three layers in `tokens.css`: primitives (`--p-*`), semantic tokens, legacy aliases.

**Surfaces**, back to front:

| Token | Use |
|---|---|
| `--bg-app` | Window background |
| `--bg-canvas` | 3D viewport clear colour |
| `--surface-1` | Docked chrome: top bar, sidebar, mobile action bar |
| `--surface-2` | Section headers, cards, dialog body |
| `--surface-3` | Menus, popovers, toasts |
| `--surface-overlay` | Translucent panels floating on the canvas (gizmos, stats, legend) |
| `--scrim` | Behind modals and sheets |

**Text**: `--text-primary` (content), `--text-secondary` (labels, units), `--text-tertiary` (hints, placeholders), `--text-disabled`, `--text-on-accent`.

**Borders**: `--border-subtle` (row dividers), `--border-default` (panel edges), `--border-strong` (hover outline), `--border-input`.

**Accent**: `--accent`, `--accent-hover`, `--accent-active`, `--accent-subtle` (selected-row fill), `--accent-text`, `--focus-ring`. Menus, context actions, preset pickers and mobile controls resolve action tokens to neutral treatments, including selected/checked rows and focus rings. The retained teal palette serves other existing surfaces; status, material and toolpath colors are independent.

**Status**: `--{success,warning,danger,info}-{fg,bg,border}`, plus `--danger-solid` for destructive buttons and `--warning-solid` for the modified-setting dot. Printer connection: `--status-{online,busy,connecting,error,offline}` (busy = printing).

**Domain**:
- `--vp-*`: plate, grid, selection outline, hover, axis X/Y/Z, out-of-bounds, support paint enforcer/blocker, seam.
- `--gc-*`: one per extrusion role and move type, copied from `DEFAULT_EXTRUSION_ROLES_COLORS` / `DEFAULT_OPTIONS_COLORS` in `src/libvgcode/src/ViewerImpl.cpp`. If the viewer palette changes, change these too.
- `--gc-ramp-0…8`: the sequential ramp for speed, height, width, flow, fan, temperature and layer-time legends.

Theme is set with `data-theme="dark|light"` on `<html>`; dark is the default (matches desktop Orca's default).

### Typography

System font stack (`--font-sans`), `--font-mono` for G-code, config keys and file paths. Everything scales with `--ui-font-scale` (Preferences → interface size).

| Token | px | Use |
|---|---|---|
| `--text-2xs` | 10 | Layer slider numbers, axis ticks |
| `--text-xs` | 11 | Field labels, captions, badges, shortcuts |
| `--text-sm` | 12 | Inputs, setting rows, tables |
| `--text-md` | 13 | Desktop body, menus, section heads |
| `--text-lg` | 15 | Panel titles, Slice button, stat values |
| `--text-xl` | 18 | Dialog titles |
| `--text-2xl` | 22 | Wizard and empty-state headings |
| `--text-3xl` | 28 | Hero numbers (print time on the result screen) |

Weights: 400 body, 500 buttons/tabs, 600 headings and the active tab. Numbers that change or line up (dimensions, time, weight, layer) use `font-variant-numeric: tabular-nums` (`.ds-num`). On touch, `--ctl-font` is 16px so iOS doesn't zoom into focused inputs.

### Space, radius, elevation

- **Space**: 4px grid, `--space-1` (4) to `--space-12` (48), plus 2 and 6 for dense desktop rows. Sidebar padding 8, dialog padding 16, page gutters 12 (phone) / 16–24 (desktop).
- **Radius**: `xs 3` checkbox/swatch, `sm 4` desktop controls, `md 6` menus/cards/floating panels, `lg 10` dialogs, `xl 12` touch controls, `2xl 16` sheets, `full` pills.
- **Elevation**: `--shadow-1` raised control, `-2` floating canvas panel, `-3` menu/popover/toast, `-4` dialog/sheet. Docked chrome has no shadow, only a border.
- **Z-index**: use the `--z-*` scale (canvas overlay 10 → sidebar 20 → mobile flow 40 → top bar 50 → popover 100 → modal 1000 → toast 1100 → full-screen selector 10000). Don't invent numbers.

### Motion

`--dur-fast` 100ms for hover/press, `--dur-base` 160ms for expand/collapse and tab changes, `--dur-slow` 240ms for sheets and dialogs, `--ease-standard` for all of them. Nothing loops except progress and spinners. `prefers-reduced-motion` sets all durations to 0. Never animate the canvas camera as a side effect of UI changes.

### Density

| Token | Compact (desktop) | Touch (mobile) |
|---|---|---|
| `--ctl-h-sm` / `--ctl-h` / `--ctl-h-lg` / `--ctl-h-xl` | 22 / 26 / 32 / 38 | 36 / 48 / 48 / 52 |
| `--ctl-px` | 8 | 12 |
| `--ctl-radius` | 4 | 12 |
| `--ctl-font` | 12 | 16 |
| `--icon-btn` / `--icon` | 30 / 18 | 44 / 22 |
| `--row-h` | 28 | 52 |
| `--check` | 14 | 24 |

Touch density turns on for `max-width: 800px` or `pointer: coarse` (tablets with a desktop layout still get finger-sized targets). Force it on a subtree with `data-density="touch"`, or force desktop sizes with `data-density="compact"`.

### Iconography

Icons are the desktop Orca SVGs under `public/icons`, tinted with `currentColor` through the `.ico` mask class (`--ico: url(...)`). 18px in compact density, 22px in touch. An icon-only button always has `aria-label` and a tooltip on desktop. Don't mix in another icon set.

## Layout

### Breakpoints

| Name | Width | Layout |
|---|---|---|
| Phone | ≤ 800px | Reduced mobile UI (below). Matches `useMobile()`. |
| Compact desktop | 801–1199px | Full UI, sidebar `--sidebar-w-compact` (304px), canvas toolbar may collapse into an overflow menu |
| Desktop | ≥ 1200px | Full UI, sidebar `--sidebar-w` (360px) |

### Desktop

Preview **Show FPS** is a small Operate control on desktop and in mobile Preview controls, persisted and default-off. Its compact overlay reports cadence from actual completed draws, shows Idle at rest and labels synchronous CPU submission time in milliseconds; GPU execution time is not measured. Active updates are bounded to once per second after the initial sample, with a one-shot Idle update and no extra draws or continuous redraw loop. The [verified local candidate](../build/tests-preview-fps-20261105/report.md) is `wasm/build/ui-preview-fps-candidate-20261105`, not published.

Preview's **Lighting & shadows** checkbox is separate from **Low quality**, defaults on and persists with display preferences. Off selects basic shading and skips toolpath/bed shadows; it leaves quality, geometry, camera, color scheme, layer/move ranges and metrics intact. Mobile exposes the same preference in Preview controls. Low quality may skip expensive shadows while preserving the lighting choice. The verified UI/native candidate is published on CURRENT5070 in `ui-preview-lighting-toggle-release-20261105` (2026-11-05 15:08:43 UTC), retaining the HTTP201 backend and frozen server. [Implementation verification](../build/tests-preview-lighting-toggle-20261105/report.md) and [publication evidence](../build/tests-preview-lighting-toggle-20261105/publication/report.md) cover rendering, persistence, desktop/mobile fit and rollback.

The 2026-11-05 desktop refinement is implemented in `src/desktop-polish.css` and the shell/settings/Preview components and included in that published release. Desktop primary actions and workspace selection use teal; mobile retains its neutral controls. Empty Prepare exposes Add model and both Slice actions share a disabled reason. Modified presets expose the existing value comparison/reset flow, and process-save copy distinguishes preset reuse from project saving. Preview timing is disclosed once in statistics, while time/material/export remain visible; Layers and Moves in top layer name the two controls. Essential units/help/captions are at least 12px, with 24px help targets. See the [implementation verification](../build/tests-desktop-polish-20261105/app/final-review.md). App publication leaves the Doop drafts' approval status unchanged.

```
┌──────────────────────────────────────────────────────────────────┐
│ logo  File Edit View …   │ Prepare Preview Device Calib │ ⚙ ● acct │  top bar 40px, surface-1
├──────────────┬───────────────────────────────────────────────────┤
│ Printer    ▾ │  [canvas toolbar: add, arrange, orient, gizmos]   │
│ Filament   ▾ │                                          [cube]   │
│ Process    ▾ │                3D canvas (bg-canvas)              │
│  settings…   │   [gizmo panel]                                   │
│ Objects    ▾ │                                [layer slider]     │
│              │  [plate selector]                                 │
├──────────────┤                                                   │
│ [Slice plate]│                                                   │
└──────────────┴───────────────────────────────────────────────────┘
  sidebar 360px, surface-1        floating panels: .ds-float, inset 12px
```

- The top bar holds menus (left), the four main tabs (centre), and global status: printer connection dot, cloud account, preferences (right).
- The sidebar is a stack of collapsible sections (`.ds-section`) that scroll together, with the Slice/Print action pinned in the footer (`.ds-btn--primary.ds-btn--hero.ds-btn--block`).
- Everything over the canvas is a `.ds-float`: translucent `--surface-overlay`, `--radius-md`, `--shadow-2`, kept `--canvas-inset` from the edges. Fixed slots: toolbar top-centre, view cube top-right, gizmo panels top-left (next to the sidebar), layer slider right edge, move slider bottom, plate selector bottom-left, stats and legend top-left in Preview.
- Dialogs are centred `.ds-dialog` sized `sm` 400 (confirm), default 560 (forms), `lg` 820 (preset manager, flush volumes), `xl` 1100 (calibration wizards).

### Phone: first Doop mobile batch

Mobile field consistency r2 is live on CURRENT5070 (2026-11-05), root `wasm/build/ui-mobile-field-consistency-candidate-20261105-r2`, selected by `zzzzzzzzzzz-mobile-field-consistency.conf`. Normal mobile fields use regular semantic secondary stacked labels, an 8px label/control gap, 16px between related fields and 24px between groups. Control/unit rows fill the available width; boolean/domain rows retain their intended horizontal relationships. Desktop layout and label typography are preserved, including 13px Creality controls with 12px labels. See the [release receipt](../build/tests-mobile-field-consistency/verification.txt) and [publication report](../build/tests-mobile-field-consistency/publication/report.md) for live browser checks, limits and guarded rollback to model-tools r2. Restart clears OrcaCloud RAM sign-in; browser presets remain.

Mobile model tools r2 remains included. With a model selected and Move or Scale active, dragging its body transforms that instance; empty canvas gestures and pinch control the camera. Only the relevant numeric fields appear below the viewer. Mobile hides the view cube, view shortcuts and selection info inside the viewport. Desktop transform controls/layout remain available. Public headed Chromium at 320/390 verified native touch transforms, camera isolation, external numbers and the desktop Light → mobile contrast transition; see the [model-tools receipt](../build/tests-mobile-model-tools/verification.txt). Physical-device/Safari accessibility remains open.

The first Doop mobile batch is live on current5070 as of 2026-11-04. It covers **import a model → pick printer, filament and preset → slice → check → download or send** through existing engine/store actions. See the [publication receipt](../build/tests-doop-mobile-ui/verification.txt).

Mobile polish r2 is also live: Device Web UI stacks below controls with narrow fan fit; shell, Preview and picker accents are neutral while data colors remain; shared dropdown chevrons stay aligned with long labels and enlarged text. This user-directed neutral treatment overrides the teal guide for those mobile surfaces. Fresh public Chromium at 320/390 and 100/125% text passed; see the [polish receipt](../build/tests-mobile-polish/verification.txt). Final Doop polish below includes the detailed Device/Calibration adaptations; physical-device accessibility/Safari remain open.

Mobile layer/dropdown r2 is live on current5070: Process, Quality and Preview native selects reserve 40px on the right for one 16px SVG with its painted arrow 16px inside the edge. Mobile Preview shows exactly one layer slider; move scrubbing/playback stays on desktop and its timer is cleared on transition to mobile. Public headed Chromium at 320/390 and 100/125% text passed; see the [release receipt](../build/tests-mobile-layer-dropdown/verification.txt). Desktop keyboard pause and mobile-transition cleanup passed; pointer pause remains unverified under the QA cap.

App UI spacing r2 was published on current5070 on 2026-11-04 and remains included. Mobile sheets use consistent insets and group gaps; populated Objects controls remain contained and long override lists scroll within the sheet. Fresh public headed Chromium checked actual Quality, Menu and imported cube Objects at 320/390 with 100/125% text; see the [spacing receipt](../build/tests-ui-spacing/verification.txt).

Final verified Doop desktop/mobile polish r2 is now implemented and published on current5070 (2026-11-05 local). Desktop Process uses six wrapping category tabs, long units clear Reset, and actual native Preview statistics align with the legend at wide widths while preserving a visible export footer at compact widths. Mobile Calibration stays neutral/readable after desktop Light theme, and actual Preview switches retain rounded tracks/circular thumbs in both states. Public headed Chromium checked desktop 1024/1280 and mobile 320/390, Quality insets, layer-only controls and populated Objects scrolling; see the [release receipt](../build/tests-doop-polish-implementation/verification.txt) and [publication report](../build/tests-doop-polish-implementation/publication/report.md).

Real-app adaptations retain native canvas/toolpaths, actual metrics and all 17 schemes, desktop playback, one mobile layer slider, Download/Send and complete calibration launchers. Static Doop captures remain design references. App publication authorization and canvas draft approval are separate. Physical Safari/device gestures/safe areas, assistive technology and accessibility certification remain unverified; real accounts and Bambu China remain open.

```
┌───────────────────────────┐
│ OrcaSlicer Web      Menu │  .wm-header
├───────────────────────────┤
│                           │
│        3D canvas          │  selected body Move/Scale; empty orbit / pinch / pan
│                           │
├───────────────────────────┤
│ Prepare Preview Device  │  .wm-nav, with Calibration
└───────────────────────────┘
```

**On the phone:**
- Persistent Prepare, Preview, Device and Calibration navigation. Empty Preview supports actual G-code import and Go to Prepare. Direct Preview URLs and reloads work.
- Import (STL, OBJ, 3MF, AMF, STEP, SVG) through the file picker.
- `MobilePrepare` shows the live plate, model import, Objects drawer and guarded active-plate slicing. Menu exposes real saved-printer, filament and process selection plus existing project/preset actions. Process/Quality opens a draft editor with Cancel/Apply and retry after partial failure; other categories retain immediate editing.
- Plate tools exposes Move/Scale. Selected-body drag transforms the instance; relevant numbers sit below the viewer. Empty-canvas gestures and pinch move the camera. No view cube, view shortcuts or selection info appears inside the mobile viewport; desktop retains its transform controls/layout.
- Choosing from a list opens the full-screen selector (`.mobile-selector`: search on top, 52px rows, grouped by vendor). Never a native `<select>` with hundreds of options.
- Preview: real native canvas, one mobile layer slider, colour schemes and live legend, controls sheet and actual slice statistics/export. Move controls and playback are desktop-only. Breakpoint canvas replacement reloads current source or clears unavailable outdated metadata.
- Printer connection and send-to-printer dialogs, as bottom sheets.

Device and Calibration remain reachable through their existing panels; their detailed mobile design and implementation remain open. Physical-device safe areas, touch/keyboard, screen readers and Safari accessibility validation remain open. Desktop Chromium 320/390 and enlarged-text QA do not establish WCAG conformance. Existing backend/auth functionality is retained; real cloud-account validation and Bambu China regional routing remain open.

**Phone rules:**
- Touch targets ≥ 44×44, primary actions 48px tall, full-width or split equally in the action bar.
- Thumb zone: primary actions at the bottom. Only navigation and close go at the top.
- Respect `env(safe-area-inset-*)` on every edge-pinned bar.
- Dialogs become bottom sheets automatically (`.ds-dialog` under 800px): top corners `--radius-2xl`, footer buttons wrap and stretch.
- Toasts sit above the action bar, never over it.
- No hover-only affordances: no tooltips as the only way to learn something, no hover-revealed buttons.
- Settings on phones use stacked rows (label above control), toggles instead of checkboxes, and 16px inputs.
- Use `100dvh`, not `100vh`, so mobile browser chrome doesn't hide the action bar.

## Components

Each component lists its class, what it replaces in the current code, and its rules.

| Component | Class | Replaces today | Notes |
|---|---|---|---|
| Button | `.ds-btn` and variants, `.ds-btn-group`, `.ds-split` | `.btn`, `.btn-primary`, `.btn-slice`, `.btn-secondary-wide`, `.btn-danger-wide`, mobile `:is(#mobile-…)` button list | See [Buttons](#buttons). |
| Icon button | `.ds-icon-btn` | `.icon-btn` | Toggle state with `aria-pressed`. Needs `aria-label`. Inside a toolbar, see [Toolbars](#toolbars). |
| Title | `.ds-title--{page,dialog,panel,section,group}`, `.ds-lead`, `.ds-titlebar`, `.ds-group-head` | `h2`/`h3` styled per file, `.calibration-page h2`, `.calib-group h3`, `.modal-header` text | See [Titles](#titles). |
| Text / number field | `.ds-input`, `.ds-input--num`, `.ds-field-unit` | sidebar inputs, per-dialog inline inputs | Numbers right-aligned and tabular. Unit as a suffix, never inside the label. Invalid: `aria-invalid="true"` plus a message below in `--danger-fg`. |
| Select / dropdown | `.ds-select` (native), `.ds-dropdown` + `.ds-listbox` + `.ds-option` (custom) | sidebar `<select>`s, `SavedPrinterSelector`, preset combos, `MobileSelect` | See [Dropdowns](#dropdowns). |
| Toolbar | `.ds-toolbar` (`--vertical` `--flat` `--labels`), `.ds-toolbar__sep`, `.ds-toolbar__item` | `.canvas-toolbar`, `.tool-sep`, `.view-buttons`, `#preview-top-controls`, top-bar quick actions | See [Toolbars](#toolbars). |
| Setting row | `.ds-setting` | `ObjectSettingRow`, settings tab rows | Label · control · reset. Modified-from-preset shows an orange dot and the reset button, like desktop Orca's orange arrow. |
| Checkbox / switch | `.ds-check`, `.ds-switch` | global `input[type=checkbox]` rule, `.mobile-toggle` | Checkbox in dense desktop lists, switch on touch and for on/off features. |
| Segmented control | `.ds-segmented` | `.mobile-view-tabs`, simple/advanced toggles, mode pickers | 2–4 options of equal weight. |
| Tabs | `.ds-tabs`, `.ds-tab` | `.tabs`, `.tab` | Top-bar navigation and settings tabs only. |
| Collapsible section | `.ds-section` | `.sb-section`, `.sb-head`, `.sb-body` | Header is a `<button aria-expanded>`. Section state persists in prefs. |
| Floating panel | `.ds-float` | `#selection-panel`, `#cut-tool-panel`, `#paint-tools-panel`, `.slice-stats-panel`, legend | The only container allowed over the canvas. |
| Card | `.ds-card`, `--interactive` | `.calib-tile`, device tiles, wizard choices | Selected: `aria-pressed`/`aria-selected`, accent border and `--accent-subtle` fill. |
| List row | `.ds-row` | object tree items, preset lists | Selected: `--accent-subtle` fill with a 2px accent bar on the left. |
| Badge | `.ds-badge` + status variants | ad-hoc coloured spans | Short labels only: "Modified", "System", "Online". |
| Swatch | `.ds-swatch` | filament colour squares | Colour via `style={{'--swatch': hex}}`; set `--swatch-text` to black for light filaments. |
| Status dot | `.ds-status-dot[data-status]` | `.status-dot` | Always next to a text label or inside a labelled button. |
| Banner | `.ds-banner` + variants | `ErrorBanner`, `IsolationNotice`, slicing warnings | Persistent, in-flow problems that block or affect the result. |
| Toast | `.ds-toast` | `#toast-container .toast-item` | Transient confirmation only ("Sent to printer"). Auto-dismiss 4s; errors don't auto-dismiss and also go in a banner. |
| Menu / context menu | `.ds-menu`, `.ds-menu__item` | `.menu-popup`, `ContextMenu`, `PlateContextMenu` | Arrow-key navigation, Esc closes, shortcuts in `<kbd>`. On touch, context menus become a bottom sheet. |
| Tooltip | `.ds-tooltip` | `title=` attributes | Desktop only. Show after 500ms. Setting tooltips show the description and the config key in `.ds-mono`. |
| Dialog / sheet | `.ds-scrim` > `.ds-dialog` (`--sm` `--lg` `--xl`), `__head` `__body` `__foot` | `.modal-backdrop`, `.modal-content`, `.modal-box`, `ModalBackdrop` | Footer: secondary on the left of primary, primary rightmost. Esc and scrim click cancel unless there's unsaved input. Focus is trapped and returns to the trigger. |
| Progress | `.ds-progress` (+ `--indeterminate`) | slicing progress, model loading card | Slicing shows stage text ("Generating supports… 42%") next to the bar. |
| Stat | `.ds-stat`, `--hero` | slice stats, printer telemetry | Label above value. Units in `--text-secondary`. |
| Legend | `.ds-legend`, `.ds-legend__item`, `.ds-ramp` | Preview legend | Items are toggle buttons (`aria-pressed`) that hide that role in the viewer. |
| Mobile shell | `.ds-mobile-topbar`, `.ds-action-bar`, `.ds-steps`, `.ds-sheet-handle` | `.mobile-topbar`, `.mobile-import-bar`, `.mobile-flow` header/footer | |

### Buttons

| Variant | Class | Use | Example |
|---|---|---|---|
| Primary | `--primary` | The main action of the view. **One per view.** | Save (dialog), Next (wizard), Connect |
| Hero | `--primary --hero` (usually inside `.ds-split--block`) | The main action of the whole screen. Sidebar footer and phone action bar only. | Slice plate, Print plate, Send |
| Secondary | (none) | Every other action. | Arrange, Cancel, Import |
| Subtle | `--subtle` | Positive extra actions that shouldn't compete with the primary. | Add printer, Add filament slot |
| Ghost | `--ghost` | Low-emphasis actions in dense areas, dialog Cancel when the footer is crowded. | Cancel, Clear |
| Link | `--link` | Inline actions inside text or a banner. | Show, Details, Reset all |
| Danger | `--danger` | Destructive and irreversible. Always followed by a confirm dialog. | Delete preset, Stop print |
| Icon (bordered) | `--icon` | Square action next to a field or dropdown. | Edit preset ✎, Save preset |
| Toggle | any + `aria-pressed` | Two-state option shown as a button. | Show travel, Wireframe |

Sizes follow density: `--sm` (22 / 36px), default (26 / 48), `--lg` (32 / 48), `--hero` (38 / 52), compact / touch. Width hugs the label with `calc(var(--ctl-px) + 4px)` padding; `--block` stretches.

- **Label**: a verb, sentence case, 1–3 words: "Slice plate", not "OK" or "Slice Plate". Icons go before the label at `--icon` size; an icon never replaces the label on a primary or hero button.
- **Order**: in dialog footers and the phone action bar, secondary on the left, primary on the right. Destructive actions go on the far left, away from the primary.
- **States**: hover `--control-bg-hover` + `--border-strong`; active `--control-bg-active`; focus 2px `--focus-ring` offset 2px; disabled `--control-bg-disabled` + `--text-disabled` (and on phones a dashed border, so it doesn't read as a primary in sunlight). Disabled buttons with a non-obvious reason get a tooltip (desktop) or helper text under them (phone).
- **Busy**: set `aria-busy="true"`, swap the icon for `.ds-spinner`, keep the label (or change it to the progressive form: "Slicing…"). Don't disable a busy button that can be cancelled; turn it into Cancel instead.
- **Groups**: `.ds-btn-group` for 2–4 equal actions that belong together (Undo | Redo, − | +). Use `.ds-segmented` instead when exactly one option is selected.
- **Split button**: `.ds-split` for a main action with related alternatives, like desktop Orca's Slice plate ▾ (Slice all) and Print plate ▾ (Export G-code, Send, Export plate sliced file). The arrow opens a `.ds-menu`. Phones show the alternatives as separate buttons in the action bar or a sheet, not a split.

### Titles

Pick the level by where the title is, not by the size you want.

| Level | Class | Size / weight | Where |
|---|---|---|---|
| Page | `.ds-title--page` | 22 / 600 | Calibration, Device and Preferences pages, wizard steps, each mobile flow step, empty states |
| Dialog | `.ds-title--dialog` | 18 / 600 | `.ds-dialog__head`, phone sheets |
| Panel | `.ds-title--panel` | 15 / 600 | Floating canvas panels (Move, Cut, Paint), cards, stats panel |
| Section | `.ds-title--section` | 13 / 600 | Sidebar sections (Printer, Filament, Process, Objects), settings page names |
| Group | `.ds-title--group` | 11 / 600 uppercase, +0.06em, `--text-secondary` | Groups inside a settings page ("WALLS", "INFILL"), calibration groups, listbox groups. Use `.ds-group-head` for the version with a trailing hairline. |

- `.ds-lead` sits under a page or dialog title for one or two sentences of explanation, in `--text-secondary`.
- `.ds-titlebar` lays out an optional leading icon, the title (+ subtitle) and trailing actions (`.ds-titlebar__actions`, usually icon buttons or a ghost button). Actions in a title row are never primary.
- Use real heading elements (`h1`–`h4`) in document order; the class sets the look. Sentence case, no trailing colon or full stop.
- Titles wrap (`overflow-wrap: anywhere`) instead of truncating, except the sidebar section head, which truncates with an ellipsis and shows the full text in a tooltip.

### Dropdowns

Two kinds:

| | Native `.ds-select` | Custom `.ds-dropdown` + `.ds-listbox` |
|---|---|---|
| Use for | Short, flat, fixed lists of plain text (< ~15 options): infill pattern, seam position, units | Printers, filaments, process presets, view type; anything grouped, searchable, with swatches, badges or a second line |
| Desktop | Browser popup with a custom chevron | Popover under the trigger, same width or wider (min 240px, max 420px) |
| Phone | Native picker (fine on iOS and Android) | Full-screen selector (`.mobile-selector`): search on top, grouped 52px rows, close top-left |

**Trigger** (`.ds-dropdown`, a `<button aria-haspopup="listbox" aria-expanded>`):
- Anatomy: optional leading swatch or icon · `.ds-dropdown__value` · optional `.ds-dropdown__meta` (e.g. nozzle "0.4") · chevron (drawn by `::after`, rotates when open).
- `--rich` for a two-line value: name, with `<small>` detail underneath ("Voron 2.4 350" / "0.4 nozzle · Klipper"). Used for the printer selector.
- `data-state="modified"` adds an orange `*` after the name (unsaved preset changes, matching desktop Orca's "(modified)"). `data-state="incompatible"` tints it orange with a warning border and needs a tooltip saying why.
- Open state: accent border + 1px accent ring, like focus.

**Listbox** (`.ds-listbox`):
- `.ds-listbox__search` appears when there are more than ~10 options; it's focused on open, and matches are wrapped in `<mark>` (underlined, semibold).
- Groups use `.ds-listbox__group` with `.ds-title--group` text. For presets the groups are: User presets, then System presets by vendor. For filaments it's the same, plus "Not compatible" at the end with disabled options.
- `.ds-option`: check column on the left (shows ✓ when `aria-selected`) · optional swatch/icon · `.ds-option__label` (truncates) · optional `.ds-option__hint` (a badge like "User" or a value like "0.20 mm"). Disabled options use `aria-disabled="true"` and stay visible so users can see why something isn't available.
- `.ds-listbox__foot` holds management actions as ghost or link buttons: "Add / remove presets…", "Edit printers…".
- Keyboard: ↑/↓ move, Enter selects and closes, Esc closes without changing, typing filters. Focus returns to the trigger.

### Toolbars

| Toolbar | Class | Position | Contents |
|---|---|---|---|
| Prepare tools | `.ds-toolbar.ds-toolbar--vertical` (or horizontal per preference) | Canvas, top-left, `--canvas-inset` from the edges | Undo, Redo │ Move, Rotate, Scale, Auto-orient, Place on face, Measure, Explode │ Cut, Mesh boolean, Brim ears, Text, SVG, Variable layer height │ Support, Seam, Color and Fuzzy skin painting │ Arrange, Delete (the groups `toolGroups` in `plate/PlateView.tsx` already uses) |
| View | `.ds-toolbar.ds-toolbar--labels` | Canvas, top-right, next to the view cube | Iso, Top, Bottom, Front, Back, Left, Right, Fit |
| Preview controls | `.ds-toolbar` with `.ds-toolbar__item`s | Canvas, top-centre | View type dropdown (Feature type, Speed, Height, …) │ toggles: Travel, Retractions, Seams, Shells │ G-code viewer toggle |
| Preset row | `.ds-dropdown` followed by `.ds-toolbar.ds-toolbar--flat` | Sidebar Printer / Filament / Process sections | Edit, Save as user preset, Manage presets, Delete user preset (the icon buttons in `PrepareSidebar.tsx`) |
| Panel header actions | `.ds-toolbar.ds-toolbar--flat` in `.ds-titlebar__actions` | Sidebar section heads, floating panel heads | Add filament, Connect printer, Search, Close |

- **Tools** are `.ds-icon-btn`s (34px, 22px icon on desktop; 50px on touch) using the desktop SVGs in `public/icons/toolbar_*.svg` via `.ico`.
- **States**: hover fill; `aria-pressed="true"` (accent fill) when the tool's panel or gizmo is open, and only one gizmo at a time; `data-armed="true"` (accent underline) for a mode that's on but has no open panel (e.g. variable layer height applied); `disabled` when nothing is selected for a selection tool; `data-tone="danger"` for Delete.
- **Grouping**: by task in the order above, separated by `.ds-toolbar__sep`. Delete is always last.
- **Flat toolbars** keep 30px buttons with 18px icons and no chrome. Never more than four actions; anything else goes in a `⋯` menu.
- **Tooltips**: every tool has `data-tip="Move (M)"`: name + shortcut. Shown on hover-capable pointers only; they open to the right of a vertical toolbar and below a horizontal one.
- **Overflow**: when the canvas is too narrow (compact desktop), the last groups collapse into a "More" `⋯` icon button that opens a `.ds-menu` with the same items, icons and shortcuts. Never wrap a toolbar onto two lines.
- **Accessibility**: `role="toolbar"`, `aria-orientation`, `aria-label` ("Object tools"). Tab enters the toolbar once; arrow keys move between tools (roving tabindex).
- **Phone**: no Prepare tools toolbar. The phone keeps the top segmented control and bottom `.ds-action-bar` as its only bars. Preview gets a single compact `.ds-toolbar` top-left with the View type dropdown and a legend toggle, at touch size. Only one layer slider accompanies these controls; move/playback is desktop-only.

## Patterns

**Settings.** Group as desktop Orca does (tab → page → group → line). Show the setting level (Simple/Advanced/Expert) filter at the top. A modified value shows the orange dot and a reset button; the preset name gets "(modified)" and a Save button appears. Search highlights the match and scrolls to the row. Invalid values are kept in the field, marked red, and block slicing with a banner explaining which setting is wrong.

**Slicing.** The Slice button becomes a progress bar with stage text and a Cancel action, in the same place. When done, switch to Preview automatically (desktop preference, always on phone). Warnings appear as a banner on the Preview with a count and a "Details" link.

**Errors.** Say what happened and what to do, in the user's words: "The model is outside the build plate. Move it or arrange the plate." Never show a raw exception as the only text; put technical detail behind "Details" in `.ds-mono`.

**Empty states.** Prepare with no model: a centred drop zone on the canvas with the import button and accepted formats, `--text-2xl` heading. Device with no printers: a card with "Add printer".

**Loading.** Skeleton rows for lists that load (presets, cloud), an indeterminate progress bar for the WASM engine starting, and never a spinner without text for more than a second.

**Confirmations.** Only for destructive or costly actions (delete preset, discard changes, start a print). Confirm button repeats the verb: "Delete preset", not "OK".

**Keyboard (desktop).** Keep desktop Orca's shortcuts. Every interactive element is reachable by Tab, with a visible `--focus-ring` (2px, offset 1–2px).

## Accessibility

- Text contrast ≥ 4.5:1 on its surface (3:1 for ≥ 18px text, icons and control borders). Primary pairs are checked in both themes; check new pairs.
- Never use colour alone: modified settings also get a reset button, status dots sit next to text, legend items have names.
- Hit targets ≥ 24px on desktop, ≥ 44px on touch.
- Use real elements (`<button>`, `<input>`, `<dialog>` semantics) and ARIA states (`aria-pressed`, `aria-expanded`, `aria-selected`, `aria-current`, `aria-invalid`, `aria-busy`). The CSS keys off these attributes, so state and styling can't drift apart.
- The canvas has a text alternative: the object list (desktop) or the import summary (phone).

## Migration

Do these in order; each step ships on its own.

1. **Swap in tokens.** Import `src/design/tokens.css` in place of `shell/theme.css` in `index.css` (the legacy aliases at the bottom keep current CSS working), then import `src/design/components.css`. Remove the `:root[data-theme="light"] … !important` overrides from `theme.css` once the panels they patch use `.ds-float`.
2. **Mobile first.** Move `mobile/mobile.css` and `mobileControls.css` onto `.ds-btn`, `.ds-segmented`, `.ds-action-bar`, `.ds-switch`, `.ds-input` and `.ds-dialog` sheets, and delete the long `:is(#mobile-…, #pc-…)` selector lists.
3. **Shell.** Top bar → `.ds-tabs`, sidebar → `.ds-section`, Slice → `.ds-btn--hero`, menus → `.ds-menu`.
4. **Dialogs.** Replace `ModalBackdrop` + `.modal-*` with one `Dialog` component rendering `.ds-scrim/.ds-dialog`.
5. **Inline-style cleanup.** Worst offenders first: `CutPanel.tsx`, `TextPanel.tsx`, `ManagePresetsDialog.tsx`, `PaintToolsPanel.tsx`, `SliceStatsPanel.tsx`, `FlowRateModal.tsx`. Replace hex values with tokens and static styles with classes.
6. **Retire aliases.** When `grep -r -- '--panel-bg\|--text-color\|--accent-color' src` is empty, delete the legacy block from `tokens.css`.
