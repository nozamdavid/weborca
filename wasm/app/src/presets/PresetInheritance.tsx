import React, { useEffect, useState } from 'react';
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';
import { systemProfiles } from './systemProfiles';
import { saveUserPreset } from './presetStorage';
import type { PresetKind } from './types';
import { presetDescendsFrom } from './effectivePreset';
import './PresetInheritance.css';

/** The base preset supplies defaults; the user preset stores only its overrides. */
export const PresetInheritance: React.FC<{ kind: PresetKind; name: string }> = ({ kind, name }) => {
  const app = useAppStore();
  const system = kind === 'printer' ? app.printers : kind === 'filament' ? app.filaments : app.processes;
  const users = app.userPresets.filter((p) => p.kind === kind);
  const selected = users.find((p) => p.name === name);
  const bases = [...system, ...users.filter(p => !presetDescendsFrom(kind, p.name, name, users))];
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [parents, setParents] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    setParents({});
    void systemProfiles(app.selectedVendor, kind === 'printer' ? 'machine' : kind).then((profiles) => {
      if (!cancelled) setParents(Object.fromEntries(profiles.map((p) => [p.name, p.inherits || ''])));
    }).catch(() => { /* The engine's available ancestry is still shown if offline. */ });
    return () => { cancelled = true; };
  }, [app.selectedVendor, kind]);
  const chain: string[] = [];
  const visited = new Set<string>();
  let cursor = name;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor); chain.push(cursor);
    cursor = users.find((p) => p.name === cursor)?.inherits || parents[cursor] || system.find((p) => p.name === cursor)?.inherits || '';
  }
  const rebase = async (inherits: string) => {
    if (!selected || !inherits) return;
    setBusy(true); setError('');
    try {
      const userPresets = await saveUserPreset({ ...selected, inherits });
      useAppStore.setState({ userPresets });
      if (kind === 'filament') {
        for (const [index, preset] of app.selectedFilaments.entries()) {
          if (presetDescendsFrom(kind, preset, name, users)) await app.selectUserPreset(kind, preset, index);
        }
      } else if (app.activeUserPreset[kind] && presetDescendsFrom(kind, app.activeUserPreset[kind]!, name, users)) {
        await app.selectUserPreset(kind, app.activeUserPreset[kind]!);
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <section id="preset-inheritance" aria-busy={busy}>
    <h3>{t('Preset inheritance')}</h3>
    <ol aria-label={t("Preset inheritance chain")}>{chain.map((item) => <li key={item}>{item}</li>)}</ol>
    {selected && <label>{t('Base preset')} <select className="ds-input" id="preset-parent" value={selected.inherits} disabled={busy || app.isSelectingPreset} onChange={(e) => void rebase(e.target.value)}>
      {!bases.some((p) => p.name === selected.inherits) && <option value={selected.inherits}>{selected.inherits}</option>}
      {bases.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
    </select></label>}
    <p>{selected ? t('{{count}} overrides. Changing the base retains these overrides and uses the new base for other values.', { count: Object.keys(selected.values).length }) : t('System preset ancestry is read-only. Duplicate the preset to create an editable child.')}</p>
    {error && <p role="alert">{error}</p>}
  </section>;
};
