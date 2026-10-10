import React, { useState } from 'react';
import { useHistoryStore } from '../history';
import { ObjectListPanel } from '../objectlist/ObjectListPanel';
import { usePrinterConnectionStore } from '../printers/connectionStore';
import { SettingsPanel } from '../settings/SettingsPanel';
import { useAppStore } from '../store/appStore';
import type { PresetKind } from '../presets/types';
import { exportGcode } from './exportGcode';
import { EditIcon, GearIcon, PlugIcon, SaveIcon, TrashIcon } from './glyphs';

const Section: React.FC<{ title: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean; className?: string }> = ({ title, badge, children, defaultOpen = true, className = '' }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`sb-section ${open ? '' : 'closed'} ${className}`}>
      <div className="sb-head" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen(!open)}>
        <span className="chev">▼</span>
        <span className="grow">{title}</span>
        {badge && <span className="badge">{badge}</span>}
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

export const PrepareSidebar: React.FC = () => {
  const {
    vendors, selectedVendor, chooseVendor, printers, selectedPrinter, choosePrinter,
    processes, selectedProcess, chooseProcess, filaments, selectedFilament, chooseFilament,
    userPresets, activeUserPreset, isSlicing, isModelLoading, startSlice, cancelSlice, isEngineReady, modelFile, sliceResult, modelObjects
  } = useAppStore();
  const isRestoring = useHistoryStore((s) => s.isRestoring);
  const printerStatus = usePrinterConnectionStore((s) => s.status);
  const printerCount = usePrinterConnectionStore((s) => s.printers.length);
  const openSendDialog = usePrinterConnectionStore((s) => s.openSendDialog);

  const isBusy = isSlicing || isModelLoading || isRestoring;
  const canSlice = isEngineReady && !isBusy && !!modelFile && !!selectedPrinter && !!selectedProcess && !!selectedFilament;
  const user = (kind: PresetKind) => userPresets.filter((p) => p.kind === kind);
  const current = (kind: PresetKind, system: string) => (activeUserPreset[kind] ? `user:${activeUserPreset[kind]}` : system);

  const connectButton = (
    <button id="printer-connection-btn" className="icon-btn" title={printerCount ? 'Printer connection' : 'Connect a printer'} aria-label="Connect printer" onClick={() => usePrinterConnectionStore.getState().openDialog(null)}>
      <PlugIcon />{printerStatus !== 'none' && <span className="status-dot" data-status={printerStatus} />}
    </button>
  );

  return (
    <aside className="sidebar" aria-label="Print settings">
      <div className="sidebar-scroll">
        <Section title="Printer">
          <label className="field-label" htmlFor="vendor-select">Vendor</label>
          <select id="vendor-select" value={selectedVendor} disabled={isBusy || vendors.length === 0} onChange={(e) => chooseVendor(e.target.value)}>
            <option value="">Select vendor...</option>
            {vendors.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
          <PresetRow kind="printer" disabled={isBusy} selectDisabled={isBusy || printers.length === 0} placeholder="Select printer..." system={printers} user={user('printer')}
            value={current('printer', selectedPrinter)} onSystem={choosePrinter} extra={connectButton} canEdit={!!selectedPrinter} canSave={!!selectedPrinter} />
        </Section>

        <Section title="Filament">
          <PresetRow kind="filament" disabled={isBusy} selectDisabled={isBusy || !selectedPrinter || filaments.length === 0} placeholder="Select filament..." system={filaments} user={user('filament')}
            value={current('filament', selectedFilament)} onSystem={chooseFilament} canEdit={!!selectedFilament} canSave={!!selectedFilament} />
        </Section>

        <Section title="Process">
          <PresetRow kind="process" disabled={isBusy} selectDisabled={isBusy || !selectedPrinter || processes.length === 0} placeholder="Select process..." system={processes} user={user('process')}
            value={current('process', selectedProcess)} onSystem={chooseProcess} canEdit={false} canSave={!!selectedProcess} />
        </Section>

        <Section title="Objects" badge={modelObjects?.length ? String(modelObjects.length) : undefined} className="sb-objects">
          <div className="objects-wrap"><ObjectListPanel /></div>
        </Section>

        <div className="sb-settings"><SettingsPanel /></div>
      </div>

      <div className="sidebar-footer">
        <button id="slice-btn" className="btn-slice" disabled={!canSlice} onClick={() => startSlice()}>{isSlicing ? 'Slicing...' : 'Slice plate'}</button>
        <button id="cancel-btn" className="btn-danger-wide" hidden={!isSlicing} disabled={!isSlicing} onClick={() => cancelSlice()}>Cancel</button>
        {sliceResult?.gcode && !isSlicing && (
          <div className="footer-row">
            <button id="export-gcode-btn" className="btn-secondary-wide" onClick={exportGcode}>Export G-code</button>
            <button id="send-to-printer-btn" className="btn-secondary-wide" onClick={openSendDialog}>Send to printer</button>
          </div>
        )}
      </div>
    </aside>
  );
};
