import React, { useEffect } from 'react';
import { usePrefsStore, type PrefsTabId } from './prefsStore';

const TABS: Array<{ id: PrefsTabId; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'camera', label: 'Camera' },
  { id: 'display', label: 'Display' }
];

export const PreferencesDialog: React.FC = () => {
  const dialogOpen = usePrefsStore((s) => s.dialogOpen);
  const activeTab = usePrefsStore((s) => s.activeDialogTab);
  const setActiveTab = usePrefsStore((s) => s.setActiveDialogTab);
  const close = usePrefsStore((s) => s.closeDialog);

  const general = usePrefsStore((s) => s.general);
  const camera = usePrefsStore((s) => s.camera);
  const display = usePrefsStore((s) => s.display);

  const setGeneralPref = usePrefsStore((s) => s.setGeneralPref);
  const setCameraPref = usePrefsStore((s) => s.setCameraPref);
  const setDisplayPref = usePrefsStore((s) => s.setDisplayPref);
  const resetDefaults = usePrefsStore((s) => s.resetDefaults);

  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen, close]);

  if (!dialogOpen) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preferences-dialog-title"
      onClick={close}
    >
      <div
        className="modal-content"
        style={{
          width: 'min(580px, 94vw)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header" style={{ marginBottom: 4 }}>
          <h2 id="preferences-dialog-title" style={{ margin: 0, fontSize: 16 }}>
            Preferences
          </h2>
          <button
            type="button"
            className="close-btn"
            aria-label="Close Preferences"
            onClick={close}
          >
            &times;
          </button>
        </div>

        {/* Tab navigation */}
        <div
          role="tablist"
          style={{
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: 4
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`pref-tab-${t.id}`}
              aria-selected={activeTab === t.id}
              aria-controls={`pref-panel-${t.id}`}
              className={`tab ${activeTab === t.id ? 'active' : ''}`}
              style={{ padding: '6px 16px', fontSize: 13 }}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="modal-body" style={{ minHeight: 240, gap: 14 }}>
          {/* General Tab */}
          {activeTab === 'general' && (
            <div
              id="pref-panel-general"
              role="tabpanel"
              aria-labelledby="pref-tab-general"
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="pref-language" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Language
                </label>
                <select
                  id="pref-language"
                  aria-label="Language"
                  value={general.language}
                  onChange={(e) => setGeneralPref('language', e.target.value)}
                >
                  <option value="en">English</option>
                </select>
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="pref-units" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Units
                </label>
                <select
                  id="pref-units"
                  aria-label="Units"
                  value={general.units}
                  onChange={(e) => setGeneralPref('units', e.target.value as 'metric' | 'imperial')}
                >
                  <option value="metric">Metric (mm, g)</option>
                  <option value="imperial">Imperial (in, oz)</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-remember-recent-files"
                    aria-label="Remember recent files"
                    checked={general.rememberRecentFiles}
                    onChange={(e) => setGeneralPref('rememberRecentFiles', e.target.checked)}
                  />
                  <span>Remember recent files</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-auto-arrange-on-import"
                    aria-label="Auto-arrange on import"
                    checked={general.autoArrangeOnImport}
                    onChange={(e) => setGeneralPref('autoArrangeOnImport', e.target.checked)}
                  />
                  <span>Auto-arrange on import</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-auto-slice-after-change"
                    aria-label="Auto-slice after change"
                    checked={general.autoSliceAfterChange}
                    onChange={(e) => setGeneralPref('autoSliceAfterChange', e.target.checked)}
                  />
                  <span>Auto-slice after change</span>
                </label>
              </div>
            </div>
          )}

          {/* Camera Tab */}
          {activeTab === 'camera' && (
            <div
              id="pref-panel-camera"
              role="tabpanel"
              aria-labelledby="pref-tab-camera"
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-invert-mouse-wheel-zoom"
                    aria-label="Invert mouse wheel zoom"
                    checked={camera.invertMouseWheelZoom}
                    onChange={(e) => setCameraPref('invertMouseWheelZoom', e.target.checked)}
                  />
                  <span>Invert mouse wheel zoom</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-invert-orbit-horizontal"
                    aria-label="Invert orbit horizontal"
                    checked={camera.invertOrbitHorizontal}
                    onChange={(e) => setCameraPref('invertOrbitHorizontal', e.target.checked)}
                  />
                  <span>Invert orbit horizontal</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-invert-orbit-vertical"
                    aria-label="Invert orbit vertical"
                    checked={camera.invertOrbitVertical}
                    onChange={(e) => setCameraPref('invertOrbitVertical', e.target.checked)}
                  />
                  <span>Invert orbit vertical</span>
                </label>
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                  <label htmlFor="pref-rotate-sensitivity">Rotate sensitivity</label>
                  <span>{camera.rotateSensitivity.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  id="pref-rotate-sensitivity"
                  aria-label="Rotate sensitivity"
                  min="0.2"
                  max="3.0"
                  step="0.1"
                  value={camera.rotateSensitivity}
                  onChange={(e) => setCameraPref('rotateSensitivity', parseFloat(e.target.value))}
                />
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                  <label htmlFor="pref-zoom-speed">Zoom speed</label>
                  <span>{camera.zoomSpeed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  id="pref-zoom-speed"
                  aria-label="Zoom speed"
                  min="0.2"
                  max="3.0"
                  step="0.1"
                  value={camera.zoomSpeed}
                  onChange={(e) => setCameraPref('zoomSpeed', parseFloat(e.target.value))}
                />
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="pref-default-camera-type" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Default camera type
                </label>
                <select
                  id="pref-default-camera-type"
                  aria-label="Default camera type"
                  value={camera.defaultCameraType}
                  onChange={(e) => setCameraPref('defaultCameraType', e.target.value as 'perspective' | 'orthographic')}
                >
                  <option value="perspective">Perspective</option>
                  <option value="orthographic">Orthographic</option>
                </select>
              </div>
            </div>
          )}

          {/* Display Tab */}
          {activeTab === 'display' && (
            <div
              id="pref-panel-display"
              role="tabpanel"
              aria-labelledby="pref-tab-display"
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-show-grid"
                    aria-label="Bed grid"
                    checked={display.showGrid}
                    onChange={(e) => setDisplayPref('showGrid', e.target.checked)}
                  />
                  <span>Bed grid</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-show-axes"
                    aria-label="Axes"
                    checked={display.showAxes}
                    onChange={(e) => setDisplayPref('showAxes', e.target.checked)}
                  />
                  <span>Axes</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-show-labels"
                    aria-label="Object labels"
                    checked={display.showLabels}
                    onChange={(e) => setDisplayPref('showLabels', e.target.checked)}
                  />
                  <span>Object labels (names over objects)</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-show-build-volume"
                    aria-label="Build volume wireframe"
                    checked={display.showBuildVolume}
                    onChange={(e) => setDisplayPref('showBuildVolume', e.target.checked)}
                  />
                  <span>Build volume wireframe</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-show-wireframe"
                    aria-label="Wireframe objects"
                    checked={display.showWireframe}
                    onChange={(e) => setDisplayPref('showWireframe', e.target.checked)}
                  />
                  <span>Wireframe objects</span>
                </label>
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <label htmlFor="pref-theme" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Theme
                </label>
                <select
                  id="pref-theme"
                  aria-label="Theme"
                  value={display.theme}
                  onChange={(e) => setDisplayPref('theme', e.target.value as 'dark' | 'light')}
                >
                  <option value="dark">Dark</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer" style={{ borderTop: '1px solid var(--border-color)', paddingTop: 10, marginTop: 6 }}>
          <button
            type="button"
            id="pref-reset-btn"
            className="btn btn-secondary"
            onClick={resetDefaults}
            style={{ marginRight: 'auto' }}
          >
            Reset to Defaults
          </button>
          <button
            type="button"
            id="pref-close-btn"
            className="btn btn-primary"
            onClick={close}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
