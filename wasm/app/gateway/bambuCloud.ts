/** Bambu Cloud HTTP API handler shared by local and hosted gateways; no LAN or MQTT imports. */
import * as http from 'node:http';
import * as https from 'node:https';
import { configFromEnv } from './policy.ts';
import type { GatewayConfig } from './policy.ts';

export interface BambuCloudGatewayOptions extends GatewayConfig {
  bambuCloud?: { apiHost?: string; apiPort?: number; apiProtocol?: 'http' | 'https'; apiRejectUnauthorized?: boolean; mqttHost?: string; mqttPort?: number; mqttProtocol?: 'mqtt' | 'mqtts'; mqttRejectUnauthorized?: boolean };
}

const BAMBU_CLOUD_API_ALLOWLIST = new Set([
  'POST /v1/user-service/user/login',
  'GET /v1/iot-service/api/user/bind',
  'GET /v1/design-user-service/my/preference'
]);

function fail(res: http.ServerResponse, status: number, message: string) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(message);
}

export async function handleBambuCloudApi(req: http.IncomingMessage, res: http.ServerResponse, path: string, options: BambuCloudGatewayOptions) {
  if (!(options.cloud ?? configFromEnv().cloud ?? '').split(',').map(value => value.trim()).includes('bambu-cloud')) {
    fail(res, 403, 'Bambu Cloud is not enabled on this gateway.');
    return;
  }
  const method = (req.method || 'GET').toUpperCase();
  const allowKey = `${method} ${path}`;
  if (!BAMBU_CLOUD_API_ALLOWLIST.has(allowKey)) {
    fail(res, 403, 'Cloud API endpoint not in allowlist');
    return;
  }

  const apiHost = options.bambuCloud?.apiHost ?? 'api.bambulab.com';
  const reqHeaders: http.OutgoingHttpHeaders = {
    'host': apiHost,
    'accept': 'application/json'
  };

  if (req.headers['content-type']) reqHeaders['content-type'] = req.headers['content-type'];
  if (req.headers['content-length']) reqHeaders['content-length'] = req.headers['content-length'];
  if (req.headers['authorization']) reqHeaders['authorization'] = req.headers['authorization'];

  const requestFn: typeof https.request = options.bambuCloud?.apiProtocol === 'http' ? http.request : https.request;
  const creq = requestFn({
    method,
    hostname: apiHost,
    port: options.bambuCloud?.apiPort ?? 443,
    path,
    headers: reqHeaders,
    timeout: 15_000,
    rejectUnauthorized: options.bambuCloud?.apiRejectUnauthorized ?? true
  }, (cres) => {
    res.statusCode = cres.statusCode || 500;
    res.setHeader('content-type', cres.headers['content-type'] || 'application/json');
    cres.pipe(res);
  });

  creq.on('timeout', () => creq.destroy(new Error('Cloud API did not answer in time.')));
  creq.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException).code;
    const message = code === 'ECONNREFUSED' ? 'The printer refused the connection.'
      : code === 'EHOSTUNREACH' || code === 'ENETUNREACH' ? 'The printer is unreachable.'
      : code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' ? 'The printer did not answer in time.'
      : err.message;
    fail(res, 502, message);
  });
  res.on('close', () => { if (!res.writableFinished) creq.destroy(); });
  req.pipe(creq);
}
