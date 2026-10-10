import React, { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { modifiedSettings } from './modifiedSettings';
import { ModalBackdrop } from '../components/ModalBackdrop';

const short = (value: string) => (value.length > 40 ? `${value.slice(0, 37)}...` : value);

/** What differs from the selected presets, with a way to put each value back (desktop's unsaved changes list). */
export const ModifiedSettingsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const layout = useAppStore((s) => s.layout);
  const currentConfig = useAppStore((s) => s.currentConfig);
  const presetConfig = useAppStore((s) => s.presetConfig);
  const resetOption = useAppStore((s) => s.resetOption);
  const changes = modifiedSettings(layout, currentConfig, presetConfig);
  useEffect(() => {
    if (changes.length === 0) onClose();
  }, [changes.length, onClose]);

  return (
    <ModalBackdrop onClose={onClose} id="modified-dialog" role="dialog" aria-label="Modified settings">
      <div className="modal-content" style={{ width: 'min(680px, 94vw)', padding: 20, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '86vh' }}>
        <h3 style={{ margin: 0 }}>Modified settings ({changes.length})</h3>
        <div style={{ overflow: 'auto', fontSize: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted, #a0a0a0)' }}><th>Setting</th><th>Preset</th><th>Now</th><th /></tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={`${c.tab}/${c.key}`} className="modified-row" style={{ borderTop: '1px solid var(--border-color, #444)' }}>
                  <td style={{ padding: '4px 6px' }}>{c.label}<div style={{ color: 'var(--text-muted, #a0a0a0)', fontSize: 11 }}>{c.page}</div></td>
                  <td style={{ padding: '4px 6px' }} title={c.from}>{short(c.from)}</td>
                  <td style={{ padding: '4px 6px', color: '#f59e0b' }} title={c.to}>{short(c.to)}</td>
                  <td><button className="btn btn-secondary" style={{ padding: '1px 8px' }} onClick={() => void resetOption(c.key, c.tab)}>Reset</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button className="btn btn-secondary" id="modified-reset-all" onClick={async () => { for (const c of changes) await resetOption(c.key, c.tab); }}>Reset all</button>
          <button className="btn btn-primary" id="modified-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </ModalBackdrop>
  );
};
