import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEngineAssets } from '../../web/engine-assets.js';

const moduleUrl = 'https://app.example/engine/orca_engine.mjs';
function fixture({ total = '8', encoding = 'br', storageFails = false } = {}) {
  const entries = new Map(), requests = [];
  let version = 'a'.repeat(64), authorized = true;
  const storage = { async open() {
    if (storageFails) throw new Error('storage disabled');
    return { match: async key => entries.get(key)?.clone(), put: async (key, response) => {
      // CacheStorage consumes the body before committing it.
      const bytes = await response.arrayBuffer();
      entries.set(key, new Response(bytes, { headers: response.headers }));
    } };
  } };
  const fetch = async (input, options) => {
    requests.push({ url: String(input), method: options?.method || 'GET' });
    if (!authorized) return new Response(null, { status: 401 });
    const headers = { 'x-orca-engine-version': version, 'content-type': 'application/wasm', 'content-length': '3' };
    if (encoding) headers['content-encoding'] = encoding;
    if (total) headers['x-orca-decoded-length'] = total;
    if (options?.method === 'HEAD') return new Response(null, { headers });
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(5)); controller.close();
    } });
    return new Response(body, { headers });
  };
  const load = async () => {
    const progress = [];
    const assets = await prepareEngineAssets(moduleUrl, p => progress.push(p), { fetch, storage });
    const response = await assets.fetch(assets.wasmUrl);
    assert.equal((await response.arrayBuffer()).byteLength, 8);
    await assets.finish();
    return { progress, assets };
  };
  return { load, requests, entries, setVersion: v => { version = v; }, deny: () => { authorized = false; } };
}

test('warm startup reuses binary after a fresh authorization/version check; changed pair downloads again', async () => {
  const f = fixture();
  const cold = await f.load();
  assert.deepEqual(cold.progress.map(p => p.phase), ['checking', 'downloading', 'downloading', 'downloading', 'initializing']);
  assert.deepEqual(cold.progress.filter(p => p.phase === 'downloading').map(p => [p.loaded, p.total]), [[0, 8], [3, 8], [8, 8]]);
  const warm = await f.load();
  assert.deepEqual(warm.progress.map(p => p.phase), ['checking', 'cached', 'initializing']);
  assert.equal(f.requests.filter(r => r.method === 'GET').length, 1);
  assert.equal(f.requests.filter(r => r.method === 'HEAD').length, 2);
  f.setVersion('b'.repeat(64));
  await f.load();
  assert.equal(f.requests.filter(r => r.method === 'GET').length, 2);
  f.deny();
  await assert.rejects(f.load(), /Engine access failed: 401/);
  assert.equal(f.requests.filter(r => r.method === 'GET').length, 2);
});

test('compressed length never becomes a decoded total; unavailable storage still downloads', async () => {
  const f = fixture({ total: '', storageFails: true });
  const { progress } = await f.load();
  assert.ok(progress.filter(p => p.phase === 'downloading').every(p => p.total === undefined));
  await f.load();
  assert.equal(f.requests.filter(r => r.method === 'GET').length, 2);
});

test('truncated or oversized responses never enter persistent storage or initialization', async () => {
  for (const total of ['9', '7']) {
    const f = fixture({ total });
    await assert.rejects(f.load(), /Incomplete engine download/);
    assert.equal(f.entries.size, 0);
  }
});
