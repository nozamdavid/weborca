import { isOctoEverywhereConnection, safeOctoEverywhereUserUrl } from './octoEverywhereMapping';
import type { OctoEverywhereConnection, OctoEverywherePortalFlow, OctoEverywherePortalResult } from './octoEverywhereTypes';

export type { OctoEverywherePortalFlow };

const PORTAL_STORAGE_PREFIX = 'orca.oe.portal.';
const PORTAL_RESULT_PREFIX = 'orca.oe.portal.result.';
const PORTAL_CHANNEL_NAME = 'orca-octoeverywhere-portal';
const PORTAL_TTL_MS = 10 * 60_000;
const PORTAL_RESULT_TTL_MS = 60_000;
const CALLBACK_PATH_RE = /^\/octoeverywhere\/callback\/([\w-]+)$/;

type PortalTerminalResult = Exclude<OctoEverywherePortalResult, { status: 'pending' }>;

function getStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sweepExpiredPortalEntries(storage: Storage | undefined, now: number): void {
  if (!storage) return;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(PORTAL_STORAGE_PREFIX)) keys.push(key);
  }
  for (const key of keys) {
    try {
      const raw = storage.getItem(key);
      if (!raw) { storage.removeItem(key); continue; }
      const parsed = JSON.parse(raw) as { expiresAt?: unknown };
      if (typeof parsed?.expiresAt !== 'number' || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= now) {
        storage.removeItem(key);
      }
    } catch {
      storage.removeItem(key);
    }
  }
}

function portalUserFacingUrl(raw: string | undefined, printerName?: string): string {
  if (!raw) return 'https://octoeverywhere.com/';
  if (raw.length > 4096 || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error('Invalid OctoEverywhere URL.');
  }
  const safe = safeOctoEverywhereUserUrl(raw);
  if (safe) return safe;
  if (printerName) {
    const stripped = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    const prefix = 'https://';
    const suffix = '.octoeverywhere.com';
    if (
      stripped.toLowerCase() === `${prefix}${printerName.toLowerCase()}${suffix}` &&
      !/[/@\\?:]/.test(stripped.slice(prefix.length))
    ) {
      return 'https://octoeverywhere.com/';
    }
  }
  throw new Error('Invalid OctoEverywhere URL.');
}

function parseTerminalResult(raw: unknown): PortalTerminalResult | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as PortalTerminalResult;
  if (r.status === 'complete') {
    return isOctoEverywhereConnection(r.connection) ? r : undefined;
  }
  if (r.status === 'failed' && typeof r.error === 'string') {
    return r;
  }
  return undefined;
}

function deliverPortalResult(flowId: string, result: PortalTerminalResult, storage: Storage | undefined): void {
  const resultKey = `${PORTAL_RESULT_PREFIX}${flowId}`;
  try {
    storage?.setItem(resultKey, JSON.stringify({ expiresAt: Date.now() + PORTAL_RESULT_TTL_MS, result }));
  } catch { /* Ignore storage quota errors; BroadcastChannel may still deliver. */ }
  if (typeof globalThis.BroadcastChannel === 'function') {
    const channel = new globalThis.BroadcastChannel(PORTAL_CHANNEL_NAME);
    try {
      channel.postMessage({ flowId, result });
    } finally {
      channel.close?.();
    }
  }
}

