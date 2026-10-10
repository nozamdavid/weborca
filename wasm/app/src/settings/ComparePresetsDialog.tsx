import React, { useEffect, useState } from 'react';
import { create } from 'zustand';
import { getPresetConfig, listPresets } from '../engine/orcaEngine';
import { useAppStore } from '../store/appStore';
import { modifiedSettings, type ModifiedSetting } from './modifiedSettings';
import { ModalBackdrop } from '../components/ModalBackdrop';

export const useCompareStore = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

type Kind = 'printer' | 'process' | 'filament';
const KIND_LABEL: Record<Kind, string> = { process: 'Process', filament: 'Filament', printer: 'Printer' };
const short = (value: string) => (value.length > 40 ? `${value.slice(0, 37)}...` : value);

/** Side-by-side differences between two presets of the same kind, grouped by the settings page they appear on. */
export const ComparePresetsDialog: React.FC = () => {
  const open = useCompareStore((s) => s.open);
  const setOpen = useCompareStore((s) => s.setOpen);
  const layout = useAppStore((s) => s.layout);
  const selectedProcess = useAppStore((s) => s.selectedProcess);
  const selectedFilament = useAppStore((s) => s.selectedFilaments?.[0]);
  const selectedPrinter = useAppStore((s) => s.selectedPrinter);
  const selected: Record<Kind, string | undefined> = { process: selectedProcess, filament: selectedFilament, printer: selectedPrinter };
  const [kind, setKind] = useState<Kind>('process');
  const [names, setNames] = useState<string[]>([]);
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [diff, setDiff] = useState<ModifiedSetting[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDiff(null);
    setError('');
    listPresets(kind, { compatibleOnly: false }).then((list) => {
      if (cancelled) return;
      const all = list.map((p) => p.name);
      setNames(all);
      setLeft(selected[kind] && all.includes(selected[kind]!) ? selected[kind]! : all[0] ?? '');
      setRight('');
    }, (e) => !cancelled && setError(String(e)));
    return () => { cancelled = true; };
  }, [open, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !left || !right) return setDiff(null);
    let cancelled = false;
    Promise.all([getPresetConfig(kind, left), getPresetConfig(kind, right)]).then(([a, b]) => {
      if (cancelled) return;
      setError('');
      // Options a preset does not list are left out, as a preset of another kind only carries its own.
      setDiff(modifiedSettings(layout, b, a));
    }, (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => { cancelled = true; };
  }, [open, kind, left, right, layout]);

  if (!open) return null;
  const picker = (id: string, value: string, set: (v: string) => void) => (
    <select id={id} value={value} onChange={(e) => set(e.target.value)} style={{ flex: 1, minWidth: 0 }} aria-label={id}>
      <option value="">Choose a preset...</option>
      {names.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );
  return (
    <ModalBackdrop onClose={() => setOpen(false)} id="compare-dialog" role="dialog" aria-label="Compare presets">
      <div className="modal-content" style={{ width: 'min(820px, 94vw)', padding: 20, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '86vh' }}>
        <h3 style={{ margin: 0 }}>Compare presets</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select id="compare-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Preset type">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          {picker('compare-left', left, setLeft)}
          {picker('compare-right', right, setRight)}
        </div>
        {error && <div id="compare-error" style={{ color: 'var(--danger-color)' }}>{error}</div>}
        <div style={{ overflow: 'auto', fontSize: 12 }}>
          {diff && diff.length === 0 && <div id="compare-same" style={{ padding: 8 }}>No differences in the settings shown by the app.</div>}
          {diff && diff.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--text-muted, #a0a0a0)' }}><th>Setting</th><th>{short(left)}</th><th>{short(right)}</th></tr></thead>
              <tbody>
                {diff.map((c) => (
                  <tr key={`${c.tab}/${c.key}`} className="compare-row" style={{ borderTop: '1px solid var(--border-color, #444)' }}>
                    <td style={{ padding: '4px 6px' }}>{c.label}<div style={{ color: 'var(--text-muted, #a0a0a0)', fontSize: 11 }}>{c.page}</div></td>
                    <td style={{ padding: '4px 6px' }} title={c.from}>{short(c.from)}</td>
                    <td style={{ padding: '4px 6px', color: '#f59e0b' }} title={c.to}>{short(c.to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" id="compare-close" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </ModalBackdrop>
  );
};
