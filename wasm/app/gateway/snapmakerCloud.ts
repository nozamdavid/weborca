/** Experimental international Snapmaker account/device bridge. No server session state.
 * Public web-client Basic identity observed in id.snapmaker.com's D7vx6uhb.js;
 * this is not an approved WebOrca client registration (see docs/snapmaker-cloud-integration.md).
 */
import * as http from 'node:http';
import * as https from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { configFromEnv } from './policy.ts';
import type { GatewayConfig } from './policy.ts';

export interface SnapmakerCloudGatewayOptions extends GatewayConfig {
  /** Transport injection for synthetic tests only; never populated from environment or clients. */
  snapmakerCloud?: {
    authHost?: string;
    authPort?: number;
    authProtocol?: 'http' | 'https';
    apiHost?: string;
    apiPort?: number;
    apiProtocol?: 'http' | 'https';
  };
}

const PREFIX = '/_printer/snapmaker-cloud';
const MAX_BODY = 64 * 1024;
const MAX_RESPONSE = 1024 * 1024;
const TIMEOUT_MS = 15_000;
const ROUTES: Record<string, string> = {
  'POST /auth/send-code': '/api/common/accounts/sendVerificationCode',
  'POST /auth/token': '/api/oauth2/token',
  'POST /auth/refresh': '/api/oauth2/token',
  'GET /account': '/api/common/accounts/current',
  'POST /devices': '/api/user/device/list'
};

function fail(res: http.ServerResponse, status: number, message: string): false {
  if (!res.destroyed && !res.writableEnded) {
    res.statusCode = status;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(message);
  }
  return false;
}

function exact(body: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
}

function field(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
}

function email(value: unknown): value is string {
  return field(value, 254) && /^[^\s@]+@[^\s@]+$/.test(value);
}

