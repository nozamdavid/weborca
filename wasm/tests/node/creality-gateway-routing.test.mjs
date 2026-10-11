import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { close, listen, startGateway } from './lib/gatewayHarness.mjs';

test('Creality dedicated bridge is opt-in and never grants generic cloud proxy access', async () => {
  let upstreamCalls = 0;
  const upstream = http.createServer((req, res) => {
    upstreamCalls++;
    req.resume();
    res.setHeader('content-type', 'application/json');
    res.setHeader('set-cookie', 'upstream-session=private; Path=/');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('cache-control', 'public, max-age=3600');
    res.end(JSON.stringify({ code: 0, result: { list: [] } }));
  });
  const port = await listen(upstream);
  const gateway = await startGateway({ readOnly: true, cloud: 'creality-cloud', crealityCloud: { apiHost: '127.0.0.1', apiPort: port, apiProtocol: 'http' } });
  const off = await startGateway({ cloud: '' });
  try {
    const status = await fetch(gateway.url + '/_printer/status').then(r => r.json());
    assert.equal(status.enabled, true);
    assert.equal(status.mode, 'cloud');
    assert.deepEqual(status.cloud, ['creality-cloud']);
    const endpoint = '/_printer/creality-cloud/global/api/api/rest/print/cluster/devices/getDevices';
    const response = await fetch(gateway.url + endpoint, { method: 'POST', body: '{}' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(upstreamCalls, 1);
    assert.equal((await fetch(off.url + endpoint, { method: 'POST', body: '{}' })).status, 403);
    assert.equal((await fetch(gateway.url + '/_printer/https/api.crealitycloud.com/api/rest/print/cluster/devices/getDevices')).status, 403);
    assert.equal((await fetch(gateway.url + '/_printer/creality-cloud/global/api/api/rest/print/cluster/devices/addSingleTask', { method: 'POST', body: '{}' })).status, 403);
    const upgradeStatus = await new Promise((resolve, reject) => {
      const request = http.request(gateway.url + endpoint, {
        headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' }
      }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
      request.setTimeout(2000, () => request.destroy(new Error('Upgrade response timeout')));
      request.end();
    });
    assert.equal(upgradeStatus, 400);
    assert.equal(upstreamCalls, 1, 'rejected commands and upgrades never reach upstream');
  } finally { await gateway.close(); await off.close(); await close(upstream); }
});


test('a truncated cloud response closes the client response without crashing the gateway', async () => {
  const upstream = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '200' });
    res.write('{"code":');
    setTimeout(() => res.destroy(), 10);
  });
  const port = await listen(upstream);
  const gateway = await startGateway({ cloud: 'creality-cloud', crealityCloud: { apiHost: '127.0.0.1', apiPort: port, apiProtocol: 'http' } });
  try {
    await assert.rejects(async () => {
      const response = await fetch(gateway.url + '/_printer/creality-cloud/global/api/api/rest/print/cluster/devices/getDevices', { method: 'POST', body: '{}' });
      await response.text();
    });
    assert.equal((await fetch(gateway.url + '/_printer/status')).status, 200);
  } finally { await gateway.close(); await close(upstream); }
});
