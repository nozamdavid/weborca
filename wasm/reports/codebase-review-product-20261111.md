# Product/codebase review — WebOrca (wasm/app) 2026-11-11

**Baseline (explicit):** current checkout `prototype/html-in-canvas-plate-title` @ `6773b526d0` plus accepted uncommitted fixes (box-selection, group-transform-gizmos, transform-release-selection, bed-boundary-slicing). This is **not** main/production; findings use this tree's line numbers. All findings are grounded in actual source; classifications: confirmed defect, measured cost, performance hypothesis, useful feature, unknown.

**Already present (do not rebuild):** plate-level sliced 3MF packaging with embedded thumbnails (`shell/exportPlateSlicedFile.ts`), all-plates export autosave, history/recovery, autosave + recovery dialogs, adoptable desktop preset archives (INI/JSON/zip) with conflict strategies, filament slot + per-object/per-plate settings, full session reuse for cloud printers (`cloudSessionReuse.ts`), hardened gateway (`policy.ts`, `alphaAccess.ts`, `snapmakerMonitor.ts`, `octoEverywhere.ts` — canonical-origin checks, SSRF-resolved targets, bounded bodies, timing-safe compares), staged/owned writes in `saveProjectFile` and the preview loader with explicit `FS.unlink`, ETag/immutable asset caching in `deploy/server.mjs`, mobile Prepare/Preview/Device surfaces (`mobile/MobilePrepare.tsx`, `MobileShell.tsx`, `MobileStats.tsx`).

## Findings

### F1 (unfinished integration, confirmed) — The whole "mobile slice steps" deployment knob is dead in the app

- **Files/lines:**
  - `wasm/app/src/mobile/mobileConfig.ts:4,7` — `DEFAULT_MOBILE_STEPS` / `parseMobileSteps` have no caller in `app/src` (only tests reference them).
  - `wasm/app/vite.config.ts:407,425` — `MOBILE_SLICE_STEPS` env → `define: import.meta.env.VITE_MOBILE_SLICE_STEPS`, plus a `/app-config.json` middleware.
  - `wasm/deploy/server.mjs:167` — prod server also serves `/app-config.json` `{ mobileSliceSteps }`.
  - No `app/src` file reads `app-config.json`, `mobileSliceSteps`, or `VITE_MOBILE_SLICE_STEPS`.
- **Trigger/consequence:** an operator sets `MOBILE_SLICE_STEPS` (documented + covered by `tests/node/deploy-config.test.mjs:69-79`), restarts, and nothing changes: the deployed knob is inert. Related: `tests/app/mobile-slicing.mjs:207+`, `mobile-controls.mjs`, `mobile-default-steps.mjs`, `ui-followups.mjs:26`, `ui-layout.mjs`, and `slice-preview-shading.mjs` exercise step-based flows and a `#mobile-choose-settings` / `#mobile-next` / `#mobile-slice` wizard whose components no longer exist; `--z-mobile-flow` (`design/tokens.css:190`) and `.mobile-flow` CSS are orphaned; `MobileSetting.tsx` (133 lines) is imported by nothing.
- **Smallest fix:** pick one — (a) delete the chain (`mobileConfig.ts` steps exports, dev middleware, server route, `env.d.ts` entry) plus the stale suites, or (b) make `MobileProcessSettings` fetch `/app-config.json` and order/limit its step list from it. Either is S effort; (b) restores the documented behavior.
- **Validation:** run `tests/app/mobile-controls.mjs`, `mobile-default-steps.mjs`, `mobile-slicing.mjs` (all three currently red or meaningless), plus `deploy-config.test.mjs`.

### F2 (confirmed retention path; impact unmeasured) — Project staging needs an ownership contract

`wasm/app/src/store/appStore.ts:947-948` writes named project bytes then calls `openProject` without local cleanup. Distinct project names can retain distinct MEMFS inputs. Reopening the same name overwrites its path; monotonic growth on every reopen is not established. `wasm/web/engine-core.js:161` already unlinks owned OBJ/STL and packed STEP scratch, and `:331-366` documents those contracts. Other formats deliberately retain inputs pending dependency-persistence coverage. This is not a finding that every model import leaks or that no cleanup API exists.

Smallest next step (S investigation, M fix): inspect 3MF/project asset ownership before adding consume-and-remove behavior. Validate distinct large project filenames, MEMFS retained bytes (not just file count), successful save/reopen and embedded assets after cleanup.

### F3 (possible UX validation gap, small) — Send-to-printer accepts any filename without a printable extension

- **Files/lines:** `wasm/app/src/printers/SendToPrinterDialog.tsx:75` (`filename.trim()` only, no extension normalization), used by `api.upload({ filename })` for Moonraker (`/server/files/upload`), OctoPrint, Bambu FTP shim, Prusa Connect (`prusaConnect.ts:538`).
- **Trigger/consequence:** a user-edited name can lack an extension. Provider acceptance and print behavior have not been demonstrated; validate each provider before classifying this as an upload defect.
- **Smallest fix:** on submit, if `/\\.(gcode|gco|g)$/i` fails, append `.gcode` (and show the final name in the success toast). S effort; validate in `tests/app/send-to-printer-dialog.mjs`.

### F4 (feature hypothesis; original silent-staleness claim withdrawn) — Validate freshness comprehension

`wasm/app/src/printers/DevicePanel.tsx:794-798` already displays connection status, DeviceFreshness, errors and Snapmaker Retry. `session.ts:175-190` registers focus/visibility synchronization. A silent-stop defect is not established by this review. First validate cached-state wording and reconnect behavior under an upstream reset; add a badge only if existing UI proves insufficient. S investigation; no hardware claim.

### F5 (feature opportunity, M) — Installable/offline mobile app shell

The mobile surface (`mobile/*.tsx`, ~755 lines) is complete but the app has no web app manifest, no `theme-color`, no installability, despite phone-first CSS. A minimal `${webRoot}/manifest.webmanifest` + icons (already in `public/icons/`) + `theme-color` meta lands in S; adding a COEP-safe service worker to cache the already-immutable `/assets/*` engine bundle (the 30 MB re-download noted in `deploy/server.mjs` comments) is an M that would make cold starts on phones tolerable. Don't cache `/app-config.json`, `/orca-cloud/callback`, or anything under `/_printer`.

### F6 (limited coverage observation) — Mobile wizard contracts are stale

The suites listed in F1 encode a removed wizard. This is one observed coverage mismatch; delivery review also identifies broader CI dependency, artifact and reference gaps. Test inventory is not proof of executed coverage or gateway security.

## Security scope qualification

Token storage and filename handling were sampled, not comprehensively audited. No blanket assurance about credential forwarding, provider safety, path safety or absence of escalation follows from this review.

## Recommended priorities

1. F1 (dead knob + stale suites) — cheapest to fix, highest trust-per-effort; do (a) delete or (b) rewire, S.
2. F2 — establish project staging ownership and measure retained bytes with distinct filenames; S investigation, M fix.
3. F3 — one-line-ish submit-time normalization, S.
4. F4 — validate existing freshness and retry UI before proposing changes; S.
5. F5/F6 — optional mobile polish + suite realignment, M.
