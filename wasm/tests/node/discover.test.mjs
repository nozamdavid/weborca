/**
 * Printer discovery (wasm/app/gateway/discover.ts): HTTP probes for Moonraker, OctoPrint and PrusaLink and the Bambu
 * SSDP search, against mock servers on 127.0.0.1, then through the local gateway's /_gw/discover endpoint.
 */
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { discoverPrinters, localScanHosts } from '../../app/gateway/discover.ts';
import { startLocalGateway } from '../../app/gateway/local.ts';
import { close, listen } from './lib/gatewayHarness.mjs';

const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const mockServer = (handler) => http.createServer((req, res) => handler(req, res));

describe('discovery', () => {
  const servers = {};
  const ports = {};
  let ssdp, ssdpPort;

  before(async () => {
    servers.moonraker = mockServer((req, res) => (req.url === '/server/info' ? json(res, { result: { klippy_state: 'ready', moonraker_version: 'v0.9' } }) : json(res, {}, 404)));
    // Moonraker emulates OctoPrint's /api/version; it must still be reported as Moonraker only
    servers.octoprint = mockServer((req, res) => {
      if (req.url === '/api/version') return json(res, { text: 'OctoPrint 1.10.0' });
      res.writeHead(404); res.end();
    });
    servers.octoprintLocked = mockServer((req, res) => {
      if (req.url === '/api/version') { res.writeHead(403); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><head><title>OctoPrint</title></head></html>');
    });
    servers.prusalink = mockServer((req, res) => {
      if (req.url === '/api/version') { res.writeHead(401, { 'www-authenticate': 'Digest realm="Printer API", nonce="x"' }); return res.end(); }
      res.writeHead(404); res.end();
    });
    servers.other = mockServer((_req, res) => { res.writeHead(200); res.end('hello'); });
    for (const [name, server] of Object.entries(servers)) ports[name] = await listen(server);

    ssdp = dgram.createSocket('udp4');
    ssdp.on('message', (_msg, remote) => {
      const reply = ['HTTP/1.1 200 OK', 'ST: urn:bambulab-com:device:3dprinter:1', 'USN: 01P00A123456789', 'Location: 127.0.0.1', 'DevName.bambu.com: Shelf P1P', 'DevModel.bambu.com: C11', '', ''].join('\r\n');
      ssdp.send(reply, remote.port, remote.address);
    });
    await new Promise((resolve) => ssdp.bind(0, '127.0.0.1', resolve));
    ssdpPort = ssdp.address().port;
  });
  after(async () => {
    ssdp.close();
    for (const server of Object.values(servers)) { server.closeAllConnections(); await close(server); }
  });

  const scan = async (extra = {}) => {
    const found = [];
    await discoverPrinters({ hosts: ['127.0.0.1'], ports: Object.values(ports), ssdp: { address: '127.0.0.1', port: ssdpPort }, ssdpMs: 500, timeoutMs: 1000, ...extra }, (p) => found.push(p));
    return found;
  };

  test('finds each protocol and ignores other servers', async () => {
    const found = await scan();
    const byType = (type) => found.filter((p) => p.host_type === type);
    assert.deepEqual(byType('moonraker').map((p) => p.host), [`127.0.0.1:${ports.moonraker}`]);
    assert.deepEqual(byType('prusalink').map((p) => p.host), [`127.0.0.1:${ports.prusalink}`]);
    assert.deepEqual(byType('octoprint').map((p) => p.host).sort(), [`127.0.0.1:${ports.octoprint}`, `127.0.0.1:${ports.octoprintLocked}`].sort());
    assert.equal(found.some((p) => p.host.endsWith(`:${ports.other}`)), false);
    assert.deepEqual(byType('bambu').map((p) => [p.host, p.serial, p.name, p.detail]), [['127.0.0.1', '01P00A123456789', 'Shelf P1P', 'C11']]);
  });

  test('can be cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    assert.deepEqual(await scan({ signal: abort.signal }), []);
  });

  test('scans only private /24 networks of this computer, not itself', () => {
    const hosts = localScanHosts({
      eth0: [{ family: 'IPv4', address: '192.168.0.10', internal: false }],
      lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      vpn: [{ family: 'IPv4', address: '8.8.4.4', internal: false }]
    });
    assert.equal(hosts.length, 253);
    assert.ok(hosts.includes('192.168.0.238') && !hosts.includes('192.168.0.10'));
    assert.ok(hosts.every((h) => h.startsWith('192.168.0.')));
  });

  test('the local gateway streams results to an allowed app only', async () => {
    const gateway = await startLocalGateway({ allowedOrigins: ['https://app.example'], port: 0, readOnly: true, discover: { hosts: ['127.0.0.1'], ports: [ports.moonraker], ssdp: false } });
    try {
      const get = (headers) => fetch(`http://127.0.0.1:${gateway.port}/_gw/discover`, { headers });
      assert.equal((await get({})).status, 403);
      const res = await get({ origin: 'https://app.example' });
      assert.equal(res.status, 200);
      const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
      assert.deepEqual(lines.map((l) => l.host_type ?? 'done'), ['moonraker', 'done']);
    } finally { await gateway.close(); }
  });
});
