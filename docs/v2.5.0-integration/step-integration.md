# Standalone STEP v2.5 integration

Status: patched module built; direct release geometry checks passed. Browser integration is owned by the browser worker. No integrated app build, deployment or commit was performed by the STEP worker.

## Changed files

- `wasm/deps/build_occt.sh`: extracts OCCT 8.0.1 into a separate patched source root and applies the exact upstream seam-pcurve patch before configuring. Repeated invocation accepts the applied patch; mismatched hunks fail. `OCCT_SRC_ROOT` can select another isolated source root.
- `wasm/step/CMakeLists.txt`: honors the cached `STEP_MODULE_OUT_DIR`, allowing an isolated artifact directory.
- `wasm/scripts/build_step_module.sh`: forwards that output directory and copies the LGPL notices from the patched source root.
- `wasm/tests/node/step-module.test.mjs`: adds focused checks for the release cone, loose-face compound and shell import. The shell case changes the existing tetrahedron fixture's representation in memory to a shell-based surface model. No new fixture asset or testing framework.
- This report.

The foundation's merged `src/libslic3r/Format/STEPTessellate.cpp` was compiled without further edits. No Engine, Preview, UI, root CMake or other dependency build scripts were changed by this worker.

## Dependency and artifact identity

Base merge: `709ff3ecd09824b4f2bd3a78f398c3a038811243`, upstream parent `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`. The module uses the current merged tessellator, not the former module relabeled as v2.5.

| Input/output | SHA256 |
| --- | --- |
| OCCT `V8_0_1.zip` | `7c033d917ee8f040c0512d289dcc5f02c148889d5bac17c3e25639accb44f0da` |
| `deps/OCCT/0001-BRepMesh-seam-pcurve-at-edge-parameter.patch` | `f2ea19e8fc68999e2431f66d4098c8b495ddf942f5b0cb317bc638467121a39b` |
| merged `STEPTessellate.cpp` | `8e95a834308351f1c1bdb6a974a1833865d4c5be2163c504eb32b2a9b8bf82f3` |
| standalone `main.cpp` | `e62edb7874dbad6e6e2ff880708aa37e2ab7a5fc31d25acfea12315c2b319efc` |
| patched `libTKMesh.a` | `890d17d570cce177739bd0384dcd9344e056810c56cdefee1bf3fee06e6652da` |
| `step_tessellate.mjs` | `ae275fd99181db06e7c3d6d6d8c78fc012b10781009f5cff76e9c4fd0b876423` |
| `step_tessellate.wasm` | `a97f5444cf5cee49c1e2cfa8a58bc0b7c2dc53eb27b25350daa6a7eada1117aa` |

All following paths are under `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/`:

- Fresh patched source: `wasm/build/src/occt-8.0.1-seam-pcurve/OCCT-8_0_1`.
- Fresh OCCT configure/build: `wasm/build/occt-v250-step-build`.
- Isolated dependency prefix: `wasm/build/prefix-v250-occt-step`.
- Standalone build: `wasm/build/v250-step-module-build`.
- Packaging-ready output: `wasm/build/v250-step-module`, including both LGPL notices.
- Commands, source/compile/archive audits and test logs: `wasm/build/v250-step-evidence`.

SDK is Emscripten **6.0.11**, LLVM **24.0.0git f718ebe873411a562ef6e5c27da36d75b7aaec98**. Compiler flags match the existing standalone ABI: `-sMEMORY64=1 -pthread -fwasm-exceptions -O2 -UOCC_CONVERT_SIGNALS`; OCCT Release adds `-O3 -DNDEBUG -DNo_Exception -std=gnu++17 -DOCCT_NO_PLUGINS` and its usual warnings/PIC flags. The standalone module retains its existing pthread, exception, memory-growth, mimalloc, CJK-table-stub and 4GB maximum-memory options.

The patch changes only `BRepMesh_ModelPreProcessor.cxx`: evaluate the seam's first pcurve at the edge's first parameter, avoiding the infinite first parameter of a nearly vertical 2D line.

## Reuse provenance

The original prefix, source, build objects and deployed artifacts were read only. All **67 TKMesh translation units** were rebuilt from the fresh patched source and archived together. The other 41 toolkit archives were copied into the isolated prefix, with library symlinks redirected into that prefix.

