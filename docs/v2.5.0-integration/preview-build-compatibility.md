# v2.5.0 preview and build compatibility handoff

Research date: 2026-11-07. Compared Git trees: `main` = `413cb95cb6107a6b8786444925d672b142e3f690`; pinned release = `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`. This supplements the [integration assessment](../orcaslicer-v2.5.0-integration-assessment.md). Product sources, artifacts, index and refs were not changed. No builds, tests, commits, deployment, private access or further delegation were performed. Findings describe these trees, independently of the foundation worker's concurrent conflict resolution.

**Required before preview can compile against unmodified release APIs:** adapt RGBA conversion and legends; preserve the fork's optional parser argument, CPU cache release, lighting mode, low-quality API and stepped range colors. **Required before geometry can configure:** install CGAL 6.2 or newer (release dependency is 6.2.1). Recompile geometry consumers with consistent TBB definitions and updated bundled libigl headers. Successful compilation, runtime rendering and performance remain unverified.

## Evidence conventions

“Proven” below means a declaration, implementation or build-input difference established with `git show`, `git diff` and `git ls-tree`, not a reproduced compiler failure. Local links identify the implementation seam; concurrent integration edits can change their contents. Release citations use the pinned public commit. Reproduce comparisons with:

```sh
git show main:wasm/preview/convert.cpp
git show main:wasm/preview/preview.cpp
git diff main 40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19 -- src/libvgcode
git diff main 40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19 -- src/libslic3r/GCode/GCodeProcessor.hpp
git diff main 40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19 -- deps/CGAL deps_src/libigl src/libslic3r/CMakeLists.txt
```

## Preview adapter changes

### RGBA palettes and legends: proven source mismatches

[Release Types.hpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libvgcode/include/Types.hpp) retains `Color = std::array<uint8_t, 3>` and `Palette = std::vector<Color>`, and adds `ColorWithAlpha = std::array<uint8_t, 4>` and `PaletteWithAlpha = std::vector<ColorWithAlpha>`. Alpha 255 means opaque. [GCodeInputData.hpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libvgcode/include/GCodeInputData.hpp) changes **both** `tools_colors` and `color_print_colors` to `PaletteWithAlpha`. Numeric, role and option palettes remain RGB.

Minimal adapter work in [convert.cpp](../../wasm/preview/convert.cpp), its [header](../../wasm/preview/convert.hpp), and [preview.cpp](../../wasm/preview/preview.cpp):

| Main signature / call | Required integration action |
| --- | --- |
| `Color convert(const Slic3r::ColorRGBA& c)` | Change result to `ColorWithAlpha`; append rounded `c.a() * 255` alongside the existing rounded RGB channels. Preserve black and saturated RGB without brightness adjustment. |
| `Color convert(const std::string& color_str)` | Return `ColorWithAlpha`; preserve decoded alpha and use an explicit four-channel fallback `{DUMMY_COLOR[0], DUMMY_COLOR[1], DUMMY_COLOR[2], 255}` on decode failure. |
| `Slic3r::ColorRGBA convert(const Color& c)` | Keep for RGB users; add a `const ColorWithAlpha&` overload only if needed, dividing its alpha by 255. Return type alone cannot overload the other two functions. |
| `GCodeInputData convert(const Slic3r::GCodeProcessorResult&, const std::vector<std::string>&, const std::vector<std::string>&, const Viewer&)` | Signature can stay. Its existing `emplace_back(convert(color))` then supplies RGBA to both palettes. Keep empty color-print palette fallback to tool colors. |
| `void OrcaPreview::setToolColors(emscripten::val colors)` uses `libvgcode::Palette` | Use `PaletteWithAlpha`, retaining the 256-entry cap, resize/default behavior, and empty-string preservation. Public JS argument remains an array of encoded color strings. |
| `std::string to_hex(const libvgcode::Color& c)` | Add an RGBA overload or project RGB explicitly for tool/color-print/filament legends. Existing RGB overload is still needed for role, option and numeric legends. Keep `#RRGGBB` output unless deliberately extending the TS legend schema. |

Release [Viewer.hpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libvgcode/include/Viewer.hpp) uses these exact palette signatures:

