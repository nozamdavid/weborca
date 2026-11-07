# v2.5.0 foundational source merge

Status: **unverified merge checkpoint**. Textual integration is resolved; this is not a verified engine upgrade or a shipped milestone. No push, deployment, browser run or product-module build was performed.

## Checkout and ancestry

- Worktree: `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`
- Branch: `t3/merge-upstream-v250-foundation`
- First parent: `413cb95cb6107a6b8786444925d672b142e3f690` (WebOrca main at task start).
- Second parent: `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19` (pinned upstream v2.5.0).
- Merge base: `e027f8b225edd3b05496f8c2e9e67f8352ebb9b3`.
- Merge command: `git merge --no-commit --no-ff 40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`.
- The signed merge containing this report is the checkpoint. Obtain its SHA and parents with `git log -1 --format='%H %P'` on this branch.

Read the original checkout's updated `AGENTS.md`, integration assessment, `config-compatibility.md`, `preview-build-compatibility.md`, and this worktree's `wasm/PATCHES.md`. No further delegation occurred. Original source, main, existing build directories, service and private configuration were not edited. The expressly requested original `run-capped.sh` runner records its own QA logs/headroom/command bookkeeping in its existing QA directory; all build outputs and checkout-specific reports here use this worktree.

## Exact conflict decisions

All 22 paths from the assessed merge conflicted. No whole-tree ours/theirs selection was used.

| Conflicted path | Resolution |
| --- | --- |
| `AGENTS.md` | Preserve the tracked WebOrca policy byte for byte from the first parent. Do not copy or modify the original checkout's uncommitted policy edit. |
| `CMakeLists.txt` | Retain Emscripten/optional-dependency/GUI gates; include upstream Flatpak uv lookup inside the existing non-Emscripten download gate. Preserve gated FreeType lookup and upstream native dependency changes. |
| `src/libslic3r/CMakeLists.txt` | Keep upstream belt, IMEX, exclusion geometry, adaptive infill and seam source lists, CGAL 6.2 requirement and public `CGAL_LINKED_WITH_TBB`. Retain WebOrca optional libraries/definitions, size tiers, no-log flags, extracted STEP sources and platform gates. Accept removal of obsolete TextShape/FreeType implementation linkage. |
| `src/libslic3r/Arrange.cpp` | Carry `orientation_locked` together with upstream Z ranges and per-extruder bed-exclusion fields. |
| `src/libslic3r/Fill/FillBase.cpp` | Keep upstream join-count/contour candidate algorithm. Use stable sorting for both initial arc costs and equal contour candidates, retaining portable tie order. |
| `src/libslic3r/Format/STEP.cpp` | Keep the local tessellation/preprocessor extraction, cancellation/thread handling and OCCT-disabled stubs. Port upstream compound/shell/loose-face collection into `STEPTessellate.cpp`, where native and standalone import share it. Standalone preprocessing error strings remain untranslated, avoiding new engine localization linkage. |
| `src/libslic3r/Format/bbs_3mf.cpp` | Retain parallel mesh XML formatting, model compression control, OpenSSL gates and SVG export error propagation. Keep upstream texture/project/IMEX serialization. Move the newly added per-triangle texture attributes into the worker-local `out` buffer; the automatic merge had left writes to uncaptured/shared `output_buffer`. |
| `src/libslic3r/GCode.cpp` | Retain upstream object/body mass locator and export implementation; append the optional `generate_actual_speed_moves` argument and pass it to the processor. |
| `src/libslic3r/GCode/GCodeProcessor.cpp` | Retain upstream Klipper lookahead planner, timing/mass/collision changes and machine-flavor selection. Carry the optional interpolation argument into `TimeMachine::calculate_time`, preserving the upstream non-motion skip independent of the flag. Retain local thermal-vector safety and nonnegative physical-tool lookup. Force interpolation for both `enable_pre_heating` and legacy `backtrace_enabled`; retain parser cache/pressure-advance/line-offset optimizations. |
| `src/libslic3r/GCode/GCodeProcessor.hpp` | Keep both the upstream mass-locator interface and local interpolation setter/default flag. Preserve `process_file(path, cancel, bool collect_line_offsets = true)` and its implementation. |
| `src/libslic3r/PerimeterGenerator.cpp` | Retain deterministic supported/coordinate endpoint selection and local `m_scaled_resolution` simplification in classic and Arachne paths. Keep other upstream perimeter changes. The inherited local simplification policy takes precedence over upstream's enum-based conditional refinement. |
| `src/libslic3r/Print.cpp` | Keep upstream `unique_ptr<GCode>` factory selecting `BeltGCode`, IMEX slice-offset refresh and writer/processor coordinate split. Pass `generate_actual_speed_moves` through `gcode->do_export`; keep layer-filament export. |
| `src/libslic3r/Shape/TextShape.cpp` | Accept upstream deletion; its header and source-list entry are also removed upstream. The old OCCT stub is no longer needed. |
| `src/libvgcode/include/Viewer.hpp` | Preserve enhanced-lighting and CPU-cache-release/low-quality interfaces alongside upstream gloss and RGBA palette/translucency APIs. |
| `src/libvgcode/src/ShadersES.hpp` | Preserve the first-parent ES shader/data contract, including enhanced lighting, packed RGB, low-quality ribbons, exact endpoint clipping and original-index offsets. ES opacity remains follow-up work. |
| `src/libvgcode/src/Viewer.cpp` | Implement both enhanced-lighting and upstream gloss forwarding; preserve local cache/quality/range interfaces and upstream RGBA palette signatures. |
| `src/libvgcode/src/ViewerImpl.hpp` | Combine local range/ribbon/cache/lighting state with upstream RGBA palette and native translucency state. Keep packed-float ES staging and RGBA native staging explicitly conditional. |
| `src/libvgcode/src/ViewerImpl.cpp` | Retain ES shared-endpoint paging, bounded draw batches, cached slider ranges, stepped/memoized numeric colors, cache release and enhanced lighting. Retain native RGBA uploads, opacity partitioning/OIT, gloss, mass bounds and joint metadata. Extract RGB explicitly from RGBA palettes. Restore the packed-color helper removed by automatic merge. ES opacity defaults off in `Settings.hpp`; shaders, uploads and indices remain consistently on the existing packed path. |
| `tests/fff_print/test_gcode_timing.cpp` | Retain both local skip-interpolation estimates regression and upstream Klipper planner tests; close the local test before the upstream namespace/tests. |
| `tests/fff_print/test_gcodewriter.cpp` | Retain local skip/preheat/backtrace/vector-safety tests and upstream short filament-start list regression as separate tests. |
| `tests/fff_print/test_perimeters.cpp` | Retain local deterministic open-wall regression and upstream scarf/arc tests as separate tests. |
| `tests/libslic3r/test_3mf.cpp` | Retain local streaming probe/compression/SVG archive-failure tests and upstream restore-lock/thumbnail/project tests as separate tests. |

