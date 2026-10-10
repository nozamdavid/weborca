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
import type { TabId } from './shell/TopBar';

export const App: React.FC = () => {
  const isIsolated = useAppStore((state) => state.isIsolated);
  const initApp = useAppStore((state) => state.initApp);
  const sliceResult = useAppStore((state) => state.sliceResult);
  const isSlicing = useAppStore((state) => state.isSlicing);
  const isModelLoading = useAppStore((state) => state.isModelLoading);
  const sliceStatusText = useAppStore((state) => state.sliceStatusText);

  const [activeTab, setActiveTab] = useState<TabId>('prepare');

  useEffect(() => {
    initApp();
    return () => {
      disposeEngine();
    };
  }, [initApp]);

  useEffect(() => {
    if (sliceResult?.gcode && !isSlicing) setActiveTab('preview');
  }, [sliceResult, isSlicing]);

  if (!isIsolated) return <IsolationNotice />;

  return (
    <div className="orca-app" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <ErrorBanner />
      <TopBar activeTab={activeTab} setActiveTab={setActiveTab} />
      <StepImportModal />

      <main className="workspace orca-workspace" aria-busy={isModelLoading}>
        <div className="tab-page prepare-page" hidden={activeTab !== 'prepare'}>
          <PrepareSidebar />
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
    </div>
  );
};

export default App;
