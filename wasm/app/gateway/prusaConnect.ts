/**
 * MIT License
 * Portions ported from prusactl by trevin-lee (https://github.com/trevin-lee/prusactl)
 *
 * Prusa Connect gateway bridge: a restricted reverse proxy between the web app and
 * Prusa Account / Prusa Connect HTTPS servers.
 *
 * Opt-in:
 *   Only active when options.cloud includes 'prusa-connect'.
 *
 * Strict policy:
 *   - OAuth2 Authorization Code flow with PKCE (S256).
 *   - Bounded server-side password/OTP login with isolated Account cookies.
 *   - Validates state, exchanges auth code for rotating JWT tokens.
 *   - Only allowlisted Connect endpoints can be called.
 *   - Job control only: PAUSE_PRINT, RESUME_PRINT, STOP_PRINT.
 *   - Camera snapshot proxying with trusted host verification.
 *   - 401 automatic token refresh and retry.
 *   - Trusted-host rule: HTTPS on prusa3d.com or *.prusa3d.com only (SSRF-safe).
 *   - Upstream timeouts, abort on client disconnect, request body size limits.
 *   - Never logs or echoes authentication tokens.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import { configFromEnv } from './policy.ts';
import type { GatewayConfig } from './policy.ts';
import { PrusaAccountLogin } from './prusaAccountLogin.ts';

export interface PrusaConnectGatewayOptions extends GatewayConfig {
  prusaConnect?: {
    accountUrl?: string;
    connectUrl?: string;
    graphqlUrl?: string;
    clientId?: string;
    redirectUri?: string;
    rejectUnauthorized?: boolean;
  };
}

export const DEFAULT_PRUSA_ACCOUNT_URL = 'https://account.prusa3d.com';
export const DEFAULT_PRUSA_CLIENT_ID = 'MRHTlZhZqkNrrQ6FUPtjyusAz8nc59ErHXP8XkS4';
export const DEFAULT_PRUSA_REDIRECT_URI = 'https://connect.prusa3d.com/login/auth-callback';
export const DEFAULT_PRUSA_CONNECT_URL = 'https://connect.prusa3d.com';
export const DEFAULT_PRUSA_GRAPHQL_URL = 'https://connect-api.prusa3d.com/graphql';

const MAX_JSON_BODY_BYTES = 64 * 1024; // 64 KB
const UPSTREAM_TIMEOUT_MS = 30_000;
const UPSTREAM_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RICH_TOOL_ID = /^(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?$/;
// Projection of the retained first-party GetPrinterFffTelemetry document. Never
// accept a document, organization or GraphQL options from the browser.
const MATERIALS_QUERY = `query GetPrinterFffTelemetry($organizationId: UUID!, $printerId: UUID!) {
  printer { printer(organizationId: $organizationId, printerId: $printerId) {
    __typename
    ... on Printer { id fff { hasMmuEnabled tools {
      id class type telemetry { active }
      materialPackageInstance { __typename
        ... on FFFToolMaterialPackageInstance { uuid isFromNfc package { material {
          uuid name abbreviation type { abbreviation } brand { name } primaryColor { colorRgba }
        } } }
        ... on ToolMaterialPackageInstanceEmpty { reason }
      }
    } } }
    ... on ConnectError { message }
    ... on DuplicateMaterialPackageInstanceError { message }
  } }
}`;

function richAssignments(data: any, printerId: string) {
  const printer = data?.data?.printer?.printer;
  if (data?.errors !== undefined || printer?.__typename !== 'Printer' || printer.id !== printerId ||
      typeof printer.fff?.hasMmuEnabled !== 'boolean' || !Array.isArray(printer.fff.tools) ||
      printer.fff.tools.length > 256) throw new Error();
  const ids = new Set<string>();
  const text = (value: unknown): string | undefined => {
    if (value == null) return undefined;
    if (typeof value !== 'string' || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) throw new Error();
    return value.trim() || undefined;
  };
  const optionalRecord = (value: any) => {
    if (value != null && (typeof value !== 'object' || Array.isArray(value))) throw new Error();
    return value;
  };
  return { tools: printer.fff.tools.map((tool: any) => {
    if (!tool || typeof tool.id !== 'string' || !RICH_TOOL_ID.test(tool.id) ||
        tool.id.split('.').some((id: string) => !Number.isSafeInteger(Number(id)) || Number(id) >= Number.MAX_SAFE_INTEGER) ||
        ids.has(tool.id) || typeof tool.type !== 'string' || !/^[A-Z_]{1,64}$/.test(tool.type) ||
        (tool.type === 'FEEDER') !== tool.id.includes('.')) throw new Error();
    ids.add(tool.id);
    const assignment = tool.materialPackageInstance;
    let presence: 'present' | 'empty' | 'unknown' = 'unknown';
    let material: string | undefined, vendor: string | undefined, subtype: string | undefined, color: string | undefined;
    if (assignment?.__typename === 'ToolMaterialPackageInstanceEmpty') presence = 'empty';
    if (assignment?.__typename === 'FFFToolMaterialPackageInstance') {
      const record = optionalRecord(optionalRecord(assignment.package)?.material);
      optionalRecord(record?.type);
      optionalRecord(record?.brand);
      optionalRecord(record?.primaryColor);
      // UUIDs establish an assignment record, never physical spool presence.
      if (text(assignment.uuid) || text(record?.uuid)) {
        presence = 'present';
        material = text(record?.type?.abbreviation);
        vendor = text(record?.brand?.name);
        subtype = text(record?.name) || text(record?.abbreviation);
        const rgba = text(record?.primaryColor?.colorRgba)?.replace(/^#/, '');
        if (rgba && /^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(rgba)) color = `#${rgba}`;
      }
    }
    return { id: tool.id, type: tool.type, presence, material: material || '', vendor, subtype, color };
  }) };
}

export interface PKCEPair {
  verifier: string;
  challenge: string;
  state: string;
}

/**
 * Creates PKCE verifier, challenge (S256), and state as unpadded base64url strings.
 */
