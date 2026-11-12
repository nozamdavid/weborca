# Export button alignment — 2026-11-11

Changed source: `wasm/app/src/preview/SliceStatsPanel.css` only. Removed the local `display: block` from `.slicestats-panel__a-2`, restoring `.ds-btn` flex alignment. The overriding block formatting placed its line at the top of the minimum-height control. No pixel offsets or size/theme/semantic changes. PrepareSidebar's export already uses `.ds-btn--block` flex layout and needs no change.

Inspected the supplied attachment. Reproduced the actual Preview statistics export anchor using the existing `wasm/tests/node/fixture.gcode` through the application's G-code file input and native Preview loader, on accepted service HTTPS5065 before the change and isolated localhost5068 after. This is the actual integrated app; no detached button fixture. Imported G-code exercises the matching statistics/export UI without claiming a fresh native slice.

At 1280×800, baseline anchor was 136×26 CSS px at y314.5, text y315.5 h13.5 (center delta -5.25px). Fixed anchor stays 136×26 at y314.5, text y320.296875 h13.5 (delta -0.453125px). Display changes block → flex; line-height remains14.4px. Visually inspected the resulting screenshot.

At 1024×800 in light theme, temporarily substituted a longer label in the real anchor (`Exportar archivo de código G`) to exercise wrapping: 114×45.195px control, text42.297px, center delta -0.449px; within1px assertion passed. At390×844 the affected anchor is absent: mobile uses its separate173×48px Export G-code button. No mobile CSS changed.

Evidence: `wasm/build/tests-export-alignment-20261111/` contains `before.png`, `after-desktop-dark.png`, `after-compact-light-long-label.png`, `build.log`, `focused-test.log`, `candidate.sha256`, `manifest-check.log`.

Single integrated candidate: `wasm/build/ui-export-alignment-20261111`, frozen with all write bits removed. Manifest SHA256: `992848238f18ee8166ffff73b520f08aa7de1f6b3266b7169d5ee885ff3e942f`; all manifest entries verified. Built via `ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine npm run build -- --outDir ../build/ui-export-alignment-20261111` from wasm/app. This packages the accepted OLD engine input; pending bed-boundary engine work is not represented or validated.

Build passed (locale checks22 catalogs, tsc --noEmit, Vite; existing chunk size warnings). `git diff --check` passed. Existing focused `node --test wasm/tests/node/desktop-design-polish.test.mjs` could not reach Preview: timed out at line94 waiting for hidden `#slice-disabled-reason` in the Prepare fixture. Initial attempt lacked the Playwright dependency; retry used a temporary owned web-smoke/node_modules symlink, removed afterward. The preexisting app/node_modules symlink was preserved. No new test infrastructure or unrelated fixes.

Owned5068 service/tab closed after verification. Persistent PID1550591 /5064/private HTTPS5065 preserved. No native sources, unrelated work, README, Taproot, commits or deployments changed. Parent acceptance and combined engine candidate remain pending.

## Independent combined acceptance

PASS 2026-11-11. Reused immutable `wasm/build/ui-bed-boundary-slicing-20261111`, updated engine and same CSS snapshot, without rebuilding. Actual native inside/outside slice reached Preview at1280×800. Generated export anchor display:flex,136×26px, vertical text-center delta -0.453125px; descendant-aware center hit-test PASS. Screenshot visually inspected. Only inside emitted G-code; both instances remained in native project. All-outside retry cleared export URL/result. Compact/light/wrapping evidence above remains the alignment agent's verification.

Private HTTPS5065 serves combined candidate: served HTML/entry/loader/WASM byte identity and isolation/no-cache headers verified. Persistent Vite PID1649811, bound100.105.38.125:5064; log/pid `wasm/build/preview-5064.{log,pid}`; stop `kill 1649811` after command-identity check. Owned5067/tab closed. See [combined acceptance details](bed-boundary-slicing-20261111.md).
