import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

let PrusaConnectApi;
before(async () => {
  const bundle = await build({
    entryPoints: [new URL('../../app/src/printers/prusaConnect.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'locale', setup(b) {
      b.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'locale', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const translate=s=>s;' }));
    } }]
  });
  ({ PrusaConnectApi } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`));
});

async function polling(t, printer, materials = null) {
  let next;
  const states = [], errors = [], requests = [];
  t.mock.method(globalThis, 'setTimeout', callback => { next = callback; return 1; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    requests.push(url);
    if (url.endsWith('/materials')) {
      if (materials instanceof Error) throw materials;
      if (materials instanceof Response) return materials;
      return Response.json(materials);
    }
    return Response.json(url.endsWith('/cameras') ? { cameras: [] } : printer);
  });
  const api = new PrusaConnectApi({ id: 'fixture', name: 'Fixture', host_type: 'prusaconnect',
    print_host: 'connect.prusa3d.com', cloud_device_id: 'fixture' });
  t.after(api.connect(state => states.push(state), error => errors.push(error)));
  await new Promise(setImmediate);
  return { states, errors, requests, async poll(value, assignments = null) {
    printer = value;
    materials = assignments;
    await next();
    assert.deepEqual(errors, []);
  } };
}

const slot = (key, label, material, presence = 'present', index = Number(key.split('.').at(-1)) - 1) =>
  ({ id: `prusa-tool-${key}`, label, ...(key.includes('.') ? {} : { slotIndex: index }), material, presence });

const richTool = (id, values = {}) => ({ id, type: id.includes('.') ? 'FEEDER' : 'EXTRUDER',
  presence: 'present', material: 'PLA', ...values });

test('rich assignments retain actual type, details, alpha and sparse zero-based identity', async t => {
  const p = await polling(t, { tools: { 3: { material: 'ABS' } } }, { tools: [
    richTool('0', { vendor: 'Prusament', subtype: 'Galaxy Black', color: '#12345678' }),
    richTool('2', { material: 'PETG', color: '#abcdef' })
  ] });
  assert.deepEqual(p.states[0].filamentSlots, [
    { id: 'prusa-gql-tool-0', label: 'Tool 1', slotIndex: 0, material: 'PLA', presence: 'present',
      vendor: 'Prusament', subtype: 'Galaxy Black', color: '#12345678' },
    { id: 'prusa-gql-tool-2', label: 'Tool 3', slotIndex: 2, material: 'PETG', presence: 'present', color: '#abcdef' }
  ]);
  assert.ok(p.requests.every(url => /\/(?:fixture|cameras|materials)$/.test(url)));
});

test('rich feeders preserve dotted IDs, suppress head and distinguish empty and unknown records', async t => {
  const p = await polling(t, {}, { tools: [richTool('0'),
    richTool('0.4', { presence: 'empty', material: '' }),
    richTool('0.0', { presence: 'unknown', material: '' })] });
  assert.deepEqual(p.states[0].filamentSlots, [
    { id: 'prusa-gql-tool-0.4', label: 'MMU slot 0.4', material: '', presence: 'empty' },
    { id: 'prusa-gql-tool-0.0', label: 'MMU slot 0.0', material: '', presence: 'unknown' }
  ]);
});

test('rich assignments keep OFFLINE and UNKNOWN behind the existing offline display gate', async t => {
  const rich = { tools: [richTool('2', { color: '#112233' })] };
  const p = await polling(t, { connect_state: 'READY' }, rich);
  assert.equal(p.states[0].state, 'ready');
  for (const connect_state of ['OFFLINE', 'UNKNOWN']) {
    await p.poll({ connect_state }, rich);
    assert.equal(p.states.at(-1).state, 'offline');
  }
});

test('optional failures and malformed DTO clear stale rich data using current REST poll', async t => {
  const rest = { tools: { 3: { material: 'PETG' } }, temp: { temp_nozzle: 25 } };
  const rich = { tools: [richTool('2', { color: '#112233', subtype: 'Old name' })] };
  const p = await polling(t, rest, rich);
  for (const unavailable of [new Error('network'), new Response('{}', { status: 401 }),
    new Response('{}', { status: 404 }), null, {}, { tools: null },
    { tools: [richTool('2', { color: 'red' })] }, { tools: [richTool('2'), richTool('2')] },
    { tools: [richTool('2'), {}] }]) {
    await p.poll(rest, rich);
    await p.poll(rest, unavailable);
    assert.deepEqual(p.states.at(-1).filamentSlots, [slot('3', 'Tool 3', 'PETG')]);
    assert.equal(p.states.at(-1).heaters[0].current, 25);
  }
  await p.poll(rest, { tools: [] });
  assert.deepEqual(p.states.at(-1).filamentSlots, []);
  await p.poll({});
  assert.equal(p.states.at(-1).filamentSlots, undefined);
});

test('cancelling an outstanding optional read emits no state or error callbacks', async t => {
  let finish;
  t.mock.method(globalThis, 'fetch', url => url.endsWith('/materials')
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(Response.json({})));
  const states = [], errors = [];
  const api = new PrusaConnectApi({ id: 'cancel', host_type: 'prusaconnect', cloud_device_id: 'fixture' });
  const stop = api.connect(state => states.push(state), error => errors.push(error));
  stop();
  finish(Response.json({ tools: [] }));
  await new Promise(setImmediate);
  assert.deepEqual(states, []);
  assert.deepEqual(errors, []);
});

test('slow materials read falls back within budget and cannot restore stale color after UNKNOWN', async t => {
  const timers = new Map();
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { timers.set(delay, callback); return delay; });
  t.mock.method(globalThis, 'clearTimeout', delay => timers.delete(delay));
  let pending = false, finishMaterials, materialSignal;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/materials')) {
      if (pending) {
        materialSignal = options.signal;
        return new Promise(resolve => { finishMaterials = resolve; });
      }
      return Response.json({ tools: [richTool('0', { color: '#112233' })] });
    }
    return Response.json(url.endsWith('/cameras') ? { cameras: [] }
      : { connect_state: pending ? 'UNKNOWN' : 'READY', tools: { 1: { material: 'PETG' } }, temp: { temp_nozzle: 25 } });
  });
  const states = [], errors = [];
  const api = new PrusaConnectApi({ id: 'slow', host_type: 'prusaconnect', cloud_device_id: 'fixture' });
  t.after(api.connect(state => states.push(state), error => errors.push(error)));
  await new Promise(setImmediate);
  assert.equal(states[0].filamentSlots[0].color, '#112233');
  pending = true;
  const poll = timers.get(2500)();
  await new Promise(setImmediate);
  assert.equal(typeof timers.get(1500), 'function', 'optional inventory has a short deadline');
  timers.get(1500)();
  await poll;
  assert.equal(materialSignal.aborted, true);
  assert.equal(states.at(-1).state, 'offline');
  assert.equal(states.at(-1).heaters[0].current, 25);
  assert.deepEqual(states.at(-1).filamentSlots, [slot('1', 'Tool 1', 'PETG')]);
  const count = states.length;
  finishMaterials(Response.json({ tools: [richTool('0', { color: '#112233' })] }));
  await new Promise(setImmediate);
  assert.equal(states.length, count, 'late material completion cannot publish stale inventory');
  assert.deepEqual(errors, []);
});

test('single tool uses reported material and ignores job requirements and unverified color', async t => {
  const p = await polling(t, { tools: { 1: { material: ' PETG ', color: '#ff0000' } },
    job_info: { material: 'PLA' }, material: 'ABS' });
  assert.deepEqual(p.states[0].filamentSlots, [slot('1', 'Tool 1', 'PETG')]);
  assert.deepEqual(p.errors, []);
  assert.equal(p.requests.length, 3);
});

test('MMU uses dotted physical slot identities and suppresses duplicated print head', async t => {
  const p = await polling(t, { tools: { 1: { material: 'PLA', mmu: { enabled: true } },
    '1.0': { material: 'PLA' }, '1.4': { material: 'PETG' } } });
  assert.deepEqual(p.states[0].filamentSlots,
    [slot('1.0', 'MMU slot 1.0', 'PLA'), slot('1.4', 'MMU slot 1.4', 'PETG')]);
});

test('sparse XL tool numbers remain physical tool numbers', async t => {
  const p = await polling(t, { tools: { 1: { material: 'PLA' }, 3: { material: 'ASA' }, 5: { material: 'PC' } } });
  assert.deepEqual(p.states[0].filamentSlots,
    [slot('1', 'Tool 1', 'PLA'), slot('3', 'Tool 3', 'ASA'), slot('5', 'Tool 5', 'PC')]);
});

test('explicit no-material sentinel differs from missing or malformed material', async t => {
  const p = await polling(t, { tools: { 1: { material: '---' }, 2: {}, 3: { material: null },
    4: { material: 42 }, 5: { material: ' ' } } });
  assert.deepEqual(p.states[0].filamentSlots, [slot('1', 'Tool 1', '', 'empty'),
    ...[2, 3, 4, 5].map(index => slot(String(index), `Tool ${index}`, '', 'unknown'))]);
});

test('each complete poll replaces stale inventory including empty and unavailable reports', async t => {
  const p = await polling(t, { tools: { 3: { material: 'PLA' } } });
  await p.poll({ tools: {} });
  assert.deepEqual(p.states.at(-1).filamentSlots, []);
  for (const tools of [undefined, null, [], 'invalid', { bad: { material: 'PLA' } },
    { 0: { material: 'PLA' }, '1.00': {}, '9007199254740992': {}, 1: null }]) {
    await p.poll({ tools: { 3: { material: 'PLA' } } });
    await p.poll({ tools, material: 'PETG', job_info: { material: 'ASA' }, temp: { temp_nozzle: 20 } });
    assert.equal(p.states.at(-1).filamentSlots, undefined);
  }
});

test('UNKNOWN connection state hides retained material assignments through the offline display gate', async t => {
  const tools = { 1: { material: 'PLA' } };
  const p = await polling(t, { connect_state: 'READY', tools });
  assert.equal(p.states[0].state, 'ready');
  await p.poll({ connect_state: 'UNKNOWN', tools });
  assert.equal(p.states.at(-1).state, 'offline');
});