export function newPKCE(): PKCEPair {
  const verifierBytes = randomBytes(64);
  const verifier = verifierBytes.toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const stateBytes = randomBytes(24);
  const state = stateBytes.toString('base64url');
  return { verifier, challenge, state };
}

/**
 * Generates the authorize URL for Prusa Account sign-in.
 */
export function buildAuthorizeUrl(accountUrl: string, clientId: string, redirectUri: string, pkce: PKCEPair): string {
  const base = accountUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    code_challenge_method: 'S256',
    code_challenge: pkce.challenge,
    redirect_uri: redirectUri,
    state: pkce.state
  });
  return `${base}/o/authorize/?${params.toString()}`;
}

/**
 * Validates the complete callback URL and extracts the authorization code.
 */
export function codeFromCallback(pasted: string, expectedState: string, redirectUri = DEFAULT_PRUSA_REDIRECT_URI): string {
  const trimmed = pasted.trim();
  if (!trimmed) {
    throw new Error('Nothing was pasted');
  }

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error('Paste the complete callback URL containing code and state');
  }
  const original = new URL(redirectUri);
  const rawCallbackPath = trimmed.match(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*(\/[^?#]*)?/i)?.[1] || '/';
  if (u.origin !== original.origin || u.pathname !== original.pathname ||
      rawCallbackPath !== u.pathname || trimmed.includes('\\') || u.username || u.password || trimmed.includes('#')) {
    throw new Error('Sign-in callback does not match the original callback URL');
  }

  const err = u.searchParams.get('error');
  if (err) {
    throw new Error('Sign-in was refused by Prusa Account; start again');
  }

  const states = u.searchParams.getAll('state');
  if (!expectedState || states.length !== 1 || !states[0].trim() || states[0] !== expectedState) {
    throw new Error('Sign-in callback had the wrong state parameter; try again');
  }

  const codes = u.searchParams.getAll('code');
  if (codes.length !== 1 || !codes[0].trim()) {
    throw new Error('Sign-in callback must contain exactly one nonempty authorization code');
  }
  return codes[0];
}

/**
 * Parses JWT exp claim if present, returning epoch milliseconds.
 */
export function parseJwtExpiry(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
      return payload.exp * 1000;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Enforces trusted host policy: HTTPS on prusa3d.com or *.prusa3d.com,
 * or explicitly configured test hosts.
 */
export function isTrustedPrusaHost(rawUrl: string, allowedOrigins: string[] = []): boolean {
  try {
    const u = new URL(rawUrl);
    const envOrigins = [process.env.PRUSA_ACCOUNT_URL, process.env.PRUSA_CONNECT_URL, process.env.PRUSA_CONNECT_GRAPHQL_URL].filter(Boolean) as string[];
    for (const own of [...allowedOrigins, ...envOrigins]) {
      if (!own) continue;
      try {
        const o = new URL(own);
        if (o.protocol.toLowerCase() === u.protocol.toLowerCase() && o.host.toLowerCase() === u.host.toLowerCase()) {
          return true;
        }
      } catch {
        // ignore invalid origin
      }
    }
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:') return false;
    return host === 'prusa3d.com' || host.endsWith('.prusa3d.com');
  } catch {
    return false;
  }
}

// In-memory pending PKCE login states (five minutes, at most 256 attempts).
interface PendingLogin {
  verifier: string;
  redirectUri: string;
  state: string;
  expires: number;
  accountUrl: string;
  clientId: string;
  login?: PrusaAccountLogin;
  busy?: boolean;
}
const pendingLogins = new Map<string, PendingLogin>();

function sweepPendingLogins() {
  const now = Date.now();
  for (const [key, item] of pendingLogins) {
    if (item.expires <= now) {
      pendingLogins.delete(key);
    }
  }
}

function fail(res: http.ServerResponse, status: number, message: string) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: message }));
}

