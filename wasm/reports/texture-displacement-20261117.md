# Texture displacement — aggregate verification, 2026-11-17

Edit > Texture displacement bakes PNG/JPEG height textures into a single whole selected model part through the native engine, with one `Bake texture displacement` history entry and Undo/Redo. The verified candidate is shared within the private tailnet; it does not replace the public release. Verification preceded the publication commit. Full native parity is not claimed.

## Final candidate and fixes

The current frontend is `wasm/build/ui-texture-displacement-viewer-release-20261117`, with viewer toolbar and mobile Tools entries and all 44 native bundled textures alongside custom upload. Bark loads initially; selecting a texture preserves parameters and supplies original PNG bytes. See [viewer/picker acceptance and publication](texture-displacement-viewer-20261117.md). The unchanged r2 engine, preview and STEP assets/manifests are retained. The persistent service now serves this candidate; r2 remains available for rollback. Mobile entry and Bake are now verified, superseding the earlier mobile-entry limitation below.

Final immutable candidate: `wasm/build/ui-texture-displacement-r2-20261117`, served at [private Tailscale HTTPS port 5299](https://server-1.barbel-hops.ts.net:5299/) through `http://127.0.0.1:5299`. Engine SHA256: `9c680893c1f380241c7f0c7587cf05b757ef4d6186e354cc147b61f15f7c6c1d`. The [r2 report](texture-displacement-recovery-20261117.md) records matching on-disk and browser-fetched engine hashes.

On 2026-11-17 at 01:12 UTC, HTTPS GET `/` and `/engine/orca_engine.wasm` returned HTTP 200 with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. SHA256 of the HTTPS-fetched WASM matched the value above. Tailscale Serve runs in background on dedicated HTTPS port 5299; other endpoints were preserved. The parent preview process was replaced by enabled, active user service `orca-texture-candidate.service` at `~/.config/systemd/user/orca-texture-candidate.service`, bound to this candidate and loopback port 5299, retaining Vite's headers with restart on failure. User lingering is enabled for persistence after logout.

Final fixes add native PNG dimension preflight, retry of scene refresh/history after a successful bake without baking again, and immediate slice invalidation. Parent verification recompiled `EditOps.cpp` and linked the engine, reran the native texture test, TypeScript checking and the full production build; all passed. Oversized and zero PNG IHDR dimensions were rejected with geometry preserved; valid relief measured +0.4022 mm. These final parent checks are supplied completion evidence; the earlier build report describes the initial candidate. Slice invalidation was not independently measured by r2 browser QA.

## Evidence by candidate

- [Initial build/tests and integrated acceptance](texture-displacement-initial-20261117.md): initial candidate `wasm/build/ui-texture-displacement-20261117` on port 5298, engine SHA256 `599d36461f1738f3b3372ad26993e951a84d53a2e401f7959ae4f8d49ac289f8`. Emscripten compilation of `Engine.cpp` and `EditOps.cpp`, native geometry test, TypeScript, 22 locale checks and production build passed. PNG/JPEG, corrupt input, zero depth, inversion, history, 3MF save/reopen and slicing were checked. Reopened geometry sliced to 102 layers and 3,915,147 G-code bytes. This was an incremental build using copied dependency/build artifacts, not a clean rebuild.
- [Broad r1 browser QA](texture-displacement-browser-20261117.md): the same initial frozen candidate on port 5298. Real knurling PNG/cylindrical and carbon-fiber JPEG/spherical bakes, rotated triplanar bake, multipart selection and sibling isolation, modifier rejection, mobile dialog layout and light/dark readability passed the recorded checks. An actual `sphere.3mf` browser download completed and its archive/geometry were checked. Rendered controls were exercised with DOM events as well as preview actions; physical pointer hit testing was not established for every action. This run did not verify the final fixes.
- [Final r2 recovery and normal-bake confirmation](texture-displacement-recovery-20261117.md): final immutable candidate on port 5299. Injected post-bake `saveProject` and `commitTransaction` failures each produced truthful recovery messaging; Retry update finished scene/history work with exactly one successful native bake. Undo restored the original cube and redo restored baked geometry. A normal Bake without injected failure also passed with Undo/Redo. A redo coordinate discrepancy was investigated: native recentering compensated by instance offset preserved world geometry within 0.00000067435 mm. This focused run did not repeat r1's broad projection, eligibility, export or transformed-part coverage.

## Supported scope and limits

One texture applies to one whole selected part; multipart objects require selecting a specific part. PNG/JPEG input is limited to 8 MB and 2048×2048 pixels, with a 200,000-triangle output cap. Defaults are depth 0.4 mm, tile 12.5 mm, neutral height 0 and triplanar projection; rotation, neutral height, cylindrical/spherical projection and native sign reversal are available. Alpha is composited on white before native luminance conversion.

Painted, UV-mapped and multi-instance parts are rejected to protect annotations. There are no painting layers, UV layout editor, displacement color output, live geometry preview or cancellation of an active bake. New UI copy is English.

Actual G-code download was not checked; generated slicing output was checked on the initial candidate. The particular downloaded r1 3MF was not reopened, while initial integrated acceptance separately checked 3MF reopening. Painted/UV/multi-instance rejection was not independently established in broad browser QA. Nonuniform scale, mirrors, volume transforms, mobile tool entry/touch bake, exact projection seam/pole quality and full native parity remain unverified. Ideal-surface displacement metrics in r1 do not establish exact depth bounds against every original triangle.

## Local command references

From the repository root, the native test command recorded in the initial evidence is:

```sh
ORCA_ENGINE_MODULE=$PWD/wasm/build/texture-engine/wasm/engine/orca_engine.mjs node --test wasm/tests/node/texture-displacement.test.mjs
```

To serve the final candidate from `wasm/app`:

```sh
./node_modules/.bin/vite preview --outDir ../build/ui-texture-displacement-r2-20261117 --host 127.0.0.1 --port 5299 --strictPort
```

The enabled service owns port 5299; starting another server there requires stopping that service first. Sharing used `tailscale serve --bg --https=5299 http://127.0.0.1:5299`. This serving update ran HTTP/header/hash and service checks without source edits, builds or browser QA. Taproot milestone `N0NVarov4SU6Mi` records the private URL and evidence.
