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
const printablesImage = 'https://media.printables.com/media/prints/12345/thumbs/inside/1280x960/jpg/coverimg2.webp';
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36' } });
test('credentialless thumbnails require opt-in and isolation and retain exact CDN restrictions', async () => {
  for (const mode of ['require-corp', 'credentialless']) {
    const result = await build({ entryPoints: [new URL('../../app/src/models/sources.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, define: { 'import.meta.env.VITE_COEP': JSON.stringify(mode) } });
    const { directThumbnail, preloadModelThumbnails } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    globalThis.crossOriginIsolated = false;
    assert.equal(directThumbnail(relay(image)), undefined);
    assert.equal(directThumbnail(relay(printablesImage)), undefined);
    globalThis.crossOriginIsolated = true;
    assert.equal(directThumbnail(relay(image)), mode === 'credentialless' ? image + '?x-oss-process=image/resize,m_lfit,w_300,h_300/format,webp' : undefined);
    assert.equal(directThumbnail(relay(printablesImage)), mode === 'credentialless' ? printablesImage : undefined);
    const images = [];
    const previousImage = globalThis.Image;
    globalThis.Image = class { constructor() { images.push(this); } };
    try {
      preloadModelThumbnails([{ thumbnail: relay(image) }]);
      assert.equal(images[0].src, directThumbnail(relay(image)) || relay(image));
      images[0].onerror();
      assert.equal(images[0].src, relay(image));
      preloadModelThumbnails([{ thumbnail: relay(image) }]);
      images[1].naturalWidth = 301;
      images[1].onload();
      assert.equal(images[1].src, relay(image));
      preloadModelThumbnails([{ thumbnail: relay(printablesImage) }]);
      assert.equal(images[2].src, directThumbnail(relay(printablesImage)) || relay(printablesImage));
      images[2].naturalWidth = 1280;
      images[2].onload();
      assert.equal(images[2].src, directThumbnail(relay(printablesImage)) || relay(printablesImage));
      images[2].onerror();
      assert.equal(images[2].src, relay(printablesImage));
    } finally { if (previousImage) globalThis.Image = previousImage; else delete globalThis.Image; }
    for (const bad of [image + '?x=1', image + '#x', image.replace('bblmw.com', 'bblmw.com.evil'), image.replace('/design/', '/private/'), image.replace('https:', 'http:'), image.replace('https://', 'https://user@')]) assert.equal(directThumbnail(relay(bad)), undefined);
    for (const bad of [printablesImage + '?x=1', printablesImage + '#x', printablesImage.replace('/prints/12345/', '/prints/12345/../../'), printablesImage.replace('media.printables.com', 'media.printables.com.evil'), printablesImage.replace('/media/prints/', '/media/other/'), printablesImage.replace('https:', 'http:'), printablesImage.replace('https://', 'https://user@')]) assert.equal(directThumbnail(relay(bad)), undefined);
  }
  delete globalThis.crossOriginIsolated;
});
