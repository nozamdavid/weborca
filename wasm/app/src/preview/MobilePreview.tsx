import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import { MobileSheet } from '../mobile/MobileShell';
import { MobileStats } from '../mobile/MobileStats';
import { useAppStore } from '../store/appStore';
import { usePlatesStore } from '../plates/platesStore';
import { usePrefsStore } from '../prefs/prefsStore';
import { usePrinterConnectionStore } from '../printers/connectionStore';
import { SendToPrinterDialog } from '../printers/SendToPrinterDialog';
import { exportGcode } from '../shell/exportGcode';
import { usePreviewStore } from './previewStore';
import { GCodeWindow } from './GCodeWindow';
import { formatPrintTime } from './SliceStatsPanel';
import type { PreviewViewType } from './types';
import './MobilePreview.css';
import { OutputReview } from './OutputReview';
import { hasPlateOutput } from '../plates/resultState';

const schemes: [PreviewViewType, string][] = [
  ['FeatureType', 'Line type'], ['Speed', 'Speed'], ['ActualSpeed', 'Actual speed'],
  ['Acceleration', 'Acceleration'], ['Jerk', 'Jerk'], ['Height', 'Layer height'],
  ['Width', 'Line width'], ['VolumetricFlowRate', 'Flow rate'], ['ActualVolumetricFlowRate', 'Actual flow rate'],
  ['LayerTimeLinear', 'Layer time'], ['LayerTimeLogarithmic', 'Layer time (log)'],
  ['FanSpeed', 'Fan speed'], ['Temperature', 'Temperature'], ['PressureAdvance', 'Pressure advance'],
  ['Tool', 'Filament'], ['ColorPrint', 'Color print'], ['Summary', 'Summary'],
];

