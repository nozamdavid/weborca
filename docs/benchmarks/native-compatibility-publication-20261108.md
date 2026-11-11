# Native compatibility publication — 2026-11-08

Published at https://server-1.barbel-hops.ts.net:5070/ on 2026-11-08, 14:47 UTC. This is a native fidelity release. Native slicing speed parity remains **OPEN**.

The immutable live root is `wasm/build/native-compatibility-publication-20261108/candidate` in `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`. Evidence and private reproduction harnesses live beside it. No commit, push, PR change, frontend build or further product algorithm change was made in this batch.

The running service PID, environment root, lexical-last override and frozen `v250-empty-recovery/server.mjs` were inspected before packaging. The previous root was `wasm/build/v250-export-align/candidate`. The new root copies that actual frozen app and replaces only the reviewed clean engine pair. The loader happens to be byte-identical: `artifact-diff.txt` shows only the WASM differs. All nonengine files, including UI, Preview, STEP, profiles, recovery, cache, download progress, painting and Export alignment assets, are retained. Full file manifests pass before and after acceptance. No diagnostic engine, private harness or authentication state enters the served root.

Reviewed production inputs:

| Input | SHA256 |
| --- | --- |
| `src/libslic3r/Arachne/utils/PolylineStitcher.hpp` | `4ed34af4dac628a7db21a7f08371ed7060095019ab74d0c8d7a445d6b470414e` |
| `src/libslic3r/PerimeterGenerator.cpp` | `848049afb17bb502f30cc4b9b7b0b6b9a257c96cc74663ff761b9d3f4f44788e` |
| Live `orca_engine.mjs` | `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7` |
| Live `orca_engine.wasm` | `df6c8b6aae6fd8ba1558bcff09c79240de45bd6d3728ddfbfc135096021d7d4a` |
| Live module+WASM version | `5de92b21195943b3f68ceadc7f73fc89be78b324c2b4127d72f496c7f41cf3ea` |

The production changes are the stitch-local `small_vector<Index,2>` newest-equivalent-first visitation and the six-line single fully supported open-path endpoint rule. The indexed-chain alternative is rejected. [Stitch qualification](native-stitch-qualification-20261108.md) and [endpoint integration](tree-endpoint-integration-20261108.md) retain actual native/WASM translation-unit compilation, clean archive/link provenance and the synthetic red-before/green-after regression. Those binaries are reused because the reviewed source inputs did not change. Existing logs confirm native/WASM focused regression passes and 34 fixtures per platform. The final batch reran the integration assertions, without gratuitous recompilation.

All imports, slicing and CPU comparisons use exclusive `/tmp/weborca-parity-benchmark.lock`. T3 preview reported unavailable. Actual headed `/opt/helium/helium` uses isolated profiles and normal original-STL import, Keep original, source preset selection, Save project, Slice and File → Export. The immutable app is reused for local and public QA.

Tree passes fresh local **and authenticated public** exact original installed-GUI comparison: all **1,373,125 executable commands including M73**, SHA256 `4a1e0166df5e9ddbcff33a77988bc380a86cff4c63c679c0c34b71578f394fab`. Full baseline configuration and ordered saved vertices/facets/transforms are retained. Six native GUI state keys remain unequal; raw G-code bytes and complete native configuration parity are not claimed. The existing combined bracket gate retains all **70,860 baseline commands including M73**, digest `e0992f3ce802c0946f9da180c00ff16520c01637b13ad3c7142099f93f756734`, and full baseline config. This is bracket preservation, not original-GUI bracket parity.

## Lily acceptance

The 36 MB original Lily STL was newly imported through the same full headed app with the old frozen engine and combined candidate. Exported baseline/candidate config and ordered saved geometry match. Executable commands change from 469,776 to 470,097; hashes are `4fa9f37cd475f9e3a63e2cfa72f87d73c33e049150c4f12c952a43a89409bb82` and `83ac673a24c595d61cf955dcc0179b2188a68fd1c9e3db1eeca3f478e0613be1`. The initial exact-preservation assertion intentionally fails and is retained in `lily-result.json`; it requires a GUI oracle rather than accepting the historical CLI comparison.

