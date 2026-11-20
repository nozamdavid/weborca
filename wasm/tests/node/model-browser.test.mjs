import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
const result = await build({ entryPoints: [new URL('../../app/src/models/sources.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { fetchModels, fetchStats, fetchModel, createCatalogPageLoader, preloadModelThumbnails, CatalogError, CATALOG_ENDPOINT } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const sample = JSON.parse(readFileSync(new URL('./fixtures/model-catalog.json', import.meta.url)));
const respond = body => async () => ({ ok: true, json: async () => body });
test('page cache shares pending foreground requests and separates criteria and page sizes', async t => {
  const calls = [];
  let finish;
  t.mock.method(globalThis, 'fetch', url => { calls.push(url); return new Promise(resolve => { finish = () => resolve({ ok: true, json: async () => sample }); }); });
  const load = createCatalogPageLoader();
  const query = { page: 2, pageSize: 24, q: 'cat', sort: 'newest' };
  const prefetched = load(query);
  assert.equal(load({ sort: 'newest', q: 'cat', pageSize: 24, page: 2 }), prefetched);
  finish();
  const page = await prefetched;
  assert.equal(await load(query), page);
  assert.equal(calls.length, 1);
  for (const patch of [{ page: 3 }, { pageSize: 25 }, { q: 'dog' }, { sort: 'likes' }]) {
    const pending = load({ ...query, ...patch }); finish(); await pending;
  }
  assert.equal(calls.length, 5);
});
test('failed prefetch can be retried', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const load = createCatalogPageLoader();
  await assert.rejects(load({ page: 2 }), /offline/);
  fetch.mock.mockImplementation(respond(sample));
  assert.equal((await load({ page: 2 })).items.length, 1);
  assert.equal(fetch.mock.callCount(), 2);
});
test('thumbnail preloading uses relay cards paths and only the first ten models', t => {
  const images = [];
  const previous = globalThis.Image;
  globalThis.Image = class { constructor() { images.push(this); } };
  t.after(() => { if (previous) globalThis.Image = previous; else delete globalThis.Image; });
  const models = Array.from({ length: 12 }, (_, i) => ({ thumbnail: i === 0 ? undefined : `/_model-thumbnail/v300?url=${i}` }));
  preloadModelThumbnails(models);
  assert.equal(images.length, 9);
  assert.deepEqual(images.map(image => image.src), models.slice(1, 10).map(model => model.thumbnail));
  assert.ok(images.every(image => image.referrerPolicy === 'no-referrer'));
});
test('query transport preserves server filter and pagination semantics', async t => {
  const signal = new AbortController().signal;
  const params = { q: 'cat & book', formats: ['stl', '3mf'], category: 'Household', subcategory: 'Decor', author: 'RoyalGreen', license: 'BY-NC', minLikes: 0, maxLikes: 200, minDownloads: 0, maxDownloads: 1000, uploadedAfter: '2023-01-01', uploadedBefore: '2026-12-31', hasThumbnail: false, sort: 'downloads', page: 2, pageSize: 1 };
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, CATALOG_ENDPOINT);
    assert.equal(url.pathname, '/models');
    for (const [key, value] of Object.entries(params)) assert.equal(url.searchParams.get(key), Array.isArray(value) ? value.join(',') : String(value));
    assert.equal(options.credentials, 'omit'); assert.equal(options.signal, signal);
    return { ok: true, json: async () => ({ ...sample, page: 2, pages: 900, total: 900 }) };
  });
  const page = await fetchModels(params, signal);
  assert.equal(page.page, 2); assert.equal(page.total, 900); assert.equal(page.pages, 900); assert.equal(page.items.length, 1);
});
test('live schema maps design IDs, attribution, dates and trusted thumbnails', async t => {
  t.mock.method(globalThis, 'fetch', respond(sample));
  const { items: [model] } = await fetchModels();
  const raw = sample.items[0];
  assert.equal(model.id, String(raw.id)); assert.equal(model.url, raw.url);
  assert.equal(model.thumbnail, `/_model-thumbnail/v300?url=${encodeURIComponent(raw.thumbnailUrl)}`); assert.equal(model.author, raw.author);
  for (const key of ['license', 'category', 'subcategory', 'likes', 'downloads', 'uploadedAt', 'sourceUpdatedAt']) assert.equal(model[key], raw[key]);
  assert.deepEqual(model.fileFormats, raw.fileFormats); assert.deepEqual(model.estimatedFileFormats, []);
  assert.deepEqual(model.tags, raw.tags);
});
test('estimates never become verified formats and untrusted thumbnails are omitted', async t => {
  t.mock.method(globalThis, 'fetch', respond({ ...sample, items: [{ ...sample.items[0], fileFormats: ['STL'], estimated3mf: true, thumbnailUrl: 'https://makerworld.bblmw.com.evil.test/image' }] }));
  const { items: [model] } = await fetchModels();
  assert.deepEqual(model.fileFormats, ['stl']); assert.deepEqual(model.estimatedFileFormats, ['3mf']); assert.equal(model.thumbnail, undefined);
  globalThis.fetch = respond({ ...sample, items: [{ ...sample.items[0], url: 'javascript:alert(1)' }] });
  await assert.rejects(fetchModels(), /Invalid catalog model/);
});
test('detail retains plain description and detail author name', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(new URL(url).pathname, `/models/${sample.items[0].id}`);
    return { ok: true, json: async () => ({ ...sample.items[0], author: undefined, authorUsername: 'RoyalGreen', description: 'Plain description', categoryPath: ['Household', 'Decor'], observedAt: '2026-11-18T18:56:04.203Z' }) };
  });
  const model = await fetchModel(sample.items[0].id);
  assert.equal(model.description, 'Plain description'); assert.equal(model.author, 'RoyalGreen');
  assert.deepEqual(model.categoryPath, ['Household', 'Decor']); assert.equal(model.observedAt, '2026-11-18T18:56:04.203Z');
});
test('stats maps named counts without requiring subcategory facets', async t => {
  t.mock.method(globalThis, 'fetch', async url => { assert.equal(new URL(url).pathname, '/stats'); return { ok: true, json: async () => ({ models: 2339502, formats: [{ name: 'stl', c: 911149 }], categories: [], authors: [], licenses: [] }) }; });
  assert.deepEqual(await fetchStats(), { models: 2339502, formats: [{ name: 'stl', count: 911149 }], categories: [], authors: [], licenses: [] });
});
test('400/404 preserve safe server messages and status; aborts propagate', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 400, json: async () => ({ error: 'page must be a positive integer' }) }));
  await assert.rejects(fetchModels({ page: 0 }), error => error instanceof CatalogError && error.status === 400 && error.message === 'page must be a positive integer');
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: '<bad>\u0000 missing' }) });
  await assert.rejects(fetchModel(1), error => error.status === 404 && error.message === 'bad missing');
  const controller = new AbortController(); controller.abort();
  globalThis.fetch = async (_, { signal }) => { signal.throwIfAborted(); };
  await assert.rejects(fetchModels({}, controller.signal), { name: 'AbortError' });
});
