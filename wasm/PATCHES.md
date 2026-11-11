# OrcaSlicer Patches for WASM Support

- `CMakeLists.txt`: Add build options (`SLIC3R_WITH_*`), Emscripten flags, cross-compile test gating, optional dependency lookups, and `wasm` subdirectory.
- `deps_src/CMakeLists.txt`: Guard GUI-only dependency subdirectories (`hidapi`, `hints`, `imgui`, `imguizmo`, `md4c`, `mdns`, `minilzo`) behind `if (SLIC3R_GUI)`.
- `src/CMakeLists.txt`: Early return under `EMSCRIPTEN` before desktop executable and install targets.
- `src/libslic3r/CMakeLists.txt`: Conditionally gate optional dependencies, compile definitions (`SLIC3R_NO_*`), Apple-only sources, and embed conditional library lists in original link order.
- `src/libslic3r/Format/AssimpImport.cpp`: Guard Assimp implementation behind `SLIC3R_NO_ASSIMP`, providing a stub that returns false and sets error message.
- `src/libslic3r/Format/DRC.cpp`: Guard Draco implementation behind `SLIC3R_NO_DRACO`, providing load/store stubs that return false.
- `src/libslic3r/Format/STEP.cpp`: Guard OpenCASCADE implementation behind `SLIC3R_NO_OCCT` while keeping `StepPreProcessor` compiled, providing stubs returning failure status.
- `src/libslic3r/Format/STEP.hpp`: Guard OpenCASCADE headers and OCCT types behind `SLIC3R_NO_OCCT`.
- `src/libslic3r/Format/3mf.cpp`, `src/libslic3r/Format/3mf.hpp`: The PrusaSlicer probe of a single-file 3MF inflates and parses the model file in pieces and stops after the model metadata, instead of parsing every mesh.
- `src/libslic3r/Format/bbs_3mf.cpp`: Guard OpenSSL MD5 header include and plate G-code MD5 calculation behind `SLIC3R_NO_OPENSSL`. Format the mesh XML of an object in parallel, passing the same bytes to the archive in the same pieces. Apply `StoreParams::model_compression_level` to the model files.
- `src/libslic3r/Format/bbs_3mf.hpp`: Add `StoreParams::model_compression_level` (-1, the default, keeps the existing deflate level).
- `src/libslic3r/Print.{cpp,hpp}`, `src/libslic3r/GCode.{cpp,hpp}`, `src/libslic3r/GCode/GCodeProcessor.{cpp,hpp}`: Allow web slicing exports to skip preview-only actual-speed vertex interpolation through the belt-aware G-code factory and IMEX offsets. Desktop exports and standalone G-code parsing keep interpolation enabled by default; exports with nozzle preheating or legacy ooze-prevention backtraces retain it because those paths consume the moves. Standalone parsing retains `collect_line_offsets = true`, with an opt-out for the web preview's own source index.
- `src/libslic3r/Format/svg.cpp`: Guard OpenCASCADE implementation behind `SLIC3R_NO_OCCT`, providing a stub `load_svg` that returns false and sets error message.
- `src/libslic3r/ObjColorUtils.cpp`: Guard OpenCV `QuantKMeans` clustering implementation in `obj_color_deal_algo` behind `SLIC3R_NO_OPENCV`, returning false when disabled.
- `src/libslic3r/ObjColorUtils.hpp`: Guard OpenCV includes and `QuantKMeans` class declaration behind `SLIC3R_NO_OPENCV`.
- `src/libslic3r/Platform.cpp`: Add Emscripten detection in `detect_platform()`, returning "wasm" for OS and "wasm64" or "wasm32" based on pointer size for architecture.
- `src/libslic3r/SLA/Hollowing.cpp`: Guard OpenVDB headers, grid accessor members, and volume processing behind `SLIC3R_NO_OPENVDB`.
- `src/libslic3r/Shape/TextShape.cpp`: Removed upstream in v2.5.0 together with its source-list entry; the former OpenCASCADE stub is obsolete.
- `src/libslic3r/TexturePainting.cpp`: Guard OpenCV implementation behind `SLIC3R_NO_OPENCV`, providing stubs returning false or empty defaults.
- `src/libslic3r/Thread.cpp`: Guard thread naming under `__EMSCRIPTEN__` with no-op stubs returning false or nullopt.
- `src/libslic3r/Utils.hpp`: Guard OpenSSL MD5 header include behind `SLIC3R_NO_OPENSSL`.
- `src/libslic3r/utils.cpp`: Guard OpenSSL MD5 header include and `bbl_calc_md5` implementation behind `SLIC3R_NO_OPENSSL`, returning false when disabled.
- `tests/CMakeLists.txt`: Propagate Emscripten link options via `test_common`, disable Catch2 auto-discovery, and guard non-WASM test directories.
- `tests/catch2/CMakeLists.txt`: Lower `cmake_minimum_required` to `VERSION 3.13` to support root project CMake version.
- `tests/libslic3r/CMakeLists.txt`: Guard `test_drc.cpp` source, `find_package(Draco REQUIRED)`, and Draco linkage behind `if (SLIC3R_WITH_DRACO)`.

