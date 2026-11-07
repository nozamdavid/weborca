/**
 * @file stepModule.ts
 * Client for the lazily loaded STEP tessellation module (wasm/step).
 *
 * The main engine is built without OpenCASCADE. STEP files are tessellated in a
 * dedicated worker that loads engine/step/step_tessellate.{mjs,wasm} on first
 * use and is terminated after every import, which frees the module's memory.
 * Terminating the worker is also how an import is cancelled.
 */

import type { StepImportOptions } from './types';

const STEP_WORKER_URL = '/step-worker.js';
const STEP_MODULE_URL = '/engine/step/step_tessellate.mjs';
const STEP_WASM_URL = '/engine/step/step_tessellate.wasm';

const DEFAULT_LINEAR_DEFLECTION = 0.003;
const DEFAULT_ANGLE_DEFLECTION = 0.5;

export function isStepFileName(name: string): boolean {
  return /\.(step|stp)$/i.test(name);
}

interface ActiveRun {
  worker: Worker;
  reject: (error: Error) => void;
}

let activeRun: ActiveRun | null = null;

/** Cancels the running tessellation by terminating its worker; the import rejects. */
export function cancelStepTessellation(): void {
  activeRun?.reject(new DOMException('STEP import canceled', 'AbortError'));
}

function positiveFinite(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (typeof resolved !== 'number' || !Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return resolved;
}

/**
 * Tessellates a STEP file in a fresh worker and resolves with the packed "STM1"
 * mesh (see wasm/step/main.cpp). The deflections must be positive and finite;
 * the module enforces the same bounds.
 */
export function tessellateStep(
  bytes: Uint8Array | ArrayBuffer,
  options: StepImportOptions = {},
  signal?: AbortSignal
): Promise<Uint8Array> {
  const linearDeflection = positiveFinite(options.linearDeflection, DEFAULT_LINEAR_DEFLECTION, 'linear_deflection');
  const angleDeflection = positiveFinite(options.angleDeflection, DEFAULT_ANGLE_DEFLECTION, 'angle_deflection');
  if (signal?.aborted) return Promise.reject(new DOMException('STEP import canceled', 'AbortError'));
  if (activeRun) return Promise.reject(new Error('Another STEP import is already running'));

  return new Promise<Uint8Array>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(STEP_WORKER_URL, { type: 'module' });
    } catch (err) {
      reject(new Error(`STEP module failed to load: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }

    const finish = () => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      if (activeRun?.worker === worker) activeRun = null;
    };
    const fail = (error: Error) => { finish(); reject(error); };
    const onAbort = () => fail(new DOMException('STEP import canceled', 'AbortError'));

    activeRun = { worker, reject: fail };
    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.ok && data.packed) {
        finish();
        resolve(data.packed as Uint8Array);
      } else {
        fail(new Error(data?.error || 'STEP tessellation failed'));
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      fail(new Error(`STEP module failed to load${event.message ? `: ${event.message}` : ''}. Check your connection and try again.`));
    };
    worker.onmessageerror = () => fail(new Error('STEP module returned an unreadable result'));

    // Copy so the caller's buffer survives (transferring would detach it).
    const input = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
    worker.postMessage(
      { moduleUrl: STEP_MODULE_URL, bytes: input, linearDeflection, angleDeflection, splitCompound: false },
      [input.buffer]
    );
  });
}

let prefetched = false;

/** Warms the HTTP cache with the module files so the first STEP import does not wait for the download. */
export function prefetchStepModule(): void {
  if (prefetched) return;
  prefetched = true;
  for (const url of [STEP_MODULE_URL, STEP_WASM_URL]) {
    fetch(url, { priority: 'low' } as RequestInit).catch(() => { prefetched = false; });
  }
}

/**
 * Prefetches the STEP module when the browser is idle, unless the user asked
 * for reduced data use. Call once the engine is ready.
 */
export function scheduleStepModulePrefetch(): void {
  if (typeof window === 'undefined' || prefetched) return;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  const run = () => prefetchStepModule();
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === 'function') idle.call(window, run, { timeout: 10_000 });
  else window.setTimeout(run, 3000);
}
