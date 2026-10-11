/** Verify a running staging stack without contacting a printer. */
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
const base = new URL(process.argv[2] || 'http://127.0.0.1:8080');
const host = process.env.ORCA_HOST || 'weborca.noz.am';
function request(path, hostname = host) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const req = (url.protocol === 'https:' ? https : http).get(url, {headers: {Host: hostname}}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Request timed out')));
  });
}
for (const path of ['/', '/calibration', '/engine/orca_engine.wasm', '/engine-worker.js', '/orca_preview.wasm', '/profiles/index.json', '/settings/layout.json']) {
  const res = await request(path);
  assert.equal(res.status, 200, path);
  assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin', path);
  assert.equal(res.headers['cross-origin-embedder-policy'], 'require-corp', path);
  if (path.endsWith('.wasm')) {
    assert.equal(res.headers['content-type'], 'application/wasm');
    assert.equal(res.body.subarray(0, 4).toString('hex'), '0061736d', 'real WASM bytes');
  }
  if (path.endsWith('.json')) JSON.parse(res.body.toString());
  if (path === '/engine-worker.js') assert.match(res.headers['content-type'], /javascript/);
  console.log(`${path}: OK`);
}
assert.equal((await request('/engine/missing.wasm')).status, 404);
assert.equal((await request('/', 'unapproved.example')).status, 421);
assert.equal((await request('/_printer/status')).status, 404, 'gateway runs separately');
console.log('Host restrictions, missing-asset 404 and separate gateway: OK');
