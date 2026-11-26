import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync,
  renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Invite = { id: string; email: string; username: string; note: string; createdAt: string;
  usedAt: string | null; lastUsedAt: string | null; useCount: number; revoked: boolean };
type StoredInvite = Invite & { codeHash: string };
type AppSession = { hash: string; expiresAt: string };
type Session = AppSession & { inviteId: string };
type State = { version: 1; invites: StoredInvite[]; sessions: Session[] };
type Options = { env?: NodeJS.ProcessEnv; webRoot: string; forbiddenDataRoots?: string[]; now?: () => number };
const DAY = 86_400_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const date = (value: unknown): value is string => typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const inside = (file: string, root: string) => file === root || file.startsWith(root + path.sep);
const publicInvite = ({ codeHash: _codeHash, ...invite }: StoredInvite): Invite => invite;
const hasOnly = (value: object, keys: string[]) => Object.keys(value).every(key => keys.includes(key));

function checkState(value: unknown): asserts value is State {
  const state = value as State;
  if (!state || !hasOnly(state, ['version', 'invites', 'sessions']) || state.version !== 1 || !Array.isArray(state.invites) || !Array.isArray(state.sessions) ||
      state.invites.length > 10000 || state.sessions.length > 10000) throw new Error('Invalid alpha state');
  const ids = new Set<string>();
  const codes = new Set<string>();
  for (const i of state.invites) {
    if (!i || !hasOnly(i, ['id', 'codeHash', 'email', 'username', 'note', 'createdAt', 'usedAt', 'lastUsedAt', 'useCount', 'revoked']) ||
        typeof i.id !== 'string' || !/^[a-f0-9-]{36}$/.test(i.id) || ids.has(i.id) || !isHash(i.codeHash) || codes.has(i.codeHash) ||
        typeof i.email !== 'string' || i.email.length > 320 || typeof i.username !== 'string' || i.username.length > 100 ||
        typeof i.note !== 'string' || i.note.length > 1000 || !date(i.createdAt) || typeof i.revoked !== 'boolean' ||
        !Number.isSafeInteger(i.useCount) || i.useCount < 0 ||
        (i.useCount === 0 ? i.usedAt !== null || i.lastUsedAt !== null : !date(i.usedAt) || !date(i.lastUsedAt))) {
      throw new Error('Invalid alpha invite state');
    }
    ids.add(i.id); codes.add(i.codeHash);
  }
  const sessions = new Set<string>();
  for (const s of state.sessions) {
    if (!s || !hasOnly(s, ['hash', 'inviteId', 'expiresAt']) || !isHash(s.hash) || sessions.has(s.hash) || !ids.has(s.inviteId) || !date(s.expiresAt)) {
      throw new Error('Invalid alpha session state');
    }
    sessions.add(s.hash);
  }
}

