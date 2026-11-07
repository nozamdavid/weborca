import React from 'react';
import { usePrefsStore, type PrefsTabId } from './prefsStore';
import { sanitizeSlicingThreads } from './slicingThreads';
import { Dialog } from '../components/Dialog';
import { useTranslation, SUPPORTED_LANGUAGES } from "../i18n";
import { openCloudAccount } from '../orcaCloud/account';
import './PreferencesDialog.css';

const TABS: Array<{ id: PrefsTabId; label: string }> = [
  { id: 'general', label: "General" },
  { id: 'camera', label: "Camera" },
  { id: 'display', label: "Appearance" }
];

export const PreferencesDialog: React.FC = () => {
    const { t } = useTranslation();
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

  if (!dialogOpen) return null;

  return (
    <Dialog onClose={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preferences-dialog-title"
    >
      <div
        className="modal-content ds-dialog preferences-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header ds-dialog__head" style={{ marginBottom: 4 }}>
          <h2 id="preferences-dialog-title" style={{ margin: 0, fontSize: '1rem' }}>
            {t("Preferences")}</h2>
          <button
            type="button"
            className="close-btn"
            aria-label={t("Close Preferences")}
            onClick={close}
          >
            ×</button>
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
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              id={`pref-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`pref-panel-${tab.id}`}
              className={`tab ${activeTab === tab.id ? 'active' : ''}`}
              style={{ padding: '6px 16px', fontSize: '0.8125rem' }}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(tab.label)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="modal-body ds-dialog__body" style={{ gap: 14 }}>
          {/* General Tab */}
          {activeTab === 'general' && (
            <div
              id="pref-panel-general"
              role="tabpanel"
              aria-labelledby="pref-tab-general"
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <button id="preferences-orca-cloud" onClick={() => { close(); openCloudAccount(); }}>{t('Cloud account and sync')}</button>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="pref-language" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {t("Language")}</label>
                <select
                  id="pref-language"
                  aria-label={t("Language")}
                  value={general.language}
                  onChange={(e) => setGeneralPref('language', e.target.value)}
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="pref-slicing-threads">{t("Slicing threads")}</label>
                <select id="pref-slicing-threads" value={general.slicingThreads}
                  aria-describedby="pref-slicing-threads-help"
                  onChange={(e) => setGeneralPref('slicingThreads', sanitizeSlicingThreads(Number(e.target.value)))}>
                  <option value="auto">{t("Auto")}</option>
                  {[1, 2, 4, 8, 16].map((threads) => <option key={threads} value={threads}>{threads}</option>)}
                </select>
                <span id="pref-slicing-threads-help" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {t("Higher counts use more CPU and apply to the next slice.")}
                </span>
              </div>

              <label htmlFor="pref-autosave-interval">{t("Autosave interval (seconds)")}</label>
              <input id="pref-autosave-interval" type="number" min={5} max={3600} step={5}
                disabled={!general.autosave} value={general.autosaveIntervalSeconds}
                onChange={(e) => setGeneralPref('autosaveIntervalSeconds', Math.max(5, Math.min(3600, Number(e.target.value) || 60)))} />

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="pref-units" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {t("Units")}</label>
                <select
                  id="pref-units"
                  aria-label={t("Units")}
                  value={general.units}
                  onChange={(e) => setGeneralPref('units', e.target.value as 'metric' | 'imperial')}
                >
                  <option value="metric">{t("Metric (mm, g)")}</option>
                  <option value="imperial">{t("Imperial (in, oz)")}</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-remember-recent-files"
                    aria-label={t("Remember recent files")}
                    checked={general.rememberRecentFiles}
                    onChange={(e) => setGeneralPref('rememberRecentFiles', e.target.checked)}
                  />
                  <span>{t("Remember recent files")}</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-use-project-name-for-export"
                    aria-label={t("Use the project name for exported files")}
                    checked={general.useProjectNameForExport}
                    onChange={(e) => setGeneralPref('useProjectNameForExport', e.target.checked)}
                  />
                  <span>{t("Use the project name for exported files")}</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-autosave"
                    aria-label={t("Back up the project automatically")}
                    checked={general.autosave}
                    onChange={(e) => setGeneralPref('autosave', e.target.checked)}
                  />
                  <span>{t("Back up the project automatically (restore after a crash or closed tab)")}</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-auto-arrange-on-import"
                    aria-label={t("Auto-arrange on import")}
                    checked={general.autoArrangeOnImport}
                    onChange={(e) => setGeneralPref('autoArrangeOnImport', e.target.checked)}
                  />
                  <span>{t("Auto-arrange on import")}</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-auto-slice-after-change"
                    aria-label={t("Auto-slice after change")}
                    checked={general.autoSliceAfterChange}
                    onChange={(e) => setGeneralPref('autoSliceAfterChange', e.target.checked)}
                  />
                  <span>{t("Auto-slice after change")}</span>
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
                    aria-label={t("Invert mouse wheel zoom")}
                    checked={camera.invertMouseWheelZoom}
                    onChange={(e) => setCameraPref('invertMouseWheelZoom', e.target.checked)}
                  />
                  <span>{t("Invert mouse wheel zoom")}</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-invert-orbit-horizontal"
                    aria-label={t("Invert orbit horizontal")}
                    checked={camera.invertOrbitHorizontal}
                    onChange={(e) => setCameraPref('invertOrbitHorizontal', e.target.checked)}
                  />
                  <span>{t("Invert orbit horizontal")}</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-invert-orbit-vertical"
                    aria-label={t("Invert orbit vertical")}
                    checked={camera.invertOrbitVertical}
                    onChange={(e) => setCameraPref('invertOrbitVertical', e.target.checked)}
                  />
                  <span>{t("Invert orbit vertical")}</span>
                </label>
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <label htmlFor="pref-rotate-sensitivity">{t("Rotate sensitivity")}</label>
                  <span>{camera.rotateSensitivity.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  id="pref-rotate-sensitivity"
                  aria-label={t("Rotate sensitivity")}
                  min="0.2"
                  max="3.0"
                  step="0.1"
                  value={camera.rotateSensitivity}
                  onChange={(e) => setCameraPref('rotateSensitivity', parseFloat(e.target.value))}
                />
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <label htmlFor="pref-zoom-speed">{t("Zoom speed")}</label>
                  <span>{camera.zoomSpeed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  id="pref-zoom-speed"
                  aria-label={t("Zoom speed")}
                  min="0.2"
                  max="3.0"
                  step="0.1"
                  value={camera.zoomSpeed}
                  onChange={(e) => setCameraPref('zoomSpeed', parseFloat(e.target.value))}
                />
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="pref-default-camera-type" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {t("Default camera type")}</label>
                <select
                  id="pref-default-camera-type"
                  aria-label={t("Default camera type")}
                  value={camera.defaultCameraType}
                  onChange={(e) => setCameraPref('defaultCameraType', e.target.value as 'perspective' | 'orthographic')}
                >
                  <option value="perspective">{t("Perspective")}</option>
                  <option value="orthographic">{t("Orthographic")}</option>
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
              <label htmlFor="pref-font-scale">{t("Interface font size")}</label>
              <select id="pref-font-scale" value={display.fontScale}
                onChange={(e) => setDisplayPref('fontScale', Number(e.target.value) as 100 | 115 | 130 | 150)}>
                <option value="100">{t("100% (default)")}</option>
                <option value="115">115%</option>
                <option value="130">130%</option>
                <option value="150">150%</option>
              </select>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-show-grid"
                    aria-label={t("Bed grid")}
                    checked={display.showGrid}
                    onChange={(e) => setDisplayPref('showGrid', e.target.checked)}
                  />
                  <span>{t("Bed grid")}</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-show-axes"
                    aria-label={t("Axes")}
                    checked={display.showAxes}
                    onChange={(e) => setDisplayPref('showAxes', e.target.checked)}
                  />
                  <span>{t("Axes")}</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-show-labels"
                    aria-label={t("Object labels")}
                    checked={display.showLabels}
                    onChange={(e) => setDisplayPref('showLabels', e.target.checked)}
                  />
                  <span>{t("Object labels (names over objects)")}</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-show-build-volume"
                    aria-label={t("Build volume wireframe")}
                    checked={display.showBuildVolume}
                    onChange={(e) => setDisplayPref('showBuildVolume', e.target.checked)}
                  />
                  <span>{t("Build volume wireframe")}</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    id="pref-show-wireframe"
                    aria-label={t("Wireframe objects")}
                    checked={display.showWireframe}
                    onChange={(e) => setDisplayPref('showWireframe', e.target.checked)}
                  />
                  <span>{t("Wireframe objects")}</span>
                </label>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                title={t("Reduce preview detail and resolution for faster navigation")}>
                <input type="checkbox" id="pref-preview-low-quality"
                  checked={display.previewLowQuality}
                  onChange={(e) => setDisplayPref('previewLowQuality', e.target.checked)} />
                <span>{t("Low quality G-code preview")}</span>
              </label>

              <label htmlFor="pref-toolbar-orientation">{t("Tool bar orientation")}</label>
              <select id="pref-toolbar-orientation" value={display.toolbarOrientation}
                onChange={(e) => setDisplayPref('toolbarOrientation', e.target.value as 'vertical' | 'horizontal')}>
                <option value="vertical">{t("Vertical")}</option>
                <option value="horizontal">{t("Horizontal")}</option>
              </select>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <label htmlFor="pref-theme" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {t("Theme")}</label>
                <select
                  id="pref-theme"
                  aria-label={t("Theme")}
                  value={display.theme}
                  onChange={(e) => setDisplayPref('theme', e.target.value as 'dark' | 'light' | 'system')}
                >
                  <option value="dark">{t("Dark")}</option>
                  <option value="light">{t("Light")}</option>
                  <option value="system">{t("Follow the system")}</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer ds-dialog__foot" style={{ borderTop: '1px solid var(--border-color)', paddingTop: 10, marginTop: 6 }}>
          <button
            type="button"
            id="pref-reset-btn"
            className="ds-btn"
            onClick={resetDefaults}
            style={{ marginRight: 'auto' }}
          >
            {t("Reset to Defaults")}</button>
          <button
            type="button"
            id="pref-close-btn"
            className="ds-btn ds-btn--primary"
            onClick={close}
          >
            {t("Close")}</button>
        </div>
      </div>
    </Dialog>
  );
};
