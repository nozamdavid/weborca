# v2.5 configuration adapters

Status: both narrow S1 failures are fixed, compiled and verified against matching S2. All 43 selected native-backed checks pass under the shared 2 GiB cap. S1 failures remain recorded. No production app build or shipped milestone is claimed.

Worktree: `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`, base `709ff3ecd09824b4f2bd3a78f398c3a038811243`. Read the original checkout's `AGENTS.md` and [configuration compatibility investigation](/mnt/appdata/workspace/OrcaSlicer/docs/v2.5.0-integration/config-compatibility.md), and this worktree's [merge foundation](merge-foundation.md). No commits, branch changes, production build, deployment, or original-cache writes.

## Changed files and contracts

- `wasm/engine/Engine.cpp`: shared native `normalize_options` uses `PrintConfigDef::handle_legacy` once per supplied value before schema filtering and strict typed deserialization. The deserialization config suppresses its second implicit legacy pass. Explicit canonical keys take precedence over aliases, even when the canonical value is invalid. Original keys appear in diagnostics. Unknown/retired settings remain nonfatal; malformed known settings prevent the whole batch from committing. `setOptions` stages and commits the complete normalized batch. `normalizeOptions` returns `{options, errors}` without mutation and returns an empty map on any fatal error. Compatibility override evaluation uses the same conversion. Serialized `getOption` baseline projection accepts legacy arc values while retaining native string/vector projection. `resolvePreset({kind,name})` returns `{name}` from native rename metadata with no first-visible fallback. Selected filament names are canonicalized before native storage.
- `wasm/engine/ConfigRules.cpp`: smoothing emits `enable_arc_fitting=disabled`.
- `wasm/engine/ObjectOps.cpp`: subsequent engine-object compilation found two obsolete `ModelInstance::auto_drop` accesses. Upstream `a338f6ca7d` moved the shared-Z drop flag to `ModelObject`; merge now reads each source object's flag and disables drop on the merged object if any source disables it. Exactly two access expressions changed. Core owner recompiled successfully; existing world-transform merge cases will run with the matching module.
- `wasm/engine/PaintToolsOps.cpp`: smart fill supplies the newly inserted `Vec3f::UnitZ()` argument before its existing `force_reselection=true`, preserving vertical-up and reselection semantics. Exactly one call changed; compiled successfully after source-settled notification.
- `wasm/engine/RepairOps.cpp` and `wasm/engine/API-repair.md`: migrate the removed `MeshBoolean::cgal::repair` API to `Slic3r::repair_mesh`/`MeshRepairStats`, including the existing pre-clean/retry path. Keep the cloned-model transaction, explicit new-volume IDs, painting remap/clear, errors and empty-result rejection. Native `removed_triangles` feeds `facetsRemoved`; measured degeneracy plus actual pre-clean removals feed `degenerateFacetsFixed`; `edgesFixed` remains zero because welded vertices are not edges. `wasRepaired` includes native `modified` plus actual geometry/health comparisons. The synchronous web repair API supplies no progress/cancel callback; exceptions still unwind without committing the candidate model. Native cavity/solid-shell semantics replace the removed self-union repair. Compiled successfully after source-settled notification.
- `wasm/app/src/store/appStore.ts`: normalizes persisted preset/override maps before baseline filtering and application; process/printer user preset override bookkeeping uses canonical serialized values. Saved setup restoration and user-preset system-parent lookup resolve loaded names through native metadata before exact-name rejection. Packaged rename metadata locates missing vendor bundles, then native collections resolve the name. Hinted vendor lookup and the existing lazy catalog path are preserved.
- `wasm/app/src/engine/orcaEngine.ts`: `selectPresets` exposes the native selected names/count result rather than discarding it.
- `wasm/tests/node/configdef.test.mjs`: arc enum definition and all canonical modes.
- `wasm/tests/node/rules.test.mjs`: both active arc modes produce/apply the canonical smoothing fix; inactive smoothing does not force a fix.
- `wasm/tests/node/preset-config.test.mjs`: old PrintaLot filament name resolves, reads the same config and selects the canonical name; unknown names still fail.
- `wasm/tests/node/set-options-rollback.test.mjs`: TPMS/IXEX migration, canonical precedence, fatal atomic rollback, legacy boolean arc bulk/reset projection.
- `wasm/tests/node/filament-temperature-settings.test.mjs`: production-store saved boolean arc baseline/reset/reapply and renamed saved filament restore; focused project-map/feature-selector deletion reproduction. Existing native typed string/vector import and deletion checks remain.
- `wasm/tests/node/repair.test.mjs`: add native no-solid failure rollback and assert valid-mesh repair is geometrically unchanged, retaining the existing explicit volume-ID and painting checks.

