/**
 * Printer gateway (wasm/app/printerGateway.ts): address policy, read-only mode, HTTP streaming,
 * websocket relay, Digest authentication and the Bambu MQTT bridge. Everything runs against mock
 * printers on 127.0.0.1; nothing here touches a real printer.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, before, describe, test } from 'node:test';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import { WebSocket, WebSocketServer } from 'ws';
import {
  bambuRequestAllowedInReadOnly, checkRpcFrame, digestAuthorization, GatewayError, httpAllowedInReadOnly,
  isPrivateAddress, parseDigestChallenge, resolveTarget
} from '../../app/gateway/policy.ts';
import { close, listen, sleep, startGateway } from './lib/gatewayHarness.mjs';

describe('policy', () => {
  test('private address ranges', () => {
    for (const ip of ['192.168.0.238', '10.1.2.3', '172.16.0.1', '172.31.255.255', '100.64.0.1', '100.127.255.255',
      '127.0.0.1', '169.254.1.1', '::1', 'fd12::1', 'fc00::1', 'fe80::1', '::ffff:192.168.0.1', '::ffff:c0a8:1']) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.255.255', '100.128.0.1', '100.63.255.255', '0.0.0.0',
      '2001:db8::1', '::ffff:8.8.8.8', 'example.com', '']) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
  });

  test('resolveTarget', async () => {
    const dns = async (host) => ({ 'printer.lan': ['192.168.0.5'], 'mixed.test': ['192.168.0.5', '8.8.8.8'], 'evil.test': ['8.8.8.8'] })[host] ?? [];
    const rejects = (promise, status) => assert.rejects(promise, (e) => e instanceof GatewayError && e.status === status);

    await rejects(resolveTarget('192.168.0.5', 80, {}, dns), 403); // gateway off
    assert.deepEqual(await resolveTarget('192.168.0.5:7125', 80, { proxy: 'private' }, dns), { hostPort: '192.168.0.5:7125', host: '192.168.0.5', port: 7125, address: '192.168.0.5' });
    assert.equal((await resolveTarget('printer.lan', 80, { proxy: 'private' }, dns)).address, '192.168.0.5');
    assert.equal((await resolveTarget('[::1]:7125', 80, { proxy: 'private' }, dns)).host, '::1');
    await rejects(resolveTarget('8.8.8.8', 80, { proxy: 'private' }, dns), 403);
    await rejects(resolveTarget('evil.test', 80, { proxy: 'private' }, dns), 403); // resolves to a public address
    await rejects(resolveTarget('mixed.test', 80, { proxy: 'private' }, dns), 403); // any public address refuses the name
    await rejects(resolveTarget('nowhere.test', 80, { proxy: 'private' }, dns), 502);
    await rejects(resolveTarget('user@192.168.0.5', 80, { proxy: 'private' }, dns), 400);
    await rejects(resolveTarget('192.168.0.5/evil', 80, { proxy: 'private' }, dns), 400);

    const list = { proxy: 'Printer.lan, 10.0.0.9' };
    assert.equal((await resolveTarget('printer.lan', 80, list, dns)).address, '192.168.0.5');
    assert.equal((await resolveTarget('10.0.0.9', 80, list, dns)).host, '10.0.0.9');
    await rejects(resolveTarget('10.0.0.10', 80, list, dns), 403);
  });

  test('read-only HTTP', () => {
    for (const [method, path] of [['GET', '/server/info'], ['GET', '/printer/objects/query?extruder'], ['HEAD', '/'], ['GET', '/api/job'],
      ['GET', '/server/files/gcodes/pause.gcode'], ['GET', '/webcam/?action=stream'], ['OPTIONS', '/printer/info']]) {
      assert.equal(httpAllowedInReadOnly(method, path), true, `${method} ${path}`);
    }
    for (const [method, path] of [['POST', '/server/info'], ['PUT', '/api/v1/files/usb/a.gcode'], ['DELETE', '/server/files/gcodes/a.gcode'],
      ['GET', '/printer/gcode/script?script=G28'], ['GET', '/printer/print/start?filename=a'], ['GET', '/printer/emergency_stop'],
      ['GET', '/printer/restart'], ['GET', '/machine/reboot'], ['GET', '/machine/services/restart?service=klipper'],
      ['GET', '/server/files/delete_file?path=x'], ['GET', '/server/files/move'], ['GET', '/server/job_queue/start']]) {
      assert.equal(httpAllowedInReadOnly(method, path), false, `${method} ${path}`);
    }
  });

  test('read-only JSON-RPC frames', () => {
    assert.deepEqual(checkRpcFrame('{"jsonrpc":"2.0","method":"printer.objects.query","id":1}'), { forward: true, replies: [] });
    assert.equal(checkRpcFrame('[{"method":"server.info","id":1},{"method":"printer.objects.list","id":2}]').forward, true);

    const mutating = checkRpcFrame('{"jsonrpc":"2.0","method":"printer.gcode.script","params":{"script":"G28"},"id":7}');
    assert.equal(mutating.forward, false);
    assert.equal(JSON.parse(mutating.replies[0]).id, 7);
    assert.equal(JSON.parse(mutating.replies[0]).error.code, -32601);

    const batch = checkRpcFrame('[{"method":"server.info","id":1},{"method":"printer.print.start","id":2}]');
    assert.equal(batch.forward, false); // one bad request refuses the whole batch
    assert.equal(batch.replies.length, 1);

    for (const junk of ['not json', '[]', '42', 'null', '{}', '{"method":42}', '{"result":{}}', '"printer.info"']) {
      assert.equal(checkRpcFrame(junk).forward, false, junk);
    }
  });

  test('read-only Bambu requests', () => {
    assert.equal(bambuRequestAllowedInReadOnly({ pushing: { sequence_id: '0', command: 'pushall' } }), true);
    assert.equal(bambuRequestAllowedInReadOnly({ info: { command: 'get_version' } }), true);
    for (const payload of [{ print: { command: 'stop' } }, { system: { command: 'ledctrl' } }, { pushing: { command: 'start' } },
      { pushing: { command: 'pushall' }, print: { command: 'stop' } }, null, 'pushall', []]) {
      assert.equal(bambuRequestAllowedInReadOnly(payload), false, JSON.stringify(payload));
    }
  });

  test('digest authorization matches the RFC 2617 example', () => {
    const challenge = parseDigestChallenge('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"');
    assert.equal(challenge.realm, 'testrealm@host.com');
    const header = digestAuthorization(challenge, 'Mufasa', 'Circle Of Life', 'GET', '/dir/index.html', 1, '0a4f113b');
    assert.match(header, /response="6629fae49393a05397450978507c4ef1"/);
    assert.equal(parseDigestChallenge('Basic realm="x"'), undefined);
  });
});

describe('gateway', () => {
  let upstream; // mock printer HTTP + websocket
  let upstreamPort;
  let seen; // requests the mock printer received
  let wsReceived;
  let wsUpgradeDelayMs = 0;
  let heldResponses;

  const DIGEST = { realm: 'printer', nonce: 'abc123', qop: 'auth' };
  const digestUsed = [];

  before(async () => {
    upstream = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });

      if (req.url === '/hold') {
        heldResponses.push(res);
        res.writeHead(200);
        res.write('start');
        return;
      }
      if (req.url === '/stream') {
        res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace' });
        res.write('frame1');
        setTimeout(() => res.end('frame2'), 300);
        return;
      }
      if (req.url === '/api/version' || req.url === '/protected') {
        const auth = req.headers.authorization;
        if (req.url === '/protected' || !auth) {
          if (!auth) {
            res.writeHead(401, { 'www-authenticate': `Digest realm="${DIGEST.realm}", qop="auth", nonce="${DIGEST.nonce}"` });
            return res.end();
          }
          const fields = Object.fromEntries([...auth.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)].map((m) => [m[1], m[2] ?? m[3]]));
          digestUsed.push(fields);
          const expected = digestAuthorization(DIGEST, 'maker', 'secret', req.method, req.url, parseInt(fields.nc, 16), fields.cnonce);
          if (expected !== auth) {
            res.writeHead(401, { 'www-authenticate': `Digest realm="${DIGEST.realm}", qop="auth", nonce="${DIGEST.nonce}"` });
            return res.end();
          }
        }
      }
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=1', 'x-custom': 'yes' });
      res.end(JSON.stringify({ method: req.method, bytes: body.length }));
    });
    const wss = new WebSocketServer({
      server: upstream,
      verifyClient: (_info, done) => setTimeout(() => done(true), wsUpgradeDelayMs)
    });
    wss.on('connection', (ws, req) => {
      ws.on('message', (data, isBinary) => {
        wsReceived.push({ data: isBinary ? data : data.toString(), isBinary, origin: req.headers.origin, host: req.headers.host });
        ws.send(data, { binary: isBinary });
      });
    });
    upstreamPort = await listen(upstream);
  });

  after(async () => {
    upstream.closeAllConnections();
    await close(upstream);
  });

  const reset = () => {
    seen = [];
    wsReceived = [];
    heldResponses = [];
    wsUpgradeDelayMs = 0;
    digestUsed.length = 0;
  };

  test('status endpoint reports the mode', async () => {
    for (const [options, expected] of [[{}, { enabled: false, mode: 'off', readOnly: false }],
      [{ proxy: 'private', readOnly: true }, { enabled: true, mode: 'private', readOnly: true }],
      [{ proxy: '10.0.0.1' }, { enabled: true, mode: 'list', readOnly: false }]]) {
      const gw = await startGateway(options);
      const status = await (await fetch(`${gw.url}/_printer/status`)).json();
      assert.deepEqual({ enabled: status.enabled, mode: status.mode, readOnly: status.readOnly }, expected);
      if (!status.enabled) assert.match(status.message, /ORCA_PRINTER_PROXY/);
      await gw.close();
    }
  });

  test('is off by default and refuses public targets', async () => {
    reset();
    let gw = await startGateway({});
    let res = await fetch(`${gw.url}/_printer/http/127.0.0.1:${upstreamPort}/x`);
    assert.equal(res.status, 403);
    assert.match(await res.text(), /gateway is off/);
    await gw.close();

    gw = await startGateway({ proxy: 'private' });
    res = await fetch(`${gw.url}/_printer/http/8.8.8.8/`);
    assert.equal(res.status, 403);
    assert.match(await res.text(), /not on a private network/);
    assert.equal(seen.length, 0);
    await gw.close();
  });

  test('proxies GET: strips Origin/Cookie, sets Host, drops Set-Cookie', async () => {
    reset();
    const gw = await startGateway({ proxy: 'private' });
    const res = await fetch(`${gw.url}/_printer/http/127.0.0.1:${upstreamPort}/printer/info?x=1`, {
      headers: { origin: 'http://evil.example', cookie: 'a=b', 'x-api-key': 'k' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-custom'), 'yes');
    assert.equal(res.headers.get('set-cookie'), null);
    assert.deepEqual(await res.json(), { method: 'GET', bytes: 0 });
    const { url, headers } = seen[0];
    assert.equal(url, '/printer/info?x=1');
    assert.equal(headers.origin, undefined);
    assert.equal(headers.cookie, undefined);
    assert.equal(headers['x-api-key'], 'k');
    assert.equal(headers.host, `127.0.0.1:${upstreamPort}`);
    await gw.close();
  });

  test('connects to the address that passed the check, not to a second DNS answer', async () => {
    reset();
    const resolver = async (host) => (host === 'printer.test' ? ['127.0.0.1'] : ['8.8.8.8']);
    const gw = await startGateway({ proxy: 'private', resolver });
    const res = await fetch(`${gw.url}/_printer/http/printer.test:${upstreamPort}/x`);
    assert.equal(res.status, 200);
    assert.equal(seen[0].headers.host, `printer.test:${upstreamPort}`);
    assert.equal((await fetch(`${gw.url}/_printer/http/evil.test:${upstreamPort}/x`)).status, 403);
    await gw.close();
  });

  test('streams uploads byte for byte', async () => {
    reset();
    const gw = await startGateway({ proxy: 'private' });
    const payload = Buffer.alloc(6 * 1024 * 1024, 7);
    payload.writeUInt32LE(0xdeadbeef, 1_000_000);
    const res = await fetch(`${gw.url}/_printer/http/127.0.0.1:${upstreamPort}/server/files/upload`, {
      method: 'POST', body: payload, headers: { 'content-type': 'application/octet-stream' }
    });
    assert.deepEqual(await res.json(), { method: 'POST', bytes: payload.length });
    assert.ok(seen[0].body.equals(payload));
    await gw.close();
  });

  test('forwards response chunks as they arrive (camera streams)', async () => {
    reset();
    const gw = await startGateway({ proxy: 'private' });
    const res = await fetch(`${gw.url}/_printer/http/127.0.0.1:${upstreamPort}/stream`);
    const reader = res.body.getReader();
    const started = Date.now();
    const first = await reader.read();
    assert.equal(Buffer.from(first.value).toString(), 'frame1');
    assert.ok(Date.now() - started < 250, 'first frame must not wait for the end of the stream');
    let rest = '';
    for (let r = await reader.read(); !r.done; r = await reader.read()) rest += Buffer.from(r.value).toString();
    assert.equal(rest, 'frame2');
    await gw.close();
  });

  test('closes the upstream request when the client goes away', async () => {
    reset();
    const gw = await startGateway({ proxy: 'private' });
    const controller = new AbortController();
    const res = await fetch(`${gw.url}/_printer/http/127.0.0.1:${upstreamPort}/hold`, { signal: controller.signal });
    assert.equal(res.status, 200);
    const closed = new Promise((resolve) => heldResponses[0].on('close', resolve));
    controller.abort();
    await Promise.race([closed, sleep(2000).then(() => assert.fail('upstream was not closed'))]);
    await gw.close();
  });

  test('read-only mode never reaches the printer with a mutating request', async () => {
    reset();
    const gw = await startGateway({ proxy: 'private', readOnly: true });
    const base = `${gw.url}/_printer/http/127.0.0.1:${upstreamPort}`;
    for (const [method, path] of [['POST', '/server/files/upload'], ['DELETE', '/server/files/gcodes/a.gcode'],
      ['PUT', '/api/v1/files/usb/a.gcode'], ['GET', '/printer/gcode/script?script=G28'], ['GET', '/printer/print/start?filename=a.gcode'],
      ['GET', '/printer/emergency_stop']]) {
      const res = await fetch(base + path, { method, body: method === 'GET' ? undefined : 'x' });
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.match(await res.text(), /Read-only mode/);
    }
    assert.equal(seen.length, 0);
    assert.equal((await fetch(`${base}/server/info`)).status, 200);
    assert.equal(seen.length, 1);
    await gw.close();
  });

  test('digest authentication for PrusaLink: nonce is reused with an increasing nc', async () => {
    reset();
    const gw = await startGateway({ proxy: 'private' });
    const base = `${gw.url}/_printer/http/127.0.0.1:${upstreamPort}`;
    const good = { 'x-orca-auth': 'digest maker:secret' };
    assert.equal((await fetch(`${base}/protected`, { headers: good })).status, 200);
    assert.equal((await fetch(`${base}/protected`, { headers: good })).status, 200);
    assert.deepEqual(digestUsed.map((f) => f.nc), ['00000001', '00000002']);
    assert.equal(seen.find((r) => r.url === '/protected').headers['x-orca-auth'], undefined, 'credentials stay in the gateway');
    assert.equal((await fetch(`${base}/protected`, { headers: { 'x-orca-auth': 'digest maker:wrong' } })).status, 401);
    await gw.close();
  });

  describe('websocket', () => {
    const open = (url) => new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const messages = [];
      ws.on('message', (data, isBinary) => messages.push(isBinary ? data : data.toString()));
      ws.on('open', () => resolve({ ws, messages }));
      ws.on('error', reject);
    });
    const until = async (predicate, what) => {
      for (let i = 0; i < 100 && !predicate(); i++) await sleep(20);
      assert.ok(predicate(), what);
    };

    test('relays text and binary frames and hides the browser Origin', async () => {
      reset();
      const gw = await startGateway({ proxy: 'private' });
      const { ws, messages } = await open(`${gw.wsUrl}/_printer/ws/127.0.0.1:${upstreamPort}/websocket`);
      ws.send('hello');
      ws.send(Buffer.from([1, 2, 3]));
      await until(() => messages.length === 2, 'both echoes arrive');
      assert.equal(messages[0], 'hello');
      assert.deepEqual([...messages[1]], [1, 2, 3]);
      assert.equal(wsReceived[0].origin, undefined);
      assert.equal(wsReceived[0].host, `127.0.0.1:${upstreamPort}`);
      ws.close();
      await gw.close();
    });

    test('keeps frames sent while the upstream is still connecting', async () => {
      reset();
      wsUpgradeDelayMs = 300;
      const gw = await startGateway({ proxy: 'private' });
      const { ws, messages } = await open(`${gw.wsUrl}/_printer/ws/127.0.0.1:${upstreamPort}/websocket`);
      ws.send('first');
      ws.send('second');
      await until(() => messages.length === 2, 'frames sent before the upstream opened are delivered');
      assert.deepEqual(messages, ['first', 'second']);
      ws.close();
      await gw.close();
    });

    test('read-only mode filters client frames and fails closed', async () => {
      reset();
      const gw = await startGateway({ proxy: 'private', readOnly: true });
      const { ws, messages } = await open(`${gw.wsUrl}/_printer/ws/127.0.0.1:${upstreamPort}/websocket`);
      const ok = '{"jsonrpc":"2.0","method":"printer.objects.query","params":{"objects":{"extruder":null}},"id":1}';
      ws.send(ok);
      ws.send('{"jsonrpc":"2.0","method":"printer.gcode.script","params":{"script":"G28"},"id":2}');
      ws.send('[{"method":"server.info","id":3},{"method":"printer.print.cancel","id":4}]');
      ws.send('this is not json');
      ws.send(Buffer.from('{"method":"printer.gcode.script","id":5}'));
      ws.send('{"jsonrpc":"2.0","method":"server.info","id":6}');
      await until(() => wsReceived.length === 2 && messages.filter((m) => typeof m === 'string' && m.includes('"error"')).length === 2, 'allowed frames pass, refused ones get errors');
      await sleep(200);
      assert.deepEqual(wsReceived.map((m) => m.data), [ok, '{"jsonrpc":"2.0","method":"server.info","id":6}']);
      const errors = messages.filter((m) => typeof m === 'string' && m.includes('"error"')).map((m) => JSON.parse(m).id).sort();
      assert.deepEqual(errors, [2, 4]);
      ws.close();
      await gw.close();
    });

    test('tells the client why an unreachable printer failed', async () => {
      reset();
      const free = await new Promise((resolve) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
      });
      const gw = await startGateway({ proxy: 'private' });
      const { ws, messages } = await open(`${gw.wsUrl}/_printer/ws/127.0.0.1:${free}/websocket`);
      await new Promise((resolve) => ws.on('close', resolve));
      assert.match(JSON.parse(messages[0]).orca_gateway_error, /refused/i);
      await gw.close();
    });

    test('refuses websocket targets outside the policy', async () => {
      const gw = await startGateway({ proxy: 'private' });
      const ws = new WebSocket(`${gw.wsUrl}/_printer/ws/8.8.8.8/websocket`);
      const status = await new Promise((resolve) => ws.on('unexpected-response', (_req, res) => resolve(res.statusCode)));
      assert.equal(status, 403);
      await gw.close();
    });
  });

  describe('Bambu Lab bridge', () => {
    const SERIAL = '01S00A000000000';
    let broker;
    let tcp;
    let brokerPort;
    let published; // [{topic, payload}] seen by the broker from the bridge
    let subscribed;
    const brokerSockets = new Set();

    before(async () => {
      broker = await Aedes.createBroker();
      broker.authenticate = (_client, username, password, callback) => callback(null, username === 'bblp' && password?.toString() === '12345678');
      broker.on('publish', (packet, client) => client && published.push({ topic: packet.topic, payload: JSON.parse(packet.payload.toString()) }));
      broker.on('subscribe', (subs) => subs.forEach((s) => subscribed.push(s.topic)));
      tcp = net.createServer(broker.handle);
      tcp.on('connection', (socket) => brokerSockets.add(socket));
      brokerPort = await listen(tcp);
    });

    after(async () => {
      brokerSockets.forEach((socket) => socket.destroy());
      await Promise.race([new Promise((resolve) => broker.close(resolve)), sleep(2000)]);
      await close(tcp);
    });

    const bridge = async (t, readOnly) => {
      published = [];
      subscribed = [];
      const gw = await startGateway({ proxy: 'private', readOnly, bambu: { mqttProtocol: 'mqtt', mqttPort: brokerPort } });
      const ws = new WebSocket(`${gw.wsUrl}/_printer/bambu/mqtt/127.0.0.1`);
      const messages = [];
      ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
      await new Promise((resolve) => ws.on('open', resolve));
      t.after(async () => {
        ws.terminate();
        await gw.close();
      });
      return { gw, ws, messages };
    };
    const until = async (predicate, what) => {
      for (let i = 0; i < 150 && !predicate(); i++) await sleep(20);
      assert.ok(predicate(), what);
    };

    test('connects, asks for a full report, relays reports and publishes to the request topic only', async (t) => {
      const { ws, messages } = await bridge(t, false);
      ws.send(JSON.stringify({ type: 'connect', serial: SERIAL, accessCode: '12345678' }));
      await until(() => messages.some((m) => m.type === 'connected'), 'connected');
      assert.deepEqual(subscribed, [`device/${SERIAL}/report`]);
      await until(() => published.length === 2, 'initial requests');
      assert.deepEqual(published.map((p) => [p.topic, Object.keys(p.payload)[0], Object.values(p.payload)[0].command]),
        [[`device/${SERIAL}/request`, 'info', 'get_version'], [`device/${SERIAL}/request`, 'pushing', 'pushall']]);

      const printer = mqtt.connect({ protocol: 'mqtt', host: '127.0.0.1', port: brokerPort, username: 'bblp', password: '12345678' });
      await new Promise((resolve) => printer.on('connect', resolve));
      printer.publish(`device/${SERIAL}/report`, JSON.stringify({ print: { gcode_state: 'RUNNING', mc_percent: 42, nozzle_temper: 215.5 } }));
      await until(() => messages.some((m) => m.type === 'report'), 'report relayed');
      assert.deepEqual(messages.find((m) => m.type === 'report').payload.print.mc_percent, 42);
      printer.end(true);

      const fromBridge = () => published.filter((p) => p.topic.endsWith('/request'));
      ws.send(JSON.stringify({ type: 'publish', topic: 'device/OTHER/request', payload: { print: { command: 'pause' } } }));
      await until(() => fromBridge().length === 3, 'publish forwarded');
      assert.equal(fromBridge()[2].topic, `device/${SERIAL}/request`, 'the client cannot choose the topic');
      assert.deepEqual(fromBridge()[2].payload, { print: { command: 'pause' } });
    });

    test('wrong access code is reported', async (t) => {
      const { ws, messages } = await bridge(t, false);
      ws.send(JSON.stringify({ type: 'connect', serial: SERIAL, accessCode: 'wrong' }));
      await until(() => messages.some((m) => m.type === 'error'), 'error message');
      assert.equal(messages.some((m) => m.type === 'connected'), false);
    });

    test('rejects a malformed serial', async (t) => {
      const { ws, messages } = await bridge(t, false);
      ws.send(JSON.stringify({ type: 'connect', serial: '../../x', accessCode: '12345678' }));
      await until(() => messages.some((m) => m.type === 'error'), 'error message');
      assert.equal(published.length, 0);
    });

    test('read-only mode only lets status requests through', async (t) => {
      const { ws, messages } = await bridge(t, true);
      ws.send(JSON.stringify({ type: 'connect', serial: SERIAL, accessCode: '12345678' }));
      await until(() => published.length === 2, 'initial requests');
      for (const payload of [{ print: { command: 'stop' } }, { system: { command: 'ledctrl' } }, { pushing: { command: 'pushall' }, print: { command: 'stop' } }]) {
        ws.send(JSON.stringify({ type: 'publish', payload }));
      }
      ws.send(JSON.stringify({ type: 'publish', payload: { pushing: { sequence_id: '1', command: 'pushall' } } }));
      await until(() => published.length === 3, 'the status request is forwarded');
      await sleep(200);
      assert.equal(published.length, 3);
      assert.equal(messages.filter((m) => m.type === 'error').length, 3);
    });

    test('FTP uploads are refused in read-only mode and for unsafe names', async () => {
      reset();
      const readOnly = await startGateway({ proxy: 'private', readOnly: true });
      let res = await fetch(`${readOnly.url}/_printer/bambu/ftp/127.0.0.1`, { method: 'POST', body: 'x', headers: { 'x-bambu-filename': 'a.gcode', 'x-bambu-access-code': '1' } });
      assert.equal(res.status, 403);
      await readOnly.close();

      const gw = await startGateway({ proxy: 'private' });
      for (const name of ['../a.gcode', 'a/b.gcode', 'a.sh', '']) {
        res = await fetch(`${gw.url}/_printer/bambu/ftp/127.0.0.1`, { method: 'POST', body: 'x', headers: { 'x-bambu-filename': encodeURIComponent(name), 'x-bambu-access-code': '1' } });
        assert.equal(res.status, 400, name);
      }
      res = await fetch(`${gw.url}/_printer/bambu/ftp/127.0.0.1`, { method: 'POST', body: 'x', headers: { 'x-bambu-filename': 'a.gcode' } });
      assert.equal(res.status, 400);
      await gw.close();
    });
  });
});