## v2.5.0 local integration checkpoint

- Keep the upstream CGAL 6.2 minimum and matching `CGAL_LINKED_WITH_TBB` definitions on geometry consumers. The WASM script now pins/checksums 6.2.1. The validated prefix is `wasm/build/prefix-v250-wasm64`, with fresh consumers in `wasm/build/orca-v250-wasm64`, bundled libigl (`CMAKE_DISABLE_FIND_PACKAGE_libigl=ON`), Preview enabled and `ORCA_WASM_MESH_BOOLEAN_OPTIMIZATION=-O1`. Old CGAL geometry objects must not be reused. The existing libigl operations live in `MeshBooleanIGL.cpp` to keep the CGAL unit within the 2 GiB build cap. Headless native configuration gates GUI-only Python discovery; the segment sweep avoids unused rational traits unsupported by WASM.
- STEP preprocessing/tessellation remains extracted into `Format/STEPTessellate.cpp`; upstream compound/shell/loose-face collection is ported there for both native import and the standalone module. The standalone preprocessing error strings remain untranslated to avoid adding engine localization linkage to that module.
- `src/libvgcode`: retain WebOrca ES packed RGB uploads/shaders, low-quality ribbons, shared texture endpoints, cached ranges, stepped numeric palettes, CPU-cache release and enhanced-lighting control. Public filament palettes use upstream RGBA storage; native rendering retains upstream RGBA/translucency/gloss. ES opacity is disabled by default pending a coordinated shader/index/ribbon port. Web palette conversion/legend adapters remain a separate batch.
- Configuration adapters migrate saved aliases/arc enums before filtering, resolve native preset renames and delete filament slots transactionally with typed vectors, maps and painting. Repair uses upstream `repair_mesh` and preserves annotations for byte-identical geometry. The cooling-temperature first-value fallback is retained and regression-tested.
- Preview adapters retain RGBA storage, RGB legends and double processor totals with the existing opaque ES rendering policy. Standalone STEP applies the upstream OCCT 8.0.1 seam-pcurve patch in isolated sources and supports explicit module output directories plus LGPL notice packaging.
- App packaging/development accept `ORCA_ENGINE_DIR`, `ORCA_STEP_MODULE_DIR`, `ORCA_PREVIEW_DIR`, `ORCA_PROFILES_DIR` and `ORCA_SETTINGS_DIR`. Use the matching frozen pairs and merged-source data documented in the [integration summary](../docs/v2.5.0-integration/README.md).
- [Foundation resolutions](../docs/v2.5.0-integration/merge-foundation.md) remain historical. The [local integration evidence and limits](../docs/v2.5.0-integration/README.md) supersede its pending build status for the scoped existing-browser milestone. Deployment, parity, physical hardware and new browser features remain open.
