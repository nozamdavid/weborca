/**
 * The app's printer drivers (wasm/app/src/printers) running against mock printers through the real gateway.
 * The TypeScript sources are bundled with esbuild so the code under test is exactly what the browser runs.
 * Browser globals the drivers use (window, relative fetch URLs) are shimmed to point at the gateway.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, before, describe, test } from 'node:test';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import { loadDrivers, restoreGlobals, useGateway } from './lib/driverHarness.mjs';
import { listen, sleep, startGateway } from './lib/gatewayHarness.mjs';
import { startMockMoonraker, startMockOctoPrint, startMockPrusaLink } from './lib/mockPrinters.mjs';

const until = async (predicate, what, ms = 4000) => {
  for (let waited = 0; !predicate() && waited < ms; waited += 20) await sleep(20);
  assert.ok(predicate(), what);
};

const printerOf = (hostType, port, extra = {}) => ({
  id: 'p1', name: 'Mock', host_type: hostType, print_host: `127.0.0.1:${port}`, use_gateway: true, ...extra
});

/** Collects driver output; `stop` ends the connection. */
function watch(api) {
  const watcher = { states: [], errors: [], stop: () => {} };
  watcher.stop = api.connect((s) => watcher.states.push(s), (e) => watcher.errors.push(e.message));
  return watcher;
}

