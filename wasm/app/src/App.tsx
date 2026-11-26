import { useTranslation } from './i18n';
import { ModelBrowser } from './models/ModelBrowser';
import { ConfirmHost } from './components/ModalBackdrop';
import { ComparePresetsDialog } from './settings/ComparePresetsDialog';
import { WizardDialog } from './wizard';
import { CloudDialog } from './orcaCloud/CloudDialog';
import { CloudStartup } from './orcaCloud/CloudStartup';
import { CloudAutoSync } from './orcaCloud/CloudAutoSync';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import './mobile/mobile.css';
import { useMobile } from './mobile/useMobile';
import { MobilePrepare } from './mobile/MobilePrepare';
import { MobileHeader, MobileNavigation } from './mobile/MobileShell';
import { FlowRateModal } from './calibration/FlowRateModal';
import { OtherCalibrationsDialogs } from './calibration/OtherCalibrationsDialogs';
import { OtherCalibrationsMenu } from './calibration/OtherCalibrationsMenu';
import { ErrorBanner } from './components/ErrorBanner';
import { IsolationNotice } from './components/IsolationNotice';
import { StepImportModal } from './components/StepImportModal';
import { stopAppStartup } from './store/appStore';
import { EngineLoadingIndicator } from './components/EngineLoadingIndicator';
import { PlateView } from './plate/PlateView';
import { PreviewView } from './preview/PreviewView';
import { ManagePresetsDialog } from './presets/ManagePresetsDialog';
import { DevicePanel, PrinterConnectionDialog } from './printers';
import { FixesDialog } from './settings/FixesDialog';
import { SavePresetDialog } from './settings/SavePresetDialog';
import { SettingsDialog } from './settings/SettingsDialog';
import { useAppStore } from './store/appStore';
import { HelpDialogs } from './shell/HelpDialogs';
import { BambuAccountLifecycle } from './printers/BambuAccountDialog';
import { PrepareSidebar } from './shell/PrepareSidebar';
import { TopBar } from './shell/TopBar';
import { SlicingGuard } from './shell/SlicingGuard';
import { RecoveryDialog } from './shell/RecoveryDialog';
import { requestOpenProject } from './shell/projectActions';
import { importDroppedFiles, isDroppedModelFile } from './plate/dropFiles';
import { ProjectNotesDialog } from './shell/ProjectNotesDialog';
import { SlicingWarningsDialog } from './shell/SlicingWarningsDialog';
import { ToastContainer } from './shell/Toast';
import { showToast } from './shell/toastStore';
import { EditOpsDialogs } from './editops';
import { PreferencesDialog, usePrefsStore } from './prefs';
import type { TabId } from './shell/TopBar';

const TAB_IDS: TabId[] = ['models', 'prepare', 'preview', 'device'];

function tabFromPath(): TabId {
  const name = window.location.pathname.replace(/^\/+|\/+$/g, '');
  return TAB_IDS.find((id) => id === name) ?? 'prepare';
}