async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytesRead += buf.length;
    if (bytesRead > maxBytes) {
      throw new Error('Payload Too Large: request body exceeded size limit');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

const ALLOWED_COMMANDS = new Set(['PAUSE_PRINT', 'RESUME_PRINT', 'STOP_PRINT']);

interface RouteValidation {
  allowed: boolean;
  isUploadRaw?: boolean;
  isCommand?: boolean;
}

/**
 * Validates method and path against strict allowlist.
 */
export function validateConnectRoute(method: string, pathWithoutQuery: string): RouteValidation {
  const m = method.toUpperCase();

  // GET /app/login
  if (m === 'GET' && pathWithoutQuery === '/app/login') {
    return { allowed: true };
  }
  // POST /app/register
  if (m === 'POST' && pathWithoutQuery === '/app/register') {
    return { allowed: true };
  }
  // GET /app/printers
  if (m === 'GET' && pathWithoutQuery === '/app/printers') {
    return { allowed: true };
  }
  // GET /app/printers/:uuid
  if (m === 'GET' && /^\/app\/printers\/[a-zA-Z0-9_-]+$/.test(pathWithoutQuery)) {
    return { allowed: true };
  }
  // GET /app/printers/:uuid/(storages|supported-commands|cameras|queue|download-queue|transfers)
  if (m === 'GET' && /^\/app\/printers\/[a-zA-Z0-9_-]+\/(?:storages|supported-commands|cameras|queue|download-queue|transfers)$/.test(pathWithoutQuery)) {
    return { allowed: true };
  }
  // POST /app/printers/:uuid/queue
  if (m === 'POST' && /^\/app\/printers\/[a-zA-Z0-9_-]+\/queue$/.test(pathWithoutQuery)) {
    return { allowed: true };
  }
  // DELETE /app/printers/:uuid/queue/:jobId
  if (m === 'DELETE' && /^\/app\/printers\/[a-zA-Z0-9_-]+\/queue\/[a-zA-Z0-9_-]+$/.test(pathWithoutQuery)) {
    return { allowed: true };
  }
  // POST /app/printers/:uuid/commands/sync
  if (m === 'POST' && /^\/app\/printers\/[a-zA-Z0-9_-]+\/commands\/sync$/.test(pathWithoutQuery)) {
    return { allowed: true, isCommand: true };
  }
  // POST /app/users/teams/:teamId/uploads
  if (m === 'POST' && /^\/app\/users\/teams\/[0-9]+\/uploads$/.test(pathWithoutQuery)) {
    return { allowed: true };
  }
  // PUT /app/teams/:teamId/files/raw
  if (m === 'PUT' && /^\/app\/teams\/[0-9]+\/files\/raw$/.test(pathWithoutQuery)) {
    return { allowed: true, isUploadRaw: true };
  }
  // POST /app/uploads/:uploadId/abort
  if (m === 'POST' && /^\/app\/uploads\/[a-zA-Z0-9_-]+\/abort$/.test(pathWithoutQuery)) {
    return { allowed: true };
  }
  // GET /app/cameras/:id/snapshots/last
  if (m === 'GET' && /^\/app\/cameras\/[a-zA-Z0-9_-]+\/snapshots\/last$/.test(pathWithoutQuery)) {
    return { allowed: true };
  }
  // GET /thumbnail/camera/:id
  if (m === 'GET' && /^\/thumbnail\/camera\/[a-zA-Z0-9_-]+$/.test(pathWithoutQuery)) {
    return { allowed: true };
  }
  // GraphQL is available only through the fixed, membership-checked read below.

  return { allowed: false };
}

/**
 * Handles incoming Prusa Connect HTTP requests through the gateway.
 */
export async function handlePrusaConnectRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawPath: string,
  options?: PrusaConnectGatewayOptions
): Promise<boolean> {
  // 1. Opt-in verification: Prusa Connect must be explicitly enabled
  const cloudSetting = (options?.cloud ?? configFromEnv().cloud ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase());
  if (!cloudSetting.includes('prusa-connect')) {
    fail(res, 403, 'Prusa Connect is not enabled on this gateway.');
    return false;
  }

  const overrides = options?.prusaConnect;
  const envAccount = process.env.PRUSA_ACCOUNT_URL?.trim();
  const envConnect = process.env.PRUSA_CONNECT_URL?.trim();
  const envGraphql = process.env.PRUSA_CONNECT_GRAPHQL_URL?.trim();
  const envClientId = process.env.PRUSA_CLIENT_ID?.trim();
  const envRedirectUri = process.env.PRUSA_REDIRECT_URI?.trim();

  const accountUrl = overrides?.accountUrl || envAccount || DEFAULT_PRUSA_ACCOUNT_URL;
  const connectUrl = overrides?.connectUrl || envConnect || DEFAULT_PRUSA_CONNECT_URL;
  const graphqlUrl = overrides?.graphqlUrl || envGraphql || DEFAULT_PRUSA_GRAPHQL_URL;
  const clientId = overrides?.clientId || envClientId || DEFAULT_PRUSA_CLIENT_ID;
  const redirectUri = overrides?.redirectUri || envRedirectUri || DEFAULT_PRUSA_REDIRECT_URI;
  const rejectUnauthorized = overrides?.rejectUnauthorized ?? true;

  const allowedOrigins = [accountUrl, connectUrl, graphqlUrl];

  // 2. Normalize route
  const subpath = rawPath.replace(/^\/?(?:_printer\/prusa-connect\/)?/, '');
  const [pathname, queryString] = subpath.split('?');
  const fullSubpath = '/' + pathname.replace(/^\/+/, '');
  const method = (req.method || 'GET').toUpperCase();

  // Path sanitization: reject path traversal
  if (fullSubpath.includes('..') || fullSubpath.includes('//')) {
    fail(res, 400, 'Invalid path');
    return false;
  }

  sweepPendingLogins();

  // ---------------------------------------------------------------------------
  // AUTH ROUTE: Start Login
  // ---------------------------------------------------------------------------
  if (method === 'POST' && fullSubpath === '/auth/start') {
    if (pendingLogins.size >= 256) {
      fail(res, 429, 'Too many pending sign-in attempts. Try again later.');
      return false;
    }
    const pkce = newPKCE();
    pendingLogins.set(pkce.state, { ...pkce, redirectUri, accountUrl, clientId, expires: Date.now() + 5 * 60 * 1000 });
    const expiryTimer = setTimeout(() => pendingLogins.delete(pkce.state), 5 * 60 * 1000);
    expiryTimer.unref();
    const authUrl = buildAuthorizeUrl(accountUrl, clientId, redirectUri, pkce);

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({
      authorizeUrl: authUrl,
      state: pkce.state,
      verifier: pkce.verifier
    }));
    return true;
  }

  // ---------------------------------------------------------------------------
  // AUTH ROUTE: Complete Login
  // ---------------------------------------------------------------------------
  if (method === 'POST' && ['/auth/complete', '/auth/password', '/auth/otp', '/auth/cancel'].includes(fullSubpath)) {
    res.setHeader('cache-control', 'no-store');
    let bodyBuffer: Buffer;
    try {
      bodyBuffer = await readBody(req, 8192);
    } catch (e: any) {
      fail(res, 413, e.message);
      return false;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(bodyBuffer.toString('utf8'));
    } catch {
      fail(res, 400, 'Invalid JSON body');
      return false;
    }

    const { state: passedState, verifier: passedVerifier } = parsed || {};
    let pasted = parsed?.pasted;

    const pending = typeof passedState === 'string' ? pendingLogins.get(passedState) : undefined;
    if (!pending || pending.expires <= Date.now() || pending.busy) {
      fail(res, 400, 'Missing, unknown or expired pending sign-in attempt; try again');
      return false;
    }
    if (passedVerifier !== undefined && passedVerifier !== pending.verifier) {
      fail(res, 400, 'PKCE verifier does not match the pending sign-in attempt');
      return false;
    }
    if (fullSubpath === '/auth/cancel') {
      pendingLogins.delete(passedState);
      res.setHeader('content-type', 'application/json');
      res.end('{}');
      return true;
    }
    if (fullSubpath === '/auth/password' || fullSubpath === '/auth/otp') {
      pending.busy = true;
      try {
        if (fullSubpath === '/auth/password') {
          if (pending.login || typeof parsed.email !== 'string' || !parsed.email || parsed.email.length > 320 ||
              typeof parsed.password !== 'string' || !parsed.password || parsed.password.length > 4096) throw new Error();
          const authorize = buildAuthorizeUrl(pending.accountUrl, pending.clientId, pending.redirectUri, {
            state: pending.state, verifier: pending.verifier,
            challenge: createHash('sha256').update(pending.verifier).digest('base64url')
          });
          pending.login = new PrusaAccountLogin(pending.accountUrl, authorize, pending.redirectUri,
            async (url, method, headers, body) => {
              const remaining = pending.expires - Date.now();
              if (remaining <= 0) throw new Error();
              return doFetch(url, { method, headers, body, timeoutMs: Math.min(UPSTREAM_TIMEOUT_MS, remaining),
                rejectUnauthorized, allowRedirectResponse: true, maxResponseBytes: 512 * 1024 });
            });
          pasted = await pending.login.password(parsed.email, parsed.password);
        } else {
          if (!pending.login || typeof parsed.code !== 'string' || !parsed.code.trim() || parsed.code.length > 64) throw new Error();
          pasted = await pending.login.otp(parsed.code);
        }
        if (pending.expires <= Date.now() || pendingLogins.get(passedState) !== pending) throw new Error();
        if (!pasted) {
          pending.busy = false;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ mfaRequired: true }));
          return true;
        }
      } catch {
        pendingLogins.delete(passedState);
        fail(res, 400, 'Prusa Account sign-in failed. Check your password or code and start again. Social login, passkeys and CAPTCHA are unsupported.');
        return false;
      } finally {
        parsed.password = '';
        parsed.code = '';
      }
    }
    if (!pasted || typeof pasted !== 'string') {
      fail(res, 400, 'Missing complete callback URL');
      return false;
    }

    let code: string;
    try {
      code = codeFromCallback(pasted, passedState, pending.redirectUri);
    } catch (e: any) {
      if (pending.login) pendingLogins.delete(passedState);
      fail(res, 400, e.message);
      return false;
    }

    // Exchange code at Account /o/token/
    const tokenUrl = new URL('/o/token/', pending.accountUrl).toString();
    if (!isTrustedPrusaHost(tokenUrl, allowedOrigins)) {
      fail(res, 403, 'Refusing to send credentials to untrusted host');
      return false;
    }

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
      client_id: pending.clientId
    });

    // Consume before exchange: a failed/ambiguous exchange must never replay a code.
    pendingLogins.delete(passedState);
    try {
      const tokenRes = await doFetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: form.toString(),
        timeoutMs: UPSTREAM_TIMEOUT_MS,
        maxResponseBytes: MAX_JSON_BODY_BYTES,
        rejectUnauthorized
      });

      const bodyText = tokenRes.body.toString('utf8');
      if (tokenRes.statusCode !== 200) {
        let errJson: any;
        try { errJson = JSON.parse(bodyText); } catch { /* ignore */ }
        const errCode = errJson?.error || 'token_exchange_failed';
        if (errCode === 'invalid_client' || errCode === 'unauthorized_client') {
          fail(res, tokenRes.statusCode, `Prusa Account rejected the client ID (${errCode})`);
        } else {
          fail(res, 502, 'Prusa Account token exchange failed; start sign-in again');
        }
        return false;
      }

      const tokenData = JSON.parse(bodyText);
      if (!tokenData.access_token) {
        fail(res, 502, 'Token endpoint returned no access_token');
        return false;
      }

      const expiry = parseJwtExpiry(tokenData.access_token) || (Date.now() + (tokenData.expires_in || 300) * 1000);
      if (passedState) pendingLogins.delete(passedState);

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        expiry
      }));
      return true;
    } catch {
      fail(res, 502, 'Failed to reach Prusa Account; start sign-in again');
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // AUTH ROUTE: Refresh Tokens
  // ---------------------------------------------------------------------------
  if (method === 'POST' && fullSubpath === '/auth/refresh') {
    let bodyBuffer: Buffer;
    try {
      bodyBuffer = await readBody(req, MAX_JSON_BODY_BYTES);
    } catch (e: any) {
      fail(res, 413, e.message);
      return false;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(bodyBuffer.toString('utf8'));
    } catch {
      fail(res, 400, 'Invalid JSON body');
      return false;
    }

    const refreshToken = parsed?.refresh_token;
    if (!refreshToken || typeof refreshToken !== 'string') {
      fail(res, 400, 'Missing refresh_token');
      return false;
    }

    try {
      const refreshed = await exchangeRefreshToken(accountUrl, clientId, refreshToken, rejectUnauthorized, allowedOrigins);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(refreshed));
      return true;
    } catch (e: any) {
      fail(res, 401, `Failed to refresh token: ${e.message}`);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // HELPER: Camera Snapshot Proxy
  // ---------------------------------------------------------------------------
  if (method === 'GET' && fullSubpath === '/camera/snapshot') {
    const query = new URLSearchParams(queryString || '');
    const uuid = query.get('uuid');
    const camId = query.get('cam_id');
    const token = (req.headers['authorization']?.replace(/^Bearer\s+/i, '') || query.get('token') || '').trim();

    if (!uuid || !camId || !/^[a-zA-Z0-9_-]+$/.test(uuid) || !/^[a-zA-Z0-9_-]+$/.test(camId)) {
      fail(res, 400, 'Invalid camera or printer parameters');
      return false;
    }
    if (!token) {
      fail(res, 401, 'Missing authorization token for camera snapshot');
      return false;
    }

    // Try primary snapshot endpoint
    const snapPath = `/app/cameras/${camId}/snapshots/last?printer_uuid=${encodeURIComponent(uuid)}`;
    const targetUrl = new URL(snapPath, connectUrl).toString();

    if (!isTrustedPrusaHost(targetUrl, allowedOrigins)) {
      fail(res, 403, 'Target URL is not a trusted Prusa host');
      return false;
    }

    try {
      let snapRes = await doFetch(targetUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'image/jpeg, image/*, */*'
        },
        timeoutMs: UPSTREAM_TIMEOUT_MS,
        rejectUnauthorized
      });

      // If 404, fallback to thumbnail endpoint
      if (snapRes.statusCode === 404) {
        const thumbUrl = new URL(`/thumbnail/camera/${camId}?printer_uuid=${encodeURIComponent(uuid)}`, connectUrl).toString();
        snapRes = await doFetch(thumbUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'image/jpeg, image/*, */*'
          },
          timeoutMs: UPSTREAM_TIMEOUT_MS,
          rejectUnauthorized
        });
      }

      res.statusCode = snapRes.statusCode;
      if (snapRes.headers['content-type']) {
        res.setHeader('content-type', snapRes.headers['content-type']);
      }
      res.setHeader('cache-control', 'no-store');
      res.end(snapRes.body);
      return true;
    } catch (e: any) {
      fail(res, 502, `Failed to fetch camera snapshot: ${e.message}`);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // PROXIED CONNECT CALLS
  // ---------------------------------------------------------------------------
  if (fullSubpath.endsWith('/materials')) {
    res.setHeader('cache-control', 'no-store');
    const match = fullSubpath.match(/^\/app\/printers\/([^/]+)\/materials$/);
    if (method !== 'GET' || !match || !CANONICAL_UUID.test(match[1]) ||
        rawPath !== `/_printer/prusa-connect${fullSubpath}` ||
        req.headers['transfer-encoding'] !== undefined ||
        (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) {
      fail(res, 400, 'Invalid materials request');
      return false;
    }
    // Also consume an unframed/empty body rather than accepting browser input.
    try { if ((await readBody(req, 0)).length) throw new Error(); }
    catch { fail(res, 400, 'Invalid materials request'); return false; }
    let token = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
    const refresh = req.headers['x-prusa-refresh-token'];
    if (!token) { fail(res, 401, 'Missing authorization token'); return false; }
    const printerId = match[1];
    let cancelled = res.destroyed;
    let abortUpstream: (() => void) | undefined;
    const cancel = () => {
      if (!res.writableFinished) {
        cancelled = true;
        abortUpstream?.();
      }
    };
    res.once('close', cancel);
    const ensureConnected = () => { if (cancelled || res.destroyed) throw new Error(); };
    const onClientAbort = (abort: () => void) => {
      abortUpstream = abort;
      if (cancelled || res.destroyed) abort();
    };
    const read = async (url: string, body?: string) => {
      ensureConnected();
      if (!isTrustedPrusaHost(url, allowedOrigins)) throw new Error();
      const upstream = await doFetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json', 'graphql-client-name': 'connect-web' }) },
        body, timeoutMs: UPSTREAM_TIMEOUT_MS, totalTimeout: true, maxResponseBytes: 1024 * 1024, rejectUnauthorized,
        onClientAbort
      });
      ensureConnected();
      if (upstream.statusCode === 401) throw new Error('unauthorized');
      if (upstream.statusCode !== 200) throw new Error();
      return JSON.parse(upstream.body.toString('utf8'));
    };
    const resolve = async () => {
      const list = await read(new URL('/app/printers', connectUrl).toString());
      if (!Array.isArray(list?.printers) || list.printers.length > 1000 ||
          list.printers.some((p: any) => !p || typeof p.uuid !== 'string' || !CANONICAL_UUID.test(p.uuid))) throw new Error();
      const matches = list.printers.filter((p: any) => p.uuid === printerId);
      if (matches.length !== 1 || !Number.isSafeInteger(matches[0].team_id) || matches[0].team_id < 0) throw new Error();
      const team = await read(new URL(`/app/users/teams/${matches[0].team_id}`, connectUrl).toString());
      if (typeof team?.organization_id !== 'string' || !CANONICAL_UUID.test(team.organization_id)) throw new Error();
      return richAssignments(await read(graphqlUrl, JSON.stringify({ query: MATERIALS_QUERY,
        variables: { organizationId: team.organization_id, printerId } })), printerId);
    };
    try {
      let result;
      try { result = await resolve(); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'unauthorized' || typeof refresh !== 'string' || !refresh.trim()) throw error;
        ensureConnected();
        const rotated = await exchangeRefreshToken(accountUrl, clientId, refresh.trim(), rejectUnauthorized, allowedOrigins, onClientAbort);
        ensureConnected();
        if (typeof rotated.access_token !== 'string' || !rotated.access_token || typeof rotated.refresh_token !== 'string') throw new Error();
        token = rotated.access_token;
        // Set immediately: downstream membership/GraphQL failure must not lose rotation.
        res.setHeader('x-prusa-access-token', rotated.access_token);
        res.setHeader('x-prusa-refresh-token', rotated.refresh_token);
        res.setHeader('access-control-expose-headers', 'x-prusa-access-token, x-prusa-refresh-token');
        result = await resolve();
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    } catch (error) {
      if (!cancelled && !res.destroyed) fail(res, error instanceof Error && error.message === 'unauthorized' ? 401 : 502, 'Prusa material assignments unavailable');
      return false;
    } finally {
      res.off('close', cancel);
      abortUpstream = undefined;
    }
  }
  const routeValidation = validateConnectRoute(method, fullSubpath);
  if (!routeValidation.allowed) {
    fail(res, 403, `Prusa Connect endpoint not in allowlist: ${method} ${fullSubpath}`);
    return false;
  }

  const upstreamPath = fullSubpath + (queryString ? `?${queryString}` : '');
  const targetUrl = new URL(upstreamPath, connectUrl).toString();

  if (!isTrustedPrusaHost(targetUrl, allowedOrigins)) {
    fail(res, 403, 'Upstream target is not a trusted Prusa host');
    return false;
  }

  // Token from request header
  const authHeader = req.headers['authorization'];
  let token = (authHeader ? authHeader.replace(/^Bearer\s+/i, '') : '').trim();
  const refreshToken = (req.headers['x-prusa-refresh-token'] as string | undefined)?.trim();

  // Read request body if present
  let bodyBuffer: Buffer | undefined;
  const maxBytes = routeValidation.isUploadRaw ? (options?.uploadMaxBytes ?? (1024 ** 3)) : MAX_JSON_BODY_BYTES;

  if (method === 'POST' || method === 'PUT') {
    try {
      bodyBuffer = await readBody(req, maxBytes);
    } catch (e: any) {
      fail(res, 413, e.message);
      return false;
    }

    // Strict validation for commands
    if (routeValidation.isCommand) {
      let cmdParsed: any;
      try {
        cmdParsed = JSON.parse(bodyBuffer.toString('utf8'));
      } catch {
        fail(res, 400, 'Invalid JSON body for command');
        return false;
      }
      const cmdName = String(cmdParsed?.command || '').toUpperCase();
      if (!ALLOWED_COMMANDS.has(cmdName)) {
        fail(res, 403, `Prusa Connect command not allowed: ${cmdName}`);
        return false;
      }
    }
  }

  // Forwarding headers
  const buildHeaders = (currentToken: string): http.OutgoingHttpHeaders => {
    const headers: http.OutgoingHttpHeaders = {
      'accept': req.headers['accept'] || 'application/json, */*'
    };
    if (currentToken) {
      headers['authorization'] = `Bearer ${currentToken}`;
    }
    if (req.headers['content-type']) {
      headers['content-type'] = req.headers['content-type'];
    }
    if (req.headers['upload-size']) {
      headers['upload-size'] = req.headers['upload-size'];
    }
    if (bodyBuffer) {
      headers['content-length'] = bodyBuffer.length;
    }
    return headers;
  };

  const timeoutMs = routeValidation.isUploadRaw ? UPSTREAM_UPLOAD_TIMEOUT_MS : UPSTREAM_TIMEOUT_MS;

  // Execute upstream request with 401 refresh-and-retry
  try {
    let upstreamRes = await doFetch(targetUrl, {
      method,
      headers: buildHeaders(token),
      body: bodyBuffer,
      timeoutMs,
      rejectUnauthorized,
      onClientAbort: (abort) => {
        res.on('close', () => {
          if (!res.writableFinished) abort();
        });
      }
    });

    let newTokens: { access_token: string; refresh_token: string } | undefined;

    // 401 retry with refresh token
    if (upstreamRes.statusCode === 401 && refreshToken) {
      try {
        const refreshed = await exchangeRefreshToken(accountUrl, clientId, refreshToken, rejectUnauthorized, allowedOrigins);
        token = refreshed.access_token;
        newTokens = { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token };

        // Retry with refreshed token
        upstreamRes = await doFetch(targetUrl, {
          method,
          headers: buildHeaders(token),
          body: bodyBuffer,
          timeoutMs,
          rejectUnauthorized
        });
      } catch {
        // Refresh failed: proceed to return original 401
      }
    }

    res.statusCode = upstreamRes.statusCode;
    if (upstreamRes.headers['content-type']) {
      res.setHeader('content-type', upstreamRes.headers['content-type']);
    }
    if (upstreamRes.headers['content-length']) {
      res.setHeader('content-length', upstreamRes.headers['content-length']);
    }
    if (newTokens) {
      res.setHeader('x-prusa-access-token', newTokens.access_token);
      res.setHeader('x-prusa-refresh-token', newTokens.refresh_token);
      res.setHeader('access-control-expose-headers', 'x-prusa-access-token, x-prusa-refresh-token');
    }
    res.setHeader('cache-control', 'no-store');
    res.end(upstreamRes.body);
    return true;
  } catch (e: any) {
    fail(res, 502, `Prusa Connect upstream error: ${e.message}`);
    return false;
  }
}

