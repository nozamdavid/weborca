# Preview worker investigation, 2026-11-11

No implementation was completed. `OrcaPreview::loadGcode` requires an initialized WebGL context and synchronously processes the file, converts the result using the viewer, and loads it into the viewer. A worker bridge needs a transferable representation of the converted data and its accompanying statistics and metadata; this interface has not yet been implemented or validated.

Baseline: Chromium headless with SwiftShader, existing `wasm/preview/benchmark_preview.mjs`, `PREVIEW_PARSE_ONLY=1`, fixture `wasm/tests/parity/refs-macos-x86_64/cube-voron.gcode` (SHA-256 `60449de3e3f4d50700b4dd22dc2bd3b67f769e0cc010c1967fac8562cca5c115`). The configured runtime JS SHA-256 was `9d3e9b4b3662704302a19e5c93d6923790702317770f9eedf08b51627f56c0b2`, WASM SHA-256 `7a8c15d3d999fd20ee8c361974b1dc08b2488eb8bb751629c4948c1d83123ecf`. One run reported 23.365 ms for the combined load, 100 layers and 26,688 moves. This is not a separate parse, conversion or GPU-upload measurement, and does not establish main-thread improvement. The fixture is small; no representative large-file baseline was obtained.

No parser runtime artifact or packaging interface exists yet. Native compilation, TypeScript compilation, worker responsiveness, cancellation, error handling, fixture equivalence and after measurements remain outstanding.
