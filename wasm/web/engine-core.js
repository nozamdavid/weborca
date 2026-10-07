/**
 * @file engine-core.js
 * Low-level driver for the OrcaSlicer WebAssembly Engine Embind module.
 * Operates non-blockingly both in Node.js and inside Web Workers.
 */

/**
 * @typedef {Object} ProgressSnapshot
 * @property {number} jobId
 * @property {number} [percent]
 * @property {string} [text]
 */

/**
 * @typedef {Object} EngineCoreOptions
 * @property {Function} [moduleFactory] - The createOrcaEngine factory function
 * @property {Function} [locateFile] - Custom locateFile handler for Emscripten
 * @property {number} [threads] - Desired thread count
 */

/**
 * @typedef {Object} PackedBundle
 * @property {string} [vendor]
 * @property {string} [name]
 * @property {Record<string, string>} files
 */

/**
 * Creates and initializes an EngineCore instance.
 * @param {EngineCoreOptions} [options={}]
 * @returns {Promise<EngineCore>}
 */
export async function createEngineCore(options = {}) {
  const { moduleFactory, locateFile, threads } = options;

  let factory = moduleFactory;
  if (!factory) {
    if (typeof globalThis.createOrcaEngine === 'function') {
      factory = globalThis.createOrcaEngine;
    } else {
      throw new Error('createEngineCore requires a moduleFactory function');
    }
  }

  const moduleOverrides = {};
  if (typeof locateFile === 'function') {
    moduleOverrides.locateFile = locateFile;
  }
  if (typeof threads === 'number') {
    // 1 engine pthread + (threads - 1) TBB workers + 1 spare (matches min(hardwareConcurrency, 8) + 2 link default).
    moduleOverrides.PTHREAD_POOL_SIZE = threads + 2;
  }

  const Module = await factory(moduleOverrides);

  if (!Module.FS) {
    throw new Error('Module.FS is not exported by WebAssembly module');
  }
  if (!Module.Engine) {
    throw new Error('Module.Engine is not exported by WebAssembly module');
  }

  const engine = new Module.Engine();
  let initialized = false;

  /**
   * Recursively creates directories in MEMFS.
   * @param {string} dirPath
   */
  function mkdirp(dirPath) {
    if (!dirPath || dirPath === '/' || dirPath === '.') return;
    const parts = dirPath.split('/').filter(Boolean);
    let curr = dirPath.startsWith('/') ? '' : '.';
    for (const part of parts) {
      curr = curr ? `${curr}/${part}` : `/${part}`;
      try {
        if (Module.FS.analyzePath) {
          const stat = Module.FS.analyzePath(curr);
          if (stat && stat.exists) continue;
        }
        Module.FS.mkdir(curr);
      } catch (err) {
        // Ignore EEXIST or directory creation race conditions
      }
    }
  }

  // Ensure standard MEMFS directory layout exists
  mkdirp('/resources');
  mkdirp('/data');
  mkdirp('/data/system');
  mkdirp('/models');
  mkdirp('/out');

  /**
   * Writes content to a file in MEMFS, creating parent directories if needed.
   * @param {string} filePath
   * @param {string|Uint8Array|ArrayBuffer} data
   */
  function writeFile(filePath, data) {
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash > 0) {
      mkdirp(filePath.substring(0, lastSlash));
    }
    const content = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    Module.FS.writeFile(filePath, content);
  }

  /**
   * Reads a file from MEMFS as a Uint8Array.
   * @param {string} filePath
   * @returns {Uint8Array}
   */
  function readFile(filePath) {
    return Module.FS.readFile(filePath);
  }

  /**
   * Submits a job to the engine and polls for the result every 16ms without blocking.
   * @param {string} op
   * @param {Object|string} [args={}]
   * @param {Object} [callOptions={}]
   * @param {(progress: ProgressSnapshot) => void} [callOptions.onProgress]
   * @param {AbortSignal} [callOptions.signal]
   * @returns {Promise<any>}
   */
  async function call(op, args = {}, { onProgress, signal } = {}) {
    // Engine ops require init to have run once before other ops
    if (!initialized && op !== 'init') {
      await call('init', { resourcesDir: '/resources', dataDir: '/data' });
    }

    let effectiveArgs = args;
    if (op === 'slice') {
      const defaultThreads = Math.min(
        typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4,
        8
      );
      if (typeof args === 'object' && args !== null) {
        const configuredThreads = (typeof args.threads === 'number' && args.threads > 0)
          ? args.threads
          : (typeof threads === 'number' && threads > 0)
            ? threads
            : defaultThreads;
        effectiveArgs = { ...args, threads: Math.max(1, Math.floor(configuredThreads)) };
      }
    }

    const argsJson = typeof effectiveArgs === 'string' ? effectiveArgs : JSON.stringify(effectiveArgs || {});
    const jobId = engine.submit(op, argsJson);

    if (op === 'init') {
      initialized = true;
    }

    return new Promise((resolve, reject) => {
      let lastProgressKey = null;
      let timerId = null;
      let onAbort = null;

      const cleanup = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      if (signal) {
        if (signal.aborted) {
          try {
            engine.cancel();
          } catch (_) {}
        } else {
          onAbort = () => {
            try {
              engine.cancel();
            } catch (_) {}
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      const pollTick = () => {
        try {
          if (onProgress) {
            const progJson = engine.progress();
            if (progJson && progJson.length > 0) {
              const p = JSON.parse(progJson);
              if (p.jobId === jobId) {
                const key = `${p.percent}:${p.text}`;
                if (key !== lastProgressKey) {
                  lastProgressKey = key;
                  onProgress(p);
                }
              }
            }
          }

          const resJson = engine.poll(jobId);
          if (resJson && resJson.length > 0) {
            cleanup();
            const res = JSON.parse(resJson);
            if (res.ok) {
              resolve(res.result !== undefined ? res.result : {});
            } else {
              const err = new Error(res.error || 'Operation failed');
              if (res.canceled) {
                err.name = 'AbortError';
                /** @type {any} */ (err).canceled = true;
              }
              reject(err);
            }
            return;
          }

          timerId = setTimeout(pollTick, 16);
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      timerId = setTimeout(pollTick, 16);
    });
  }

  /**
   * Runs the slicing pipeline.
   * @param {Object} [sliceOptions={}]
   * @returns {Promise<any>}
   */
  async function slice(sliceOptions = {}) {
    const defaultThreads = Math.min(
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4,
      8
    );
    const configuredThreads = (typeof sliceOptions.threads === 'number' && sliceOptions.threads > 0)
      ? sliceOptions.threads
      : (typeof threads === 'number' && threads > 0)
        ? threads
        : defaultThreads;
    const resolvedThreads = Math.max(1, Math.floor(configuredThreads));
    const { onProgress, signal, outPath = '/out/plate_1.gcode' } = sliceOptions;
    const result = await call('slice', { ...sliceOptions, threads: resolvedThreads, outPath }, { onProgress, signal });
    const finalPath = sliceOptions.outPath || result?.gcodePath || outPath;
    let gcode;
    try {
      gcode = readFile(finalPath);
    } catch (_) {
      gcode = new Uint8Array(0);
    }
    return { ...result, gcode };
  }

  /**
   * Writes a packed bundle into MEMFS.
   * Vendor bundles are written under /data/system; resources bundles go under /resources.
   * @param {PackedBundle|string} bundle
   */
  async function addVendorBundle(bundle) {
    const b = typeof bundle === 'string' ? JSON.parse(bundle) : bundle;
    if (!b || !b.files || typeof b.files !== 'object') {
      throw new Error('Invalid bundle: missing files mapping');
    }

    const isResources =
      b.vendor === 'resources' ||
      b.name === 'resources' ||
      Object.keys(b.files).some((k) => k.startsWith('info/'));

    const baseDir = isResources ? '/resources' : '/data/system';

    for (const [relPath, content] of Object.entries(b.files)) {
      const cleanPath = relPath.startsWith('/') ? relPath.slice(1) : relPath;
      const targetPath = `${baseDir}/${cleanPath}`;
      writeFile(targetPath, content);
    }
  }

  /**
   * Writes a model file into /models/<fileName> and calls the loadModel op.
   * @param {string} fileName
   * @param {Uint8Array|ArrayBuffer|string} bytes
   * @returns {Promise<any>}
   */
  async function loadModel(fileName, bytes) {
    const base = fileName.split('/').pop().split('\\').pop();
    const dest = `/models/${base}`;
    writeFile(dest, bytes);
    return await call('loadModel', { path: dest });
  }

  /**
   * Releases the Embind Engine instance.
   */
  function dispose() {
    if (engine && typeof engine.delete === 'function') {
      engine.delete();
    }
  }

  return {
    mkdirp,
    writeFile,
    readFile,
    call,
    slice,
    addVendorBundle,
    loadModel,
    dispose,
    FS: Module.FS,
    rawEngine: engine
  };
}

export default createEngineCore;
