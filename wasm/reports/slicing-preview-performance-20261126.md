# Slicing and G-code Preview performance
Raw benchmark artifacts are retained locally under the ignored `wasm/build/` directory.

November 26, 2026. WebOrca skips mesh footprint projection when a conservative transformed bound proves that an entire model volume fits inside a rectangular bed. On the four-Benchy plate, a fresh computation took **1,245 ms instead of 1,371 ms**, a **9.2% reduction**. An unchanged reslice took **10.5 ms instead of 100.2 ms**. All paired exports and slice metadata matched after removing the generated header line from G-code.

## Slicing engine

### What the change removes

The browser sends each slice request to a worker, which queues a native job and polls for completion with a backoff up to 16 ms. The job resolves effective presets and plate overrides, assigns instances to plates, checks containment, applies and validates the retained `Print`, then enters the TBB arena for geometry and export. Each exact footprint check transforms mesh vertices, finds adjacent faces and contours, and clips the projected polygons against the bed. The old path repeated that work for each instance, even when an unchanged job could reuse the finished export. [Worker and polling](../web/engine-core.js) · [Preflight and retained Print](../engine/Engine.cpp) · [Mesh projection](../../src/libslic3r/TriangleMeshSlicer.cpp)

The shortcut uses mesh bounds and the plate-relative volume transform. It accounts for scaled float arithmetic and integer coordinate conversion before accepting an interior volume. Edge contact, nonrectangular beds and uncertain bounds continue through exact projection. This preserves the browser's full-footprint rule. Native OrcaSlicer already has a bounding-box path for rectangular build volumes with its own tolerance and partial-outside classifications. [Browser containment](../engine/Engine.cpp) · [Native classification](../../src/libslic3r/BuildVolume.cpp)

### Paired engine measurements

Medians in milliseconds, eight measured runs in each column. Each batch used one excluded warm-up per fixture. Fresh computation reimported the same geometry into an initialized engine. Reslicing immediately repeated the same request and output path. Both ran the real WebAssembly engine through its JS wrapper in Node 24.21.0, on a Ryzen 9 9950X3D, at eight requested threads, with the Voron 2.4 300 0.4 nozzle, 0.20 mm Standard @Voron and Generic PLA @System presets. Times include result polling and G-code delivery from the memory filesystem. Test runs used a shared benchmark lock.

| Fixture | Fresh before | Fresh after | Change | Unchanged reslice before | Unchanged reslice after |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20 mm cube | 49.41 | 49.17 | Within run variation | 4.74 | 4.56 |
| 3DBenchy | 758.17 | 726.55 | 4.2% less time | 33.43 | 4.62 |
| Four Benchies | 1,371.21 | 1,245.26 | 9.2% less time | 100.15 | 10.50 |

Four-Benchy fresh slices ranged from 1,323–1,393 ms before and 1,240–1,306 ms after. The 225,706-facet input STL is stored once and instanced four times. G-code hashes matched across samples for each fixture with the generated header removed. Layer count, estimated time, filament, file size and warnings also matched. Browser Preview latency is a separate measurement. Paired samples and hashes (`wasm/build/slicing-performance-20261126/engine/summary.json`) · Harness (`wasm/build/slicing-performance-20261126/engine/benchmark.mjs`)

### Helium and installed OrcaSlicer

These are separate timing boundaries for a first slice on each runtime. The three timed browser trials started with a freshly initialized worker and an imported model. The installed OrcaSlicer 2.5.0 Flatpak read the project saved by WebOrca and used its default thread scheduling. Its CLI wall time also includes launch, disk I/O and teardown. Browser and native builds differ. Both produced 100 cube layers and 240 Benchy layers with less than 0.01% difference in net extrusion, while executable G-code hashes differ. Benchy had 9.57% more nonextruding travel and a 41m 19s estimate in WebOrca versus 39m 44s in native OrcaSlicer. Baseline method, parity and raw artifacts (`wasm/build/slicing-performance-20261126/baseline/report.md`)

| Median boundary | 20 mm cube | 3DBenchy |
| --- | ---: | ---: |
| Helium Slice click to G-code response | 284.5 ms | 1,123.9 ms |
| Helium worker request to G-code response | 275.9 ms | 1,115.4 ms |
| Helium G-code response to Preview ready | 108.2 ms | 382.2 ms |
| Native logged print processing | 3.2 ms | 185.8 ms |
| Native logged G-code export | 16.6 ms | 223.5 ms |
| Native full CLI wall time | 410 ms | 1,170 ms |

Helium 0.20.3.1 used hardware AMD graphics through ANGLE and Mesa. The measured browser batch served frozen copies of the original HTTPS assets on isolated HTTP loopback. Fresh Helium profiles sometimes aborted startup fetches through the Tailscale origin. Successful HTTPS trials over HTTP/1.1 returned the same worker G-code as loopback after removing the generated timestamp. Browser logs and source hashes (`wasm/build/slicing-performance-20261126/baseline/report.md`)

