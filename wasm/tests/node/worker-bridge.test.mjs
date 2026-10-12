import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import fs from 'node:fs';
import vm from 'node:vm';
import OrcaEngine from '../../web/orca-engine.js';

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
    .replace('let core = null;', 'let core = injectedCore;');
  const context = { injectedCore: core, self: {}, Uint8Array, postMessage: reply };
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
