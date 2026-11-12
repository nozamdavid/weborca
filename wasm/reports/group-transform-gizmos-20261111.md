# Group Scale and Rotate gizmos — implementation candidate

Shared HEAD: `6773b526d06b8e7933e18955b508a7d5d1022fee`. Independent acceptance pending. Existing box selection, numeric scale, labels, branch and preview service were preserved.

Changed implementation: `wasm/app/src/plate/PlateScene.ts`.
Added regression: `wasm/tests/node/group-transform-gizmos.test.mjs`.

Multi-selection Scale and Rotate attach the existing colored TransformControls to a scene proxy at the selected bounds center, with Z at the bounds bottom (the numeric group Scale convention). Drag snapshots preserve signed scale and ZYX orientations. Scale handles apply uniform scale to all selected instances and their distances from the pivot; this deliberately avoids shear even with arbitrary rotations. Rotate applies the proxy quaternion to both positions and orientations. The existing absolute-transform batch callback commits the selected instances together. Mirror signs remain in mesh scales; native entries retain the existing positive scale plus stored mirror convention.

Escape, pointer cancellation/lost capture, selection changes, object refresh, mode change and destruction restore group snapshots and orbit state. Busy state is checked at start, change and commit. The group snapshot is cleared before drag state changes or callbacks, preventing duplicate commits.

## Evidence

The first runnable scene-method reproduction failed before implementation with missing `beginGroupDrag`; setup failures preceding that were resolved. `wasm/build/tests-group-transform-gizmos-20261111/red.log` records this result. The final regression asserts actual scene attachment to the proxy and drives the real group begin/change/finish methods and `commitMeshTransforms`, with browser/store boundaries stubbed. It checks group Scale and Rotate, a rotated mirrored instance, selected same-object copies, an unselected copy, positive native scales, one batch, repeated finish, cancel restoration and busy rejection at commit.

Command:

```sh
node --experimental-strip-types --test wasm/tests/node/group-transform-gizmos.test.mjs wasm/tests/node/multi-scale.test.mjs wasm/tests/node/box-selection.test.mjs wasm/tests/node/html-plate-title.test.mjs wasm/tests/node/html-object-label.test.mjs
```

Result: 23 passed, 0 failed (`wasm/build/tests-group-transform-gizmos-20261111/tests.log`). Existing numeric group Scale suite includes the real store history/batch boundary. `wasm/app/node_modules/.bin/tsc --noEmit` from the app directory passed. `git diff --check` passed. No locale changes in this task.

One integrated build completed using Vite with `ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine` and output `wasm/build/ui-group-transform-gizmos-20261111`. Build log is in the evidence directory; existing chunk-size warnings remain. Candidate files have write bits removed; SHA256 inventory: `wasm/build/tests-group-transform-gizmos-20261111/candidate.sha256` (paths relative to candidate directory).

Implementation SHA256: `c5898ac75a013c8b32f6c9a88011aefe4dd8bbc122c61f0fceb6df1a4ecc79b0`.
Regression SHA256: `0bb301cf373da3debeca2736d9f2763ab65dc330eb166a2b64f3fabe2955aa67`.

## Acceptance checks and limits

No browser work or native end-to-end drag/Undo was performed. The narrow scene test bypasses WebGL construction and pointer raycasting. Independent acceptance should reuse this immutable candidate:

1. Select two objects and two selected copies of one object; leave another copy unselected. Check colored Scale and Rotate handles appear.
2. Drag each scale handle with mixed existing rotations, nonuniform scales and mirrors: group scaling is uniform, relative scale ratios and orientations survive, unselected copy stays fixed.
3. Rotate around X/Y/Z: positions and orientations turn together. Verify native refresh, Undo then Redo affects the whole group in one transaction. Native bed-drop behavior may adjust final Z.
4. During a drag, test Escape, pointercancel/lost capture, selection changes and busy transitions; verify restoration, usable orbit and no history commit.
5. Check ordinary single-instance/volume transforms, translation/body movement, box selection and labels.

The persistent accepted preview PID1283822 / URL5065 was not refreshed. No commits, push, branch switch, merge, deployment, or project milestone completion was made; parent acceptance owns milestone tracking. The temporary dependency symlink created for verification was removed.

## Busy-to-idle review fix

Independent review found attachment could remain detached after a busy operation ended. `PlateView.tsx` now refreshes the existing gizmo effect when movement availability changes (`bedConfigLoading`, `isSlicing`, `isRestoring`), including return to idle. The stale single-selection comment in `PlateScene.ts` was corrected. Existing 23 focused tests, full app TypeScript compilation and whitespace validation passed after this scoped fix. No extra test was added for an effect dependency change; corrected-candidate browser smoke must exercise the actual subscription/attachment transition.

One corrected integrated candidate was built at `wasm/build/ui-group-transform-gizmos-idle-20261111` and frozen read-only. Manifest: `wasm/build/tests-group-transform-gizmos-20261111/idle-candidate.sha256`. Build log: `idle-build.log` in the same evidence directory. Independent pointer/native acceptance is running against the first immutable candidate; corrected-candidate smoke remains pending.

## Independent focused browser acceptance — 2026-11-11

Scoped PASS for group Scale, Z Rotate, native transaction replay, cancellation
restoration, single-object Scale and corrected idle attachment. Original candidate
manifest entries all verified. Corrected candidate
`wasm/build/ui-group-transform-gizmos-idle-20261111` also verified against
`tests-group-transform-gizmos-20261111/idle-candidate.sha256`; manifest digest
`84ee82ee7f1d9b16f9852b58b27a7966d51f463ed147689e1c80cfdcc5e494f6`.
No source edits or rebuild by acceptance agent; existing tests/tsc evidence reused.