## Executed verification

| Check | Result |
| --- | --- |
| Isolated `npm ci --ignore-scripts --no-audit --no-fund` in `wasm/app` | Pass; lockfile unchanged. |
| `wasm/app/node_modules/.bin/tsc --noEmit` from `wasm/app` | Pass, repeated after store/signature changes. |
| `node --check` for the six changed test files | Pass. |
| Production-store action extraction/transformation | Pass after correcting the new restore helper's extraction boundary. |
| Existing six pure slot/vector tests, selected with `--test-name-pattern` | 6 passed; these do not load or qualify a native module. |
| Fresh memory64 Engine.cpp and ConfigRules.cpp translation units | Pass via core owner's serialized 2 GiB runner. [Log](../../wasm/build/v250-core-evidence/engine-adapter-units.log), peak 1,225,379,840 bytes, zero swap. Existing TextOps/ObjectOps PlateData tag warning only. |
| ObjectOps.cpp after shared-Z flag migration | Pass in [engine-objects-fixed.log](../../wasm/build/v250-core-evidence/engine-objects-fixed.log), before that batch reached the subsequent PaintTools argument failure. PlateOps/PaintOps also compiled unchanged. |
| PaintToolsOps.cpp with vertical-up argument | Pass in [engine-objects-final.log](../../wasm/build/v250-core-evidence/engine-objects-final.log), before the subsequent removed RepairOps API failure. |
| RepairOps.cpp with native MeshRepair API | Initial pass in [repair-adapter.log](../../wasm/build/v250-core-evidence/repair-adapter.log); subsequent S2 compile/link/runtime evidence below covers the no-op annotation fix. |
| `git diff --check` over owned changed files | Pass. |
| Merged-source pack/layout generation | Pass; paths below. |

Fresh artifacts, all inside the integration worktree:

- All 72 vendors plus resources: `wasm/build/v250-config-evidence/catalog/`, generated with `node wasm/web/tools/pack_profiles.mjs . wasm/build/v250-config-evidence/catalog`.
- Focused native-test packs: `wasm/build/tests-node/`, explicitly regenerated for Voron, BBL, Prusa and OrcaFilamentLibrary.
- Settings layout: `wasm/build/v250-config-evidence/settings/layout.json`, generated with `node wasm/settings/extract_tab_layout.mjs . wasm/build/v250-config-evidence/settings/layout.json`.
- Settled adapter/store source hashes: `wasm/build/v250-config-evidence/source-hashes.txt`.

## Pending matching-module checks and risks

### S1 runtime evidence and S2 handoff

S1 immutable engine pair: `wasm/build/v250-engine-module/orca_engine.mjs` SHA-256 `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7`, WASM `393dee1b4822ec060c372ada3d42586e6288456ffa1b318cbab02005b439fccb`. These tests used the matching freshly linked v2.5 module and regenerated packs, never the old module.

The first multi-engine process exceeded the 2 GiB cap because separate Module/thread pools outlive C++ `Engine.dispose`; its evidence is retained in `native-tests-initial-oom.log`. Before termination it passed four configdef cases, six pure slot cases, saved arc/alias baseline-reset-reapply and renamed saved filament restoration. The subsequent serialized per-case process run completed at 1,271,582,720 bytes peak and zero swap. Logs under `wasm/build/v250-config-evidence/` record: prefill 1 pass, import 1 pass, first/middle/last typed slot deletion 1 pass, preset config 3 pass, options rollback 9 pass, rules 9 pass, merge conversion 1 pass, merge transform 1 pass and smart-fill/overhang 2 pass.

Two S1 logs deliberately remain red: `slot-risk.log` retained `filament_map=1,2,1` after deleting its middle slot; `repair.log` passed 7 cases and failed the unchanged cube's painting preservation. The valid-cube no-op was unnecessarily routed through a spatial annotation remap. No-solid repair rollback and repaired-project slicing/roundtrip passed.

Authorized S2 fixes change exactly two native TUs:

- `Engine.cpp`: native `removeFilamentSlot` stages the bundle, model and plate data; typed vectors/maps lose the removed slot's stride, surviving map values retain their identity, and Default0 feature selectors remain zero while explicit IDs relocate. Existing `remap_model_filament_slots` remaps object/volume extruders and MMU paint simultaneously. Selection, user values, baseline, effective config and rules validate/serialize before committing. Exceptions restore bundle/options/selection; candidate geometry and plate data are discarded. Store deletion consumes that single transaction, publishing browser selection/maps only on success. Unknown/retired override behavior remains nonfatal.
- `RepairOps.cpp`: bypass annotation remapping only if ordered vertex arrays and ordered triangle-index arrays are exactly equal. Same counts alone do not qualify. Explicit `keepPainting:false` still clears annotations and successful repair still returns new volume IDs.