describe('printer drivers', () => {
  let createPrinterApi;
  let gateway; // open
  let readOnlyGateway;
  let offGateway;
  before(async () => {
    ({ createPrinterApi } = await loadDrivers());
    gateway = await startGateway({ proxy: 'private' });
    readOnlyGateway = await startGateway({ proxy: 'private', readOnly: true });
    offGateway = await startGateway({});
    useGateway(gateway);
  });

  after(async () => {
    restoreGlobals();
    await Promise.all([gateway.close(), readOnlyGateway.close(), offGateway.close()]);
  });

  describe('Moonraker', () => {
    let mock;
    before(async () => { mock = await startMockMoonraker(); });
    after(() => mock.close());

    test('test() describes the printer', async () => {
      useGateway(gateway);
      assert.equal(await createPrinterApi(printerOf('moonraker', mock.port)).test(), 'Moonraker v0.9.0-mock on mockhost, Klipper ready');
    });

    test('connect() builds the dashboard state, follows live updates and reconnects', async () => {
      useGateway(gateway);
      const w = watch(createPrinterApi(printerOf('moonraker', mock.port)));
      await until(() => w.states.some((s) => s.webcams && s.files), 'initial state with cameras and files');
      const first = w.states.at(-1);

      assert.equal(first.state, 'ready');
      assert.deepEqual(first.heaters.map((h) => [h.label, h.kind, h.current, h.target]), [
        ['Extruder 0', 'extruder', 210.2, 215], ['Extruder 1', 'extruder', 35, 0], ['Bed', 'bed', 60.1, 60], ['Chamber', 'chamber', 40, 45]
      ]);
      assert.deepEqual(first.fans.map((f) => [f.label, f.speed]), [['Part cooling', 0.5], ['Aux', 0.25]]);
      assert.deepEqual(first.position, { x: 10, y: 20.5, z: 30.25 });
      assert.equal(first.speedFactor, 100);
      assert.equal(first.flowFactor, 95);
      assert.deepEqual(first.webcams.map((c) => [c.name, c.snapshot]), [['Nozzle cam', false]]); // iframe and disabled cameras are left out
      assert.equal(first.webcams[0].url, `/_printer/http/127.0.0.1:${mock.port}/webcam/?action=stream`);
      assert.deepEqual(first.files.map((f) => f.name), ['new.gcode', 'old.gcode']); // newest first
      assert.equal(first.software, 'Klipper v0.12.0-mock');

      mock.push({
        print_stats: { state: 'printing', filename: 'cube.gcode', print_duration: 300, info: { current_layer: 12, total_layer: 40 } },
        virtual_sdcard: { progress: 0.25 },
        extruder: { temperature: 214.9 }
      });
      await until(() => w.states.at(-1).state === 'printing', 'printing state');
      const printing = w.states.at(-1);
      assert.equal(printing.file, 'cube.gcode');
      assert.equal(printing.progress, 0.25);
      assert.equal(printing.elapsed, 300);
      assert.equal(Math.round(printing.remaining), 900); // 300 s for 25% leaves 900 s
      assert.deepEqual(printing.layer, { current: 12, total: 40 });
      assert.equal(printing.heaters[0].current, 214.9);
      assert.equal(printing.heaters[0].target, 215, 'untouched fields keep their value');

      mock.push({ display_status: { progress: 0.5 } });
      await until(() => w.states.at(-1).progress === 0.5, 'M73 progress wins over file progress');

      mock.push({ print_stats: { state: 'error', message: 'Heater extruder not heating at expected rate' } });
      await until(() => w.states.at(-1).state === 'error', 'error state');
      assert.match(w.states.at(-1).message, /not heating/);

      const before = w.states.length;
      mock.dropConnections();
      await until(() => w.errors.some((e) => /lost/.test(e)), 'lost connection is reported');
      await until(() => w.states.length > before && w.states.at(-1).webcams, 'state returns after reconnecting', 6000);
      w.stop();
    });

    test('a multi-tool machine reports every extruder and the active one', async () => {
      useGateway(gateway);
      const w = watch(createPrinterApi(printerOf('moonraker', mock.port)));
      await until(() => w.states.length > 0, 'state');
      mock.push({ toolhead: { extruder: 'extruder1' } });
      await until(() => w.states.at(-1).activeTool === 'extruder1', 'active tool');
      assert.equal(w.states.at(-1).heaters.filter((h) => h.kind === 'extruder').length, 2);
      w.stop();
    });

    test('upload() sends the exact G-code and only prints when asked', async () => {
      useGateway(gateway);
      const gcode = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) & 255);
      const api = createPrinterApi(printerOf('moonraker', mock.port));
      const fractions = [];
      await api.upload({ filename: 'plate 1.gcode', gcode, print: false, onProgress: (f) => fractions.push(f) });
      assert.equal(mock.uploads.at(-1).filename, 'plate 1.gcode');
      assert.equal(mock.uploads.at(-1).root, 'gcodes');
      assert.equal(mock.uploads.at(-1).print, false);
      assert.ok(Buffer.from(gcode).equals(mock.uploads.at(-1).content));
      assert.deepEqual(mock.started, []);
      assert.equal(fractions.at(-1), 1);

      await api.upload({ filename: 'go.gcode', gcode, print: true });
      assert.equal(mock.uploads.at(-1).print, true);
      assert.deepEqual(mock.started, ['go.gcode']);
    });

    test('read-only gateway: the dashboard works and no request could change the printer', async () => {
      useGateway(readOnlyGateway);
      mock.rpcMethods.length = 0;
      mock.httpRequests.length = 0;
      const api = createPrinterApi(printerOf('moonraker', mock.port));
      assert.match(await api.test(), /Moonraker/);
      const w = watch(api);
      await until(() => w.states.some((s) => s.webcams && s.files), 'full dashboard through the read-only gateway');
      w.stop();
      const ALLOWED = ['server.connection.identify', 'printer.objects.list', 'printer.objects.subscribe', 'server.webcams.list', 'server.files.list', 'printer.info'];
      assert.deepEqual([...new Set(mock.rpcMethods)].sort(), ALLOWED.sort());
      assert.ok(mock.httpRequests.every((r) => r.method === 'GET'));

      await assert.rejects(api.upload({ filename: 'x.gcode', gcode: new Uint8Array(4), print: false }), /Read-only mode/);
    });

    test('explains a gateway that is off and a printer that is not there', async () => {
      useGateway(offGateway);
      await assert.rejects(createPrinterApi(printerOf('moonraker', mock.port)).test(), /gateway is off/);

      useGateway(gateway);
      const free = await new Promise((resolve) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
      });
      await assert.rejects(createPrinterApi(printerOf('moonraker', free)).test(), /refused/);
    });
  });

  describe('OctoPrint', () => {
    let mock;
    before(async () => { mock = await startMockOctoPrint({ apiKey: 'KEY' }); });
    after(() => mock.close());

    test('test(), state and upload', async () => {
      useGateway(gateway);
      const printer = printerOf('octoprint', mock.port, { printhost_apikey: 'KEY' });
      const api = createPrinterApi(printer);
      assert.equal(await api.test(), 'OctoPrint 1.10.0');

      const w = watch(api);
      await until(() => w.states.length > 0, 'first state');
      assert.equal(w.states[0].state, 'ready');
      assert.deepEqual(w.states[0].heaters.map((h) => [h.label, h.current, h.target]), [['Nozzle', 205.5, 210], ['Tool 1', 30, 0], ['Bed', 58, 60]]);

      const gcode = new Uint8Array([1, 2, 3, 4, 5]);
      await api.upload({ filename: 'a.gcode', gcode, print: true });
      assert.deepEqual([mock.uploads[0].select, mock.uploads[0].print, mock.uploads[0].filename], ['true', true, 'a.gcode']);
      assert.ok(Buffer.from(gcode).equals(mock.uploads[0].content));
      await until(() => w.states.at(-1).state === 'printing', 'printing after the upload', 6000);
      assert.equal(w.states.at(-1).progress, 0.425);
      assert.equal(w.states.at(-1).file, 'cube.gcode');
      assert.equal(w.states.at(-1).remaining, 400);
      w.stop();
    });

    test('a wrong API key is reported', async () => {
      useGateway(gateway);
      await assert.rejects(createPrinterApi(printerOf('octoprint', mock.port, { printhost_apikey: 'nope' })).test(), /403/);
    });
  });

  describe('Prusa Connect', () => {
    const start = (putUpload) => new Promise((resolve) => {
      const mock = { requests: [] };
      const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          mock.requests.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], headers: req.headers, body: Buffer.concat(chunks) });
          if (req.headers['x-api-key'] !== 'KEY') { res.writeHead(401); return res.end(); }
          if (req.url === '/api/version') {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ api: '0.1', text: 'PrusaLink 0.7', capabilities: { 'upload-by-put': putUpload } }));
          }
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end('{}');
        });
      });
      server.listen(0, '127.0.0.1', () => { mock.port = server.address().port; mock.close = () => { server.closeAllConnections(); server.close(); }; resolve(mock); });
    });

    test('test() and upload by PUT when the service supports it', async () => {
      const mock = await start(true);
      try {
        useGateway(gateway);
        const api = createPrinterApi(printerOf('prusaconnect', mock.port, { printhost_apikey: 'KEY' }));
        assert.match(await api.test(), /Prusa Connect is working \(PrusaLink 0\.7\)/);
        await api.upload({ filename: 'a b.gcode', gcode: new Uint8Array([1, 2, 3]), print: true });
        const put = mock.requests.at(-1);
        assert.deepEqual([put.method, put.url, put.headers['print-after-upload'], put.headers['content-type']], ['PUT', '/api/v1/files/local/a%20b.gcode', '?1', 'text/x.gcode']);
        assert.deepEqual([...put.body], [1, 2, 3]);
        await api.upload({ filename: 'b.gcode', gcode: new Uint8Array([4]), print: false });
        assert.equal(mock.requests.at(-1).headers['print-after-upload'], undefined);
      } finally { mock.close(); }
    });

    test('upload by multipart POST otherwise, and a wrong key is reported', async () => {
      const mock = await start(false);
      try {
        useGateway(gateway);
        const api = createPrinterApi(printerOf('prusaconnect', mock.port, { printhost_apikey: 'KEY' }));
        await api.upload({ filename: 'c.gcode', gcode: new Uint8Array([7, 8]), print: true });
        const post = mock.requests.at(-1);
        assert.deepEqual([post.method, post.url], ['POST', '/api/files/local']);
        const text = post.body.toString('latin1');
        assert.match(text, /name="to_print"\r\n\r\nTrue/);
        assert.match(text, /filename="c\.gcode"/);
        await assert.rejects(createPrinterApi(printerOf('prusaconnect', mock.port, { printhost_apikey: 'nope' })).test(), /401/);
      } finally { mock.close(); }
    });
  });

  describe('PrusaLink', () => {
    let mock;
    before(async () => { mock = await startMockPrusaLink(); });
    after(() => mock.close());

    test('digest login through the gateway, state and upload', async () => {
      useGateway(gateway);
      const printer = printerOf('prusalink', mock.port, { printhost_user: 'maker', printhost_password: 'secret' });
      const api = createPrinterApi(printer);
      assert.equal(await api.test(), 'PrusaLink 2.1.2 PrusaLink MK4');

      const w = watch(api);
      await until(() => w.states.some((s) => s.file), 'state with the file name');
      const state = w.states.at(-1);
      assert.equal(state.state, 'printing');
      assert.equal(state.progress, 0.42);
      assert.equal(state.remaining, 600);
      assert.equal(state.file, 'cube.gcode');
      assert.deepEqual(state.heaters.map((h) => [h.label, h.current, h.target]), [['Nozzle', 214.8, 215], ['Bed', 59.9, 60]]);
      assert.equal(state.speedFactor, 120);
      w.stop();

      const gcode = new Uint8Array([9, 8, 7, 6]);
      await api.upload({ filename: 'my part.gcode', gcode, print: true });
      const up = mock.uploads.at(-1);
      assert.equal(up.path, '/api/v1/files/usb/my%20part.gcode');
      assert.equal(up.printAfter, '?1');
      assert.equal(up.overwrite, '?1');
      assert.ok(Buffer.from(gcode).equals(up.content));
      await api.upload({ filename: 'b.gcode', gcode, print: false });
      assert.equal(mock.uploads.at(-1).printAfter, '?0');
    });

    test('a wrong password is reported as rejected credentials', async () => {
      useGateway(gateway);
      const printer = printerOf('prusalink', mock.port, { printhost_user: 'maker', printhost_password: 'wrong' });
      await assert.rejects(createPrinterApi(printer).test(), /rejected the credentials/);
    });
  });

  describe('Bambu Lab', () => {
    const SERIAL = '01S00A000000000';
    let broker;
    let tcp;
    let brokerPort;
    let bambuGateway;
    let received;
    const sockets = new Set();

    before(async () => {
      broker = await Aedes.createBroker();
      broker.authenticate = (_c, user, pass, cb) => cb(null, user === 'bblp' && pass?.toString() === '12345678');
      broker.on('publish', (packet, client) => client && received.push({ topic: packet.topic, payload: JSON.parse(packet.payload.toString()) }));
      tcp = net.createServer(broker.handle);
      tcp.on('connection', (s) => sockets.add(s));
      brokerPort = await listen(tcp);
      bambuGateway = await startGateway({ proxy: 'private', bambu: { mqttProtocol: 'mqtt', mqttPort: brokerPort } });
    });

    after(async () => {
      await bambuGateway.close();
      sockets.forEach((s) => s.destroy());
      await Promise.race([new Promise((r) => broker.close(r)), sleep(2000)]);
      await new Promise((r) => tcp.close(r));
    });

    const bambu = (extra = {}) => printerOf('bambu', 1, { print_host: '127.0.0.1', serial: SERIAL, printhost_apikey: '12345678', ...extra });

    test('reports become dashboard state, including partial updates', async () => {
      received = [];
      useGateway(bambuGateway);
      const w = watch(createPrinterApi(bambu()));
      await until(() => received.some((m) => m.payload.pushing), 'the bridge asked for a full report');

      const printer = mqtt.connect({ protocol: 'mqtt', host: '127.0.0.1', port: brokerPort, username: 'bblp', password: '12345678' });
      await new Promise((resolve) => printer.on('connect', resolve));
      printer.publish(`device/${SERIAL}/report`, JSON.stringify({ print: {
        gcode_state: 'RUNNING', mc_percent: 42, mc_remaining_time: 30, layer_num: 10, total_layer_num: 100, subtask_name: 'benchy',
        nozzle_temper: 215.5, nozzle_target_temper: 220, bed_temper: 59.8, bed_target_temper: 60, chamber_temper: 31, spd_lvl: 3, cooling_fan_speed: '15'
      } }));
      await until(() => w.states.at(-1)?.state === 'printing', 'printing state');
      let state = w.states.at(-1);
      assert.equal(state.progress, 0.42);
      assert.equal(state.remaining, 1800);
      assert.deepEqual(state.layer, { current: 10, total: 100 });
      assert.equal(state.file, 'benchy');
      assert.deepEqual(state.heaters.map((h) => [h.label, h.current, h.target]), [['Nozzle', 215.5, 220], ['Bed', 59.8, 60], ['Chamber', 31, 0]]);
      assert.equal(state.speedFactor, 124);
      assert.equal(state.fans[0].speed, 1);

      printer.publish(`device/${SERIAL}/report`, JSON.stringify({ print: { mc_percent: 50, nozzle_temper: 216 } }));
      await until(() => w.states.at(-1).progress === 0.5, 'partial update merged');
      assert.equal(w.states.at(-1).heaters[1].current, 59.8, 'untouched values stay');
      assert.equal(w.states.at(-1).heaters[0].current, 216);
      printer.end(true);
      w.stop();
    });

    test('test() succeeds with the right access code and explains a wrong one', async () => {
      useGateway(bambuGateway);
      // The bridge answers a connection test once the printer sends a report.
      const api = createPrinterApi(bambu());
      const printer = mqtt.connect({ protocol: 'mqtt', host: '127.0.0.1', port: brokerPort, username: 'bblp', password: '12345678' });
      await new Promise((resolve) => printer.on('connect', resolve));
      const timer = setInterval(() => printer.publish(`device/${SERIAL}/report`, JSON.stringify({ print: { gcode_state: 'IDLE' } })), 100);
      assert.match(await api.test(), /Bambu Lab .* connected/);
      clearInterval(timer);
      printer.end(true);

      await assert.rejects(createPrinterApi(bambu({ printhost_apikey: 'wrong' })).test(), /./);
    });

    test('needs the gateway', async () => {
      useGateway(gateway);
      const w = watch(createPrinterApi(bambu({ use_gateway: false })));
      assert.match(w.errors[0], /need the app server gateway/);
    });
  });
});
