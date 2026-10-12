# OrcaSlicer Web App Tests

This directory contains browser-based E2E tests for the React UI, using Playwright.

## Running tests

Run any test directly with Node:

```bash
node wasm/tests/app/smoke.mjs
```

Each test automatically builds its own isolated copy of the app (`wasm/build/ui-<testname>-dist`) before starting its preview server, to ensure it doesn't run against stale artifacts. If the build succeeds, the test launches a Vite preview server and Playwright runs the browser interactions.

If you want to skip the build and serve an existing dist directory, you can provide the `APP_TEST_DIST` environment variable:

```bash
APP_TEST_DIST=wasm/app/dist node wasm/tests/app/smoke.mjs
```

**Note**: When using `APP_TEST_DIST`, the test runner checks if the provided directory is older than the source files (in `wasm/app/src`, `wasm/web`, or the engine `.wasm`). If it's stale, the test will refuse to run.

## Preview performance

`preview-performance.mjs` exercises the real app, including sliders, quality changes, source-line display, preferences, and GPU upload counts. Its default fixture is generated in memory and uses four tools. Chromium uses SwiftShader; Firefox uses the backend available on the host. Compare timings only with the same reported renderer and fixture.

```bash
PREVIEW_PERF_OUTPUT=/tmp/preview-performance.json node wasm/tests/app/preview-performance.mjs
```

Set `PREVIEW_PERF_GCODE` to a local file, or `PREVIEW_PERF_PROJECT` to a local 3MF to include import, its history snapshot, slicing, and preview loading. `PREVIEW_PERF_PROJECT_VENDOR` preloads the project's system preset vendor. `PREVIEW_PERF_RESLICES=2` repeats the complete slicing and preview replacement twice before changing the quality or color view. `PREVIEW_PERF_INITIAL_LOW=1` tests the low-quality preference before the first load. `PREVIEW_PERF_BROWSER=firefox` selects Firefox alone.

Autosave is disabled for controlled timing comparisons. `PREVIEW_PERF_AUTOSAVE=1` keeps it enabled and, for a project fixture, verifies that a complete project backup finishes before recording the final memory peak. `autosave.writeMs` includes waiting for an earlier writer, project export, and the IndexedDB commit; reading the backup for verification is excluded. The test clears its own backup before the preference-refresh check.

For an intentional comparison against a frozen artifact, set both `APP_TEST_DIST` and `PREVIEW_PERF_FROZEN_DIST=1`. This exception to the stale-build guard applies only to the performance harness; record the exact engine and preview module hashes alongside the report. Private models and generated G-code belong outside published artifacts.

`startupMs` measures navigation through engine and preview initialization. `initialLoadMs` then measures the input workflow through its first ready preview, including import and slicing for a project. `loadMs` also includes requested reslices and initial color-view checks; it excludes startup. `sliceActionMs` can include synchronous React preview parsing after slicing completes. `sliceToFrameMs` ends after two animation frames and is a submission marker, rather than a GPU presentation measurement. Frame measurements read one pixel and depend on the browser driver. `uiScrubbing.actionMs` measures the actual store action; `frameReadyMs` includes two animation frames. The text-window readiness measurement ends at the highlighted line's DOM insertion, while its separate opening measurement includes browser automation wait time.

Renderer memory values estimate retained arrays and texture contents. Preview `heapBytes` and `heapPeakBytes` observe memory construction and successful growth in the page's main thread; the engine uses a separate worker realm. They describe WebAssembly capacity, not process RSS. When run in a Linux cgroup, the report also includes that scope's peak memory, swap, and memory-limit events, covering browser, engine, and preview together. Large private-project tests require an explicit memory budget and should run serially with native builds; a killed scope indicates a budget failure and must not be treated as a completed benchmark.
