import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { Dialog } from '../components/Dialog';
import { useTranslation } from "../i18n";

export const SavePresetDialog: React.FC = () => {
    const { t } = useTranslation();
  const {
    savePresetDialogTarget,
    closeSavePresetDialog,
    saveCurrentUserPreset,
    userPresets,
    processes,
    filaments,
    printers,
    activeUserPreset,
    activeFilamentSlot,
    selectedFilaments
  } = useAppStore();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);

  useEffect(() => {
    setName(savePresetDialogTarget?.baseName || '');
    setError(null);
  }, [savePresetDialogTarget]);

  if (!savePresetDialogTarget) return null;

  const { kind, baseName } = savePresetDialogTarget;
  const activeName = kind === 'filament' ? selectedFilaments[activeFilamentSlot] : activeUserPreset[kind];
  const overwriting = name.trim() === activeName && userPresets.some(p => p.kind === kind && p.name === activeName);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Preset name cannot be empty.');
      return;
    }

    // Check system preset collision
    const systemList = kind === 'process' ? processes : kind === 'filament' ? filaments : printers;
    if (systemList.some((s) => s.name === trimmed)) {
      setError(`Cannot overwrite immutable system preset "${trimmed}".`);
      return;
    }

    // Check user preset collision with a different preset
    const collision = userPresets.find((u) => u.kind === kind && u.name === trimmed);
    const activeName = kind === 'filament' ? selectedFilaments[activeFilamentSlot] : activeUserPreset[kind];
    if (collision && activeName !== trimmed) {
      setError(`A preset named "${trimmed}" already exists.`);
      return;
    }

    setSaving(true);
    try {
      await saveCurrentUserPreset(kind, trimmed);
      setName('');
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save preset.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (isSaving) return;
    setName('');
    setError(null);
    closeSavePresetDialog();
  };

  return (
    <Dialog onClose={handleClose} dirty={name !== baseName} dirtyWhat="preset name" data-testid="save-preset-dialog">
      <div className="modal-box ds-dialog preset-modal">
        <form onSubmit={handleSubmit}>
          <div className="modal-header ds-dialog__head">
            <h2 className="modal-title ds-title--dialog">{t("Save Preset")}</h2>
            <button
              type="button"
              className="modal-close-btn"
              data-testid="save-preset-cancel-btn"
              onClick={handleClose}
              disabled={isSaving}
            >
              ✕
            </button>
          </div>

          <div className="modal-body ds-dialog__body">
            <p className="preset-dialog-hint">
              {t("Based on:")}<strong>{baseName}</strong>
            </p>
            {error && (
              <div
                className="preset-error-banner"
                data-testid="preset-error-msg"
                style={{
                  color: 'var(--danger-fg)',
                  background: 'var(--danger-bg)',
                  border: '1px solid var(--danger-border)',
                  borderRadius: 4,
                  padding: '6px 10px',
                  marginBottom: 12,
                  fontSize: '0.85rem'
                }}
              >
                {error}
              </div>
            )}
            <div className="form-group">
              <label htmlFor="preset-name-input">{t("Preset Name:")}</label>
              <input
                type="text"
                id="preset-name-input"
                disabled={isSaving}
                data-testid="preset-name-input"
                className="form-control"
                placeholder={t("Enter preset name...")}
                value={name}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
              />
            </div>
          </div>

          <div className="modal-footer ds-dialog__foot">
            <button
              type="button"
              className="ds-btn"
              onClick={handleClose}
              disabled={isSaving}
            >
              {t("Cancel")}</button>
            <button
              type="submit"
              className="ds-btn ds-btn--primary"
              data-testid="save-preset-confirm-btn"
              disabled={isSaving || !name.trim()}
            >
              {t(overwriting ? "Overwrite Preset" : "Save Preset")}</button>
          </div>
        </form>
      </div>
    </Dialog>
  );
};
