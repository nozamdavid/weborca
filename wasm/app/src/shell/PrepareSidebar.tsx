import { useWizardStore } from '../wizard';
import React, { useState } from 'react';
import { ModifiedSettingsDialog } from '../settings/ModifiedSettingsDialog';
import { modifiedSettings } from '../settings/modifiedSettings';
import { FlushVolumesDialog } from '../flush/FlushVolumesDialog';
import { useHistoryStore } from '../history';
import { ObjectListPanel } from '../objectlist/ObjectListPanel';
import { usePrinterConnectionStore } from '../printers/connectionStore';
import { SettingsPanel } from '../settings/SettingsPanel';
import { useAppStore } from '../store/appStore';
import type { PresetKind } from '../presets/types';
import { exportGcode } from './exportGcode';
import { EditIcon, GearIcon, PlugIcon, SaveIcon, TrashIcon } from './glyphs';

const Section: React.FC<{ title: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean; className?: string; headerExtra?: React.ReactNode }> = ({ title, badge, children, defaultOpen = true, className = '', headerExtra }) => {
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
  extra?: React.ReactNode;
  canEdit: boolean;
  canSave: boolean;
}> = ({ kind, disabled, selectDisabled, placeholder, system, user, value, onSystem, extra, canEdit, canSave }) => {
  const { selectUserPreset, openDialog, openSavePresetDialog, openManagePresetsDialog, deleteUserPresetAction, activeUserPreset } = useAppStore();
  const activeUser = activeUserPreset[kind];
  return (
    <div className="preset-row">
      <select
        id={`${kind}-select`}
        data-testid={`${kind}-select`}
        aria-label={`${kind} preset`}
        value={value}
        disabled={selectDisabled}
        onChange={(e) => (e.target.value.startsWith('user:') ? selectUserPreset(kind, e.target.value.substring(5)) : onSystem(e.target.value))}
      >
        <option value="">{placeholder}</option>
        {system.length > 0 && <optgroup label="System presets">{system.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>}
        {user.length > 0 && <optgroup label="User presets">{user.map((u) => <option key={u.name} value={`user:${u.name}`}>{u.name}</option>)}</optgroup>}
      </select>
      {extra}
      {kind !== 'process' && (
        <button className="icon-btn" data-testid={`edit-${kind}-btn`} title={`Edit ${kind} preset`} aria-label={`Edit ${kind} preset`} disabled={!canEdit || disabled} onClick={() => openDialog(kind)}><EditIcon /></button>
      )}
      <button className="icon-btn" data-testid={`save-${kind}-btn`} title="Save as a user preset" aria-label={`Save ${kind} preset`} disabled={!canSave || disabled} onClick={() => openSavePresetDialog(kind)}><SaveIcon /></button>
      <button className="icon-btn" data-testid={`manage-${kind}-btn`} title="Manage presets, import and export" aria-label={`Manage ${kind} presets`} disabled={disabled} onClick={() => openManagePresetsDialog(kind)}><GearIcon /></button>
      {activeUser && (
        <button className="icon-btn" data-testid={`delete-${kind}-preset-btn`} title="Delete this user preset" aria-label={`Delete ${kind} preset`} disabled={disabled} onClick={() => deleteUserPresetAction(kind, activeUser)}><TrashIcon /></button>
      )}
    </div>
  );
};

/** The process switches desktop keeps next to the preset: support, brim, prime tower and ironing. */
const QuickToggles: React.FC<{ disabled: boolean; multiFilament: boolean }> = ({ disabled, multiFilament }) => {
  const [flushOpen, setFlushOpen] = useState(false);
  const [modifiedOpen, setModifiedOpen] = useState(false);
  const layout = useAppStore((s) => s.layout);
  const presetConfig = useAppStore((s) => s.presetConfig);
  const currentConfig = useAppStore((s) => s.currentConfig);
  const applyOptionChange = useAppStore((s) => s.applyOptionChange);
  const changedCount = modifiedSettings(layout, currentConfig, presetConfig).length;
  const toggles: { id: string; label: string; checked: boolean; off?: string; apply: [string, string, string]; disabled?: boolean; title?: string }[] = [
    { id: 'support', label: 'Support', checked: currentConfig.enable_support === '1', apply: ['enable_support', '1', '0'] },
    { id: 'brim', label: 'Brim', checked: !!currentConfig.brim_type && currentConfig.brim_type !== 'no_brim', apply: ['brim_type', 'auto_brim', 'no_brim'] },
    { id: 'prime-tower', label: 'Prime tower', checked: currentConfig.enable_prime_tower === '1', apply: ['enable_prime_tower', '1', '0'], disabled: !multiFilament, title: multiFilament ? undefined : 'Needs more than one filament' },
    { id: 'ironing', label: 'Ironing', checked: !!currentConfig.ironing_type && currentConfig.ironing_type !== 'no ironing', apply: ['ironing_type', 'top', 'no ironing'] }
  ];
  return (
    <div id="quick-toggles" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', padding: '4px 12px 8px', fontSize: 12 }}>
      {toggles.map((t) => (
        <label key={t.id} title={t.title} style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: disabled || t.disabled ? 0.5 : 1 }}>
          <input
            id={`quick-${t.id}`} type="checkbox" checked={t.checked} disabled={disabled || t.disabled}
            onChange={(e) => void applyOptionChange(t.apply[0], e.target.checked ? t.apply[1] : t.apply[2], 'print')}
          />
          {t.label}
        </label>
      ))}
      {changedCount > 0 && <button id="modified-open" className="btn btn-secondary" style={{ padding: '1px 8px', fontSize: 12 }} onClick={() => setModifiedOpen(true)}>{changedCount} modified...</button>}
      {modifiedOpen && <ModifiedSettingsDialog onClose={() => setModifiedOpen(false)} />}
      {multiFilament && <button id="flush-open" className="btn btn-secondary" style={{ padding: '1px 8px', fontSize: 12 }} disabled={disabled} onClick={() => setFlushOpen(true)}>Flushing volumes...</button>}
      {flushOpen && <FlushVolumesDialog onClose={() => setFlushOpen(false)} />}
    </div>
  );
};

