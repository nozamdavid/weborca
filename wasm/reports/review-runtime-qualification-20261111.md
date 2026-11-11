# Runtime qualification — 2026-11-11

Qualified engine, preview and standalone STEP from the shared source snapshot. No product source, build script, UI build, service, commit, README or Taproot change was made. Evidence lives in `wasm/reports/runtime-qualification-20261111/`.

## Inputs and provenance

Working directory: `/home/david/.t3/worktrees/OrcaSlicer/prototype-html-in-canva-dace8cac6451aa94`.

Source `wasm/scripts/env.sh`. Actual `emcc --version`: 6.0.11 (a0014542110d6078c3a1a7941fa1ddb3a2281f16); explicitly selected `ORCA_EMSCRIPTEN_VERSION=6.0.11`. `WASM_ARCH=64`, `WASM_CFLAGS='-sMEMORY64=1 -pthread -fwasm-exceptions -O2'`, `WASM_PREFIX=$PWD/wasm/build/prefix-review` (CGAL 6.2.1), `OCCT_PREFIX=$PWD/wasm/build/prefix-review-occt` for STEP.

All three manifests have source fingerprint `757eb10026bc7d34e114ae8c298203b0c6ba6cee147bef88ba6a349a140ca8c2` and recipe `dd5e954dec636be5b773771cbbb74e5170b4489340bd98b0de9633708800331a`. Final verification rehashed both actual prefixes and accepted all manifests. No observed native input change occurred during compilation.

Captured independent pre-compilation receipts at `wasm/build/runtime-identities/{engine,preview,step}.json`; copies are in the evidence directory. Exported `ORCA_BUILD_SOURCE` before compilation, created manifests only after successful compilation. Engine/preview use dependency identity `c032787d77ece75d53aa136646938283f7c3817278901ac281b1efbbc50016d4`; STEP uses `d4955e5501fd9c390597f8278f1890027a956a420558bc7f8458e71e147da7f4`.

Initial capture exposed three ordinary libpng symlinks rejected by the contract. Replaced only those links with dereferenced copies in this worktree's private prefix. An initial build command continued despite capture failure; stopped its processes, then restarted with fail-fast shell, successful receipts and the same source fingerprint. No artifact from that attempt was stamped without the subsequent successful build. A Ninja interrupted-log warning was recovered on restart. No provenance script bypass was used.

OCCT cache was copied with dereferencing from read-only `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/prefix-v250-occt-step`; source build cache identifies OCCT 8.0.1 seam-pcurve source, memory64/pthreads/exceptions/O2 flags and `-UOCC_CONVERT_SIGNALS`. No parent source/cache was modified. This is compatible cache-assisted qualification, not a cold dependency rebuild or independent reproducibility proof.

## Outputs

| Kind | Directory relative to working directory | JS/MJS SHA256 | WASM SHA256 |
| --- | --- | --- | --- |
| engine | wasm/build/review-preview-native/wasm/engine | 70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7 | 4492d1f174e448ba2d359ba3ca699ec46d54c85387b510ae335f1a49dd1ef07a |
| preview | wasm/build/review-preview-native/wasm/preview | 6e55011e44a53fdbad7f9aae704d82e95ce6a4bb92b5eefc7de1bdfc55402b71 | 7107d91b30c12a132da3e702af19acd3f9977cff1052022e41c28e7ec8db5976 |
| STEP | wasm/build/review-step | ae275fd99181db06e7c3d6d6d8c78fc012b10781009f5cff76e9c4fd0b876423 | a97f5444cf5cee49c1e2cfa8a58bc0b7c2dc53eb27b25350daa6a7eada1117aa |

Each directory contains runtime-manifest.json. STEP contains nonempty LICENSE_LGPL_21.txt and OCCT_LGPL_EXCEPTION.txt copied from the compatible source cache. Build directories remain writable incremental caches; treat selected artifact bytes as candidate inputs and verify manifests before consumption.

