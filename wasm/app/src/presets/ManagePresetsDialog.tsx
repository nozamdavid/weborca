import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import type { PresetKind } from './types';

export const ManagePresetsDialog: React.FC = () => {
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
    duplicateUserPresetAction,
    renameUserPresetAction,
    deleteUserPresetAction
  } = useAppStore();

  const [activeKind, setActiveKind] = useState<PresetKind>('process');
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [duplicateName, setDuplicateName] = useState<string>('');
  const [renameName, setRenameName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (managePresetsDialogTarget) {
      const kind = managePresetsDialogTarget.kind;
      setActiveKind(kind);
      setError(null);
      setSuccessMsg(null);
      setDuplicateName('');
      setRenameName('');

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

  return (
    <div className="modal-backdrop" data-testid="manage-presets-dialog">
      <div
        className="modal-box preset-modal"
        style={{
          width: 560,
          maxWidth: '90vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div className="modal-header">
          <div className="modal-title">Manage Presets</div>
          <button
            type="button"
            className="modal-close-btn"
            data-testid="manage-preset-close-btn"
            onClick={closeManagePresetsDialog}
          >
            ✕
          </button>
        </div>

        {/* Kind Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #3f3f46',
            background: '#27272a'
          }}
        >
          {(['process', 'filament', 'printer'] as PresetKind[]).map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`manage-tab-${k}`}
              onClick={() => handleKindChange(k)}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: activeKind === k ? '#18181b' : 'transparent',
                color: activeKind === k ? '#38bdf8' : '#a1a1aa',
                border: 'none',
                borderBottom: activeKind === k ? '2px solid #38bdf8' : 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
                textTransform: 'capitalize'
              }}
            >
              {k} Presets
            </button>
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

          {/* Preset Selector / List */}
          <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="manage-preset-target-select" style={{ fontSize: '0.85rem', color: '#e4e4e7', fontWeight: 500 }}>
              Select Preset to Manage:
            </label>
            <select
              id="manage-preset-target-select"
              data-testid="manage-preset-select"
              className="form-control"
              value={selectedPreset}
              onChange={(e) => {
                setSelectedPreset(e.target.value);
                setError(null);
                setSuccessMsg(null);
                setRenameName(e.target.value);
              }}
              style={{
                background: '#27272a',
                color: '#f4f4f5',
                border: '1px solid #52525b',
                padding: '6px 10px',
                borderRadius: 4,
                fontSize: '0.9rem'
              }}
            >
              {currentUserPresets.length > 0 && (
                <optgroup label="User Presets (Editable)">
                  {currentUserPresets.map((u) => (
                    <option key={u.name} value={u.name}>
                      {u.name} {activeUserPreset[activeKind] === u.name ? '★ [Active]' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {currentSystemPresets.length > 0 && (
                <optgroup label="System Presets (Immutable)">
                  {currentSystemPresets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} [System]
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <div style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>
              Status:{' '}
              {isSelectedUserPreset ? (
                <span style={{ color: '#38bdf8', fontWeight: 500 }}>User Preset (Customizable)</span>
              ) : (
                <span style={{ color: '#eab308', fontWeight: 500 }}>System Preset (Read-Only)</span>
              )}
            </div>
          </div>

          {/* Duplicate Section */}
          <div
            style={{
              background: '#27272a',
              padding: 12,
              borderRadius: 6,
              border: '1px solid #3f3f46',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#f4f4f5' }}>
              Duplicate Preset
            </div>
            <div style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>
              Create an editable copy of <strong>{selectedPreset || 'selected preset'}</strong> preserving all base values.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                data-testid="duplicate-preset-input"
                className="form-control"
                placeholder={`Name for duplicate copy...`}
                value={duplicateName}
                onChange={(e) => {
                  setDuplicateName(e.target.value);
                  if (error) setError(null);
                  if (successMsg) setSuccessMsg(null);
                }}
                style={{
                  flex: 1,
                  background: '#18181b',
                  color: '#fff',
                  border: '1px solid #52525b',
                  padding: '5px 8px',
                  borderRadius: 4,
                  fontSize: '0.85rem'
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                data-testid="duplicate-preset-confirm-btn"
                disabled={!duplicateName.trim()}
                onClick={handleDuplicate}
                style={{ whiteSpace: 'nowrap' }}
              >
                Duplicate
              </button>
            </div>
          </div>

          {/* Rename Section (User presets only) */}
          {isSelectedUserPreset && (
            <div
              style={{
                background: '#27272a',
                padding: 12,
                borderRadius: 6,
                border: '1px solid #3f3f46',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#f4f4f5' }}>
                Rename User Preset
              </div>
              <div style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>
                Change the name of <strong>{selectedPreset}</strong>. Active selection will be retained.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  data-testid="rename-preset-input"
                  className="form-control"
                  placeholder="New preset name..."
                  value={renameName}
                  onChange={(e) => {
                    setRenameName(e.target.value);
                    if (error) setError(null);
                    if (successMsg) setSuccessMsg(null);
                  }}
                  style={{
                    flex: 1,
                    background: '#18181b',
                    color: '#fff',
                    border: '1px solid #52525b',
                    padding: '5px 8px',
                    borderRadius: 4,
                    fontSize: '0.85rem'
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="rename-preset-confirm-btn"
                  disabled={!renameName.trim() || renameName.trim() === selectedPreset}
                  onClick={handleRename}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  Rename
                </button>
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
                Delete this user preset permanently
              </div>
              <button
                type="button"
                className="btn btn-danger"
                data-testid="delete-preset-confirm-btn"
                onClick={handleDelete}
                style={{ fontSize: '0.82rem', padding: '4px 10px' }}
              >
                Delete Preset
              </button>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid #3f3f46', padding: 12 }}>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="manage-preset-done-btn"
            onClick={closeManagePresetsDialog}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
