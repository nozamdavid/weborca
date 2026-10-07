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
| `orca_preview.wasm` | 3,111,811 bytes (2.97 MB) | 843,435 bytes (823.7 KB) | 72.9% |
| `orca_preview.js` | 197,557 bytes (193 KB) | 45,343 bytes (44.3 KB) | 77.0% |
| **Total Module** | **3.16 MB** | **868.0 KB** | **72.8%** |

*Note: For comparison, the full slicing engine binary is ~28 MB uncompressed. The preview module is under 870 KB gzipped.*

---

## 3. Architecture & Technical Decisions

### Browser Main Thread vs. OffscreenCanvas
- **Decision for Spike**: Render WebGL2 on the **browser main thread**.
- **Rationale**:
  - The spike proves rendering viability, shader compatibility, and visual parity.
  - libvgcode's rendering pass (`render()`) executes in microseconds once vertex textures are uploaded, easily sustaining 60 FPS during mouse orbiting on the main thread.
  - Directly targeting `#canvas` on the main thread avoids message-channel serialization and `transferControlToOffscreen` overhead.
- **Production Recommendation**:
  - Keep WebGL rendering on the main thread (or an `OffscreenCanvas` worker dedicated to graphics).
  - Heavy G-code file parsing (`GCodeProcessor::process_file`) can be offloaded to a Web Worker, which transfers the parsed `GCodeInputData` or typed arrays to the preview renderer.

### WebGL2 / OpenGL ES 3.0 Shaders
- Built with `-sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=2` and `-DENABLE_OPENGL_ES`.
- `libvgcode` already contains complete OpenGL ES 3.0 `#version 300 es` shaders (`ShadersES.hpp`).
- In desktop OpenGL, `libvgcode` uses `GL_TEXTURE_BUFFER`. In OpenGL ES, it automatically switches to 2D RGBA32F textures (`m_texture_data`) to pass vertex positions, extrusion dimensions, and segment metadata.
- Context attributes include `preserveDrawingBuffer = 1` to allow canvas readbacks, 2D composite copies, and screenshot capture.

### Headless `convert.cpp`
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

## 5. React App (`wasm/app`) Integration Plan

### Merge into Engine vs. Keep Separate
**Recommendation**: **Keep Separate**.

| Consideration | Separate Module (Recommended) | Merged Module |
|---|---|---|
| **Bundle Size** | Only ~868 KB gzipped for UI / preview. | Slicing engine (~25–30 MB) would be required before showing any preview. |
| **Separation of Concerns** | Preview runs on UI thread; engine slices in worker threads. | Tightly couples WebGL context management to computation engine. |
| **Use Cases** | Standalone G-code viewer (e.g. opening uploaded `.gcode` or SD card files) does not require slicing code. | Slicing code is forced into memory even when only viewing G-code. |
| **Memory Growth** | Preview memory footprint is small (< 64 MB for typical files). | Engine uses up to hundreds of megabytes during slicing. |

### Proposed React Component Architecture
```tsx
import React, { useEffect, useRef } from 'react';
import { createOrcaPreview } from './orca_preview.js';

interface GCodePreviewProps {
  gcodeData: Uint8Array | string;
  viewType?: string;
  layerRange?: [number, number];
}

export const GCodePreview: React.FC<GCodePreviewProps> = ({ gcodeData, viewType, layerRange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<any>(null);

  useEffect(() => {
    let previewInstance: any;
    createOrcaPreview({ canvas: canvasRef.current }).then((Module: any) => {
      previewInstance = new Module.OrcaPreview();
      previewInstance.init('#preview-canvas');
      previewRef.current = previewInstance;
      // Load gcode...
    });
    return () => previewInstance?.delete();
  }, []);

  return <canvas id="preview-canvas" ref={canvasRef} style={{ width: '100%', height: '100%' }} />;
};
```

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
