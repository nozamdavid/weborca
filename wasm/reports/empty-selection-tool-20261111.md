# Empty selection clears transform tool — 2026-11-11

Changed files: `wasm/app/src/plate/plateStore.ts`, `wasm/tests/node/multi-scale.test.mjs`, `README.md`, this report.

Selection actions now clear Move/Rotate/Scale when selection becomes empty. Valid selection changes and primary promotion retain the tool. Refresh validates instance membership and promotes surviving selected instances; removing the final instance clears the tool. Existing PlateView effects already stop painting, Cut and Layers on deselection. Group cancellation continues through the existing selection/gizmo effects. Selecting a transform tool before selecting objects remains supported.

Real-store regression: `node --experimental-strip-types --test wasm/tests/node/multi-scale.test.mjs` failed before the fix: `explicit deselection clears tool`, actual `translate`, expected null. All three modes now pass explicit clear, invalid object/instance, final toggle, empty select-all, valid selection retention, primary promotion and final-instance refresh removal. Deletion uses that refresh path. No source-text assertions were added.

PASS: selection/scale, box and group tests (12 tests), locale validation, `tsc --noEmit`, integrated Vite build, `git diff --check`. Commands/evidence in `wasm/build/tests-empty-selection-tool-20261111/{red.log,green.log,build.log}`. Focused command: `node --experimental-strip-types --test wasm/tests/node/{multi-scale,box-selection,group-transform-gizmos}.test.mjs`.

One read-only candidate: `wasm/build/ui-empty-selection-tool-20261111`. Built with `ORCA_ENGINE_DIR` pointing explicitly to `wasm/build/engine-bed-boundary-20261111/wasm/engine`. Packaged loader and WASM compare byte-for-byte with accepted `ui-bed-boundary-slicing-20261111`. All-file manifest: `candidate.sha256` in the evidence directory; served entry/engine hashes: `served.sha256`.

Private HTTPS5065 now serves this candidate. Prior PID1649811 and pidfile/command identity verified before stopping. Current PID1862610, pid/log `wasm/build/preview-5064.{pid,log}`. Stop command: `kill 1862610` after verifying the command names this candidate. The initial detached launch exited and HTTPS returned502; relaunched with setsid, then verified HTTP200, COOP same-origin, COEP require-corp, no-cache, and byte-identical served HTML, entry, loader and WASM. Tailscale proxy configuration and unrelated services preserved.

Existing group/box/numeric Scale, bed-boundary Engine.cpp and Export CSS edits preserved. No commit, push, branch change or public deployment. No browser automation or physical-input claims; deterministic store tests cover this state behavior. Only this task's dependency symlink was removed after verification. README and Taproot milestone updated; completed branches collapsed recursively.
