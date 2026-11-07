# OrcaSlicer WebAssembly WebGL2 G-Code Preview Spike

This spike demonstrates and validates standalone rendering of OrcaSlicer G-code directly in web browsers using **WebGL2** and **libvgcode** compiled via Emscripten (wasm64, pthreads, wasm exceptions, WebGL 2.0).

---

## 1. Executive Summary

- **Core Module**: Standalone WebAssembly executable module (`orca_preview.js` + `orca_preview.wasm`) compiling `libslic3r` (`GCodeProcessor`), `libvgcode` (`Viewer`), and an Embind interface.
- **Workflow**:
  1. Accepts `.gcode` input (via memory buffer or Emscripten virtual filesystem).
  2. Parses toolpaths and metadata using `Slic3r::GCodeProcessor`.
  3. Converts `Slic3r::GCodeProcessorResult` into `libvgcode::GCodeInputData` using a headless adaptation of `convert()`.
  4. Uploads vertex data into OpenGL ES 3.0 2D textures and renders via WebGL2 into an HTML `<canvas>`.
  5. Provides orbit camera controls, layer scrubbing, and view-type switching.
- **Interactive Demo**: Standalone web application (`index.html` + `demo.js`) featuring mouse orbit/pan/zoom, layer range dual-sliders, view-mode dropdown, and live statistics.
- **Automated Verification**: End-to-end Playwright tests in headless **Chromium** and **Firefox** loading `cube-voron.gcode`, verifying 100 layers, zero WebGL errors, non-blank canvas output, and layer-range scrubbing visual variance.

---

## 2. Artifact Sizes

| Artifact | Raw Size | Gzip Size | Compression Ratio |
|---|---|---|---|
| `orca_preview.wasm` | 3,067,025 bytes (2.92 MiB) | 847,006 bytes (827.2 KiB) | 72.4% |
| `orca_preview.js` | 195,076 bytes (190.5 KiB) | 44,696 bytes (43.6 KiB) | 77.1% |
| **Total Module** | **3.11 MiB** | **870.8 KiB** | **72.7%** |

*Sizes describe the Release wasm64 module with low-quality rendering and one spare pthread worker. Gzip uses level 9 without filename or timestamp headers. The full slicing engine binary is approximately 28 MiB uncompressed.*

---

## 3. Architecture & Technical Decisions

### Browser Main Thread vs. OffscreenCanvas
- **Decision for Spike**: Render WebGL2 on the **browser main thread**.
- Parsing, conversion and rendering run synchronously. The preview preloads one spare pthread worker; the slicing engine has its own worker pool. The benchmark records worker creation and actual pthread dispatch separately.
- **Rationale**:
  - The spike proves rendering viability, shader compatibility, and visual parity.
  - CPU submission is inexpensive after vertex textures are uploaded. GPU time grows with visible geometry and canvas resolution; software rendering of detailed models can take hundreds of milliseconds per frame. Measure GPU completion with a pixel readback, since `gl.finish()` alone may only flush commands in headless Chromium.
  - Directly targeting `#canvas` on the main thread avoids message-channel serialization and `transferControlToOffscreen` overhead.
- **Production Recommendation**:
  - Keep WebGL rendering on the main thread (or an `OffscreenCanvas` worker dedicated to graphics).
  - Heavy G-code file parsing (`GCodeProcessor::process_file`) can be offloaded to a Web Worker, which transfers the parsed `GCodeInputData` or typed arrays to the preview renderer.

### WebGL2 / OpenGL ES 3.0 Shaders
- Built with `-sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=2` and `-DENABLE_OPENGL_ES`.
- `libvgcode` already contains complete OpenGL ES 3.0 `#version 300 es` shaders (`ShadersES.hpp`).
- In desktop OpenGL, `libvgcode` uses `GL_TEXTURE_BUFFER`. In OpenGL ES, `m_texture_data` stores positions in 2D RGBA32F textures. Dimensions use RGBA32F in normal quality and exact RG32F height/width pairs in low quality, which does not need join angles or lighting bias.
- Context attributes include `preserveDrawingBuffer = 1` to allow canvas readbacks, 2D composite copies, and screenshot capture.

