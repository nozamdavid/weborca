import React from 'react';
import { create } from 'zustand';
import { Dialog } from '../components/Dialog';
import { useTranslation } from "../i18n";

export const useHelpStore = create<{ dialog: 'about' | 'shortcuts' | null; open: (d: 'about' | 'shortcuts') => void; close: () => void }>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null })
}));

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl+P', 'Preferences'],
  ['Ctrl+I', 'Import a model'],
  ['Ctrl+G', 'Export the G-code'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
  ['Ctrl+A', 'Select all objects'],
  ['Shift/Ctrl+click', 'Add an object to the selection'],
  ['Ctrl+C / Ctrl+V', 'Copy and paste (a new object beside the original)'],
  ['Ctrl+K', 'Clone the selection'],
  ['Ctrl+D', 'Delete all objects'],
  ['Esc', 'Deselect'],
  ['Ctrl+E', 'Toggle object labels'],
  ['M / R / S', 'Move, rotate, scale'],
  ['P', 'Support painting'],
  ['C', 'Cut'],
  ['A', 'Arrange'],
  ['K', 'Toggle perspective / orthographic camera'],
  ['Shift+Tab', 'Toggle sidebar'],
  ['Delete', 'Delete the selected object'],
  ['1 to 9', 'Assign the selected object or part to a filament'],
  ['0 to 6', 'Camera views when no object is selected'],
  ['Ctrl+0', 'Zoom to bed'],
  ['Z', 'Zoom to the selection, or to the whole plate'],
  ['Esc', 'Leave the active tool'],
  ['Left drag', 'Rotate the view'],
  ['Right or middle drag', 'Pan the view'],
  ['Wheel', 'Zoom']
];

/** The Help menu's pages. */
export const HelpDialogs: React.FC = () => {
    const { t } = useTranslation();
  const { dialog, close } = useHelpStore();
  if (!dialog) return null;
  return (
    <Dialog onClose={close} role="dialog" aria-label={t(dialog === "about" ? "About" : "Keyboard shortcuts")}>
      <div className="modal-content ds-dialog" onClick={(e) => e.stopPropagation()}>
        {dialog === 'about' ? (
          <>
            <h3 style={{ marginBottom: 8 }}>{t("OrcaSlicer Web")}</h3>
            <p>{t("A browser port of OrcaSlicer. Slicing runs on this computer: the OrcaSlicer engine is compiled to WebAssembly and nothing is uploaded.")}</p>
            <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--control-bg)', borderRadius: 6, fontSize: '0.85rem' }}>
              <div><strong>{t("App Version:")}</strong> 0.1.0</div>
              <div style={{ marginTop: 4 }}><strong>{t("Engine:")}</strong> {t("OrcaSlicer 02.08.01.55 (WASM engine)")}</div>
              <div style={{ marginTop: 4 }}><strong>{t("Architecture:")}</strong> {t("WebAssembly (Multi-threaded POSIX pthreads)")}</div>
            </div>
            <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>
              {t("Based on OrcaSlicer, licensed under the GNU AGPL-3.0. The STEP importer uses Open CASCADE Technology (LGPL-2.1 with the OCCT exception).")}</p>
            <p style={{ marginTop: 8 }}>
              <a href="https://github.com/OrcaSlicer/OrcaSlicer" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-color)' }}>
                {t("github.com/OrcaSlicer/OrcaSlicer")}</a>
            </p>
          </>
        ) : (
          <>
            <h3 style={{ marginBottom: 8 }}>{t("Keyboard shortcuts")}</h3>
            <table className="shortcut-table">
              <tbody>
                {SHORTCUTS.map(([keys, what]) => (
                  <tr key={keys}>
                    <td>{keys}</td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="ds-btn ds-btn--primary" onClick={close}>
            {t("Close")}</button>
        </div>
      </div>
    </Dialog>
  );
};
