# v2.5.0 Preview adapters

Worktree: `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`, based on merge `709ff3ecd09824b4f2bd3a78f398c3a038811243`. No commits, integrated UI build or deployment. Read the original checkout's `AGENTS.md` and `preview-build-compatibility.md`, and this worktree's [merge foundation](merge-foundation.md).

## Changes

- [convert.cpp](../../wasm/preview/convert.cpp) and [convert.hpp](../../wasm/preview/convert.hpp): processor tool/color-print palettes use RGBA bytes, including rounded decoded alpha. Invalid strings use dummy RGB with alpha 255. Existing RGB-to-Slic3r conversion remains available. Empty color-print input still copies tool colors.
- [preview.cpp](../../wasm/preview/preview.cpp): `setToolColors` uses `PaletteWithAlpha`; its 256-entry cap, default extension and empty-entry preservation stay intact. RGBA legends project RGB and retain `#RRGGBB`. Processor total seconds stay `double` until fixed-two-decimal JSON serialization; viewer times remain the explicit float boundary.
- [test_palette_conversion.cpp](../../wasm/preview/test_palette_conversion.cpp): actual conversion functions cover black, saturated primaries, alpha 0/128/255, rounding, invalid/empty decode fallback and retained RGB conversion.
- [test_lighting.mjs](../../wasm/preview/test_lighting.mjs): matching-module checks add tool/color-print/summary fallback and RGB legends, empty updates, invalid fallback, exact opaque rendering for all decoded alpha values, metadata preservation and a large processor total with a one-second increment. All 13 numeric views check normal/low-quality legend values, valid RGB colors, unchanged move/range metadata and exact normal rendering restoration. Existing actual G-code lighting/quality/range roundtrips remain in the same suite.

No `src/libvgcode` changes were needed. Source audit confirms ES color staging is one packed RGB float per vertex (`R32F`), decoded from `.r`; positions are `Vec4`/`RGBA32F`, dimensions are normal `Vec4`/`RGBA32F` or low-quality pairs/`RG32F`. Shared-endpoint pages use the same original-vertex stride for all arrays. Native color staging remains `ColorWithAlpha`/`RGBA8`. ES opacity stays disabled in `Settings.hpp`.

The role/option RGB paths and numeric range palettes remain RGB. Numeric paths include height, width, speed/actual speed, fan, temperature, pressure advance, acceleration, jerk, flow/actual flow and linear/log layer time. Low quality resolves eight stepped colors using the same range function as legends. Slider colors remain uniforms, enabled ranges retain original indices, bounds remain cached across lighting/range changes, and lighting preference remains independent of quality. These are source-audit findings; browser evidence is reported separately below.

## Verification status

All heavy commands use the original serialized 2 GiB runner. New outputs are under `wasm/build/v250-preview-adapters/`; original caches are read only.

| Check | Status / evidence |
| --- | --- |
| Host ES renderer archive | Passed, all 22 units; `wasm/build/v250-preview-adapters/renderer-es/liblibvgcode.a`. See `wasm/build/v250-preview-adapters/host.log`. This does not validate WebAssembly or GLSL. |
| Existing low-quality CPU suite | Passed in `host.log`; executable `wasm/build/v250-preview-adapters/test-low-quality`. |
| Palette conversion host executable | Passed using actual `convert.cpp` + `Color.cpp`, new-prefix headers and bundled libigl; `palette-final.log`, executable `test-palette`, peak 1,814,900,736 bytes. Earlier attempts found missing standalone include paths (`semver`, then bundled `igl`); no product workaround was added. Unused functions are discarded at host link; this test does not link the processor or geometry. |
| Matching-prefix module configure / adapter translation units | Passed; `configure-wasm.sh`, `configure-final.log` and `wasm-objects.log` under the output directory. Both `preview.cpp` and `convert.cpp`, the demangle stub and all renderer units compile with dependency owner's fresh `prefix-v250-wasm64`, SDK 6.0.11, memory64/pthreads/WASM exceptions, bundled libigl and identical configuration flags. Peak 707,026,944 bytes. Initial configure invocation used a relative script path despite the runner's original-checkout cwd; rerun with absolute path passed. |
| FPS / draw scheduling / initial viewport | Four existing cases passed; `fps-scheduling.log`. These exercise the TS wrapper with controlled renderer/frame scheduling, not real WebGL draws. |
| JS syntax / patch whitespace | `node --check wasm/preview/test_lighting.mjs` and scoped `git diff --check` passed. |
| Matching Preview final link | Passed using final corrected core archives. Archive hashes verified before/after link; copied manifest `core-archive-hashes.txt`. Matching pair: `module/wasm/preview/orca_preview.{js,wasm}`; exact hashes in `module-sha256.txt`. |
| Extended actual G-code browser suite | **Chromium passed**, 29,904 moves / 100 layers, all lighting/shadow/four-quality-mode/range/clipping/replacement cases plus 13 numeric views, RGBA/RGB legends, empty preservation and large-total-time +1 case; browser errors `[]`. Evidence `lighting.log` and `lighting/chromium-{before-shadows-off,after-shadows-on}.png`. Renderer: ANGLE Vulkan SwiftShader. |
| Firefox suite | **Harness failed before module load** at `browser.newPage`, `Cannot read properties of undefined (reading '_page')`; browser/module errors `[]`. See `lighting.log`. This does not establish a Firefox renderer result. |
| Upload benchmark / value + source-line batch | Not reached because the sequential batch stopped at the Firefox harness failure. A separately launched `check-final-runtime.sh` invocation appeared under the same output directory/runner label and overwrote `final-runtime.log`; ownership coordination requested before duplicate work. |

The dependency owner alone builds geometry/libslic3r in `wasm/build/orca-v250-wasm64`. Preview uses its own build root `wasm/build/v250-preview-adapters/module` for adapter/render objects and reuses only the completed coherent new core archives. No duplicate core build occurred. `wasm/build/v250-preview-adapters/link-preview.sh` derives from CMake's generated link command, with core archive paths redirected read-only to the owner's build root and the source-demo copy step omitted. It ran through the same 2 GiB serialized runner after final archive readiness. The earlier queued provisional link was cancelled before acquiring the lock following the core processor capture refresh notice. Playwright uses a worktree-local symlink to the original installed dependencies; no package installation occurred.

Final core SHA256: libslic3r `0c406e4372ac7a6f31c8468b35e37119841adf9eaaf3dd53198d32e570bef025`; CGAL archive `e61216d58dd25b7b4fae25a8714216579166233c66b51c3c9929738f3994bec9`.

Tested Preview SHA256: JS `9d3e9b4b3662704302a19e5c93d6923790702317770f9eedf08b51627f56c0b2`; WASM `e068d00989f8daa23f1fe7454ed1f7bdb4b3fc589facecbeb0f9a4d65607e038`. Both hashes verified again after the first runtime batch. The identical pair was copied into this worktree's demo for existing value-test entrypoints; no integrated UI build occurred.

## Remaining acceptance

Resolve Firefox's Playwright page-creation failure, then retry on this same immutable pair. Run the existing benchmark with upload assertions and all visibility snapshots (`PREVIEW_FAST` unset), plus source-line/value tests. Record separate logs to preserve the original Chromium pass and Firefox harness failure. A linked matching module and Chromium runtime pass are established; full browser acceptance remains incomplete. Transparency remains deferred.