S2 settled hashes are in `wasm/build/v250-config-evidence/s2-source-hashes.txt`: Engine `88a0786790cac992ba1d04da778529a2d7edcb72361ba034ae3b7943823868c2`; RepairOps `ca5fac8a112ab28ff0dc9cc530bec49d78e5312e65ae91b113f97bd5db464a67`. Both TUs and linkage pass in `wasm/build/v250-core-evidence/engine-s2-link.log`, peak 1,248,354,304 bytes, zero swap. Core and Preview archives are unaffected. App TypeScript and changed-test syntax checks pass after these fixes.

S2 immutable pair: `wasm/build/v250-engine-module-s2/orca_engine.mjs` SHA-256 `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7`, WASM `452c0ab51a0b935f691384e629d73ad0005fda99733b059d18cc600c0d4c1f19`. Both module and settled source manifests rechecked successfully before and after runtime verification.

S2 runtime runner `v250-config-s2-cases-1794057166236328365` completed successfully under the original shared serialized 2 GiB runner: peak 1,263,935,488 bytes, zero swap, exit 0. Complete output: `wasm/build/v250-config-evidence/s2-capped-run.log`; individual `s2-*.log` results: slot risk/atomic rollback/paint 1, saved baseline 1, saved rename 1, configdef 4, filament prefill 1, project import 1, first/middle/last deletion 1, preset config 3, options rollback 9, rules 9, repair 8, merge convert 1, merge transform 1, smart-fill/overhang 2 — **43 passed, zero failed**. The six pure slot/vector checks also passed after the S2 changes. App TypeScript, changed test syntax and owned `git diff --check` pass.

An earlier S2 launcher used a relative script path; the runner's fixed original-checkout working directory rejected that path before executing tests. Its exit-127 evidence is retained as `s2-launch-path-failure.log`. The successful invocation used the absolute integration script path and explicit S2 module path. S1 `slot-risk.log` and `repair.log` remain red and unmodified.

The focused deletion case now checks validation failure before projection and after staged native selection, exact config/tree/paint rollback, browser slot/map rollback, surviving color paint state 3→2, Default0 vs explicit selector IDs, and surviving volume assignment. Repair checks byte-exact original support annotations on the unchanged cube. These checks address the reproduced seams only.

The coherent module uses memory64/pthreads/WASM exceptions, SDK 6.0.11, fresh CGAL 6.2.1 prefix `wasm/build/prefix-v250-wasm64`, and build root `wasm/build/orca-v250-wasm64`. The core owner exclusively owns that root. No native tests were run against an old module.

Initial S1 TU evidence was bound to source by timestamps: Engine.cpp modified 13:20:20 CET and object 13:26:38; ConfigRules.cpp modified 13:18:45 and object 13:26:41 on 2026-11-07. SHA-256 then: Engine.cpp `f21feeaeb6c1b9c48fa017f1b424e84a529ee84a65973b65536fe954fbe79e08`; ConfigRules.cpp `e99c7f1fbdbc6c705b73f6f9c29cb5001ec006a5ab4d985576b92efba73e9c48`. Engine and RepairOps later changed as explicitly recorded for S2; other adapter objects remain reusable. No duplicate compile was started.

`wasm/build/v250-config-evidence/run-tests.sh` now requires explicit matching `ORCA_ENGINE_MODULE` and writes separate `s2-*.log` files, preserving S1 evidence. Invoke it through the original serialized 2 GiB runner. No second Ninja process or reconfigure may race the core owner's root.

The S2 deletion fixture also covers plate-specific map projection and rollback. Variant composition for a physical Hybrid nozzle remains unqualified: native selection uses `filament_volume_map` to select a concrete variant only for Hybrid physical nozzles, so Standard-nozzle settings are not a valid differing-temperature reproduction. No passive map persistence or source inspection is being reported as proof of mapped slicing or parallel-print behavior. No broad mixing, belt or parallel-print feature additions were made.

No remaining compile/runtime blocker affects the two authorized fixes or the selected compatibility workflows. Physical Hybrid mapped slicing and minimum multi-tool slot behavior have no focused runtime acceptance here and remain integration coverage limits. The merged-source profile/layout artifacts above are ready for subsequent integration acceptance; lazy catalog behavior was retained.
