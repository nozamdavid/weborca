# OrcaSlicer v2.5.0 integration assessment

Research date: 2026-11-07. Scope: source and release research only. No product changes, builds, test suites, merge, rebase, deployment or commits were performed. Effort and risk statements below are engineering estimates, not measured implementation results.

## Recommendation

Bring the **pinned v2.5.0 release into a dedicated integration branch through a staged merge**, preserving the WebOrca patch set and validating the native engine before exposing new browser features. Selective backports are useful for a few urgent fixes; they are a poor route to the complete release because slicing, configuration, profiles, multi-tool behavior and preview changes depend on one another.

This is a substantial engine upgrade, not a version-string change. A reasonable initial allowance is **20–35 engineering days** for an experienced C++/Emscripten/TypeScript engineer to integrate the release while retaining the currently supported browser workflows, including regression work. Making the major new desktop workflows available in the browser is additional work, plausibly **40–80+ engineering days** depending on feature scope. Python plugins and the Design tab need separate architecture decisions and are excluded from that browser-feature estimate. These ranges assume existing toolchains and fixtures work, one target WASM architecture, no new printer hardware qualification, and no prolonged external service problems. They are not sums of every row below: much validation is shared.

## Verified refs and ancestry

| Reference | Exact commit / result |
| --- | --- |
| Local `HEAD`, `main`, and local tracking ref `weborca/main` | `413cb95cb6107a6b8786444925d672b142e3f690` |
| Upstream remote | `origin`: `https://github.com/OrcaSlicer/OrcaSlicer` |
| Private fork remote | `weborca`: `git@github.com:nozamdavid/weborca.git` |
| Upstream `refs/tags/v2.5.0` | `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19` (direct commit ref; no peeled companion reported) |
| GitHub release | Official Release, HTTP 200, `draft=false`, `prerelease=false`, published `2026-11-07T07:13:09Z` |
| Release API target branch label | `release/v2.5.0`; the comparison uses the tag commit, not that moving branch |
| Shared fork baseline / merge-base with release | `e027f8b225edd3b05496f8c2e9e67f8352ebb9b3`, October 7, “Remove the CAD Primitive and Sketch gizmos from Prepare” |
| Shared merge-base with observed upstream main | The same `e027f8b225edd3b05496f8c2e9e67f8352ebb9b3` |
| Observed upstream main | `c01ac8ff4477d4b20efe9b0dc9a5cb8550a2c63e`; not substituted for the release |
| Earlier stable v2.4.0 | `6d9eb1792f50d11ea12d60526b6ace58666354fd`; ancestor of the shared baseline |
| Nearby release tags | v2.4.1 `19db9aa9c3f6720bceaff2d4c9c377362c440f4f`; v2.4.2 `8500fcdccaa10b5099ac20d252af3a7c560046f1`; v2.5.0-alpha `3880f2c58ec392ed2bd5938ab31c9c7c496c0eb2`; beta `345efec64c7b95a05ce5cf96df0dde66a158835c`; rc `af2ffb8cddd2f3c0bdadc56d9cc3945fb23577ea` |

The release tag exists; there is no fallback release in this assessment. The release is not an ancestor of our main. `git rev-list --left-right --count main...<release>` returns **109 fork-side / 1,376 release-side commits**, including upstream topic/merge ancestry. These are reachability counts, not independent feature counts. The baseline already identifies itself as `2.5.0-dev`; both baseline and release retain internal `SLIC3R_VERSION=02.08.01.55`. A matching internal version cannot establish source equivalence.

The baseline-to-release diff is 2,502 paths, including 244 under `src/libslic3r` and 1,279 under `resources/profiles`. Baseline-to-fork is 914 paths, including 70 across `src`, `deps_src`, `tests`, and root CMake. The fork has **no profile-tree changes relative to the shared baseline**. Most fork additions live under `wasm`; this limits textual conflicts but does not remove API or behavioral conflicts.

