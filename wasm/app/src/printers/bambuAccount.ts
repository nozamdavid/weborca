import { create } from 'zustand';
import { cloudJson } from './bambuCloud';
import { bambuCloudApiUrl } from './gatewayUrl';
import type { PhysicalPrinter } from './types';

const key = 'weborca.bambu-account.v1';
export const accountPrinter: PhysicalPrinter = { id: 'bambu-account', name: 'Bambu Cloud', host_type: 'bambu-cloud', print_host: 'us.mqtt.bambulab.com', use_gateway: true };
interface Account { accessToken: string; refreshToken?: string; expiresAt?: number; refreshExpiresAt?: number }
function restored(): Account | null {
  try { const a = JSON.parse(localStorage.getItem(key) || 'null');
    return a && typeof a.accessToken === 'string' && a.accessToken ? { accessToken: a.accessToken,
      refreshToken: typeof a.refreshToken === 'string' ? a.refreshToken : undefined,
      expiresAt: Number.isFinite(a.expiresAt) ? a.expiresAt : undefined,
      refreshExpiresAt: Number.isFinite(a.refreshExpiresAt) ? a.refreshExpiresAt : undefined } : null;
  } catch { return null; }
}
export const useBambuAccount = create<{ account: Account | null; status: string }>(() => ({ account: restored(), status: '' }));
let generation = 0;
let pending: Promise<void> | undefined;
class InvalidSession extends Error {}
function save(account: Account | null) {
  if (account) localStorage.setItem(key, JSON.stringify(account)); else localStorage.removeItem(key);
  useBambuAccount.setState({ account });
}
export function signOutBambu() { generation++; pending = undefined; save(null); useBambuAccount.setState({ status: '' }); }
function tokens(data: any): Account {
  if (typeof data.accessToken !== 'string' || !data.accessToken) throw new Error('Sign in again');
  const expiry = (seconds: unknown) => typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : undefined;
  return { accessToken: data.accessToken, refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : undefined,
    expiresAt: expiry(data.expiresIn), refreshExpiresAt: expiry(data.refreshExpiresIn) };
}
export async function signInBambu(account: string, credentials: { password?: string; code?: string }, signal?: AbortSignal) {
  const version = ++generation;
  const data = await cloudJson(accountPrinter, '/v1/user-service/user/login', { method: 'POST', signal,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: account.trim(), ...credentials }) });
  signal?.throwIfAborted();
  if (version !== generation) throw new DOMException('Session superseded', 'AbortError');
  if (data.loginType === 'verifyCode') return 'verification-required';
  const next = tokens(data);
  save(next);
  await validateBambuAccount();
  return 'signed-in';
}
async function renew() {
  if (pending) return pending;
  const old = useBambuAccount.getState().account;
  const version = generation;
  if (!old?.refreshToken || (old.refreshExpiresAt !== undefined && old.refreshExpiresAt <= Date.now())) throw new Error('Sign in again');
  const job = (async () => {
    // Inspect the refusal body here: cloudJson exposes only the HTTP status,
    // which cannot distinguish a gateway error envelope from upstream auth.
    const response = await fetch(bambuCloudApiUrl(accountPrinter, '/v1/user-service/user/refreshtoken'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: old.refreshToken }),
      signal: AbortSignal.timeout(15_000), cache: 'no-store', redirect: 'error'
    });
    const data = await response.json().catch(() => null);
    if (version !== generation || useBambuAccount.getState().account !== old) throw new DOMException('Session superseded', 'AbortError');
    if (!response.ok) {
      if (response.status === 401 && data && typeof data === 'object' && !Array.isArray(data) &&
        typeof data.error !== 'string') throw new InvalidSession('Sign in again');
      throw new Error(`Cloud renewal answered ${response.status}.`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid cloud renewal response.');
    save(tokens(data));
  })();
  pending = job;
  try { await job; } finally { if (pending === job) pending = undefined; }
}
export async function accountRequest(path: string, signal?: AbortSignal) {
  const version = generation;
  let account = useBambuAccount.getState().account;
  if (!account) throw new Error('Sign in again');
  let renewed = false;
  try {
    if (account.expiresAt !== undefined && account.expiresAt <= Date.now()) { await renew(); renewed = true; }
    const read = async () => {
      account = useBambuAccount.getState().account;
      if (!account || version !== generation) throw new DOMException('Session superseded', 'AbortError');
      const data = await cloudJson(accountPrinter, path, { signal, headers: { authorization: `Bearer ${account.accessToken}` } });
      if (version !== generation) throw new DOMException('Session superseded', 'AbortError');
      signal?.throwIfAborted();
      return data;
    };
    try { return await read(); } catch (error) {
      // Model permissions and gateway refusals do not establish account expiry.
      if (path !== '/v1/design-user-service/my/preference' ||
        (error as { status?: number }).status !== 401 || renewed || version !== generation) throw error;
      await renew();
      return await read();
    }
  } catch (error) {
    if (version === generation && error instanceof InvalidSession) {
      signOutBambu(); useBambuAccount.setState({ status: 'Sign in again' });
    }
    throw error;
  }
}
export async function validateBambuAccount() {
  const version = generation;
  const data = await accountRequest('/v1/design-user-service/my/preference');
  if (version !== generation) throw new DOMException('Session superseded', 'AbortError');
  if (!/^\d+$/.test(String(data.uid ?? ''))) throw new Error('Invalid cloud account preference response.');
  useBambuAccount.setState({ status: 'Signed in' });
}
export function watchBambuAccount() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const validate = () => { if (useBambuAccount.getState().account) void validateBambuAccount().catch(() => {}); };
  const schedule = () => {
    clearTimeout(timer);
    const expiry = useBambuAccount.getState().account?.expiresAt;
    // Expired sessions are retried on resume, rather than in a zero-delay loop.
    if (expiry !== undefined && expiry > Date.now()) timer = setTimeout(validate, Math.min(2147483647, expiry - Date.now()));
  };
  const stop = useBambuAccount.subscribe(schedule);
  const resume = () => { if (document.visibilityState === 'visible') validate(); };
  const storage = (event: StorageEvent) => { if (event.key === key) { generation++; pending = undefined; useBambuAccount.setState({ account: restored() }); validate(); } };
  window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume); window.addEventListener('storage', storage);
  schedule(); validate();
  return () => { stop(); clearTimeout(timer); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); window.removeEventListener('storage', storage); };
}