Engine and preview linked using `cmake --build wasm/build/review-preview-native --target orca_preview orca_engine -j2` under memcap. This reused the compiled native libraries and completed Engine.cpp object plus remaining engine objects and current preview link. STEP used build_step_module.sh with BASE_PREFIX=WASM_PREFIX, STEP_MODULE_BUILD_DIR=$PWD/wasm/build/review-step-build, STEP_MODULE_OUT_DIR=$PWD/wasm/build/review-step, OCCT_SRC_ROOT pointing to the compatible cache source above, WASM_JOBS=2. Logs remain `/tmp/review-runtime-build-final.log` and `/tmp/review-step-build.log`.

## Runtime checks

- PASS strengthened native packet test compiled with `c++ -std=c++17 -Isrc/libvgcode/include -Ideps_src -Iwasm/preview wasm/preview/test_packet.cpp -o /tmp/review-qualified-packet`, then executed. Covers truncations, palettes/tool index, malformed JSON, required numeric types, NaN bed and NaN width.
- PASS preflight-cancellation.test.mjs with ORCA_ENGINE_MODULE selecting the new engine: abort on actual Checking bed boundaries progress for 320,000 triangles, 8.53 ms observed abort completion, recovery cube succeeds.
- PASS bed-boundary-slicing.test.mjs against the same engine: all 14 checks, including transformed copies, concave/circular/nonzero-origin beds, second plate, failure/cancellation restoration and explicit nonprintable state.
- PASS TEST_REAL_WORKER=1 PREVIEW_MODULE_DIR selecting the new preview, small fixture and PREVIEW_LAYERS=120 fixture. Worker/main parser/packet renderer statistics agree; truncation preserves state and rendering. Small: 29,904 vertices, 2,392,979 packet bytes, renderer timer delay 7.90 ms. Large: 332,007 vertices, 26,560,894 bytes, timer delay 87.32 ms. Single headless SwiftShader observations; no peak-memory/OOM or responsiveness guarantee.
- PASS additional temporary real-worker probe (saved with evidence): empty tool palette, invalid JSON and NaN vertex position all reject, prior statistics/layers/move count preserved, subsequent render succeeds. This extends the existing harness solely to verify the concrete malformed-packet findings; production harness/source was not edited. Saved probe imports use this machine's absolute paths.
- PASS all three runtime-manifest.mjs verify commands with actual expected environment above; git diff --check.

Known fixture warning: missing info/nozzle_info.json. Cancellation fixture logs its expected flat-mesh convex-hull warning. Node reports the existing engine-core.js module-type warning. No checks failed.

## Packaging handoff and limits

For the eventual Vite build select ORCA_ENGINE_DIR=$PWD/wasm/build/review-preview-native/wasm/engine, ORCA_PREVIEW_DIR=$PWD/wasm/build/review-preview-native/wasm/preview, ORCA_STEP_MODULE_DIR=$PWD/wasm/build/review-step. Keep the same expected flags/version and receipts. ORCA_PROFILES_DIR defaults to wasm/build/web/profiles (index.json present); ORCA_SETTINGS_DIR defaults to wasm/build/settings (layout.json present). Vite copies layout to settings/layout.json and root layout.json and verifies all three manifests and copied bytes.

Docker currently has fixed COPY prerequisites at orca-wasm64/wasm/engine, orca-wasm64-preview/wasm/preview and step-module, plus runtime-identities, profiles and settings. Those existing default runtime directories were not replaced. Stage the qualified artifact sets plus manifests there in a separate packaging context before using Docker; passing Vite selection variables alone does not change Docker COPY inputs. Both OCCT license files must accompany STEP. Docker expected build arguments default to the qualified 64/flags/6.0.11 configuration. Docker image/package execution remains untested.

No integrated UI build was run while worker TypeScript was unfinished. No browser/API preview tools, hosted CI execution, service changes or native oracle build. Current-source native parity oracle and obsolete golden debt remain separate; no WASM-derived golden was generated. Test-owned browsers, workers and HTTP servers closed; owned build/test processes completed.