function MobilePreviewControls({ resetCamera }: { resetCamera: () => void }) {
  const { t } = useTranslation();
  const p = usePreviewStore();
  const lowQuality = usePrefsStore(s => s.display.previewLowQuality);
  const lightingEnabled = usePrefsStore(s => s.display.previewLighting);
  const showFps = usePrefsStore(s => s.display.previewShowFps);
  const setDisplay = usePrefsStore(s => s.setDisplayPref);
  const filaments = useAppStore(s => s.selectedFilaments);
  const raw = useAppStore(s => /\.(gcode|gco|bgcode)$/i.test(s.modelFile?.name ?? ''));
  return <div className="mp-sheet">
    <section className="mp-field-group">
    <h2>{t('Layer range')}</h2>
    <label className="wm-field"><span className="wm-field-label">{t('Bottom visible layer')}</span><input type="number" min={1} max={p.maxLayer + 1} value={p.minLayer + 1}
      onChange={e => { if (e.target.value) p.setLayerRangeAction(Math.max(0, Math.min(p.maxLayer, Math.round(Number(e.target.value)) - 1)), p.maxLayer); }} /></label>
    <label className="wm-field"><span className="wm-field-label">{t('Top visible layer')}</span><input type="number" min={p.minLayer + 1} max={p.layersCount} value={p.maxLayer + 1}
      onChange={e => { if (e.target.value) p.setLayerRangeAction(p.minLayer, Math.max(p.minLayer, Math.min(p.layersCount - 1, Math.round(Number(e.target.value)) - 1))); }} /></label>
    <button onClick={p.resetLayersAction}>{t('All layers')}</button>
    </section>
    <label className="wm-field"><span className="wm-field-label">{t('Color Scheme')}</span><select value={p.viewType} onChange={e => p.setViewTypeAction(e.target.value as PreviewViewType)}>
      {schemes.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
    </select></label>
    <section><h2>{t(p.legend.title)}</h2>
      {p.legend.items?.map(item => {
        const name = p.legend.type === 'tool' && !raw && filaments[item.id] ? filaments[item.id] : item.name;
        return <label className="mp-legend-row" key={item.id}>
          {p.legend.type === 'features' && <input className="ds-switch" type="checkbox" checked={item.visible} onChange={() => p.toggleExtrusionRoleAction(item.id)} />}
          <span className="mp-swatch" style={{ background: item.color }} aria-hidden="true" />
          <span>{name}</span>{item.timeS !== undefined && <small>{formatPrintTime(item.timeS)}</small>}
        </label>;
      })}
      {p.legend.ranges?.map((range, i) => <div className="mp-legend-row" key={i}>
        <span className="mp-swatch" style={{ background: range.color }} aria-hidden="true" />
        <span>{range.value.toFixed(p.viewType === 'PressureAdvance' ? 3 : 1)}</span>
      </div>)}
    </section>
    <section><h2>{t('Features')}</h2>{p.legend.options?.map(option => <label className="mp-legend-row" key={option.id}>
      <input className="ds-switch" type="checkbox" checked={option.visible} onChange={() => p.toggleOptionAction(option.id)} />
      <span className="mp-swatch" style={{ background: option.color }} aria-hidden="true" /><span>{option.name}</span>
    </label>)}</section>
    <button onClick={resetCamera}>{t('Reset camera')}</button>
    <label className="mp-legend-row"><input className="ds-switch" type="checkbox" checked={lowQuality} onChange={e => setDisplay('previewLowQuality', e.target.checked)} />{t('Low quality')}</label>
    <label className="mp-legend-row"><input className="ds-switch" type="checkbox" checked={lightingEnabled} onChange={e => setDisplay('previewLighting', e.target.checked)} />{t('Lighting & shadows')}</label>
    <label className="mp-legend-row"><input className="ds-switch" type="checkbox" checked={showFps} onChange={e => setDisplay('previewShowFps', e.target.checked)} />{t('Show FPS')}</label>
    <label className="mp-legend-row"><input className="ds-switch" type="checkbox" checked={p.showGcodeWindow} onChange={p.toggleGcodeWindowAction} />{t('G-code')}</label>
  </div>;
}

export function MobilePreview({ canvas, active, loading, error, resetCamera }: {
  canvas: React.ReactNode; active: boolean; loading: boolean; error: string | null; resetCamera: () => void;
}) {
  const { t } = useTranslation();
  const p = usePreviewStore();
  const result = useAppStore(s => s.sliceResult);
  const openSendDialog = usePrinterConnectionStore(s => s.openSendDialog);
  const model = useAppStore(s => s.modelFile);
  const slicing = useAppStore(s => s.isSlicing);
  const engineError = useAppStore(s => s.engineError);
  const canSlice = useAppStore(s => s.isEngineReady && !s.isSelectingPreset && !s.isModelLoading && Object.keys(s.pendingOptions).length === 0);
  const startSlice = useAppStore(s => s.startSlice);
  const openGcode = useAppStore(s => s.openGcodeFile);
  const plate = usePlatesStore(s => s.activePlateIndex);
  const input = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<'controls' | 'stats' | null>(null);
  const ready = p.isInitialized && p.layersCount > 0 && !loading && !p.isLoading && !error && !slicing;
  const canExport = ready && hasPlateOutput(result, plate);
  useEffect(() => { if (!active || !ready) setSheet(null); }, [active, ready]);
  const close = () => setSheet(null);
  return <div className="mp-preview">
    <header className="mp-heading"><h1>{t('Preview')}</h1><span>{t('Plate')} {plate + 1}</span></header>
    <small className="mp-description">{model?.name}{ready ? ` · ${t(schemes.find(([type]) => type === p.viewType)?.[1] ?? p.viewType)}` : ''}</small>
    {p.layersCount === 0 && <label>{t('Color Scheme')}<select disabled value={p.viewType}>
      {schemes.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
    </select></label>}
    <div className={`mp-viewport ${ready ? '' : 'mp-viewport-empty'}`}>
      {canvas}
      {!ready && <div className="mp-status" role="status">
        {loading || p.isLoading || slicing ? <p>{t(slicing ? 'Slicing…' : 'Loading WebGL2 Preview Engine...')}</p> : error ? <><h2>{t('Preview Initialization Error')}</h2><p>{error}</p></> : <>
          <h2>{t('No G-code toolpaths loaded')}</h2>
          <p>{t('Slice a plate or open a G-code file to inspect the toolpath.')}</p>
          {engineError && <p>{engineError}</p>}
          <button className="mp-primary" onClick={() => { window.history.pushState(null, '', '/prepare'); window.dispatchEvent(new PopStateEvent('popstate')); }}>{t('Go to Prepare')}</button>
        </>}
      </div>}
      {ready && <span className="mp-caption">{t('Layers')} {p.minLayer + 1}–{p.maxLayer + 1} · Z {p.layersZs[p.maxLayer]?.toFixed(2) ?? '—'} mm</span>}
      {ready && p.showGcodeWindow && <div className="mp-gcode"><GCodeWindow /></div>}
    </div>
    {ready && <section className="mp-controls" aria-label={t('Preview controls')}>
      <div className="mp-buttons"><button aria-haspopup="dialog" onClick={() => setSheet('controls')}>{t('Preview controls')}</button>
        <button aria-haspopup="dialog" disabled={!p.stats} onClick={() => setSheet('stats')}>
          {p.stats && <span>{formatPrintTime(p.stats.timeS)} · {p.stats.filamentG.toFixed(2)} g</span>}<small>{t('Slicing statistics')}</small>
        </button></div>
      <label>{t('Top visible layer')} <strong>{p.maxLayer + 1} / {p.layersCount}</strong>
        <input type="range" min={p.minLayer} max={Math.max(0, p.layersCount - 1)} value={p.maxLayer} aria-valuetext={`${p.maxLayer + 1} / ${p.layersCount}`}
          onChange={e => p.setLayerRangeAction(p.minLayer, Number(e.target.value))} /></label>
      <div className="mp-buttons"><button onClick={p.resetLayersAction}>{t('All layers')}</button><button onClick={resetCamera}>{t('Reset camera')}</button></div>
      {!result && <><p role="status">{t('Slice result is outdated. Please re-slice.')}</p>
        <button disabled={!canSlice || !!engineError || slicing} onClick={() => void startSlice()}>{t('Re-slice')}</button></>}
    </section>}
    <footer className="mp-footer">
      {canExport && <OutputReview />}
      <input ref={input} hidden type="file" accept=".gcode" aria-label={t('Open G-code')} onChange={e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (file) void openGcode(file);
      }} />
      {!ready && <button disabled={!p.isInitialized || loading || p.isLoading || slicing} onClick={() => input.current?.click()}>{t('Open G-code')}</button>}
      <button className="mp-primary" disabled={!canExport} onClick={() => void exportGcode()}>{t('Export G-code')}</button>
      {canExport && <button aria-haspopup="dialog" onClick={() => openSendDialog()}>{t('Send to printer')}</button>}
    </footer>
    <SendToPrinterDialog getGcode={() => {
      const current = useAppStore.getState().sliceResult;
      const activePlate = usePlatesStore.getState().activePlateIndex;
      return current && (current.plateIndex ?? activePlate) === activePlate ? current.gcode : null;
    }} defaultFilename={`${model?.name?.replace(/\.[^.]+$/, '') || 'print'}.gcode`} />
    {sheet === 'controls' && ready && <MobileSheet full title={t('Preview controls')} onClose={close} footer={<button className="mp-primary" onClick={close}>{t('Done')}</button>}>
      <MobilePreviewControls resetCamera={resetCamera} />
    </MobileSheet>}
    {sheet === 'stats' && ready && <MobileSheet full title={t('Slicing statistics')} onClose={close} footer={<button className="mp-primary" disabled={!canExport} onClick={() => void exportGcode()}>{t('Download G-code')}</button>}>
      <MobileStats />
    </MobileSheet>}
  </div>;
}
