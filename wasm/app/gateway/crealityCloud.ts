/**
 * Creality Cloud gateway handler: a restricted reverse proxy between the web app and
 * Creality Cloud's HTTPS servers.
 *
 * Route pattern:
 *   /_printer/creality-cloud/<global|china>/<auth|api>/<path>
 *
 * Opt-in:
 *   Only active when options.cloud includes 'creality-cloud'.
 *
 * Strict read-only policy:
 *   - Only login/QR auth and read-only device/telemetry/CFS endpoints are in the allowlist.
 *   - All upload, print, feeding, device registration and control commands are rejected with 403.
 *   - CFS RPC (POST /api/rest/iotrouter/rpc/twoway/:tbId) strictly validates that payload
 *     is exactly { method: 'get', params: { cfsList: 1 } } with no extra keys or commands.
 *   - Bodies are limited in size (64 KB).
 *   - Closed client connections immediately abort upstream requests.
 *   - Timeouts destroy hanging upstream connections.
 */
import * as http from 'node:http';
import * as https from 'node:https';
import { configFromEnv } from './policy.ts';
import type { GatewayConfig } from './policy.ts';

export interface CrealityCloudGatewayOptions extends GatewayConfig {
  crealityCloud?: {
    authHost?: string;
    authPort?: number;
    authProtocol?: 'http' | 'https';
    apiHost?: string;
    apiPort?: number;
    apiProtocol?: 'http' | 'https';
    globalAuthHost?: string;
    chinaAuthHost?: string;
    globalApiHost?: string;
    chinaApiHost?: string;
    rejectUnauthorized?: boolean;
  };
}

export const CREALITY_CLOUD_HOSTS = {
  global: {
    // CrealityPrint v6.0.3 resources/web/homepage/config.js (configRelease).
    auth: 'api.crealitycloud.com',
    api: 'api.crealitycloud.com'
  },
  china: {
    auth: 'api.crealitycloud.cn',
    api: 'api.crealitycloud.cn'
  }
} as const;

export const CREALITY_CLOUD_AUTH_ALLOWLIST = new Set([
  'POST /api/cxy/account/v2/qrLogin',
  'POST /api/cxy/account/v2/qrQuery',
  'POST /api/cxy/account/v2/loginV2',
  'POST /api/cxy/v2/user/getInfo'
]);

export const CREALITY_CLOUD_API_EXACT_ALLOWLIST = new Set([
  'POST /api/rest/print/cluster/devices/getDevices',
  'POST /api/rest/print/cluster/devices/pollState',
  'POST /api/rest/print/cluster/devices/getDeviceDetail'
]);

const TIMESERIES_PATH_REGEX = /^\/api\/rest\/iotrouter\/[^/]+\/values\/timeseries$/;
const ATTRIBUTES_PATH_REGEX = /^\/api\/rest\/iotrouter\/plugins\/telemetry\/[^/]+\/values\/attributes$/;
const CFS_RPC_PATH_REGEX = /^\/api\/rest\/iotrouter\/rpc\/twoway\/[^/]+$/;

const MAX_BODY_BYTES = 64 * 1024; // 64 KB
const UPSTREAM_TIMEOUT_MS = 15_000;

function fail(res: http.ServerResponse, status: number, message: string) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(message);
}

/**
 * Validates that an RPC payload is strictly the read-only CFS query command:
 * { method: 'get', params: { cfsList: 1 } }
 * No additional keys or alternative commands are allowed.
 */
export function isExactCfsQueryPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const keys = Object.keys(payload);
  if (keys.length !== 2) {
    return false;
  }
  if (!('method' in payload) || !('params' in payload)) {
    return false;
  }
  const obj = payload as { method: unknown; params: unknown };
  if (obj.method !== 'get') {
    return false;
  }
  if (!obj.params || typeof obj.params !== 'object' || Array.isArray(obj.params)) {
    return false;
  }
  const paramKeys = Object.keys(obj.params);
  if (paramKeys.length !== 1 || paramKeys[0] !== 'cfsList') {
    return false;
  }
  const params = obj.params as { cfsList: unknown };
  return params.cfsList === 1;
}

/**
 * Handles incoming Creality Cloud HTTP requests through the gateway.
 *
 * @param req The incoming HTTP request
 * @param res The outgoing HTTP response
 * @param path The path of the request (e.g. `/_printer/creality-cloud/<global|china>/<auth|api>/<path>`)
 * @param options Gateway options including cloud opt-in and test overrides
 * @returns Promise resolving to true if handled, or false if rejected/unhandled
 */
