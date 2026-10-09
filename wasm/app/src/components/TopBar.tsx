import React, { useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { ManagePresetsDialog } from '../presets/ManagePresetsDialog';
import { useHistoryStore } from '../history';
import { FlowRateModal, useCalibrationStore } from '../calibration';

export const TopBar: React.FC = () => {
  const {
    vendors,
    selectedVendor,
    chooseVendor,
    printers,
    selectedPrinter,
    choosePrinter,
    processes,
    selectedProcess,
    chooseProcess,
    filaments,
    selectedFilament,
    chooseFilament,
    userPresets,
    activeUserPreset,
    selectUserPreset,
    openDialog,
    openSavePresetDialog,
    openManagePresetsDialog,
    deleteUserPresetAction,
    requestImportFile,
    modelFile,
    isSlicing,
    startSlice,
    cancelSlice,
    isEngineReady
  } = useAppStore();

  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const isRestoring = useHistoryStore((s) => s.isRestoring);
  const isCalibrating = useCalibrationStore((s) => s.isCalibrating);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      requestImportFile(file);
    }
    e.target.value = '';
  };

  const isBusy = isSlicing || isRestoring || isCalibrating;

  const canSlice =
    isEngineReady &&
    !isBusy &&
    !!modelFile &&
    !!selectedPrinter &&
    !!selectedProcess &&
    !!selectedFilament;

  const printerUserPresets = userPresets.filter((p) => p.kind === 'printer');
  const filamentUserPresets = userPresets.filter((p) => p.kind === 'filament');
  const processUserPresets = userPresets.filter((p) => p.kind === 'process');

  const currentPrinterVal = activeUserPreset.printer
    ? `user:${activeUserPreset.printer}`
    : selectedPrinter;
  const currentFilamentVal = activeUserPreset.filament
    ? `user:${activeUserPreset.filament}`
    : selectedFilament;
  const currentProcessVal = activeUserPreset.process
    ? `user:${activeUserPreset.process}`
    : selectedProcess;

  return (
    <header className="orca-topbar">
      <div className="topbar-left">
        <div className="orca-logo">
          <span className="logo-title">OrcaSlicer Web</span>
          <span className="badge">Prepare</span>
        </div>

        {/* Vendor Selector */}
        <div className="selector-group">
          <label htmlFor="vendor-select">Vendor</label>
          <select
            id="vendor-select"
            value={selectedVendor}
            disabled={isBusy || vendors.length === 0}
            onChange={(e) => chooseVendor(e.target.value)}
          >
            <option value="">Select Vendor...</option>
            {vendors.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        {/* Printer Selector */}
        <div className="selector-group">
          <label htmlFor="printer-select">Printer</label>
          <div className="selector-with-actions">
            <select
              id="printer-select"
              data-testid="printer-select"
              value={currentPrinterVal}
              disabled={isBusy || !selectedVendor || printers.length === 0}
              onChange={(e) => {
                const val = e.target.value;
                if (val.startsWith('user:')) {
                  selectUserPreset('printer', val.substring(5));
                } else {
                  choosePrinter(val);
                }
              }}
            >
              <option value="">Select Printer...</option>
              {printers.length > 0 && (
                <optgroup label="System presets">
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {printerUserPresets.length > 0 && (
                <optgroup label="User presets">
                  {printerUserPresets.map((u) => (
                    <option key={u.name} value={`user:${u.name}`}>
                      {u.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              type="button"
              className="btn-icon edit-btn"
              data-testid="edit-printer-btn"
              title="Edit printer settings"
              disabled={!selectedPrinter || isBusy}
              onClick={() => openDialog('printer')}
            >
              ✏️
            </button>
            <button
              type="button"
              className="btn-icon save-btn"
              data-testid="save-printer-btn"
              title="Save as user printer preset"
              disabled={!selectedPrinter || isBusy}
              onClick={() => openSavePresetDialog('printer')}
            >
              💾
            </button>
            <button
              type="button"
              className="btn-icon duplicate-btn"
              data-testid="duplicate-printer-btn"
              title="Duplicate printer preset"
              disabled={!selectedPrinter || isBusy}
              onClick={() => openManagePresetsDialog('printer', 'duplicate')}
            >
              📋
            </button>
            <button
              type="button"
              className="btn-icon manage-btn"
              data-testid="manage-printer-btn"
              title="Manage printer presets"
              disabled={isBusy}
              onClick={() => openManagePresetsDialog('printer')}
            >
              ⚙️
            </button>
            {activeUserPreset.printer && (
              <button
                type="button"
                className="btn-icon delete-btn"
                data-testid="delete-printer-preset-btn"
                title="Delete user preset"
                disabled={isBusy}
                onClick={() => deleteUserPresetAction('printer', activeUserPreset.printer!)}
              >
                🗑️
              </button>
            )}
          </div>
        </div>

        {/* Filament Selector */}
        <div className="selector-group">
          <label htmlFor="filament-select">Filament</label>
          <div className="selector-with-actions">
            <select
              id="filament-select"
              data-testid="filament-select"
              value={currentFilamentVal}
              disabled={isBusy || !selectedPrinter || filaments.length === 0}
              onChange={(e) => {
                const val = e.target.value;
                if (val.startsWith('user:')) {
                  selectUserPreset('filament', val.substring(5));
                } else {
                  chooseFilament(val);
                }
              }}
            >
              <option value="">Select Filament...</option>
              {filaments.length > 0 && (
                <optgroup label="System presets">
                  {filaments.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {filamentUserPresets.length > 0 && (
                <optgroup label="User presets">
                  {filamentUserPresets.map((u) => (
                    <option key={u.name} value={`user:${u.name}`}>
                      {u.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              type="button"
              className="btn-icon edit-btn"
              data-testid="edit-filament-btn"
              title="Edit filament settings"
              disabled={!selectedFilament || isBusy}
              onClick={() => openDialog('filament')}
            >
              ✏️
            </button>
            <button
              type="button"
              className="btn-icon save-btn"
              data-testid="save-filament-btn"
              title="Save as user filament preset"
              disabled={!selectedFilament || isBusy}
              onClick={() => openSavePresetDialog('filament')}
            >
              💾
            </button>
            <button
              type="button"
              className="btn-icon duplicate-btn"
              data-testid="duplicate-filament-btn"
              title="Duplicate filament preset"
              disabled={!selectedFilament || isBusy}
              onClick={() => openManagePresetsDialog('filament', 'duplicate')}
            >
              📋
            </button>
            <button
              type="button"
              className="btn-icon manage-btn"
              data-testid="manage-filament-btn"
              title="Manage filament presets"
              disabled={isBusy}
              onClick={() => openManagePresetsDialog('filament')}
            >
              ⚙️
            </button>
            {activeUserPreset.filament && (
              <button
                type="button"
                className="btn-icon delete-btn"
                data-testid="delete-filament-preset-btn"
                title="Delete user preset"
                disabled={isBusy}
                onClick={() => deleteUserPresetAction('filament', activeUserPreset.filament!)}
              >
                🗑️
              </button>
            )}
          </div>
        </div>

        {/* Process Selector */}
        <div className="selector-group">
          <label htmlFor="process-select">Process</label>
          <div className="selector-with-actions">
            <select
              id="process-select"
              data-testid="process-select"
              value={currentProcessVal}
              disabled={isBusy || !selectedPrinter || processes.length === 0}
              onChange={(e) => {
                const val = e.target.value;
                if (val.startsWith('user:')) {
                  selectUserPreset('process', val.substring(5));
                } else {
                  chooseProcess(val);
                }
              }}
            >
              <option value="">Select Process...</option>
              {processes.length > 0 && (
                <optgroup label="System presets">
                  {processes.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {processUserPresets.length > 0 && (
                <optgroup label="User presets">
                  {processUserPresets.map((u) => (
                    <option key={u.name} value={`user:${u.name}`}>
                      {u.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              type="button"
              className="btn-icon save-btn"
              data-testid="save-process-btn"
              title="Save as user process preset"
              disabled={!selectedProcess || isBusy}
              onClick={() => openSavePresetDialog('process')}
            >
              💾
            </button>
            <button
              type="button"
              className="btn-icon duplicate-btn"
              data-testid="duplicate-process-btn"
              title="Duplicate process preset"
              disabled={!selectedProcess || isBusy}
              onClick={() => openManagePresetsDialog('process', 'duplicate')}
            >
              📋
            </button>
            <button
              type="button"
              className="btn-icon manage-btn"
              data-testid="manage-process-btn"
              title="Manage process presets"
              disabled={isBusy}
              onClick={() => openManagePresetsDialog('process')}
            >
              ⚙️
            </button>
            {activeUserPreset.process && (
              <button
                type="button"
                className="btn-icon delete-btn"
                data-testid="delete-process-preset-btn"
                title="Delete user preset"
                disabled={isBusy}
                onClick={() => deleteUserPresetAction('process', activeUserPreset.process!)}
              >
                🗑️
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="topbar-right">
        {/* Hidden file input for model import */}
        <input
          type="file"
          id="model-file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".stl,.obj,.3mf,.amf,.step,.stp"
          onChange={handleFileChange}
        />
        <button
          id="import-btn"
          className="btn btn-secondary"
          disabled={isBusy}
          onClick={() => fileInputRef.current?.click()}
        >
          📂 Import Model
        </button>
        {/* Flow Rate Calibration button */}
        <button
          id="calibration-btn"
          className="btn btn-secondary"
          data-testid="calibration-btn"
          title="Flow Rate Calibration"
          disabled={isBusy}
          onClick={() => useCalibrationStore.getState().openDialog()}
        >
          📏 Calibration
        </button>

        {/* Undo and Redo TopBar buttons */}
        <button
          id="undo-btn"
          className="btn btn-secondary"
          data-testid="undo-btn"
          title="Undo (Ctrl+Z)"
          disabled={!canUndo || isBusy}
          onClick={() => undo()}
        >
          ↩️ Undo
        </button>
        <button
          id="redo-btn"
          className="btn btn-secondary"
          data-testid="redo-btn"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo || isBusy}
          onClick={() => redo()}
        >
          ↪️ Redo
        </button>

        {/* Slice button */}
        <button
          id="slice-btn"
          className="btn btn-primary"
          disabled={!canSlice}
          onClick={() => startSlice()}
        >
          {isSlicing ? 'Slicing...' : 'Slice'}
        </button>

        {/* Cancel button */}
        <button
          id="cancel-btn"
          className="btn btn-danger"
          disabled={!isSlicing}
          onClick={() => cancelSlice()}
        >
          Cancel
        </button>
      </div>

      {/* Local Preset Management Dialog */}
      <ManagePresetsDialog />
      {/* Flow Rate Calibration Modal */}
      <FlowRateModal />
    </header>
  );
};
