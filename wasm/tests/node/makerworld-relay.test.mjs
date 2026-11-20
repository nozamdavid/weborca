import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { makerWorldDestination, modelByteLimiter, handleBambuCloudApi } from '../../app/gateway/bambuCloud.ts';

test('normal relay streams bytes with fresh CDN headers and rejects redirects', async t => {
  let status = 200;
  t.mock.method(https, 'get', (url, options, callback) => {
    assert.equal(url.hostname, 'makerworld.bblmw.com');
    assert.deepEqual(options.headers, { accept: 'application/octet-stream' });
    const request = new EventEmitter();
    queueMicrotask(() => {
      const response = Readable.from([Buffer.from([80, 75, 3, 4]), Buffer.from('fixture')]);
      response.statusCode = status;
      response.headers = { 'content-length': '11' };
      callback(response);
    });
    return request;
  });
  syncBuiltinESMExports();
  const server = http.createServer((req, res) => void handleBambuCloudApi(req, res,
    '/v1/design-service/model-bytes', { cloud: 'bambu-cloud' }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const request = () => fetch(`http://127.0.0.1:${server.address().port}`, { method: 'POST',
      headers: { authorization: 'Bearer fixture', cookie: 'fixture=private' },
      body: JSON.stringify({ url: 'https://makerworld.bblmw.com/makerworld/model/US123/design/a.3mf?signature=fixture' }) });
    const response = await request();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-length'), '11');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...Buffer.from([80, 75, 3, 4]), ...Buffer.from('fixture')]);
    status = 302;
    assert.equal((await request()).status, 502);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('MakerWorld destination accepts only observed HTTPS model paths', () => {
  const good = 'https://makerworld.bblmw.com/makerworld/model/US123/design/profile.3mf?signature=fixture';
  assert.equal(makerWorldDestination(good).href, good);
  for (const bad of [good.replace('https:', 'http:'), good.replace('.com/', '.com:444/'),
    good.replace('makerworld.bblmw.com', 'makerworld.bblmw.com.evil.test'),
    good.replace('https://', 'https://user@'), good + '#fragment',
    good.replace('/makerworld/model/', '/other/'), good.replace('.3mf?', '.stl?'),
    good.replace('profile.3mf', '%2e%2e/profile.3mf')]) {
    assert.throws(() => makerWorldDestination(bad));
  }
});

test('stream size bound applies without Content-Length and preserves normal bytes', async () => {
  const chunks = [];
  await pipeline(Readable.from([Buffer.from('PK'), Buffer.from('fixture')]), modelByteLimiter(9),
    new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); done(); } }));
  assert.equal(Buffer.concat(chunks).toString(), 'PKfixture');
  await assert.rejects(pipeline(Readable.from([Buffer.alloc(5), Buffer.alloc(5)]), modelByteLimiter(9),
    new Writable({ write(_chunk, _encoding, done) { done(); } })), /size limit/);
});