export function createPortalFlow(
  appId: string,
  options?: { printerId?: string; requestOctoPrintApiKey?: boolean; origin?: string }
): OctoEverywherePortalFlow {
  if (!appId || !/^[\w-]{1,128}$/.test(appId)) {
    throw new Error('Invalid OctoEverywhere App ID.');
  }
  const rawOrigin = options?.origin ?? globalThis.location?.origin;
  if (!rawOrigin) {
    throw new Error('OctoEverywhere portal requires an origin.');
  }
  const originUrl = new URL(rawOrigin);
  if ((originUrl.protocol !== 'https:' && originUrl.protocol !== 'http:') || originUrl.username || originUrl.password) {
    throw new Error('Invalid OctoEverywhere portal origin.');
  }

  const now = Date.now();
  const expiresAt = now + PORTAL_TTL_MS;
  const flowId = randomBase64Url(24);
  const storage = getStorage();
  sweepExpiredPortalEntries(storage, now);
  storage?.setItem(`${PORTAL_STORAGE_PREFIX}${flowId}`, JSON.stringify({ expiresAt }));

  const returnUrl = `${originUrl.origin}/octoeverywhere/callback/${flowId}`;
  const portal = new URL('https://octoeverywhere.com/appportal/v1/');
  portal.searchParams.set('appid', appId);
  portal.searchParams.set('returnUrl', returnUrl);
  if (options?.printerId) portal.searchParams.set('printerId', options.printerId);
  if (options?.requestOctoPrintApiKey) portal.searchParams.set('octoPrintApiKeyAppName', 'WebOrca');

  return { flowId, portalUrl: portal.href, expiresAt };
}

export function completePortalCallback(callbackUrl: string): { status: 'complete' | 'failed' | 'ignored' } {
  let url: URL;
  try {
    url = new URL(callbackUrl, globalThis.location?.origin ?? 'http://localhost');
  } catch {
    return { status: 'ignored' };
  }
  const match = CALLBACK_PATH_RE.exec(url.pathname);
  if (!match) return { status: 'ignored' };
  const flowId = match[1];

  const storage = getStorage();
  const flowKey = `${PORTAL_STORAGE_PREFIX}${flowId}`;
  const rawFlow = storage?.getItem(flowKey);
  if (!rawFlow) return { status: 'ignored' };
  storage?.removeItem(flowKey);

  let flowExpiresAt: number | undefined;
  try {
    const parsed = JSON.parse(rawFlow) as { expiresAt?: unknown };
    flowExpiresAt = typeof parsed?.expiresAt === 'number' ? parsed.expiresAt : undefined;
  } catch {
    return { status: 'ignored' };
  }
  if (flowExpiresAt === undefined || !Number.isFinite(flowExpiresAt) || flowExpiresAt <= Date.now()) {
    return { status: 'ignored' };
  }

  const fail = (error = 'OctoEverywhere authorization did not complete. Try linking again.'): { status: 'failed' } => {
    deliverPortalResult(flowId, { status: 'failed', error }, storage);
    return { status: 'failed' };
  };

  try {
    const search = url.searchParams;
    const params = new Map<string, string>();
    for (const [name, value] of search) {
      if (search.getAll(name).length !== 1) return fail();
      const key = name.toLowerCase();
      const prev = params.get(key);
      if (prev !== undefined && prev !== value) return fail();
      params.set(key, value);
    }

    const param = (name: string) => params.get(name.toLowerCase());
    const nonEmpty = (name: string) => { const v = param(name); return v ? v : undefined; };

    if (param('success')?.toLowerCase() !== 'true') return fail();

    const bearer = nonEmpty('authBearerToken');
    const basicUser = nonEmpty('authBasicHttpUser');
    const basicPass = nonEmpty('authBasicHttpPassword');
    const auth: OctoEverywhereConnection['auth'] = bearer
      ? { type: 'bearer', token: bearer }
      : basicUser !== undefined || basicPass !== undefined
        ? (basicUser !== undefined && basicPass !== undefined
            ? { type: 'basic', username: basicUser, password: basicPass }
            : (() => { throw new Error('Partial basic auth.'); })())
        : { type: 'none' };

    const rawTargetUrl = param('url');
    if (!rawTargetUrl || rawTargetUrl.length > 4096 || /[\u0000-\u001f\u007f]/.test(rawTargetUrl)) {
      return fail();
    }
    const normalizedTargetUrl = new URL(rawTargetUrl).href;

    const printerName = param('printername') ?? '';
    const userFacingUrl = portalUserFacingUrl(nonEmpty('userPrinterAccessUrl'), printerName);
    const nativeApiKey = nonEmpty('octoPrintApiKey');
    const lastKnownLocalIp = nonEmpty('printerLastKnownLocalIp');

    const connection: OctoEverywhereConnection = {
      connectionId: param('id') ?? '',
      url: normalizedTargetUrl,
      appApiToken: param('appApiToken') ?? '',
      auth,
      printerName,
      userFacingUrl,
      ...(nativeApiKey === undefined ? {} : { nativeApiKey }),
      ...(lastKnownLocalIp === undefined ? {} : { lastKnownLocalIp })
    };

    if (!isOctoEverywhereConnection(connection)) return fail();

    deliverPortalResult(flowId, { status: 'complete', connection }, storage);
    return { status: 'complete' };
  } catch {
    return fail();
  }
}