export async function handleCrealityCloudRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
  options?: CrealityCloudGatewayOptions
): Promise<boolean> {
  // 1. Opt-in verification: Creality Cloud must be explicitly enabled
  const cloudSetting = (options?.cloud ?? configFromEnv().cloud ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase());
  if (!cloudSetting.includes('creality-cloud')) {
    fail(res, 403, 'Creality Cloud is not enabled on this gateway.');
    return false;
  }

  // 2. Parse region, targetType (auth/api), and upstream path
  const normalized = path.replace(/^\/?(?:_printer\/creality-cloud\/)?/, '');
  const match = /^(global|china)\/(auth|api)(\/.*)$/.exec(normalized);
  if (!match) {
    fail(res, 404, 'Invalid Creality Cloud gateway route.');
    return false;
  }

  const region = match[1] as 'global' | 'china';
  const targetType = match[2] as 'auth' | 'api';
  const subpath = match[3];

  let fullPath = subpath;
  if (!fullPath.includes('?') && req.url && req.url.includes('?')) {
    fullPath += req.url.slice(req.url.indexOf('?'));
  }
  const pathWithoutQuery = fullPath.split('?')[0];
  const method = (req.method || 'GET').toUpperCase();

  // 3. Strict allowlist checks
  if (targetType === 'auth') {
    const allowKey = `${method} ${pathWithoutQuery}`;
    if (!CREALITY_CLOUD_AUTH_ALLOWLIST.has(allowKey)) {
      fail(res, 403, `Creality Cloud auth endpoint not in allowlist: ${allowKey}`);
      return false;
    }
  } else {
    // API routes
    const isTimeseries = method === 'GET' && TIMESERIES_PATH_REGEX.test(pathWithoutQuery);
    const isAttributes = method === 'GET' && ATTRIBUTES_PATH_REGEX.test(pathWithoutQuery);
    const isCfsRpc = method === 'POST' && CFS_RPC_PATH_REGEX.test(pathWithoutQuery);
    const isExactApi = CREALITY_CLOUD_API_EXACT_ALLOWLIST.has(`${method} ${pathWithoutQuery}`);

    if (!isTimeseries && !isAttributes && !isCfsRpc && !isExactApi) {
      fail(res, 403, `Creality Cloud API endpoint not in allowlist: ${method} ${pathWithoutQuery}`);
      return false;
    }
  }

  // 4. Read body with limit for POST requests
  let bodyBuffer: Buffer | undefined;
  if (method === 'POST') {
    const chunks: Buffer[] = [];
    let bytesRead = 0;

    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesRead += buf.length;
      if (bytesRead > MAX_BODY_BYTES) {
        fail(res, 413, 'Payload Too Large: Creality Cloud request body exceeded size limit.');
        return false;
      }
      chunks.push(buf);
    }
    bodyBuffer = Buffer.concat(chunks);

    // If this is a CFS RPC call, validate the exact payload structure
    if (targetType === 'api' && CFS_RPC_PATH_REGEX.test(pathWithoutQuery)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyBuffer.toString('utf-8'));
      } catch {
        fail(res, 400, 'Invalid JSON body for CFS RPC.');
        return false;
      }

      if (!isExactCfsQueryPayload(parsed)) {
        fail(res, 403, 'Forbidden: Only read-only CFS query RPC {method:"get",params:{cfsList:1}} is permitted.');
        return false;
      }
    }
  }

  // 5. Resolve upstream target host and port (with test overrides support)
  const overrides = options?.crealityCloud;
  let targetHost: string;
  let targetPort: number;
  let targetProtocol: 'http' | 'https';

  if (targetType === 'auth') {
    if (region === 'china') {
      targetHost = overrides?.chinaAuthHost ?? overrides?.authHost ?? CREALITY_CLOUD_HOSTS.china.auth;
    } else {
      targetHost = overrides?.globalAuthHost ?? overrides?.authHost ?? CREALITY_CLOUD_HOSTS.global.auth;
    }
    targetProtocol = overrides?.authProtocol ?? 'https';
    targetPort = overrides?.authPort ?? (targetProtocol === 'http' ? 80 : 443);
  } else {
    if (region === 'china') {
      targetHost = overrides?.chinaApiHost ?? overrides?.apiHost ?? CREALITY_CLOUD_HOSTS.china.api;
    } else {
      targetHost = overrides?.globalApiHost ?? overrides?.apiHost ?? CREALITY_CLOUD_HOSTS.global.api;
    }
    targetProtocol = overrides?.apiProtocol ?? 'https';
    targetPort = overrides?.apiPort ?? (targetProtocol === 'http' ? 80 : 443);
  }

  // 6. Build headers to forward
  const reqHeaders: http.OutgoingHttpHeaders = {
    host: targetHost,
    accept: req.headers['accept'] || 'application/json, */*'
  };
  if (req.headers['content-type']) {
    reqHeaders['content-type'] = req.headers['content-type'];
  }
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (lk.startsWith('__cxy_') && v !== undefined) {
      reqHeaders[k] = v;
    }
  }
  if (bodyBuffer) {
    reqHeaders['content-length'] = bodyBuffer.length;
  }

  // 7. Execute upstream request
  const requestFn: typeof https.request = targetProtocol === 'http' ? http.request : https.request;
  return new Promise<boolean>((resolve) => {
    const creq = requestFn(
      {
        method,
        hostname: targetHost,
        port: targetPort,
        path: fullPath,
        headers: reqHeaders,
        timeout: UPSTREAM_TIMEOUT_MS,
        rejectUnauthorized: overrides?.rejectUnauthorized ?? true
      },
      (cres) => {
        res.statusCode = cres.statusCode || 500;
        // Cloud cookies and transport headers belong to the upstream origin.
        for (const name of ['content-type', 'content-length', 'content-encoding']) {
          const value = cres.headers[name];
          if (value !== undefined) res.setHeader(name, value);
        }
        res.setHeader('cache-control', 'no-store');
        cres.on('error', (error) => {
          fail(res, 502, `Creality Cloud upstream response failed: ${error.message}`);
          resolve(false);
        });
        cres.pipe(res);
        cres.on('end', () => resolve(true));
      }
    );

    creq.on('timeout', () => {
      creq.destroy(new Error('Creality Cloud upstream request timed out'));
    });

    creq.on('error', (err) => {
      fail(res, 502, `Creality Cloud gateway error: ${(err as Error).message}`);
      resolve(false);
    });

    res.on('close', () => {
      if (!res.writableFinished) {
        creq.destroy();
      }
    });

    if (bodyBuffer) {
      creq.end(bodyBuffer);
    } else {
      req.pipe(creq);
    }
  });
}
