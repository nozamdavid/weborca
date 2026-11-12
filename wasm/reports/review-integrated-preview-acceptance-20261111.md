# Integrated Preview and cloud acceptance — 2026-11-11

Result: no Preview/cloud product blocker found in the original frozen candidate. Actual packaged app startup, native worker parsing, transferred packet rendering, error recovery and optional-cloud timeout checks passed within the scope below. The later PlateScene Escape correction is outside these bytes and requires the parent's final candidate verification.

## Identity and execution

Branch: `fix/weborca-review-followups`. Candidate: `wasm/build/ui-review-followups-20261111`. Full SHA256 inventory verified before and after acceptance, with every entry OK: [initial](integrated-preview-acceptance-20261111/inventory.log), [final](integrated-preview-acceptance-20261111/inventory-final.log). Inventory SHA256: `36f93718d08527eec23ef0f5265cdebe988ba5f4bdec568ff1f79bf4c51cee11`.

Read repository AGENTS.md and `/mnt/appdata/workspace/OrcaSlicer/AGENTS.md`, worker-final, worker-implementation, native, native-acceptance, cloud-startup and cloud-final-correctness reports. No source edits, native compilation, UI rebuild, service refresh, commit, push, README or Taproot updates performed.

Owned HTTP server bound only `127.0.0.1:5067`, supplying COOP same-origin and COEP require-corp. Playwright launched fresh headless Chromium with SwiftShader and isolated browser storage. No preview tools, real cloud accounts or printers used. All owned browsers and HTTP servers closed; port 5067 free afterward. PID 592057 remained alive and untouched.

Commands from repository root:

```sh
node wasm/reports/integrated-preview-acceptance-20261111/harness.mjs
node wasm/reports/integrated-preview-acceptance-20261111/supplement.mjs
node --check wasm/reports/integrated-preview-acceptance-20261111/harness.mjs
node --check wasm/reports/integrated-preview-acceptance-20261111/supplement.mjs
timeout 30s node --test wasm/tests/node/preview-import-overlap.test.mjs wasm/tests/node/preview-worker-client-lifecycle.test.mjs
```

Evidence: [integrated run](integrated-preview-acceptance-20261111/run-final.log), [phase/recovery run](integrated-preview-acceptance-20261111/supplement-final.log), [7/7 focused tests](integrated-preview-acceptance-20261111/focused.log). Both harness syntax checks pass. These are observation harnesses; outcomes were reviewed from logged app/worker/store data and screenshots, rather than a comprehensive assertion suite.

The first harness incorrectly selected Preview as role button instead of tab. Its owned browser was terminated, allowing finally cleanup; [initial log](integrated-preview-acceptance-20261111/run.log) retains the harness failure. Corrected locator runs reused identical candidate bytes. A supplementary run added phase/store observations because app sliceResult does not expose rendererLoadMs. No production behavior was patched to make the checks pass.

## Integrated observations

