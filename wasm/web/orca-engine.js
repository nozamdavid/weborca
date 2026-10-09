/**
 * @file orca-engine.js
 * High-level page-side Promise API for OrcaSlicer WebAssembly engine.
 * Communicates with engine-worker.js via Web Worker RPC.
 */

/**
 * @typedef {Object} CreateEngineOptions
 * @property {string} [workerUrl] - URL to engine-worker.js
 * @property {string} [moduleUrl] - URL to orca_engine.mjs
 * @property {string} [profilesUrl] - Base URL to packed vendor profiles directory
 * @property {number} [threads] - Number of threads (default: Math.min(hardwareConcurrency, 8))
 */

/**
 * @typedef {Object} PresetItem
 * @property {string} name
 * @property {string} vendor
 * @property {boolean} isSystem
 * @property {boolean} isCompatible
 * @property {string} inherits
 */

/**
 * @typedef {Object} SliceOptions
 * @property {(progress: { jobId: number, percent?: number, text?: string }) => void} [onProgress]
 * @property {AbortSignal} [signal]
 * @property {number} [threads]
 * @property {string} [outPath]
 * @property {number} [plateIndex]
 */

/**
 * @typedef {Object} SliceResult
 * @property {Uint8Array} gcode - The generated G-code
 * @property {string} gcodePath - Destination path in MEMFS
 * @property {number} gcodeBytes - Total bytes in G-code
 * @property {number} layers - Total layer count
 * @property {number} printTimeS - Estimated print time in seconds
 * @property {number} filamentMm - Filament length used in mm
 * @property {number} filamentG - Filament weight used in grams
 * @property {string[]} warnings - Any slicing warnings
 */

export class OrcaEngine {
  /**
   * @param {Worker} worker
   * @param {CreateEngineOptions} options
   */
  constructor(worker, options) {
    this._worker = worker;
    this._options = options;
    this._nextId = 1;
    /** @type {Map<number, { resolve: Function, reject: Function, onProgress?: Function, cleanup?: Function }>} */
    this._pending = new Map();

    this._worker.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // Streaming progress update for an in-flight operation
      if (data.progress !== undefined) {
        const handler = this._pending.get(data.id);
        if (handler?.onProgress) {
          handler.onProgress(data.progress);
        }
        return;
      }

      // Standard RPC response
      const handler = this._pending.get(data.id);
      if (handler) {
        this._pending.delete(data.id);
        if (handler.cleanup) handler.cleanup();

        if (data.ok) {
          handler.resolve(data.result);
        } else {
          const err = new Error(data.error || 'Operation failed');
          if (data.canceled || data.error === 'canceled') {
            err.name = 'AbortError';
            /** @type {any} */ (err).canceled = true;
          }
          handler.reject(err);
        }
      }
    };

