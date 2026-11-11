import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import fs from 'node:fs';
import vm from 'node:vm';
import OrcaEngine from '../../web/orca-engine.js';
import { createEngineCore } from '../../web/engine-core.js';
import { prepareEngineAssets } from '../../web/engine-assets.js';

function fakeWorker() {
  return {
    messages: [], terminated: 0,
    postMessage(message) { this.messages.push(message); },
    terminate() { this.terminated++; }
  };
}

function workerDispatcher(core, reply) {
  const source = fs.readFileSync(new URL('../../web/engine-worker.js', import.meta.url), 'utf8')
    .replace("import { createEngineCore } from './engine-core.js';", '')
    .replace("import { prepareEngineAssets } from './engine-assets.js';", '')
    .replace('let core = null;', 'let core = injectedCore;');
  const context = { injectedCore: core, prepareEngineAssets, self: {}, Uint8Array, AbortController, postMessage: reply };
  vm.runInNewContext(source, context);
  return context.self.onmessage;
}

test('writeFile transfers a byte subview without another worker allocation', async () => {
  const backing = new Uint8Array([90, 91, 12, 13, 14, 92]);
  const view = backing.subarray(2, 5);
  let received;
  const dispatch = workerDispatcher({ writeFile(path, bytes) {
    assert.equal(path, '/models/subview.bin');
    assert.strictEqual(bytes, received.args.bytes);
    assert.equal(bytes.byteOffset, 2);
    assert.equal(bytes.buffer.byteLength, 6);
    assert.deepEqual([...bytes], [12, 13, 14]);
  } }, message => worker.onmessage({ data: message }));
  const worker = fakeWorker();
  worker.postMessage = (message, transfer) => {
    received = structuredClone(message, { transfer });
    void dispatch({ data: received });
  };
  const engine = new OrcaEngine(worker, {});
  await engine.writeFile('/models/subview.bin', view);
  assert.equal(backing.buffer.byteLength, 0, 'Public writeFile transfers ownership');
  engine.dispose();
});

// Delayed native consumption exposes writes made before a queued import executes.
async function delayedCore() {
  const files = new Map(), jobs = [], results = new Map(), nativeQueue = [], readableAt = new Map();
  let nextId = 0, active = null, canceled = null;
  function startNext() {
    if (active !== null || !nativeQueue.length) return;
    nativeQueue.shift()();
  }
  class Engine {
    submit(op, json) {
      const id = ++nextId, args = JSON.parse(json);
      jobs.push({ op, args });
      readableAt.set(id, Date.now() + 35);
      nativeQueue.push(() => {
        active = id;
        setTimeout(() => {
          let result = {};
          if (op === 'loadModel' || op === 'addModel' || op === 'loadStepMesh') {
            result = { bytes: [...files.get(args.path)], name: args.name || args.path.split('/').pop() };
            if (op === 'loadStepMesh') files.delete(args.path);
          }
          if (op === 'slice') {
            if (args.marker !== -1) files.set(args.outPath, new Uint8Array([args.marker || 1]));
            result = { gcodePath: args.outPath };
          }
          results.set(id, JSON.stringify(id === canceled
            ? { ok: false, canceled: true, error: 'canceled' } : { ok: true, result }));
          active = null;
          startNext();
        }, 10);
      });
      startNext();
      return id;
    }
    poll(id) {
      if (Date.now() < readableAt.get(id)) return '';
      const result = results.get(id); results.delete(id); return result || '';
    }
    progress() { return ''; }
    cancel() { canceled = active; }
    delete() {}
  }
  const core = await createEngineCore({ moduleFactory: async () => ({ Engine, FS: {
    analyzePath(path) { return { exists: files.has(path) }; }, unlink(path) { files.delete(path); },
    mkdir() {}, writeFile(path, bytes) { files.set(path, bytes.slice()); },
    readFile(path) { if (!files.has(path)) throw new Error('missing output'); return files.get(path).slice(); }
  } }) });
  await core.call('init');
  return { core, jobs };
}

test('overlapping imports with the same filename retain each request\'s geometry and operation order', async () => {
  const { core, jobs } = await delayedCore();
  const dispatch = workerDispatcher(core, message => replies.push(message));
  const replies = [];
  await Promise.all([
    dispatch({ data: { id: 1, method: 'loadModel', args: { fileName: 'same.obj', bytes: new Uint8Array([1]) } } }),
    dispatch({ data: { id: 2, method: 'setOptions', args: { options: { layer_height: '0.3' } } } }),
    dispatch({ data: { id: 3, method: 'addModel', args: { fileName: 'same.obj', bytes: new Uint8Array([2]) } } })
  ]);
  assert.deepEqual(replies.map(x => x.result.bytes).filter(Boolean), [[1], [2]]);
  assert.deepEqual(replies.filter(x => x.result.name).map(x => x.result.name), ['same.obj', 'same.obj']);
  assert.deepEqual(jobs.slice(1).map(x => x.op), ['loadModel', 'setOptions', 'addModel']);
  const packed = await Promise.all([core.loadStepMesh('same.step', new Uint8Array([3])), core.loadStepMesh('same.step', new Uint8Array([4]))]);
  assert.deepEqual(packed.map(x => x.bytes), [[3], [4]]);
  assert.deepEqual(packed.map(x => x.name), ['same.step', 'same.step']);
  core.dispose();
});

