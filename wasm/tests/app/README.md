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