export function createAlphaAccess({ env = process.env, webRoot, forbiddenDataRoots = [], now = Date.now }: Options) {
  if (env.ORCA_ALPHA_GATE_ENABLED !== undefined && !['0', '1', ''].includes(env.ORCA_ALPHA_GATE_ENABLED)) {
    throw new Error('ORCA_ALPHA_GATE_ENABLED must be 0 or 1');
  }
  const enabled = env.ORCA_ALPHA_GATE_ENABLED === '1';
  let origin!: URL;
  let file = '';
  let password = '';
  let state: State = { version: 1, invites: [], sessions: [] };
  let failed = false;
  let closed = false;
  type Resource = ServerResponse | Duplex;
  const lifetimes = new Map<string, { session: AppSession; resources: Set<Resource>; timer?: ReturnType<typeof setTimeout> }>();
  function terminate(key: string) {
    const lifetime = lifetimes.get(key);
    if (!lifetime) return;
    lifetimes.delete(key);
    clearTimeout(lifetime.timer);
    for (const resource of lifetime.resources) resource.destroy();
  }
  function close() {
    closed = true;
    for (const key of lifetimes.keys()) terminate(key);
    admins.clear(); adminApps.clear(); attempts.clear();
  }
  function own(session: AppSession, resource: Resource) {
    let lifetime = lifetimes.get(session.hash);
    if (!lifetime) {
      lifetime = { session, resources: new Set([resource]) };
      lifetimes.set(session.hash, lifetime);
      const expire = () => {
        const remaining = Date.parse(session.expiresAt) - now();
        if (remaining <= 0) terminate(session.hash);
        else {
          // Node timeouts cannot exceed a signed 32-bit delay (sessions last 30 days).
          lifetime!.timer = setTimeout(expire, Math.min(remaining, 2147483647));
          lifetime!.timer.unref();
        }
      };
      expire();
    }
    lifetime.resources.add(resource);
    const release = () => {
      resource.removeListener('close', release);
      resource.removeListener('finish', release);
      lifetime!.resources.delete(resource);
      if (!lifetime!.resources.size) {
        clearTimeout(lifetime!.timer);
        lifetimes.delete(session.hash);
      }
    };
    resource.once('close', release);
    if ('writeHead' in resource) resource.once('finish', release);
  }
  const admins = new Map<string, number>(); // Deliberately invalidated by every server restart/password rotation.
  const adminApps = new Map<string, AppSession & { adminHash: string }>();
  function pruneAdminApps() {
    for (const [key, session] of adminApps) {
      if (Date.parse(session.expiresAt) <= now() || (admins.get(session.adminHash) || 0) <= now()) {
        adminApps.delete(key); terminate(key);
      }
    }
  }
  const attempts = new Map<string, { start: number; count: number }>();
  let total = { start: now(), count: 0 };

  const save = (next: State) => {
    const temp = `${file}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      checkState(next);
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify(next));
      fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temp, file);
      fd = openSync(path.dirname(file), 'r');
      fsyncSync(fd); closeSync(fd); fd = undefined;
      state = next;
      const invites = new Set(next.invites.filter(i => !i.revoked).map(i => i.id));
      const valid = new Set(next.sessions.filter(s => Date.parse(s.expiresAt) > now() &&
        invites.has(s.inviteId)).map(s => s.hash));
      pruneAdminApps();
      for (const key of adminApps.keys()) valid.add(key);
      for (const key of lifetimes.keys()) if (!valid.has(key)) terminate(key);
    } catch {
      failed = true; // Never authorize from state whose durable commit is uncertain.
      for (const key of lifetimes.keys()) terminate(key);
      throw new Error('Alpha persistence unavailable');
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temp)) unlinkSync(temp);
    }
  };
  if (enabled) {
    try {
      origin = new URL(env.ORCA_PUBLIC_ORIGIN || '');
      if (origin.href !== `${origin.origin}/` || origin.username || origin.password ||
          !(origin.protocol === 'https:' || (origin.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new Error();
    } catch { throw new Error('Alpha requires a canonical ORCA_PUBLIC_ORIGIN (HTTPS or HTTP loopback)'); }
    password = env.ORCA_ALPHA_ADMIN_PASSWORD || '';
    if (!password.trim()) throw new Error('Alpha requires env-only ORCA_ALPHA_ADMIN_PASSWORD');
    file = env.ORCA_ALPHA_DATA_FILE || '';
    if (!path.isAbsolute(file)) throw new Error('Alpha requires absolute ORCA_ALPHA_DATA_FILE outside web root');
    // Resolve symlinked parents, and refuse a symlink file even when its target is outside.
    file = path.join(realpathSync(path.dirname(file)), path.basename(file));
    if ([webRoot, ...forbiddenDataRoots].some(root => inside(file, realpathSync(root))) ||
        (existsSync(file) && lstatSync(file).isSymbolicLink())) {
      throw new Error('Alpha data must be outside web root and cannot be a symlink');
    }
    if (existsSync(file)) {
      try {
        state = JSON.parse(readFileSync(file, 'utf8'));
        checkState(state);
      } catch { throw new Error('Alpha persistence is corrupt or unreadable'); }
    } else save(state);
  }

  function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': String(res.getHeader('Cross-Origin-Embedder-Policy') || 'require-corp') });
    res.end(JSON.stringify(value));
  }
  const error = (res: ServerResponse, status: number, message: string) => json(res, status, { error: message });
  function sameOrigin(req: IncomingMessage, mutation = false) {
    return req.headers.host === origin.host &&
      (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin') &&
      (req.headers.origin === origin.origin || (!mutation && req.headers.origin === undefined &&
        req.headers['sec-fetch-site'] === 'same-origin'));
  }
  function token(req: IncomingMessage, admin = false, cookieOnly = false) {
    if (!cookieOnly && req.headers.authorization !== undefined) {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization);
      return match?.[1] || '';
    }
    const name = admin ? 'orca_alpha_admin' : 'orca_alpha';
    return req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1) || '';
  }
  function tester(req: IncomingMessage, cookieOnly = false) {
    if (failed || closed) return undefined;
    const raw = token(req, false, cookieOnly);
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return undefined;
    const app = adminApps.get(hash(raw));
    if (app && Date.parse(app.expiresAt) > now() && (admins.get(app.adminHash) || 0) > now()) return app;
    const session = state.sessions.find(s => s.hash === hash(raw) && Date.parse(s.expiresAt) > now());
    return session && state.invites.some(i => i.id === session.inviteId && !i.revoked) ? session : undefined;
  }
  const admin = (req: IncomingMessage) => (admins.get(hash(token(req, true))) || 0) > now();
  // Application requests may carry a provider's Authorization header. Alpha APIs
  // retain strict bearer precedence; other resources authenticate independently.
  const resourceSession = (req: IncomingMessage) => tester(req, true) || tester(req);
  function cookie(res: ServerResponse, raw: string, isAdmin: boolean, seconds: number) {
    res.setHeader('Set-Cookie', `${isAdmin ? 'orca_alpha_admin' : 'orca_alpha'}=${raw}; HttpOnly; SameSite=Strict; Path=${isAdmin ? '/_alpha' : '/'}; Max-Age=${seconds}${origin.protocol === 'https:' ? '; Secure' : ''}`);
  }
  function rate(req: IncomingMessage, res: ServerResponse) {
    const time = now();
    if (time - total.start >= 900000) { total = { start: time, count: 0 }; attempts.clear(); }
    const address = req.socket.remoteAddress || 'unknown';
    let entry = attempts.get(address);
    if (!entry || time - entry.start >= 900000) {
      entry = { start: time, count: 0 };
      if (attempts.size < 1024) attempts.set(address, entry);
    }
    if (++total.count > 100 || ++entry.count > 10) {
      res.setHeader('Retry-After', '900'); error(res, 429, 'Too many attempts'); return false;
    }
    return true;
  }
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw 400;
    const text = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4096) { reject(413); return; }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => reject(400));
      req.on('aborted', () => reject(400));
    });
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw 400;
      return parsed;
    } catch { throw 400; }
  }
  function fields(input: Record<string, unknown>, allowed: string[]) {
    if (Object.keys(input).some(key => !allowed.includes(key))) throw 400;
  }
  function labels(input: Record<string, unknown>, patch = false) {
    fields(input, patch ? ['email', 'username', 'note', 'revoked'] : ['email', 'username', 'note']);
    for (const [key, max] of [['email', 320], ['username', 100], ['note', 1000]] as const) {
      if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > max)) throw 400;
    }
    if (input.revoked !== undefined && typeof input.revoked !== 'boolean') throw 400;
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); }
    catch { error(res, 400, 'Invalid path'); return true; }
    if (pathname !== '/_alpha' && !pathname.startsWith('/_alpha/')) return false;
    if (pathname === '/_alpha/config' && req.method === 'GET') {
      if (enabled && !sameOrigin(req)) error(res, 403, 'Same origin required');
      else json(res, 200, { enabled });
      return true;
    }
    if (!enabled) { error(res, 403, 'Alpha gate is disabled'); return true; }
    if (failed || closed) { error(res, 503, 'Alpha persistence unavailable'); return true; }
    // HTML bootstrap is served by the host after this handler.
    if (['/_alpha/login', '/_alpha/admin'].includes(pathname) && ['GET', 'HEAD'].includes(req.method || '')) return false;
    const mutation = req.method !== 'GET';
    if (!sameOrigin(req, mutation)) { error(res, 403, 'Same origin required'); return true; }
    try {
      if (pathname === '/_alpha/session' && req.method === 'GET') {
        const session = tester(req);
        if (!session) error(res, 401, 'Invalid tester session');
        else {
          // localStorage is the durable client credential; restore the asset/worker cookie if missing.
          cookie(res, token(req), false, Math.max(1, Math.floor((Date.parse(session.expiresAt) - now()) / 1000)));
          json(res, 200, { valid: true, expiresAt: session.expiresAt });
        }
      } else if (pathname === '/_alpha/validate' && req.method === 'POST') {
        if (!rate(req, res)) return true;
        const input = await body(req); fields(input, ['code']);
        if (typeof input.code !== 'string' || input.code.length > 100) throw 400;
        const invite = state.invites.find(i => i.codeHash === hash(input.code as string) && !i.revoked);
        if (!invite) { error(res, 401, 'Invalid invite code'); return true; }
        const raw = opaque();
        const time = new Date(now()).toISOString();
        const expiresAt = new Date(now() + 30 * DAY).toISOString();
        const sessions = state.sessions.filter(s => Date.parse(s.expiresAt) > now());
        if (sessions.length >= 10000) { error(res, 503, 'Session capacity reached'); return true; }
        save({ ...state, invites: state.invites.map(i => i.id === invite.id
          ? { ...i, usedAt: i.usedAt || time, lastUsedAt: time, useCount: i.useCount + 1 } : i),
        sessions: [...sessions, { hash: hash(raw), inviteId: invite.id, expiresAt }] });
        cookie(res, raw, false, 30 * DAY / 1000); json(res, 200, { token: raw, expiresAt });
      } else if (pathname === '/_alpha/admin/login' && req.method === 'POST') {
        if (!rate(req, res)) return true;
        const input = await body(req); fields(input, ['password']);
        if (typeof input.password !== 'string') throw 400;
        if (!timingSafeEqual(Buffer.from(hash(input.password)), Buffer.from(hash(password)))) {
          error(res, 401, 'Invalid administrator credentials'); return true;
        }
        for (const [key, expiry] of admins) if (expiry <= now()) admins.delete(key);
        const raw = opaque(); const expiry = now() + 8 * 3600000;
        admins.set(hash(raw), expiry);
        cookie(res, raw, true, 8 * 3600); json(res, 200, { token: raw, expiresAt: new Date(expiry).toISOString() });
      } else if (pathname === '/_alpha/admin/open-slicer' && req.method === 'POST') {
        if (!admin(req)) { error(res, 401, 'Administrator session required'); return true; }
        fields(await body(req), []);
        if (!admin(req)) { error(res, 401, 'Administrator session required'); return true; }
        pruneAdminApps();
        if (adminApps.size >= 10000) { error(res, 503, 'Session capacity reached'); return true; }
        const adminHash = hash(token(req, true));
        const expiresAt = new Date(admins.get(adminHash)!).toISOString();
        const raw = opaque();
        adminApps.set(hash(raw), { hash: hash(raw), adminHash, expiresAt });
        cookie(res, raw, false, Math.max(1, Math.floor((Date.parse(expiresAt) - now()) / 1000)));
        json(res, 200, { token: raw, expiresAt });
      } else if (['/_alpha/logout', '/_alpha/admin/logout'].includes(pathname) && req.method === 'POST') {
        fields(await body(req), []);
        const isAdmin = pathname === '/_alpha/admin/logout';
        if (isAdmin) { admins.delete(hash(token(req, true))); pruneAdminApps(); }
        else {
          const key = hash(token(req));
          adminApps.delete(key); terminate(key);
          save({ ...state, sessions: state.sessions.filter(s => s.hash !== key) });
        }
        cookie(res, '', isAdmin, 0); json(res, 200, { ok: true });
      } else if (pathname === '/_alpha/admin/invites' || pathname.startsWith('/_alpha/admin/invites/')) {
        if (!admin(req)) { error(res, 401, 'Administrator session required'); return true; }
        if (pathname === '/_alpha/admin/invites' && req.method === 'GET') {
          json(res, 200, { invites: state.invites.map(publicInvite) });
        } else if (pathname === '/_alpha/admin/invites' && req.method === 'POST') {
          const input = await body(req); labels(input);
          if (!admin(req)) { error(res, 401, 'Administrator session required'); return true; }
          if (state.invites.length >= 10000) { error(res, 409, 'Invite capacity reached'); return true; }
          const raw = opaque();
          const invite: StoredInvite = { id: randomUUID(), codeHash: hash(raw), email: input.email as string || '',
            username: input.username as string || '', note: input.note as string || '', createdAt: new Date(now()).toISOString(),
            usedAt: null, lastUsedAt: null, useCount: 0, revoked: false };
          save({ ...state, invites: [...state.invites, invite] });
          json(res, 201, { invite: publicInvite(invite), code: raw });
        } else if (req.method === 'PATCH' && /^\/_alpha\/admin\/invites\/[^/]+$/.test(pathname)) {
          const input = await body(req); labels(input, true);
          if (!admin(req)) { error(res, 401, 'Administrator session required'); return true; }
          const id = pathname.slice('/_alpha/admin/invites/'.length);
          const previous = state.invites.find(i => i.id === id);
          if (!previous) { error(res, 404, 'Unknown invite'); return true; }
          const invite = { ...previous, ...input } as StoredInvite;
          save({ ...state, invites: state.invites.map(i => i.id === id ? invite : i),
            sessions: input.revoked === true ? state.sessions.filter(s => s.inviteId !== id) : state.sessions });
          json(res, 200, { invite: publicInvite(invite) });
        } else error(res, 404, 'Unknown alpha route');
      } else error(res, 404, 'Unknown alpha route');
    } catch (err) {
      error(res, err === 400 || err === 413 ? err : 503,
        err === 413 ? 'Request too large' : err === 400 ? 'Invalid request' : 'Alpha persistence unavailable');
    }
    return true;
  }

  // Run before every API/static handler and use authorizeUpgrade before other upgrade listeners.
  function authorize(req: IncomingMessage, res: ServerResponse) {
    if (!enabled) return true;
    res.setHeader('Cache-Control', 'no-store');
    if (failed || closed) { error(res, 503, 'Alpha persistence unavailable'); return false; }
    if (req.headers.host !== origin.host || (req.headers.origin && req.headers.origin !== origin.origin) ||
        (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
      error(res, 403, 'Same origin required'); return false;
    }
    const session = resourceSession(req);
    if (session) { own(session, res); return true; }
    error(res, 401, 'Tester session required'); return false;
  }
  async function guard(req: IncomingMessage, res: ServerResponse,
    serveBootstrap?: (html: string) => Promise<void>) {
    if (await handle(req, res)) return true;
    if (!enabled) return false;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (!res.getHeader('Cross-Origin-Embedder-Policy')) res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); }
    catch { error(res, 400, 'Invalid path'); return true; }
    if (pathname === '/healthz' && ['GET', 'HEAD'].includes(req.method || '')) return false;
    if (req.headers.host !== origin.host) { error(res, 403, 'Same origin required'); return true; }
    const read = ['GET', 'HEAD'].includes(req.method || '');
    const bootstrap = ['/_alpha/login', '/_alpha/admin', '/alpha-bootstrap.html'].includes(pathname);
    if (read && /^\/alpha-public\/[A-Za-z0-9_./-]+$/.test(pathname) &&
        !pathname.split('/').some(part => part.startsWith('.'))) return false;
    const document = read && (pathname === '/' || !path.extname(pathname) || pathname.endsWith('.html')) &&
      req.headers.accept?.includes('text/html');
    if (read && (bootstrap || (document && !resourceSession(req)))) {
      try {
        const html = readFileSync(path.join(webRoot, 'alpha-bootstrap.html'), 'utf8');
        if (serveBootstrap) await serveBootstrap(html);
        else {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(req.method === 'HEAD' ? undefined : html);
        }
      } catch { error(res, 503, 'Alpha bootstrap unavailable'); }
      return true;
    }
    // In development Vite can serve arbitrary filesystem paths. Never expose state/env/server sources.
    if (/^\/(?:@fs|@id)\//.test(pathname) || /(?:^|\/)\.env(?:\.|$)/.test(pathname) ||
        /^\/(?:gateway\/|printerGateway\.ts|vite\.config\.)/.test(pathname)) {
      error(res, 404, 'Not found'); return true;
    }
    return !authorize(req, res);
  }
  function authorizeUpgrade(req: IncomingMessage, socket: Duplex) {
    if (!enabled) return true;
    if (failed || closed || req.headers.host !== origin.host || req.headers.origin !== origin.origin ||
        (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) return false;
    const session = resourceSession(req);
    if (!session) return false;
    own(session, socket);
    return true;
  }
  return { enabled, handle, guard, authorize, close, authorizeUpgrade,
    hasSession: (req: IncomingMessage) => !enabled || !!resourceSession(req) };
}
