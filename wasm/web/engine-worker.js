/**
 * @file engine-worker.js
 * Dedicated Web Worker for the OrcaSlicer WebAssembly engine.
 * Receives RPC messages, fetches vendor bundles directly, and runs engine-core.
 */

import { createEngineCore } from './engine-core.js';

let core = null;
let profilesUrl = '/wasm/build/web/profiles/';
let resourcesLoaded = false;
const loadedVendors = new Set();
const activeControllers = new Map();

/**
 * Handles incoming RPC messages from the main thread.
 */
self.onmessage = async (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  const { id, method, args, type } = data;

  // Handle cancellation/abort requests
  if (method === 'abort' || method === 'cancel' || type === 'abort') {
    const targetId = args?.targetId ?? data.targetId;
    if (targetId && activeControllers.has(targetId)) {
      activeControllers.get(targetId).abort();
    }
    return;
  }

  if (typeof id !== 'number') return;

  try {
    switch (method) {
      case 'init': {
        const { moduleUrl, profilesUrl: pUrl, threads } = args || {};
        if (pUrl) {
          profilesUrl = new URL(pUrl, self.location.href).href;
        } else {
          profilesUrl = new URL(profilesUrl, self.location.href).href;
        }

        const absModuleUrl = new URL(moduleUrl || '/wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs', self.location.href).href;
        const mod = await import(absModuleUrl);
        const moduleFactory = mod.createOrcaEngine || mod.default;

        core = await createEngineCore({
          moduleFactory,
          locateFile: (path, prefix) => {
            if (path.endsWith('.wasm')) {
              return new URL(path, absModuleUrl).href;
            }
            return (prefix || '') + path;
          },
          threads
        });

        await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
        postMessage({ id, ok: true, result: {} });
        break;
      }

      case 'loadVendors': {
        if (!core) throw new Error('Engine not initialized');
        const { vendors = [] } = args || {};

        // Fetch runtime resources bundle once
        if (!resourcesLoaded) {
          const candidates = [
            new URL('resources.json', profilesUrl).href,
            new URL('../resources.json', profilesUrl).href,
            profilesUrl.replace(/\/profiles\/?$/, '') + '/resources.json',
            '/wasm/build/web/resources.json'
          ];

          let loaded = false;
          for (const url of candidates) {
            try {
              const resp = await fetch(url);
              if (resp.ok) {
                const resBundle = await resp.json();
                await core.addVendorBundle(resBundle);
                loaded = true;
                break;
              }
            } catch (_) {}
          }
          if (!loaded) {
            // Non-fatal warning if resources.json not hosted
            console.warn('[engine-worker] Note: resources.json could not be loaded from profiles directory');
          }
          resourcesLoaded = true;
        }

        // Fetch each requested vendor bundle
        for (const vendor of vendors) {
          if (!loadedVendors.has(vendor)) {
            const vendorUrl = new URL(
              `${encodeURIComponent(vendor)}.json`,
              profilesUrl.endsWith('/') ? profilesUrl : profilesUrl + '/'
            ).href;

            const resp = await fetch(vendorUrl);
            if (!resp.ok) {
              throw new Error(`Failed to fetch vendor bundle ${vendor}: ${resp.status} ${resp.statusText}`);
            }
            const bundle = await resp.json();
            await core.addVendorBundle(bundle);
            loadedVendors.add(vendor);
          }
        }

        // Notify C++ engine to reload vendors from /data/system
        const result = await core.call('loadVendors', {});
        postMessage({ id, ok: true, result });
        break;
      }

      case 'listPresets': {
        if (!core) throw new Error('Engine not initialized');
        const result = await core.call('listPresets', args || {});
        postMessage({ id, ok: true, result });
        break;
      }

      case 'selectPresets': {
        if (!core) throw new Error('Engine not initialized');
        const result = await core.call('selectPresets', args || {});
        postMessage({ id, ok: true, result });
        break;
      }

      case 'getConfig': {
        if (!core) throw new Error('Engine not initialized');
        const result = await core.call('getConfig', args || {});
        postMessage({ id, ok: true, result });
        break;
      }

      case 'getConfigDef': {
        if (!core) throw new Error('Engine not initialized');
        const result = await core.call('getConfigDef', args || {});
        postMessage({ id, ok: true, result });
        break;
      }

      case 'evaluateRules': {
        if (!core) throw new Error('Engine not initialized');
        const result = await core.call('evaluateRules', args || {});
        postMessage({ id, ok: true, result });
        break;
      }

      case 'setOptions': {
        if (!core) throw new Error('Engine not initialized');
        const result = await core.call('setOptions', args || {});
        postMessage({ id, ok: true, result });
        break;
      }

      case 'resetOptions': {
        if (!core) throw new Error('Engine not initialized');
        const result = await core.call('resetOptions', args || {});
        postMessage({ id, ok: true, result });
        break;
      }

      case 'loadModel': {
        if (!core) throw new Error('Engine not initialized');
        const { fileName, bytes } = args || {};
        const result = await core.loadModel(fileName, bytes);
        postMessage({ id, ok: true, result });
        break;
      }

      case 'arrange': {
        if (!core) throw new Error('Engine not initialized');
        const result = await core.call('arrange', args || {});
        postMessage({ id, ok: true, result });
        break;
      }

      case 'slice': {
        if (!core) throw new Error('Engine not initialized');
        const controller = new AbortController();
        activeControllers.set(id, controller);

        try {
          const onProgress = (prog) => {
            postMessage({ id, progress: prog });
          };

          const sliceArgs = { ...(args || {}), outPath: (args && args.outPath) || '/out/plate_1.gcode' };
          const sliceResult = await core.call('slice', sliceArgs, {
            onProgress,
            signal: controller.signal
          });

          const outPath = args?.outPath || sliceResult?.gcodePath || '/out/plate_1.gcode';
          let gcodeBytes;
          try {
            gcodeBytes = core.readFile(outPath);
          } catch (_) {
            gcodeBytes = new Uint8Array(0);
          }
          sliceResult.gcode = gcodeBytes;

          // Zero-copy transfer of G-code buffer to the page
          postMessage({ id, ok: true, result: sliceResult }, [sliceResult.gcode.buffer]);
        } finally {
          activeControllers.delete(id);
        }
        break;
      }

      case 'dispose': {
        if (core) {
          core.dispose();
          core = null;
        }
        postMessage({ id, ok: true, result: {} });
        break;
      }

      default:
        throw new Error(`Unknown RPC method: ${method}`);
    }
  } catch (err) {
    postMessage({
      id,
      ok: false,
      canceled: Boolean(err?.canceled || err?.name === 'AbortError' || err?.message === 'canceled'),
      error: err instanceof Error ? err.message : String(err)
    });
  }
};
