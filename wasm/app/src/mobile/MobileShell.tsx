import React, { useRef, useState } from 'react';
import { useHelpStore } from '../shell/HelpDialogs';
import { Dialog } from '../components/Dialog';
import { useAppStore } from '../store/appStore';
import { SavedPrinterSelector } from '../printers/SavedPrinterSelector';
import { useHistoryStore } from '../history';
import { exportGcode } from '../shell/exportGcode';
import { requestNewProject, requestOpenProject } from '../shell/projectActions';
import type { TabId } from '../shell/TopBar';
import { useTranslation } from '../i18n';
import { MobileSelect } from './MobileSelect';
import { SettingInput } from '../settings/SettingInput';
import { usePrefsStore } from '../prefs/prefsStore';
import './mobileShell.css';

export function MobileSheet({ title, onClose, children, footer, full = false }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; full?: boolean;
}) {
  const { t } = useTranslation();
  return <Dialog onClose={onClose} aria-label={title} className="wm-scrim">
    <section className={`wm-sheet ds-dialog ${full ? 'wm-sheet-full' : ''}`}>
      <header className="ds-dialog__head wm-row"><h1>{title}</h1><button onClick={onClose}>{t('Close')}</button></header>
      <div className="ds-dialog__body wm-content">{children}</div>
      {footer && <footer className="ds-dialog__foot wm-row">{footer}</footer>}
    </section>
  </Dialog>;
}

export function MobileImport({ disabled, onImported }: { disabled: boolean; onImported?: () => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  return <><input ref={input} type="file" hidden accept=".stl,.obj,.3mf,.amf,.step,.stp,.svg,.gcode" aria-label={t('Import model')}
    disabled={disabled} onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const s = useAppStore.getState();
      if (/\.gcode$/i.test(file.name)) void s.openGcodeFile(file);
      else s.requestImportFile(file);
      onImported?.();
    }} /><button className="wm-primary" disabled={disabled} onClick={() => input.current?.click()}>{t('Add model')}</button></>;
}

export function mobileBusy(s: ReturnType<typeof useAppStore.getState>) {
  return !s.isEngineReady || s.isSelectingPreset || s.isModelLoading || s.isSlicing || Object.keys(s.pendingOptions).length > 0;
}

function MobileMenu({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const s = useAppStore();
  const history = useHistoryStore();
  const busy = mobileBusy(s);
  const projectInput = useRef<HTMLInputElement>(null);
  const preset = (kind: 'process' | 'filament') => {
    const selected = kind === 'process' ? s.selectedProcess : s.selectedFilament;
    const active = s.activeUserPreset[kind];
    const system = (kind === 'process' ? s.processes : s.filaments).filter(p => p.isCompatible);
    return <label className="wm-field"><span className="wm-field-label">{t(kind === 'process' ? 'Process preset' : 'Filament')}</span>
      <MobileSelect aria-label={t(kind === 'process' ? 'Process preset' : 'Filament')} value={active ? `user:${active}` : selected} disabled={busy}
        onValueChange={value => {
          if (value.startsWith('user:')) void s.selectUserPreset(kind, value.slice(5));
          else if (kind === 'process') void s.chooseProcess(value);
          else void s.chooseFilament(value);
        }}>
        <option value="" disabled>{t('Select...')}</option>
        {system.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
        <optgroup label={t('User presets')}>{s.userPresets.filter(p => p.kind === kind).map(p => <option key={p.name} value={`user:${p.name}`}>{p.name}</option>)}</optgroup>
      </MobileSelect>
    </label>;
  };
  return <MobileSheet title={t('Menu & presets')} onClose={onClose}>
    <button aria-haspopup="dialog" onClick={() => { onClose(); useHelpStore.getState().open('bambu'); }}>{t('Bambu Cloud account')}</button>
    <section className="wm-stack"><h2>{t('Project')}</h2><MobileImport disabled={busy} onImported={onClose} />
      <button disabled={busy} onClick={() => { onClose(); void requestNewProject(); }}>{t('New project')}</button>
      <input ref={projectInput} type="file" hidden accept=".3mf" aria-label={t('Open project...')}
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          onClose();
          void requestOpenProject(file);
        }} />
      <button disabled={busy} onClick={() => projectInput.current?.click()}>{t('Open project...')}</button>
      <button disabled={busy || !s.modelFile} onClick={() => void s.saveProjectFile()}>{t('Save project')}</button>
    </section>
    <section className="wm-group">
      <div className="wm-stack">
        <label className="wm-field"><span className="wm-field-label">{t('Printer')}</span><SavedPrinterSelector disabled={busy} id="mobile-printer-select" /></label>
        {s.configDefs.nozzle_diameter ? <div className="wm-field"><label className="wm-field-label" htmlFor="setting-input-nozzle_diameter">{t('Nozzle diameter')} · {t('Extruder')} 1</label>
          <SettingInput optionKey="nozzle_diameter" def={s.configDefs.nozzle_diameter} kind="printer" index={0} />
        </div> : <p>{t('Nozzle diameter')}: {s.currentConfig.nozzle_diameter || '—'} mm</p>}
      </div>
      <button disabled={busy} onClick={() => s.openDialog('printer')}>{t('Printer Settings')}</button>
    </section>
    <section className="wm-group">{preset('filament')}<button disabled={busy} onClick={() => s.openDialog('filament')}>{t('Filament Settings')}</button></section>
    <section className="wm-stack">{preset('process')}</section>
    <button aria-haspopup="dialog" onClick={() => usePrefsStore.getState().openDialog('general')}>{t('Preferences...')}</button>
    <details><summary>{t('Secondary actions')}</summary><div className="wm-stack">
      <button disabled={busy || !history.canUndo} onClick={() => void history.undo()}>{t('Undo')}</button>
      <button disabled={busy || !history.canRedo} onClick={() => void history.redo()}>{t('Redo')}</button>
      <button disabled={!s.sliceResult || busy} onClick={() => exportGcode()}>{t('Export G-code')}</button>
      <button disabled={busy} onClick={() => s.openManagePresetsDialog('process')}>{t('Manage presets, import and export')}</button>
    </div></details>
  </MobileSheet>;
}

export function MobileHeader() {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  return <><header className="wm-header wm-row"><span className="wm-brand"><img src="/icons/OrcaSlicer.svg" alt="" />{t('OrcaSlicer Web')}</span>
    {import.meta.env.VITE_ALPHA_GATE_ENABLED === '1' && <div data-alpha-access-slot />}
    <button aria-haspopup="dialog" onClick={() => setMenu(true)}>{t('Menu')}</button></header>
    {menu && <MobileMenu onClose={() => setMenu(false)} />}</>;
}

export function MobileNavigation({ activeTab, setActiveTab }: { activeTab: TabId; setActiveTab: (tab: TabId) => void }) {
  const { t } = useTranslation();
  return <nav className="wm-nav" aria-label={t('Main navigation')}>
    {(['models', 'prepare', 'preview', 'device'] as const).map(tab => <button key={tab} aria-current={activeTab === tab ? 'page' : undefined}
      onClick={() => setActiveTab(tab)}>{t(tab[0].toUpperCase() + tab.slice(1))}</button>)}
  </nav>;
}