The candidate's eight Helium trials used one Slice click and reached a rendered Preview. Every run loaded the expected WASM under cross-origin isolation with `credentialless` and matched the corresponding baseline G-code after removing the generated header line. The three measured Benchy runs gave **1,051 ms** from request to worker response versus **1,115 ms** on the baseline. The cube timing ranges and the Preview draw timing ranges overlap. The browser batches used separate runs and the draw metric ends at WebGL submission. Candidate method and results (`wasm/build/slicing-performance-20261126/verify/report.md`)

### Ranked slicing options

| Priority | Work | Evidence and acceptance |
| --- | --- | --- |
| 1 | Profile export and accumulate validation bounds in one pass | Benchy spent about 629 ms between the first observed G-code progress event and worker response. This interval includes export, result polling, file read and worker transfer. Within export, the validation loop collects extrusion points and copies them into a temporary polygon to read bounds. Accumulating the same bounds and maximum Z can avoid the temporary storage. Measure export and peak memory with long single-tool, multi-tool and belt jobs. Preserve validation order, excluded areas, preheat and warnings. [Export](../../src/libslic3r/GCode.cpp) · [Validator](../../src/libslic3r/GCode/GCodeProcessor.cpp) |
| 2 | Test the export text copy and conditional file rewrite independently | The writer creates a temporary string before incrementally feeding text into the processor. Preheat can also trigger another rewrite, including when the insertion map is empty. Measure each change separately against the fully written G-code, estimates and line offsets. Include an active preheat fixture and a fixture with no insertions. [Writer](../../src/libslic3r/GCode.cpp) · [Postprocessing](../../src/libslic3r/GCode/GCodeProcessor.cpp) |
| 3 | Profile warm walls and infill on matched builds | Native and WASM both use TBB for layer intersections, walls and infill. Historical matched-region Helium work put 36.1 ms into walls, 18.0 ms into infill preparation and 22.8 ms into infill for the warm bracket. Profile Classic and Arachne separately, plus dense infill, tree supports and multi-tool jobs. Compare emitted commands and the full effective config. Previous blanket thread warmup, selected Arachne SIMD and stitch-grid storage trials did not establish a consistent gain. [Shared Print stages](../../src/libslic3r/Print.cpp) · [Prior aligned profile](../../docs/benchmarks/slicing-performance-20261108.md) |
| 4 | Extend reuse where a workload warrants it | The engine retains one compatible Print, and uses native step invalidation and same-path export reuse. Switching plates resets retained geometry. Benchmark A→B→A and memory retention before considering a second cached plate. Same-file byte delivery and Preview reparsing may still dominate a hit. A broader export cache needs stronger file identity than the existing pathname and size check. [Retained state](../engine/Engine.cpp) · [Incremental reslicing evidence](incremental-reslicing-20261112.md) |

The Release WASM uses MEMORY64, pthreads, WASM exceptions, mimalloc and a growable heap up to 8 GB. The configured pool size, selected TBB arena size, and active worker count measure different things. The pool starts at `min(hardwareConcurrency, 8) + 2`, and the explicit slice arena starts after preflight. Hot file optimization flags vary by translation unit. Use the actual compile line and a fixed thread count in future comparisons. [Link flags](../engine/CMakeLists.txt) · [Optimization tiers](../../src/libslic3r/CMakeLists.txt)

## G-code Preview engine

Newly sliced plates send the finished G-code to a separate preview worker, which parses it with `GCodeProcessor`, converts it to `libvgcode` vertices, and transfers a packed buffer. The main thread validates that packet and initializes the WebGL2 textures and draw lists. The synchronous parser remains available to the standalone harness. Desktop Preview can consume the export processor's result directly. It reloads G-code when postprocessing edits the file. [Worker](../app/src/preview/previewWorker.ts) · [Renderer and packet load](../app/src/preview/orcaPreviewModule.ts) · [Desktop handoff](../../src/slic3r/GUI/BackgroundSlicingProcess.cpp)

### Hardware measurements

The current Preview pair in Helium processed 332,007 moves over 120 synthetic layers. A 4.78 MB G-code fixture produced a 26.56 MB packet. Warm medians were **132.4 ms** for the worker round trip, including **54.3 ms** native parse and **14.9 ms** packet export. Worker metadata and packet serialization together accounted for an estimated **60.0 ms** residual. Main-thread packet staging, validation and viewer setup occupied **37.2 ms** warm and **65.2 ms** on the first run. Preview raw samples and measurement boundaries (`wasm/build/slicing-performance-20261126/preview/README.md`)

| Normal quality, same 800 × 600 buffer and view | GPU timer median | Render to readback median |
| --- | ---: | ---: |
| Full range, shadows on | 14.87 ms | 15.47 ms |
| Full range, shadows off | 4.33 ms | 4.72 ms |
| Top four layers, shadows off | 0.25 ms | 0.48 ms |

The shadow toggle experiment changed depth rendering and shadow sampling. A smaller layer range changes triangles and screen coverage together. Eight layer scrubs issued zero texture or buffer uploads. Preview ready and WebGL submission timings in the app exclude synchronized GPU completion and screen presentation. Frame and upload measurements (`wasm/build/slicing-performance-20261126/preview/headed.json`)

