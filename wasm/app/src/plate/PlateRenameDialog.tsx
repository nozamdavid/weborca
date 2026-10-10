import React, { useState } from 'react';

/** Asks for a plate's title. An empty title goes back to the default "Plate N". */
export const PlateRenameDialog: React.FC<{ index: number; initial: string; onSubmit: (title: string) => void; onClose: () => void }> = ({ index, initial, onSubmit, onClose }) => {
  const [value, setValue] = useState(initial);
  const submit = () => onSubmit(value.trim());
  return (
    <div
      id="plate-rename-dialog"
      role="dialog"
      aria-label="Rename plate"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.45)' }}
    >
      <div style={{ width: 380, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, background: '#27272a', border: '1px solid #3f3f46', borderRadius: 10, boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)', color: '#f4f4f5' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Rename plate {index + 1}</div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#a1a1aa' }}>
          Plate title
          <input
            id="plate-title-input"
            autoFocus
            value={value}
            placeholder={`Plate ${index + 1}`}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') onClose();
            }}
            style={{ padding: '8px 10px', fontSize: 14, background: '#18181b', color: '#f4f4f5', border: '1px solid #52525b', borderRadius: 6, outline: 'none' }}
          />
          <span>Leave it empty to use the default name.</span>
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button className="btn btn-secondary" id="plate-title-cancel" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" id="plate-title-ok" onClick={submit}>OK</button>
        </div>
      </div>
    </div>
  );
};