Sources: [release API](https://api.github.com/repos/OrcaSlicer/OrcaSlicer/releases/tags/v2.5.0), [official release notes](https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/v2.5.0), [baseline commit](https://github.com/OrcaSlicer/OrcaSlicer/commit/e027f8b225edd3b05496f8c2e9e67f8352ebb9b3), [release commit](https://github.com/OrcaSlicer/OrcaSlicer/commit/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19), and local Git commands recorded below. `weborca/main` here is the existing local tracking snapshot; the private remote was not contacted.

## What is actually new relative to this fork

The final release notes explicitly cover only changes since the release candidate. Read the [alpha](https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/v2.5.0-alpha), [beta](https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/v2.5.0-beta), and [RC](https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/v2.5.0-rc) notes for the full release story. Their headline list is relative to earlier releases, not our October development snapshot.

| Feature group | Source-proven state and practical browser consequence | Difficulty / indicative incremental effort |
| --- | --- | --- |
| Slicing, travel, infill, seams | New travel optimization (`69193d5681`, #16492), slicing performance work (`91ad6954ea`, #15985), pattern-neutral adaptive density, sparse-infill arc fitting (`373ffaa13f`, #16747), seam continuity and blocked-seam policies. Spiral Inset and Precise Seam source already exist at our baseline; the release improves them. Benefits in the native pipeline can reach existing browser slicing after rebuilding, even without new UI. | High; 5–10 days resolving engine overlaps and checking output, shared with other rows. |
| Belt printers | New native belt transform, slice strategy, brim/purge and G-code subclass machinery; `BeltGCode`, `BeltBrim`, `BeltSliceStrategy` are absent from the baseline. Final fixes include brim height (#16757) and single Z-shrink compensation (#16490). | High; 8–15 additional days for usable browser support, bed/model coordinate handling, UI and preview qualification. Engine code arriving alone is insufficient. |
| IDEX/IQEX parallel printing | New IMEX helpers/zones/arrange, configuration and plate metadata; these files are absent from the baseline. Upstream can offset writer and processor coordinates differently for firmware-managed zones. | High; 8–15 additional days for mode/tool assignment, zone visualization, project round trips and printer fixtures. Hardware acceptance extra. |
| Toolhead collision volumes | New `ExclusionVolumeGeometry` and travel/path checks, per-tool volume modes, arrange and brim integration. Our old bed-exclude polygon handling is not equivalent to 3D toolhead collision volumes. | High; 5–10 additional days for correct bridge/arrange/visualization support and checks against mixed filaments and tool offsets. |
| Color mixing and colored model import | `FilamentMixer` and mixed-filament awareness already exist in the inherited native source and our rule context. New fixes and vector mappings still matter. The web API exposes filament selection and painting, but no dedicated create/edit-mix operation was found. Assimp and OpenCV are disabled in the main WASM engine. | Medium/high; 5–10 additional days for a bounded mixing editor; another 5–10 for colored-texture import, depending on decoder/dependency choices. |
| Texture displacement | Native displacement source and desktop gizmo already exist at baseline. Upstream changes its implementation and serialization; browser painting is not a displacement editor. No displacement operation was found in our engine dispatch. OpenCV-dependent texture painting is stubbed in WASM. | High; 8–15 additional days for texture input, masks/layers, bake/undo and project persistence. Native dependency work may increase this. |
| Profiles, defaults and project migration | 1,279 changed profile paths; BBL manifest `02.08.00.12` → `02.08.00.16`, OrcaFilamentLibrary `02.04.00.19` → `02.04.00.26`. New vendor/material/nozzle coverage and renamed presets require matching definitions/loaders and repacking. | Medium; 2–5 days with engine/config work, not isolated JSON copying. |
| Preview / libvgcode | RGBA filament palettes, layer/segment/render changes overlap WebOrca rendering/performance patches. Center-of-mass result data also appears upstream; displaying it requires a new binding/UI. | High for preserving our renderer; 3–6 days within core integration, extra for new result visualizations. |
| Desktop UX, plugin host, Design tab | Python plugin manager/runtime, Speed Dial, Design tab and texture gizmo source already exist in inherited desktop code. Release updates their permissions, host APIs, lifecycle and UI. They are outside the GUI-off WASM app. Native wx event fixes, Windows signing and desktop cloud/device fixes do not provide browser UI or gateway behavior. | No automatic web exposure. A bounded command palette could take 2–4 days; Python/wx plugin compatibility and parametric CAD need separate estimates and design. |

Efforts above assume feature-specific regression fixtures and browser controls; they do not promise hardware readiness. “Already exists” means source inheritance, not that WebOrca exposes or has verified the entire feature.

The release's warning that **BBL defaults changed from Cross Hatch to Grid is already reflected in our baseline**: `resources/profiles/BBL/process/fdm_process_common.json` has `sparse_infill_pattern: grid` on both sides. Do not count that as a new fork behavior. In contrast, **Default feature filaments always using the object's filament** (#17058, `f4bfb4660f`) removes fallback propagation in `DynamicPrintConfig::normalize_fdm` after our baseline and is a real behavior change for existing browser projects.

Other directly relevant new fixes include bridge speed with curled-perimeter slowdown (#17144), Arachne/scarf ramps with arc fitting (#17030), monotonic gap-fill ordering and Spiral Inset internal solids (#17223), adaptive/TPMS path loops (#17334), wipe-inward retraction splitting (#17160), Klipper wipe-tower `M400` stalls (#17246), tree-support clearances (#17060), and lightning-infill hangs (#17066). They require coherent pipeline changes and output fixtures; release bug descriptions do not prove compatibility with our patches.

Primary source anchors: [release PrintConfig](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/PrintConfig.cpp), [release Print](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Print.cpp), [travel design](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/docs/HLSD/travel-optimization.md), [baseline FilamentMixer](https://github.com/OrcaSlicer/OrcaSlicer/blob/e027f8b225edd3b05496f8c2e9e67f8352ebb9b3/src/libslic3r/FilamentMixer.cpp), [baseline displacement](https://github.com/OrcaSlicer/OrcaSlicer/blob/e027f8b225edd3b05496f8c2e9e67f8352ebb9b3/src/libslic3r/TextureDisplacement.cpp), and the cited release-note PRs.

## Concrete integration seams

### Native engine and G-code

[Engine.cpp](../wasm/engine/Engine.cpp) constructs `PresetBundle::full_config`, merges web overrides/plate settings, calls `Print::apply`, validates, processes, and invokes `print.export_gcode(out_path, &proc_result, nullptr, false)`. The fourth argument is our optimization: skip preview-only actual-speed interpolation because the browser preview reparses the exported file. Our changes propagate through `Print`, `GCode` and `GCodeProcessor`, retaining interpolation where nozzle preheating needs it; see [patch inventory](../wasm/PATCHES.md).

The release's `Print::export_gcode` has **three parameters** and creates either `BeltGCode` or `GCode`, applying IMEX offsets. Replacing it with our older body would lose upstream behavior; accepting upstream wholesale would break the four-argument call or lose the performance contract. Preserve the optional flag through the new factory and recheck the preheating path. This is a source-proven interface mismatch; successful compilation after adapting it is still unverified.

Upstream also changes `GCodeProcessor` timing storage, adds object mass/coordinate results and collision checks. Our result extraction and separate preview parser need matching semantics. Our custom stable ordering, portable random/shuffle behavior, support fixes and `resolution=0.0125` default must be considered individually. For example, upstream edits the same infill and perimeter algorithms where we introduced stable tie-breaking. A conflict-free merge can still restore platform-dependent traversal or alter a toolpath.

### Schema, migration, profiles and web state

The release retypes `enable_arc_fitting` from `coBool` to `coEnum` with `disabled`, `enabled`, and `sparse_infill`. Its legacy handler translates `0/1/false/true`. [ConfigRules.cpp](../wasm/engine/ConfigRules.cpp) still emits an arc-fitting fix with string `0`; it needs auditing against that migration and current rule intent. Upstream's cache fix (#17047) specifically addresses retyped preset options. Test legacy JSON, serialized presets, live setter operations, reset and saved browser overrides separately rather than assuming one loader handles every route.

[Engine.cpp](../wasm/engine/Engine.cpp) exports definitions dynamically, while [orcaEngine.ts](../wasm/app/src/engine/orcaEngine.ts) wraps calls and [appStore.ts](../wasm/app/src/store/appStore.ts) stores string-valued current/baseline config and performs selection, reset, slot removal and import. Dynamic definitions help enums appear, but hard-coded setting layout, rule fixes, vector strides, and browser persistence are independent contracts. `PresetBundle::construct_full_config` gains an optional filament-volume mapping parameter upstream; our six-argument call can remain source-compatible due to the default, yet mixed-nozzle semantics still need review.

New `tpms_*` legacy aliases, `ixex_*` → `imex_*` mappings, retired belt settings and per-extruder collision options are in upstream `PrintConfig.cpp`. New profiles must travel with those migrations. An older engine silently dropping unknown keys can produce plausible but wrong output.

[pack_profiles.mjs](../wasm/web/tools/pack_profiles.mjs) packages vendor manifests plus their JSON/assets; it is not the desktop profile updater. [engine-core.js](../wasm/web/engine-core.js) and the client/worker load those bundles into the virtual filesystem. Desktop “profile updates are back on” does not update a browser deployment. Repack all vendor manifests, shared library and resources alongside the new engine, avoid mixing cached old assets, and verify existing browser preset names resolve. Manifest spelling/name migrations, inherited defaults, extruder variant widths and filament ids matter even with no local profile conflicts.

### 3MF and project handling

[ProjectOps.cpp](../wasm/engine/ProjectOps.cpp) sets our extra `StoreParams::model_compression_level`; our 3MF changes also stream the Prusa metadata probe and parallelize mesh XML export. Upstream modifies `bbs_3mf.cpp` and project state for IMEX modes, filament-volume maps, texture data, and project/preset loading. Preserve those fields through [PlateOps.cpp](../wasm/engine/PlateOps.cpp), project reopen/save and browser history, not just native archive read/write. Retain our OpenSSL guards. The diagnostic reports a conflict in `bbs_3mf.cpp` and `test_3mf.cpp`; the absence of a conflict in every adapter is not evidence that its metadata model is complete.

Primary source: [release bbs_3mf](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Format/bbs_3mf.cpp), [release PresetBundle interface](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/PresetBundle.hpp).

### Build and dependencies

The fork gates GUI dependencies, returns early before desktop targets under Emscripten, stubs optional OCCT/OpenCV/Assimp/Draco/OpenSSL/OpenVDB paths, and has dedicated engine, STEP and preview builds. These changes live in root/source CMake and [wasm/PATCHES.md](../wasm/PATCHES.md). Retain them while adding upstream source lists for belt, IMEX, exclusion geometry, adaptive infill and seam contour code.

A concrete blocker is **CGAL**: [our script](../wasm/deps/build_cgal.sh) pins 5.6.3; the release requires CGAL 6.2 and packages 6.2.1, updates bundled libigl CGAL interfaces, and propagates `CGAL_LINKED_WITH_TBB` because it changes CGAL Kd-tree layout. Upgrade and rebuild the matching geometry consumers together. This is more than resolving CMake text. Audit the compiler/standard requirements with the actual Emscripten SDK before estimating compile success.

Upstream GMP moves 6.2.1 → 6.3.0 for Apple arm64 correctness; our WASM script still uses 6.2.1. The stated x18 crash is native-Apple-specific, not evidence of a WASM crash, but synchronized dependency policy deserves review. OCCT remains 8.0.1 and adds a seam-pcurve meshing patch; our [STEP dependency script](../wasm/deps/build_occt.sh) does not automatically apply that new desktop-dependency patch. The separate STEP module needs its own rebuild/check if importing that fix. Desktop Python runtime/package-manager changes do not supply Python execution in WASM.

Primary sources: [release libslic3r CMake](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/CMakeLists.txt), [CGAL dependency](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/deps/CGAL/CGAL.cmake), [GMP dependency](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/deps/GMP/GMP.cmake), [OCCT dependency](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/deps/OCCT/OCCT.cmake).

### Worker/client and preview

[engine-core.js](../wasm/web/engine-core.js) queues calls, controls slicing thread counts/cancellation and reads G-code from the virtual filesystem. [engine-worker.js](../wasm/web/engine-worker.js) runs the engine and transfers G-code buffers; [orca-engine.js](../wasm/web/orca-engine.js) supplies the public client. These files are fork-only, so upstream cannot textually merge new capabilities into them. Preserve result shapes, progress, disposal/recovery, transferable buffers and resource limits while adding any new operations. The Embind surface and [type definitions](../wasm/web/orca-engine.d.ts) must match the new native adapter.

The preview is a second WASM target, with its own parser and WebGL2 renderer. Our [conversion code](../wasm/preview/convert.cpp) returns RGB `Color` and appends it to `GCodeInputData` palettes; [preview.cpp](../wasm/preview/preview.cpp) declares an RGB `Palette` in `setToolColors`. Upstream changes `GCodeInputData::{tools_colors,color_print_colors}` and viewer palette APIs to RGBA `PaletteWithAlpha`. That requires explicit conversion and binding updates; it is not merely a visual enhancement. WebOrca also changes the same `ViewerImpl`, `Viewer`, `Settings` and ES shaders for quality/performance/lighting. Preserve range selection, travel visibility, lighting/shadows, legends and timing while accepting upstream alpha/layer changes.

Primary source: [release GCodeInputData](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libvgcode/include/GCodeInputData.hpp), [release Types](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libvgcode/include/Types.hpp).

## Merge diagnostic and strategy

`git merge-tree --write-tree --name-only --no-messages main refs/research/orcaslicer-v2.5.0` returned exit 1 and **22 conflicted paths**. It produced diagnostic tree `593465aad5b6081ec63bf483eab8f3d6bf4a5609` without changing the checkout/index. Git wrote diagnostic objects; this is not an accepted merge or buildable candidate.

Conflicts: `AGENTS.md`; root `CMakeLists.txt`; `src/libslic3r/{Arrange.cpp,CMakeLists.txt,Fill/FillBase.cpp,Format/STEP.cpp,Format/bbs_3mf.cpp,GCode.cpp,GCode/GCodeProcessor.cpp,GCode/GCodeProcessor.hpp,PerimeterGenerator.cpp,Print.cpp,Shape/TextShape.cpp}`; `src/libvgcode/{include/Viewer.hpp,src/ShadersES.hpp,src/Viewer.cpp,src/ViewerImpl.cpp,src/ViewerImpl.hpp}`; `tests/fff_print/{test_gcode_timing.cpp,test_gcodewriter.cpp,test_perimeters.cpp}`; `tests/libslic3r/test_3mf.cpp`.

The safe implementation order is:

1. Pin both source SHAs and retain current engine/profile/preview artifacts and their output fixtures. Reconcile build gates and dependency versions first; compile native core and WASM targets against the same source.
2. Resolve native algorithm/export/project conflicts, preserving portable ordering and documented web optimizations. Run focused native regression targets before attributing output differences to WASM.
3. Update Engine/Project/Plate adapters, schema/rule migrations and preset composition; repack profiles with the engine. Verify old browser overrides and projects load predictably.
4. Adapt/rebuild preview palette conversion and rendering. Verify native parser results against the web preview, including arcs, tool changes and timing.
5. Run same-source native/WASM regressions and one integrated browser candidate for the completed batch. Then add belt/IMEX/collision/mixing/texture interfaces as separately scoped features with their own fixtures.

A **2–5 engineering day investigation** could isolate a small set of urgent fixes and establish a narrow cherry-pick plan, with roughly **1–3 days per genuinely isolated fix** including focused rebuild/testing. That is not a promise that travel optimization, belt or IMEX can be cherry-picked independently. Prefer a release merge for long-term maintenance; do not rebase the public/private fork history merely to obtain this release.

## Validation required for a future implementation

No listed validation below was executed for this research. Future implementation needs:

- Compile affected translation units and the `libslic3r_tests` / `fff_print_tests` targets, including new upstream tests for belt brim, exclusion volumes, IMEX, adaptive infill, fill ordering, seams, G-code timing, multi-filament behavior and 3MF. Review Emscripten test source gating: new tests may introduce dependencies currently disabled in WASM.
- Rebuild `orca_engine` and `orca_preview` after core/API changes; rebuild geometry dependencies for CGAL changes and the STEP module if taking its OCCT patch. A UI-only bundle cannot deliver new slicing behavior.
- Exercise [config definition](../wasm/tests/node/configdef.test.mjs), [preset configuration](../wasm/tests/node/preset-config.test.mjs) and [rules](../wasm/tests/node/rules.test.mjs) checks around enum migration, legacy overrides, tool/filament vector widths, resets and slots. New fixtures should target the specific retyped-option and mapping failures above.
- Re-run [same-source native/WASM parity](../wasm/tests/parity/README.md), comparing the upgraded source on both sides. Keep old reference results for history; do not update goldens until explaining differences in paths, extrusion, timing and configuration. The historical [native parity report](../wasm/tests/parity/native-parity.md) itself warns that matching version labels do not prove identical sources.
- Cover Arachne/scarf/arc combinations, default feature filaments, bridge speeds, toolchange Z clearance, multi-tool projects with fewer filaments than tools, wipe tower/preheat, support clearances and project save/reopen. Toolpath changes can be intentional without being harmless: assess collision envelopes, extruded volume, temperature/tool commands and path ordering.
- Check existing browser recovery, cancellation, memory and worker behavior with the upgraded binary, then verify prepare/preview range controls, colors/opacity, lighting, export and saved-preset persistence in Chromium/Firefox. Physical Safari and printer/hardware acceptance remain separate evidence requirements.

The current portable reference covers a bounded cube; it does not establish release-wide parity. Official release speedups are desktop measurements, not measured WebOrca performance promises.

## Reproduction and evidence limits

Read-only investigation used `git ls-remote`, release API requests, `git show`, `git log`, `git diff`, `git ls-tree`, ancestry checks, scoped source reads and the merge-tree diagnostic. Necessary upstream objects were fetched with:

```sh
git fetch --no-tags origin \
  refs/tags/v2.5.0:refs/research/orcaslicer-v2.5.0 \
  refs/heads/main:refs/research/orcaslicer-main
git merge-base main refs/research/orcaslicer-v2.5.0
git rev-list --left-right --count main...refs/research/orcaslicer-v2.5.0
git diff --name-only e027f8b225edd3b05496f8c2e9e67f8352ebb9b3 refs/research/orcaslicer-v2.5.0
git merge-tree --write-tree --name-only --no-messages main refs/research/orcaslicer-v2.5.0
```

No existing tag was overwritten. Git also advanced `origin/main` through its configured tracking mapping during the fetch; `main`, HEAD and the working checkout were unchanged. Research refs were retained for reproducibility. No private credentials or secrets were inspected. README and Taproot state were left unchanged because this document records research, not completed integration.

Source findings above are supported by the pinned trees and live official release API as observed on the research date. Effort, expected compile issues, browser-exposure gaps and recommended validation are assessments; only an implementation/build/fixture run can establish their actual cost and compatibility. The full release and fork were not exhaustively reviewed line by line.