Before reuse, the extracted, checksum-verified release source was compared recursively with the original OCCT source. The only difference was the original `adm/cmake/occt_defs_flags.cmake` commenting out `add_definitions(-DOCC_CONVERT_SIGNALS)`. The new pristine configuration defines it before the existing `-UOCC_CONVERT_SIGNALS` flag, yielding the same effective preprocessing. `old-source-flags.diff` records this difference.

`audit.sh`/`audit2.log` confirm that all **5,226 compiler commands** match after normalizing source/build paths, whitespace, and that overridden definition. Every original object producer identifies the exact LLVM commit above (`object-producers.txt`). Every installed original toolkit archive matches its original build archive. Original archive hashes still verify after the build; all copied toolkits except TKMesh remain byte-identical. This is coherent reuse of unchanged OCCT toolkits; no old tessellator or CGAL objects were linked into the new module.

Preparation's initial source-equality gate rejected the discovered signal-definition difference. The first command comparison then rejected whitespace/the explicitly overridden definition. Those were investigated before the final normalized audit passed; logs are preserved.

## Checks and limits

Every heavy operation used the original `run-capped.sh` with **2GiB**, zero swap and `/tmp/webslicer-heavy.lock`. TKMesh compilation used two jobs and a 180-second batch limit, finishing in 17.4 seconds at 218.3MiB peak. Standalone compile/link finished in 25.2 seconds at 506.2MiB peak. No existing original or CGAL prefix was modified.

Direct release geometry checks passed **5/5** (`geometry2.log`, repeated after final test cleanup in `geometry-final.log`):

- Tilted-seam cone: **6,958 triangles**, finite positions, valid indices, three distinct coordinates per triangle and exactly two incident triangles on every coordinate-welded edge. Bounds approximately `[-36.4000,-36.3996,0]..[36.3985,36.3996,25]`.
- Compound of two loose faces, both split modes: one output mesh, four triangles, exact bounds `[0,0,0]..[10,10,10]`.
- Shell without a solid, both split modes: one output mesh, four triangles, the same exact bounds.

The original unpatched standalone module fails the same cone closed-edge assertion (`seam-before.log`), demonstrating that the new check detects the dependency regression.

The existing `step.test.mjs` suite passed **5/5** against the patched module and upgraded OCCT-free engine (`import.log`, 1,394,229,248 bytes cgroup peak): multipart UTF-8 volume names and positive finite bounds; classified STEP import and actual slicing; append/replace and handoff-file cleanup; malformed STEP and corrupted packed mesh rejection without changing the project, followed by successful retry; invalid deflection rejection and valid custom settings.

The first combined full STEP suite exceeded the required 2GiB cap while retaining the historical OCCT engine, upgraded main engine and standalone module together (`suites.log`); it was OOM-killed. The separately filtered historical two-engine comparison also exceeded the cap (`historical-parity.log`). Historical bit-for-bit comparison remains unverified. The existing import/slicing suite and direct release geometry suite both pass separately within the cap.

The runtime engine paired for `loadStepMesh` checks is `wasm/build/v250-engine-module-s2/orca_engine.mjs`, SHA256 `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7`, with WASM SHA256 `452c0ab51a0b935f691384e629d73ad0005fda99733b059d18cc600c0d4c1f19`. This engine intentionally has OCCT disabled. There is **no verified native OCCT8 STEP pair**: the available system OCCT is 7.9.2, and the native core owner builds with OCCT disabled. The historical `orca-step-runtime` is a WASM oracle from the former source, not a same-source native reference.

Lazy-module loading, cancellation, worker termination and browser retry belong to the browser owner's final immutable candidate QA. Artifact paths and hashes, direct fixture results, and this explicit remaining requirement were sent to that owner and the parent immediately. Browser evidence must be recorded by that owner; no browser pass is inferred here.

A full clean rebuild can use the normal scripts (under the same capped runner), with a fresh `WASM_PREFIX` and `BUILD_DIR` for `wasm/deps/build_occt.sh`, followed by `wasm/scripts/build_step_module.sh` with `BASE_PREFIX`, matching `OCCT_PREFIX`, `STEP_MODULE_BUILD_DIR`, and `STEP_MODULE_OUT_DIR`. The accelerated audited build used the recorded `prepare.sh`, `rebuild-tkmesh.sh` and `audit.sh` in the evidence directory; the tracked build script always builds/installs the selected OCCT dependency normally.
