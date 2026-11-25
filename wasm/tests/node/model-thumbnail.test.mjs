import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { thumbnailUrl, createThumbnailHandler } from '../../deploy/model-thumbnail.mjs';
const url = 'https://makerworld.bblmw.com/makerworld/model/US123/design/abc.png';
const printablesUrl = 'https://media.printables.com/media/prints/12345/thumbs/inside/1280x960/jpg/coverimg2.webp';
test('thumbnail destination is restricted to public model raster images without queries', () => {
  assert.equal(thumbnailUrl(url), url);
  assert.equal(thumbnailUrl(printablesUrl), printablesUrl);
  for (const bad of [url.replace('https:', 'http:'), url.replace('bblmw.com', 'bblmw.com.evil.test'), url.replace('/model/', '/private/'), url.replace('.png', '.svg'), url + '?token=x', url + '#x', url.replace('https://', 'https://user@'), url.replace('.com/', '.com:444/')]) assert.throws(() => thumbnailUrl(bad));
  for (const bad of [printablesUrl.replace('media.printables.com', 'media.printables.com.evil.test'), printablesUrl.replace('/media/prints/', '/media/other/'), printablesUrl.replace('/12345/', '/../'), printablesUrl + '?q=1']) assert.throws(() => thumbnailUrl(bad));
});
test('handler bounds response, validates bytes and caches successful public PNG', async () => {
  let calls = 0;
  const png = readFileSync(new URL('./fixtures/thumbnail.png', import.meta.url));
  const handler = createThumbnailHandler(async (upstream, options) => { calls++; assert.equal(upstream, url + '?x-oss-process=image/resize,m_lfit,w_300,h_300/format,webp'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); return new Response(png, { headers: { 'content-type': 'image/png' } }); });
  const run = async handler => {
    const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = body; } };
    await handler({ method: 'GET', url: '/_model-thumbnail?url=' + encodeURIComponent(url) }, res); return res;
  };
  assert.equal((await run(handler)).status, 200); assert.equal((await run(handler)).status, 200); assert.equal(calls, 1);
  assert.equal((await run(createThumbnailHandler(async () => new Response(png, { headers: { 'content-type': 'image/jpeg' } })))).headers['Content-Type'], 'image/webp');
  for (const type of ['binary/octet-stream', 'application/octet-stream']) {
    assert.equal((await run(createThumbnailHandler(async () => new Response(png, { headers: { 'content-type': type } })))).headers['Content-Type'], 'image/webp');
    assert.equal((await run(createThumbnailHandler(async () => new Response('bad', { headers: { 'content-type': type } })))).status, 502);
  }
  for (const response of [() => new Response('bad', { headers: { 'content-type': 'image/png' } }), () => new Response(png, { headers: { 'content-type': 'text/html' } }), () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': '99999999' } }), () => new Response(null, { status: 302 }), () => new Response(new Uint8Array(24 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } })]) assert.equal((await run(createThumbnailHandler(async () => response()))).status, 502);
  let fetchedPrintables = '';
  const printablesHandler = createThumbnailHandler(async upstream => {
    fetchedPrintables = upstream;
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  });
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = body; } };
  await printablesHandler({ method: 'GET', url: '/_model-thumbnail?url=' + encodeURIComponent(printablesUrl) }, res);
  assert.equal(res.status, 200);
  assert.equal(fetchedPrintables, printablesUrl);
});
