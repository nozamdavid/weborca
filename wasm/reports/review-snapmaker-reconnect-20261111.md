# Snapmaker reconnect CI follow-up — 2026-11-11

Resolved a stale fixture expectation in `wasm/tests/node/snapmaker-cloud-reconnect.test.mjs`. No production connection code changed.

The original focused command, `node --test wasm/tests/node/snapmaker-cloud-reconnect.test.mjs`, reproduced `1 !== 2` at line 61 and exited normally through the existing teardown. The fixture received a successful snapshot, failed the socket, then immediately left and returned to the device tab before expecting another socket. `session.ts` deliberately defers monitoring after a tab return while the cached display is younger than 15 seconds. Another event-loop turn cannot expire that freshness window.

The test now retries directly from the error state, verifying immediate recovery despite a fresh cache, duplicate retry suppression during setup, restored telemetry, and no reconnect for a healthy session. It then leaves and returns to the tab and verifies the existing freshness behavior: two sockets before the deadline, three after advancing the controlled clock by 15 seconds. This small additional boundary check distinguishes a stale fixture from a suppressed reconnect regression without wall-clock delays. The prior unconditional deselection teardown is preserved.

Validation:

- `node --test wasm/tests/node/snapmaker-cloud-reconnect.test.mjs` — passed twice, 1/1 each run (approximately 69 ms total per run).
- `wasm/app/node_modules/.bin/tsc --noEmit -p wasm/app/tsconfig.json` — passed, exit 0. The focused harness also bundles the actual session and connection code with esbuild.
- `git diff --check -- wasm/tests/node/snapmaker-cloud-reconnect.test.mjs` — passed.

All account responses and sockets are local fixtures; no real printers or accounts were contacted. No UI build, service, or preview was used.
