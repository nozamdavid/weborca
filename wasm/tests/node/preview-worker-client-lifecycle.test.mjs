import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

// Preview worker client lifecycle against the real client and viewer module with a
// deferred fake Worker: replies move only when the test drives them. Each test
// starts from a dropped retained worker and counts instances relative to its start.
const appDir = new URL('../../app', import.meta.url).pathname;
const harness = `
    if (!globalThis.window) globalThis.window = globalThis;
    globalThis.requestAnimationFrame ??= () => 0;
    globalThis.cancelAnimationFrame ??= () => {};
    export class FakeWorker {
      static instances = [];
      static created = 0;
      sent = []; terminated = 0;
      constructor() { FakeWorker.instances.push(this); FakeWorker.created++; }
      postMessage(message, transfer) { this.sent.push({ message, transfer }); }
      terminate() { this.terminated++; }
      reply(id, stats, packet) { this.onmessage?.({ data: { id, stats, packet: packet.buffer } }); }
      fail(id, message) { this.onmessage?.({ data: { id, error: message } }); }
      failWorker(message) { this.onerror?.({ message }); }
    }`;
const native = `
    // The native runtime must never load in these tests; accidental use fails loudly.
    export default async function createOrcaPreview() { throw new Error('native preview runtime must not load in client lifecycle tests'); }
    export const parseGcode = () => { throw new Error('no main-thread parser fallback allowed'); };`;
const entry = `
    import { FakeWorker } from 'worker-fixture';
    globalThis.Worker = FakeWorker;
    export * as client from './src/preview/previewWorkerClient';
    export * as previewModule from './src/preview/orcaPreviewModule';
    export { FakeWorker } from 'worker-fixture';`;

let bundleUrl;

before(async () => {
  const result = await build({
    stdin: { contents: entry, resolveDir: appDir, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{
      name: 'preview-client-boundary',
      setup(b) {
        b.onResolve({ filter: /^worker-fixture$/ }, args => ({ path: args.path, namespace: 'fixture' }));
        b.onLoad({ filter: /^worker-fixture$/, namespace: 'fixture' }, () => ({ contents: harness, loader: 'js', resolveDir: appDir }));
        b.onResolve({ filter: /^\/(preview\/)?orca_preview\.(js|wasm)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: native, loader: 'js', resolveDir: appDir }));
      }
    }]
  });
  const { writeFile, mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const directory = await mkdtemp(join(tmpdir(), 'orca-preview-worker-client-'));
  const file = join(directory, 'client-lifecycle.mjs');
  await writeFile(file, result.outputFiles[0].text);
  bundleUrl = pathToFileURL(file).href;
});

const stack = () => import(bundleUrl);

const statsJSON = (layers) => ({ layers, moves: layers * 10, timeS: 100, filamentMm: 1.2, filamentG: 1.0, features: [] });

/** Reply to the most recent request the fake worker actually received. */
const respond = (worker, stats, packet) => {
  assert.ok(worker.sent.length, 'fake worker received a request');
  worker.reply(worker.sent.at(-1).message.id, stats, packet);
};

test('failure of one worker rejects its pending request and a replacement serves the next request', async () => {
  const { client, FakeWorker } = await stack();
  client.cancelPreviewWorker();
  const startInstances = FakeWorker.instances.length;
  const startCreated = FakeWorker.created;
  const bytes = new TextEncoder().encode('; gcode\n');
  const promiseA = client.preparePreview(bytes);
  promiseA.catch(() => {});
  FakeWorker.instances[startInstances].failWorker('Preview worker failed to load its module');
  await assert.rejects(promiseA, /failed to load its module/);
  const promiseB = client.preparePreview(bytes);
  assert.equal(FakeWorker.created - startCreated, 2, 'a rejected worker must be replaced, not reused');
  respond(FakeWorker.instances[startInstances + 1], statsJSON(3), new Uint8Array([1]));
  const result = await promiseB;
  assert.equal(result.stats.layers, 3);
});

test('a late error from a replaced worker must not terminate its replacement or reject new requests', async () => {
  const { client, FakeWorker } = await stack();
  client.cancelPreviewWorker();
  const startInstances = FakeWorker.instances.length;
  const startCreated = FakeWorker.created;
  const bytes = new TextEncoder().encode('; gcode\n');
  const dying = client.preparePreview(bytes);
  dying.catch(() => {});
  FakeWorker.instances[startInstances].failWorker('old worker dies late');
  await assert.rejects(dying, /old worker dies late/);
  const replacement = client.preparePreview(bytes);
  assert.equal(FakeWorker.created - startCreated, 2);
  const late = FakeWorker.instances[startInstances];
  late.failWorker('late onerror after replacement');
  late.reply(999, statsJSON(77), new Uint8Array([7]));
  assert.equal(FakeWorker.instances[startInstances + 1].terminated, 0, 'the replacement worker must survive');
  assert.equal(FakeWorker.created - startCreated, 2, 'no third worker may be spawned by the late failure');
  respond(FakeWorker.instances[startInstances + 1], statsJSON(5), new Uint8Array([5]));
  const replacementResult = await replacement;
  assert.equal(replacementResult.stats.layers, 5, 'replacement request must survive the old worker failure');
});

test('disposal rejects pending preparation; the later request runs on a fresh worker', async () => {
  const { client, previewModule, FakeWorker } = await stack();
  client.cancelPreviewWorker();
  const startInstances = FakeWorker.instances.length;
  const startCreated = FakeWorker.created;
  const bytes = new TextEncoder().encode('; gcode\n');
  const pending = client.preparePreview(bytes);
  pending.catch(() => {});
  previewModule.disposePreview();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(FakeWorker.instances[startInstances].terminated, 1, 'disposal terminates the current worker');
  const next = client.preparePreview(bytes);
  assert.equal(FakeWorker.created - startCreated, 2, 'a fresh worker serves the request after disposal');
  respond(FakeWorker.instances[startInstances + 1], statsJSON(9), new Uint8Array([9]));
  const result = await next;
  assert.equal(result.stats.layers, 9);
});

test('an undecodable response rejects every pending request and allows recovery', async () => {
  const { client, FakeWorker } = await stack();
  client.cancelPreviewWorker();
  const first = client.preparePreview(new Uint8Array([1]));
  const second = client.preparePreview(new Uint8Array([2]));
  const rejected = Promise.all([
    assert.rejects(first, /could not be decoded/),
    assert.rejects(second, /could not be decoded/)
  ]);
  FakeWorker.instances.at(-1).onmessageerror();
  await rejected;
  const recovered = client.preparePreview(new Uint8Array([3]));
  respond(FakeWorker.instances.at(-1), statsJSON(3), new Uint8Array([3]));
  assert.equal((await recovered).stats.layers, 3);
});
