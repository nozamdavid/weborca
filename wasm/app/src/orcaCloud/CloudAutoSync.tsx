import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { loadUserPresets } from '../presets/presetStorage';
import { checkCloudSession, cloudSync, useCloudAccount } from './account';

let running = false;
export function CloudAutoSync() {
  const id = useCloudAccount(s => s.status?.accountId);
  const enabled = useCloudAccount(s => s.automatic);
  useEffect(() => {
    if (!id || !enabled) return;
    const controller = new AbortController();
    const run = async () => {
      if (running || document.hidden || controller.signal.aborted || useCloudAccount.getState().working) return;
      running = true;
      try {
        const status = await checkCloudSession();
        if (controller.signal.aborted || status?.accountId !== id || !useCloudAccount.getState().automatic) return;
        const sync = cloudSync();
        await sync.pull(controller.signal);
        if (status.presetWrites) await sync.push(controller.signal);
        controller.signal.throwIfAborted();
        useAppStore.setState({ userPresets: await loadUserPresets() });
        useCloudAccount.setState({ autoMessage: 'Cloud auto synced' });
      } catch { if (!controller.signal.aborted) useCloudAccount.setState({ autoMessage: 'Cloud auto failed' }); }
      finally { running = false; }
    };
    const interval = setInterval(() => void run(), 60000);
    const focus = () => { void run(); };
    const visible = () => { if (!document.hidden) void run(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort(); clearInterval(interval);
      window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible);
    };
  }, [id, enabled]);
  return null;
}
