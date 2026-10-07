# Orca WASM engine API (Phase 1)

Two layers:

1. `Engine`, a C++ class exposed with Embind from the `orca_engine` module (wasm/engine/).
2. JavaScript on top of it (wasm/web/): `engine-core.js` drives the Embind class and works in Node and in a Web Worker; `orca-engine.js` is the page-side promise API that talks to a Worker running `engine-worker.js`.

## Threading rule

All engine work runs on one dedicated engine pthread owned by `Engine`. The module's main runtime thread (the Worker's JS thread, or Node's main thread) only queues jobs and polls. It must never block: Emscripten creates extra pthreads (for TBB workers) through that thread, so blocking it while TBB waits for a new thread deadlocks.

Thread count for slicing is applied with `tbb::task_arena(n).execute(...)`. Never use `tbb::global_control`: it lowers real parallelism while `this_task_arena::max_concurrency()` keeps reporting all cores, and `name_tbb_thread_pool_threads_set_locale()` (src/libslic3r/Thread.cpp) then waits forever.

## Module

- ES module, factory `createOrcaEngine(moduleOverrides) -> Promise<Module>`. Files `orca_engine.mjs`, `orca_engine.wasm`, built into `wasm/build/orca-wasm64/wasm/engine/`.
- `-sENVIRONMENT=web,worker,node`, so the same artifact runs in Node tests and in browsers.
- `Module.FS` is exported. Inputs are written into MEMFS before the job that reads them.
- Filesystem layout used by the engine:
  - `/resources`: Orca resources needed at runtime (at least `resources/info/`).
  - `/data/system`: vendor profiles, laid out like `resources/profiles` (`<Vendor>.json` plus `<Vendor>/`). `OrcaFilamentLibrary` must be present.
  - `/models`: model files.
  - `/out`: G-code output.

## Embind class `Engine`

```text
new Engine()
submit(op: string, argsJson: string): number   // queue a job, returns job id (> 0)
poll(jobId: number): string                    // "" while pending, else a JSON result (see below); the result is dropped after it is returned once
progress(): string                             // JSON {"jobId": n, "percent": 0-100, "text": "..."} for the running slice, {"jobId": 0} otherwise
cancel(): void                                 // cancel the running slice; safe to call at any time from the main thread
delete()                                       // Embind destructor: stops the engine thread after the current job
```

Every result is JSON: `{"ok": true, "result": <op result>}` or `{"ok": false, "error": "message"}`. A canceled slice returns `{"ok": false, "canceled": true, "error": "canceled"}`.

Jobs run strictly in submission order.

### Ops

| op | args | result |
| :--- | :--- | :--- |
| `init` | `{"resourcesDir": "/resources", "dataDir": "/data"}` | `{}` |
| `loadVendors` | `{}` | `{"vendors": [{"name": "Voron", "printers": n, "processes": n, "filaments": n}]}` loads every vendor found in `<dataDir>/system` into a fresh PresetBundle; previous selections are kept when the names still exist |
| `listPresets` | `{"kind": "printer" \| "process" \| "filament", "compatibleOnly": bool}` | `[{"name", "vendor", "isSystem", "isCompatible", "inherits"}]`; `compatibleOnly` filters by the selected printer (and process for filaments) |
| `selectPresets` | `{"printer": "...", "process": "...", "filaments": ["..."]}` | `{"printer", "process", "filaments"}` actually selected; error if a name is unknown. Clears option overrides |
| `getConfig` | `{}` | `{key: serializedValue}` for the full config slicing will use (presets merged plus overrides) |
| `setOptions` | `{"options": {key: serializedValue}}` | `{"errors": [{"key", "error"}]}`; valid keys become overrides on top of the presets; values use the same serialization as Orca profile JSON |
| `resetOptions` | `{}` | `{}` |
| `loadModel` | `{"path": "/models/x.stl"}` | `{"objects": [{"name", "instances", "volumes", "size": [x, y, z]}]}`; replaces the current model |
| `arrange` | `{}` | `{}`; centers on the bed and arranges, same as wasm/spike/slice_driver.cpp |
| `slice` | `{"outPath": "/out/plate_1.gcode", "threads": n}` | `{"gcodePath", "gcodeBytes", "layers", "printTimeS", "filamentMm", "filamentG", "warnings": ["..."]}` |
| `getConfigDef` | `{"keys": [...]}` (optional, all keys when absent; unknown keys are skipped) | `{key: {"type", "label", "fullLabel", "category", "tooltip", "sidetext", "mode", "min", "max", "default", "enumValues", "enumLabels", "nullable", "readonly", "multiline", "guiType", "guiFlags"}}` from `print_config_def`; unset fields are omitted, strings are untranslated. Full schema and examples: API-configdef.md |

Slicing must produce G-code identical (wasm/spike/compare_gcode.sh exit 0) to `wasm/spike/slice_driver.cpp` for the same model, presets and arrangement.

## JavaScript (wasm/web/)

### engine-core.js (Node and Worker)

```js
const core = await createEngineCore({ moduleFactory, locateFile, threads });
core.writeFile(path, bytes); core.readFile(path) -> Uint8Array; core.mkdirp(path);
await core.call(op, args, { onProgress, signal }) // submit + poll every 16 ms; AbortSignal calls cancel()
await core.addVendorBundle(bundle)                // writes a packed vendor bundle into /data/system
await core.loadModel(fileName, bytes)             // writes /models/<fileName>, runs loadModel
core.dispose()
```

### orca-engine.js (page side)

```js
const engine = await OrcaEngine.create({ workerUrl, profilesUrl, threads });
await engine.loadVendors(['Voron']);          // fetches packed bundles, OrcaFilamentLibrary added automatically
await engine.listPresets('printer', { compatibleOnly: false });
await engine.selectPresets({ printer, process, filaments });
await engine.getConfig();
await engine.setOptions({ layer_height: '0.2' });
await engine.resetOptions();
await engine.loadModel(fileName, bytes);
await engine.arrange();
const r = await engine.slice({ onProgress, signal }); // r.gcode is a Uint8Array plus the slice stats
engine.dispose();
```

Default thread count: `Math.min(navigator.hardwareConcurrency, 8)`.

### Packed vendor bundle

`wasm/web/tools/pack_profiles.mjs` writes `<out>/profiles/<Vendor>.json` = `{"vendor": "Voron", "files": {"Voron.json": "<text>", "Voron/machine/....json": "<text>"}}` and `<out>/profiles/index.json` = `[{"name", "bytes"}]`, plus `<out>/resources.json` with the same shape for the runtime resources (`info/**`).
