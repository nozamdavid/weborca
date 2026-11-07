import './ManagePresetsDialog.css';
import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { PresetInheritance } from './PresetInheritance';
import type { PresetKind, ConflictStrategy } from './types';
import { exportPresetBundle, downloadPresetBundle, BUNDLE_BOUNDARY_NOTE } from './presetBundle';
import { exportDesktopPresetsZip, downloadBinaryArchive } from './presetArchive';
import { Dialog } from "../components/Dialog";
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
    <Dialog className="ds-scrim" role="dialog" aria-modal="true" aria-label={t("Manage Presets")} onClose={closeManagePresetsDialog} data-testid="manage-presets-dialog">
      <div
        className="ds-dialog manage-presets-panel"
      >
        <div className="ds-dialog__head">
          <h2 className="ds-title ds-title--dialog">{t("Manage Presets")}</h2>
          <button
            type="button"
            className="ds-icon-btn"
            data-testid="manage-preset-close-btn"
            onClick={closeManagePresetsDialog}
            aria-label={t("Close Manage Presets dialog")}
          >
            ✕
          </button>
        </div>

        {/* Kind Tabs */}
        <div
          className="manage-presets-panel__tabs"
        >
          {(['process', 'filament', 'printer'] as PresetKind[]).map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`manage-tab-${k}`}
              disabled={isSelectingPreset}
              onClick={() => handleKindChange(k)}
              className={["ds-btn managepresets-dialog__button-38", (activeKind === k  ? "managepresets-dialog__state-32" : "managepresets-dialog__state-33"), (activeKind === k  ? "managepresets-dialog__state-34" : "managepresets-dialog__state-35"), (activeKind === k  ? "managepresets-dialog__state-36" : "managepresets-dialog__state-37")].join(" ")}
            >
              {t(k.charAt(0).toUpperCase() + k.slice(1))} {t("Presets")}</button>
          ))}
        </div>

        <div
          className="ds-dialog__body managepresets-dialog__row-31"
        >
          {error && (
            <div
              data-testid="preset-error-msg"
              className="preset-error-banner managepresets-dialog__card-30"
            >
              {t(error)}
            </div>
          )}

          {successMsg && (
            <div
              data-testid="preset-success-msg"
              className="preset-success-banner managepresets-dialog__card-29"
            >
              {t(successMsg)}
            </div>
          )}

          <PresetInheritance kind={activeKind} name={selectedPreset} />
          {/* Preset Selector / List */}
          <div className="form-group managepresets-dialog__row-12">
            <label htmlFor="manage-preset-target-select" className="managepresets-dialog__label-28">
              {t("Select Preset to Manage:")}</label>
            <select
              id="manage-preset-target-select"
              data-testid="manage-preset-select"
              disabled={isSelectingPreset}
              value={selectedPreset}
              onChange={(e) => {
                setSelectedPreset(e.target.value);
                setError(null);
                setSuccessMsg(null);
                setRenameName(e.target.value);
              }}
              className="ds-input managepresets-dialog__select-27"
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
            <div className="managepresets-dialog__label-5">
              {t("Status:")}{' '}
              {isSelectedUserPreset ? (
                <span className="managepresets-dialog__span-26">{t("User Preset (Customizable)")}</span>
              ) : (
                <span className="managepresets-dialog__span-25">{t("System Preset (Read-Only)")}</span>
              )}
            </div>
          </div>

          {/* Duplicate Section */}
          <div
            className="managepresets-dialog__row-24"
          >
            <div className="managepresets-dialog__div-15">
              {t("Duplicate Preset")}</div>
            <div className="managepresets-dialog__label-5">
              {t("Create an editable copy of")}<strong>{selectedPreset || t('Preset')}</strong> {t("preserving all base values.")}</div>
            <div className="managepresets-dialog__row-23">
              <input
                type="text"
                data-testid="duplicate-preset-input"
                disabled={isSelectingPreset}
                placeholder={t("Name for duplicate copy...")}
                value={duplicateName}
                onChange={(e) => {
                  setDuplicateName(e.target.value);
                  if (error) setError(null);
                  if (successMsg) setSuccessMsg(null);
                }}
                className="ds-input managepresets-dialog__input-22"
              />
              <button
                type="button"
                data-testid="duplicate-preset-confirm-btn"
                disabled={isSelectingPreset || !duplicateName.trim()}
                onClick={handleDuplicate}
                className="ds-btn ds-btn--primary managepresets-dialog__button-21"
              >
                {t("Duplicate")}</button>
            </div>
          </div>

          {/* Rename Section (User presets only) */}
          {isSelectedUserPreset && (
            <div
              className="managepresets-dialog__row-24"
            >
              <div className="managepresets-dialog__div-15">
                {t("Rename User Preset")}</div>
              <div className="managepresets-dialog__label-5">
                {t("Change the name of")}<strong>{selectedPreset}</strong>{t(". Active selection will be retained.")}</div>
              <div className="managepresets-dialog__row-23">
                <input
                  type="text"
                  data-testid="rename-preset-input"
                  disabled={isSelectingPreset}
                  placeholder={t("New preset name...")}
                  value={renameName}
                  onChange={(e) => {
                    setRenameName(e.target.value);
                    if (error) setError(null);
                    if (successMsg) setSuccessMsg(null);
                  }}
                  className="ds-input managepresets-dialog__input-22"
                />
                <button
                  type="button"
                  data-testid="rename-preset-confirm-btn"
                  disabled={isSelectingPreset || !renameName.trim() || renameName.trim() === selectedPreset}
                  onClick={handleRename}
                  className="ds-btn managepresets-dialog__button-21"
                >
                  {t("Rename")}</button>
              </div>
            </div>
          )}

          {/* Delete Section (User presets only) */}
          {isSelectedUserPreset && (
            <div
              className="managepresets-dialog__row-20"
            >
              <div className="managepresets-dialog__div-19">
                {t("Delete this user preset permanently")}</div>
              <button
                type="button"
                data-testid="delete-preset-confirm-btn"
                disabled={isSelectingPreset}
                onClick={handleDelete}
                className="ds-btn ds-btn--danger managepresets-dialog__button-18"
              >
                {t("Delete Preset")}</button>
            </div>
          )}

          {/* Preset Bundles Section */}
          <div
            className="managepresets-dialog__row-17"
          >
            <div className="managepresets-dialog__row-16">
              <div className="managepresets-dialog__div-15">
                {t("Preset Bundles & Archives (Import & Export)")}</div>
              <div className="managepresets-dialog__row-14">
                <button
                  type="button"
                  data-testid="export-bundle-btn"
                  disabled={isSelectingPreset}
                  onClick={handleExportBundle}
                  className="ds-btn managepresets-dialog__button-13"
                  aria-label={t("Export all user presets to bundle JSON")}
                >
                  {t("Export Bundle JSON")}</button>
                <button
                  type="button"
                  data-testid="export-desktop-printer-btn"
                  onClick={() => handleExportArchive('printer')}
                  disabled={isSelectingPreset || activeKind !== 'printer' || !isSelectedUserPreset}
                  className="ds-btn managepresets-dialog__button-13"
                  aria-label={t("Export printer preset archive")}
                >
                  {t("Export .orca_printer")}</button>
                <button
                  type="button"
                  data-testid="export-desktop-filament-btn"
                  onClick={() => handleExportArchive('filament')}
                  disabled={isSelectingPreset || activeKind !== 'filament' || !isSelectedUserPreset}
                  className="ds-btn managepresets-dialog__button-13"
                  aria-label={t("Export filament preset archive")}
                >
                  {t("Export .orca_filament")}</button>
                <button
                  type="button"
                  data-testid="export-desktop-zip-btn"
                  disabled={isSelectingPreset}
                  onClick={handleExportZipArchive}
                  className="ds-btn managepresets-dialog__button-13"
                  aria-label={t("Export all presets as zip archive")}
                >
                  {t("Export .zip")}</button>
              </div>
            </div>

            <div className="managepresets-dialog__label-5">
              {t("Import and export presets in native OrcaSlicer formats (.orca_printer, .orca_filament, .zip, .json, .ini) or web bundles. System presets remain immutable.")}</div>

            <div className="managepresets-dialog__row-12">
              <label
                htmlFor="bundle-conflict-strategy"
                className="managepresets-dialog__label-11"
              >
                {t("Conflict Resolution Strategy for Existing Presets:")}</label>
              <select
                id="bundle-conflict-strategy"
                data-testid="bundle-conflict-strategy"
                disabled={isSelectingPreset}
                value={conflictStrategy}
                onChange={(e) => setConflictStrategy(e.target.value as ConflictStrategy)}
                aria-label={t("Conflict resolution strategy")}
                className="ds-input managepresets-dialog__select-10"
              >
                <option value="overwrite">{t("Overwrite existing presets")}</option>
                <option value="rename">{t("Rename imported presets on conflict")}</option>
                <option value="skip">{t("Skip existing presets")}</option>
              </select>
            </div>

            <div className="managepresets-dialog__row-9">
              <input
                type="file"
                ref={fileInputRef}
                id="bundle-file-input"
                data-testid="bundle-file-input"
                disabled={isSelectingPreset}
                accept=".json,.ini,.zip,.orca_printer,.orca_filament,.orca_bundle,application/json"
                onChange={handleFileImport}
                aria-label={t("Import preset bundle file")}
                className="managepresets-dialog__input-8"
              />
              <button
                type="button"
                data-testid="import-bundle-btn"
                disabled={isSelectingPreset}
                onClick={() => fileInputRef.current?.click()}
                className="ds-btn ds-btn--primary managepresets-dialog__button-7"
                aria-label={t("Choose preset bundle or archive file to import")}
              >
                {t("Import Archive / Preset File...")}</button>
            </div>

            <div className="managepresets-dialog__row-6">
              <label
                htmlFor="bundle-json-textarea"
                className="managepresets-dialog__label-5"
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
                className="ds-input managepresets-dialog__textarea-4"
              />
              <button
                type="button"
                data-testid="import-bundle-json-btn"
                disabled={isSelectingPreset || !bundleJsonText.trim()}
                onClick={handleJsonImport}
                className="ds-btn managepresets-dialog__button-3"
              >
                {t("Import Pasted Content")}</button>
            </div>

            <div className="managepresets-dialog__div-2">
              {t("Supported formats: .orca_printer, .orca_filament, .zip, .json, .ini (")}{BUNDLE_BOUNDARY_NOTE})
            </div>
          </div>
        </div>

        <div className="ds-dialog__foot managepresets-dialog__div-1">
          <button
            type="button"
            className="ds-btn"
            data-testid="manage-preset-done-btn"
            onClick={closeManagePresetsDialog}
          >
            {t("Done")}</button>
        </div>
      </div>
    </Dialog>
  );
};
