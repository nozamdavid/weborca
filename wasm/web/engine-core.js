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
 * @property {number} [threads] - Requested slicing concurrency; the generated loader controls worker preloading
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
    // Custom module factories may honor this hint. The bundled loader uses its link-time pool sizing expression.
    moduleOverrides.PTHREAD_POOL_SIZE = threads + 2;
  }

  const Module = await factory(moduleOverrides);

  if (!Module.FS) {
    throw new Error('Module.FS is not exported by WebAssembly module');
  }
  if (!Module.Engine) {
    throw new Error('Module.Engine is not exported by WebAssembly module');
  }

  // MEMFS grows a file over 1 MB by 12.5% at a time, copying it each time, so
  // writing a 130 MB G-code file copies about 1 GB. Grow by up to 32 MB at a time.
  const MEMFS = Module.FS.filesystems && Module.FS.filesystems.MEMFS;
  if (MEMFS && typeof MEMFS.expandFileStorage === 'function' && typeof MEMFS.getFileDataAsTypedArray === 'function') {
    MEMFS.expandFileStorage = (node, newCapacity) => {
      const prevCapacity = node.contents ? node.contents.length : 0;
      if (prevCapacity >= newCapacity) return;
      const step = prevCapacity < 1024 * 1024 ? prevCapacity : Math.min(prevCapacity, 32 * 1024 * 1024);
      const contents = new Uint8Array(Math.max(newCapacity, prevCapacity + step, 256));
      contents.set(MEMFS.getFileDataAsTypedArray(node));
      node.contents = contents;
    };
  }

  const engine = new Module.Engine();
  let initialized = false;
  let transactionTail = Promise.resolve();

  // Include MEMFS input writes and output reads in admission order. Native
  // serialization alone cannot protect files consumed after submit returns.
  function enqueue(transaction) {
    const result = transactionTail.then(transaction);
    transactionTail = result.catch(() => {});
    return result;
  }

  function checkAborted(signal) {
    if (signal?.aborted) {
      const error = new Error('canceled');
      error.name = 'AbortError';
      error.canceled = true;
      throw error;
    }
  }

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

  async function importFile(path, bytes, op, args = {}) {
    // Only wrapper scratch is ours to release. A file written by a caller at
    // this basename must survive both successful and rejected imports.
    const previous = Module.FS.analyzePath(path).exists ? readFile(path) : null;
    try {
      writeFile(path, bytes);
      return await runCall(op, { ...args, path });
    } finally {
      if (previous !== null) writeFile(path, previous);
      // Other formats can carry source/asset dependencies; retain their input
      // until those persistence contracts have equivalent coverage.
      else if ((op === 'loadStepMesh' || /\.(obj|stl)$/i.test(path)) && Module.FS.analyzePath(path).exists) Module.FS.unlink(path);
    }
  }

  /**
   * Submits a job to the engine and polls for the result without blocking.
   * Polling starts immediately and backs off to every 16ms, so quick ops
   * return in about a millisecond while long ones cost one check per frame.
   * @param {string} op
   * @param {Object|string} [args={}]
   * @param {Object} [callOptions={}]
   * @param {(progress: ProgressSnapshot) => void} [callOptions.onProgress]
   * @param {AbortSignal} [callOptions.signal]
   * @returns {Promise<any>}
   */
  function call(op, args = {}, callOptions = {}) {
    return enqueue(() => runCall(op, args, callOptions));
  }

  async function runCall(op, args = {}, { onProgress, signal } = {}) {
    checkAborted(signal);
    // Engine ops require init to have run once before other ops
    if (!initialized && op !== 'init') {
      await runCall('init', { resourcesDir: '/resources', dataDir: '/data' });
    }
    checkAborted(signal);

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

    return new Promise((resolve, reject) => {
      let lastProgressKey = null;
      let timerId = null;
      let pollDelay = 0;
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

      if (signal && op === 'slice') {
        onAbort = () => {
          try {
            engine.cancel();
          } catch (_) {}
        };
        signal.addEventListener('abort', onAbort, { once: true });
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
              if (op === 'init') initialized = true;
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

          pollDelay = pollDelay === 0 ? 1 : Math.min(pollDelay * 2, 16);
          timerId = setTimeout(pollTick, pollDelay);
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      timerId = setTimeout(pollTick, 0);
    });
  }

  /**
   * Runs the slicing pipeline.
   * @param {Object} [sliceOptions={}]
   * @returns {Promise<any>}
   */
  function slice(sliceOptions = {}) {
    return enqueue(() => runSlice(sliceOptions));
  }

  async function runSlice(sliceOptions) {
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
    const result = await runCall('slice', { ...sliceOptions, threads: resolvedThreads, outPath }, { onProgress, signal });
    const finalPath = sliceOptions.outPath || result?.gcodePath || outPath;
    const gcode = readFile(finalPath);
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
   * Imports through /models/<fileName>. Owned OBJ/STL scratch is released after consumption.
   * @param {string} fileName
   * @param {Uint8Array|ArrayBuffer|string} bytes
   * @returns {Promise<any>}
   */
  async function loadModel(fileName, bytes) {
    const base = fileName.split('/').pop().split('\\').pop();
    const dest = `/models/${base}`;
    return enqueue(() => importFile(dest, bytes, 'loadModel'));
  }

  /**
   * Appends through /models/<fileName>. Owned OBJ/STL scratch is released after consumption.
   * @param {string} fileName
   * @param {Uint8Array|ArrayBuffer|string} bytes
   * @returns {Promise<any>}
   */
  async function addModel(fileName, bytes) {
    const base = fileName.split('/').pop().split('\\').pop();
    const dest = `/models/${base}`;
    return enqueue(() => importFile(dest, bytes, 'addModel'));
  }

  /**
   * Writes the packed mesh of the STEP module (wasm/step) into
   * /models/<fileName>.stm and calls the loadStepMesh op, which reads and
   * deletes it. `replace` replaces the model like loadModel; otherwise the
   * objects are appended like addModel.
   * @param {string} fileName Name of the original STEP file
   * @param {Uint8Array|ArrayBuffer} packed
   * @param {{ replace?: boolean }} [options]
   * @returns {Promise<any>}
   */
  async function loadStepMesh(fileName, packed, options = {}) {
    const base = fileName.split('/').pop().split('\\').pop();
    const dest = `/models/${base}.stm`;
    return enqueue(() => importFile(dest, packed, 'loadStepMesh', { name: base, replace: !!options.replace }));
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
    addModel,
    loadStepMesh,
    dispose,
    FS: Module.FS,
    rawEngine: engine
  };
}

export default createEngineCore;
