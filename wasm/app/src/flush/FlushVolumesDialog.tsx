import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { autoFlushMatrix, readFlushMatrix } from './flushVolume';
import { ModalBackdrop } from '../components/ModalBackdrop';

const MAX = 20000;

/** The purge volume between every pair of filaments (desktop's "Flushing volumes" dialog). */
export const FlushVolumesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const currentConfig = useAppStore((s) => s.currentConfig);
  const selectedFilaments = useAppStore((s) => s.selectedFilaments);
  const applyOptionChange = useAppStore((s) => s.applyOptionChange);
  const count = selectedFilaments.length;
  const colours = (currentConfig.filament_colour ?? '').split(';').map((c) => c.trim());
  const [matrix, setMatrix] = useState(() => readFlushMatrix(currentConfig.flush_volumes_matrix, count));
  const [multiplier, setMultiplier] = useState(() => parseFloat((currentConfig.flush_multiplier ?? '0.3').split(',')[0]) || 0.3);
  const setCell = (k: number, text: string) => {
    const v = Math.max(0, Math.min(MAX, parseFloat(text) || 0));
    setMatrix((m) => m.map((x, i) => (i === k ? v : x)));
  };
  const apply = async () => {
    await applyOptionChange('flush_volumes_matrix', matrix.join(','), 'filament');
    await applyOptionChange('flush_multiplier', String(multiplier), 'filament');
    onClose();
  };
  const swatch = (i: number) => <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: colours[i] || '#888', border: '1px solid rgba(255,255,255,0.4)', verticalAlign: 'middle' }} />;

  return (
    <ModalBackdrop onClose={onClose} id="flush-dialog" role="dialog" aria-label="Flushing volumes">
      <div className="modal-content" style={{ width: 'min(620px, 94vw)', padding: 20, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '90vh', overflow: 'auto' }}>
        <h3 style={{ margin: 0 }}>Flushing volumes</h3>
        <span style={{ fontSize: 12, color: 'var(--text-muted, #a0a0a0)' }}>
          Material purged on the prime tower when changing from the filament in a row to the one in a column, in mm³. The multiplier scales every value.
        </span>
        <table style={{ borderCollapse: 'collapse', alignSelf: 'center' }}>
          <thead>
            <tr>
              <th style={{ padding: 4, fontSize: 11 }}>from \ to</th>
              {selectedFilaments.map((_, j) => <th key={j} style={{ padding: 4 }}>{swatch(j)} {j + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {selectedFilaments.map((_, i) => (
              <tr key={i}>
                <th style={{ padding: 4, textAlign: 'right' }}>{i + 1} {swatch(i)}</th>
                {selectedFilaments.map((__, j) => (
                  <td key={j} style={{ padding: 2 }}>
                    <input
                      id={`flush-${i}-${j}`} aria-label={`from ${i + 1} to ${j + 1}`} type="number" min={0} max={MAX} disabled={i === j}
                      value={matrix[i * count + j]} onChange={(e) => setCell(i * count + j, e.target.value)}
                      style={{ width: 72, background: 'var(--control-bg, #3a3a3a)', color: 'inherit', border: '1px solid var(--border-color, #444)', borderRadius: 4, padding: '3px 5px' }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          Flush multiplier
          <input id="flush-multiplier" type="number" step={0.05} min={0} max={10} value={multiplier} onChange={(e) => setMultiplier(parseFloat(e.target.value) || 0)}
            style={{ width: 72, background: 'var(--control-bg, #3a3a3a)', color: 'inherit', border: '1px solid var(--border-color, #444)', borderRadius: 4, padding: '3px 5px' }} />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button className="btn btn-secondary" id="flush-auto" title="Estimate from the filament colours" onClick={() => setMatrix(autoFlushMatrix(colours.slice(0, count)))}>Auto-calculate</button>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" id="flush-cancel" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" id="flush-apply" onClick={() => void apply()}>OK</button>
          </span>
        </div>
      </div>
    </ModalBackdrop>
  );
};
