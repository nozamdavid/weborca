import React from 'react';
import { useAppStore } from '../store/appStore';
import { SettingsGroup } from './SettingsGroup';
import { ModalBackdrop } from '../components/ModalBackdrop';

export const SettingsDialog: React.FC = () => {
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

  if (!activeDialog) return null;

  const isPrinter = activeDialog === 'printer';
  const tabId = isPrinter ? 'printer' : 'filament';
  const title = isPrinter
    ? `Printer Settings - ${selectedPrinter || 'Default'}`
    : `Filament Settings - ${selectedFilament || 'Default'}`;

  const tabLayout = layout?.tabs.find((t) => t.id === tabId);
  const pages = tabLayout?.pages || [];

  const activePageTitle = isPrinter ? activePrinterPage : activeFilamentPage;
  const setActivePage = isPrinter ? setActivePrinterPage : setActiveFilamentPage;

  const currentPage = pages.find((p) => p.title === activePageTitle) || pages[0];

  return (
    <ModalBackdrop onClose={closeDialog} data-testid={`${activeDialog}-dialog`}>
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
              💾 Save Preset
            </button>
            <button
              type="button"
              className="modal-close-btn"
              data-testid="close-dialog-btn"
              onClick={closeDialog}
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
              {page.title}
            </button>
          ))}
        </div>

        {/* Content area */}
        <div className="settings-dialog-content">
          {currentPage && currentPage.groups.length > 0 ? (
            currentPage.groups.map((group) => (
              <SettingsGroup key={group.title} group={group} kind={tabId} />
            ))
          ) : (
            <div className="empty-groups-notice">No settings defined for this page.</div>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
};
