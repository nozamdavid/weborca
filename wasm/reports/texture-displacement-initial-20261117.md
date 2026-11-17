# Texture displacement candidate — 2026-11-17

Candidate: `wasm/build/ui-texture-displacement-20261117` (read-only, 134 MB).
Engine SHA256: `599d36461f1738f3b3372ad26993e951a84d53a2e401f7959ae4f8d49ac289f8`.

Serve from `wasm/app`:

```sh
./node_modules/.bin/vite preview --outDir ../build/ui-texture-displacement-20261117 --host 0.0.0.0 --port 5298 --strictPort
```

Existing acceptance harnesses can reuse it with `APP_TEST_DIST` set to its absolute path and `APP_TEST_FROZEN_DIST=1`. Server currently runs on port 5298.

## Verification

- TypeScript `tsc --noEmit`, all 22 locale catalog checks, integrated production build, `git diff --check`: pass.
- Impeccable detector: no findings.
- Both changed C++ translation units (`Engine.cpp`, `EditOps.cpp`) compiled with Emscripten 6.0.11. Existing mismatched `PlateData` tag warning remains.
- `ORCA_ENGINE_MODULE=$PWD/wasm/build/texture-engine/wasm/engine/orca_engine.mjs node --test wasm/tests/node/texture-displacement.test.mjs`: pass. Actual `getMesh` surface-distance proof: 0.4022 mm; zero depth and corrupt PNG preserve exact geometry bytes.
- Integrated browser, shared preview tool, 1280×800: imported 20mm cube through file input, opened Edit → Texture displacement, corrupt PNG rejected with Bake disabled, valid PNG decoded and previewed.
- PNG Bake: exactly one history entry, description `Bake texture displacement`. Undo restores 12 triangles, redo restores baked mesh. Browser `getMesh` vertex positions have maximum distance 0.402199745 mm from the original cube surface planes.
- Saved `/out/texture-qa.3mf`, reopened through `openProject`, geometry retained (200,000 triangles). Reopened geometry sliced through app `startSlice`: complete, 102 layers, 3,915,147 G-code bytes. This checks generated G-code, not download-to-disk export.
- JPEG (converted from the same PNG in browser) decoded and previewed. Zero depth disables Bake and displays validation. Inverted JPEG Bake succeeded; 64,088 vertices strictly inside the original cube surface, confirming inward relief.

## Build inputs

This checkout initially had no artifacts. Isolated build cache copied (no hardlinks) from sibling `t3-c8aa6ae1/wasm/build/orca-v250-wasm64`. Compiled changed engine files plus sibling-source differences (`CutConnectorOps.cpp`, `Print.cpp`, `PrintApply.cpp`, `PrintObject.cpp`), rebuilt libslic3r archive and linked engine. Native texture sources match sibling sources byte-for-byte. Preview and STEP binaries reused from sibling `ui-v250-startup-release-20261107`; no preview/STEP source changes. Dependency prefixes copied with symlinks dereferenced for manifest hashing. Runtime manifests generated and verified by production build. Compilation/link commands remain in the local ignored build directory and are not included in this report. This is an incremental review candidate, not a clean rebuild or deployment.

## Scope and outstanding acceptance

Single texture, whole selected model part, native bake pipeline; native defaults 0.4 mm depth, 12.5 mm tile, neutral height 0, triplanar. Rotation, neutral height, triplanar/cylindrical/spherical projection, native sign reversal. Output cap 200,000 triangles. PNG/JPEG ≤8 MB, dimensions ≤2048 per axis. Alpha composited on white before native luminance conversion.

Painted, UV-mapped and multi-instance parts rejected before mutation to protect annotations. Multi-part objects require selecting a specific part; only that part is baked. No eight-layer painting editor, UV layout, displacement color output, live geometry preview or cancellation of an active bake. New explanatory UI copy is English.

Independent acceptance remains for transformed and multibody cases, eligibility error UI, other projections, mobile/light theme, additional texture patterns and an actual exported/downloaded project/G-code file. No README or Taproot changes.
