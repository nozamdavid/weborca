# Multi-instance Scale — 2026-11-10

Implementation candidate on shared HEAD `6773b526d0`. Existing uncommitted box
selection, README and report changes retained. No commit, publication, parent
checkout write, README or Taproot update. Independent acceptance remains pending.

## Red signal and cause

Owned T3 preview tab on the accepted private HTTPS5065 build. Imported two small
tetrahedron STL files through the real store/engine, selected both (26/43 and
66/83), then clicked Scale. Browser probe returned:

```text
mode: scale; primary: 26; extras: [{objectId:66,instanceId:83}]
numeric: false; gizmo: null; pass: false
```

Screenshot: `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-server-1-barbel-hops-ts-net-mwb9huyt-0a0b681e.png`.
Initial localhost5064 navigation failed; the private accepted service was used.
Ranked falsifiable hypotheses were shown before implementation: extra-selection
numeric gate, scene gizmo gate, primary-only store mutation. All three are present.
Revealing the primary editor alone would therefore be incorrect.

## Change and semantics

- `plate/multiScale.ts`: resolves/deduplicates live instance references, computes
  actual mesh bounds, and prepares positive scale/offset entries for selected
  instances only. Same-object unselected copies are untouched.
- `plate/plateStore.ts`: group scale uses these entries with the existing
  `setInstanceTransforms` transaction, one refresh/history commit and one explicit
  preview invalidation. Rejects invalid factors, busy/history restoration and
  selection/object replacement during asynchronous mesh loading.
- `plate/NumericTransform.tsx`: group Scale percentages and bounds size controls,
  proportions lock, async/busy state and explicit whole-instance/world-axis label.
  Percentage fields are relative factors and reset to 100 after each operation.
  Number input parsing now rejects trailing junk and resets submitted text.
- `plate/PlateView.tsx`, `mobile/MobilePrepare.tsx`: expose group numeric controls
  in Scale mode. Mobile retains its tools disclosure and existing single controls.
- `locales/en.json`, `locales/es.json`: group semantics and rotation constraint.
- `tests/node/multi-scale.test.mjs`: six focused regressions.

Pivot is the selected world bounding-box XY center and minimum Z. Scaling changes
spacing around that pivot and multiplies each existing scale; rotation and mirror
are preserved. Existing native `setInstanceTransform` drops each transformed
instance to the bed, independently, without transforming other copies.

Axis factors are mapped through rotation to local axes only when this represents
the exact world stretch without shear (including quarter-turn rotations). Uniform
scaling always qualifies. UI conservatively keeps proportions for arbitrarily
rotated selections; it explains why. No approximate matrix decomposition/shear.
Group controls always edit whole instances even if the object tree has a volume
selected; the label states this. Single-selection volume controls are retained.

Concrete limit: group gizmo remains detached. Its existing manipulation path
targets the primary mesh; enabling it would silently scale one object. This
candidate provides numeric group Scale, not group gizmo or touch-body scaling.
No native Orca group-pivot parity claim. Per-axis unlock for special rotations
that happen to admit only particular nonuniform factors is conservative.

## Verification and immutable build

`node --experimental-strip-types --test wasm/tests/node/multi-scale.test.mjs
wasm/tests/node/box-selection.test.mjs wasm/tests/node/html-object-label.test.mjs
wasm/tests/node/html-plate-title.test.mjs`: **21/21 pass** (6 new + 15 existing).
New coverage: selected copies/two objects; uniform spacing; per-axis mapping;
rotation/mirror preservation; stale/deduplicated references; invalid factors;
real store transaction through a stubbed engine/history boundary; one commit,
one invalidation and cancellation after object replacement. This verifies the
history transaction call, not a full native undo/redo replay. Tests were added
after the browser red probe; no pre-fix unit-test failure is claimed.

`npx --no-install tsc --noEmit`, locale check (22 catalogs), `git diff --check`
passed. Impeccable detector returned `[]`. No C++ changes or native compile.

Exactly one integrated build, `wasm/build/ui-multi-scale-20261110`, with read-only
parent dependencies and
`ORCA_ENGINE_DIR=/mnt/appdata/workspace/OrcaSlicer/wasm/build/orca-wasm64/wasm/engine`.
Build completed successfully; incumbent chunk-size and unresolved build-time
URL warnings remain. Logs, source hashes and full candidate manifest are in
`wasm/build/tests-multi-scale-20261110/`.
Candidate manifest SHA256:
`4286c037ce2bfc9f6801a25d6bd328180528350c2331f0f4e36e8788d1c6efbc`.

## Browser green and QA limits

Served that candidate once on own temporary 5067 server; reused owned tab.
Imported the same two distinct STL objects, selected both and clicked the
Spanish Escalar button. Probe returned `mode: scale`, `visible: true`,
`disabled: false`, and the translated group semantics label. Native input-value
setter plus bubbling input and blur exercised the React numeric handler at
150%. Both real engine instances returned scale `[1.5,1.5,1.5]`; field reset to
100. This was instrumented DOM input, not physical typing.
Screenshot: `/home/david/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mwb9iyum-a93eec3f.png`.

