import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { WebSocket } from 'ws';
import { close, listen, startGateway } from './lib/gatewayHarness.mjs';
import http from 'node:http';
import net from 'node:net';

describe('Bambu Cloud integration', () => {
  let gateway;
  let apiServer;
  let mqttServer;
  let apiPort;
  let mqttPort;
  let mqttPublishes = 0;

  before(async () => {
    // Mock API server
    apiServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/v1/user-service/user/login') {
          const data = JSON.parse(body || '{}');
          if (data.account === 'test@example.com' && data.password === 'badpassword') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Incorrect account or password.' }));
          } else if (data.account === 'test@example.com' && data.password === 'goodpassword') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ accessToken: 'valid_token' }));
          } else {
            res.writeHead(400);
            res.end();
          }
        } else if (req.method === 'GET' && req.url === '/v1/iot-service/api/user/bind') {
          if (req.headers['authorization'] !== 'Bearer valid_token') {
            res.writeHead(401);
            res.end();
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ devices: [{ dev_id: '123', name: 'Mock Printer' }] }));
          }
        } else if (req.method === 'GET' && req.url === '/v1/design-user-service/my/preference') {
          if (req.headers['authorization'] !== 'Bearer valid_token') {
            res.writeHead(401);
            res.end();
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ uid: 123456 }));
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    apiPort = await listen(apiServer);

    mqttServer = net.createServer((socket) => {
      socket.on('data', (data) => {
        if ((data[0] & 0xF0) === 0x30) mqttPublishes++;
        if (data[0] === 0x10) {
            socket.write(Buffer.from([0x20, 0x02, 0x00, 0x00]));
        } else if ((data[0] & 0xF0) === 0x80) {
            socket.write(Buffer.from([0x90, 0x03, data[2], data[3], 0x00]));
        }
      });
    });
    mqttPort = await listen(mqttServer);

    gateway = await startGateway({ 
      readOnly: true,
      cloud: 'bambu-cloud',
      bambuCloud: {
        apiHost: '127.0.0.1',
        apiPort: apiPort,
        apiProtocol: 'http',
        mqttHost: '127.0.0.1',
        mqttPort: mqttPort,
        mqttProtocol: 'mqtt',
      }
    });
  });

  after(async () => {
    if (gateway) await gateway.close();
    if (apiServer) await close(apiServer);
    if (mqttServer) await close(mqttServer);
  });

  test('HTTP: Rejected paths and hosts', async () => {
    const status = await (await fetch(`${gateway.url}/_printer/status`)).json();
    assert.equal(status.enabled, true);
    assert.equal(status.mode, 'cloud');
    assert.deepEqual(status.cloud, ['bambu-cloud']);
    const res = await fetch(`${gateway.url}/_printer/bambu-cloud/api/v1/user-service/bad/endpoint`, {
      method: 'POST'
    });
    assert.equal(res.status, 403);
    const text = await res.text();
    assert.match(text, /not in allowlist/);
    const generic = await fetch(`${gateway.url}/_printer/https/api.bambulab.com/v1/user-service/user/login`, { method: 'POST' });
    assert.equal(generic.status, 403, 'cloud opt-in does not open an unrestricted generic proxy');
  });

  test('HTTP: Cloud access is disabled without explicit opt-in', async () => {
    const disabled = await startGateway({ cloud: '', proxy: '' });
    try {
      const response = await fetch(`${disabled.url}/_printer/bambu-cloud/api/v1/iot-service/api/user/bind`);
      assert.equal(response.status, 403);
      assert.match(await response.text(), /not enabled/);
    } finally { await disabled.close(); }
  });

  test('HTTP: Authentication challenge', async () => {
    const resLogin = await fetch(`${gateway.url}/_printer/bambu-cloud/api/v1/user-service/user/login`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'test@example.com', password: 'badpassword' })
    });
    assert.equal(resLogin.status, 400);
    const data = await resLogin.json();
    assert.ok(data.error === 'Incorrect account or password.');
    
    const resBind = await fetch(`${gateway.url}/_printer/bambu-cloud/api/v1/iot-service/api/user/bind`, { method: 'GET' });
    assert.equal(resBind.status, 401);

    const resLoginGood = await fetch(`${gateway.url}/_printer/bambu-cloud/api/v1/user-service/user/login`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'test@example.com', password: 'goodpassword' })
    });
    assert.equal(resLoginGood.status, 200);
    const dataGood = await resLoginGood.json();
    assert.equal(dataGood.accessToken, 'valid_token');

    const resBindGood = await fetch(`${gateway.url}/_printer/bambu-cloud/api/v1/iot-service/api/user/bind`, { 
      method: 'GET',
      headers: { 'Authorization': 'Bearer valid_token' }
    });
    assert.equal(resBindGood.status, 200);
    const dataBind = await resBindGood.json();
    assert.equal(dataBind.devices[0].dev_id, '123');
  });

  test('MQTT: Authentication, rejected brokers, and read-only', async () => {
    const wsBad = new WebSocket(`${gateway.wsUrl}/_printer/bambu-cloud/mqtt/bad.broker.com`);
    wsBad.on('error', () => {});
    const status = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Broker rejection was not received')), 1000);
      wsBad.on('unexpected-response', (_request, response) => {
        clearTimeout(timer);
        resolve(response.statusCode);
        response.resume();
        wsBad.terminate();
      });
    });
    assert.equal(status, 403, 'a test transport override must preserve the broker allowlist');

    const ws = new WebSocket(`${gateway.wsUrl}/_printer/bambu-cloud/mqtt/us.mqtt.bambulab.com`);
    await new Promise((resolve) => ws.on('open', resolve));
    
    // Connect successfully
    ws.send(JSON.stringify({ type: 'connect', serial: '123', username: 'abc', token: 'xyz' }));
    
    await new Promise((resolve) => {
        const check = (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'connected') {
                ws.off('message', check);
                resolve();
            }
        };
        ws.on('message', check);
    });

    // Malformed JSON values must not crash the gateway's message handler.
    ws.send('null');
    ws.send('[]');
    ws.send('{');
    const errPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Read-only rejection was not received')), 1000);
      const check = data => {
        const message = JSON.parse(data.toString());
        if (message.type === 'error') {
          clearTimeout(timer);
          ws.off('message', check);
          resolve(message.message);
        }
      };
      ws.on('message', check);
    });
    ws.send(JSON.stringify({ type: 'publish', payload: { print: { command: 'gcode' } } }));
    assert.match(await errPromise, /read-only/);
    assert.equal(mqttPublishes, 0, 'the rejected command was not sent upstream');

    ws.close();
  });
});
