# Independent native Preview acceptance — 2026-11-11

Actual worker parsing passes for both fixtures using the existing compiled artifact. The previous nested-pthread `net::ERR_ABORTED` is a Playwright route-serving limitation in this reproduction: replacing interception with an owned loopback HTTP server fixes it without changing JS/WASM. The server sends COOP/COEP headers, imports `/preview/orca_preview.js`, and maps WASM through the production locateFile callback. Worker and nested pthread load successfully. Browser, workers and server are closed. No blocking fallback parser was added.

## Reproduction and checks

Original command `TEST_REAL_WORKER=1 node wasm/preview/test_worker_packet.mjs` failed with `FAILED https://preview.test/orca_preview.js { errorText: 'net::ERR_ABORTED' }` and `worker sent an error! undefined:undefined: undefined`.

After the harness serving correction, both commands pass:

```sh
TEST_REAL_WORKER=1 node wasm/preview/test_worker_packet.mjs
TEST_REAL_WORKER=1 PREVIEW_LAYERS=120 node wasm/preview/test_worker_packet.mjs
c++ -std=c++17 -Isrc/libvgcode/include -Iwasm/preview wasm/preview/test_packet.cpp -o /tmp/orca-preview-packet-test && /tmp/orca-preview-packet-test
node --check wasm/preview/test_worker_packet.mjs
git diff --check -- wasm/preview/test_worker_packet.mjs
```

No native source changed; the native packet test translation unit was compiled and executed. The changed JS harness passes syntax compilation and both focused runtime tests. No integrated UI build or runtime rebuild was necessary.

The worker parses before any viewer/GL creation. Its transferred packet loads into the main-thread renderer. Worker, main-thread CPU parse, packet load and synchronous load match all statistics excluding timing fields. Truncated packet rejection preserves statistics (including the prior renderer timing), layer Zs and vertex count; rendering still succeeds afterward. This checks state and a render call, not pixel equivalence or camera state.

## Measurements

Single headless Chromium/SwiftShader sample per fixture; milliseconds are elapsed stage durations, not CPU-profiler samples. Worker heartbeat resets on the worker's pre-parse message and stops on result receipt, so it includes packet writing/transfer. Renderer heartbeat is a zero-delay timer scheduled immediately before loadParsedGcode; it includes validation/deserialization and synchronous renderer work.

| Fixture | Vertices | Worker parse ms | Conversion ms | Renderer load ms | Worker heartbeat ticks / max gap ms | Renderer timer delay ms | Packet bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cube-voron | 29,904 | 34.78 | 0.61 | 5.66 | 8 / 5.01 | 8.35 | 2,392,979 |
| generated 120 layers | 332,007 | 90.24 | 9.52 | 37.18 | 32 / 5.03 | 53.44 | 26,560,894 |

Evidence: [small JSON](review-preview-native-acceptance-small-20261111.json), [large JSON](review-preview-native-acceptance-large-20261111.json). These are actual worker observations, not a speedup claim against a main-thread baseline. Large packet deserialization/renderer work still blocks the UI for about 53 ms in this sample.

## Actionable native findings

1. **Packet validation does not ensure renderer-safe palette indices.** `packet.hpp::read_packet` accepts empty tool/color palettes and vertices whose extruder_id exceeds tools_colors.size(). `ViewerImpl.cpp` indexes tool palettes directly and uses modulo color_print_colors.size() in Tool/ColorPrint/Summary views. Invalid accepted input can therefore cause out-of-bounds access or division by zero after the old viewer is reset. Validate nonempty palettes and extruder references before loadPacket. This is malformed-packet handling, not evidence that legitimate worker output is malformed.
2. **Metadata and numeric validation is incomplete.** Statistics are checked only for opening/closing braces; `{invalid}` passes and later produces invalid JSON after renderer mutation. Bed coordinates and vertex scalar fields other than positions/times are not checked for finiteness. Parse/validate statistics and reject nonfinite renderer inputs before replacing prior state.

Concrete compiled probe constructed one extrusion vertex with extruder_id=255, no palettes, stats=`{invalid}`, and bed=`{{NAN,0}}`; save_packet/read_packet succeeded and printed `accepted: malformed JSON, empty palettes, extruder=255, NaN bed; vertices=1`. This confirms acceptance; no unsafe renderer invocation was attempted. The existing native roundtrip test itself permits an empty color-print palette. Production source fixes are left for the native implementation owner; acceptance for arbitrary malformed packets remains incomplete.

3. **Memory bounds are structural, not a practical allocation budget.** Counts are checked against file bytes and 100,000,000 elements (bed: 1,000,000), preventing truncated-file count amplification. They still allow very large allocations relative to browser memory. MEMFS input packet, deserialized vertices and renderer staging coexist. The large fixture's packet alone is 26.6 MB; no peak-memory profile or OOM recovery guarantee was established. A renderer allocation failure occurs after reset and therefore is not covered by prior-state preservation.

## Code review conclusions and limits

CPU statistics mirror ViewerImpl's Layers.update, normal-time vertex accumulation, Travel accumulation and ExtrusionRoles.add iteration. Phantom vertices carry zero time. Filament and processor print time extraction remain in prepare_gcode. Differential runtime checks share prepare_gcode, so they cannot independently prove it correct; source comparison against ViewerImpl provides the independent evidence for feature/layer aggregation.

Processor storage is scoped to end before viewer allocation. Packets transfer independent FS.readFile bytes; the worker terminates only after result receipt. loadPacket takes ownership and moves vertices into ViewerImpl, avoiding a dangling reference. The frontend worker's finally block unlinks MEMFS input/output; this harness terminates its worker per test and deletes the main viewer. Long-lived worker RSS and cancellation were outside this native harness.

The fixture lacks info/nozzle_info.json and logs its known parse warning. Production resource loading, the frontend TypeScript worker/client lifecycle, deployment headers, cancellation and final build identity remain parent/other-owner verification. No frontend, CI, Engine.cpp, README, Taproot or commits changed.

Artifact SHA-256:

- JS: `6e55011e44a53fdbad7f9aae704d82e95ce6a4bb92b5eefc7de1bdfc55402b71`
- WASM: `9b840c987431ee63f51db126176bc00129f26a032c8be3a794e439cb7fdf6798`

Final provenance stamping remains with the parent after the in-progress identity contract lands.

## Parent packet validation correction

read_packet now rejects empty tool/color palettes, out-of-range tool indices, malformed statistics JSON, invalid required numeric/feature fields, nonfinite bed points and vertex scalar fields. Native packet regressions pass with -Ideps_src, and preview.cpp's Emscripten translation unit compiles. The final runtime must be relinked before rerunning artifact acceptance. Practical large-file peak-memory/OOM qualification remains unclaimed; no arbitrary file-size limit was introduced.
