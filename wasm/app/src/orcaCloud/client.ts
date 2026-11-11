import type { CloudPresetApi, SyncReply } from './types.ts';
export type OAuthProvider = 'google' | 'apple' | 'github';
/** Browser services may be injected for tests; credentials never come from URLs/messages. */
export interface CloudBrowserEnvironment {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  locks: Pick<LockManager, 'request'>;
  crypto: Pick<Crypto, 'getRandomValues'>;
}
export interface CloudStatus {
  accountId: string | null;
  pending: boolean;
  outcome: 'expired' | 'failed' | 'complete' | null;
  callback: string | null;
  callbackConfirmed: boolean;
  setup: 'callback-required' | 'callback-allowlist-unverified' | 'configured';
  presetWrites: boolean;
}
/** Same-profile tabs/reloads share a secret in app localStorage per gateway origin.
 * Web Locks and secure random bytes are required. Gateway restarts require login again.
 */
export function createOrcaCloudClient(gatewayBase: string, request: typeof fetch = fetch, environment?: CloudBrowserEnvironment) {
  const base = new URL(gatewayBase);
  if (base.username || base.password || base.search || base.hash ||
      !(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) throw new Error('Use an HTTPS or loopback Orca gateway.');
  let credential: Promise<string> | undefined;
  function browserCredential(): Promise<string> {
    return credential ??= (async () => {
      try {
        const env = environment ?? { storage: localStorage, locks: navigator.locks, crypto: globalThis.crypto };
        if (!env.locks || !env.crypto) throw new Error();
        const key = `orca-cloud-session:${base.origin}`;
        return await env.locks.request(key, async () => {
          const existing = env.storage.getItem(key);
          if (existing !== null) {
            if (!/^[a-f0-9]{64}$/.test(existing)) throw new Error();
            return existing;
          }
          const secret = Array.from(env.crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
          env.storage.setItem(key, secret);
          return secret;
        });
      } catch { throw new Error('Orca Cloud requires secure browser storage and Web Locks. Check browser setup.'); }
    })();
  }
  async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const secret = await browserCredential();
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await request(new URL(`/_orca-cloud/${path}`, base), {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'x-orca-cloud': '1', 'x-orca-cloud-session': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal
      });
    } catch { throw new Error('Orca gateway unavailable. Local work retained.'); }
    if (!response.ok) {
      // Never display callback URL, upstream response bodies, code or tokens.
      const messages: Record<number, string> = { 401: 'Sign in to Orca Cloud again.', 403: 'Enable the Orca bridge and allow this app origin.', 409: 'Check Orca callback setup or sign out before changing accounts.', 413: 'Preset exceeds 1 MiB.' };
      throw new Error(messages[response.status] ?? 'Orca Cloud request failed. Check gateway setup and try again.');
    }
    return response.json() as Promise<T>;
  }
  const status = (signal?: AbortSignal) => call<CloudStatus>('status', undefined, signal);
  const begin = (provider: OAuthProvider) => call<{ url: string; expiresAt: number; callbackConfirmed: boolean }>('begin', { provider });
  const complete = (callbackUrl: string) => call<CloudStatus>('complete', { callbackUrl });
  const logout = () => call<CloudStatus>('logout', {});
  const presets = (accountId: string): CloudPresetApi => ({
    pull: cursor => call<SyncReply>('api', { accountId, method: 'GET', path: `/api/v1/sync/pull${cursor === undefined ? '' : `?cursor=${cursor}`}` }),
    push: (body, force = false) => call<SyncReply>('api', { accountId, method: 'POST', path: force ? '/api/v1/sync/force-push' : '/api/v1/sync/push', body }),
    delete: id => call<SyncReply>('api', { accountId, method: 'DELETE', path: `/api/v1/sync/delete?resource=profiles&id=${encodeURIComponent(id)}` })
  });
  return { status, begin, complete, logout, presets };
}
