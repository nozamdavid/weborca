/** Bambu Cloud HTTP API handler shared by local and hosted gateways; no LAN or MQTT imports. */
import * as http from 'node:http';
import * as https from 'node:https';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { configFromEnv } from './policy.ts';
import type { GatewayConfig } from './policy.ts';

export interface BambuCloudGatewayOptions extends GatewayConfig {
  bambuCloud?: { apiHost?: string; apiPort?: number; apiProtocol?: 'http' | 'https'; apiRejectUnauthorized?: boolean; mqttHost?: string; mqttPort?: number; mqttProtocol?: 'mqtt' | 'mqtts'; mqttRejectUnauthorized?: boolean };
}

const BAMBU_CLOUD_API_ALLOWLIST = new Set([
  'POST /v1/user-service/user/login',
  'POST /v1/user-service/user/refreshtoken',
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

export function makerWorldDestination(value: string): URL {
  if (typeof value !== 'string' || /%|\\|\/\.\.?\//.test(value.split('?')[0])) throw new Error('Unsupported model destination.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'makerworld.bblmw.com' || url.port ||
    url.username || url.password || url.hash ||
    !/^\/makerworld\/model\/[A-Za-z0-9_/-]+\.3mf$/.test(url.pathname)) throw new Error('Unsupported model destination.');
  return url;
}

export const MODEL_BYTE_LIMIT = 100 * 1024 * 1024;
export function modelByteLimiter(limit = MODEL_BYTE_LIMIT) {
  let size = 0;
  return new Transform({ transform(chunk, _encoding, callback) {
    size += chunk.length;
    callback(size > limit ? new Error('Model exceeds size limit.') : null, chunk);
  } });
}

async function relayModel(req: http.IncomingMessage, res: http.ServerResponse) {
  res.setHeader('cache-control', 'no-store');
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); if (!req.complete) req.destroy(); }, 60_000);
  const disconnect = () => { if (!res.writableFinished) controller.abort(); };
  res.on('close', disconnect);
  req.on('aborted', disconnect);
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk.toString();
      if (body.length > 16_384) { fail(res, 413, 'Model request exceeds limit.'); return; }
    }
    let url: URL;
    try { url = makerWorldDestination(JSON.parse(body).url); }
    catch { fail(res, 400, 'Unsupported model destination.'); return; }
    await new Promise<void>((resolve, reject) => {
      // Deliberately create fresh headers: account authorization and cookies never reach the CDN.
      const upstream = https.get(url, { headers: { accept: 'application/octet-stream' }, signal: controller.signal }, response => {
        const bytes = Number(response.headers['content-length']);
        if (response.statusCode !== 200 || bytes > MODEL_BYTE_LIMIT) {
          response.destroy(); reject(new Error('Model unavailable or exceeds limit.')); return;
        }
        res.setHeader('content-type', 'application/octet-stream');
        res.setHeader('x-content-type-options', 'nosniff');
        if (!response.headers['content-encoding'] && Number.isSafeInteger(bytes) && bytes > 0) {
          res.setHeader('content-length', bytes);
        }
        pipeline(response, modelByteLimiter(), res).then(resolve, reject);
      });
      upstream.on('error', reject);
    });
  } catch { fail(res, 502, 'Model transfer failed. Retry the download.'); }
  finally { clearTimeout(timer); controller.abort(); res.off('close', disconnect); req.off('aborted', disconnect); }
}

export async function handleBambuCloudApi(req: http.IncomingMessage, res: http.ServerResponse, path: string, options: BambuCloudGatewayOptions) {
  if (!(options.cloud ?? configFromEnv().cloud ?? '').split(',').map(value => value.trim()).includes('bambu-cloud')) {
    fail(res, 403, 'Bambu Cloud is not enabled on this gateway.');
    return;
  }
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'POST' && path === '/v1/design-service/model-bytes') {
    await relayModel(req, res);
    return;
  }
  const allowKey = `${method} ${path}`;
  const modelRead = method === 'GET' && /^\/v1\/design-service\/(?:design\/[1-9]\d*|instance\/[1-9]\d*\/f3mf\?type=download)$/.test(path);
  if (!BAMBU_CLOUD_API_ALLOWLIST.has(allowKey) && !modelRead) {
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
    res.setHeader('cache-control', 'no-store');
    if (modelRead) {
      // Account metadata only: never relay redirects or model bytes.
      if (cres.statusCode !== 200 || !String(cres.headers['content-type']).includes('application/json')) {
        cres.resume();
        fail(res, cres.statusCode === 401 || cres.statusCode === 403 ? cres.statusCode : 502, 'Model metadata unavailable.');
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      cres.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2_000_000) { cres.destroy(); fail(res, 502, 'Model metadata exceeds limit.'); }
        else chunks.push(chunk);
      });
      cres.on('end', () => { if (!res.writableEnded) { res.setHeader('content-type', 'application/json'); res.end(Buffer.concat(chunks)); } });
      return;
    }
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