- Ordinary local startup renders the application and reaches actual `isEngineReady: true`, `engineError: null`. No readiness or slice statistics were injected.
- Calls to the app's exposed `__appStore.getState().openGcodeFile` execute the production import boundary using real File objects. Both fixtures publish nonzero statistics before explicit Preview-tab navigation. This checks the app action, not the operating system file picker. The app already initializes its renderer canvas during startup; this does not establish that all renderer setup waits for Preview navigation.
- Production `assets/previewWorker-C0qFF4Vg.js`, `/preview/orca_preview.js`, WASM and nested pthread JS load successfully through HTTP. Worker messages carry actual native statistics and transferred packets (2,392,979 and 26,560,894 bytes). No fallback parser or substituted native module was used.
- Small fixture: existing `refs-macos-x86_64/cube-voron.gcode`, 376,020 bytes, 29,904 moves, 100 layers, 575.43 seconds, 1305.74 mm and 3.89 g. These match the native fixture report.
- Large fixture: existing detailedGcode generator with 120 layers, 1024 segments and cube config; 4,776,393 bytes, 332,007 moves, 120 layers, 1751.54 seconds, 3207.55 mm and 9.57 g.
- Actual rendered Preview checked visually: [cube](integrated-preview-acceptance-20261111/preview.png), [large](integrated-preview-acceptance-20261111/large.png). Navigation succeeds; cube statistics panel agrees with the app/native values. Worker observation count stays at two across the large Preview navigation: packet reuse does not parse again.
- Invalid text `not gcode` produces `Failed to load G-code: No toolpath moves in G-code`, preserving small.gcode and all prior Preview statistics including renderer timing. Subsequent valid import publishes recovered.gcode with correct statistics.
- Overlap through the app boundary: artificially delayed older File.arrayBuffer; import newest.gcode to completion, then release older read. App identity remains newest.gcode with correct Preview statistics. Only file-read scheduling is injected. Precise in-flight worker/renderer races are covered by the seven focused deterministic tests; real UI scheduling was not forced to reproduce those races.
- Stalled local `/_orca-cloud/status` route: isolated tab has app rendered and engine ready while checking is visible at 2.5 seconds; checking is absent after another 8 seconds, engine remains ready. Exactly one status route intercepted. Request eventually aborted locally. No successful status/authentication response was injected, and no signed-in success was observed. Account internal state was not exported for direct inspection. Normal local startup also succeeds with the static server's unavailable cloud backend; successful authenticated cloud startup is outside this test.

## Stage and responsiveness samples

Single headless software-rendering samples; timings are elapsed native stage values. Supplement observes worker messages and reads the packaged Preview store export without changing store state. The worker heartbeat starts at its production postMessage and stops on response, so includes runtime startup, parsing, conversion and transfer; it cannot isolate the native parse interval alone.

| Sample | Native parse ms | Conversion ms | Renderer load ms | Worker request ms | Heartbeat ticks / maximum gap ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small cold, final supplement | 44.475 | 0.715 | 4.110 | 98.935 | 4 / 81.710 |
| Small valid recovery, same run | 16.350 | 0.300 | 2.675 | 47.235 | 9 / 5.605 |
| Large, same run | 63.485 | 6.590 | 20.465 | 161.950 | 32 / 5.975 |

Another integrated sample measured small parse/conversion 38.595/0.605 ms and large 64.755/6.595 ms. Large full app import was 258.535 ms. First small full import in the initial run was 1832.095 ms with a 1701.180 ms timer gap; that broad interval includes startup/renderer work and does not measure worker parse alone. Cold responsiveness remains imperfect. The supplement's sample arrays are shared until serialization, so earlier snapshot arrays contain subsequent observations; stage statistics and individual worker sample records remain valid.

Native rendererLoadMs measures the load call, not total camera, UI publication, GPU upload/driver synchronization or first-frame latency. SwiftShader logs GPU ReadPixels stalls. There is remaining main-thread rendering/upload cost; no general speedup, hardware-GPU latency or peak-memory/OOM recovery claim is made.

## Retained limitations and warnings

No dynamic asset URL, nested pthread, WASM memory or engine startup blocker reproduced on this loopback deployment. Not qualified: subpath deployment, different browsers/devices, arbitrary file sizes, peak resident memory, true GPU upload latency or real cloud/printer operations. Static server uses index fallback for missing routes, so this is not deployment-routing qualification.

Logs retain native `info/nozzle_info.json` parse warnings, a bed-assets warning, and an engine JS request aborted during startup before subsequent successful initialization. Cube and large output still render. A broken top-left image is visible in the cube screenshot. These are retained observations, not evidence of a Preview worker failure; resource warning cleanup remains with the parent. No unsupported URL or memory error was hidden by injected readiness or statistics.

Changed files owned by this task: this report and `wasm/reports/integrated-preview-acceptance-20261111/` only. Parent scene changes and all other shared work were left intact.
