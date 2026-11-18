import test from 'node:test';
import assert from 'node:assert/strict';
import { embedderPolicy } from '../../deploy/coep.mjs';
test('conservative document and worker policy selection', () => {
  for (const ua of ['', 'Version/18.0 Safari/605.1.15', 'Firefox/140', 'Chrome/95.0', 'CriOS/140.0']) assert.equal(embedderPolicy('credentialless', ua), 'require-corp');
  assert.equal(embedderPolicy('credentialless', 'Chrome/130.0'), 'credentialless');
  assert.equal(embedderPolicy('require-corp', 'Chrome/130.0'), 'require-corp');
});
import { build } from '../../app/node_modules/esbuild/lib/main.js';
const relay = value => `/_model-thumbnail/v300?url=${encodeURIComponent(value)}`;
const image = 'https://makerworld.bblmw.com/makerworld/model/abc/design/def.png';
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36' } });
test('credentialless thumbnails require opt-in and isolation and retain exact CDN restrictions', async () => {
  for (const mode of ['require-corp', 'credentialless']) {
    const result = await build({ entryPoints: [new URL('../../app/src/models/sources.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, define: { 'import.meta.env.VITE_COEP': JSON.stringify(mode) } });
    const { directThumbnail } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    globalThis.crossOriginIsolated = false;
    assert.equal(directThumbnail(relay(image)), undefined);
    globalThis.crossOriginIsolated = true;
    assert.equal(directThumbnail(relay(image)), mode === 'credentialless' ? image + '?x-oss-process=image/resize,m_lfit,w_300,h_300/format,webp' : undefined);
    for (const bad of [image + '?x=1', image + '#x', image.replace('bblmw.com', 'bblmw.com.evil'), image.replace('/design/', '/private/'), image.replace('https:', 'http:'), image.replace('https://', 'https://user@')]) assert.equal(directThumbnail(relay(bad)), undefined);
  }
  delete globalThis.crossOriginIsolated;
});
