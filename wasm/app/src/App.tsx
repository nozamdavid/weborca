import React, { useEffect, useState } from 'react';
import { useAppStore } from './store/appStore';
import { IsolationNotice } from './components/IsolationNotice';
import { ErrorBanner } from './components/ErrorBanner';
import { TopBar } from './components/TopBar';
import { StepImportModal } from './components/StepImportModal';
import { ObjectListPanel } from './objectlist/ObjectListPanel';
import { PlateView } from './plate/PlateView';
import { PreviewView } from './preview/PreviewView';
import { SettingsPanel } from './settings/SettingsPanel';
import { SettingsDialog } from './settings/SettingsDialog';
import { FixesDialog } from './settings/FixesDialog';
import { SavePresetDialog } from './settings/SavePresetDialog';
import { disposeEngine } from './engine/orcaEngine';
import './App.css';

export const App: React.FC = () => {
  const isIsolated = useAppStore((state) => state.isIsolated);
  const initApp = useAppStore((state) => state.initApp);
  const sliceResult = useAppStore((state) => state.sliceResult);
  const isSlicing = useAppStore((state) => state.isSlicing);

  const [activeTab, setActiveTab] = useState<'prepare' | 'preview'>('prepare');

  useEffect(() => {
    initApp();
    return () => {
      disposeEngine();
    };
  }, [initApp]);

  // Auto-switch to Preview after slicing completes
  useEffect(() => {
    if (sliceResult?.gcode && !isSlicing) {
      setActiveTab('preview');
    }
  }, [sliceResult, isSlicing]);

  if (!isIsolated) {
    return <IsolationNotice />;
  }

  return (
    <div className="orca-app">
      <ErrorBanner />
      <TopBar />
      <StepImportModal />

      {/* Prepare / Preview Mode Switcher */}
      <div
        id="mode-switcher-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 16px',
          background: '#18181b',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          zIndex: 10
        }}
      >
        <button
          type="button"
          id="tab-prepare"
          data-testid="tab-prepare"
          onClick={() => setActiveTab('prepare')}
          style={{
            background: activeTab === 'prepare' ? '#009688' : 'rgba(255, 255, 255, 0.08)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '4px 14px',
            fontSize: '0.85rem',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'background 0.15s ease'
          }}
        >
          Prepare
        </button>
        <button
          type="button"
          id="tab-preview"
          data-testid="tab-preview"
          onClick={() => setActiveTab('preview')}
          style={{
            background: activeTab === 'preview' ? '#009688' : 'rgba(255, 255, 255, 0.08)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '4px 14px',
            fontSize: '0.85rem',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'background 0.15s ease'
          }}
        >
          Preview
        </button>
      </div>

      <main className="orca-workspace" style={{ position: 'relative', flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ display: activeTab === 'prepare' ? 'flex' : 'none', flex: 1, height: '100%', width: '100%' }}>
          <ObjectListPanel />
          <PlateView />
          <SettingsPanel />
        </div>
        <div style={{ display: activeTab === 'preview' ? 'block' : 'none', flex: 1, height: '100%', width: '100%', position: 'relative' }}>
          <PreviewView />
        </div>
      </main>

      <SettingsDialog />
      <FixesDialog />
      <SavePresetDialog />
    </div>
  );
};

export default App;
