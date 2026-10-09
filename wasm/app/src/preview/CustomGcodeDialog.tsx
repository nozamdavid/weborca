import React, { useState, useEffect } from 'react';
import { useLayerEventsStore } from './layerEventsStore';

export const CustomGcodeDialog: React.FC = () => {
  const dialogState = useLayerEventsStore((s) => s.dialogState);
  const saveCustomGcode = useLayerEventsStore((s) => s.saveCustomGcode);
  const closeDialog = useLayerEventsStore((s) => s.closeCustomGcodeDialog);

  const [gcode, setGcode] = useState('');

  useEffect(() => {
    if (dialogState) {
      setGcode(dialogState.initialGcode || '');
    }
  }, [dialogState]);

  if (!dialogState || !dialogState.isOpen) return null;

  const { plateIndex, printZ, layer, isEditing } = dialogState;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeDialog();
    }
  };

  const handleConfirm = () => {
    if (!gcode.trim()) return;
    saveCustomGcode(plateIndex, printZ, gcode.trim());
  };

  return (
    <div
      id="custom-gcode-dialog-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeDialog();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        id="custom-gcode-dialog"
        data-testid="custom-gcode-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-gcode-dialog-title"
        style={{
          background: '#27272a',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: 8,
          padding: '20px 24px',
          width: 460,
          maxWidth: '92vw',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <h3
          id="custom-gcode-dialog-title"
          style={{
            margin: '0 0 4px',
            fontSize: '1.1rem',
            fontWeight: 600,
            color: '#f4f4f5'
          }}
        >
          {isEditing ? 'Edit Custom G-code' : 'Custom G-code'}
        </h3>
        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: 12 }}>
          Layer {layer + 1} ({printZ.toFixed(2)} mm)
        </div>

        <label
          htmlFor="custom-gcode-input"
          style={{
            marginBottom: 8,
            fontSize: '0.85rem',
            color: '#d4d4d8'
          }}
        >
          Enter Custom G-code used on current layer:
        </label>

        <textarea
          id="custom-gcode-input"
          data-testid="custom-gcode-input"
          value={gcode}
          onChange={(e) => setGcode(e.target.value)}
          rows={6}
          placeholder="e.g. M117 Layer reached&#10;M104 S200"
          autoFocus
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: '#18181b',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 4,
            color: '#f4f4f5',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            padding: '8px 10px',
            resize: 'vertical',
            outline: 'none'
          }}
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 18
          }}
        >
          <button
            type="button"
            id="custom-gcode-cancel"
            data-testid="custom-gcode-cancel"
            onClick={closeDialog}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 4,
              color: '#e4e4e7',
              padding: '6px 16px',
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            id="custom-gcode-confirm"
            data-testid="custom-gcode-confirm"
            disabled={!gcode.trim()}
            onClick={handleConfirm}
            style={{
              background: gcode.trim() ? '#009688' : 'rgba(0, 150, 136, 0.4)',
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              padding: '6px 20px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: gcode.trim() ? 'pointer' : 'not-allowed'
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};
