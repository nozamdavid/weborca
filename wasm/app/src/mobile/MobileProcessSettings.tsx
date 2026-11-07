import React, { useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { SettingInput } from '../settings/SettingInput';
import { SettingsGroup } from '../settings/SettingsGroup';
import { isModeVisible } from '../settings/visibility';
import type { LayoutPage } from '../settings/types';
import { useTranslation } from '../i18n';
import { MobileSheet, mobileBusy } from './MobileShell';

function QualityEditor({ page, onClose }: { page: LayoutPage; onClose: () => void }) {
  const { t } = useTranslation();
  const s = useAppStore();
  const initial = useRef({ config: { ...s.currentConfig }, printer: s.selectedPrinter, process: s.selectedProcess });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const close = () => { if (!applying) onClose(); };
  const apply = async () => {
    for (const [key, value] of Object.entries(draft)) {
      const def = s.configDefs[key];
      if (/^(int|float|percent|floatOrPercent)$/.test(def.type)) {
        const percent = /percent|OrPercent/.test(def.type);
        const number = Number(value.replace(/%$/, ''));
        if (!(percent ? /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/).test(value) ||
          !Number.isFinite(number) || (def.type === 'int' && !Number.isInteger(number)) || number < (def.min ?? -Infinity) || number > (def.max ?? Infinity)) {
          setError(`${t(def.label || key)}: ${t('Enter a valid value within the allowed range.')} ${def.min ?? '−∞'} – ${def.max ?? '∞'}`); return;
        }
      }
    }
    if (!form.current?.reportValidity()) return;
    const current = useAppStore.getState();
    if (current.selectedPrinter !== initial.current.printer || current.selectedProcess !== initial.current.process ||
      Object.keys(draft).some(key => current.currentConfig[key] !== initial.current.config[key])) {
      setError(t('Settings changed while editing. Cancel and reopen to edit the current settings.')); return;
    }
    setApplying(true); setError('');
    try {
      for (const [key, value] of Object.entries(draft)) {
        if (value === initial.current.config[key]) continue;
        await useAppStore.getState().applyOptionChange(key, value, 'print');
        if (useAppStore.getState().engineError) throw new Error(useAppStore.getState().engineError!);
        initial.current.config[key] = useAppStore.getState().currentConfig[key];
        setDraft(previous => {
          const remaining = { ...previous };
          delete remaining[key];
          return remaining;
        });
      }
      onClose();
    } catch (reason) { setError(String(reason)); }
    finally { setApplying(false); }
  };
  const groups = page.groups.map(group => ({ ...group, keys: [...new Set(group.lines.flatMap(line => line.key ? [line.key] : line.options ?? []))].filter(key =>
    s.configDefs[key] && initial.current.config[key] !== undefined && isModeVisible(s.settingsMode, s.configDefs[key].mode) &&
    s.rulesState.fields[key]?.visible !== false &&
    `${t(s.configDefs[key].label || key)} ${t(group.title)} ${key}`.toLowerCase().includes(search.toLowerCase())) }));
  return <MobileSheet title={t('Quality')} full onClose={close} footer={<>
    <button disabled={applying} onClick={close}>{t('Cancel')}</button>
    <button className="wm-primary" disabled={applying || mobileBusy(s)} onClick={() => void apply()}>{t('Apply')}</button>
  </>}>
    <p>{t('Changes remain a draft until you apply them.')}</p>
    <label className="wm-field"><span className="wm-field-label">{t('Settings mode')}</span><select value={s.settingsMode} onChange={e => s.setSettingsMode(e.target.value as typeof s.settingsMode)}>
      <option value="simple">{t('Basic')}</option><option value="advanced">{t('Advanced')}</option><option value="expert">{t('Expert')}</option>
    </select></label>
    <label className="wm-field"><span className="wm-field-label">{t('Search Quality settings')}</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <form ref={form} onSubmit={e => { e.preventDefault(); void apply(); }}>
      <fieldset disabled={applying} className="wm-quality-groups">
        {groups.map(group => group.keys.length ? <section className="wm-card wm-stack" key={group.title}><h2>{t(group.title)}</h2>
          {group.keys.map(key => <div key={key} className="wm-field wm-quality-field">
            <label className="wm-field-label" htmlFor={`setting-input-${key}`}>{t(s.rulesState.fields[key]?.label || s.configDefs[key].label || key)}</label>
            <SettingInput optionKey={key} def={s.configDefs[key]} kind="print" fieldState={s.rulesState.fields[key]}
              draft={{ value: draft[key] ?? initial.current.config[key], onChange: value => setDraft(old => ({ ...old, [key]: value })) }} />
            {s.configDefs[key].tooltip && <p className="wm-help">{t(s.configDefs[key].tooltip)}</p>}
          </div>)}
        </section> : null)}
      </fieldset>
    </form>
    {!groups.some(group => group.keys.length) && <p role="status">{t('No matching settings')}</p>}
  </MobileSheet>;
}

export function MobileProcessSettings({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const s = useAppStore();
  const [page, setPage] = useState<LayoutPage | null>(null);
  const [search, setSearch] = useState('');
  const pages = s.layout?.tabs.find(tab => tab.id === 'print')?.pages ?? [];
  const matchingPages = pages.filter(p => `${t(p.title)} ${p.groups.flatMap(g => g.lines.flatMap(l => l.key ? [t(s.configDefs[l.key]?.label || l.key)] : (l.options ?? []).map(k => t(s.configDefs[k]?.label || k)))).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <MobileSheet title={t('Process Settings')} full onClose={onClose} footer={<button onClick={onClose}>{t('Done')}</button>}>
      <p>{s.selectedProcess || t('Select a process preset in Menu.')}</p>
      <label className="wm-field"><span className="wm-field-label">{t('Settings mode')}</span><select value={s.settingsMode} onChange={e => s.setSettingsMode(e.target.value as typeof s.settingsMode)}>
        <option value="simple">{t('Basic')}</option><option value="advanced">{t('Advanced')}</option><option value="expert">{t('Expert')}</option>
      </select></label>
      <label className="wm-field"><span className="wm-field-label">{t('Search settings')}</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
      {matchingPages.map(p => <button className="wm-category" key={p.title} disabled={mobileBusy(s)} aria-haspopup="dialog" onClick={() => setPage(p)}><span>{t(p.title)}</span><span aria-hidden="true">›</span></button>)}
      {!!pages.length && !matchingPages.length && <p role="status">{t('No matching settings')}</p>}
      {!pages.length && <p role="status">{t('Loading settings...')}</p>}
    </MobileSheet>
    {page && (page.title === 'Quality' ? <QualityEditor page={page} onClose={() => setPage(null)} /> :
      <MobileSheet title={t(page.title)} full onClose={() => setPage(null)} footer={<button onClick={() => setPage(null)}>{t('Done')}</button>}>
        <p>{t('Changes apply to the current project immediately.')}</p>
        {page.groups.map(group => <SettingsGroup key={group.title} group={group} kind="print" />)}
      </MobileSheet>)}
  </>;
}