export const App: React.FC = () => {
  const mountGeneration = useRef(0);
  const mobile = useMobile();
  const { t } = useTranslation();
  const isIsolated = useAppStore((state) => state.isIsolated);
  const initApp = useAppStore((state) => state.initApp);
  const sliceResult = useAppStore((state) => state.sliceResult);
  const sessionRecovery = useAppStore((state) => state.sessionRecovery);
  const isSlicing = useAppStore((state) => state.isSlicing);
  const isModelLoading = useAppStore((state) => state.isModelLoading);
  const sliceStatusText = useAppStore((state) => state.sliceStatusText);
  const slicePercent = useAppStore((state) => state.slicePercent);
  const cancelSlice = useAppStore((state) => state.cancelSlice);
  const showSidebar = usePrefsStore((state) => state.display.showSidebar);
  const themePref = usePrefsStore((state) => state.display.theme);
  const fontScale = usePrefsStore((state) => state.display.fontScale);
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-font-scale', String(fontScale / 100));
  }, [fontScale]);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => { document.documentElement.dataset.theme = themePref === 'system' ? (query.matches ? 'light' : 'dark') : themePref; };
    apply();
    if (themePref !== 'system') return;
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [themePref]);

  const [activeTab, setActiveTabState] = useState<TabId>(tabFromPath);
  // The tab is part of the address (/prepare, /preview, ...), so a reload or a shared link opens the same screen.
  const setActiveTab = useCallback((tab: TabId) => {
    setActiveTabState(tab);
    if (tabFromPath() !== tab) window.history.pushState(null, '', `/${tab}`);
  }, []);
  useEffect(() => {
    const onPop = () => {
      if (/^\/calibration\/?$/.test(window.location.pathname)) {
        window.history.replaceState(null, '', `/prepare${window.location.search}${window.location.hash}`);
      }
      setActiveTabState(tabFromPath());
    };
    onPop();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The 3D view resizes itself on window resize, so nudge it when the sidebar is shown or hidden.
  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [showSidebar]);

  useEffect(() => {
    initApp();
    const current = ++mountGeneration.current;
    return () => {
      // StrictMode replays effects synchronously. Keep its one startup/download,
      // while an actual unmount invalidates the pending initialization.
      queueMicrotask(() => { if (mountGeneration.current === current) stopAppStartup(); });
    };
  }, [initApp]);

  useEffect(() => {
    if (sessionRecovery === 'restored') setActiveTab('prepare');
    else if (sessionRecovery === 'idle' && sliceResult?.gcode && !isSlicing) setActiveTab('preview');
  }, [sliceResult, isSlicing, sessionRecovery, setActiveTab]);

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
      const files = e.dataTransfer?.files;
      const file = files?.[0];
      if (!file) return;
      if (files && activeTab === 'prepare' && (files.length > 1 || isDroppedModelFile(file))) {
        await importDroppedFiles(Array.from(files));
        return;
      }

      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === '3mf') {
        if (await requestOpenProject(file)) setActiveTab('prepare');
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
  }, [activeTab, setActiveTab]);

  if (!isIsolated) return <IsolationNotice />;

  return (
    <div
      className="orca-app"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        width: '100vw',
        overflow: 'hidden'
      }}
    >
      <ErrorBanner />
      <CloudStartup />
      <CloudAutoSync />
      <CloudDialog />
      <SlicingGuard />
      {mobile ? <MobileHeader /> : <TopBar activeTab={activeTab} setActiveTab={setActiveTab} />}
      <EngineLoadingIndicator />
      <StepImportModal />
      <RecoveryDialog />
      <ProjectNotesDialog />
      <SlicingWarningsDialog />

      <main className="workspace orca-workspace" aria-busy={isModelLoading}>
        <div className="tab-page" hidden={activeTab !== 'models'}>
          <ModelBrowser active={activeTab === 'models'} onPrepare={() => setActiveTab('prepare')} />
        </div>
        <div className="tab-page prepare-page" hidden={activeTab !== 'prepare'}>
          {mobile ? <MobilePrepare /> : <>{showSidebar && <PrepareSidebar />}<PlateView /></>}
        </div>
        <div className="tab-page" style={{ position: 'relative' }} hidden={activeTab !== 'preview'}>
          <PreviewView active={activeTab === 'preview'} />
        </div>
        <div className="tab-page" hidden={activeTab !== 'device'}>
          <DevicePanel active={activeTab === 'device'} />
        </div>

        {isSlicing && (
          <div id="preview-slicing-overlay" className="model-loading-overlay">
            <div className="model-loading-card" role="status" aria-live="polite" aria-atomic="true" style={{ flexDirection: 'column', alignItems: 'stretch', minWidth: 320 }}>
              <strong data-testid="slicing-warning" className="slicing-progress-warning">{t("Slicing (don't leave this tab)")}</strong>
              <div className="progress-bar-wrapper"><div className="progress-bar-fill" id="preview-progress-bar" style={{ width: `${slicePercent}%` }} /></div>
              <p id="preview-slicing-status">{sliceStatusText}</p>
              <button className="btn-danger-wide" id="preview-cancel-btn" onClick={() => cancelSlice()}>{t("Cancel")}</button>
            </div>
          </div>
        )}
        {isModelLoading && !isSlicing && (
          <div id="model-loading-overlay" className="model-loading-overlay">
            <div className="model-loading-card" role="status" aria-live="polite" aria-atomic="true">
              <span className="model-loading-spinner" aria-hidden="true" />
              <div>
                <strong>{t("Loading...")}</strong>
                <p>{sliceStatusText}</p>
              </div>
            </div>
          </div>
        )}
      </main>
      {mobile && <MobileNavigation activeTab={activeTab} setActiveTab={setActiveTab} />}

      <SettingsDialog />
      <FixesDialog />
      <SavePresetDialog />
      <ManagePresetsDialog />
      <FlowRateModal />
      <OtherCalibrationsMenu />
      <OtherCalibrationsDialogs />
      <PrinterConnectionDialog />
      <HelpDialogs />
      <BambuAccountLifecycle />
      <ComparePresetsDialog />
      <ConfirmHost />
      <WizardDialog autoOpen={!mobile} />
      <PreferencesDialog />
      <EditOpsDialogs />
      <ToastContainer />
    </div>
  );
};

export default App;
