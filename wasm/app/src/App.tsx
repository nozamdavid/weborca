import { ComparePresetsDialog } from './settings/ComparePresetsDialog';
import React, { useEffect, useState } from 'react';
import './App.css';
import { FlowRateModal } from './calibration/FlowRateModal';
import { OtherCalibrationsDialogs } from './calibration/OtherCalibrationsDialogs';
import { OtherCalibrationsMenu } from './calibration/OtherCalibrationsMenu';
import { ErrorBanner } from './components/ErrorBanner';
import { IsolationNotice } from './components/IsolationNotice';
import { StepImportModal } from './components/StepImportModal';
import { disposeEngine } from './engine/orcaEngine';
import { PlateView } from './plate/PlateView';
import { PreviewView } from './preview/PreviewView';
import { ManagePresetsDialog } from './presets/ManagePresetsDialog';
import { DevicePanel, PrinterConnectionDialog } from './printers';
import { FixesDialog } from './settings/FixesDialog';
import { SavePresetDialog } from './settings/SavePresetDialog';
import { SettingsDialog } from './settings/SettingsDialog';
import { useAppStore } from './store/appStore';
import { CalibrationPage } from './shell/CalibrationPage';
import { HelpDialogs } from './shell/HelpDialogs';
import { PrepareSidebar } from './shell/PrepareSidebar';
import { TopBar } from './shell/TopBar';
import { RecoveryDialog } from './shell/RecoveryDialog';
import { ToastContainer } from './shell/Toast';
import { showToast } from './shell/toastStore';
import { EditOpsDialogs } from './editops';
import { PreferencesDialog, usePrefsStore } from './prefs';
import type { TabId } from './shell/TopBar';

export const App: React.FC = () => {
  const isIsolated = useAppStore((state) => state.isIsolated);
  const initApp = useAppStore((state) => state.initApp);
  const sliceResult = useAppStore((state) => state.sliceResult);
  const isSlicing = useAppStore((state) => state.isSlicing);
  const isModelLoading = useAppStore((state) => state.isModelLoading);
  const sliceStatusText = useAppStore((state) => state.sliceStatusText);
  const slicePercent = useAppStore((state) => state.slicePercent);
  const cancelSlice = useAppStore((state) => state.cancelSlice);
  const showSidebar = usePrefsStore((state) => state.display.showSidebar);
  const themePref = usePrefsStore((state) => state.display.theme);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => { document.documentElement.dataset.theme = themePref === 'system' ? (query.matches ? 'light' : 'dark') : themePref; };
    apply();
    if (themePref !== 'system') return;
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [themePref]);

  const [activeTab, setActiveTab] = useState<TabId>('prepare');

  // The 3D view resizes itself on window resize, so nudge it when the sidebar is shown or hidden.
  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [showSidebar]);

  useEffect(() => {
    initApp();
    return () => {
      disposeEngine();
    };
  }, [initApp]);

  useEffect(() => {
    if (sliceResult?.gcode && !isSlicing) setActiveTab('preview');
  }, [sliceResult, isSlicing]);

  // Opening Preview with nothing sliced yet starts the slice, like desktop.
  useEffect(() => {
    if (activeTab !== 'preview') return;
    const { sliceResult: sliced, isSlicing: busy, modelFile } = useAppStore.getState();
    if (!sliced && !busy && modelFile) void useAppStore.getState().startSlice();
  }, [activeTab]);

  // Global drag-and-drop for .3mf project files, .gcode and model files
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;

      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === '3mf') {
        await useAppStore.getState().openProjectFile(file);
      } else if (ext === 'gcode') {
        await useAppStore.getState().openGcodeFile(file);
      } else if (['stl', 'obj', 'amf', 'step', 'stp', 'svg'].includes(ext || '')) {
        useAppStore.getState().requestImportFile(file);
      } else {
        showToast(`Unsupported file type: .${ext}`, 'error');
      }
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!isIsolated) return <IsolationNotice />;

  return (
    <div
      className="orca-app"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden'
      }}
    >
      <ErrorBanner />
      <TopBar activeTab={activeTab} setActiveTab={setActiveTab} />
      <StepImportModal />
      <RecoveryDialog />

      <main className="workspace orca-workspace" aria-busy={isModelLoading}>
        <div className="tab-page prepare-page" hidden={activeTab !== 'prepare'}>
          {showSidebar && <PrepareSidebar />}
          <PlateView />
        </div>
        <div className="tab-page" style={{ position: 'relative' }} hidden={activeTab !== 'preview'}>
          <PreviewView />
        </div>
        <div className="tab-page" hidden={activeTab !== 'device'}>
          <DevicePanel active={activeTab === 'device'} />
        </div>
        <div className="tab-page" hidden={activeTab !== 'calibration'}>
          <CalibrationPage />
        </div>

        {isSlicing && activeTab === 'preview' && (
          <div id="preview-slicing-overlay" className="model-loading-overlay">
            <div className="model-loading-card" role="status" aria-live="polite" aria-atomic="true" style={{ flexDirection: 'column', alignItems: 'stretch', minWidth: 320 }}>
              <strong>Slicing</strong>
              <div className="progress-bar-wrapper"><div className="progress-bar-fill" id="preview-progress-bar" style={{ width: `${slicePercent}%` }} /></div>
              <p id="preview-slicing-status">{sliceStatusText}</p>
              <button className="btn-danger-wide" id="preview-cancel-btn" onClick={() => cancelSlice()}>Cancel</button>
            </div>
          </div>
        )}
        {isModelLoading && (
          <div id="model-loading-overlay" className="model-loading-overlay">
            <div className="model-loading-card" role="status" aria-live="polite" aria-atomic="true">
              <span className="model-loading-spinner" aria-hidden="true" />
              <div>
                <strong>Importing model</strong>
                <p>{sliceStatusText}</p>
              </div>
            </div>
          </div>
        )}
      </main>

      <SettingsDialog />
      <FixesDialog />
      <SavePresetDialog />
      <ManagePresetsDialog />
      <FlowRateModal />
      <OtherCalibrationsMenu />
      <OtherCalibrationsDialogs />
      <PrinterConnectionDialog />
      <HelpDialogs />
      <ComparePresetsDialog />
      <PreferencesDialog />
      <EditOpsDialogs />
      <ToastContainer />
    </div>
  );
};

export default App;
