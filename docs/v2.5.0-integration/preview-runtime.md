# v2.5.0 Preview runtime verification

Chromium standalone runtime checks passed on the freshly linked v2.5 Preview
module. Firefox remains unverified: its empty-page creation fails before module
loading under the required 128-task runner cap. The passing JS/WASM pair is
frozen for the integrated app candidate. No integrated app build, deployment,
commit, branch operation or core build-root mutation was performed by this task.

Worktree: `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`.
Read the original checkout's `AGENTS.md`, [merge foundation](merge-foundation.md)
and [preview adapters](preview-adapters.md). No further delegation occurred.
This task changed no product source or tracked tests; the adapter edits and
compile checks described in the preceding report already existed.

## Final artifact and archive binding

All paths below are relative to this worktree. Evidence directory:
`wasm/build/v250-preview-adapters/` (abbreviated `OUT` below).

Use `OUT/frozen-preview/orca_preview.{js,wasm}` for the integrated app candidate.
Both files have mode 444. JS is 195,076 bytes; WASM is 2,480,262 bytes.

| File | SHA256 |
| --- | --- |
| `frozen-preview/orca_preview.js` | `9d3e9b4b3662704302a19e5c93d6923790702317770f9eedf08b51627f56c0b2` |
| `frozen-preview/orca_preview.wasm` | `e068d00989f8daa23f1fe7454ed1f7bdb4b3fc589facecbeb0f9a4d65607e038` |
| `wasm/build/orca-v250-wasm64/src/libslic3r/liblibslic3r.a` | `0c406e4372ac7a6f31c8468b35e37119841adf9eaaf3dd53198d32e570bef025` |
| `wasm/build/orca-v250-wasm64/src/libslic3r/liblibslic3r_cgal.a` | `e61216d58dd25b7b4fae25a8714216579166233c66b51c3c9929738f3994bec9` |
| `OUT/final-link-inputs.sha256` | `5d6c8a3ddfecd940839267f34c7ab41beea5eb50e7361367fbc2bf30b201a171` |

The core owner removed only the unused `normal_mode` lambda capture and
recompiled/rearchived the processor. The user explicitly confirmed the two
corrected archive hashes before this final link. They were independently
verified before linking and verified again by the post-link manifest check.

`OUT/link-preview-bound.sh` hashes all 43 distinct command-line archives and
objects, executes the prepared `OUT/link-preview.sh`, then checks every input
hash. The manifest includes same-tree `deps_src` archives, `lib/libsemver.a`,
the `prefix-v250-wasm64` libraries, three owned adapter/stub objects and owned
`module/wasm/preview/libvgcode/liblibvgcode.a`. The final link uses SDK 6.0.11,
memory64, pthreads and WASM exceptions. No core rebuild was requested here.

`OUT/final-link.log` reports success, 346,656,768-byte cgroup peak, zero swap
and zero task-limit hits. SDK warnings concern `ALLOW_MEMORY_GROWTH` with
pthreads and the deprecated spelling `MEMORY64`; no link errors occurred.
`final-link-script.sha256`, `final-module.sha256` and `frozen-preview.sha256`
retain the script/output identities. No old-module fallback was used.

## Commands and preserved run history

Heavy commands use this original runner, which serializes with
`/tmp/webslicer-heavy.lock`, limits memory to 2 GiB, swap to zero, CPU to two
cores/200%, and tasks to 128:

```sh
RUNNER=/mnt/appdata/workspace/OrcaSlicer/wasm/build/tests-mobile-polish/qa/run-capped.sh
ROOT=/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1
OUT="$ROOT/wasm/build/v250-preview-adapters"
bash "$RUNNER" v250-preview-final-link 2G bash "$OUT/link-preview-bound.sh" > "$OUT/final-link.log" 2>&1
bash "$RUNNER" v250-preview-remaining-r1 2G bash "$OUT/check-remaining-r1.sh" > "$OUT/remaining-r1.log" 2>&1
```

The original prepared `check-runtime.sh` invocation retained `lighting.log`,
`module-sha256.txt` and `lighting/chromium-*.png`. Chromium completed every
assertion; Firefox failed at `browser.newPage`, before the numerical helper or
module loaded. The original log SHA256 is
`ce103901a570f664556df62d239e31384faf35a68e4f912aa5a464e1559b3bd6`.
Its recorded JS/WASM hashes exactly match the final archive-bound link above.

An earlier preview link queue (`v250-preview-link-1794055778004445559`) was
terminated while waiting; it produced no link result. This task later launched
`check-final-runtime.sh` as PID 2141240 / service
`weborca-doop-qa-v250-preview-final-runtime-1794056296898443224`. That was this
test agent's invocation. It began an unnecessary Chromium repeat before the
core owner stopped that specific service during ownership reconciliation.
`final-runtime.log` and `final-lighting.log` retain its interrupted evidence;
the core owner also preserved
`wasm/build/v250-core-evidence/duplicate-preview-runtime-1794056296898443224.log`.
The interrupted repeat is not counted as a product failure or accepted pass.
The original `lighting.log` was preserved. All subsequent runs used distinct
labels/log files and did not repeat the accepted Chromium lighting suite.

`check-remaining-r1.sh` checks the frozen hashes, copies that exact pair to the
ignored standalone demo assets for the direct-import value tests, starts the
existing COOP/COEP static harness on loopback port 5397, executes:

```sh
PREVIEW_URL=http://127.0.0.1:5397/wasm/preview/demo/ PREVIEW_MODULE_DIR="$OUT/frozen-preview" PREVIEW_ASSERT_UPLOADS=1 PREVIEW_FAST=1 PREVIEW_SAMPLES=2 node wasm/preview/benchmark_preview.mjs
node --test wasm/tests/node/preview-values.test.mjs wasm/tests/node/preview-gcode-lines.test.mjs
sha256sum --check "$OUT/frozen-preview.sha256"
```

