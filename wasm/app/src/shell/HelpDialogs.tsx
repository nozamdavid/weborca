import React from 'react';
import { create } from 'zustand';

export const useHelpStore = create<{ dialog: 'about' | 'shortcuts' | null; open: (d: 'about' | 'shortcuts') => void; close: () => void }>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null })
}));

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl+I', 'Import a model'],
  ['Ctrl+G', 'Export the G-code'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
  ['Ctrl+A', 'Select the object'],
  ['M / R / S', 'Move, rotate, scale'],
  ['P', 'Support painting'],
  ['C', 'Cut'],
  ['A', 'Arrange'],
  ['Delete', 'Delete the selected object'],
  ['0 to 6', 'Iso, top, bottom, front, rear, left, right view'],
  ['Z', 'Zoom to the selection, or to the whole plate'],
  ['Esc', 'Leave the active tool'],
  ['Left drag', 'Rotate the view'],
  ['Right or middle drag', 'Pan the view'],
  ['Wheel', 'Zoom']
];

/** The Help menu's pages. */
export const HelpDialogs: React.FC = () => {
  const { dialog, close } = useHelpStore();
  if (!dialog) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-label={dialog === 'about' ? 'About' : 'Keyboard shortcuts'} onClick={close}>
      <div className="modal-content" style={{ width: 'min(520px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
        {dialog === 'about' ? (
          <>
            <h3 style={{ marginBottom: 8 }}>OrcaSlicer Web</h3>
            <p>A browser port of OrcaSlicer. Slicing runs on this computer: the OrcaSlicer engine is compiled to WebAssembly and nothing is uploaded.</p>
            <p style={{ marginTop: 8, color: 'var(--text-muted)' }}>
              Based on OrcaSlicer, licensed under the GNU AGPL-3.0. The STEP importer uses Open CASCADE Technology (LGPL-2.1 with the OCCT exception).
            </p>
            <p style={{ marginTop: 8 }}><a href="https://github.com/OrcaSlicer/OrcaSlicer" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-color)' }}>github.com/OrcaSlicer/OrcaSlicer</a></p>
          </>
        ) : (
          <>
            <h3 style={{ marginBottom: 8 }}>Keyboard shortcuts</h3>
            <table className="shortcut-table"><tbody>{SHORTCUTS.map(([keys, what]) => <tr key={keys}><td>{keys}</td><td>{what}</td></tr>)}</tbody></table>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn btn-primary" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
};
