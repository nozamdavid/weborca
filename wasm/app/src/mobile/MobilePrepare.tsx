import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { usePlatesStore } from '../plates/platesStore';
import { usePlateStore } from '../plate/plateStore';
import { PlateView } from '../plate/PlateView';
import { ObjectListPanel } from '../objectlist/ObjectListPanel';
import { useTranslation } from '../i18n';
import { MobileImport, MobileSheet, mobileBusy } from './MobileShell';
import { MobileProcessSettings } from './MobileProcessSettings';
import { NumericTransform, GroupScale } from '../plate/NumericTransform';
import { useSliceReadiness } from '../shell/sliceReadiness';
import { textureTool } from '../editops/textureTool';
import { useEditOpsStore } from '../editops/editOpsStore';
import { useHistoryStore } from '../history/historyStore';
import { Icon } from '../shell/Icon';

export function MobilePrepare() {
  const { t } = useTranslation();
  const s = useAppStore();
  const plates = usePlatesStore();
  const objects = usePlateStore(state => state.objects);
  const selectedObjectId = usePlateStore(state => state.selectedObjectId);
  const selectedInstanceId = usePlateStore(state => state.selectedInstanceId);
  const extraSelection = usePlateStore(state => state.extraSelection);
  const mode = usePlateStore(state => state.gizmoMode);
  const [sheet, setSheet] = useState<'objects' | 'settings' | 'tools' | null>(null);
  const operating = useEditOpsStore(state => state.isOperating);
  const restoring = useHistoryStore(state => state.isRestoring);
  const [tools, setTools] = useState(false);
  const busy = mobileBusy(s);
  const readiness = useSliceReadiness();
  const plate = plates.plates.find(p => p.index === plates.activePlateIndex);
  const selectedObject = objects.find(object => object.id === selectedObjectId);
  const texture = textureTool(!!selectedObject, busy || operating || restoring);
  const selectedInstance = selectedObject?.instances.find(instance => instance.id === selectedInstanceId);
  const canTransform = selectedObject && selectedInstance &&
    plate?.instances.some(ref => ref.objectId === selectedObject.id && ref.instanceId === selectedInstance.id);
  const count = objects.filter(object => object.instances.some(instance => plate?.instances.some(ref => ref.objectId === object.id && ref.instanceId === instance.id))).length;
  const sliceDisabledReason = readiness || (!count ? 'Add a model to slice.' : s.engineError || '');
  return <section className="wm-prepare">
    <div className="wm-row"><h1>{t('Prepare')}</h1><span className="wm-help">{plate?.name} · {count ? t(count === 1 ? '{{count}} object' : '{{count}} objects', { count }) : t('Empty')}</span></div>
    <div className="wm-prepare-scroll">
      <div className={`wm-viewport ${tools ? 'wm-tools-open' : ''}`}><PlateView /></div>
      {tools && canTransform && extraSelection.length > 0 && mode === 'scale' && <GroupScale disabled={busy} idPrefix="mobile-nt" />}
      {tools && canTransform && !extraSelection.length && (mode === 'translate' || mode === 'scale') && <NumericTransform
        object={selectedObject} instance={selectedInstance} mode={mode === 'translate' ? 'move' : 'scale'} idPrefix="mobile-nt" />}
      <div className="wm-prepare-tools-row">
        <button aria-expanded={tools} onClick={() => { setTools(!tools); window.dispatchEvent(new Event('resize')); }}>{t('Plate tools')}</button>
        <button aria-haspopup="dialog" onClick={() => setSheet('tools')}>{t('Tools')}</button>
      </div>
      <button className="wm-row" aria-haspopup="dialog" onClick={() => setSheet('objects')}><strong>{t('Objects')} · {objects.length}</strong><span>{t('Open')} ›</span></button>
      <section className="wm-card"><div className="wm-row"><h2>{t('Process Settings')}</h2><button aria-haspopup="dialog" onClick={() => setSheet('settings')}>{t('Settings')}</button></div>
        <dl className="wm-prepare-presets">
          <div><dt>{t('Printer')}</dt><dd>{s.selectedPrinter || '—'}</dd></div>
          <div><dt>{t('Process')}</dt><dd>{s.selectedProcess || t('No process preset selected')}</dd></div>
          <div><dt>{t('Filament')}</dt><dd>{s.selectedFilaments.join(', ') || s.selectedFilament || t('No filament selected')}</dd></div>
        </dl>
      </section>
    </div>
    <div className="wm-prepare-actions">
      <div className="wm-prepare-action-row">
        <MobileImport disabled={busy} primary={count === 0} />
        <button className={count > 0 ? 'wm-primary' : undefined} disabled={!!sliceDisabledReason} aria-describedby={sliceDisabledReason ? 'mobile-slice-readiness' : undefined}
          onClick={() => void plates.slicePlate(plates.activePlateIndex)}>{t('Slice plate')}</button>
      </div>
      {sliceDisabledReason && <p id="mobile-slice-readiness" className="wm-help">{t(sliceDisabledReason)}</p>}
    </div>
    {sheet === 'tools' && <MobileSheet title={t('Tools')} onClose={() => setSheet(null)}>
      <button className="wm-tool-action" disabled={texture.disabled} title={t(texture.label)} onClick={() => { setSheet(null); texture.onClick(); }}><Icon name={texture.icon as string} />{t(texture.label)}</button>
    </MobileSheet>}
    {sheet === 'objects' && <MobileSheet title={`${t('Objects')} · ${objects.length}`} onClose={() => setSheet(null)}>
      {objects.length ? <ObjectListPanel hideHeader /> : <div className="wm-empty"><h2>{t('No objects yet')}</h2><p>{t('Add a model to arrange it on the plate and edit its settings.')}</p><MobileImport disabled={busy} onImported={() => setSheet(null)} /></div>}
    </MobileSheet>}
    {sheet === 'settings' && <MobileProcessSettings onClose={() => setSheet(null)} />}
  </section>;
}
