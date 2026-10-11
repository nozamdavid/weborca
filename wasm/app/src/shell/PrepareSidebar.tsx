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
import { SettingsPanel } from '../settings/SettingsPanel';
import { useAppStore, resolveDeviceVendor, pendingOptionKey } from '../store/appStore';
import type { PresetKind } from '../presets/types';
import { exportGcode } from './exportGcode';
import { EditIcon, GearIcon, PlugIcon, SaveIcon, TrashIcon } from './glyphs';
import { useTranslation } from "../i18n";

const bedTypeIcons: Record<string, string> = {
  'Cool Plate': 'bed_cool',
  'Engineering Plate': 'bed_engineering',
  'High Temp Plate': 'bed_high_templ',
  'Textured PEI Plate': 'bed_pei',
  'Textured Cool Plate': 'bed_pei_cool',
  'Supertack Plate': 'bed_cool_supertack'
};

const Section: React.FC<{ title: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean; className?: string; headerExtra?: React.ReactNode }> = ({ title, badge, children, defaultOpen = true, className = '', headerExtra }) => {
    const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`sb-section ${open ? '' : 'closed'} ${className}`}>
      <div className="sb-head" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen(!open)}>
        <span className="chev">▼</span>
        <span className="grow">{title}</span>
        {badge && <span className="badge">{badge}</span>}
        {headerExtra && <div className="sb-head-extra" onClick={(e) => e.stopPropagation()}>{headerExtra}</div>}
      </div>
      {open && <div className="sb-body">{children}</div>}
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
  canEdit: boolean;
  canSave: boolean;
}> = ({ kind, disabled, selectDisabled, placeholder, system, user, value, onSystem, onUser, extra, canEdit, canSave }) => {
    const { t } = useTranslation();
  const { openDialog, openSavePresetDialog, openManagePresetsDialog, deleteUserPresetAction, activeUserPreset } = useAppStore();
  const activeUser = activeUserPreset[kind];
  return (
    <div className="preset-row">
      <select
        id={`${kind}-select`}
        data-testid={`${kind}-select`}
        aria-label={`${kind} preset`}
        value={value}
        disabled={selectDisabled}
        onChange={(e) => (e.target.value.startsWith('user:') ? onUser(e.target.value.substring(5)) : onSystem(e.target.value))}
      >
        <option value="">{placeholder}</option>
        {system.length > 0 && <optgroup label={t("System presets")}>{system.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>}
        {user.length > 0 && <optgroup label={t("User presets")}>{user.map((u) => <option key={u.name} value={`user:${u.name}`}>{u.name}</option>)}</optgroup>}
      </select>
      {extra}
      {kind !== 'process' && (
        <button className="icon-btn" data-testid={`edit-${kind}-btn`} title={`Edit ${kind} preset`} aria-label={`Edit ${kind} preset`} disabled={!canEdit || disabled} onClick={() => openDialog(kind)}><EditIcon /></button>
      )}
      <button className="icon-btn" data-testid={`save-${kind}-btn`} title={t("Save as a user preset")} aria-label={`Save ${kind} preset`} disabled={!canSave || disabled} onClick={() => openSavePresetDialog(kind)}><SaveIcon /></button>
      <button className="icon-btn" data-testid={`manage-${kind}-btn`} title={t("Manage presets, import and export")} aria-label={`Manage ${kind} presets`} disabled={disabled} onClick={() => openManagePresetsDialog(kind)}><GearIcon /></button>
      {activeUser && (
        <button className="icon-btn" data-testid={`delete-${kind}-preset-btn`} title={t("Delete this user preset")} aria-label={`Delete ${kind} preset`} disabled={disabled} onClick={() => deleteUserPresetAction(kind, activeUser)}><TrashIcon /></button>
      )}
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
    <div id="quick-toggles" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', padding: '4px 12px 8px', fontSize: 12 }}>
      {toggles.map((t) => (
        <label key={t.id} title={t.title} style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: disabled || t.disabled ? 0.5 : 1 }}>
          <input
            id={`quick-${t.id}`} type="checkbox" checked={t.checked} disabled={disabled || t.disabled}
            aria-busy={Boolean(pendingOptions[pendingOptionKey('print', t.apply[0])])}
            onChange={(e) => void applyOptionChange(t.apply[0], e.target.checked ? t.apply[1] : t.apply[2], 'print')}
          />
          {t.label}
        </label>
      ))}
      {changedCount > 0 && <button id="modified-open" className="btn btn-secondary" style={{ padding: '1px 8px', fontSize: 12 }} onClick={() => setModifiedOpen(true)}>{changedCount} {t("modified...")}</button>}
      {modifiedOpen && <ModifiedSettingsDialog onClose={() => setModifiedOpen(false)} />}
      {multiFilament && <button id="flush-open" className="btn btn-secondary" style={{ padding: '1px 8px', fontSize: 12 }} disabled={disabled} onClick={() => setFlushOpen(true)}>{t("Flushing volumes...")}</button>}
      {flushOpen && <FlushVolumesDialog onClose={() => setFlushOpen(false)} />}
    </div>
  );
};