```cpp
const PaletteWithAlpha& get_tool_colors() const;
void set_tool_colors(const PaletteWithAlpha& colors);
const PaletteWithAlpha& get_color_print_colors() const;
void set_color_print_colors(const PaletteWithAlpha& colors);
```

### Results, timing and ranges

[Release GCodeProcessor.hpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/GCode/GCodeProcessor.hpp) declares:

```cpp
void process_file(const std::string& filename,
                  std::function<void()> cancel_callback = nullptr);
double get_time(PrintEstimatedStatistics::ETimeMode mode) const;
```

Main calls `processor.process_file(path, nullptr, false)`. This is a proven arity mismatch if the release declaration wins. Coordinate with the foundation worker to carry `bool collect_line_offsets = true` through the new implementation, retaining the preview's `false` and default collection for other callers. Removing the third argument would restore source compatibility while losing the fork's memory optimization; it is not the preferred integration result.

`PrintEstimatedStatistics::Mode::time` also changes `float` → `double`. Use a `double time_s` local for `loadGcode` and avoid truncating `get_time()` before serializing `timeS`. JS numbers need no new result shape. Viewer time methods, per-layer values and `PathVertex::times` remain float-based; `float get_estimated_time() const`, `float get_estimated_time_at(size_t) const`, role/travel times and `float OrcaPreview::getEstimatedTime() const` remain compatible. Processor total and summed viewer role times can differ: do not demand bit equality or rewrite processor totals from viewer estimates.

`PathVertex.hpp` has no main-to-release difference. The converter's current aggregate initialization remains structurally valid: position, dimensions, commanded/actual speed, volume, fan, temperature, role/type, G-code/layer/tool/color ids, normal/stealth times, pressure advance, acceleration and jerk. Preserve phantom vertices with previous position and zero times, including the exact reserve counting and path splitting. The `VGCODE_ENABLE_COG_AND_TOOL_MARKERS` branch needs matching compile definitions across converter and renderer.

The result adds `plate_mass`, `object_masses`, `body_masses`, `support_masses`, belt frame metadata and exclusion-volume checks. Existing conversion does not expose those; they are capability gaps, not aggregate compile mismatches. `limit_filament_maps` becomes `std::vector<uint64_t>`; this adapter does not read it. Belt `moves` can be in machine coordinates (`machine_frame_transform_active`, `belt_z_origin`, `belt_tilt_angle`): existing raw-position preview is not evidence of a correct designed belt view. Do not add belt transforms or center-of-mass UI during this compatibility repair.

Range declarations stay compatible in release:

```cpp
const Interval& get_layers_view_range() const;
void set_layers_view_range(const Interval& range);
void set_layers_view_range(Interval::value_type min, Interval::value_type max);
const Interval& get_view_visible_range() const;
void set_view_visible_range(Interval::value_type min, Interval::value_type max);
const Interval& get_view_full_range() const;
const Interval& get_view_enabled_range() const;
```

Keep JS `setLayerRange(int,int)`, `setMove(int)`, `getMoveRange()` (`min/max/current`) and `getMoveInfo(int)` contracts. Their ids address original converted vertices, including phantom/actual-speed moves; they must not become compacted ribbon ids or opacity-sorted draw indices. Top-layer-only scrubbing stays enabled at initialization. Source-compatible declarations do not preserve main's fast range implementation automatically: release removes ES cached enabled-range selection, original-index offsets, packed ribbon spans, and several redundant-update guards.

## libvgcode merge responsibilities

The foundation worker owns conflicts in `Viewer.hpp`, `Viewer.cpp`, `ViewerImpl.hpp`, `ViewerImpl.cpp` and `ShadersES.hpp`. Hand it these preservation requirements; adapter work should follow its final interfaces.