### Interactive quality and slider updates
- `OrcaPreview.setLowQuality(enabled)` selects batched camera-facing flat ribbons in the WebGL renderer. It defaults to `false` and leaves the normal geometry and lighting intact when disabled.
- Low quality draws two triangles per ribbon, removes directional lighting gradients, and uses eight stepped colors for numeric views. Contiguous collinear subdivisions of the same G-code move can share a ribbon when their metadata and colors agree; curves, visibility gaps, and texture-page boundaries remain separate. Raw vertices remain available, and the shader clips ribbons at the exact move-slider endpoints. Quality changes rebuild the dimension and enabled index textures once, and numeric views also rebuild their color texture once. It changes only rendering: statistics, layer numbering, move ids, and G-code line mapping remain exact.
- The ES renderer uploads ordered enabled segment and option indices when data or visibility changes. Layer and move sliders select subranges with binary searches and shader offsets, without rebuilding or uploading the indices or colors.
- The native desktop renderer retains its existing geometry and index-buffer behavior.
- Ribbon draws use bounded batches because desktop WebGL can allocate an implicit attribute-0 buffer proportional to the vertex count. Raw positions remain resident in low quality; its two-component dimension texture uses half the normal dimension storage.
- Dimension regeneration stages at most a million texels per upload (8 MiB in low quality, 16 MiB in normal). Initial uploads generate positions and normal dimension staging together in both qualities; low quality repacks only height/width for GPU storage.
- Low quality retains every original CPU vertex and its source metadata; ribbon coalescing does not compact that data. `getRenderMemoryUsage()` estimates retained renderer arrays and uploaded texels, rather than process RSS or driver VRAM. Browser peak memory also includes the engine and preview WebAssembly heaps, G-code arrays, mesh data, JavaScript state, and WebGL driver allocations.
- Low-quality segment indices use one `R32UI` texel for a page-local original vertex start and its span. Runs split when the page's available span bits are exhausted; full original endpoint pairs stay on the CPU for exact slider range selection. Normal-quality indices retain their original format.
- `benchmark_preview.mjs` checks normal rendering hashes across layer, move, option, role, and color-view changes, verifies quality roundtrips and exact move metadata, counts uploads, and measures synchronized GPU rendering. Run against the demo server with `PREVIEW_ASSERT_UPLOADS=1 node wasm/preview/benchmark_preview.mjs`; set `PREVIEW_LAYERS=120` for the detailed synthetic fixture, `PREVIEW_GCODE` for a local file, and `PREVIEW_BASELINE_DIR` for a previous module's directory. Use `PREVIEW_COMPARE_TIMINGS=1` to measure both modules.
- The default Chromium benchmark uses SwiftShader. Set `PREVIEW_BROWSER=firefox` to also measure the available Firefox backend, and inspect the reported renderer before interpreting its timings. `PREVIEW_RELOADS=2` checks replacement loading, settings, and missing-file preservation; `PREVIEW_TEXTURE_SIZE=16` exercises texture-page boundaries. `PREVIEW_INITIAL_LOW=1` also verifies a retained low-quality preference on first load; `PREVIEW_TOGGLE_SAMPLES=5` measures quality-change blocking separately from subsequent frames.
- `PREVIEW_SIMPLE_RELOADS=1 PREVIEW_RELOADS=23 PREVIEW_PARSE_ONLY=1` checks 24 replacement loads without intervening quality/view changes. Add `PREVIEW_CHECK_FAILURES=1` to verify that missing and empty inputs preserve the old pixels, metadata, ranges and regenerated CPU caches. Reported worker counts and pthread run commands distinguish idle preload workers from dispatched threads.

