/** Verify a running staging stack without contacting a printer. */
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
const base = new URL(process.argv[2] || 'http://127.0.0.1:8080');
const host = process.env.ORCA_HOST || 'weborca.noz.am';
function request(path, hostname = host) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const req = (url.protocol === 'https:' ? https : http).get(url, {
      headers: {Host: hostname},
      ...(url.protocol === 'https:' ? { servername: url.hostname } : {})
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Request timed out')));
  });
}
const previewAssets = new Map();
for (const path of ['/', '/calibration', '/engine/orca_engine.mjs', '/engine/orca_engine.wasm', '/engine/step/step_tessellate.mjs', '/engine/step/step_tessellate.wasm', '/engine-worker.js', '/step-worker.js', '/orca_preview.js', '/orca_preview.wasm', '/preview/orca_preview.js', '/preview/orca_preview.wasm', '/profiles/index.json', '/settings/layout.json']) {
  const res = await request(path);
  assert.equal(res.status, 200, path);
  assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin', path);
  assert.equal(res.headers['cross-origin-embedder-policy'], 'require-corp', path);
  if (path.endsWith('.wasm')) {
    assert.equal(res.headers['content-type'], 'application/wasm');
    assert.equal(res.body.subarray(0, 8).toString('hex'), '0061736d01000000', 'real WASM module');
  }
  if (path.endsWith('.json')) JSON.parse(res.body.toString());
  if (/\.(?:js|mjs)$/.test(path)) assert.match(res.headers['content-type'], /javascript/);
  if (/orca_preview\.(?:js|wasm)$/.test(path)) previewAssets.set(path, res.body);
  console.log(`${path}: OK`);
}
for (const file of ['orca_preview.js', 'orca_preview.wasm']) {
  assert.deepEqual(previewAssets.get(`/${file}`), previewAssets.get(`/preview/${file}`),
    `Matching preview aliases: ${file}`);
}
assert.equal((await request('/engine/missing.wasm')).status, 404);
assert.equal((await request('/', 'unapproved.example')).status, 421);
assert.equal((await request('/_printer/status')).status, 404, 'gateway runs separately');
console.log('Host restrictions, missing-asset 404 and separate gateway: OK');