It then closes its server. The lighting suite's original environment was
`PREVIEW_LIGHTING_BASE_URL=http://127.0.0.1:5397`,
`PREVIEW_LIGHTING_MODULE_DIR="$OUT/module/wasm/preview"`,
`PREVIEW_LIGHTING_OUTPUT="$OUT/lighting"`, executing
`node wasm/preview/test_lighting.mjs` with default `chromium,firefox` selection.
The pair served through its route overrides matches the frozen hashes above.

## Accepted runtime checks and pixels

Actual fixture: `wasm/tests/parity/refs-macos-x86_64/cube-voron.gcode`, SHA256
`60449de3e3f4d50700b4dd22dc2bd3b67f769e0cc010c1967fac8562cca5c115`.
Chromium parsed 29,904 moves across 100 layers. The benchmark reports 575.43 s,
1,305.74 mm filament, and 3.89 g. Browser is HeadlessChrome 153.0.8010.12 with
ANGLE Vulkan SwiftShader. Lighting captures use an 800 × 600 canvas; the suite
also verifies a 360 × 640 viewport. Benchmark canvas is 704 × 725.

`lighting.log` records all of the following true, with `errors: []`:

- Both production shadow-sampling helpers produce a half-shadow thin edge
  (red channel within 1 of 127.5) and zero shadow outside the footprint.
- Lighting on/off changes pixels and exact roundtrips restore them. Normal
  quality performs the shadow pass; low quality skips it. All four independent
  lighting/quality combinations preserve metadata.
- Layer/move scrubs, Speed/FeatureType changes, clipping roundtrips, viewport
  resizing, themes, clear/reload and rejected empty/missing replacements pass.
- RGBA tool storage keeps RGB `#RRGGBB` legend output for Tool, ColorPrint and
  Summary. Empty palettes preserve colors; invalid input yields `#404040`.
  Black and saturated RGB updates render. Alpha 0, 128 and 255 give exactly
  equal opaque ES pixels for the same RGB. Transparency remains deferred.
- A `G4 S16777216` dwell plus actual fixture and a subsequent `G4 S1` preserve
  the one-second increment in JSON total time within 0.02 s. The log records
  the assertion result, not individual long-total values.

Preserved PNG SHA256 values:

| Pixel artifact under `OUT/lighting` | SHA256 |
| --- | --- |
| `chromium-before-shadows-off.png` | `b3858952a98f037107b4fca0dbac2befa877a1a403d5d7b4fcaa8d0e6bc119b2` |
| `chromium-after-shadows-on.png` | `3c1082a5a8a1a6abd8cb59a2d7893372de2d4eefc025721e0ff40b692089c257` |

`remaining-r1-benchmark.log` passes upload assertions: same-layer, layer-scrub,
move-scrub and same-view CPU operations each upload zero bytes in zero calls.
It records no WebGL errors, clipping verified, and exact all → slice → move →
all pixel restoration. Normal FNV pixel hashes are 695811055 / 2235947419 /
1672122624 / 695811055; low-quality hashes are 969344430 / 1824837666 /
1421858787 / 969344430. These are local renderer fingerprints, not a comparison
against an older release (`baselineMatched: false`). Sample count two and
software rendering do not establish performance parity.

`remaining-r1-values-lines.log`: all six tests pass. Actual module values cover
speed, temperature, fan, width, height, flow, pressure advance and extrusion
modes. TS source-line tests cover blank/CRLF/trailing lines, large-file windows,
UTF-8 truncation and BOM handling. Sample move/source pairs in the benchmark
are 0 → 38, 1 → 47, 14952 → 6398, 29903 → 12693.
The remaining batch peaked at 503,730,176 bytes with zero swap/task-limit hits.
Frozen hashes passed before and after the batch and at final handoff.

Existing `fps-scheduling.log` retains four passing wrapper viewport,
initialization/disposal, FPS publication and frame-coalescing tests. No new
scheduling/lifecycle risk arose, so those checks were not broadened or rerun.
They do not measure actual browser FPS; native viewer deletion and clear/reload
are exercised by the accepted lighting runtime suite.

## Firefox limitation

Five minimal empty-page probes reproduce Firefox startup failure without any
Preview module. Commands used labels `v250-preview-firefox-probe1` through `5`
with the same runner, executing `node "$OUT/firefox-probe.mjs"`; logs are
`OUT/firefox-probe1.log` through `firefox-probe5.log`.

Probe 1 uses default headless launch. Probe 2 sets `dom.ipc.processCount=1`;
probe 3 adds `fission.autostart=false`; probe 4 adds `RAYON_NUM_THREADS=2`;
probe 5 additionally disables `dom.ipc.processPrelaunch.enabled`. The final
probe source is retained beside the logs. These were diagnostic launch options,
not tracked product changes or a persistent Firefox profile modification.

All fail at page creation; cgroup `pids.events max` counts are respectively
56, 20, 9, 57, 43. Peaks range from 384,102,400 to 503,443,456 bytes; swap is
zero. Probe 3 explicitly reports `SandboxBroker: thread creation failed
(4 brokers): EAGAIN`, followed by a browser SIGSEGV. Other probes show the same
pre-module `_page` TypeError as the original harness. The task cap is a concrete
startup blocker; compatibility after removing that blocker is not established.
No Firefox shader, parser, pixel, palette or precision pass is claimed. Rerun
only Firefox using the frozen pair once a viable constrained harness is
available; a module rebuild is unnecessary unless its inputs change.
