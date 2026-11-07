import { create } from 'zustand';
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
    client = createOrcaCloudClient(location.origin, (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }));
  }
  return client;
}
export function cloudSync() {
  if (!sync) throw new Error('Sign in to Orca Cloud again.');
  return sync;
}
// A confirmed logout disables enrollment before editing resumes. Network failures
// retain the journal, so offline local edits are never discarded.
export function checkCloudSession() {
  return serial(async () => {
    useCloudAccount.setState({ checking: true });
    try {
      const status = await cloudClient().status();
      await transactPresetStorage(state => {
        if (state.cloud.activeAccount !== status.accountId) delete state.cloud.activeAccount;
      });
      if (accountId !== status.accountId || !sync) {
        sync = status.accountId ? createPresetSync({ transaction: transactPresetStorage }, cloudClient().presets(status.accountId), status.accountId) : undefined;
        accountId = status.accountId;
        if (sync) await sync.activate();
      }
      useCloudAccount.setState({ status, error: false, automatic: !!status.accountId && localStorage.getItem(autoKey(status.accountId)) === '60' });
      return status;
    } catch {
      useCloudAccount.setState({ error: true });
      throw new Error('Cloud connection failed. Local work retained.');
    } finally { useCloudAccount.setState({ checking: false }); }
  });
}
export function signOutCloud() {
  return serial(async () => {
    setAutomaticSync(false);
    await transactPresetStorage(state => { delete state.cloud.activeAccount; });
    sync = undefined; accountId = null;
    useCloudAccount.setState({ status: null, automatic: false });
    const status = await cloudClient().logout();
    useCloudAccount.setState({ status });
  });
}