/**
 * Exchanges a refresh token for a fresh token pair.
 */
async function exchangeRefreshToken(
  accountUrl: string,
  clientId: string,
  refreshToken: string,
  rejectUnauthorized: boolean,
  allowedOrigins: string[],
  onClientAbort?: (abort: () => void) => void
): Promise<{ access_token: string; refresh_token: string; expires_in: number; expiry: number }> {
  const tokenUrl = new URL('/o/token/', accountUrl).toString();
  if (!isTrustedPrusaHost(tokenUrl, allowedOrigins)) {
    throw new Error('Refusing refresh to untrusted host');
  }

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId
  });

  const res = await doFetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: form.toString(),
    timeoutMs: UPSTREAM_TIMEOUT_MS,
    maxResponseBytes: MAX_JSON_BODY_BYTES,
    totalTimeout: true,
    onClientAbort,
    rejectUnauthorized
  });

  if (res.statusCode !== 200) {
    throw new Error(`Refresh token endpoint returned ${res.statusCode}: ${res.body.toString('utf8')}`);
  }

  const data = JSON.parse(res.body.toString('utf8'));
  if (!data.access_token) {
    throw new Error('Refresh response missing access_token');
  }

  const expiry = parseJwtExpiry(data.access_token) || (Date.now() + (data.expires_in || 300) * 1000);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_in: data.expires_in,
    expiry
  };
}