export const PrepareSidebar: React.FC = () => {
  const {
    vendors, selectedVendor, chooseVendor, printers, selectedPrinter, choosePrinter,
    processes, selectedProcess, chooseProcess, filaments, selectedFilament, selectedFilaments, chooseFilament,
    addFilamentSlot, removeFilamentSlot, setSlotColor, currentConfig,
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

  const isBusy = isSlicing || isModelLoading || isRestoring;
  const activeFilaments = selectedFilaments && selectedFilaments.length > 0 ? selectedFilaments : (selectedFilament ? [selectedFilament] : []);
  // A finished slice with the selected printer connected is sent rather than sliced again.
  const readyToSend = !!sliceResult?.gcode && !isBusy && printerStatus === 'online';
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
        title="Add filament"
        aria-label="Add filament"
        disabled={isBusy || activeFilaments.length >= maxFilaments}
        onClick={(e) => {
          e.stopPropagation();
          addFilamentSlot();
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
        title="Remove filament"
        aria-label="Remove filament"
        disabled={isBusy || activeFilaments.length <= 1}
        onClick={(e) => {
          e.stopPropagation();
          removeFilamentSlot();
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
  const current = (kind: PresetKind, system: string) => (activeUserPreset[kind] ? `user:${activeUserPreset[kind]}` : system);

  // Printers added in the configuration wizard are the ones offered for their brand; with none added, every printer of the brand is.
  const addedPrinters = useWizardStore((s) => s.addedPrinters);
  const added = printers.filter((p) => addedPrinters.includes(p.name) || p.name === selectedPrinter);
  const offeredPrinters = added.some((p) => addedPrinters.includes(p.name)) ? added : printers;
  const addPrinters = () => {
    useWizardStore.getState().setSelectedVendor(selectedVendor);
    useWizardStore.getState().setOpen(true);
  };

  const connectButton = (
    <button id="printer-connection-btn" className="icon-btn" title={printerCount ? 'Printer connection' : 'Connect a printer'} aria-label="Connect printer" onClick={() => usePrinterConnectionStore.getState().openDialog(null)}>
      <PlugIcon />{printerStatus !== 'none' && <span className="status-dot" data-status={printerStatus} />}
    </button>
  );

  return (
    <aside className="sidebar" aria-label="Print settings">
      <div className="sidebar-scroll">
        <Section title="Printer">
          {devices.length > 0 && (
            <>
              <label className="field-label" htmlFor="device-select">Device</label>
              <select id="device-select" value={selectedDeviceId ?? ''} disabled={isBusy} onChange={(e) => selectDevice(e.target.value)}>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </>
          )}
          <label className="field-label" htmlFor="vendor-select">Brand</label>
          <select id="vendor-select" value={selectedVendor} disabled={isBusy || vendors.length === 0} onChange={(e) => chooseVendor(e.target.value)}>
            <option value="">Select brand...</option>
            {vendors.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
          <PresetRow kind="printer" disabled={isBusy} selectDisabled={isBusy || printers.length === 0} placeholder="Select printer..." system={offeredPrinters} user={user('printer')}
            value={current('printer', selectedPrinter)} onSystem={choosePrinter} extra={connectButton} canEdit={!!selectedPrinter} canSave={!!selectedPrinter} />
          <button className="btn btn-secondary" id="add-printers-btn" style={{ alignSelf: 'flex-start', padding: '2px 10px' }} disabled={isBusy || !selectedVendor} onClick={addPrinters}>Add printers and nozzles...</button>
        </Section>

        <Section title="Filament" headerExtra={filamentHeaderActions}>
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
                      color: '#a1a1aa',
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
                      onChange={(e) => setSlotColor(idx, e.target.value)}
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
                      if (e.target.value.startsWith('user:')) {
                        selectUserPreset('filament', e.target.value.substring(5), idx);
                      } else {
                        chooseFilament(e.target.value, idx);
                      }
                    }}
                  >
                    <option value="">Select filament...</option>
                    {filaments.length > 0 && (
                      <optgroup label="System presets">
                        {filaments.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {user('filament').length > 0 && (
                      <optgroup label="User presets">
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
                    title="Edit filament preset"
                    aria-label="Edit filament preset"
                    disabled={!filamentName || isBusy}
                    onClick={() => openDialog('filament')}
                  >
                    <EditIcon />
                  </button>
                  <button
                    className="icon-btn"
                    id={idx === 0 ? 'save-filament-btn' : `save-filament-btn-${slotNumber}`}
                    data-testid={idx === 0 ? 'save-filament-btn' : `save-filament-btn-${slotNumber}`}
                    title="Save as a user preset"
                    aria-label="Save filament preset"
                    disabled={!filamentName || isBusy}
                    onClick={() => openSavePresetDialog('filament')}
                  >
                    <SaveIcon />
                  </button>
                  <button
                    className="icon-btn"
                    id={idx === 0 ? 'manage-filament-btn' : `manage-filament-btn-${slotNumber}`}
                    data-testid={idx === 0 ? 'manage-filament-btn' : `manage-filament-btn-${slotNumber}`}
                    title="Manage presets, import and export"
                    aria-label="Manage filament presets"
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
                      title="Delete this user preset"
                      aria-label="Delete filament preset"
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

        <Section title="Process">
          <PresetRow kind="process" disabled={isBusy} selectDisabled={isBusy || !selectedPrinter || processes.length === 0} placeholder="Select process..." system={processes} user={user('process')}
            value={current('process', selectedProcess)} onSystem={chooseProcess} canEdit={false} canSave={!!selectedProcess} />
        </Section>

        <QuickToggles disabled={isBusy || !selectedProcess} multiFilament={activeFilaments.length > 1} />

        <Section title="Objects" badge={modelObjects?.length ? String(modelObjects.length) : undefined} className="sb-objects">
          <div className="objects-wrap"><ObjectListPanel /></div>
        </Section>

        <div className="sb-settings"><SettingsPanel /></div>
      </div>

      <div className="sidebar-footer">
        {readyToSend ? (
          <button id="send-to-printer-btn" className="btn-slice" onClick={openSendDialog}>Send to printer</button>
        ) : (
          <button id="slice-btn" className="btn-slice" disabled={!canSlice} onClick={() => startSlice()}>{isSlicing ? 'Slicing...' : 'Slice plate'}</button>
        )}
        <button id="cancel-btn" className="btn-danger-wide" hidden={!isSlicing} disabled={!isSlicing} onClick={() => cancelSlice()}>Cancel</button>
        {sliceResult?.gcode && !isSlicing && (
          <div className="footer-row">
            <button id="export-gcode-btn" className="btn-secondary-wide" onClick={exportGcode}>Export G-code</button>
            {!readyToSend && <button id="send-to-printer-btn" className="btn-secondary-wide" onClick={openSendDialog}>Send to printer</button>}
          </div>
        )}
      </div>
    </aside>
  );
};