| Surface | Proven difference and required behavior |
| --- | --- |
| Lighting | Main `void set_enhanced_lighting(bool)` is absent upstream; release adds `void set_gloss(bool)`. Gloss only controls the untinted highlight and is not equivalent to disabling enhanced shading. Retain the main method/state/uniform plus JS `setLightingEnabled(bool)`, independent of low quality and `setShadowsEnabled(bool)`. Preserve basic eye-space shading when disabled. |
| Quality | Main `void set_low_quality(bool)` and `Settings::low_quality` are absent in release. Preserve them and the ES ribbon program, `LowQualitySegments` helper, bounded batches, dimension repacking, endpoint clipping and numeric palette stepping. `ColorRange::get_color_at(float, size_t color_count = 0) const` must remain available: release only declares `Color get_color_at(float) const`, while preview legends call `get_color_at(value, 8)`. |
| Replacement memory | Main `void release_cpu_render_cache()` is absent upstream. Preserve it through Viewer/ViewerImpl and adapt derived RGBA color/index caches; keep raw vertices and existing GPU output valid so failed replacement loads retain pixels, camera, ranges and metadata. |
| Bounds | `AABox get_bounding_box(const std::vector<EMoveType>& types = ...) const` stays available. Main caches its extrusion-only raw box in `OrcaPreview`, invalidates on successful replacement/clear, and expands a local copy for shadow fitting. Preserve it across sliders/camera/visibility changes. Release adds a separate `ViewerImpl::m_extrusions_box` for transparency depth weighting; it does not replace the adapter cache. |
| Shadows | `render_shadow_casters(const Mat4x4&, const Mat4x4&, const Vec3&)`, `set_shadow_map(int, const Mat4x4&, float, float)`, `set_light_top_dir(const Vec3&)`, `set_tone(float,float)` and `set_clipping_plane(const std::array<float,4>&)` remain. Preserve framebuffer/viewport/texture/depth/blend state restoration and the adapter's light-space bounds, 2048 limit, texture unit 4, PCF comparison filtering and unsupported-FBO fallback. |
| FPS | There is no native FPS binding to port. [orcaPreviewModule.ts](../../wasm/app/src/preview/orcaPreviewModule.ts) observes successful completed `render`/`renderMatrices` calls, coalesces RAF requests and reports `idle/fps/cpuMs`. Preserve synchronous draw completion, disposal and hidden-tab behavior; avoid adding observation renders. CPU submission duration is not synchronized GPU frame time. |

### ES shader/data layout must be merged together

[Release ViewerImpl.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libvgcode/src/ViewerImpl.cpp) and [ShadersES.hpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libvgcode/src/ShadersES.hpp) change color staging from packed RGB floats to `std::vector<ColorWithAlpha>` and normalized RGBA8 texture samples. Every normal/ribbon/options/caster shader and upload path must agree on the new format; reading the old packed `.r` value from an RGBA8 texture silently produces wrong colors. Keep RGB scalar-range computation before constructing opaque RGBA values.

Release adds `first_instance` and alpha-based segment partitioning, removes main's `instance_offset`, `visible_vertices`, `paired_indices`, `index_bits` and `LOW_QUALITY` shader path, and changes texture page capacity from `width*height-1` to `width*height`. Main deliberately shares an endpoint across pages. Preserve its page invariant and exact ribbon endpoints when integrating upstream alpha/joint logic; copying upstream capacity/index code can disconnect segments at page boundaries. Main's low-quality coalescing must include alpha equality wherever it compares RGB metadata, otherwise adjacent opacity changes can disappear.

Release's `render()` omits translucent toolpaths. New APIs are `void render_translucent(const Mat4x4&, const Mat4x4&)`, `bool has_translucent_toolpaths() const`, `bool is_translucent_filaments() const`, and `void set_translucent_filaments(bool)`. The ES implementation uses a separate blended segment pass; desktop order-independent-transparency buffers are guarded by `#ifndef ENABLE_OPENGL_ES`. Desktop OIT is therefore not proof of WebGL transparency quality.

For the smallest compatibility batch, explicitly call `set_translucent_filaments(false)` before loading/rendering while preserving RGBA palette storage. This keeps all segments in the opaque pass and avoids silently hiding paths with the current single `render()` call. Full translucent browser support requires calling the second pass in both above-bed and below-bed composition branches, validating blend/depth restoration and shadows, and deciding ribbon behavior. Treat that as an explicit feature decision; do not advertise transparency solely because RGBA compiles.

## CGAL, SDK and ABI