### Ranked Preview options

| Priority | Work | Evidence and acceptance |
| --- | --- | --- |
| 1 | Cache the fixed-light shadow map during camera motion | The shadow pass recalculates on orbit, pan and zoom although the light is fixed. Desktop already caches its static map. Key reuse by toolpath generation, visible layers and moves, effective extrusion visibility and clipping. Count caster draws with matched camera paths and check pixels when data, layers, filters, quality or lighting changes. The measured 10.5 ms shadow overhead includes sampling, which still runs on cache hits. [Web shadow pass](../preview/preview.cpp) · [Desktop static-map implementation](../../src/slic3r/GUI/GLCanvas3D.cpp) |
| 2 | Remove duplicate packet buffers and measure bulk staging | The worker copies the owned file read before transfer, and the renderer writes the packet back into the memory filesystem. Give transfer the owned buffer, then test borrowing the input and bulk reads and writes with validation intact. The original G-code remains needed for export and the source window. Verify cancellation, renderer remount, corrupt input recovery, line mapping and peak memory. [Transfer](../app/src/preview/previewWorker.ts) · [Packet format](../preview/packet.hpp) |
| 3 | Apply the effective tool palette before the first color upload | Initial viewer load uploads colors and later palette application marks them dirty again. Measure equality checking, staging the effective palette once, and the adjacent full-vertex range scans. Preserve all color schemes and per-tool colors. Profile role and option changes independently of ordinary layer scrubbing, which already narrows ordered ranges without uploads. [Renderer](../../src/libvgcode/src/ViewerImpl.cpp) · [App upload sequence](../app/src/preview/orcaPreviewModule.ts) |
| 4 | Reuse a loaded Preview when the engine reuses an identical export | The worker currently delivers a fresh G-code array even for an unchanged cache hit. A stable export identity could avoid packet rebuilds when revisiting the same result. A fresh-slice sidecar is a bigger follow-up. Qualify it against the final file's actual speed, flow, postprocessing, time estimates, arcs, colors and move-to-line mapping. File imports still need parsing. [Slice cache](../engine/Engine.cpp) · [Preview identity](../app/src/preview/PreviewView.tsx) |

Use the native [3D Scene Benchmark](../../docs/HLSD/scene-benchmark.md) for the next Preview comparison. Match the drawing buffer, visible toolpaths, lighting, camera path and driver. Collect frame submission, GPU elapsed time and time to first frame separately.

## Verification and rollout

[Engine.cpp](../engine/Engine.cpp) compiled with Emscripten 6.0.11 and linked with the object and dependency set from the frozen live engine. The candidate WASM SHA-256 is `57f567b225c39847520977ce38daec7abc433efe2be813d8f5c6e44b13413b4e`. Its runtime manifest binds the source fingerprint, dependencies, loader and WASM bytes. The 47 focused Node checks passed, including multiple plates and tools, incremental reslicing, edge contact, float rounding, irregular beds, rotation, mirroring, origin offsets and cancellation. The final cancellation check also compared serialized printable flags on both engines and produced a valid recovery slice. Build and tests (`wasm/build/slicing-performance-20261126/engine/`)

The initial rollout used `weborca-private:demo-20261126-slicing-preflight` at image ID `sha256:020b84e8bc6db696a95d0ddb9fbfbf5533026bec3e7f922ab59730d0d8239304`. The image adds the tested engine pair, compression variants and engine manifest to the incumbent UI image. It was built with `VITE_COEP=credentialless` and serves with `ORCA_COEP=credentialless`. HTTPS verification matched the engine pair and manifest, version headers, frontend entry, worker, Preview pair and STEP binary. The printer status listed all four requested cloud providers, OctoEverywhere reported available, and the live environment matched the required Orca Cloud settings. An early health probe raced startup and triggered rollback. The retry waited for health and passed the HTTPS checks. Headed Helium also completed Benchy slicing and drew Preview through the live HTTPS origin using HTTP/1.1. [Tailscale demo](https://server-1.barbel-hops.ts.net:18974/prepare) · Rollout and verification log (`wasm/build/slicing-performance-20261126/image/live/rollout.log`) · Live browser run (`wasm/build/slicing-performance-20261126/verify/live-https-candidate/3DBenchy-0.json`)

The previous deployment is retained as the stopped container `weborca-models-demo-before-slicing-preflight-20261126`. To roll back this image, stop the candidate, rename it, restore the previous container name and start the previous container:

```bash
test "$(docker inspect --format '{{.Image}}' weborca-models-demo)" = \
  'sha256:020b84e8bc6db696a95d0ddb9fbfbf5533026bec3e7f922ab59730d0d8239304' &&
docker stop weborca-models-demo &&
docker rename weborca-models-demo weborca-models-demo-slicing-preflight-rolled-back &&
docker rename weborca-models-demo-before-slicing-preflight-20261126 weborca-models-demo &&
docker start weborca-models-demo
```
