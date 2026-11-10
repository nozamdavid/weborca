import { usePlatesStore } from '../plates/platesStore';
import { useWizardStore } from '../wizard';
import { usePrefsStore } from '../prefs';
import { FilamentSyncButton } from '../printers/FilamentSyncDialog';
import React, { useEffect, useRef, useState } from 'react';
import { ModifiedSettingsDialog } from '../settings/ModifiedSettingsDialog';
import { modifiedSettings } from '../settings/modifiedSettings';
import { FlushVolumesDialog } from '../flush/FlushVolumesDialog';
import { useHistoryStore } from '../history';
import { ObjectListPanel } from '../objectlist/ObjectListPanel';
import { usePrinterConnectionStore } from '../printers/connectionStore';
import { SavedPrinterSelector, bindDeviceProfile } from '../printers/SavedPrinterSelector';
import { SettingsPanel } from '../settings/SettingsPanel';
import { useAppStore, resolveDeviceVendor, pendingOptionKey } from '../store/appStore';
import type { PresetKind } from '../presets/types';
import { exportGcode } from './exportGcode';
import { EditIcon, GearIcon, PlugIcon, SaveIcon, TrashIcon } from './glyphs';
import { useTranslation } from "../i18n";
import { Toolbar } from '../components/Toolbar';
import { useSliceReadiness } from './sliceReadiness';
import { QuickSettings } from './QuickSettings';
import { PlateScope } from './PlateScope';
import { ReadinessAction } from './ReadinessAction';
import { MobileSelect } from '../mobile/MobileSelect';

const bedTypeIcons: Record<string, string> = {
  'Cool Plate': 'bed_cool',
  'Engineering Plate': 'bed_engineering',
  'High Temp Plate': 'bed_high_templ',
  'Textured PEI Plate': 'bed_pei',
  'Textured Cool Plate': 'bed_pei_cool',
  'Supertack Plate': 'bed_cool_supertack'
};

const Section: React.FC<{ id: string; title: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean; className?: string; headerExtra?: React.ReactNode }> = ({ id, title, badge, children, defaultOpen = true, className = '', headerExtra }) => {
  const sections = usePrefsStore(s => s.display.sidebarSections);
  const open = sections[id] ?? defaultOpen;
  return (
    <section className={`ds-section sb-section ${open ? '' : 'closed'} ${className}`}>
      <div className="sb-head">
        <h2 className="sb-section-title"><button type="button" className="ds-section__head" title={title} aria-expanded={open} onClick={() => usePrefsStore.getState().setDisplayPref('sidebarSections', { ...sections, [id]: !open })}>
          <span className="ds-chev chev" aria-hidden="true">▼</span>
          <span className="grow">{title}</span>
          {badge && <span className="ds-badge">{badge}</span>}
        </button></h2>
        {headerExtra && <div className="sb-head-extra">{headerExtra}</div>}
      </div>
      {open && <div className="sb-body ds-section__body">{children}</div>}
    </section>
  );
};