### Headless `convert.cpp`
- The preview uses `dlmalloc` within an 8 GiB WebAssembly heap limit. Parsing and conversion release their temporary buffers before texture staging; freed storage can be reused, while the committed heap retains its high-water size. The slicing engine's allocator is configured independently.
- Replacement loads release regenerable CPU colors and enabled indices before parsing, while retaining raw vertices, metadata, settings and uploaded textures. Missing files, parse errors and inputs without toolpath moves return valid JSON errors and preserve the previous preview; its derived cache is rebuilt on the next render.
- The standalone parser skips unused file-line offset storage. Desktop and slicing-engine callers retain file-line offsets by default; all callers retain the original move-buffer storage policy.
- Desktop `src/slic3r/GUI/LibVGCode/LibVGCodeWrapper.cpp` had GUI-only dependencies (wxWidgets types, `Slic3r::GUI::Preview::OptionType`) and included slicing pipeline headers (`Print.hpp`, `Model.hpp`, `WipeTower.hpp`).
- `wasm/preview/convert.cpp` extracts only the `Slic3r::GCodeProcessorResult` -> `libvgcode::GCodeInputData` conversion functions.
- All GUI-only headers were removed and replaced with standard `convert.hpp` declarations.

### Camera Centering & Bounding Box
- Raw G-code often begins with homing at `(0, 0, 0)` before traveling to the bed center (e.g. `(150, 150)` for a 300 mm bed). Using raw move bounds centers the camera halfway between the origin and the model.
- We configure the orbit camera target using `m_viewer.get_bounding_box({ libvgcode::EMoveType::Extrude })`, centering the camera exactly on the physical model bounds.

---

## 4. Problems Encountered & Solutions

1. **`ColorRGBA` Declaration**:
   - *Problem*: `convert.hpp` initially missed `#include "libslic3r/Color.hpp"`, causing a compilation error.
   - *Fix*: Included `libslic3r/Color.hpp`.
2. **Premature `glGetString` Call (GLAD Function Pointer Null Dereference)**:
   - *Problem*: GLAD defines `#define glGetString glad_glGetString`. Calling `glGetString(GL_VERSION)` before `m_viewer.init()` dereferenced a null pointer because GLAD function pointers are only loaded inside `gladLoaderLoadGLES2()`.
   - *Fix*: Passed `"OpenGL ES 3.0"` directly to `m_viewer.init("OpenGL ES 3.0")`. Inside `init()`, GLAD loads all WebGL function pointers via `emscripten_GetProcAddress`.
3. **HTTP 301 Static Server Redirection**:
   - *Problem*: The `serve` npm tool redirects `/index.html` to directory paths with HTTP 301, causing strict status-200 health checks to wait until timeout.
   - *Fix*: Health check was updated to accept 2xx and 3xx codes and navigate directly to `/wasm/preview/demo/`.

---

## 5. React App Integration

The app keeps the slicing engine in a worker and the preview in a separate main-thread WebAssembly module. They have independent heaps and worker pools. Both remain resident while a project is open, so browser memory measurements must include both modules, source bytes, model meshes and driver allocations. The standalone preview demo can open G-code without loading the slicing engine; the React app initializes the engine for its project and settings workflows.

`PreviewView` owns the canvas and native viewer lifecycle. It remains mounted across app tab changes to preserve the camera and loaded toolpaths. `orcaPreviewModule.ts` initializes the native viewport from the current canvas dimensions, coalesces render requests into one animation frame, and cancels pending frames on disposal. Explicit renders, including thumbnail capture, consume any queued frame. Move playback pauses when Preview is hidden or the browser tab enters the background; returning to Preview requires an explicit resume.

