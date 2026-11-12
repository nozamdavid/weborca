import type { PreviewStatistics } from './types';

type PreparedPreview = { stats: PreviewStatistics; packet: Uint8Array };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (value: PreparedPreview) => void; reject: (error: Error) => void }>();

export function cancelPreviewWorker(): void {
  const stopping = worker;
  worker = null;
  stopping?.terminate();
  const error = new Error('Preview preparation canceled');
  error.name = 'AbortError';
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  // Handlers capture their own instance: another import, cancellation or disposal
  // can create a replacement while old callbacks are still reachable, and a late
  // reply or failure of a terminated worker must not affect the replacement.
  const created = new Worker(new URL('./previewWorker.ts', import.meta.url), { type: 'module' });
  created.onmessage = ({ data }) => {
    if (created !== worker) return;
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve({ stats: data.stats, packet: new Uint8Array(data.packet) });
  };
  const fail = (message: string) => {
    if (created !== worker) return;
    worker = null;
    created.terminate();
    const error = new Error(message);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  created.onerror = event => fail(event.message || 'Preview worker failed');
  created.onmessageerror = () => fail('Preview worker response could not be decoded');
  worker = created;
  return created;
}

export function preparePreview(bytes: Uint8Array): Promise<PreparedPreview> {
  const target = ensureWorker();
  const id = ++nextId;
  const copy = bytes.slice().buffer;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try { target.postMessage({ id, bytes: copy }, [copy]); }
    catch (error) { pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
  });
}
