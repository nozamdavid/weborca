# OrcaSlicer WebAssembly Web API (Phase 1)

This directory contains the client JavaScript runtime, Web Worker RPC wrapper, profile packaging tools, and interactive browser demo for running OrcaSlicer's slicing engine compiled to WebAssembly.

---

## 1. Quick Start

### Build the WebAssembly Module
The C++ Embind module is built with Emscripten:
```bash
bash wasm/scripts/build_orca.sh
```
This produces:
- `wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs`
- `wasm/build/orca-wasm64/wasm/engine/orca_engine.wasm`

### Pack Vendor Profiles and Resources
To generate the packed vendor bundles, `index.json`, and runtime `resources.json`:
```bash
# Pack Voron and filament library only (fast for testing):
node wasm/web/tools/pack_profiles.mjs . wasm/build/web Voron OrcaFilamentLibrary

# Or pack all vendors:
node wasm/web/tools/pack_profiles.mjs . wasm/build/web
```

### Start the Local Server
WebAssembly multi-threading requires `SharedArrayBuffer`, which mandates Cross-Origin Opener Policy (COOP) and Cross-Origin Embedder Policy (COEP) headers. Start the bundled server:
```bash
bash wasm/web/serve.sh
```
Then open:
[http://localhost:5056/wasm/web/demo/index.html](http://localhost:5056/wasm/web/demo/index.html)

---

## 2. Cross-Origin Isolation Requirement (COOP / COEP)

Because OrcaSlicer utilizes multi-threaded slicing with TBB/pthreads, the browser enforces strict security isolation. The web server must send the following HTTP response headers for all documents and scripts:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

When properly set, `window.crossOriginIsolated` will evaluate to `true` on the page and inside Web Workers. If this evaluates to `false`, WebAssembly thread creation and `SharedArrayBuffer` will be disabled by the browser.

---

## 3. Architecture & API Overview

### Layer 1: `engine-core.js` (Low-Level Driver)
Runs both in Node.js and inside a Web Worker. Drives the Embind `Engine` instance without blocking the host thread (polling with delays up to 16ms, forwarding progress snapshots, canceling on `AbortSignal`).

The `threads` option selects slicing concurrency. Preloaded Web Workers use the generated loader's pool sizing expression; this option does not resize that pool.

```js
import { createEngineCore } from './engine-core.js';

const core = await createEngineCore({
  moduleFactory: createOrcaEngine,
  threads: 4
});

core.writeFile('/models/cube.stl', stlBytes);
await core.addVendorBundle(voronBundle);
await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
await core.call('loadVendors', {});
await core.call('selectPresets', { printer: '...', process: '...', filaments: ['...'] });
await core.call('arrange', {});
const result = await core.call('slice', { outPath: '/out/plate.gcode', threads: 4 }, {
  onProgress: ({ percent, text }) => console.log(percent, text)
});
const gcodeBytes = core.readFile(result.gcodePath);
core.dispose();
```

### Layer 2: `engine-worker.js` (Web Worker)
Hosts `engine-core.js` on a background thread. It listens for RPC messages `{ id, method, args }`, fetches packed profile bundles directly so large JSON strings bypass the main UI thread, and transfers G-code `Uint8Array` back to the main thread via zero-copy buffer transfer.

### Layer 3: `orca-engine.js` (Page-Side Promise API)
The primary client API consumed by web applications.

```js
import { OrcaEngine } from './orca-engine.js';

const engine = await OrcaEngine.create({
  workerUrl: '/wasm/web/engine-worker.js',
  moduleUrl: '/wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs',
  profilesUrl: '/wasm/build/web/profiles/',
  threads: 4
});

// Load profiles (OrcaFilamentLibrary loaded automatically)
await engine.loadVendors(['Voron']);

// Query and select presets
const printers = await engine.listPresets('printer', { compatibleOnly: false });
await engine.selectPresets({
  printer: 'Voron 2.4 300 0.4 nozzle',
  process: '0.20mm Standard @Voron',
  filaments: ['Generic PLA @System']
});

// Load 3D model (Uint8Array or ArrayBuffer)
await engine.loadModel('cube.stl', modelBytes);

// Arrange plate and slice with progress and cancellation support
await engine.arrange();
const controller = new AbortController();
const result = await engine.slice({
  threads: 4,
  signal: controller.signal,
  onProgress: ({ percent, text }) => console.log(`${percent}%: ${text}`)
});

console.log(`Sliced ${result.layers} layers in ${result.printTimeS}s`);
// result.gcode is a Uint8Array containing the G-code
engine.dispose();
```

---

## 4. Verification Tools

- `node wasm/web/tools/pack_profiles.mjs . wasm/build/web [Vendors...]`: packs profiles into `wasm/build/web/profiles/`.
- `node wasm/web/tools/check_bundle.mjs . wasm/build/web/profiles/Voron.json`: validates that all files in `resources/profiles/Voron/**` and `Voron.json` are bit-for-bit identical to the disk source.
- `node wasm/web/tools/node_slice.mjs`: performs an end-to-end slice test in Node once `orca_engine.mjs` is compiled.
