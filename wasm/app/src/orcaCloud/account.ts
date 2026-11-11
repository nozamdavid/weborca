import { create } from 'zustand';
import { verifyCloudEnrollment } from './journal';
import { createOrcaCloudClient, createPresetSync, transactPresetStorage, type CloudStatus } from './index';

type Client = ReturnType<typeof createOrcaCloudClient>;
type Sync = ReturnType<typeof createPresetSync>;
interface AccountState {
  open: boolean;
  checking: boolean;
  status: CloudStatus | null;
  error: boolean;
  working: boolean;
  automatic: boolean;
  autoMessage: string;
}
export const useCloudAccount = create<AccountState>(() => ({ open: false, checking: false, status: null, error: false, working: false, automatic: false, autoMessage: '' }));
function autoKey(id: string) { return `orca-cloud-auto:${location.origin}:${id}`; }
export function setAutomaticSync(enabled: boolean) {
  const id = useCloudAccount.getState().status?.accountId;
  if (!id) return;
  localStorage.setItem(autoKey(id), enabled ? '60' : '0');
  useCloudAccount.setState({ automatic: enabled, autoMessage: '' });
}
export function openCloudAccount() { useCloudAccount.setState({ open: true }); }
let client: Client | undefined;
let sync: Sync | undefined;
let accountId: string | null = null;
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.catch(() => {});
  return result;
}
export function cloudClient() {
  if (!client) {
    // Deployment owns the connection. Ignore legacy user-entered addresses while
    // retaining the existing per-origin browser credential and sync preferences.
    client = createOrcaCloudClient(location.origin, (input, init) => {
      const signal = init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000);
      return fetch(input, { ...init, signal });
    });
  }
  return client;
}
export function cloudSync() {
  if (!sync) throw new Error('Sign in to Orca Cloud again.');
  return sync;
}
function abortError() {
  return typeof DOMException === 'function'
    ? new DOMException('Cloud session check canceled', 'AbortError')
    : Object.assign(new Error('Cloud session check canceled'), { name: 'AbortError' });
}
/** Reject as soon as `signal` aborts even if the underlying request ignores it. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void work.catch(() => {}); return Promise.reject(abortError()); }
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(abortError());
    signal.addEventListener('abort', cancel, { once: true });
    work.then(
      value => { signal.removeEventListener('abort', cancel); resolve(value); },
      error => { signal.removeEventListener('abort', cancel); reject(error); }
    );
  });
}
export interface CheckCloudSessionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  passive?: boolean;
}
let checkGeneration = 0;
let activeCheck: AbortController | undefined;
let activeResult: Promise<CloudStatus> | undefined;
// Persisted enrollment is unverified until a successful status check. Existing
// linked presets keep their offline journal even when verification fails.
export function checkCloudSession(options: CheckCloudSessionOptions = {}): Promise<CloudStatus> {
  if (options.passive && activeResult) {
    const deadline = AbortSignal.timeout(Math.max(0, options.timeoutMs ?? 15000));
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    return untilAborted(activeResult, signal).catch(error => {
      if (deadline.aborted && !options.signal?.aborted) throw new Error('Cloud connection timed out. Local work retained.');
      throw error;
    });
  }
  const generation = ++checkGeneration;
    activeCheck?.abort();
    const caller = options.signal;
    const controller = new AbortController();
    activeCheck = controller;
    let timedOut = false;
    const cancel = () => controller.abort();
    caller?.addEventListener('abort', cancel, { once: true });
    if (caller?.aborted) controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(0, options.timeoutMs ?? 15000));
    const signal = controller.signal;
    const current = () => generation === checkGeneration && !signal.aborted;
    useCloudAccount.setState({ checking: true });
  const result = (async () => {
    try {
      const status = await untilAborted(cloudClient().status(signal), signal);
      if (!current()) throw abortError();
      if (!status.accountId || status.accountId !== accountId) verifyCloudEnrollment(false);
      await untilAborted(transactPresetStorage(state => {
        if (state.cloud.activeAccount !== status.accountId) delete state.cloud.activeAccount;
      }, signal), signal);
      if (!current()) throw abortError();
      if (accountId !== status.accountId || !sync) {
        const next = status.accountId ? createPresetSync({ transaction: transactPresetStorage }, cloudClient().presets(status.accountId), status.accountId) : undefined;
        if (next) await untilAborted(transactPresetStorage(state => {
          state.cloud.accounts[status.accountId!] ??= { records: {} };
          state.cloud.activeAccount = status.accountId!;
        }, signal), signal);
        if (!current()) throw abortError();
        sync = next;
        accountId = status.accountId;
      }
      verifyCloudEnrollment(!!status.accountId);
      useCloudAccount.setState({ status, error: false, automatic: !!status.accountId && localStorage.getItem(autoKey(status.accountId)) === '60' });
      return status;
    } catch {
      if (generation !== checkGeneration || caller?.aborted) throw abortError();
      useCloudAccount.setState({ error: true });
      throw timedOut ? new Error('Cloud connection timed out. Local work retained.')
        : new Error('Cloud connection failed. Local work retained.');
    } finally {
      caller?.removeEventListener('abort', cancel);
      if (timer !== undefined) clearTimeout(timer);
      if (activeCheck === controller) activeCheck = undefined;
      if (generation === checkGeneration) activeResult = undefined;
      if (generation === checkGeneration) useCloudAccount.setState({ checking: false });
    }
  })();
  activeResult = result;
  return result;
}
export function signOutCloud() {
  ++checkGeneration;
  activeCheck?.abort();
  activeResult = undefined;
  verifyCloudEnrollment(false);
  useCloudAccount.setState({ checking: false });
  return serial(async () => {
    setAutomaticSync(false);
    await transactPresetStorage(state => { delete state.cloud.activeAccount; });
    sync = undefined; accountId = null;
    useCloudAccount.setState({ status: null, automatic: false });
    const status = await cloudClient().logout();
    useCloudAccount.setState({ status });
  });
}
