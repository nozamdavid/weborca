import React, { useEffect, useRef, useState } from 'react';
import { PlateView } from '../plate/PlateView';
import { PrepareSidebar } from './PrepareSidebar';
import { useAppStore } from '../store/appStore';
import { useHistoryStore } from '../history';
import { usePrefsStore } from '../prefs';
import { MobileImport, mobileBusy } from '../mobile/MobileShell';
import { SettingInput } from '../settings/SettingInput';
import { useSliceReadiness } from './sliceReadiness';
import { readinessAction } from './slicePrerequisites';
import { useTranslation } from '../i18n';
import { UndoIcon, RedoIcon, GearIcon, SaveIcon, ImportIcon } from './glyphs';
import type { TabId } from './TopBar';
import './canvasPrepare.css';
import { setCameraView } from './cameraBridge';
import { exportGcode } from './exportGcode';
import { usePlatesStore } from '../plates/platesStore';
import { hasPlateOutput } from '../plates/resultState';

type Panel = 'projects' | 'printer' | 'filament' | 'supports' | 'settings' | 'objects' | 'output';
export function CanvasPrepare({ navigate }: { navigate: (tab: TabId) => void }) {
  const { t } = useTranslation();
  const s = useAppStore();
  const history = useHistoryStore();
  const reason = useSliceReadiness();
  const activePlate = usePlatesStore(state => state.activePlateIndex);
  const currentOutput = hasPlateOutput(s.sliceResult, activePlate);
  const busy = mobileBusy(s) || history.isRestoring;
  const [panel, setPanel] = useState<Panel | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const close = () => { setPanel(null); trigger.current?.focus(); };
  const open = (value: Panel, element: HTMLElement) => {
    trigger.current = element;
    if (value === 'printer' || value === 'filament' || value === 'settings' || value === 'objects') {
      const prefs = usePrefsStore.getState();
      prefs.setDisplayPref('sidebarSections', { ...prefs.display.sidebarSections, [value === 'settings' ? 'process' : value]: true });
    }
    setPanel(panel === value ? null : value);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea, [role="dialog"], [role="menu"]')) return;
      const app = useAppStore.getState();
      const prefs = usePrefsStore.getState();
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (!['i', 'o', 's', 'g', 'p', 'e', '0'].includes(k)) return;
        e.preventDefault();
        if (k === 'p') prefs.openDialog('general');
        else if (k === 'e') prefs.toggleShowLabels();
        else if (k === '0') setCameraView('BED');
        else if (!mobileBusy(app) && !useHistoryStore.getState().isRestoring) {
          if (k === 'i' || k === 'o') files.current?.click();
          if (k === 's' && app.modelFile) void app.saveProjectFile();
          if (k === 'g' && app.sliceResult) exportGcode();
        }
      } else if (e.key.toLowerCase() === 'k') prefs.toggleCameraType();
    };
    window.addEventListener('keydown', key);
    window.dispatchEvent(new Event('resize'));
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!panel) return;
    const modalOpen = () => document.querySelector('[aria-modal="true"]') !== null;
    root.current?.querySelector<HTMLElement>('.canvas-prepare-panel button, .canvas-prepare-panel select, .canvas-prepare-panel input')?.focus();
    const outside = (event: PointerEvent) => {
      if (modalOpen()) return;
      if (!root.current?.contains(event.target as Node)) setPanel(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (modalOpen()) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab' && root.current?.querySelector('.canvas-prepare-panel')?.contains(event.target as Node)) {
        const items = Array.from(root.current.querySelectorAll<HTMLElement>('.canvas-prepare-panel button:not(:disabled), .canvas-prepare-panel select:not(:disabled), .canvas-prepare-panel input:not(:disabled), .canvas-prepare-panel summary')).filter(item => item.getClientRects().length);
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [panel]);
  const button = (value: Panel, label: string, icon: React.ReactNode, extra?: React.ReactNode) =>
    <button aria-expanded={panel === value} aria-controls="canvas-prepare-panel" onClick={e => open(value, e.currentTarget)}>{icon}<span>{t(label)}{extra}</span></button>;
  return <section className="canvas-prepare">
    <PlateView floatingShell />
    <input ref={files} id="model-file" type="file" hidden accept=".stl,.obj,.3mf,.amf,.step,.stp,.svg,.gcode,.zip" disabled={busy} onChange={e => {
      const file = e.target.files?.[0]; e.target.value = '';
      if (!file) return;
      if (/\.3mf$/i.test(file.name)) void s.openProjectFile(file);
      else if (/\.gcode$/i.test(file.name)) void s.openGcodeFile(file);
      else s.requestImportFile(file);
    }} />
    <div ref={root} className="canvas-prepare-controls">
      <div className="canvas-prepare-top">
        <div className="canvas-island">{button('projects', 'Projects', <SaveIcon />)}</div>
        <div className="canvas-island canvas-history">
          <button disabled={busy || !history.canUndo} onClick={() => void history.undo()}><UndoIcon /><span>{t('Undo')}</span></button>
          <button disabled={busy || !history.canRedo} onClick={() => void history.redo()}><RedoIcon /><span>{t('Redo')}</span></button>
        </div>
        <div className="canvas-island canvas-printer">
          {button('printer', s.selectedPrinter || 'Choose printer', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 21V3h16v18M4 7h16M8 7v7h8V7M7 18h10M8 21h8" /></svg>, <small>{s.currentConfig.nozzle_diameter || '—'} mm · {s.selectedProcess || t('Process')}</small>)}
          {button('filament', 'Filament', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>)}
        </div>
        <div className="canvas-island">{button('supports', 'Supports', <img src="/icons/toolbar_support.svg" alt="" />)}{button('settings', 'Settings', <GearIcon />)}</div>
        <div className="canvas-island canvas-output">
          <button disabled={!s.isSlicing && (busy || (!currentOutput && !!reason))} title={t(reason)} onClick={() => s.isSlicing ? s.cancelSlice() : currentOutput ? exportGcode() : void s.startSlice()}><ImportIcon /><span>{t(s.isSlicing ? 'Cancel' : currentOutput ? 'Download G-code' : 'Slice')}</span></button>
          <button aria-label={t('G-code')} aria-expanded={panel === 'output'} onClick={e => open('output', e.currentTarget)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg></button>
        </div>
      </div>
      <div className="canvas-objects">{button('objects', 'Objects', <img src="/icons/toolbar_arrange.svg" alt="" />)}</div>
      {panel && <section id="canvas-prepare-panel" className={`canvas-prepare-panel canvas-panel-${panel}`} aria-label={t(panel === 'projects' ? 'Projects' : panel === 'supports' ? 'Supports' : 'Print settings')}>
        <header><strong>{t({ projects: 'Projects', printer: 'Printer', filament: 'Filament', supports: 'Supports', settings: 'Settings', objects: 'Objects', output: 'G-code' }[panel])}</strong><button onClick={close}>{t('Close')}</button></header>
        {panel === 'projects' ? <div className="canvas-project-menu">
          <button disabled={busy || !history.canUndo} onClick={() => void history.undo()}>{t('Undo')}</button>
          <button disabled={busy || !history.canRedo} onClick={() => void history.redo()}>{t('Redo')}</button>
          <MobileImport disabled={busy} onImported={close} />
          <button disabled={busy || !s.modelFile} onClick={() => void s.saveProjectFile()}>{t('Save project')}</button>
          {(['prepare', 'preview', 'device', 'calibration'] as const).map(tab => <button key={tab} onClick={() => { close(); navigate(tab); }}>{t(tab[0].toUpperCase() + tab.slice(1))}</button>)}
          <button onClick={() => { close(); usePrefsStore.getState().openDialog('general'); }}>{t('Preferences...')}</button>
        </div> : panel === 'supports' ? <fieldset disabled={busy || !s.selectedProcess}>
          {['enable_support', 'support_type'].map(key => s.configDefs[key] && <label key={key}>{t(key === 'enable_support' ? 'Supports' : 'Support type')}<SettingInput optionKey={key} def={s.configDefs[key]} kind="print" fieldState={s.rulesState.fields[key]} /></label>)}
        </fieldset> : <PrepareSidebar scope={panel} />}
        {panel === 'printer' && s.configDefs.nozzle_diameter && <label>{t('Nozzle diameter')}<SettingInput optionKey="nozzle_diameter" def={s.configDefs.nozzle_diameter} kind="printer" index={0} /></label>}
        {panel === 'output' && <><button disabled={!s.sliceResult} onClick={() => { close(); navigate('preview'); }}>{t('Preview')}</button>{reason && <p role="status">{t(reason)}</p>}{readinessAction(reason) && <button onClick={e => {
          const action = readinessAction(reason);
          open(action === 'model' ? 'projects' : action === 'process' ? 'settings' : action || 'settings', e.currentTarget);
        }}>{t('Settings')}</button>}</>}
      </section>}
    </div>
  </section>;
}