`previewStore.ts` holds layer and move ranges, statistics, legends and display actions. Changing a range updates the native viewer immediately and schedules a draw. Store selectors isolate controls from unrelated slider changes. A weak identity marker lets the file-open preload and the subsequent React update share one parse without retaining a previous G-code array. The parser borrows immutable source bytes in MEMFS only for its synchronous load and unlinks the temporary file afterward. File > New project explicitly clears native toolpaths and statistics while preserving the context, bed and display preferences. Ordinary setting changes retain the outdated preview and its reslice prompt.

Low quality is a persistent display preference, available in Preview and Preferences. It uses the flat-ribbon renderer and caps the preview canvas at one physical pixel per CSS pixel; normal quality uses the browser's device pixel ratio. Preview's separate Lighting & shadows checkbox defaults to enabled and persists in display preferences on desktop and mobile. `OrcaPreview.setLightingEnabled(false)` selects basic eye-space shading and skips toolpath, self and bed shadows without rebuilding geometry. The wrapper applies this preference before native initialization and retains it across replacement loads. Low quality can skip shadows but never changes the lighting preference. The selected color scheme is stored separately and survives refreshes. These display preferences change neither slicing configuration nor exported G-code.

Normal quality uses per-fragment lighting with normalized eye-space normals, a fixed world-space key light, and a reusable depth-only shadow map capped at 2048² (DEPTH_COMPONENT24, NEAREST, texture unit 4). An orthographic light camera fits extrusion bounds and their bed projection; 3×3 PCF bilinearly filters depth comparisons, with unshadowed border samples. Comparing before filtering preserves thin shadows at silhouette edges. Shadows attenuate key diffuse/specular light and shade the bed from above; ambient/fill and the translucent underside remain visible. Low quality skips the shadow pass. The native `setShadowsEnabled(bool)` comparison hook defaults to true and adds no UI preference. An unsupported depth framebuffer falls back to unshadowed lighting; no optional WebGL extensions are required.

The text window indexes line breaks in the original byte array once, caches that index weakly, and decodes at most 81 lines around the selected move. A closed text window does not build the index or subscribe to move changes. Move-to-line lookup comes from the native vertex metadata, including subdivided arcs.

The Vite asset packer validates nonempty JavaScript and WebAssembly headers and copies each captured preview module to both the root and `/preview/` aliases. Packaging must use a matching completed JavaScript/WebAssembly pair; native builds and packaging must not run concurrently against the same mutable output directory.

---

## 6. Verification Results

Tested on Linux with Playwright against `wasm/tests/parity/refs-macos-x86_64/cube-voron.gcode`:

- **Chromium**:
  - Layers detected: **100** (Expected: 100)
  - Move vertices: **26,688**
  - Estimated print time: **560.64s**
  - WebGL `gl.getError()`: **0 (`GL_NO_ERROR`)**
  - Canvas blank check: **Passed** (294,125 non-background pixels, 57.6% screen fill)
  - Layer range scrub (0-10): **Passed** (109,950 pixels, 21.5% screen fill)
  - Screenshot: `wasm/build/tests-preview/chromium.png`
- **Firefox**:
  - Layers detected: **100** (Expected: 100)
  - Move vertices: **26,688**
  - Estimated print time: **560.64s**
  - WebGL `gl.getError()`: **0 (`GL_NO_ERROR`)**
  - Canvas blank check: **Passed** (290,901 non-background pixels, 57.3% screen fill)
  - Layer range scrub (0-10): **Passed** (108,737 pixels, 21.4% screen fill)
  - Screenshot: `wasm/build/tests-preview/firefox.png`
- **Port Cleanliness**: `ss -ltnp | grep 5059` confirmed empty at completion.

The low segment helper can be checked independently with C++17: `g++ -std=c++17 -O2 -Wall -Wextra -Wpedantic -Werror -Isrc/libvgcode/include wasm/preview/test_low_quality_segments.cpp src/libvgcode/src/LowQualitySegments.cpp -o /tmp/orca-low-quality-tests && /tmp/orca-low-quality-tests`. It checks curved paths, metadata boundaries, texture pages, packed span limits, and clipping within merged or split runs.
