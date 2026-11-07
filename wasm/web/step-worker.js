/**
 * @file step-worker.js
 * One-shot Web Worker around the lazily loaded STEP tessellation module
 * (wasm/step, served as engine/step/step_tessellate.{mjs,wasm}).
 *
 * The page posts a single message
 *   { moduleUrl, bytes, linearDeflection, angleDeflection, splitCompound }
 * and gets back either
 *   { ok: true, packed }   // "STM1" packed mesh, see wasm/step/main.cpp
 *   { ok: false, error }
 * The page terminates the worker afterwards, which releases the module's
 * linear memory; cancellation is terminating it early.
 */

function moduleFailure(stage, err) {
  const detail = (err instanceof Error ? err.message : String(err)).replace(/\.?\s*Build with -sASSERTIONS for more info\.?/, '');
  return new Error(`STEP module failed to ${stage}: ${detail}. Check your connection and try again.`);
}

self.onmessage = async (event) => {
  const { moduleUrl, bytes, linearDeflection, angleDeflection, splitCompound } = event.data || {};
  try {
    const absModuleUrl = new URL(moduleUrl, self.location.href).href;
    let createModule;
    try {
      createModule = (await import(absModuleUrl)).default;
    } catch (err) {
      throw moduleFailure('load', err);
    }
    let stepModule;
    try {
      stepModule = await createModule({
        locateFile: (path) => new URL(path, absModuleUrl).href
      });
    } catch (err) {
      throw moduleFailure('start', err);
    }

    stepModule.FS.writeFile('/in.step', bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const error = stepModule.step_tessellate_to_file(
      '/in.step',
      Number(linearDeflection),
      Number(angleDeflection),
      !!splitCompound,
      '/out.bin'
    );
    if (error) throw new Error(error);

    const packed = stepModule.FS.readFile('/out.bin');
    postMessage({ ok: true, packed }, [packed.buffer]);
  } catch (err) {
    postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
