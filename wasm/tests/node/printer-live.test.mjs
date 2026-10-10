/**
 * READ-ONLY check of a real printer. Runs only when ORCA_LIVE_PRINTER is set to its address, e.g.
 *   ORCA_LIVE_PRINTER=192.168.0.238 node --test wasm/tests/node/printer-live.test.mjs
 *
 * Everything goes through a gateway in read-only mode, which refuses any request that could change the
 * printer (non-GET HTTP, websocket methods outside a read-only allow-list). The test also never calls
 * upload(). It only reads status.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadDrivers, restoreGlobals, useGateway } from './lib/driverHarness.mjs';
import { sleep, startGateway } from './lib/gatewayHarness.mjs';

const host = process.env.ORCA_LIVE_PRINTER;

describe('live printer (read-only)', { skip: host ? false : 'set ORCA_LIVE_PRINTER=<address> to run' }, () => {
  let gateway;
  let createPrinterApi;
  const printer = { id: 'live', name: 'Live', host_type: 'moonraker', print_host: host, use_gateway: true };

  before(async () => {
    ({ createPrinterApi } = await loadDrivers());
    gateway = await startGateway({ proxy: 'private', readOnly: true });
    useGateway(gateway);
  });

  after(async () => {
    restoreGlobals();
    await gateway?.close();
  });

  test('the gateway is read-only and private-only', async () => {
    const status = await (await fetch(`${gateway.url}/_printer/status`)).json();
    assert.deepEqual([status.enabled, status.mode, status.readOnly], [true, 'private', true]);
    const post = await fetch(`${gateway.url}/_printer/http/${host}/printer/gcode/script?script=G28`, { method: 'POST' });
    assert.equal(post.status, 403, 'a mutating request must be refused before it reaches the printer');
  });

  test('test() identifies Moonraker and Klipper', async () => {
    const description = await createPrinterApi(printer).test();
    console.log('  printer:', description);
    assert.match(description, /Moonraker .*Klipper/);
  });

  test('the dashboard reads state, temperatures, cameras and files', async () => {
    const states = [];
    const errors = [];
    const stop = createPrinterApi(printer).connect((s) => states.push(s), (e) => errors.push(e.message));
    for (let waited = 0; !states.some((s) => s.webcams && s.files) && waited < 15000; waited += 100) await sleep(100);
    stop();
    assert.deepEqual(errors, []);
    const state = states.at(-1);
    assert.ok(state, 'a state arrived');
    console.log('  state:', state.state, '| heaters:', state.heaters.map((h) => `${h.label} ${h.current.toFixed(1)}/${h.target}`).join(', '));
    console.log('  cameras:', (state.webcams ?? []).map((c) => c.name).join(', ') || 'none', '| files:', state.files?.length ?? 0, '| software:', state.software);
    assert.ok(['ready', 'printing', 'paused', 'complete', 'error', 'offline'].includes(state.state));
    assert.ok(state.heaters.some((h) => h.kind === 'extruder'), 'extruders are listed');
    assert.ok(state.heaters.some((h) => h.kind === 'bed'), 'the bed is listed');
    for (const h of state.heaters) assert.ok(Number.isFinite(h.current) && h.current > -50 && h.current < 500, `${h.label} reads a sane temperature`);
  });
});