Independent corrected-browser QA remains pending: mobile/touch, both themes,
physical numeric input, full undo/redo, rotated/mirrored real engine fixtures,
and paint/cut/measure/body gesture integration. Existing box gesture evidence
is retained, not repeated. Accepted private 5064/HTTPS5065 service was preserved;
no Tailscale change. Own 5067 process/tab and temporary dependency link removed.

## Independent scoped acceptance

Scoped PASS for numeric multi-scale and native transaction integrity, 2026-11-10.
No source changes or rebuild. Verified every file in candidate.sha256 and its
manifest digest 4286c037ce2bfc9f6801a25d6bd328180528350c2331f0f4e36e8788d1c6efbc.
Prior 21/21 tests, tsc and locale results retained, not independently rerun.

Method: own T3 tab and temporary loopback5067 Vite preview. Imported two distinct
STL files through actual store/native engine. Created two additional native
instances of the first object. Instrumented store selection chose two copies of
that object and the second object; third copy remained unselected. Selection was
not a physical modifier-click/box gesture. Dismissed session recovery modal before
interacting. Actual preview_act.type(clear=true) and Enter submitted 150%.

Selected native scales [1,2,1], [1,1,1], [1,1,1] became [1.5,3,1.5],
[1.5,1.5,1.5], [1.5,1.5,1.5]; unselected copy remained [1,1,1] at
[220,100,10]. Selected XY offsets [80,100], [140,100], [170,160] became
[58.75,83.75], [148.75,83.75], [193.75,173.75], consistently stretching
spacing 1.5 around [122.5,132.5]. Relative field reset to100. One actual Undo
button restored all transforms and membership; one Redo replayed them. History
recreates native IDs; comparison excluded IDs. It also restored primary-only
selection, so subsequent group tests explicitly reselected instances.

Real mirrored arbitrarily rotated instance (.37rad) with mixed existing scale
retained mirror [1,1,-1], rotation (floating-point tolerance), and scale ratios
under a further typed uniform150%. Uniform checkbox checked/disabled, Spanish
shear explanation visible. Real90deg instance world X120% changed local Y from
4.5 to5.4 while local X/Z stayed2.25; unrotated selected instances changed local X
only. Size X337.5 then typed300 produced combined X300, Y191.25/Z67.5 unchanged.
Zero, -1 and Infinity typed on mobile produced no transform changes and reset100.
Single selection retained absolute Scale semantics (typed250 yielded X2.5).
Measure button toggled measure state successfully; no exhaustive gesture audit.
Code inspection found positive/finite guards, stale objects/selection identity
checks and representability check; async stale/busy races rely on existing units.

Desktop1280x800 dark and CSS light theme sampled. Mobile320x740 and390x844
exposed group controls through Plate tools, enabled when idle, scroll-reachable
through existing wm-prepare overflow:auto. No horizontal page overflow (320/320,
390/390). Theme light was instrumented via data-theme; no theme menu test.
Group gizmo stays detached as documented. Native per-instance bed-drop is expected;
no native exact group-pivot parity claim. No new material correctness bug found.
Prior Shift box/toggle/body/camera and HTML-label evidence is retained, not repeated;
physical-device, exhaustive paint tools and native group gizmo remain outside PASS.

Screenshots (absolute browser-artifact directory /home/david/.t3/userdata/browser-artifacts/):
- browser-screenshot-localhost-mwb9nw6r-2bf599cb.png — mobile320 before scroll.
- browser-screenshot-localhost-mwb9o70v-f7137d27.png — mobile390.
- browser-screenshot-localhost-mwb9okm4-068bb40d.png — desktop dark.
- browser-screenshot-localhost-mwb9oulg-52a29643.png — desktop light, axis scale.
- browser-screenshot-server-1-barbel-hops-ts-net-mwb9ridm-d82edb48.png — private URL.

### Private service receipt

Inspected pidfile/process1134442 before replacing only its5064 Vite service.
Persistent replacement PID1283822, same candidate, existing private HTTPS route:
https://server-1.barbel-hops.ts.net:5065/ . Initial launch exited before startup;
setsid replacement verified running. HTTPS200, COOP same-origin, COEP require-corp,
Cache-Control no-cache; exact HTML SHA256
ff35693764b719dcb542481dea6837634097e1d1c9db8cd794d1bdc96532ad0d.
Actual private URL: imported two native objects, selected both, clicked Scale,
typed150/Enter; both native scales1.5, reset100 and English Group scale label.
No route/Funnel/public5070 changes. Pidfile wasm/build/preview-5064.pid;
log wasm/build/preview-5064.log. Stop after checking command:
`ps -p $(cat wasm/build/preview-5064.pid) -o args=` then
`kill $(cat wasm/build/preview-5064.pid)`.
Own QA tab and temporary5067 server closed. No dependency link created.
README updated; local completed Taproot milestone carries report/hash/test/native
undo evidence. No commit, push, PR, parent checkout write or source edit.
Taproot receipt: completed node b6fD577WF7S2Uk beneath existing box-selection
milestone (open-work parent hit its12-child limit). Completed parent collapsed;
existing tree inspection found no other uncollapsed branches with all children
done. Completion statuses preserved.