Conflict-free merges were also reviewed at key seams: `PrintConfig.cpp` differs from release only in the retained `resolution=0.0125` default, so upstream `normalize_fdm`/`normalize_fdm_1` default-feature-filament corrections and legacy handlers remain intact. Portable `Random.hpp`, stable configuration/infill ordering, support fixes, streaming 3MF probing and compression field remain present. `src/CMakeLists.txt` retains its early Emscripten return. No web feature/adaptor implementation was added.

## Verification and evidence

Commands ran through `bash /mnt/appdata/workspace/OrcaSlicer/wasm/build/tests-mobile-polish/qa/run-capped.sh <label> 2G ...`, which serializes heavy work with `/tmp/webslicer-heavy.lock`, disables swap and limits CPU/tasks. All build artifacts are under `wasm/build/v250-foundation/` here. No original build cache was reconfigured, no geometry objects from an old ABI were linked, and no dependency prefix was modified.

| Check | Result and evidence |
| --- | --- |
| Standalone host ES `libvgcode` compile/archive | Pass, including `Viewer.cpp`, `ViewerImpl.cpp`, `Settings.cpp`, `ColorRange.cpp`, `LowQualitySegments.cpp` and other library units. Configure: `cmake -S src/libvgcode -B wasm/build/v250-foundation/preview-es -G Ninja -DSLIC3R_OPENGL_ES=ON -DCMAKE_CXX_FLAGS=-std=c++17 -DCMAKE_C_FLAGS=-DGLAD_GLES2_USE_SYSTEM_EGL=1`; build `-j1`. [Final log](renderer-final.log). This validates C++ compilation, not GLSL/runtime rendering or a WASM module. |
| Native renderer translation units | Pass: `g++ -std=c++17 -Isrc/glad/include -c src/libvgcode/src/ViewerImpl.cpp -o wasm/build/v250-foundation/ViewerImpl-native.o`, likewise `Viewer.cpp`. [Final log](renderer-final.log). |
| Existing low-quality CPU regression | Pass: README's C++17 `-O2 -Wall -Wextra -Wpedantic -Werror` recipe for `wasm/preview/test_low_quality_segments.cpp` plus `LowQualitySegments.cpp`, output isolated here. Covers curves, metadata, pages, packed span limits and endpoint clipping. [Final log](renderer-final.log). |
| Extracted STEP tessellator translation unit | Pass with C++17, this source tree, read-only matching OCCT headers and Boost headers from the original prefix. Compile-only output `wasm/build/v250-foundation/STEPTessellate.o`; no old geometry/archive linkage. [Log](step-compile.log). |
| Full Emscripten core configure | **Blocked as intended at `find_package(CGAL 6.2 REQUIRED)`**: selected read-only prefix provides 5.6.3. Root and dependency CMake parsed through the libslic3r dependency gate. [Log](core-configure.log). No engine compilation or product build was launched after this failure. |
| Markers/policy/ancestry | No textual conflict markers remain; local `AGENTS.md` equals first parent; expected `MERGE_HEAD` was pinned release. Final signed commit has the two parents above. |

