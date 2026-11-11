# Native Preview worker API — 2026-11-11

Implemented in shared `fix/weborca-review-followups` checkout.

- Module `parseGcode(inputPath, packetPath)` parses with GCodeProcessor, converts once, saves a versioned packet, returns PreviewStatistics plus parseMs/conversionMs. No viewer or WebGL initialization is required.
- `OrcaPreview.loadParsedGcode(packetPath)` validates and deserializes before changing the viewer, then uses the same renderer load/camera/bounds/bed path as synchronous `loadGcode`. Returns statistics plus rendererLoadMs.
- CPU statistics use libvgcode Layers and ExtrusionRoles, with the same vertex iteration, normal time sums and travel aggregation as ViewerImpl::load. Filament, processor print time and travel metrics retain the previous extraction.
- Packet v1 carries trivial PathVertex bytes, palettes, spiral flag, bed and statistics. It is for the exact same runtime build. Magic, version, stride, byte/count limits, truncation, enum/layer bounds and finite positions/times are checked before renderer load.
- Removed unused Viewer argument from conversion. No frontend, Engine.cpp, CI, services, commits or integrated UI build performed.

## Artifacts

Absolute artifact directory:
`/home/david/.t3/worktrees/OrcaSlicer/prototype-html-in-canva-dace8cac6451aa94/wasm/build/review-preview-native/wasm/preview`

Contains `orca_preview.js`, `orca_preview.wasm`, `runtime-manifest.json`. Existing CMake postbuild also copies the JS/WASM into `wasm/preview/demo`.

Build: sourced wasm/scripts/env.sh (~/emsdk), WASM_PREFIX=$PWD/wasm/build/prefix-review, separate review-preview-native build directory, Release, ORCA_WASM_PREVIEW=ON. Clean target build passed (362 actions); final incremental build passed. ORCA_BUILD_SOURCE refreshed before final compile and manifest create passed. Later parent source/CI identity changes will require the final batch to compile/stamp again.

## Checks

- `c++ -std=c++17 -Isrc/libvgcode/include -Iwasm/preview wasm/preview/test_packet.cpp -o /tmp/orca-preview-packet-test && /tmp/orca-preview-packet-test`: passed. Round-trip preserves vertices, palettes, spiral, bed and metadata; every truncated byte boundary is rejected.
- `node wasm/preview/test_worker_packet.mjs`: passed. Actual cube-voron fixture, 100 layers, 29,904 moves, 575.43 seconds, 1305.74 mm / 3.89 g filament. Parsing occurs before creating/initializing OrcaPreview. Packet load and synchronous baseline statistics match; malformed packet leaves previous statistics intact. Parse 35.00 ms, conversion 0.57 ms, renderer load 4.17 ms.
- `PREVIEW_LAYERS=120 node wasm/preview/test_worker_packet.mjs`: passed. Deterministic detailed fixture, 332,007 converted vertices. Parse 92.32 ms, conversion 8.72 ms, renderer load 36.30 ms.
- Evidence: review-preview-native-small-20261111.json and review-preview-native-large-20261111.json.
- `git diff --check -- wasm/preview`: passed.

Optional `TEST_REAL_WORKER=1` harness check is currently limited by Playwright routing of the nested Emscripten pthread script: Chromium reports `net::ERR_ABORTED` for https://preview.test/orca_preview.js and `worker sent an error! undefined:undefined: undefined`. Main-thread runtime startup and CPU parse before GL both pass. No server was started. Worker heartbeat and deployed worker startup remain for the frontend owner's final-artifact verification.

The fixture-only module logs missing info/nozzle_info.json; this does not prevent parsing or the checks above.

A subsequent manifest verification picked up the parent's in-progress identity changes and failed with ENOENT for `wasm/build/runtime-identities/preview.json`. This is a packaging handoff requirement; the native build and checks are complete. Do not use the prior stamp as the final batch identity.
