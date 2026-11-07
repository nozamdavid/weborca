import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { checkCloudSession } from './orcaCloud/account';

export async function start() {
  const root = ReactDOM.createRoot(document.getElementById('root')!);
  const callbackWindow = window as Window & { __orcaCloudCallback?: string };
  if (location.pathname === '/orca-cloud/callback') {
    const callbackUrl = callbackWindow.__orcaCloudCallback || location.href;
    delete callbackWindow.__orcaCloudCallback;
    history.replaceState(null, '', '/orca-cloud/callback');
    const { CloudCallback } = await import('./orcaCloud/CloudCallback');
    root.render(<CloudCallback callbackUrl={callbackUrl} />);
    return () => root.unmount();
  }
  await checkCloudSession().catch(() => {});
  const { default: App } = await import('./App');
  root.render(<React.StrictMode><App /></React.StrictMode>);
  return async () => {
    const { useAppStore } = await import('./store/appStore');
    const { useHistoryStore } = await import('./history');
    const state = useAppStore.getState();
    if (state.isSlicing) state.cancelSlice();
    if (state.isModelLoading || state.isSelectingPreset ||
      state.isSlicing || Object.keys(state.pendingOptions).length || useHistoryStore.getState().isRestoring ||
      state.sessionRecovery === 'restoring') throw new Error('A project operation is still running');
    if (state.isEngineReady) {
      const { writeAutosave, readAutosave } = await import('./shell/autosave');
      // Forced recovery ignores the user's periodic-autosave preference.
      // An unanswered recovery offer already owns the durable project. A second
      // gate closure must not replace it with the fresh engine's empty plate.
      const offeredRecovery = document.getElementById('recovery-dialog') && await readAutosave();
      if (!offeredRecovery) await writeAutosave();
    }
    const { stopAppStartup } = await import('./store/appStore');
    stopAppStartup();
    root.unmount();
    useAppStore.setState({ isEngineReady: false });
  };
}
