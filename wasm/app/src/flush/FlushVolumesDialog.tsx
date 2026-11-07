import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { autoFlushMatrix, readFlushMatrix } from './flushVolume';
import { Dialog } from '../components/Dialog';
import { useTranslation } from "../i18n";

const MAX = 20000;

/** The purge volume between every pair of filaments (desktop's "Flushing volumes" dialog). */
export const FlushVolumesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { t } = useTranslation();
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
    await applyOptionChange('flush_volumes_matrix', matrix.join(','), 'filament', undefined, null);
    await applyOptionChange('flush_multiplier', String(multiplier), 'filament', undefined, null);
    onClose();
  };
  const swatch = (i: number) => <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: colours[i] || '#888', border: '1px solid var(--border-strong)', verticalAlign: 'middle' }} />;

  return (
    <Dialog onClose={onClose} id="flush-dialog" role="dialog" aria-label={t("Flushing volumes")}>
      <div className="modal-content ds-dialog ds-dialog--lg">
        <h3 style={{ margin: 0 }}>{t("Flushing volumes")}</h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          {t("Material purged on the prime tower when changing from the filament in a row to the one in a column, in mm³. The multiplier scales every value.")}</span>
        <table style={{ borderCollapse: 'collapse', alignSelf: 'center' }}>
          <thead>
            <tr>
              <th style={{ padding: 4, fontSize: '0.6875rem' }}>{t("from \\ to")}</th>
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
                      style={{ width: 72, background: 'var(--control-bg)', color: 'inherit', border: '1px solid var(--border-color, var(--border-color))', borderRadius: 4, padding: '3px 5px' }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem' }}>
          {t("Flush multiplier")}<input id="flush-multiplier" type="number" step={0.05} min={0} max={10} value={multiplier} onChange={(e) => setMultiplier(parseFloat(e.target.value) || 0)}
            style={{ width: 72, background: 'var(--control-bg)', color: 'inherit', border: '1px solid var(--border-color, var(--border-color))', borderRadius: 4, padding: '3px 5px' }} />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button className="ds-btn" id="flush-auto" title={t("Estimate from the filament colours")} onClick={() => setMatrix(autoFlushMatrix(colours.slice(0, count)))}>{t("Auto-calculate")}</button>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="ds-btn" id="flush-cancel" onClick={onClose}>{t("Cancel")}</button>
            <button className="ds-btn ds-btn--primary" id="flush-apply" onClick={() => void apply()}>{t("OK")}</button>
          </span>
        </div>
      </div>
    </Dialog>
  );
};
