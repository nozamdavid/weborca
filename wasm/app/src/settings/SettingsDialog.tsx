import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { BedAssetsSettings } from '../plate/BedAssetsSettings';
import { SettingsGroup } from './SettingsGroup';
import { ModalBackdrop, confirmDialog } from '../components/ModalBackdrop';
import { useTranslation } from "../i18n";

export const SettingsDialog: React.FC = () => {
    const { t } = useTranslation();
  const {
    activeDialog,
    closeDialog,
    layout,
    selectedPrinter,
    selectedFilament,
    activePrinterPage,
    setActivePrinterPage,
    activeFilamentPage,
    setActiveFilamentPage,
    openSavePresetDialog
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
    : `${t('Filament Settings')} - ${selectedFilament || t('Default')}`;

  const tabLayout = layout?.tabs.find((t) => t.id === tabId);
  const pages = tabLayout?.pages || [];

  const activePageTitle = isPrinter ? activePrinterPage : activeFilamentPage;
  const setActivePage = isPrinter ? setActivePrinterPage : setActiveFilamentPage;

  const currentPage = pages.find((p) => p.title === activePageTitle) || pages[0];

  return (
    <ModalBackdrop onClose={() => void requestClose()} data-testid={`${activeDialog}-dialog`}>
      <div className="modal-box settings-dialog-modal">
        <div className="modal-header">
          <div className="modal-header-left">
            <span className="dialog-icon">{isPrinter ? '🖨️' : '🧵'}</span>
            <h2 className="modal-title">{title}</h2>
          </div>
          <div className="modal-header-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              data-testid="save-dialog-preset-btn"
              onClick={() => openSavePresetDialog(isPrinter ? 'printer' : 'filament')}
            >
              {t("💾 Save Preset")}</button>
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
        <div className="settings-dialog-content">
          {isPrinter && currentPage === pages[0] && <BedAssetsSettings />}
          {currentPage && currentPage.groups.length > 0 ? (
            currentPage.groups.map((group) => (
              <SettingsGroup key={group.title} group={group} kind={tabId} />
            ))
          ) : (
            <div className="empty-groups-notice">{t("No settings defined for this page.")}</div>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
};