export function listenPortalFlow(
  flow: OctoEverywherePortalFlow,
  onResult: (result: PortalTerminalResult) => void
): () => void {
  const storage = getStorage();
  const flowKey = `${PORTAL_STORAGE_PREFIX}${flow.flowId}`;
  const resultKey = `${PORTAL_RESULT_PREFIX}${flow.flowId}`;
  let settled = false;
  let channel: BroadcastChannel | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (channel) { channel.onmessage = null; channel.close?.(); channel = undefined; }
    if (typeof globalThis.window?.removeEventListener === 'function') {
      globalThis.window.removeEventListener('storage', onStorage);
    }
  };

  const deliver = (result: PortalTerminalResult) => {
    if (settled) return;
    settled = true;
    try { storage?.removeItem(resultKey); } catch { /* ignore */ }
    cleanup();
    onResult(result);
  };

  const consumeRaw = (raw: string | null | undefined): boolean => {
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as { expiresAt?: unknown; result?: unknown };
      if (typeof parsed?.expiresAt !== 'number' || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) {
        return false;
      }
      const valid = parseTerminalResult(parsed.result);
      if (!valid) return false;
      deliver(valid);
      return true;
    } catch {
      return false;
    }
  };

  const tryConsumeStorage = (): boolean => {
    const raw = storage?.getItem(resultKey);
    if (!raw) return false;
    storage?.removeItem(resultKey);
    return consumeRaw(raw);
  };

  const onStorage = (event: StorageEvent) => {
    if (settled) return;
    if (event.key !== null && event.key !== resultKey) return;
    if (!tryConsumeStorage() && event.key === resultKey && typeof event.newValue === 'string') {
      consumeRaw(event.newValue);
    }
  };

  if (tryConsumeStorage()) {
    return () => {};
  }

  if (typeof globalThis.BroadcastChannel === 'function') {
    channel = new globalThis.BroadcastChannel(PORTAL_CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent) => {
      if (settled) return;
      const data = event?.data as { flowId?: unknown; result?: unknown } | undefined;
      if (!data || data.flowId !== flow.flowId) return;
      const valid = parseTerminalResult(data.result);
      deliver(valid ?? { status: 'failed', error: 'OctoEverywhere authorization did not complete. Try linking again.' });
    };
  }

  if (typeof globalThis.window?.addEventListener === 'function') {
    globalThis.window.addEventListener('storage', onStorage);
  }

  const remainingMs = Math.max(0, Math.min(flow.expiresAt - Date.now(), 2_147_483_647));
  timer = setTimeout(() => {
    try { storage?.removeItem(flowKey); } catch { /* ignore */ }
    try { storage?.removeItem(resultKey); } catch { /* ignore */ }
    deliver({ status: 'failed', error: 'OctoEverywhere authorization timed out. Try connecting again.' });
  }, remainingMs);

  return () => {
    if (settled) return;
    settled = true;
    cleanup();
  };
}

export function cancelPortalFlow(flowId: string): void {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(`${PORTAL_STORAGE_PREFIX}${flowId}`);
  storage.removeItem(`${PORTAL_RESULT_PREFIX}${flowId}`);
}
