import React, { useEffect, useRef, useState } from 'react';
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
import { normalizeSlotColor } from './slotColor';
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
  const slotsTrack = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const updateSlotScroll = () => {
    const track = slotsTrack.current;
    setCanScrollLeft(Boolean(track && track.scrollLeft > 1));
    setCanScrollRight(Boolean(track && track.scrollLeft + track.clientWidth < track.scrollWidth - 1));
  };
  const scrollSlots = (left: number) => slotsTrack.current?.scrollBy({ left, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  useEffect(() => {
    const track = slotsTrack.current;
    if (!track) return;
    updateSlotScroll();
    const observer = new ResizeObserver(updateSlotScroll);
    observer.observe(track);
    for (const chip of track.children) observer.observe(chip);
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || track.scrollWidth <= track.clientWidth) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? track.clientWidth : 1);
      if ((delta < 0 && track.scrollLeft > 0) || (delta > 0 && track.scrollLeft + track.clientWidth < track.scrollWidth)) {
        event.preventDefault();
        track.scrollLeft += delta;
      }
    };
    track.addEventListener('wheel', onWheel, { passive: false });
    return () => { observer.disconnect(); track.removeEventListener('wheel', onWheel); };
  }, [activeDialog, selectedFilaments]);
  useEffect(() => {
    slotsTrack.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest'
    });
  }, [activeDialog, activeFilamentSlot, selectedFilaments]);
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
          <div className="settings-dialog-slots">
            <span className="settings-slots-label">{t('Slot')}</span>
            <div className={`settings-slots-viewport ${canScrollLeft ? 'can-scroll-left' : ''} ${canScrollRight ? 'can-scroll-right' : ''}`}>
              <div className="settings-slots-track" ref={slotsTrack} onScroll={updateSlotScroll}>
                {selectedFilaments.map((fName, idx) => {
                  const color = normalizeSlotColor(config['filament_colour']?.split(';')[idx], idx);
                  const label = `${t('Slot {{num}}', { num: idx + 1 })}: ${fName}`;
                  return (
                    <button
                      key={idx}
                      type="button"
                      className="settings-slot-chip"
                      style={{ '--slot-color': color } as React.CSSProperties}
                      data-testid={`dialog-filament-slot-${idx}`}
                      aria-pressed={activeFilamentSlot === idx}
                      title={label}
                      aria-label={label}
                      onClick={() => openDialog('filament', idx)}
                    >
                      <span className="settings-slot-swatch" aria-hidden="true" />
                      <span className="settings-slot-number">{idx + 1}</span>
                      <span className="settings-slot-name">{fName}</span>
                    </button>
                  );
                })}
              </div>
              {canScrollLeft && (
                <button type="button" className="settings-slots-nav settings-slots-nav--left" aria-label={t('Previous')} onClick={() => scrollSlots(-200)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 4-4 4 4 4" /></svg>
                </button>
              )}
              {canScrollRight && (
                <button type="button" className="settings-slots-nav settings-slots-nav--right" aria-label={t('Next')} onClick={() => scrollSlots(200)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
                </button>
              )}
            </div>
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
