# Slicing and Preview performance follow-ups
Raw benchmark artifacts are retained locally under the ignored `wasm/build/` directory.

The export validator now accumulates bounds per object and tool as it reads extrusion moves. Preview reuses the fixed-light shadow map during camera motion, transfers the worker's packet buffer directly, and borrows it during the synchronous renderer load. These changes address the three follow-ups from the [engine review](slicing-preview-performance-20261126.md).

## G-code export validation

The validator retains one bounding box and maximum Z per object and tool. It preserves the existing scaled coordinates, belt-frame inverse transform, height checks, warning order, treatment of custom extrusion, and representation of straight paths and single points. [Validator](../../src/libslic3r/GCode/GCodeProcessor.cpp)

Matched Emscripten builds timed the validator itself. Each fixture used eight warm samples per build. The full slice trials paired the same inputs and presets with eight requested threads and the earlier rectangular-bed optimization in both builds.

| Slice fixture | Moves inspected | Old validator | New validator |
| --- | ---: | ---: | ---: |
| 20 mm cube | 8,184 | 0.138 ms | 0.051 ms |
| 3DBenchy | 118,148 | 1.136 ms | 0.664 ms |
| Four Benchies | 472,821 | 4.646 ms | 2.588 ms |

Validation took about 44% less time on four Benchies. Full recomputation was 1,235 ms before and 1,233 ms after, within run variation. All full slices matched G-code after removing the generated header line, and slice metadata matched exactly. With 900,008 synthetic moves, validation took 6.45 ms instead of 11.25 ms on the multi-tool probe and 11.89 ms instead of 16.11 ms with the belt transform active. The probes matched full validation results, and 22 focused slicing checks passed on the production build. Validation timings (`wasm/build/slicing-performance-20261126/export-validation/validation-summary.json`) · Full slice timings (`wasm/build/slicing-performance-20261126/export-validation/export-summary.json`) · Focused slicing checks (`wasm/build/slicing-performance-20261126/export-validation/focused.log`)

## Preview camera motion

The native Preview caches caster depth and the light matrix. It checks layer and move ranges and invalidates the cache when loaded geometry, caster visibility, clipping, quality or lighting changes. WebGL still samples the cached texture for visible fragments. [Preview renderer](../preview/preview.cpp)

On a 332,007-move fixture in headed Helium with hardware AMD WebGL2, camera-only frames went from four caster draws and 208,520 caster segments to zero. Across 40 paired camera samples, median render time through a synchronous pixel read fell from **17.53 ms to 14.80 ms**, and median CPU submission fell from **0.205 ms to 0.040 ms**. Synchronized readback includes driver and readback overhead. The benchmark also compared 52 full RGBA frame hashes and move ranges across camera motion, clipping, layer and move ranges, visibility, loading, and quality and lighting transitions. All matched the baseline. Shadow benchmark and parity (`wasm/build/slicing-performance-20261126/shadow-cache/results.json`)

The existing lighting comparator treats variable `rendererLoadMs` values as persistent metadata, which failed on the baseline. A test copy excluded that field from equality checks. Its Helium and Firefox runs passed. The combined Preview relink with the export validator change produced the same bytes as the pixel-verified Preview pair. Helium lighting checks (`wasm/build/slicing-performance-20261126/shadow-cache/existing-lighting-normalized.log`) · Firefox lighting checks (`wasm/build/slicing-performance-20261126/shadow-cache/existing-lighting-firefox.log`) · Combined relink (`wasm/build/slicing-performance-20261126/shadow-cache/combined-relink/build.log`)

## Preview packet loading

The worker transfers the exact buffer returned by MEMFS. The renderer borrows the received packet while the read-only native call runs and releases its temporary file. The app retains the original G-code bytes for export and line display. Packets can still be reused on renderer remount. [Worker](../app/src/preview/previewWorker.ts) · [Renderer load](../app/src/preview/orcaPreviewModule.ts) · [Ownership regression](../tests/node/preview-import-overlap.test.mjs)

The same 26.56 MB packet and Preview WASM ran through alternating copy and borrow paths in one Helium session. Medians below use eight warm samples per path after discarding four warm-up trials. Worker round trip includes parsing and transfer. Main-thread blocking includes staging, native packet validation and renderer setup.

| Interval | Copy path | Transfer and borrow |
| --- | ---: | ---: |
| Worker packet read and preparation | 15.69 ms | 5.31 ms |
| Worker round trip | 140.64 ms | 125.80 ms |
| Main-thread packet staging | 5.71 ms | 0.17 ms |
| Main-thread blocking | 36.82 ms | 30.59 ms |

Both paths returned the same Preview statistics, and malformed packet handling preserved the previous render data. TypeScript and 24 focused Preview checks passed. Packet benchmark script (`wasm/build/slicing-preview-followups-20261126/packet/test_worker_packet.mjs`) · Raw samples (`wasm/build/slicing-preview-followups-20261126/packet/samples.json`)

## Integrated verification and deployment

The integrated build used the demo's OctoEverywhere UI source at `a9cc871d9c` plus these three changes. It packaged both verified WASM pairs, rebuilt STEP to the same binary SHA-256, and verified runtime manifests for all three modules. Eight Helium trials imported a cube or Benchy, sliced it once, opened a rendered Preview, and matched the baseline G-code after removing the generated timestamp line. All trials were cross-origin isolated. Build log (`wasm/build/slicing-preview-followups-20261126/build.log`) · Full-app parity (`wasm/build/slicing-preview-followups-20261126/smoke/parity.tsv`)

The private demo runs `weborca-private:demo-20261126-slicing-preview-followups`, image ID `sha256:540af659426a89f5802952985e13abb7282d59e4224c8208cc31363f6a07f1c7`. The package used `VITE_COEP=credentialless` and the server uses `ORCA_COEP=credentialless`. HTTPS matched the packaged app entry, Preview worker, engine and Preview WASM pairs, Preview aliases and STEP binary. It also verified isolation headers, the four printer cloud providers, and OctoEverywhere availability. The live Helium smoke ran over HTTP/1.1 and rendered the matching Benchy slice. [Private demo](https://server-1.barbel-hops.ts.net:18974/prepare) · HTTPS verification (`wasm/build/slicing-preview-followups-20261126/live/rollout.log`) · Live Helium run (`wasm/build/slicing-preview-followups-20261126/smoke/live-https/3DBenchy-0.json`)

The previous demo build is retained as `weborca-models-demo-before-slicing-preview-followups-20261126`. To roll back this image, stop the new container, move it aside, and restore the previous container under the live name:

```bash
test "$(docker inspect --format '{{.Image}}' weborca-models-demo)" = \
  'sha256:540af659426a89f5802952985e13abb7282d59e4224c8208cc31363f6a07f1c7' &&
docker stop weborca-models-demo &&
docker rename weborca-models-demo weborca-models-demo-slicing-preview-followups-rolled-back &&
docker rename weborca-models-demo-before-slicing-preview-followups-20261126 weborca-models-demo &&
docker start weborca-models-demo
```