Initial focused compile attempts exposed and corrected the removed packed-color helper. The initial host GLAD loader attempt lacked `glad/egl.h`; selecting its supported system-EGL option allowed the archive build. Initial STEP compile lacked a Boost include path; the final compile uses existing read-only headers. See [initial focused log](focused-checks.log) and [initial ES log](preview-es-compile.log). No product/source workaround was added for these harness issues.

Core `Print.cpp`, `GCode.cpp`, `GCodeProcessor.cpp`, Arrange/Fill/Perimeter/3MF and the merged `fff_print_tests`/`libslic3r_tests` remain **uncompiled/unrun** because the required geometry dependency set is unavailable. No claim is made about native/WASM parity, planner estimates, belt/IMEX toolpaths, project round trips, browser pixels, performance or hardware correctness. Existing upstream whitespace issues in the full merge's `git diff --check` remain; no repository-wide formatting cleanup was performed.

## Next owners and blockers

1. **Dependency/core verification owner:** create a fresh CGAL 6.2.1 prefix and rebuild geometry consumers against updated bundled libigl and coherent TBB definitions. `wasm/deps/build_cgal.sh` still pins 5.6.3 and must be upgraded in that batch. Reuse other archives only with established unchanged SDK/architecture/thread/exception ABI. Compile the unverified core units and run existing G-code timing, preheat/backtrace, belt, IMEX, infill, perimeter and 3MF tests. Do not reuse the existing 5.6.3 geometry cache. The optional export flag and its preheat override need runtime regression evidence.
2. **Preview adapter owner:** update `wasm/preview/convert.{cpp,hpp}` and `preview.cpp` for `ColorWithAlpha`/`PaletteWithAlpha`, RGB legend overloads and double processor total time. Keep public JS contracts and the preserved optional parser flag. This foundation retains RGBA palette storage with the existing opaque packed-RGB ES renderer; keep opacity disabled for the compatibility batch. A later transparency implementation must port shaders, shared-endpoint pages, opacity partitioning, coalescing equality and ranged original-index offsets together. This host compile does not qualify ES shader behavior. Detailed original handoff: `/mnt/appdata/workspace/OrcaSlicer/docs/v2.5.0-integration/preview-build-compatibility.md`.
3. **Configuration/project adapter owner:** normalize persisted baselines and aliases before schema filtering, canonicalize native preset rename results, audit plate-map composition/slot assignments, and regenerate definitions/layout/profile packs with the new engine. Strict setters already run native legacy conversion; `construct_full_config` already had the optional seventh filament-volume mapping parameter on main, so no speculative signature repair is needed. Generic plate config already carries IMEX/volume maps; the handoff's pre-existing map/slot risks need focused fixtures. Detailed original handoff: `/mnt/appdata/workspace/OrcaSlicer/docs/v2.5.0-integration/config-compatibility.md`.
4. **STEP follow-up:** taking upstream's OCCT seam-pcurve dependency patch requires a separate isolated OCCT rebuild and STEP fixture checks; compiling the extracted source does not apply that dependency patch.

Stop foundation ownership here. Do not mark the shipped baseline or overall integration milestone complete. Full path manifest relative to first parent: [changed paths](changed-paths.txt). Local patch inventory: [PATCHES.md](../../wasm/PATCHES.md).