/** One preset combo with its icon buttons, like desktop's printer / filament / process rows. */
const PresetRow: React.FC<{
  kind: PresetKind;
  disabled: boolean;
  selectDisabled: boolean;
  placeholder: string;
  system: Array<{ name: string }>;
  user: Array<{ name: string }>;
  value: string;
  onSystem: (name: string) => void;
  onUser: (name: string) => void;
  extra?: React.ReactNode;
  /** Replaces the built-in preset combo. */
  selectNode?: React.ReactNode;
  canEdit: boolean;
  canSave: boolean;
}> = ({ kind, disabled, selectDisabled, placeholder, system, user, value, onSystem, onUser, extra, selectNode, canEdit, canSave }) => {
    const { t } = useTranslation();
  const { openDialog, openSavePresetDialog, openManagePresetsDialog, deleteUserPresetAction, activeUserPreset } = useAppStore();
  const activeUser = activeUserPreset[kind];
  return (
    <div className="preset-row">
      {selectNode ?? (<select
        id={`${kind}-select`}
        data-testid={`${kind}-select`}
        aria-label={t(`${kind} preset`)}
        value={value}
        disabled={selectDisabled}
        onChange={(e) => (e.target.value.startsWith('user:') ? onUser(e.target.value.substring(5)) : onSystem(e.target.value))}
      >
        <option value="">{placeholder}</option>
        {system.length > 0 && <optgroup label={t("System presets")}>{system.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>}
        {user.length > 0 && <optgroup label={t("User presets")}>{user.map((u) => <option key={u.name} value={`user:${u.name}`}>{u.name}</option>)}</optgroup>}
      </select>)}
      {extra}
      <details className="workflow-preset-actions"><summary aria-label={t('Manage presets, import and export')} title={t('Manage presets, import and export')}><GearIcon /></summary>
      <Toolbar label={t('Manage presets, import and export')}>
      {kind !== 'process' && (
        <button className="ds-icon-btn icon-btn" data-testid={`edit-${kind}-btn`} title={t(`Edit ${kind} preset`)} aria-label={t(`Edit ${kind} preset`)} disabled={!canEdit || disabled} onClick={() => openDialog(kind)}><EditIcon /></button>
      )}
      <button className="ds-icon-btn icon-btn" data-testid={`save-${kind}-btn`} title={t("Save as a user preset")} aria-label={t(`Save ${kind} preset`)} disabled={!canSave || disabled} onClick={() => openSavePresetDialog(kind)}><SaveIcon /></button>
      <button className="ds-icon-btn icon-btn" data-testid={`manage-${kind}-btn`} title={t("Manage presets, import and export")} aria-label={t(`Manage ${kind} presets`)} disabled={disabled} onClick={() => openManagePresetsDialog(kind)}><GearIcon /></button>
      {activeUser && (
        <button className="ds-icon-btn icon-btn" data-testid={`delete-${kind}-preset-btn`} title={t("Delete this user preset")} aria-label={t(`Delete ${kind} preset`)} disabled={disabled} onClick={() => deleteUserPresetAction(kind, activeUser)}><TrashIcon /></button>
      )}
      </Toolbar>
      </details>
    </div>
  );
};

/** The process switches desktop keeps next to the preset: support, brim, prime tower and ironing. */
const QuickToggles: React.FC<{ disabled: boolean; multiFilament: boolean }> = ({ disabled, multiFilament }) => {
    const { t } = useTranslation();
  const [flushOpen, setFlushOpen] = useState(false);
  const [modifiedOpen, setModifiedOpen] = useState(false);
  const layout = useAppStore((s) => s.layout);
  const presetConfig = useAppStore((s) => s.presetConfig);
  const currentConfig = useAppStore((s) => s.currentConfig);
  const applyOptionChange = useAppStore((s) => s.applyOptionChange);
  const pendingOptions = useAppStore((s) => s.pendingOptions);
  const value = (key: string) => pendingOptions[pendingOptionKey('print', key)]?.value ?? currentConfig[key];
  const changedCount = modifiedSettings(layout, currentConfig, presetConfig).length;
  const toggles: { id: string; label: string; checked: boolean; off?: string; apply: [string, string, string]; disabled?: boolean; title?: string }[] = [
    { id: 'support', label: t("Support"), checked: value('enable_support') === '1', apply: ['enable_support', '1', '0'] },
    { id: 'brim', label: t("Brim"), checked: !!value('brim_type') && value('brim_type') !== 'no_brim', apply: ['brim_type', 'auto_brim', 'no_brim'] },
    { id: 'prime-tower', label: t("Prime tower"), checked: value('enable_prime_tower') === '1', apply: ['enable_prime_tower', '1', '0'], disabled: !multiFilament, title: multiFilament ? undefined : 'Needs more than one filament' },
    { id: 'ironing', label: t("Ironing"), checked: !!value('ironing_type') && value('ironing_type') !== 'no ironing', apply: ['ironing_type', 'top', 'no ironing'] }
  ];
  return (
    <div id="quick-toggles" className="quick-toggles">
      {toggles.map((t) => (
        <label key={t.id} title={t.title} className="quick-toggle">
          <input
            id={`quick-${t.id}`} type="checkbox" checked={t.checked} disabled={disabled || t.disabled}
            aria-busy={Boolean(pendingOptions[pendingOptionKey('print', t.apply[0])])}
            onChange={(e) => void applyOptionChange(t.apply[0], e.target.checked ? t.apply[1] : t.apply[2], 'print')}
          />
          {t.label}
        </label>
      ))}
      {changedCount > 0 && <button id="modified-open" className="ds-btn" onClick={() => setModifiedOpen(true)}>{t('Modified')} · {changedCount}</button>}
      {modifiedOpen && <ModifiedSettingsDialog onClose={() => setModifiedOpen(false)} />}
      {multiFilament && <button id="flush-open" className="ds-btn" disabled={disabled} onClick={() => setFlushOpen(true)}>{t("Flushing volumes...")}</button>}
      {flushOpen && <FlushVolumesDialog onClose={() => setFlushOpen(false)} />}
    </div>
  );
};

export const PrepareSidebar: React.FC<{ scope?: 'printer' | 'filament' | 'settings' | 'objects' | 'output' }> = ({ scope }) => {
    const { t } = useTranslation();
  const sidebarWidth = usePrefsStore((s) => s.display.sidebarWidth);
  const sidebarRef = useRef<HTMLElement>(null);
  const [fullSettings, setFullSettings] = useState(false);
  const settingsViewRef = useRef<HTMLDivElement>(null);
  const [renderedWidth, setRenderedWidth] = useState(sidebarWidth);
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const observer = new ResizeObserver(() => setRenderedWidth(sidebar.getBoundingClientRect().width));
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, []);
  const setWidth = (width: number, available: number, persist = true) => {
    const clamped = Math.max(Math.min(220, available * 0.2), Math.min(available * 0.3, width));
    if (persist) usePrefsStore.getState().setDisplayPref('sidebarWidth', clamped);
    else usePrefsStore.setState(state => ({ display: { ...state.display, sidebarWidth: clamped } }));
  };
  const {
    vendors, selectedVendor, chooseVendor, printers, selectedPrinter, choosePrinter,
    processes, selectedProcess, chooseProcess, filaments, selectedFilament, selectedFilaments, chooseFilament,
    addFilamentSlot, removeFilamentSlot, setSlotColor, currentConfig, configDefs, applyOptionChange,
    userPresets, activeUserPreset, isSlicing, isModelLoading, startSlice, cancelSlice, isEngineReady, modelFile, sliceResult, modelObjects,
    selectUserPreset, openDialog, openSavePresetDialog, openManagePresetsDialog, deleteUserPresetAction
  } = useAppStore();
  const isRestoring = useHistoryStore((s) => s.isRestoring);
  const printerStatus = usePrinterConnectionStore((s) => s.status);
  const devices = usePrinterConnectionStore((s) => s.printers);
  const selectedDeviceId = usePrinterConnectionStore((s) => s.selectedPrinterId);
  const selectDevice = usePrinterConnectionStore((s) => s.selectPrinter);
  const printerCount = devices.length;
  const openSendDialog = usePrinterConnectionStore((s) => s.openSendDialog);

  const isSelectingPreset = useAppStore((s) => s.isSelectingPreset);
  const slicePercent = useAppStore(s => s.slicePercent);
  const sliceStatusText = useAppStore(s => s.sliceStatusText);
  const changePreset = async (change: () => Promise<void>) => {
    if (useAppStore.getState().isSelectingPreset) return;
    useAppStore.setState({ isSelectingPreset: true });
    try { await change(); }
    finally { useAppStore.setState({ isSelectingPreset: false }); }
  };

  const isBusy = !isEngineReady || isSlicing || isModelLoading || isRestoring || isSelectingPreset;
  const supportsBedTypes = selectedVendor === 'BBL' || currentConfig.support_multi_bed_types === '1' || currentConfig.support_multi_bed_types === 'true';
  const bedTypeDef = configDefs.curr_bed_type;
  const activeFilaments = selectedFilaments && selectedFilaments.length > 0 ? selectedFilaments : (selectedFilament ? [selectedFilament] : []);
  const activePlateIndex = usePlatesStore((s) => s.activePlateIndex);
  const hasCurrentGcode = !!sliceResult?.gcode && sliceResult.plateIndex === activePlateIndex;
  const sliceDisabledReason = useSliceReadiness();
  const canSlice = !sliceDisabledReason;

  const extrudersCount = Math.max(1, (currentConfig['nozzle_diameter'] || '').split(',').length);
  const isMultiMaterial = currentConfig['single_extruder_multi_material'] === '1' || currentConfig['single_extruder_multi_material'] === 'true' || selectedVendor === 'BBL' || extrudersCount === 1;
  const maxFilaments = isMultiMaterial ? 16 : Math.min(16, extrudersCount);

  const rawColors = (currentConfig['filament_colour'] || '').split(';').map((c) => c.trim());
  const defaultColors = ['#16417C', '#58B957', '#F5D130', '#E53935', '#8E24AA', '#00ACC1', '#FB8C00', '#D81B60', '#3949AB', '#00897B', '#7CB342', '#C0CA33', '#FDD835', '#FFB300', '#F4511E', '#6D4C41'];
  const getSlotColor = (idx: number) => {
    if (rawColors[idx]) return rawColors[idx];
    return defaultColors[idx % defaultColors.length];
  };
  const toHexColor = (col: string) => {
    if (!col) return '#16417C';
    let c = col.trim();
    if (!c.startsWith('#')) c = '#' + c;
    if (c.length > 7) c = c.substring(0, 7);
    return c;
  };

  const filamentHeaderActions = (
    <Toolbar label={t('Filament')}>
      <button
        type="button"
        id="add-filament-btn"
        data-testid="add-filament-btn"
        className="ds-icon-btn icon-btn btn-add-filament"
        title={t("Add filament")}
        aria-label={t("Add filament")}
        disabled={isBusy || activeFilaments.length >= maxFilaments}
        onClick={(e) => {
          e.stopPropagation();
          void changePreset(() => addFilamentSlot());
        }}
      >
        +
      </button>
      <button
        type="button"
        id="remove-filament-btn"
        data-testid="remove-filament-btn"
        className="ds-icon-btn icon-btn btn-remove-filament"
        title={t("Remove filament")}
        aria-label={t("Remove filament")}
        disabled={isBusy || activeFilaments.length <= 1}
        onClick={(e) => {
          e.stopPropagation();
          void changePreset(() => removeFilamentSlot());
        }}
      >
        −
      </button>
    </Toolbar>
  );
  const user = (kind: PresetKind) => userPresets.filter((p) => p.kind === kind);
  const current = (kind: PresetKind, name: string) =>
    userPresets.some(preset => preset.kind === kind && preset.name === name) ? `user:${name}` : name;

  // Filaments added in the configuration wizard are the ones offered; with none added, every compatible one is.
  const addedFilaments = useWizardStore((s) => s.addedFilaments);
  const offeredFilaments = addedFilaments.length ? filaments.filter((p) => addedFilaments.includes(p.name) || activeFilaments.includes(p.name)) : filaments;

  const connectButton = (
    <button id="printer-connection-btn" className="ds-icon-btn icon-btn" title={t(printerCount ? "Printer connection" : "Connect a printer")} aria-label={t("Connect printer")} onClick={() => usePrinterConnectionStore.getState().openDialog(selectedDeviceId)}>
      <PlugIcon />{printerStatus !== 'none' && <span className="status-dot" data-status={printerStatus} />}
    </button>
  );

  return (
    <aside ref={sidebarRef} className={scope ? 'prepare-panel-content' : 'sidebar'} aria-label={t("Print settings")} aria-busy={isBusy} style={scope ? undefined : { width: sidebarWidth }}>
      {!scope && <div className="sidebar-resizer" role="separator" aria-label={t("Resize settings sidebar")} aria-orientation="vertical"
        tabIndex={0} aria-valuenow={Math.round(renderedWidth)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const available = e.currentTarget.parentElement?.parentElement?.clientWidth ?? window.innerWidth;
          setWidth((e.currentTarget.parentElement?.getBoundingClientRect().width ?? sidebarWidth) + (e.key === 'ArrowRight' ? 10 : -10), available);
        }}
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const container = e.currentTarget.parentElement?.parentElement;
          if (!container) return;
          const bounds = container.getBoundingClientRect();
          setWidth(e.clientX - bounds.left, bounds.width, false);
        }}
        onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onLostPointerCapture={() => usePrefsStore.getState().setDisplayPref('sidebarWidth', usePrefsStore.getState().display.sidebarWidth)} />}
      <div className="sidebar-scroll">
        {(!scope || scope === 'printer') && <Section id="printer" title={t("Printer")}>
          {devices.length > 0 && (
            <>
              <label className="field-label" htmlFor="device-select">{t("Device")}</label>
              <select id="device-select" value={selectedDeviceId ?? ''} disabled={isBusy} onChange={(e) => selectDevice(e.target.value)}>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </>
          )}
          <PresetRow kind="printer" disabled={isBusy} selectDisabled={isBusy} placeholder={t("Select printer...")} system={[]} user={[]}
            value="" onSystem={() => {}} onUser={() => {}} selectNode={<SavedPrinterSelector disabled={isBusy} />} extra={connectButton} canEdit={!!selectedPrinter} canSave={!!selectedPrinter} />
          {selectedPrinter && supportsBedTypes && bedTypeDef?.enumValues && (
            <>
              <label className="field-label" htmlFor="bed-type-select">{t("Bed type")}</label>
              <div className="bed-type-row">
              {bedTypeIcons[currentConfig.curr_bed_type] && <img id="bed-type-icon" src={`/icons/${bedTypeIcons[currentConfig.curr_bed_type]}.png`} alt="" aria-hidden="true" width={40} height={40} />}
              <select id="bed-type-select" data-testid="bed-type-select" value={currentConfig.curr_bed_type || ''} disabled={isBusy}
                onChange={(e) => void applyOptionChange('curr_bed_type', e.target.value, 'print')}>
                {bedTypeDef.enumValues.map((value, index) => (
                  <option key={value} value={value}>{t(bedTypeDef.enumLabels?.[index] || value)}</option>
                ))}
              </select>
              </div>
            </>
          )}
          {selectedDeviceId && selectedPrinter && devices.find(device => device.id === selectedDeviceId)?.preset !== selectedPrinter && (
            <button className="ds-btn" id="bind-device-profile" disabled={isBusy}
              onClick={() => void changePreset(() => bindDeviceProfile(selectedPrinter, selectedDeviceId))}>
              {t("Use current profile for device")}
            </button>
          )}
        </Section>}

        {(!scope || scope === 'filament') && <Section id="filament" title={t("Filament")} headerExtra={filamentHeaderActions}>
          <FilamentSyncButton />
          <div className="filament-slots-list">
            {(activeFilaments.length ? activeFilaments : ['']).map((filamentName, idx) => {
              const slotNumber = idx + 1;
              const selectId = idx === 0 ? 'filament-select' : `filament-select-${slotNumber}`;
              const slotColor = getSlotColor(idx);
              const activeUser = activeUserPreset['filament'];

              return (
                <div key={idx} className="preset-row filament-slot-row">
                  <span
                    className="filament-slot-number"
                  >
                    {slotNumber}
                  </span>

                  <div className="filament-color-control">
                    <button
                      type="button"
                      id={`filament-color-${slotNumber}`}
                      data-testid={`filament-color-${slotNumber}`}
                      className="filament-color-swatch ds-swatch"
                      title={t(`Slot ${slotNumber} color: ${slotColor}. Click to change`)}
                      aria-label={t(`Slot ${slotNumber} color`)}
                      onClick={() => {
                        const input = document.getElementById(`filament-color-input-${slotNumber}`) as HTMLInputElement;
                        input?.click();
                      }}
                      style={{ "--swatch": slotColor } as React.CSSProperties}
                    />
                    <input
                      type="color"
                      id={`filament-color-input-${slotNumber}`}
                      data-testid={`filament-color-input-${slotNumber}`}
                      value={toHexColor(slotColor)}
                      disabled={isBusy}
                      onChange={(e) => void setSlotColor(idx, e.target.value)}
                      className="filament-color-input" tabIndex={-1}
                    />
                  </div>

                  <MobileSelect
                    id={selectId}
                    data-testid={selectId}
                    aria-label={t(`filament preset ${slotNumber}`)}
                    value={current('filament', filamentName)}
                    disabled={isBusy || !selectedPrinter || filaments.length === 0}
                    onValueChange={(value) => {
                      void changePreset(() => value.startsWith('user:')
                        ? selectUserPreset('filament', value.substring(5), idx)
                        : chooseFilament(value, idx));
                    }}
                  >
                    <option value="">{t("Select filament...")}</option>
                    {filaments.length > 0 && (
                      <optgroup label={t("System presets")}>
                        {offeredFilaments.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {user('filament').length > 0 && (
                      <optgroup label={t("User presets")}>
                        {user('filament').map((u) => (
                          <option key={u.name} value={`user:${u.name}`}>
                            {u.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </MobileSelect>

                  <details className="workflow-preset-actions"><summary aria-label={t('Manage filament presets')} title={t('Manage filament presets')}><GearIcon /></summary>
                  <Toolbar label={t('Manage filament presets')}>
                  <button
                    className="ds-icon-btn icon-btn"
                    id={idx === 0 ? 'edit-filament-btn' : `edit-filament-btn-${slotNumber}`}
                    data-testid={idx === 0 ? 'edit-filament-btn' : `edit-filament-btn-${slotNumber}`}
                    title={t("Edit filament preset")}
                    aria-label={t("Edit filament preset")}
                    disabled={!filamentName || isBusy}
                    onClick={() => openDialog('filament', idx)}
                  >
                    <EditIcon />
                  </button>
                  <button
                    className="ds-icon-btn icon-btn"
                    id={idx === 0 ? 'manage-filament-btn' : `manage-filament-btn-${slotNumber}`}
                    data-testid={idx === 0 ? 'manage-filament-btn' : `manage-filament-btn-${slotNumber}`}
                    title={t("Manage presets, import and export")}
                    aria-label={t("Manage filament presets")}
                    disabled={isBusy}
                    onClick={() => openManagePresetsDialog('filament')}
                  >
                    <GearIcon />
                  </button>
                  {activeUser && idx === 0 && (
                    <button
                      className="ds-icon-btn icon-btn"
                      id="delete-filament-preset-btn"
                      data-testid="delete-filament-preset-btn"
                      title={t("Delete this user preset")}
                      aria-label={t("Delete filament preset")}
                      disabled={isBusy}
                      onClick={() => deleteUserPresetAction('filament', activeUser)}
                    >
                      <TrashIcon />
                    </button>
                  )}
                  </Toolbar>
                  </details>
                </div>
              );
            })}
          </div>
        </Section>}

        {(!scope || scope === 'settings') && <><Section id="process" title={t("Process")}>
          <PresetRow kind="process" disabled={isBusy} selectDisabled={isBusy || !selectedPrinter || processes.length === 0} placeholder={t("Select process...")} system={processes} user={user('process')}
            value={current('process', selectedProcess)} onSystem={(name) => void changePreset(() => chooseProcess(name))} onUser={(name) => void changePreset(() => selectUserPreset('process', name))} canEdit={false} canSave={!!selectedProcess} />
        </Section>

        <button className="ds-btn workflow-view-toggle" aria-expanded={fullSettings} aria-controls="prepare-settings-view" onClick={() => {
          setFullSettings(!fullSettings);
          requestAnimationFrame(() => {
            settingsViewRef.current?.focus();
            settingsViewRef.current?.scrollIntoView({ block: 'nearest' });
          });
        }}>{t(fullSettings ? 'Quick settings' : 'Full settings')}</button>
        <div id="prepare-settings-view" ref={settingsViewRef} tabIndex={-1} aria-label={t(fullSettings ? 'Full settings' : 'Quick settings')}>
          {fullSettings ? <>
            <QuickToggles disabled={isBusy || !selectedProcess} multiFilament={activeFilaments.length > 1} />
            <div className="sb-settings"><SettingsPanel /></div>
          </> : <QuickSettings />}
        </div></>}

        {(!scope || scope === 'objects') && <Section id="objects" title={t("Objects")} badge={modelObjects?.length ? String(modelObjects.length) : undefined} className="sb-objects">
          <div className="objects-wrap"><ObjectListPanel /></div>
        </Section>}

      </div>

      {scope === 'objects' && <PlateScope />}
      {(!scope || scope === 'output') && <div className="sidebar-footer">
        <PlateScope />
        {isSlicing && <div role="status"><span>{t(sliceStatusText)}</span><div className="ds-progress" role="progressbar" aria-label={t('Slicing...')} aria-valuenow={slicePercent} aria-valuemin={0} aria-valuemax={100}><span style={{ '--value': `${slicePercent}%` } as React.CSSProperties} /></div></div>}
        {(
          <button id="slice-btn" className="ds-btn ds-btn--primary ds-btn--hero ds-btn--block" title={t(sliceDisabledReason)} aria-describedby={sliceDisabledReason ? 'slice-disabled-reason' : undefined} aria-busy={isSlicing} disabled={!canSlice && !isSlicing} onClick={() => isSlicing ? cancelSlice() : startSlice()}>{t(isSlicing ? 'Cancel' : 'Slice this plate')}</button>
        )}
        {!isSlicing && sliceDisabledReason && <div role="status"><p id="slice-disabled-reason" className="slice-disabled-reason">{t(sliceDisabledReason)}</p>{!scope && <ReadinessAction reason={sliceDisabledReason} />}</div>}
        <button id="cancel-btn" className="ds-btn ds-btn--danger ds-btn--block" hidden={!isSlicing} disabled={!isSlicing} onClick={() => cancelSlice()}>{t("Cancel")}</button>
        {hasCurrentGcode && !isSlicing && (
          <div className="footer-row">
            <button id="export-gcode-btn" className="ds-btn ds-btn--block" onClick={exportGcode}>{t("Export G-code")}</button>
            <button id="send-to-printer-btn" className="ds-btn ds-btn--block" onClick={openSendDialog}>{t("Send to printer")}</button>
          </div>
        )}
      </div>}
    </aside>
  );
};
