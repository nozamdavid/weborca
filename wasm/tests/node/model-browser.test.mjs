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
  assert.equal(model.descriptionHtml, undefined);
  assert.deepEqual(model.categoryPath, ['Household', 'Decor']); assert.equal(model.observedAt, '2026-11-18T18:56:04.203Z');
  globalThis.fetch = respond({ ...sample.items[0], descriptionHTML: '<p><strong>Catalog HTML</strong></p>' });
  assert.equal((await fetchModel(sample.items[0].id)).descriptionHtml, '<p><strong>Catalog HTML</strong></p>');
  globalThis.fetch = respond({ ...sample.items[0], descriptionHtml: '<p><strong>Formatted description</strong></p>' });
  assert.equal((await fetchModel(sample.items[0].id)).descriptionHtml, '<p><strong>Formatted description</strong></p>');
});
test('Printables models map source, URLs, thumbnails and query/detail transport', async t => {
  const printablesItem = {
    ...sample.items[0],
    id: 424242,
    source: 'printables',
    url: 'https://www.printables.com/model/424242-test-model',
    thumbnailUrl: 'https://media.printables.com/media/prints/424242/images/cover.webp',
  };
  t.mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/models');
    assert.equal(parsed.searchParams.get('source'), 'printables');
    return { ok: true, json: async () => ({ ...sample, items: [printablesItem] }) };
  });
  const { items: [model] } = await fetchModels({ source: 'printables' });
  assert.equal(model.source, 'printables');
  assert.equal(model.url, printablesItem.url);
  assert.equal(model.thumbnail, `/_model-thumbnail/v300?url=${encodeURIComponent(printablesItem.thumbnailUrl)}`);

  globalThis.fetch = async url => {
    assert.equal(new URL(url).pathname, '/models/printables/424242');
    return { ok: true, json: async () => printablesItem };
  };
  assert.equal((await fetchModel(424242, undefined, 'printables')).source, 'printables');

  for (const bad of [
    { ...printablesItem, url: 'https://evil.printables.com/model/424242-test-model' },
    { ...printablesItem, url: 'https://www.printables.com/model/999999-other' },
  ]) {
    globalThis.fetch = respond({ ...sample, items: [bad] });
    await assert.rejects(fetchModels(), /Invalid catalog model/);
  }
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

const descriptionBundle = await build({ entryPoints: [new URL('../../app/src/models/descriptionHtml.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', write: false });
const { renderSafeDescriptionNodes } = await import(`data:text/javascript;base64,${Buffer.from(descriptionBundle.outputFiles[0].text).toString('base64')}`);
const textNode = textContent => ({ nodeType: 3, textContent });
const element = (localName, childNodes = [], attributes = {}) => ({ nodeType: 1, textContent: null, localName, childNodes, getAttribute: name => attributes[name] ?? null });

test('description strips dangerous subtrees and unsafe link attributes while retaining link text', () => {
  const nodes = renderSafeDescriptionNodes([
    element('script', [textNode('bad script')]), element('style', [textNode('bad style')]),
    element('a', [textNode('Safe text')], { href: 'javascript:alert(1)', onclick: 'bad()' }),
    element('p', [textNode('Paragraph')], { style: 'color:red', class: 'bad', onclick: 'bad()' }),
  ]);
  assert.equal(nodes[0], null);
  assert.equal(nodes[1], null);
  assert.deepEqual(nodes[2].props.children, ['Safe text']);
  assert.equal(typeof nodes[2].type, 'symbol');
  assert.deepEqual(nodes[3].props, { children: 'Paragraph' });
});

test('description resolves relative and protocol-relative links against the model URL', () => {
  const nodes = renderSafeDescriptionNodes([
    element('a', [textNode('Model')], { href: '/en/models/123' }),
    element('a', [textNode('Other')], { href: '//example.com/a' }),
  ], 'https://makerworld.com/en/models/456');
  assert.deepEqual(nodes.map(node => node.props.href), ['https://makerworld.com/en/models/123', 'https://example.com/a']);
  assert.ok(nodes.every(node => node.props.target === '_blank' && node.props.rel === 'noopener noreferrer'));
});

test('description preserves separate table cells', () => {
  const nodes = renderSafeDescriptionNodes([element('table', [element('tr', [element('td', [textNode('Nozzle')]), element('td', [textNode('0.4')])])])]);
  assert.equal(nodes[0].type, 'table');
  const row = nodes[0].props.children;
  assert.equal(row.type, 'tr');
  assert.deepEqual(row.props.children.map(cell => [cell.type, cell.props.children]), [['td', 'Nozzle'], ['td', '0.4']]);
});

test('description retains meaningful image alt text and omits images without alt', () => {
  const nodes = renderSafeDescriptionNodes([element('img', [], { alt: ' Step 1 ', src: 'bad' }), element('img'), element('img', [], { alt: '  ' })]);
  assert.equal(nodes[0].type, 'span');
  assert.equal(nodes[0].props.className, 'model-modal-img-alt');
  assert.equal(nodes[0].props.children.join(''), '[Step 1]');
  assert.equal(nodes[0].props.src, undefined);
  assert.deepEqual(nodes.slice(1), [null, null]);
});

test('description returns null when no visible content remains', () => {
  for (const nodes of [[], [textNode('  ')], [element('p')], [element('script', [textNode('hidden')])]]) {
    assert.equal(renderSafeDescriptionNodes(nodes), null);
  }
});
