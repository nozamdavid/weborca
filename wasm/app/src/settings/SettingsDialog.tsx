import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { BedAssetsSettings } from '../plate/BedAssetsSettings';
import { SettingsGroup } from './SettingsGroup';
import { isLineVisible } from './visibility';
import { confirmDialog } from '../components/ModalBackdrop';
import { Dialog } from "../components/Dialog";
import { SettingsSearchBar } from './SettingsSearchBar';
import type { SettingsMode } from './types';
import { Icon } from '../shell/Icon';
import { useTranslation } from "../i18n";
import './settings-ui.css';

export const SettingsDialog: React.FC = () => {
    const { t } = useTranslation();
  const {
    activeDialog,
    settingsMode,
    configDefs,
    rulesState,
    closeDialog,
    openDialog,
    layout,
    selectedPrinter,
    selectedFilament,
    selectedFilaments,
    activeFilamentSlot,
    activePrinterPage,
    setActivePrinterPage,
    activeFilamentPage,
    setActiveFilamentPage,
    openSavePresetDialog,
    jumpToOption,
    setSettingsMode
  } = useAppStore();

  const config = useAppStore((s) => s.currentConfig);
  const initial = useRef<Record<string, string>>({});
  useEffect(() => { if (activeDialog) initial.current = { ...useAppStore.getState().currentConfig }; }, [activeDialog]);
  const requestClose = async () => {
    const tab = layout?.tabs.find((t) => t.id === activeDialog);
    const keys = tab?.pages.flatMap((p) => p.groups.flatMap((g) => g.lines.flatMap((l) => l.key ? [l.key] : l.options ?? []))) ?? [];
    if (activeDialog === 'printer') keys.push('bed_custom_model', 'bed_custom_texture');
    const dirty = keys.some((key) => config[key] !== initial.current[key]);
    if (!dirty || await confirmDialog({
      title: t("Close without saving a preset?"),
      message: t('Your changes will stay in this project. Use Save Preset to reuse them in other projects.'),
      confirmLabel: t('Keep in project'), cancelLabel: t('Keep editing')
    })) closeDialog();
  };

  if (!activeDialog) return null;

  const isPrinter = activeDialog === 'printer';
  const tabId = isPrinter ? 'printer' : 'filament';
  const title = isPrinter
    ? `${t('Printer Settings')} - ${selectedPrinter || t('Default')}`
    : `${t('Filament Settings')} - ${selectedFilaments[activeFilamentSlot || 0] || selectedFilament || t('Default')}`;

  const tabLayout = layout?.tabs.find((t) => t.id === tabId);
  const pages = tabLayout?.pages || [];

  const activePageTitle = isPrinter ? activePrinterPage : activeFilamentPage;
  const setActivePage = isPrinter ? setActivePrinterPage : setActiveFilamentPage;

  const currentPage = pages.find((p) => p.title === activePageTitle) || pages[0];

  return (
    <Dialog onClose={() => void requestClose()} data-testid={`${activeDialog}-dialog`}>
      <div className="modal-box ds-dialog ds-dialog--lg settings-dialog-modal">
        <div className="modal-header ds-dialog__head">
          <div className="modal-header-left">
            <span className="dialog-icon">{isPrinter ? '🖨️' : '🧵'}</span>
            <h2 className="modal-title">{title}</h2>
          </div>
          <div className="settings-dialog-search-wrap">
            <SettingsSearchBar
              pages={pages}
              onSelect={(key) => jumpToOption(key)}
              testIdPrefix="dialog-"
              autoFocus
              listenCtrlF
            />
          </div>
          <div className="modal-header-actions">
            <div className="mode-switcher">
              <select
                value={settingsMode}
                data-testid="dialog-mode-select"
                className="mode-select"
                onChange={(e) => setSettingsMode(e.target.value as SettingsMode)}
              >
                <option value="simple">{t("Simple")}</option>
                <option value="advanced">{t("Advanced")}</option>
                <option value="expert">{t("Expert")}</option>
              </select>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              data-testid="save-dialog-preset-btn"
              onClick={() => openSavePresetDialog(isPrinter ? 'printer' : 'filament')}
            >
              <Icon name="save" size={14} /> {t("Save Preset")}</button>
            <button
              type="button"
              className="modal-close-btn"
              data-testid="close-dialog-btn"
              onClick={() => void requestClose()}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Filament Slot navigation (multi-material setups) */}
        {!isPrinter && selectedFilaments.length > 1 && (
          <div
            className="settings-dialog-slots"
            style={{
              display: 'flex',
              gap: '8px',
              padding: '8px 16px',
              backgroundColor: 'var(--surface-2)',
              borderBottom: '1px solid var(--border-default)',
              alignItems: 'center',
              overflowX: 'auto'
            }}
          >
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {t('Slot')}:
            </span>
            {selectedFilaments.map((fName, idx) => (
              <button
                key={idx}
                type="button"
                className={`btn btn-sm ${activeFilamentSlot === idx ? 'btn-primary' : 'btn-secondary'}`}
                data-testid={`dialog-filament-slot-${idx}`}
                onClick={() => openDialog('filament', idx)}
              >
                {t('Slot {{num}}', { num: idx + 1 })}: {fName}
              </button>
            ))}
          </div>
        )}

        {/* Tab navigation */}
        <div className="settings-dialog-tabs">
          {pages.map((page) => (
            <button
              key={page.title}
              type="button"
              className={`dialog-tab-btn ${currentPage?.title === page.title ? 'active' : ''}`}
              data-testid={`dialog-tab-${page.title}`}
              onClick={() => setActivePage(page.title)}
            >
              {t(page.title)}
            </button>
          ))}
        </div>

        {/* Content area */}
        <div className="settings-dialog-content ds-dialog__body">
          {isPrinter && currentPage === pages[0] && <BedAssetsSettings />}
          {currentPage && currentPage.groups.length > 0 ? (
            currentPage.groups.some(group => group.lines.some(line => isLineVisible(line, settingsMode, configDefs, rulesState.fields)))
              ? currentPage.groups.map((group) => <SettingsGroup key={group.title} group={group} kind={tabId} />)
              : <div className="empty-groups-notice">{t("No settings available in this mode.")}</div>
          ) : (
            <div className="empty-groups-notice">{t("No settings defined for this page.")}</div>
          )}
        </div>
      </div>
    </Dialog>
  );
};
