import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { ModalBackdrop } from '../components/ModalBackdrop';

export const SavePresetDialog: React.FC = () => {
  const {
    savePresetDialogTarget,
    closeSavePresetDialog,
    saveCurrentUserPreset,
    userPresets,
    processes,
    filaments,
    printers,
    activeUserPreset
  } = useAppStore();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!savePresetDialogTarget) return null;

  const { kind, baseName } = savePresetDialogTarget;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    if (collision && activeUserPreset[kind] !== trimmed) {
      setError(`A preset named "${trimmed}" already exists.`);
      return;
    }

    try {
      await saveCurrentUserPreset(kind, trimmed);
      setName('');
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save preset.');
    }
  };

  const handleClose = () => {
    setName('');
    setError(null);
    closeSavePresetDialog();
  };

  return (
    <ModalBackdrop onClose={handleClose} dirty={name.trim() !== ''} dirtyWhat="preset name" data-testid="save-preset-dialog">
      <div className="modal-box preset-modal" style={{ minWidth: 380 }}>
        <form onSubmit={handleSubmit}>
          <div className="modal-header">
            <div className="modal-title">Save User {kind.toUpperCase()} Preset</div>
            <button
              type="button"
              className="modal-close-btn"
              data-testid="save-preset-cancel-btn"
              onClick={handleClose}
            >
              ✕
            </button>
          </div>

          <div className="modal-body">
            <p className="preset-dialog-hint">
              Based on: <strong>{baseName}</strong>
            </p>
            {error && (
              <div
                className="preset-error-banner"
                data-testid="preset-error-msg"
                style={{
                  color: '#f87171',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
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
              <label htmlFor="preset-name-input">Preset Name:</label>
              <input
                type="text"
                id="preset-name-input"
                data-testid="preset-name-input"
                className="form-control"
                placeholder="Enter preset name..."
                value={name}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="save-preset-confirm-btn"
              disabled={!name.trim()}
            >
              Save Preset
            </button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
};