Own fresh T3 tab, 1280x800 CSS, temporary5067 server. Imported three watertight
20mm tetrahedron STLs through real store/native engine; two selected, third left
unselected. Fixture creation/selection was instrumented store input. Colored
Scale boxes and Rotate rings visibly rendered around selected bounds. Actual
pointer acceptance used 4px DOM markers forwarding pointermove/down to canvas
with the SAME active trusted pointer ID, preventing marker default drag. Capture
was true. Subsequent movement and release were trusted captured events. No
begin/change/finish transform methods were called directly. PointerHover scans
located real raycast handle hits; these only identified coordinates.

- X Scale drag from (655,474) to (625,474): both meshes and refreshed native
  instances scaled uniformly by1.2894509833. Existing scales [1,2,1] retained
  their2:1 ratio and .37rad rotation. Native offsets [80,100,10], [150,100,10]
  became [70.8179754,101.0466994,12.8945098] and
  [161.0795443,101.0466994,12.8945098]. Unselected [220,160,10], scale1 stayed fixed.
- One actual top-bar Undo click restored both native transforms; one Redo
  restored the whole scaled group. History recreated IDs; compared transforms
  by object name with serialization tolerance (~1e-8), then reselected group.
- Z Rotate drag (730,420) to (760,440): selected rotations increased together
  by.7030112563rad, positions became [77.5017991,73.4958118,12.8945098] and
  [146.3622431,131.8515315,12.8945098]. Mesh and native orientation/position
  agreed. Unselected object stayed fixed. Camera matrix drift <7e-11.
- During another captured Z drag, an objectChange listener injected Escape
  AFTER meshes changed. Immediate meshes restored exactly, native values
  unchanged, orbit false during drag then true immediately after cancellation.
  Subsequent release preserved native transforms. Continued pointer motion
  after cancellation orbited the camera, demonstrating navigation restored;
  immobility is claimed during active group drag only.
- Single-object X Scale handle committed local X1.28945098 ->1.40611603 while
  other objects remained unchanged. Camera still had post-cancel navigation
  motion, so single-object camera isolation is not certified by this sample.
- Mirrored first instance [1,1,-1], arbitrarily rotated and nonuniformly scaled,
  then group X-handle drag: all six selected native scale components multiplied
  by1.26831771977; rotations and mirror unchanged, mesh Z stayed negative,
  native scale positive, third object unchanged. Camera matrix unchanged.

Corrected-candidate smoke only: restored real fixture, selected two instances.
For BOTH Scale and Rotate, injected app isSlicing=true detached controls;
setting false automatically reattached the group proxy without mode/selection
changes. Both controls rendered again. This resolves the original candidate's
review finding that idle did not rerun the attachment effect. Bed-config/history
busy variants rely on source dependencies and existing regression evidence.

Screenshots in `/home/david/.t3/userdata/browser-artifacts/`:
- `browser-screenshot-localhost-mwbb7gev-301e0333.png`: original colored Scale.
- `browser-screenshot-localhost-mwbb8n0b-4032ea4e.png`: original colored Rotate.
- `browser-screenshot-localhost-mwbbavsk-ba58ba77.png`: corrected Scale after idle.
- `browser-screenshot-localhost-mwbbb5ew-0db06ca6.png`: corrected Rotate after idle.

Limits: forwarded start is instrumented, not fully trusted down. Escape is an
injected keyboard event. X/Y rotation, non-Z bed-drop, all scale handles, selected
same-object copies, pointercancel/lost capture and physical devices were not
repeated here; narrow tests/prior reports retain their explicit scopes. No full
browser matrix claim. No new product blocker found in this focused acceptance.

### Corrected private preview receipt

Inspected original PID1283822 command: Vite preview of ui-multi-scale-20261110,
private100.105.38.125:5064. Replaced only this process with PID1550591 serving
ui-group-transform-gizmos-idle-20261111, same preview config and HTTPS5065 route.
Initial immediate HTTP502 was startup timing; retry returned200. Persistent
pidfile/log remain `wasm/build/preview-5064.pid` and `preview-5064.log`.
No public route/Funnel/5070 changes. Browser at actual private URL loaded
OrcaSlicer Web and initialized __plateScene; session recovery/wizard remained
visible there, so feature interactions are the loopback acceptance above.

https://server-1.barbel-hops.ts.net:5065/ returns COOP same-origin, COEP require-corp,
Cache-Control no-cache. Served HTML SHA256 matches immutable file:
`f753b1d108c8d61bb2e9b6dee3cd592c9fea3f6d12d0177fccb4113045146118`.
Served assets/App-C0LgxN8N.js matches:
`ae794b53604b6dbd4e660497386f8ff3e4750a617bfce32f7f7369524dc9b872`.

README updated to describe group handles with explicit scope limits. Taproot
completed node3NpIr7IBytGeky under numeric Scale records this report, immutable
manifest, native/pointer evidence and limitations. Project version132 after
recursive complete-descendant collapse (numeric Scale branch was the only
uncollapsed completed branch with children). Completion statuses preserved.
Owned QA tab and5067 server closed; persistent5064/5065 preserved. Main-owned
node_modules symlink untouched. No commit, push, source edits or rebuild.
Documentation whitespace check passed; referenced report/screenshot files exist.