| Input | Verified state | Consequence |
| --- | --- | --- |
| CGAL | [WASM script](../../wasm/deps/build_cgal.sh) pins 5.6.3. [Release dependency](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/deps/CGAL/CGAL.cmake) pins 6.2.1, SHA256 `eebd737d9b7f0199647ba5c1f9f6c7a3d0651aacef9c2fd4dedc52da6c25edbe`; libslic3r requires `find_package(CGAL 6.2 REQUIRED)`. | Existing 5.6.3 prefix cannot meet the new version constraint. Update WASM download/version/hash policy together. CGAL installation supplies headers/CMake data; it is consumer object files that must be rebuilt. |
| C++ / CMake | Release Orca remains C++17. CGAL 6.2.1 [dependency setup](https://github.com/CGAL/cgal/blob/v6.2.1/Installation/cmake/modules/CGAL_SetupCGALDependencies.cmake) requires `cxx_std_17`; [installation CMake](https://github.com/CGAL/cgal/blob/v6.2.1/Installation/CMakeLists.txt) says `3.15...3.31`. | No demonstrated C++20 requirement. 3.31 is the policy ceiling, not the minimum. Verify configured compiler and CMake before build. |
| Boost / Eigen | WASM pins Boost 1.84.0 and Eigen 5.0.1; CGAL [Boost setup](https://github.com/CGAL/cgal/blob/v6.2.1/Installation/cmake/modules/CGAL_SetupBoost.cmake) requires 1.74; Orca root requires 1.83.0. | Boost meets the declared floor. No source evidence here requires rebuilding Boost/Eigen merely for the CGAL header upgrade. Eigen 5 template compatibility remains a compile check. |
| Emscripten | [env.sh](../../wasm/scripts/env.sh) selects `~/emsdk` before `$EMSDK`, without a version pin. Read-only local `~/emsdk/upstream/emscripten/emscripten-version.txt` reports `6.0.11`. | This is the observed installed SDK, not provenance of existing archives or proof of CGAL support. Keep one SDK, memory model, pthread and exception ABI across rebuilt objects. Defaults are memory64, `-pthread -fwasm-exceptions -O2`; wasm32 omits MEMORY64. |
| TBB | [build_tbb.sh](../../wasm/deps/build_tbb.sh) pins oneTBB 2023.1.0, static, and replaces `libtbbmalloc.a` with [the malloc shim](../../wasm/deps/tbbmalloc_shim.c). | Retain shim and flags. Release compiles `libslic3r_cgal PRIVATE CGAL_LINKED_WITH_TBB`, links `TBB::tbb`, and exports `CGAL_LINKED_WITH_TBB` PUBLIC on `libslic3r`. Its comment explicitly identifies changed `CGAL::Kd_tree` member layout. These definitions must reach every instantiating consumer, including test/engine/preview/STEP configurations. |
| libigl | [Bundled CMake](../../deps_src/libigl/CMakeLists.txt) defines an INTERFACE target and prefers system `igl::core` when found. Release changes 15 bundled CGAL files, including `AABB_traits` → `AABB_traits_3` and `AABB_triangle_primitive` → `AABB_triangle_primitive_3` includes/types/signatures. | Take all corresponding header/template changes with CGAL. There is no separate libigl archive rebuild target. Verify CMake selected compatible bundled headers; a system libigl can bypass the update. |
| GMP / MPFR | WASM pins GMP 6.2.1 and MPFR 4.2.2; release desktop GMP is 6.3.0. | Apple arm64's x18 fix does not prove a WASM defect. Updating GMP is a policy choice, not a demonstrated preview prerequisite. If changed, rebuild GMP, then MPFR, then CGAL configuration/consumers. |

Preserve GUI-off and optional-dependency gates in [build_orca.sh](../../wasm/scripts/build_orca.sh), root/source CMake and [PATCHES.md](../../wasm/PATCHES.md). Upstream's unconditional OpenCV/Assimp discovery would otherwise reintroduce dependencies disabled by the WASM build. This is independent of CGAL compatibility.

### Minimal rebuild order for the implementation owner

These are future actions, not commands run by this research worker. Use an isolated candidate prefix/build directory and retain existing deployment artifacts. Do not install new CGAL headers into a prefix actively used by another build.

1. Freeze SDK/architecture/thread/exception settings and reconcile CMake gates, CGAL version, libigl headers and TBB definitions. Record actual selected include/config paths; avoid old CGAL discovery cached in a reused build directory.
2. Reuse matching Boost, Eigen, GMP, MPFR and TBB archives only if their SDK/ABI provenance is established. If not, rebuild the affected prefix. For a fresh prefix, Boost/Eigen/GMP/TBB can build independently; MPFR follows GMP; CGAL configuration/install follows Boost/Eigen/GMP/MPFR. TBB must exist before configuring its geometry consumers. Scripts are `wasm/deps/build_{boost,eigen,gmp,tbb,mpfr,cgal}.sh`; each exposes installation through its script, not a root `dep_CGAL` WASM target.
3. Reconfigure the application CMake build against that prefix. Rebuild `libslic3r_cgal` first: `CutSurface.cpp`, `IntersectionPoints.cpp`, `MeshBoolean.cpp`, `MeshRepair.cpp`, `TryCatchSignal.cpp`, `Triangulation.cpp`. Rebuild `libslic3r` and all objects including changed CGAL/libigl templates or `GCodeProcessor.hpp`; do not combine pre-upgrade geometry objects with new headers. Let the build graph order static prerequisites.
4. Build affected renderer/adapter translation units (`Viewer.cpp`, `ViewerImpl.cpp`, `ColorRange.cpp`, `convert.cpp`, `preview.cpp`, retained `LowQualitySegments.cpp`) and link `orca_preview`. Its [CMake](../../wasm/preview/CMakeLists.txt) links `libslic3r` and `libvgcode`; the preview is a second module, not an engine-only relink. Then link `orca_engine` and `orca_slice_driver` for the shared-source integration. `build_orca.sh` builds the latter two, so it does not itself prove preview rebuilt. Use the resolved integration CMake configuration that includes `wasm/preview`.
5. Separate STEP build configurations also consume libslic3r/geometry and need consistent headers/definitions and relinking if shipped. OCCT itself need not rebuild just because CGAL changes. Taking release's OCCT seam-pcurve patch additionally requires patching/rebuilding OCCT before STEP; the WASM `build_occt.sh` does not automatically apply desktop dependency patches.
6. After focused verification, capture matching JS/WASM pairs. Preview's post-build hook copies into `wasm/preview/demo`; do not let packaging read that mutable pair mid-build. Use one immutable integrated UI candidate for browser checks and retries.

No exact compiler-object command is prescribed before the foundation worker resolves generated build paths. Stable target names above are source-proven; configure flags, package selection and successful graph execution still need implementation evidence.

## Focused verification already available

Nothing in this section was run. Existing assertions are acceptance starting points, not claimed results for v2.5.0.

| Existing check | Relevant cases / limits |
| --- | --- |
| [test_low_quality_segments.cpp](../../wasm/preview/test_low_quality_segments.cpp) | Standalone helper covers curved paths, metadata boundaries, texture pages, packed spans and clipping within merged/split runs. Compile recipe is in [preview README](../../wasm/preview/README.md). Add alpha-boundary coverage only when coalescing input gains alpha; that is a concrete new merge risk. |
| [benchmark_preview.mjs](../../wasm/preview/benchmark_preview.mjs) | Exact normal pixel hashes, move mapping/statistics, quality roundtrips, layer/move/visibility/view snapshots, numeric palette cardinality, memory and uploads. `PREVIEW_TEXTURE_SIZE=16` exposes page boundaries; `PREVIEW_INITIAL_LOW=1` checks first-load preference; `PREVIEW_ASSERT_UPLOADS=1` requires zero uploads for same-layer/layer-scrub/move-scrub/same-view operations. `PREVIEW_BASELINE_DIR` compares an existing JS/WASM pair; `PREVIEW_COMPARE_TIMINGS=1` measures both. |
| Same benchmark replacement modes | `PREVIEW_SIMPLE_RELOADS=1 PREVIEW_RELOADS=23 PREVIEW_PARSE_ONLY=1 PREVIEW_CHECK_FAILURES=1` checks repeated loads and missing/empty replacement preservation. Keep cache-release behavior with RGBA buffers. `PREVIEW_LAYERS=120` selects the detailed synthetic fixture; `PREVIEW_GCODE` selects a local file. |
| [test_lighting.mjs](../../wasm/preview/test_lighting.mjs) | Chromium/Firefox; production PCF half-shadow/outside-lit pixels; lighting on/off and exact restoration; shadow on/off; four lighting/quality combinations; rejected replacement preservation; layer/move/view/clipping roundtrips; themes and replacement settings. It inspects the `enhanced_lighting` uniform, which is why substituting `set_gloss` is insufficient. `PREVIEW_LIGHTING_BASE_URL` targets a packaged candidate and `PREVIEW_LIGHTING_MODULE_DIR` can substitute a module pair. |
| [test_preview.mjs](../../wasm/preview/test_preview.mjs) | Standalone Chromium/Firefox cube smoke: layers, nonblank output, GL errors and scrub variation. Historical README measurements are from main-era artifacts and are not release acceptance goldens. |
| [preview-values.test.mjs](../../wasm/tests/node/preview-values.test.mjs), [preview-gcode-lines.test.mjs](../../wasm/tests/node/preview-gcode-lines.test.mjs) | Numeric metadata/legend and source-line contracts. Pair with the real parser/browser checks; source/mock tests cannot validate shader uploads. |
| [preview-performance-counter.test.mjs](../../wasm/tests/node/preview-performance-counter.test.mjs), [preview-render-scheduling.test.mjs](../../wasm/tests/node/preview-render-scheduling.test.mjs), [preview-initial-viewport.test.mjs](../../wasm/tests/node/preview-initial-viewport.test.mjs) | FPS counts completed draws, failed draws excluded, queued draws coalesced, idle publications bounded, cleanup and initial viewport. No native FPS export is required. |
| [preview-performance.mjs](../../wasm/tests/app/preview-performance.mjs) | Integrated synthetic four-tool palette, exact text-window mapping, single parse, initial-low preference, loads/reslices and memory. [preview-load-recovery.mjs](../../wasm/tests/app/preview-load-recovery.mjs), [preview-newproject-reset.mjs](../../wasm/tests/app/preview-newproject-reset.mjs), [preview-playback-visibility.mjs](../../wasm/tests/app/preview-playback-visibility.mjs) cover lifecycle. |

For future invocation, benchmark accepts `PREVIEW_URL=http://localhost:5059/wasm/preview/demo/ node wasm/preview/benchmark_preview.mjs`; lighting accepts `PREVIEW_LIGHTING_BASE_URL=http://127.0.0.1:5371 node wasm/preview/test_lighting.mjs`. Both require an already served candidate and installed Playwright dependencies. Node-focused files use `node --test <file>`. These entry points and environment names were checked in source; no server or runner was started.

Use fixed input G-code to compare renderer changes separately from newly sliced v2.5.0 G-code. Start with opaque black, saturated primary colors, four tools and color-print fallback; exercise speed/actual-speed/volumetric/acceleration/jerk legends, arcs and phantom path starts, travel/role toggles, exact move endpoints and tiny texture pages. Existing synthetic/benchmark cases cover much of this; translucent alpha 0/128/255, opacity changes inside an otherwise coalescible run, and both bed viewing directions require targeted additions only if browser transparency is enabled. Include those cases before claiming that feature.

Cross-release exact pixel comparison can legitimately fail where release joint/gloss/alpha semantics change; inspect differences and document the accepted rendering policy before replacing goldens. Within-candidate roundtrips, unchanged opaque modes, original move mapping and zero-upload slider behavior should remain strict. For timing, compare parser results from the same upgraded source and input, allowing the explicit float viewer boundary; old main timing is a historical reference, not proof that the new planner is wrong. GPU timings require synchronized pixel readback and the reported backend; FPS observation and SwiftShader measurements alone do not establish hardware throughput.

## Remaining risks and exit evidence

Proven blockers are palette type/legend overload mismatches, parser arity, missing fork APIs, stepped ColorRange signature, CGAL version discovery, and TBB/libigl build-input divergence. Unverified risks are Eigen/CGAL template compilation under the observed SDK, archive provenance, template ABI consistency after rebuilding, ES alpha/page/ribbon composition, shader compile/link behavior, performance/memory regressions, and new planner/belt semantics. No source-only investigation can mark those passed.

The implementation handoff is complete when the foundation worker confirms the preserved interfaces above, the adapter owner compiles the affected units and links matching engine/preview modules against one dependency set, and the existing focused checks pass against the immutable candidate with explained pixel/timing differences. Transparency and designed belt view need their own explicit evidence if enabled.
