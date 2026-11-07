import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GatewayError } from './policy.ts';
import { checkPresetContent } from '../src/orcaCloud/codec.ts';

export const PUBLIC_KEY = 'sb_publishable_lvVe_whOi80SU9BPSxM1kA_tbt9AbR_';
export const MAX_PUSH_BYTES = 1_048_576;
const AUTH = 'https://auth.orcaslicer.com';
const API = 'https://api.orcaslicer.com';
const TTL = 300_000;
export interface OrcaCloudOptions {
  enabled: boolean;
  presetWrites?: boolean;
  callback?: string;
  /** Only set after the operator has confirmed upstream redirect registration. */
  callbackConfirmed?: boolean;
  fetch?: typeof fetch;
  now?: () => number;
}
interface Session { access: string; refresh: string; expires: number; accountId: string }
interface Flow { state: string; verifier: string; expires: number; callback: string }
export interface CloudIdentity { origin: string; credential: string }
interface Client { identity: CloudIdentity; flow?: Flow; session?: Session; queue: Promise<unknown>; generation: number; outcome?: string }

export function callbackUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new GatewayError(400, 'Invalid callback configuration.'); }
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' || value === 'http://localhost:41172/callback')) {
    throw new GatewayError(400, 'Configure an exact HTTPS callback or http://localhost:41172/callback.');
  }
  return url;
}

/** Fixed destinations only. No caller-supplied URL, auth headers or general proxy. */
export function apiPath(method: string, path: string, writes: boolean): URL {
  const url = new URL(path, API);
  if (url.origin !== API || url.hash || !path.startsWith('/api/v1/sync/')) throw new GatewayError(403, 'Cloud route refused.');
  const keys = [...url.searchParams.keys()];
  let valid = false;
  if (method === 'GET' && url.pathname === '/api/v1/sync/pull') {
    valid = keys.length === 0 || (keys.length === 1 && keys[0] === 'cursor' && /^\d+$/.test(url.searchParams.get('cursor')!) && Number.isSafeInteger(Number(url.searchParams.get('cursor'))));
  } else if (writes && method === 'POST' && ['/api/v1/sync/push', '/api/v1/sync/force-push'].includes(url.pathname)) {
    valid = keys.length === 0;
  } else if (writes && method === 'DELETE' && url.pathname === '/api/v1/sync/delete') {
    valid = keys.length === 2 && new Set(keys).size === 2 && url.searchParams.get('resource') === 'profiles' && !!url.searchParams.get('id');
  }
  if (!valid) throw new GatewayError(403, 'Cloud method or query refused.');
  return url;
}

