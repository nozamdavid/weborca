# Preview worker implementation, 2026-11-11

Changed `wasm/app/src/preview/orcaPreviewModule.ts`, `previewStore.ts`, `previewWorker.ts`, `previewWorkerClient.ts`, and the G-code import lines in `wasm/app/src/store/appStore.ts`.

The worker loads the existing preview runtime, stages G-code, calls `parseGcode`, copies the packet for transfer and removes both staging files. The renderer consumes the retained packet with `loadParsedGcode`; one prepared result is retained with a weak source identity. Imports now propagate parser errors rather than publishing zero statistics. Worker cancellation rejects pending requests and permits a fresh worker.

Validation: `cd wasm/app && npx tsc --noEmit` passed. `cd wasm/tests && node --test node/mobile-preview-lifecycle.test.mjs` passed (one test). This existing test does not exercise the worker protocol. Dedicated worker/client tests, native packet integration, fixture equivalence, phase timings and Playwright heartbeat measurements remain outstanding. No speedup has been established. The native artifact and integrated UI build must be available for those checks.

Known concern: a new import can begin while an earlier import is parsing but before the new file has finished reading; the earlier renderer load can occur during that interval. The import sequence prevents its app-store publication, but does not yet invalidate that renderer operation at the beginning of the new import. This needs correction and focused overlapping-import coverage before merge.
