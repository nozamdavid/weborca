# Connector runtime qualification — 2026-11-11

PASS against the actual rebuilt engine: nominal plug pegs retain Z=6..10; sockets have length 4.15 mm and max Z=10.05 mm. The corrected forward/inverse tolerance calculation in wasm/engine/CutConnectorOps.cpp matches current src/libslic3r/CutUtils.cpp: plug/snap length includes CONNECTOR_HOLE_OVERLAP and center shifts half(tolerance-overlap); dowels stay centered.

One minimal test follow-up was required: the actual sliced 5 mm socket plus 0.1 mm depth clearance reaches Z=4.9 and produces 26 cavity layers, adding 52 wall blocks to the solid baseline's 100. Updated the exact wall count from 150 to 152 and its explanatory comment in wasm/tests/node/cut-connectors.test.mjs. The initial failing log is preserved as cut-connectors-before.log. No production source was changed by this test task.

## Provenance and artifacts

Evidence directory: [connector-runtime-20261111](connector-runtime-20261111/). All paths below are relative to this checkout, /home/david/.t3/worktrees/OrcaSlicer/prototype-html-in-canva-dace8cac6451aa94.

Source fingerprint before and after build:
6b861c25f9246e7abdb92b5079527816a5423c7888c9da17cd4a7ef065535635.
Recipe: dd5e954dec636be5b773771cbbb74e5170b4489340bd98b0de9633708800331a.

Sourced wasm/scripts/env.sh; selected ORCA_EMSCRIPTEN_VERSION=6.0.11, WASM_ARCH=64, WASM_CFLAGS='-sMEMORY64=1 -pthread -fwasm-exceptions -O2', WASM_PREFIX=$PWD/wasm/build/prefix-review, OCCT_PREFIX=$PWD/wasm/build/prefix-review-occt. Identity commands checked the actual emcc version. Captured engine, preview and step identities before any native builds in wasm/build/runtime-identities; copies accompany this report. Exported ORCA_BUILD_SOURCE from the prebuild fingerprint. No native inputs changed during this run.

Engine/preview dependency identity: c032787d77ece75d53aa136646938283f7c3817278901ac281b1efbbc50016d4.
STEP dependency identity: d4955e5501fd9c390597f8278f1890027a956a420558bc7f8458e71e147da7f4.

| Kind | Runtime directory | JS/MJS SHA256 | WASM SHA256 |
| --- | --- | --- | --- |
| engine | wasm/build/review-preview-native/wasm/engine | 70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7 | ad970ff002e908008cf77a0cc8b8bc31819c61c6e367a8a3e37930e0f9ef4dab |
| preview | wasm/build/review-preview-native/wasm/preview | 6e55011e44a53fdbad7f9aae704d82e95ce6a4bb92b5eefc7de1bdfc55402b71 | 7107d91b30c12a132da3e702af19acd3f9977cff1052022e41c28e7ec8db5976 |
| step | wasm/build/review-step | ae275fd99181db06e7c3d6d6d8c78fc012b10781009f5cff76e9c4fd0b876423 | a97f5444cf5cee49c1e2cfa8a58bc0b7c2dc53eb27b25350daa6a7eada1117aa |

Each directory contains a verified runtime-manifest.json; copies with all artifact hashes are saved in evidence. STEP retains both nonempty OCCT license notices.

## Exact build and validation

Commands ran with fail-fast bash and the environment above:

~~~sh
node wasm/scripts/runtime-manifest.mjs fingerprint
# Before compilation, for each kind engine preview step:
node wasm/scripts/runtime-manifest.mjs identity "$kind"
export ORCA_BUILD_SOURCE=$(cat wasm/reports/connector-runtime-20261111/source-before.txt)
wasm/scripts/memcap.sh cmake --build wasm/build/review-preview-native --target orca_preview orca_engine -j2
node wasm/scripts/runtime-manifest.mjs create engine wasm/build/review-preview-native/wasm/engine
node wasm/scripts/runtime-manifest.mjs create preview wasm/build/review-preview-native/wasm/preview
export BASE_PREFIX=$WASM_PREFIX STEP_MODULE_BUILD_DIR=$PWD/wasm/build/review-step-build
export STEP_MODULE_OUT_DIR=$PWD/wasm/build/review-step WASM_JOBS=2
export OCCT_SRC_ROOT=/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/src/occt-8.0.1-seam-pcurve
wasm/scripts/memcap.sh bash wasm/scripts/build_step_module.sh
JOBS=2 wasm/scripts/memcap.sh bash wasm/tests/parity/build-native-driver.sh wasm/build/review-native-oracle
export ORCA_ENGINE_MODULE=$PWD/wasm/build/review-preview-native/wasm/engine/orca_engine.mjs
export NATIVE_DRIVER=$PWD/wasm/build/review-native-oracle/native-parity-driver
node --test wasm/tests/node/cut-connectors.test.mjs
node --test wasm/tests/node/bed-boundary-slicing.test.mjs
node --test wasm/tests/node/preflight-cancellation.test.mjs
node wasm/tests/parity/current-native-cube.mjs
node wasm/scripts/runtime-manifest.mjs verify engine wasm/build/review-preview-native/wasm/engine
node wasm/scripts/runtime-manifest.mjs verify preview wasm/build/review-preview-native/wasm/preview
node wasm/scripts/runtime-manifest.mjs verify step wasm/build/review-step
git diff --check
~~~

- Engine build compiled CutConnectorOps.cpp and linked orca_engine.mjs successfully (17 build actions). Preview target was successfully checked by the same build. STEP configured and its target completed successfully with no work required. Manifests were created only after successful target builds. Preview/STEP bytes remain unchanged because their inputs were unchanged; this was incremental target verification, not forced relinking.
- Native oracle libraries completed with no work required; native driver was recompiled and linked. Driver SHA256: 435ac45010cbf4eb1af79cc8c70620d37df994373de892626a50d6f18ec94489.
- Connector suite: 8/8 pass after the documented wall-count correction. Includes peg/socket bounds, dowels, invalid-input restoration, plate assignment, real cavity toolpaths and 3MF roundtrip.
- Bed boundary: all 14 checks pass.
- Preflight cancellation: 320,000 triangles, cancellation completed in 8.64 ms; recovery succeeds.
- Current-source native cube oracle: initial and post-Benchy-cancellation cube each have zero normalized differing lines against independently generated native Print G-code. Both have 100 layers, 8,802 G1 moves and summed extrusion 1306.8087. Exact raw output/config hashes are in oracle-hashes.txt.
- All three manifests reverified against actual prefixes after testing; fingerprint stable; git diff --check passes.

## Limits

Incremental, compatible-cache qualification, not cold dependency reproducibility. Existing Ninja interrupted-log recovery, Emscripten pthread/memory-growth and MEMORY64 deprecation warnings, native TBB ODR/LTO warnings, missing nozzle_info fixture warning and Node module-type warning remain in logs. No test failure remains.

Packet tests were not repeated: the connector correction changes engine geometry only; preview/STEP artifacts are byte-identical and their successful targets/manifests are verified. No new preview behavior claim is made. No integrated UI build, browser/service work, deployment, commit, broad native parity or fit/interference proof was performed. Runtime directories remain writable incremental caches; verify manifests before packaging. Parent retains README/Taproot milestone coordination.