export function createOrcaCloudBridge(options: OrcaCloudOptions) {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const clients = new Map<string, Client>();
  const client = (identity: CloudIdentity) => {
    if (!identity || typeof identity.origin !== 'string' || typeof identity.credential !== 'string' || !/^[a-f0-9]{64}$/.test(identity.credential)) {
      throw new GatewayError(401, 'A valid Orca browser session credential is required.');
    }
    const key = createHash('sha256').update(JSON.stringify([identity.origin, identity.credential])).digest('hex');
    let c = clients.get(key);
    if (!c) { c = { identity: { ...identity }, queue: Promise.resolve(), generation: 0 }; clients.set(key, c); }
    return c;
  };
  const serial = <T>(c: Client, work: () => Promise<T>): Promise<T> => {
    const result = c.queue.then(work, work);
    c.queue = result.then(() => {}, () => {});
    return result;
  };
  function enabled() { if (!options.enabled) throw new GatewayError(403, 'Orca Cloud bridge is disabled.'); }
  async function upstream(url: URL | string, init: RequestInit): Promise<Response> {
    try {
      const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (response.status >= 300 && response.status < 400 && response.status !== 304) throw new Error();
      return response;
    } catch { throw new GatewayError(502, 'Orca Cloud temporarily unavailable.'); }
  }
  async function token(grant: 'pkce' | 'refresh_token', body: object): Promise<Response> {
    return upstream(`${AUTH}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST', headers: { apikey: PUBLIC_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
  }
  async function sessionOf(response: Response, previousAccount?: string): Promise<Session> {
    let data;
    try { data = await response.json(); } catch { throw new GatewayError(502, 'Invalid Orca session response.'); }
    const accountId = data?.user?.id;
    const expiry = Number(data.expires_at) * 1000 || now() + Number(data.expires_in) * 1000;
    if (!data.access_token || typeof data.access_token !== 'string' || !data.refresh_token || typeof data.refresh_token !== 'string' ||
        typeof accountId !== 'string' || !accountId || !Number.isFinite(expiry) || expiry <= now() || (previousAccount && previousAccount !== accountId)) {
      throw new GatewayError(502, 'Invalid Orca session response.');
    }
    return { access: data.access_token, refresh: data.refresh_token, expires: expiry, accountId };
  }
  async function refresh(c: Client) {
    const old = c.session;
    if (!old) throw new GatewayError(401, 'Sign in to Orca Cloud.');
    const response = await token('refresh_token', { refresh_token: old.refresh });
    if ([400, 401, 403].includes(response.status)) {
      c.session = undefined; c.generation++;
      throw new GatewayError(401, 'Orca Cloud sign-in expired. Sign in again.');
    }
    if (!response.ok) throw new GatewayError(503, 'Orca Cloud refresh temporarily unavailable.');
    try { c.session = await sessionOf(response, old.accountId); }
    catch { c.session = undefined; throw new GatewayError(401, 'Orca Cloud session invalid. Sign in again.'); }
  }
  function status(identity: CloudIdentity) {
    enabled();
    const c = client(identity);
    if (c.flow && c.flow.expires <= now()) { c.flow = undefined; c.outcome = 'expired'; }
    return { accountId: c.session?.accountId ?? null, pending: !!c.flow, outcome: c.outcome ?? null,
      callback: options.callback ?? null, callbackConfirmed: !!options.callbackConfirmed,
      setup: !options.callback ? 'callback-required' : options.callbackConfirmed ? 'configured' : 'callback-allowlist-unverified',
      presetWrites: !!options.presetWrites };
  }
  async function begin(identity: CloudIdentity, provider: string) {
    enabled();
    if (!['google', 'apple', 'github'].includes(provider)) throw new GatewayError(400, 'Unsupported OAuth provider.');
    if (!options.callback) throw new GatewayError(409, 'Configure a registered callback before signing in.');
    const callback = callbackUrl(options.callback);
    const c = client(identity);
    return serial(c, async () => {
    if (c.session) throw new GatewayError(409, 'Sign out before changing accounts.');
    const state = randomBytes(16).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    c.flow = { state, verifier, expires: now() + TTL, callback: callback.href }; c.outcome = undefined;
    callback.searchParams.set('orca_state', state);
    const url = new URL('/auth/v1/authorize', AUTH);
    url.searchParams.set('provider', provider);
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('redirect_to', callback.href);
    return { url: url.href, expiresAt: c.flow.expires, callbackConfirmed: !!options.callbackConfirmed };
    });
  }
  async function complete(identity: CloudIdentity, value: string) {
    enabled();
    const c = client(identity);
    return serial(c, async () => {
      const flow = c.flow;
      let url: URL;
      try { url = new URL(value); } catch { throw new GatewayError(400, 'Invalid callback URL.'); }
      const states = [...url.searchParams.getAll('orca_state'), ...url.searchParams.getAll('state')];
      const base = new URL(url); base.search = ''; base.hash = '';
      if (!flow || flow.expires <= now() || base.href !== flow.callback || url.hash || states.length !== 1 || states[0] !== flow.state ||
          [...url.searchParams.keys()].some(k => !['code', 'orca_state', 'state', 'error', 'error_description', 'error_code'].includes(k)) || url.searchParams.getAll('code').length > 1) {
        throw new GatewayError(400, 'Callback does not match an unexpired pending sign-in.');
      }
      c.flow = undefined; c.outcome = 'failed'; // one use, including exchange failures
      const code = url.searchParams.get('code');
      if (!code || url.searchParams.has('error')) throw new GatewayError(400, 'Provider did not complete sign-in. Check callback registration.');
      const response = await token('pkce', { auth_code: code, code_verifier: flow.verifier });
      if (!response.ok) throw new GatewayError(401, 'Code exchange refused. Check callback registration and sign in again.');
      c.session = await sessionOf(response); c.generation++; c.outcome = 'complete';
      return status(identity);
    });
  }
  async function completeLoopback(value: string) {
    const url = new URL(value);
    const state = url.searchParams.get('orca_state') ?? url.searchParams.get('state');
    const entry = [...clients.entries()].find(([, c]) => c.flow?.state === state);
    if (!entry) throw new GatewayError(400, 'No pending sign-in matches this callback.');
    return complete(entry[1].identity, value);
  }
  async function logout(identity: CloudIdentity) {
    enabled();
    const c = client(identity);
    return serial(c, async () => {
      const session = c.session;
      c.session = undefined; c.flow = undefined; c.outcome = undefined; c.generation++;
      if (session) {
        try { await upstream(`${AUTH}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${session.access}` } }); }
        catch { /* Local logout always completes; never retain tokens after a network failure. */ }
      }
      return status(identity);
    });
  }
  async function api(identity: CloudIdentity, accountId: string, method: string, path: string, body?: unknown) {
    enabled();
    const url = apiPath(method, path, !!options.presetWrites);
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    if (method !== 'POST' && serialized !== undefined) throw new GatewayError(400, 'Unexpected request body.');
    if (method === 'POST') {
      const b = body as Record<string, unknown> | null;
      if (!b || typeof b.id !== 'string' || !b.id || typeof b.name !== 'string' || !b.name || !b.content || typeof b.content !== 'object' || Array.isArray(b.content) ||
          Object.keys(b).some(k => !['id', 'name', 'content', 'original_updated_time'].includes(k)) ||
          (b.original_updated_time !== undefined && (typeof b.original_updated_time !== 'string' || !/^\d+$/.test(b.original_updated_time)))) throw new GatewayError(400, 'Invalid preset push.');
      if (Buffer.byteLength(serialized!) > MAX_PUSH_BYTES) throw new GatewayError(413, 'Preset exceeds 1 MiB.');
      try { checkPresetContent(b.content as Record<string, unknown>); }
      catch { throw new GatewayError(400, 'Unsupported preset or credential-bearing content.'); }
    }
    const c = client(identity);
    return serial(c, async () => {
      if (!c.session || c.session.accountId !== accountId) throw new GatewayError(401, 'Orca Cloud account changed.');
      if (c.session.expires <= now() + 30_000) await refresh(c);
      const send = () => upstream(url, { method, headers: { Authorization: `Bearer ${c.session!.access}`, ...(serialized ? { 'content-type': 'application/json' } : {}) }, body: serialized });
      let response = await send();
      if (response.status === 401) { await refresh(c); response = await send(); }
      if (response.status === 401) { c.session = undefined; throw new GatewayError(401, 'Orca Cloud sign-in rejected.'); }
      if (![200, 204, 304, 409, 410].includes(response.status)) throw new GatewayError(response.status >= 500 ? 503 : 502, 'Orca preset request failed.');
      let data: unknown = null;
      if (![204, 304, 410].includes(response.status)) {
        try { data = await response.json(); } catch { throw new GatewayError(502, 'Invalid Orca preset response.'); }
      }
      return { status: response.status, data };
    });
  }
  async function handle(req: IncomingMessage, res: ServerResponse, origin: string): Promise<boolean> {
    if (!(req.url ?? '').startsWith('/_orca-cloud/')) return false;
    res.setHeader('cache-control', 'no-store'); res.setHeader('content-type', 'application/json');
    try {
      if (req.headers.origin !== origin || req.headers['x-orca-cloud'] !== '1') throw new GatewayError(403, 'Orca Cloud requires an allowed app Origin and request header.');
      const identity = { origin, credential: req.headers['x-orca-cloud-session'] as string };
      client(identity); // Reject missing/malformed credentials before reading any request body.
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > MAX_PUSH_BYTES + 4096) throw new GatewayError(413, 'Request too large.'); }
      let data: Record<string, any> = {};
      try { if (body) data = JSON.parse(body); } catch { throw new GatewayError(400, 'Invalid request JSON.'); }
      const route = `${req.method} ${req.url}`;
      let result: unknown;
      if (route === 'GET /_orca-cloud/status') result = status(identity);
      else if (route === 'POST /_orca-cloud/begin') result = await begin(identity, data.provider);
      else if (route === 'POST /_orca-cloud/complete') result = await complete(identity, data.callbackUrl);
      else if (route === 'POST /_orca-cloud/logout') result = await logout(identity);
      else if (route === 'POST /_orca-cloud/api') result = await api(identity, data.accountId, data.method, data.path, data.body);
      else throw new GatewayError(404, 'Unknown Orca Cloud route.');
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = error instanceof GatewayError ? error.status : 502;
      res.end(JSON.stringify({ error: error instanceof GatewayError ? error.message : 'Orca Cloud request failed.' }));
    }
    return true;
  }
  return { begin, complete, completeLoopback, status, logout, api, handle };
}