interface FetchOptions {
  method: string;
  headers?: http.OutgoingHttpHeaders;
  body?: Buffer | string;
  timeoutMs: number;
  rejectUnauthorized: boolean;
  allowRedirectResponse?: boolean;
  maxResponseBytes?: number;
  totalTimeout?: boolean;
  onClientAbort?: (abort: () => void) => void;
}

interface FetchResult {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/**
 * Low-level HTTP/HTTPS request with timeouts, redirect prevention, and abort handling.
 */
function doFetch(targetUrl: string, opts: FetchOptions): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const requestFn = isHttps ? https.request : http.request;

    const reqOptions: https.RequestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method,
      headers: {
        ...opts.headers,
        host: parsed.host
      },
      timeout: opts.timeoutMs,
      rejectUnauthorized: opts.rejectUnauthorized
    };

    const creq = requestFn(reqOptions, (cres) => {
      // Disallow off-site redirects
      const status = cres.statusCode || 500;
      if (!opts.allowRedirectResponse && status >= 300 && status < 400 && cres.headers.location) {
        cres.resume();
        reject(new Error(`Redirects not followed: ${status} to ${cres.headers.location}`));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      cres.on('data', (c) => {
        const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c);
        size += chunk.length;
        if (opts.maxResponseBytes && size > opts.maxResponseBytes) {
          cres.destroy(new Error('Upstream response exceeded size limit'));
          return;
        }
        chunks.push(chunk);
      });
      cres.on('end', () => {
        resolve({
          statusCode: status,
          headers: cres.headers,
          body: Buffer.concat(chunks)
        });
      });
      cres.on('error', (err) => reject(err));
    });

    // Account HTML requests have a total deadline as well as socket inactivity
    // timeout, so a trickling response cannot retain a credential submission.
    if (opts.allowRedirectResponse || opts.totalTimeout) {
      const deadline = setTimeout(() => creq.destroy(new Error('Upstream request timed out')), opts.timeoutMs);
      deadline.unref();
      creq.once('close', () => clearTimeout(deadline));
    }

    creq.on('timeout', () => {
      creq.destroy(new Error(`Upstream request to ${parsed.hostname} timed out`));
    });

    creq.on('error', (err) => {
      reject(err);
    });

    if (opts.onClientAbort) {
      opts.onClientAbort(() => creq.destroy());
    }

    if (opts.body) {
      creq.end(opts.body);
    } else {
      creq.end();
    }
  });
}