function multipart(fields: Record<string, string>): { body: Buffer; type: string } {
  const boundary = `weborca-${randomBytes(24).toString('hex')}`;
  const body = Buffer.from(Object.entries(fields).map(([name, value]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  ).join('') + `--${boundary}--\r\n`);
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}

export async function handleSnapmakerCloudRequest(
  req: http.IncomingMessage, res: http.ServerResponse, path: string, options?: SnapmakerCloudGatewayOptions
): Promise<boolean> {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('referrer-policy', 'no-referrer');
  if (!(options?.cloud ?? configFromEnv().cloud ?? '').split(',').some(id => id.trim().toLowerCase() === 'snapmaker-cloud')) {
    return fail(res, 403, 'Snapmaker Cloud is not enabled on this gateway.');
  }
  // Compare raw request targets: URL parsers must not normalize encoded or dot-segment routes.
  const raw = req.url ?? path;
  const route = raw.slice(PREFIX.length);
  const key = `${req.method} ${route}`;
  if (!raw.startsWith(PREFIX + '/') || path !== raw || !Object.hasOwn(ROUTES, key)) {
    return fail(res, 403, 'Unsupported Snapmaker Cloud route.');
  }
  const authenticated = route === '/account' || route === '/devices';
  const authorization = req.headers.authorization;
  if (authenticated && (typeof authorization !== 'string' ||
      !/^Bearer [A-Za-z0-9._~+\/-]+=*$/.test(authorization) || authorization.length > 8199)) {
    return fail(res, 401, 'A valid Snapmaker bearer token is required.');
  }
  let parsed: Record<string, unknown> = {};
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    // Do not destroy the downstream socket when rejecting a body mid-stream:
    // it still needs to receive the 413 response. Drain without retaining bytes.
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_BODY) {
        req.resume();
        return fail(res, 413, 'Snapmaker request body is too large.');
      }
      chunks.push(bytes);
    }
    if (req.method === 'GET') {
      if (size !== 0) return fail(res, 400, 'Unexpected Snapmaker request body.');
    } else {
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) {
        return fail(res, 400, 'Snapmaker requests require JSON.');
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(res, 400, 'Invalid Snapmaker request body.');
      parsed = value as Record<string, unknown>;
    }
  } catch {
    return fail(res, 400, 'Invalid Snapmaker request body.');
  }
  let body: Buffer | undefined;
  let type = 'application/json';
  if (route === '/auth/send-code') {
    if (!exact(parsed, ['account']) || !email(parsed.account)) return fail(res, 400, 'Invalid Snapmaker account.');
    body = Buffer.from(JSON.stringify({ account: parsed.account, action: 'oauth' }));
  } else if (route === '/auth/token') {
    if (!email(parsed.email)) return fail(res, 400, 'Invalid Snapmaker account.');
    let fields: Record<string, string>;
    if (exact(parsed, ['email', 'password']) && field(parsed.password, 1024)) {
      fields = { scope: 'profile openid', username: parsed.email,
        password: createHash('sha256').update(parsed.email + '$sm-nonce@' + parsed.password).digest('hex'), grant_type: 'password' };
    } else if (exact(parsed, ['email', 'code']) && field(parsed.code, 128)) {
      fields = { scope: 'profile openid', email: parsed.email, grant_type: 'urn:ietf:params:oauth:grant-type:email', code: parsed.code };
    } else return fail(res, 400, 'Invalid Snapmaker token request.');
    ({ body, type } = multipart(fields));
  } else if (route === '/auth/refresh') {
    if (!exact(parsed, ['refresh_token']) || !field(parsed.refresh_token, 8192)) return fail(res, 400, 'Invalid Snapmaker refresh request.');
    ({ body, type } = multipart({ grant_type: 'refresh_token', refresh_token: parsed.refresh_token }));
  } else if (route === '/devices') {
    if (!exact(parsed, [])) return fail(res, 400, 'Invalid Snapmaker device request.');
    body = Buffer.from(JSON.stringify({ name: null, mac: null, sn: null, productName: null, productCode: null, pageIndex: null, pageRows: null }));
  }

  const headers: http.OutgoingHttpHeaders = {
    accept: 'application/json', 'accept-language': 'en-US,en;q=0.9',
    'x-custom-site': 'WebOrca', os: 'WebOrca', 'device-type': 'WebOrca'
  };
  if (authenticated) headers.authorization = authorization;
  else if (route !== '/auth/send-code') headers.authorization = 'Basic bWFsbC1hcHA6MTIzNDU2';
  if (body) {
    headers['content-type'] = type;
    headers['content-length'] = body.length;
  }
  const overrides = options?.snapmakerCloud;
  const device = route === '/devices';
  const protocol = (device ? overrides?.apiProtocol : overrides?.authProtocol) ?? 'https';
  const hostname = (device ? overrides?.apiHost : overrides?.authHost) ?? (device ? 'id.snapmaker.com' : 'api.snapmaker.com');
  const port = (device ? overrides?.apiPort : overrides?.authPort) ?? (protocol === 'http' ? 80 : 443);
  if (res.destroyed || req.aborted) return false;
  return new Promise<boolean>(resolve => {
    let response: http.IncomingMessage | undefined;
    let settled = false;
    const finish = (status?: number, message = 'Snapmaker upstream request failed.') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res.off('close', disconnected);
      if (status) fail(res, status, message);
      resolve(status === undefined);
    };
    const upstream = (protocol === 'http' ? http : https).request({
      hostname, port, path: ROUTES[key], method: req.method, headers,
      // Explicit true also overrides NODE_TLS_REJECT_UNAUTHORIZED=0. No insecure option.
      rejectUnauthorized: true
    }, incoming => {
      response = incoming;
      const chunks: Buffer[] = [];
      let size = 0;
      incoming.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE) {
          finish(502, 'Snapmaker upstream response is too large.');
          incoming.destroy();
          upstream.destroy();
        } else chunks.push(chunk);
      });
      incoming.on('error', () => finish(502));
      incoming.on('aborted', () => finish(502));
      incoming.on('end', () => {
        if (settled) return;
        const status = incoming.statusCode ?? 502;
        if (status >= 300 && status < 400) return finish(502, 'Snapmaker upstream redirect rejected.');
        const bytes = Buffer.concat(chunks);
        let envelope: unknown;
        try { envelope = JSON.parse(bytes.toString('utf8')); } catch {
          return finish(status === 401 ? 401 : 502,
            status === 401 ? 'Snapmaker authentication rejected.' : 'Invalid Snapmaker upstream JSON.');
        }
        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
          return finish(status === 401 ? 401 : 502,
            status === 401 ? 'Snapmaker authentication rejected.' : 'Invalid Snapmaker upstream envelope.');
        }
        const code = (envelope as { code?: unknown }).code;
        res.statusCode = [401, 110002, 110003, 110004].some(value => code === value || code === String(value)) ? 401 : status;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(bytes);
        finish();
      });
    });
    const disconnected = () => {
      if (!res.writableFinished) {
        finish(502);
        response?.destroy();
        upstream.destroy();
      }
    };
    const timer = setTimeout(() => {
      finish(504, 'Snapmaker upstream request timed out.');
      response?.destroy();
      upstream.destroy();
    }, TIMEOUT_MS);
    res.on('close', disconnected);
    upstream.on('error', () => finish(502));
    upstream.end(body);
  });
}