export const PrepareSidebar: React.FC = () => {
    const { t } = useTranslation();
  const sidebarWidth = usePrefsStore((s) => s.display.sidebarWidth);
  const sidebarRef = useRef<HTMLElement>(null);
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
  const changePreset = async (change: () => Promise<void>) => {
    if (useAppStore.getState().isSelectingPreset) return;
    useAppStore.setState({ isSelectingPreset: true });
    try { await change(); }
    finally { useAppStore.setState({ isSelectingPreset: false }); }
  };

  // Only explicit sidebar actions associate a profile with a physical device.
  const bindDeviceProfile = async (name: string, deviceId: string | null) => {
    if (!deviceId) return;
    const before = useAppStore.getState();
    const isUser = before.userPresets.some(preset => preset.kind === 'printer' && preset.name === name);
    // Resolve without updating a saved device before the final identity check.
    const vendor = isUser ? await resolveDeviceVendor({ id: '', preset: name }) : before.selectedVendor;
    const app = useAppStore.getState();
    const store = usePrinterConnectionStore.getState();
    if (!app.isEngineReady || app.isModelLoading || app.engineError || app.selectedPrinter !== name || store.selectedPrinterId !== deviceId) return;
    const device = store.printers.find(printer => printer.id === deviceId);
    if (!device || !vendor) return;
    store.savePrinter({
      ...device, preset: name, vendor,
      filamentPresets: [...app.selectedFilaments],
      filamentColors: (app.currentConfig.filament_colour || '').split(';')
    });
  };
  const handleSelectPrinter = (name: string, isUser: boolean) => {
    const deviceId = usePrinterConnectionStore.getState().selectedPrinterId;
    return changePreset(async () => {
      if (isUser) await selectUserPreset('printer', name);
      else await choosePrinter(name);
      await bindDeviceProfile(name, deviceId);
    });
  };
  const isBusy = !isEngineReady || isSlicing || isModelLoading || isRestoring || isSelectingPreset;
  const supportsBedTypes = selectedVendor === 'BBL' || currentConfig.support_multi_bed_types === '1' || currentConfig.support_multi_bed_types === 'true';
  const bedTypeDef = configDefs.curr_bed_type;
  const activeFilaments = selectedFilaments && selectedFilaments.length > 0 ? selectedFilaments : (selectedFilament ? [selectedFilament] : []);
  // A finished slice with the selected printer connected is sent rather than sliced again.
  const activePlateIndex = usePlatesStore((s) => s.activePlateIndex);
  const hasCurrentGcode = !!sliceResult?.gcode && sliceResult.plateIndex === activePlateIndex;
  const readyToSend = hasCurrentGcode && !isBusy && printerStatus === 'online';
  const canSlice = isEngineReady && !isBusy && !!modelFile && !!selectedPrinter && !!selectedProcess && (activeFilaments.length > 0);

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
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        id="add-filament-btn"
        data-testid="add-filament-btn"
        className="icon-btn btn-add-filament"
        title={t("Add filament")}
        aria-label={t("Add filament")}
        disabled={isBusy || activeFilaments.length >= maxFilaments}
        onClick={(e) => {
          e.stopPropagation();
          void changePreset(() => addFilamentSlot());
        }}
        style={{
          width: 22,
          height: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1rem',
          lineHeight: 1,
          padding: 0
        }}
      >
        +
      </button>
      <button
        type="button"
        id="remove-filament-btn"
        data-testid="remove-filament-btn"
        className="icon-btn btn-remove-filament"
        title={t("Remove filament")}
        aria-label={t("Remove filament")}
        disabled={isBusy || activeFilaments.length <= 1}
        onClick={(e) => {
          e.stopPropagation();
          void changePreset(() => removeFilamentSlot());
        }}
        style={{
          width: 22,
          height: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1rem',
          lineHeight: 1,
          padding: 0
        }}
      >
        −
      </button>
    </div>
  );
  const user = (kind: PresetKind) => userPresets.filter((p) => p.kind === kind);
  const current = (kind: PresetKind, name: string) =>
    userPresets.some(preset => preset.kind === kind && preset.name === name) ? `user:${name}` : name;

  // Printers added in the configuration wizard are the ones offered for their brand; with none added, every printer of the brand is.
  const addedPrinters = useWizardStore((s) => s.addedPrinters);
  const addedFilaments = useWizardStore((s) => s.addedFilaments);
  const offeredFilaments = addedFilaments.length ? filaments.filter((p) => addedFilaments.includes(p.name) || activeFilaments.includes(p.name)) : filaments;
  const added = printers.filter((p) => addedPrinters.includes(p.name) || p.name === selectedPrinter);
  const offeredPrinters = added.some((p) => addedPrinters.includes(p.name)) ? added : printers;
  const addPrinters = () => {
    useWizardStore.getState().setSelectedVendor(selectedVendor);
    useWizardStore.getState().setOpen(true);
  };

  const connectButton = (
    <button id="printer-connection-btn" className="icon-btn" title={printerCount ? 'Printer connection' : 'Connect a printer'} aria-label={t("Connect printer")} onClick={() => usePrinterConnectionStore.getState().openDialog(null)}>
      <PlugIcon />{printerStatus !== 'none' && <span className="status-dot" data-status={printerStatus} />}
    </button>
  );

  return (
    <aside ref={sidebarRef} className="sidebar" aria-label={t("Print settings")} aria-busy={isBusy} style={{ width: sidebarWidth }}>
      <div className="sidebar-resizer" role="separator" aria-label={t("Resize settings sidebar")} aria-orientation="vertical"
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
        onLostPointerCapture={() => usePrefsStore.getState().setDisplayPref('sidebarWidth', usePrefsStore.getState().display.sidebarWidth)} />
      <div className="sidebar-scroll">
        <Section title={t("Printer")}>
          {devices.length > 0 && (
            <>
              <label className="field-label" htmlFor="device-select">{t("Device")}</label>
              <select id="device-select" value={selectedDeviceId ?? ''} disabled={isBusy} onChange={(e) => selectDevice(e.target.value)}>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </>
          )}
          <label className="field-label" htmlFor="vendor-select">{t("Brand")}</label>
          <select id="vendor-select" value={selectedVendor} disabled={isBusy || vendors.length === 0} onChange={(e) => void changePreset(() => chooseVendor(e.target.value))}>
            <option value="">{t("Select brand...")}</option>
            {vendors.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
          <PresetRow kind="printer" disabled={isBusy} selectDisabled={isBusy || printers.length === 0} placeholder={t("Select printer...")} system={offeredPrinters} user={user('printer')}
            value={current('printer', selectedPrinter)} onSystem={(name) => void handleSelectPrinter(name, false)} onUser={(name) => void handleSelectPrinter(name, true)} extra={connectButton} canEdit={!!selectedPrinter} canSave={!!selectedPrinter} />
          {selectedPrinter && supportsBedTypes && bedTypeDef?.enumValues && (
            <>
              <label className="field-label" htmlFor="bed-type-select">{t("Bed type")}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {bedTypeIcons[currentConfig.curr_bed_type] && <img id="bed-type-icon" src={`/icons/${bedTypeIcons[currentConfig.curr_bed_type]}.png`} alt="" aria-hidden="true" width={40} height={40} />}
              <select id="bed-type-select" data-testid="bed-type-select" value={currentConfig.curr_bed_type || ''} disabled={isBusy}
                style={{ flex: 1, minWidth: 0 }}
                onChange={(e) => void applyOptionChange('curr_bed_type', e.target.value, 'print')}>
                {bedTypeDef.enumValues.map((value, index) => (
                  <option key={value} value={value}>{t(bedTypeDef.enumLabels?.[index] || value)}</option>
                ))}
              </select>
              </div>
            </>
          )}
          {selectedDeviceId && selectedPrinter && devices.find(device => device.id === selectedDeviceId)?.preset !== selectedPrinter && (
            <button className="btn btn-secondary" id="bind-device-profile" disabled={isBusy}
              onClick={() => void changePreset(() => bindDeviceProfile(selectedPrinter, selectedDeviceId))}>
              {t("Use current profile for device")}
            </button>
          )}
          <button className="btn btn-secondary" id="add-printers-btn" style={{ alignSelf: 'flex-start', padding: '2px 10px' }} disabled={isBusy || !selectedVendor} onClick={addPrinters}>{t("Add printers and nozzles...")}</button>
        </Section>

        <Section title={t("Filament")} headerExtra={filamentHeaderActions}>
          <FilamentSyncButton />
          <div className="filament-slots-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeFilaments.map((filamentName, idx) => {
              const slotNumber = idx + 1;
              const selectId = idx === 0 ? 'filament-select' : `filament-select-${slotNumber}`;
              const slotColor = getSlotColor(idx);
              const activeUser = activeUserPreset['filament'];

              return (
                <div key={idx} className="preset-row filament-slot-row" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span
                    className="filament-slot-number"
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      minWidth: 12,
                      textAlign: 'center'
                    }}
                  >
                    {slotNumber}
                  </span>

                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <button
                      type="button"
                      id={`filament-color-${slotNumber}`}
                      data-testid={`filament-color-${slotNumber}`}
                      className="filament-color-swatch"
                      title={`Slot ${slotNumber} color: ${slotColor}. Click to change`}
                      aria-label={`Slot ${slotNumber} color`}
                      onClick={() => {
                        const input = document.getElementById(`filament-color-input-${slotNumber}`) as HTMLInputElement;
                        input?.click();
                      }}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 3,
                        backgroundColor: slotColor,
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        cursor: 'pointer',
                        padding: 0,
                        flexShrink: 0
                      }}
                    />
                    <input
                      type="color"
                      id={`filament-color-input-${slotNumber}`}
                      data-testid={`filament-color-input-${slotNumber}`}
                      value={toHexColor(slotColor)}
                      disabled={isBusy}
                      onChange={(e) => void setSlotColor(idx, e.target.value)}
                      style={{
                        position: 'absolute',
                        opacity: 0,
                        width: 0,
                        height: 0,
                        pointerEvents: 'none'
                      }}
                    />
                  </div>

                  <select
                    id={selectId}
                    data-testid={selectId}
                    aria-label={`filament preset ${slotNumber}`}
                    value={current('filament', filamentName)}
                    disabled={isBusy || !selectedPrinter || filaments.length === 0}
                    onChange={(e) => {
                      const value = e.target.value;
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
                  </select>

                  <button
                    className="icon-btn"
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
                    className="icon-btn"
                    id={idx === 0 ? 'save-filament-btn' : `save-filament-btn-${slotNumber}`}
                    data-testid={idx === 0 ? 'save-filament-btn' : `save-filament-btn-${slotNumber}`}
                    title={t("Save as a user preset")}
                    aria-label={t("Save filament preset")}
                    disabled={!filamentName || isBusy}
                    onClick={() => openSavePresetDialog('filament', idx)}
                  >
                    <SaveIcon />
                  </button>
                  <button
                    className="icon-btn"
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
                      className="icon-btn"
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
                </div>
              );
            })}
          </div>
        </Section>

        <Section title={t("Process")}>
          <PresetRow kind="process" disabled={isBusy} selectDisabled={isBusy || !selectedPrinter || processes.length === 0} placeholder={t("Select process...")} system={processes} user={user('process')}
            value={current('process', selectedProcess)} onSystem={(name) => void changePreset(() => chooseProcess(name))} onUser={(name) => void changePreset(() => selectUserPreset('process', name))} canEdit={false} canSave={!!selectedProcess} />
        </Section>

        <QuickToggles disabled={isBusy || !selectedProcess} multiFilament={activeFilaments.length > 1} />

        <Section title={t("Objects")} badge={modelObjects?.length ? String(modelObjects.length) : undefined} className="sb-objects">
          <div className="objects-wrap"><ObjectListPanel /></div>
        </Section>

        <div className="sb-settings"><SettingsPanel /></div>
      </div>

      <div className="sidebar-footer">
        {readyToSend ? (
          <button id="send-to-printer-btn" className="btn-slice" onClick={openSendDialog}>{t("Send to printer")}</button>
        ) : (
          <button id="slice-btn" className="btn-slice" disabled={!canSlice} onClick={() => startSlice()}>{isSlicing ? 'Slicing...' : 'Slice plate'}</button>
        )}
        <button id="cancel-btn" className="btn-danger-wide" hidden={!isSlicing} disabled={!isSlicing} onClick={() => cancelSlice()}>{t("Cancel")}</button>
        {hasCurrentGcode && !isSlicing && (
          <div className="footer-row">
            <button id="export-gcode-btn" className="btn-secondary-wide" onClick={exportGcode}>{t("Export G-code")}</button>
            {!readyToSend && <button id="send-to-printer-btn" className="btn-secondary-wide" onClick={openSendDialog}>{t("Send to printer")}</button>}
          </div>
        )}
      </div>
    </aside>
  );
};
