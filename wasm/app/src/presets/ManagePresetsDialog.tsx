import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { PresetInheritance } from './PresetInheritance';
import type { PresetKind, ConflictStrategy } from './types';
import { exportPresetBundle, downloadPresetBundle, BUNDLE_BOUNDARY_NOTE } from './presetBundle';
import { exportDesktopPresetsZip, downloadBinaryArchive } from './presetArchive';
import { ModalBackdrop } from '../components/ModalBackdrop';
import { useTranslation } from "../i18n";

export const ManagePresetsDialog: React.FC = () => {
    const { t } = useTranslation();
  const {
    managePresetsDialogTarget,
    closeManagePresetsDialog,
    userPresets,
    processes,
    filaments,
    printers,
    activeUserPreset,
    selectedProcess,
    selectedFilament,
    selectedPrinter,
    isSelectingPreset,
    duplicateUserPresetAction,
    renameUserPresetAction,
    deleteUserPresetAction,
    importPresetBundleAction,
    exportDesktopArchiveAction
  } = useAppStore();

  const [activeKind, setActiveKind] = useState<PresetKind>('process');
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [duplicateName, setDuplicateName] = useState<string>('');
  const [renameName, setRenameName] = useState<string>('');
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('overwrite');
  const [bundleJsonText, setBundleJsonText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (managePresetsDialogTarget) {
      const kind = managePresetsDialogTarget.kind;
      setActiveKind(kind);
      setError(null);
      setSuccessMsg(null);
      setDuplicateName('');
      setRenameName('');
      setBundleJsonText('');

      const activeName =
        managePresetsDialogTarget.targetPresetName ||
        activeUserPreset[kind] ||
        (kind === 'process' ? selectedProcess : kind === 'filament' ? selectedFilament : selectedPrinter);

      setSelectedPreset(activeName || '');
    }
  }, [managePresetsDialogTarget]);

  if (!managePresetsDialogTarget) return null;

  const currentSystemPresets =
    activeKind === 'process' ? processes : activeKind === 'filament' ? filaments : printers;
  const currentUserPresets = userPresets.filter((p) => p.kind === activeKind);
  const isSelectedUserPreset = currentUserPresets.some((p) => p.name === selectedPreset);

  const handleKindChange = (kind: PresetKind) => {
    setActiveKind(kind);
    setError(null);
    setSuccessMsg(null);
    setDuplicateName('');
    setRenameName('');
    const activeName =
      activeUserPreset[kind] ||
      (kind === 'process' ? selectedProcess : kind === 'filament' ? selectedFilament : selectedPrinter);
    setSelectedPreset(activeName || '');
  };

  const handleDuplicate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const trimmed = duplicateName.trim();
    if (!trimmed) {
      setError('Preset name cannot be empty.');
      return;
    }
    if (trimmed === selectedPreset) {
      setError('Copying requires a distinct name.');
      return;
    }
    if (currentSystemPresets.some((p) => p.name === trimmed)) {
      setError(`Cannot overwrite immutable system preset "${trimmed}".`);
      return;
    }
    if (currentUserPresets.some((p) => p.name === trimmed)) {
      setError(`A preset named "${trimmed}" already exists.`);
      return;
    }

    try {
      await duplicateUserPresetAction(activeKind, selectedPreset, trimmed);
      setSelectedPreset(trimmed);
      setDuplicateName('');
      setError(null);
      setSuccessMsg(`Preset duplicated successfully as "${trimmed}".`);
    } catch (err: any) {
      setError(err.message || 'Failed to duplicate preset.');
    }
  };

  const handleRename = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const trimmed = renameName.trim();
    if (!trimmed) {
      setError('Preset name cannot be empty.');
      return;
    }
    if (trimmed === selectedPreset) {
      return;
    }
    if (currentSystemPresets.some((p) => p.name === trimmed)) {
      setError(`Cannot overwrite immutable system preset "${trimmed}".`);
      return;
    }
    if (currentUserPresets.some((p) => p.name === trimmed)) {
      setError(`A preset named "${trimmed}" already exists.`);
      return;
    }
    if (!isSelectedUserPreset) {
      setError('Cannot rename immutable system preset.');
      return;
    }

    try {
      await renameUserPresetAction(activeKind, selectedPreset, trimmed);
      setSelectedPreset(trimmed);
      setRenameName('');
      setError(null);
      setSuccessMsg(`Preset renamed successfully to "${trimmed}".`);
    } catch (err: any) {
      setError(err.message || 'Failed to rename preset.');
    }
  };

  const handleDelete = async () => {
    if (!isSelectedUserPreset) {
      setError('Cannot delete immutable system preset.');
      return;
    }

    setError(null);
    setSuccessMsg(null);

    try {
      await deleteUserPresetAction(activeKind, selectedPreset);
      setError(null);
      setSuccessMsg(`Preset "${selectedPreset}" deleted.`);
      const remainingUser = userPresets.filter((p) => p.kind === activeKind && p.name !== selectedPreset);
      if (remainingUser.length > 0) {
        setSelectedPreset(remainingUser[0].name);
      } else {
        const defaultSys = currentSystemPresets[0]?.name || '';
        setSelectedPreset(defaultSys);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete preset.');
    }
  };

  const handleExportBundle = () => {
    setError(null);
    setSuccessMsg(null);
    try {
      const bundle = exportPresetBundle(userPresets);
      downloadPresetBundle(bundle);
      setSuccessMsg(`Preset bundle exported with ${bundle.presets.length} preset(s).`);
    } catch (err: any) {
      setError(`Failed to export bundle: ${err.message || String(err)}`);
    }
  };

  const handleExportArchive = async (kind: 'printer' | 'filament') => {
    setError(null);
    setSuccessMsg(null);
    try {
      const data = await exportDesktopArchiveAction(kind, selectedPreset);
      const fileName = `${selectedPreset}.orca_${kind}`;
      downloadBinaryArchive(data, fileName);
      setSuccessMsg(`Exported "${fileName}".`);
    } catch (err: any) {
      setError(`Failed to export ${kind} archive: ${err.message || String(err)}`);
    }
  };

  const handleExportZipArchive = () => {
    setError(null);
    setSuccessMsg(null);
    try {
      if (userPresets.length === 0) {
        setError('No user presets to export.');
        return;
      }
      const data = exportDesktopPresetsZip(userPresets);
      downloadBinaryArchive(data, 'OrcaSlicer_User_Presets.zip');
      setSuccessMsg(`Presets archive exported with ${userPresets.length} preset(s).`);
    } catch (err: any) {
      setError(`Failed to export zip archive: ${err.message || String(err)}`);
    }
  };

  const executeImport = async (inputData: unknown) => {
    setError(null);
    setSuccessMsg(null);
    try {
      const result = await importPresetBundleAction(inputData, conflictStrategy);
      setSuccessMsg(result.message);
      setBundleJsonText('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: any) {
      setError(err.message || 'Failed to import bundle.');
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const isBinary =
        file.name.endsWith('.orca_printer') ||
        file.name.endsWith('.orca_filament') ||
        file.name.endsWith('.orca_bundle') ||
        file.name.endsWith('.zip');

      if (isBinary) {
        const buffer = await file.arrayBuffer();
        await executeImport(new Uint8Array(buffer));
      } else {
        const text = await file.text();
        await executeImport(text);
      }
    } catch (err: any) {
      setError(`Failed to read file: ${err.message || String(err)}`);
    }
  };

  const handleJsonImport = async () => {
    if (!bundleJsonText.trim()) {
      setError('Bundle JSON content cannot be empty.');
      return;
    }
    await executeImport(bundleJsonText);
  };

  return (
    <ModalBackdrop onClose={closeManagePresetsDialog} data-testid="manage-presets-dialog">
      <div
        className="modal-box preset-modal"
        style={{
          width: 580,
          maxWidth: '92vw',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div className="modal-header">
          <div className="modal-title">{t("Manage Presets")}</div>
          <button
            type="button"
            className="modal-close-btn"
            data-testid="manage-preset-close-btn"
            onClick={closeManagePresetsDialog}
            aria-label={t("Close Manage Presets dialog")}
          >
            ✕
          </button>
        </div>

        {/* Kind Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--control-bg)',
            background: 'var(--panel-bg)'
          }}
        >
          {(['process', 'filament', 'printer'] as PresetKind[]).map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`manage-tab-${k}`}
              disabled={isSelectingPreset}
              onClick={() => handleKindChange(k)}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: activeKind === k ? 'var(--canvas-bg)' : 'transparent',
                color: activeKind === k ? '#38bdf8' : 'var(--text-muted)',
                border: 'none',
                borderBottom: activeKind === k ? '2px solid #38bdf8' : 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
                textTransform: 'capitalize'
              }}
            >
              {k} {t("Presets")}</button>
          ))}
        </div>

        <div
          className="modal-body"
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            padding: 16
          }}
        >
          {error && (
            <div
              className="preset-error-banner"
              data-testid="preset-error-msg"
              style={{
                color: '#f87171',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 4,
                padding: '8px 12px',
                fontSize: '0.85rem'
              }}
            >
              {error}
            </div>
          )}

          {successMsg && (
            <div
              className="preset-success-banner"
              data-testid="preset-success-msg"
              style={{
                color: '#4ade80',
                background: 'rgba(74, 222, 128, 0.15)',
                border: '1px solid rgba(74, 222, 128, 0.3)',
                borderRadius: 4,
                padding: '8px 12px',
                fontSize: '0.85rem'
              }}
            >
              {successMsg}
            </div>
          )}

          <PresetInheritance kind={activeKind} name={selectedPreset} />
          {/* Preset Selector / List */}
          <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="manage-preset-target-select" style={{ fontSize: '0.85rem', color: 'var(--text-color)', fontWeight: 500 }}>
              {t("Select Preset to Manage:")}</label>
            <select
              id="manage-preset-target-select"
              data-testid="manage-preset-select"
              disabled={isSelectingPreset}
              className="form-control"
              value={selectedPreset}
              onChange={(e) => {
                setSelectedPreset(e.target.value);
                setError(null);
                setSuccessMsg(null);
                setRenameName(e.target.value);
              }}
              style={{
                background: 'var(--panel-bg)',
                color: 'var(--text-color)',
                border: '1px solid var(--border-color)',
                padding: '6px 10px',
                borderRadius: 4,
                fontSize: '0.9rem'
              }}
            >
              {currentUserPresets.length > 0 && (
                <optgroup label={t("User Presets (Editable)")}>
                  {currentUserPresets.map((u) => (
                    <option key={u.name} value={u.name}>
                      {u.name} {activeUserPreset[activeKind] === u.name ? '★ [Active]' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {currentSystemPresets.length > 0 && (
                <optgroup label={t("System Presets (Immutable)")}>
                  {currentSystemPresets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} {t("[System]")}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {t("Status:")}{' '}
              {isSelectedUserPreset ? (
                <span style={{ color: '#38bdf8', fontWeight: 500 }}>{t("User Preset (Customizable)")}</span>
              ) : (
                <span style={{ color: '#eab308', fontWeight: 500 }}>{t("System Preset (Read-Only)")}</span>
              )}
            </div>
          </div>

          {/* Duplicate Section */}
          <div
            style={{
              background: 'var(--panel-bg)',
              padding: 12,
              borderRadius: 6,
              border: '1px solid var(--control-bg)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-color)' }}>
              {t("Duplicate Preset")}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {t("Create an editable copy of")}<strong>{selectedPreset || 'selected preset'}</strong> {t("preserving all base values.")}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                data-testid="duplicate-preset-input"
                disabled={isSelectingPreset}
                className="form-control"
                placeholder={t("Name for duplicate copy...")}
                value={duplicateName}
                onChange={(e) => {
                  setDuplicateName(e.target.value);
                  if (error) setError(null);
                  if (successMsg) setSuccessMsg(null);
                }}
                style={{
                  flex: 1,
                  background: 'var(--canvas-bg)',
                  color: '#fff',
                  border: '1px solid var(--border-color)',
                  padding: '5px 8px',
                  borderRadius: 4,
                  fontSize: '0.85rem'
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                data-testid="duplicate-preset-confirm-btn"
                disabled={isSelectingPreset || !duplicateName.trim()}
                onClick={handleDuplicate}
                style={{ whiteSpace: 'nowrap' }}
              >
                {t("Duplicate")}</button>
            </div>
          </div>

          {/* Rename Section (User presets only) */}
          {isSelectedUserPreset && (
            <div
              style={{
                background: 'var(--panel-bg)',
                padding: 12,
                borderRadius: 6,
                border: '1px solid var(--control-bg)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-color)' }}>
                {t("Rename User Preset")}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {t("Change the name of")}<strong>{selectedPreset}</strong>{t(". Active selection will be retained.")}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  data-testid="rename-preset-input"
                  disabled={isSelectingPreset}
                  className="form-control"
                  placeholder={t("New preset name...")}
                  value={renameName}
                  onChange={(e) => {
                    setRenameName(e.target.value);
                    if (error) setError(null);
                    if (successMsg) setSuccessMsg(null);
                  }}
                  style={{
                    flex: 1,
                    background: 'var(--canvas-bg)',
                    color: '#fff',
                    border: '1px solid var(--border-color)',
                    padding: '5px 8px',
                    borderRadius: 4,
                    fontSize: '0.85rem'
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="rename-preset-confirm-btn"
                  disabled={isSelectingPreset || !renameName.trim() || renameName.trim() === selectedPreset}
                  onClick={handleRename}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {t("Rename")}</button>
              </div>
            </div>
          )}

          {/* Delete Section (User presets only) */}
          {isSelectedUserPreset && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: 6
              }}
            >
              <div style={{ fontSize: '0.82rem', color: '#fca5a5' }}>
                {t("Delete this user preset permanently")}</div>
              <button
                type="button"
                className="btn btn-danger"
                data-testid="delete-preset-confirm-btn"
                disabled={isSelectingPreset}
                onClick={handleDelete}
                style={{ fontSize: '0.82rem', padding: '4px 10px' }}
              >
                {t("Delete Preset")}</button>
            </div>
          )}

          {/* Preset Bundles Section */}
          <div
            style={{
              background: 'var(--panel-bg)',
              padding: 12,
              borderRadius: 6,
              border: '1px solid var(--control-bg)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-color)' }}>
                {t("Preset Bundles & Archives (Import & Export)")}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="export-bundle-btn"
                  disabled={isSelectingPreset}
                  onClick={handleExportBundle}
                  style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                  aria-label={t("Export all user presets to bundle JSON")}
                >
                  {t("Export Bundle JSON")}</button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="export-desktop-printer-btn"
                  onClick={() => handleExportArchive('printer')}
                  disabled={isSelectingPreset || activeKind !== 'printer' || !isSelectedUserPreset}
                  style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                  aria-label={t("Export printer preset archive")}
                >
                  {t("Export .orca_printer")}</button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="export-desktop-filament-btn"
                  onClick={() => handleExportArchive('filament')}
                  disabled={isSelectingPreset || activeKind !== 'filament' || !isSelectedUserPreset}
                  style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                  aria-label={t("Export filament preset archive")}
                >
                  {t("Export .orca_filament")}</button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="export-desktop-zip-btn"
                  disabled={isSelectingPreset}
                  onClick={handleExportZipArchive}
                  style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                  aria-label={t("Export all presets as zip archive")}
                >
                  {t("Export .zip")}</button>
              </div>
            </div>

            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {t("Import and export presets in native OrcaSlicer formats (.orca_printer, .orca_filament, .zip, .json, .ini) or web bundles. System presets remain immutable.")}</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label
                htmlFor="bundle-conflict-strategy"
                style={{ fontSize: '0.8rem', color: 'var(--text-color)', fontWeight: 500 }}
              >
                {t("Conflict Resolution Strategy for Existing Presets:")}</label>
              <select
                id="bundle-conflict-strategy"
                data-testid="bundle-conflict-strategy"
                disabled={isSelectingPreset}
                className="form-control"
                value={conflictStrategy}
                onChange={(e) => setConflictStrategy(e.target.value as ConflictStrategy)}
                aria-label={t("Conflict resolution strategy")}
                style={{
                  background: 'var(--canvas-bg)',
                  color: '#fff',
                  border: '1px solid var(--border-color)',
                  padding: '5px 8px',
                  borderRadius: 4,
                  fontSize: '0.85rem'
                }}
              >
                <option value="overwrite">{t("Overwrite existing presets")}</option>
                <option value="rename">{t("Rename imported presets on conflict")}</option>
                <option value="skip">{t("Skip existing presets")}</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="file"
                ref={fileInputRef}
                id="bundle-file-input"
                data-testid="bundle-file-input"
                disabled={isSelectingPreset}
                accept=".json,.ini,.zip,.orca_printer,.orca_filament,.orca_bundle,application/json"
                onChange={handleFileImport}
                aria-label={t("Import preset bundle file")}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                className="btn btn-primary"
                data-testid="import-bundle-btn"
                disabled={isSelectingPreset}
                onClick={() => fileInputRef.current?.click()}
                style={{ fontSize: '0.85rem', padding: '6px 12px' }}
                aria-label={t("Choose preset bundle or archive file to import")}
              >
                {t("Import Archive / Preset File...")}</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label
                htmlFor="bundle-json-textarea"
                style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}
              >
                {t("Or paste bundle JSON, preset JSON, or INI directly:")}</label>
              <textarea
                id="bundle-json-textarea"
                data-testid="bundle-json-textarea"
                disabled={isSelectingPreset}
                aria-label={t("Paste bundle JSON or INI content")}
                placeholder={t("{\"format\":\"orcaslicer-web-preset-bundle\",\"version\":1,\"presets\":[...]} or preset JSON / INI")}
                value={bundleJsonText}
                onChange={(e) => {
                  setBundleJsonText(e.target.value);
                  if (error) setError(null);
                  if (successMsg) setSuccessMsg(null);
                }}
                className="form-control"
                style={{
                  width: '100%',
                  minHeight: 60,
                  maxHeight: 120,
                  background: 'var(--canvas-bg)',
                  color: '#fff',
                  border: '1px solid var(--border-color)',
                  padding: '6px 8px',
                  borderRadius: 4,
                  fontSize: '0.8rem',
                  fontFamily: 'monospace',
                  resize: 'vertical'
                }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="import-bundle-json-btn"
                disabled={isSelectingPreset || !bundleJsonText.trim()}
                onClick={handleJsonImport}
                style={{ alignSelf: 'flex-start', fontSize: '0.8rem', padding: '4px 10px' }}
              >
                {t("Import Pasted Content")}</button>
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic', marginTop: 2 }}>
              {t("Supported formats: .orca_printer, .orca_filament, .zip, .json, .ini (")}{BUNDLE_BOUNDARY_NOTE})
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid var(--control-bg)', padding: 12 }}>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="manage-preset-done-btn"
            onClick={closeManagePresetsDialog}
          >
            {t("Done")}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
};