test('aborting a queued slice leaves the active slice running and prevents the queued slice from starting', async () => {
  const { core, jobs } = await delayedCore();
  const replies = [];
  const dispatch = workerDispatcher(core, message => replies.push(message));
  const a = dispatch({ data: { id: 1, method: 'slice', args: { marker: 1 } } });
  await new Promise(resolve => setTimeout(resolve, 2));
  const b = dispatch({ data: { id: 2, method: 'slice', args: { marker: 2 } } });
  const config = dispatch({ data: { id: 3, method: 'getConfig' } });
  await dispatch({ data: { method: 'abort', args: { targetId: 2 } } });
  await Promise.all([a, b, config]);
  assert.equal(replies.find(x => x.id === 1 && x.ok)?.result.gcode[0], 1);
  assert.equal(replies.find(x => x.id === 2)?.canceled, true);
  assert.deepEqual(jobs.slice(1).map(x => x.op), ['slice', 'getConfig']);
  const controller = new AbortController();
  const active = core.slice({ signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 2));
  controller.abort();
  await assert.rejects(active, error => error.name === 'AbortError');
  core.dispose();
});

test('overlapping slices snapshot shared-path G-code before starting the next slice', async () => {
  const { core } = await delayedCore();
  const results = await Promise.all([core.slice({ marker: 5 }), core.slice({ marker: 9 })]);
  assert.deepEqual(results.map(x => [...x.gcode]), [[5], [9]]);
  await assert.rejects(core.slice({ marker: -1, outPath: '/out/missing.gcode' }), /missing output/);
  core.dispose();
});

test('overlapping public packed STEP imports transfer bytes as one transaction per request', async () => {
  const { core } = await delayedCore();
  const worker = fakeWorker();
  const dispatch = workerDispatcher(core, message => worker.onmessage({ data: message }));
  worker.postMessage = (message, transfer) => {
    void dispatch({ data: structuredClone(message, { transfer }) });
  };
  const engine = new OrcaEngine(worker, {});
  const a = new Uint8Array([7]), b = new Uint8Array([8]);
  const results = await Promise.all([engine.loadStepMesh('same.step', a, { replace: true }), engine.loadStepMesh('same.step', b)]);
  assert.deepEqual(results.map(x => x.bytes), [[7], [8]]);
  assert.deepEqual(results.map(x => x.name), ['same.step', 'same.step']);
  assert.equal(a.byteLength, 0);
  assert.equal(b.byteLength, 0);
  engine.dispose();
  core.dispose();
});

test('worker writeFile converts a raw ArrayBuffer to a byte view', async () => {
  const buffer = new Uint8Array([7, 8, 9]).buffer;
  let reply;
  const dispatch = workerDispatcher({ writeFile(path, bytes) {
    assert.equal(path, '/models/raw.bin');
    assert.ok(bytes instanceof Uint8Array);
    assert.strictEqual(bytes.buffer, buffer);
    assert.deepEqual([...bytes], [7, 8, 9]);
  } }, message => { reply = message; });
  await dispatch({ data: { id: 1, method: 'writeFile', args: { path: '/models/raw.bin', bytes: buffer } } });
  assert.equal(reply.ok, true, reply.error);
});

test('dispose rejects outstanding calls and removes abort listeners', async () => {
  const worker = fakeWorker();
  const engine = new OrcaEngine(worker, {});
  const controller = new AbortController();
  const pending = [engine.slice({ signal: controller.signal }), engine.call('getConfig', {})];
  const outcomes = Promise.all(pending.map(promise => promise.then(() => 'resolved', error => error.message)));
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  engine.dispose();
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(worker.terminated, 1);
  assert.deepEqual(worker.messages.map(message => message.method), ['slice', 'getConfig']);
  assert.deepEqual(await outcomes, ['Engine has been disposed', 'Engine has been disposed']);
  controller.abort();
  assert.equal(worker.messages.length, 2);
});

test('dispose is idempotent and subsequent calls reject without enqueueing', async () => {
  const worker = fakeWorker();
  const engine = new OrcaEngine(worker, {});
  engine.dispose();
  engine.dispose();
  assert.equal(worker.terminated, 1);
  await assert.rejects(engine.call('getConfig', {}), /disposed/);
  assert.equal(worker.messages.length, 0);
});

test('already aborted slice rejects without posting abort or slice', async () => {
  const worker = fakeWorker();
  const engine = new OrcaEngine(worker, {});
  const controller = new AbortController();
  controller.abort();
  const promise = engine.slice({ signal: controller.signal });
  assert.equal(worker.messages.length, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  await assert.rejects(promise, error => error.name === 'AbortError' && error.canceled === true);
  engine.dispose();
});

test('in-flight cancellation still posts abort and rejects from the worker reply', async () => {
  const worker = fakeWorker();
  const engine = new OrcaEngine(worker, {});
  const controller = new AbortController();
  const promise = engine.slice({ signal: controller.signal });
  controller.abort();
  assert.deepEqual(worker.messages.map(message => message.method), ['slice', 'abort']);
  assert.equal(worker.messages[1].args.targetId, worker.messages[0].id);
  worker.onmessage({ data: { id: worker.messages[0].id, ok: false, canceled: true, error: 'canceled' } });
  await assert.rejects(promise, error => error.name === 'AbortError' && error.canceled === true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  engine.dispose();
});

test('a synchronous postMessage failure releases pending calls and abort listeners', async () => {
  const worker = fakeWorker();
  const failure = new DOMException('Invalid transferable', 'DataCloneError');
  worker.postMessage = () => { throw failure; };
  const engine = new OrcaEngine(worker, {});
  const controller = new AbortController();
  await assert.rejects(engine.slice({ signal: controller.signal }), error => error === failure);
  assert.equal(engine._pending.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  controller.abort();
  engine.dispose();
});