The unchanged installed Flatpak 2.5.0 GUI was launched with an isolated copied datadir on owned Xvfb :90, using the prior desktop-tree source vendor/preset seed. It imports the original STL without simplification (752,232 triangles), selects the same Voron/Standard/Generic PLA presets, saves before slicing, and exports normally. An initial High Temp/55°C capture is retained. A fresh original import with Support multi bed types enabled and Smooth Cool Plate selected supplies the final Cool Plate/35°C oracle (`desktop-lily.gcode`, `desktop-lily-cool.3mf`). Only task-owned portal windows on :0 were operated. No user configuration or project was changed.

All 496 changed layer/role deposition groups were checked against that actual GUI oracle using directed emitted XYZ/E segment signatures with multiplicity. **309 now match the native group sequence exactly; zero previously exact groups regress.** Directed segment multiset distance improves in **485 groups** and stays equal in **11**, with **zero worse groups**. The other 187 groups remain sequence-unequal; equal segment distance is not proof of sequence parity. `lily-native-result.json` and `lily-distance.json` retain every group and comparator output. There is no unexplained worsening under these acceptance checks, and no nonfinite executable output. Lily is accepted for native fidelity improvement, **not exact executable parity**. The six known native GUI state differences remain; the generated estimated-time comment also differs. The old CLI Lily comparison remains historical CLI evidence.

## Public release and recovery

`release.sh` snapshots and guards the actual previous root, all existing service overrides, frozen server, private environment identity and Tailscale routes. It adds only the derived lexical-last ORCA_ROOT override. Providers, caps, durable state and private alpha configuration are retained. Restart resets in-memory sessions. `deploy.log`, `runtime.txt`, `deployed.txt`, manifests and environment hash comparisons retain evidence.

Authenticated public checks pass exact engine pair and supporting asset bytes, version metadata, obsolete-version rejection, COEP/COOP, private cache headers, unauthenticated protection, app/admin authorization separation and logout revocation. Durable invites are unchanged. The server hashes module plus WASM; the retained client performs HEAD with `no-store` and uses the new `?v=` pair key.

The public headed client was seeded with the **actual old release binary** in its isolated CacheStorage under old version `5738ecf0ecad00d546cc34f2b9dbc2c641c83cafbf2fdf7bd55d79491c989ae5`. It fetches the new versioned WASM once, exports the exact native tree, then refreshes with a fresh HEAD and **zero WASM network requests** (`tree-public/cache-result.json`). Refresh retained the Preview route, which does not initialize the engine until Prepare is opened; Prepare was selected through the normal UI. The reproduction driver now includes that step. One earlier local login-dialog timeout was preserved and excluded; the private driver adds one retry. No app rebuild was required.

Rollback is retained as:

```sh
bash /home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/native-compatibility-publication-20261108/release.sh --rollback
```

It removes only the matching new override, verifies the exact previous root/manifests/environment/routes and checks its authenticated public assets. Activation or public acceptance failure automatically invokes it. This successful publication did not require rollback; no claim of an exercised rollback is made.

## Limits

The [cost investigation](stitch-grid-cost-20261108.md) remains current: two 21-sample batches show no persistent affected-perimeter regression, but a 2–3 ms whole-region cost could not be excluded. A later three-way batch places small-vector +0.695 ms from old at pooled medians and chain worse. These observations do not establish zero overhead, a speed optimization or native-speed parity. No further performance experiment was run.

Both original 3MF validation blocks remain unchanged; neither is silently corrected or claimed as successful slicing/painting coverage. Bracket residual native differences, Lily residual sequence differences, six GUI state keys, physical hardware and other browsers remain outside completed parity. The tree executable milestone supersedes older tree-residual-open statements; general native compatibility and speed remain open.

`release-inputs.sha256` records the reviewed sources, qualified build manifests, frozen server, retained cache loader and final engine pair. Final manifest verification, report links and shell/JS syntax checks pass. README and KNOWLEDGE reflect this release. Taproot records the completed publication beneath the release-review milestone, marks the tree correction complete and recursively collapses completed branches while retaining the open speed/general parity work (`tracking-receipt.json`, `taproot-after.json`). The shipped-baseline branch was at its 12-child capacity, so the new evidence node uses the existing release-review branch. All owned browser/server/desktop sessions are closed; the live service stays active.