    this._worker.onerror = (event) => {
      const err = new Error(event.message || 'Worker encountered an error');
      for (const handler of this._pending.values()) {
        if (handler.cleanup) handler.cleanup();
        handler.reject(err);
      }
      this._pending.clear();
    };
  }

  /**
   * Creates an OrcaEngine instance and initializes the background worker.
   * @param {CreateEngineOptions} [options={}]
   * @returns {Promise<OrcaEngine>}
   */
  static async create(options = {}) {
    const defaultThreads = Math.min(
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4,
      8
    );

    const merged = {
      workerUrl: options.workerUrl || new URL('./engine-worker.js', import.meta.url).href,
      moduleUrl: options.moduleUrl
        ? new URL(options.moduleUrl, import.meta.url).href
        : new URL('/wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs', import.meta.url).href,
      profilesUrl: options.profilesUrl
        ? new URL(options.profilesUrl, import.meta.url).href
        : new URL('/wasm/build/web/profiles/', import.meta.url).href,
      threads: typeof options.threads === 'number' ? options.threads : defaultThreads
    };

    const worker = new Worker(merged.workerUrl, { type: 'module' });
    const engine = new OrcaEngine(worker, merged);

    await engine._call('init', {
      moduleUrl: merged.moduleUrl,
      profilesUrl: merged.profilesUrl,
      threads: merged.threads
    });

    return engine;
  }

  /**
   * Internal RPC helper.
   * @private
   */
  _call(method, args = {}, { onProgress, signal, transfer = [] } = {}) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      let cleanup = null;

      if (signal) {
        if (signal.aborted) {
          this._worker.postMessage({ method: 'abort', args: { targetId: id } });
        } else {
          const onAbort = () => {
            this._worker.postMessage({ method: 'abort', args: { targetId: id } });
          };
          signal.addEventListener('abort', onAbort, { once: true });
          cleanup = () => signal.removeEventListener('abort', onAbort);
        }
      }

      this._pending.set(id, { resolve, reject, onProgress, cleanup });
      this._worker.postMessage({ id, method, args }, transfer);
    });
  }

  /**
   * Generic call method dispatching directly to the engine RPC.
   * @param {string} method
   * @param {any} [args]
   * @param {any} [options]
   * @returns {Promise<any>}
   */
  async call(method, args = {}, options = {}) {
    return await this._call(method, args, options);
  }

  /**
   * Loads vendor profiles. OrcaFilamentLibrary is automatically loaded first.
   * @param {string[]} [names=[]]
   * @returns {Promise<{ vendors: Array<{ name: string, printers: number, processes: number, filaments: number }> }>}
   */
  async loadVendors(names = []) {
    const vendorList = ['OrcaFilamentLibrary'];
    for (const name of names) {
      if (name && name !== 'OrcaFilamentLibrary' && !vendorList.includes(name)) {
        vendorList.push(name);
      }
    }
    return await this._call('loadVendors', { vendors: vendorList });
  }

  /**
   * Lists presets of the specified kind.
   * @param {'printer' | 'process' | 'filament'} kind
   * @param {{ compatibleOnly?: boolean }} [options={}]
   * @returns {Promise<PresetItem[]>}
   */
  async listPresets(kind, { compatibleOnly = true } = {}) {
    return await this._call('listPresets', { kind, compatibleOnly: !!compatibleOnly });
  }

  /**
   * Selects active presets for slicing.
   * @param {Object} selection
   * @param {string} selection.printer
   * @param {string} selection.process
   * @param {string|string[]} selection.filaments
   * @returns {Promise<{ printer: string, process: string, filaments: string[] }>}
   */
  async selectPresets({ printer, process, filaments }) {
    const filamentList = Array.isArray(filaments) ? filaments : filaments ? [filaments] : [];
    return await this._call('selectPresets', {
      printer,
      process,
      filaments: filamentList
    });
  }

  /**
   * Returns the merged configuration dictionary that slicing will use.
   * @returns {Promise<Record<string, string>>}
   */
  async getConfig() {
    return await this._call('getConfig', {});
  }

  /**
   * Returns option metadata definitions from Slic3r::print_config_def.
   * @param {string[]} [keys]
   * @returns {Promise<Record<string, any>>}
   */
  async getConfigDef(keys) {
    return await this._call('getConfigDef', keys ? { keys } : {});
  }

  /**
   * Evaluates GUI setting rules, visibility/enablement conditions, and proposed fixes.
   * @param {{ kind: 'print' | 'printer' | 'filament' | 'sla_print' | 'sla_material', filamentIndex?: number }} [options]
   * @returns {Promise<{ fields: Record<string, { enabled: boolean, visible: boolean, label?: string }>, fixes: Array<{ key: string, value: string, reason: string }>, messages: string[], context: any }>}
   */
  async evaluateRules(options = { kind: 'print' }) {
    return await this._call('evaluateRules', options);
  }

  /**
   * Sets option overrides on top of the selected presets.
   * @param {Record<string, string>} options
   * @returns {Promise<{ errors: Array<{ key: string, error: string }> }>}
   */
  async setOptions(options) {
    return await this._call('setOptions', { options });
  }

  /**
   * Resets all option overrides back to the preset defaults.
   * @returns {Promise<{}>}
   */
  async resetOptions() {
    return await this._call('resetOptions', {});
  }

  /**
   * Loads a 3D model into the engine, replacing any existing model.
   * @param {string} fileName
   * @param {Uint8Array|ArrayBuffer} bytes
   * @param {{ linearDeflection?: number, angleDeflection?: number }} [options] STEP tessellation settings
   * @returns {Promise<{ objects: Array<{ name: string, instances: number, volumes: number, size: [number, number, number] }> }>}
   */
  async loadModel(fileName, bytes, options = {}) {
    let payload = bytes;
    let transfer = [];

    if (bytes instanceof ArrayBuffer) {
      payload = new Uint8Array(bytes);
      transfer = [bytes];
    } else if (bytes && bytes.buffer instanceof ArrayBuffer) {
      payload = bytes;
      transfer = [bytes.buffer];
    }

    return await this._call('loadModel', { fileName, bytes: payload, ...options }, { transfer });
  }

  /**
   * Appends a 3D model to the plate.
   * @param {string} fileName
   * @param {Uint8Array|ArrayBuffer} bytes
   * @param {{ linearDeflection?: number, angleDeflection?: number }} [options] STEP tessellation settings
   * @returns {Promise<{ objects: Array<{ id: number, name: string, instances: number, volumes: number, size: [number, number, number] }> }>}
   */
  async addModel(fileName, bytes, options = {}) {
    let payload = bytes;
    let transfer = [];

    if (bytes instanceof ArrayBuffer) {
      payload = new Uint8Array(bytes);
      transfer = [bytes];
    } else if (bytes && bytes.buffer instanceof ArrayBuffer) {
      payload = bytes;
      transfer = [bytes.buffer];
    }

    return await this._call('addModel', { fileName, bytes: payload, ...options }, { transfer });
  }

  /**
   * Lists all objects and their instances on the plate.
   * @returns {Promise<Array<any>>}
   */
  async listObjects() {
    return await this._call('listObjects', {});
  }

  /**
   * Retrieves binary mesh data for an object.
   * @param {number} objectId
   * @returns {Promise<{ path: string, vertexCount: number, triangleCount: number, buffer: Uint8Array, volumes?: Array<{ volumeId: number, firstFacet: number, facetCount: number }> }>}
   */
  async getMesh(objectId) {
    return await this._call('getMesh', { objectId });
  }

  /**
   * Updates an instance transform and drops to bed.
   * @param {{ objectId: number, instanceId: number, offset?: [number, number, number], rotation?: [number, number, number], scale?: [number, number, number] | number }} params
   * @returns {Promise<{}>}
   */
  async setInstanceTransform(params) {
    return await this._call('setInstanceTransform', params);
  }

  /**
   * Deletes an object from the plate.
   * @param {number} objectId
   * @returns {Promise<{}>}
   */
  async deleteObject(objectId) {
    return await this._call('deleteObject', { objectId });
  }

  /**
   * Duplicates an instance of an object.
   * @param {number} objectId
   * @param {number} instanceId
   * @returns {Promise<{ instanceId: number, id: number }>}
   */
  async duplicateInstance(objectId, instanceId) {
    return await this._call('duplicateInstance', { objectId, instanceId });
  }

  /**
   * Centers the model on the print bed and arranges objects.
   * @param {{ useBed?: boolean }} [options={}]
   * @returns {Promise<{}>}
   */
  async arrange(options = {}) {
    return await this._call('arrange', options);
  }

  /**
   * Retrieves full object hierarchy with volumes, instances, ranges, and overrides.
   * @returns {Promise<{ objects: Array<any> }>}
   */
  async getObjectTree() {
    return await this._call("getObjectTree", {});
  }

  /**
   * Adds a volume (part, negative volume, modifier, support blocker/enforcer) to an object.
   * @param {{ objectId: number, type: string, shape: string, size?: number[] | number, offset?: number[], name?: string }} params
   * @returns {Promise<{ volumeId: number, id: number, name: string }>}
   */
  async addVolume(params) {
    return await this._call("addVolume", params);
  }

  /**
   * Deletes a volume from an object.
   * @param {number} objectId
   * @param {number} volumeId
   * @returns {Promise<{}>}
   */
  async deleteVolume(objectId, volumeId) {
    return await this._call("deleteVolume", { objectId, volumeId });
  }

  /**
   * Renames a model object.
   * @param {number} objectId
   * @param {string} name
   * @returns {Promise<{}>}
   */
  async renameObject(objectId, name) {
    return await this._call("renameObject", { objectId, name });
  }

  /**
   * Renames a volume of a model object.
   * @param {number} objectId
   * @param {number} volumeId
   * @param {string} name
   * @returns {Promise<{}>}
   */
  async renameVolume(objectId, volumeId, name) {
    return await this._call("renameVolume", { objectId, volumeId, name });
  }

  /**
   * Sets configuration option overrides on an object or volume.
   * @param {{ objectId: number, volumeId?: number, options: Record<string, string> }} params
   * @returns {Promise<{ errors: Array<{ key: string, error: string }> }>}
   */
  async setObjectConfig(params) {
    return await this._call("setObjectConfig", params);
  }

  /**
   * Resets configuration option overrides on an object or volume.
   * @param {{ objectId: number, volumeId?: number, keys?: string[] }} params
   * @returns {Promise<{}>}
   */
  async resetObjectConfig(params) {
    return await this._call("resetObjectConfig", params);
  }

  /**
   * Sets the extruder number for a volume.
   * @param {number} objectId
   * @param {number} volumeId
   * @param {number} extruder
   * @returns {Promise<{}>}
   */
  async setVolumeExtruder(objectId, volumeId, extruder) {
    return await this._call("setVolumeExtruder", { objectId, volumeId, extruder });
  }

  /**
   * Lists all plates and their assigned instances.
   * @returns {Promise<Array<any>>}
   */
  async listPlates() {
    return await this._call('listPlates', {});
  }

  /**
   * Adds a new plate.
   * @param {{ name?: string, config?: Record<string, string> }} [params={}]
   * @returns {Promise<Array<any>>}
   */
  async addPlate(params = {}) {
    return await this._call('addPlate', params);
  }

  /**
   * Deletes a plate by index.
   * @param {number} plateIndex
   * @param {boolean} [deleteObjects=false]
   * @returns {Promise<Array<any>>}
   */
  async deletePlate(plateIndex, deleteObjects = false) {
    return await this._call('deletePlate', { plateIndex, deleteObjects });
  }

  /**
   * Sets plate-specific configuration overrides or metadata.
   * @param {{ plateIndex: number, config?: Record<string, string>, name?: string, locked?: boolean }} params
   * @returns {Promise<{}>}
   */
  async setPlateConfig(params) {
    return await this._call('setPlateConfig', params);
  }

  /**
   * Retrieves support painting annotations for an object volume.
   * @param {number|{ objectId: number, volumeId?: number, volumeIndex?: number, facetIds?: number[] }} objectId
   * @param {number} [volumeId]
   * @returns {Promise<any>}
   */
  async getSupportPainting(objectId, volumeId) {
    const params = typeof objectId === 'object' ? objectId : { objectId, volumeId };
    return await this._call('getSupportPainting', params);
  }

  /**
   * Updates support painting (enforcer, blocker, clear) on an object volume.
   * @param {any} params
   * @returns {Promise<any>}
   */
  async setSupportPainting(params) {
    return await this._call('setSupportPainting', params);
  }

  /**
   * Clears all support painting annotations from an object volume.
   * @param {number|any} objectId
   * @param {number} [volumeId]
   * @returns {Promise<any>}
   */
  async clearSupportPainting(objectId, volumeId) {
    const params = typeof objectId === 'object' ? objectId : { objectId, volumeId };
    return await this._call('clearSupportPainting', params);
  }

  /**
   * Retrieves seam painting annotations for an object volume.
   * @param {number|{ objectId: number, volumeId?: number, volumeIndex?: number, facetIds?: number[] }} objectId
   * @param {number} [volumeId]
   * @returns {Promise<any>}
   */
  async getSeamPainting(objectId, volumeId) {
    const params = typeof objectId === 'object' ? objectId : { objectId, volumeId };
    return await this._call('getSeamPainting', params);
  }

  /**
   * Updates seam painting (enforcer, blocker, clear) on an object volume.
   * @param {any} params
   * @returns {Promise<any>}
   */
  async setSeamPainting(params) {
    return await this._call('setSeamPainting', params);
  }

  /**
   * Clears all seam painting annotations from an object volume.
   * @param {number|any} objectId
   * @param {number} [volumeId]
   * @returns {Promise<any>}
   */
  async clearSeamPainting(objectId, volumeId) {
    const params = typeof objectId === 'object' ? objectId : { objectId, volumeId };
    return await this._call('clearSeamPainting', params);
  }

  /**
   * Cuts a model object along a planar surface.
   * @param {any} params
   * @returns {Promise<any>}
   */
  async cutObject(params) {
    return await this._call('cutObject', params);
  }

  /**
   * Cuts a model object along a planar surface with connectors (plugs, dowels, or snaps).
   * @param {any} params
   * @returns {Promise<any>}
   */
  async cutObjectWithConnectors(params) {
    return await this._call('cutObjectWithConnectors', params);
  }

  /**
   * Evaluates mesh topology health and manifold integrity metrics.
   * @param {any} params
   * @returns {Promise<any>}
   */
  async getMeshHealth(params) {
    return await this._call('getMeshHealth', params);
  }

  /**
   * Alias for getMeshHealth.
   * @param {any} params
   * @returns {Promise<any>}
   */
  async checkMeshHealth(params) {
    return await this._call('checkMeshHealth', params);
  }

  /**
   * Repairs mesh topology using CGAL mesh repair.
   * @param {any} params
   * @returns {Promise<any>}
   */
  async repairObject(params) {
    return await this._call('repairObject', params);
  }

  /**
   * Alias for repairObject.
   * @param {any} params
   * @returns {Promise<any>}
   */
  async repairMesh(params) {
    return await this._call('repairMesh', params);
  }

  async paintStroke(params) { return await this._call('paintStroke', params); }
  async getPaintOverlay(params) { return await this._call('getPaintOverlay', params); }
  async getPaintData(params) { return await this._call('getPaintData', params); }
  async setPaintData(params) { return await this._call('setPaintData', params); }
  async clearPaint(params) { return await this._call('clearPaint', params); }

  async getLayerHeightProfile(params) { return await this._call('getLayerHeightProfile', params); }
  async setLayerHeightProfile(params) { return await this._call('setLayerHeightProfile', params); }
  async adaptiveLayerHeights(params) { return await this._call('adaptiveLayerHeights', params); }
  async smoothLayerHeights(params) { return await this._call('smoothLayerHeights', params); }
  async adjustLayerHeights(params) { return await this._call('adjustLayerHeights', params); }
  async resetLayerHeights(params) { return await this._call('resetLayerHeights', params); }
  async getObjectLayers(params) { return await this._call('getObjectLayers', params); }

  async addText(params) { return await this._call('addText', params); }
  async updateText(params) { return await this._call('updateText', params); }
  async getText(params) { return await this._call('getText', params); }
  async getLayerEvents(params = {}) { return await this._call('getLayerEvents', params); }
  async setLayerEvents(params) { return await this._call('setLayerEvents', params); }
  async clearLayerEvents(params = {}) { return await this._call('clearLayerEvents', params); }

  /**
   * Runs the slicing pipeline.
   * @param {SliceOptions} [options={}]
   * @returns {Promise<SliceResult>}
   */
  async slice(options = {}) {
    const defaultThreads = Math.min(
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4,
      8
    );
    const configuredThreads = (typeof options.threads === 'number' && options.threads > 0)
      ? options.threads
      : (typeof this._options?.threads === 'number' && this._options.threads > 0)
        ? this._options.threads
        : defaultThreads;
    const threads = Math.max(1, Math.floor(configuredThreads));
    const { onProgress, signal, plateIndex } = options;
    const outPath = options.outPath || (typeof plateIndex === 'number' ? `/out/plate_${plateIndex + 1}.gcode` : '/out/plate_1.gcode');
    const args = { threads, outPath };
    if (typeof plateIndex === 'number') {
      args.plateIndex = plateIndex;
    }
    return await this._call('slice', args, { onProgress, signal });
  }

  /**
   * Disposes of the engine and terminates the background Web Worker.
   */
  dispose() {
    try {
      this._call('dispose', {}).catch(() => {});
    } finally {
      this._worker.terminate();
    }
  }
}

export default OrcaEngine;
