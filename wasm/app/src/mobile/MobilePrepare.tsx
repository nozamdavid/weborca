import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { usePlatesStore } from '../plates/platesStore';
import { usePlateStore } from '../plate/plateStore';
import { PlateView } from '../plate/PlateView';
import { ObjectListPanel } from '../objectlist/ObjectListPanel';
import { useTranslation } from '../i18n';
import { MobileImport, MobileSheet, mobileBusy } from './MobileShell';
import { MobileProcessSettings } from './MobileProcessSettings';
import { NumericTransform } from '../plate/NumericTransform';
import { useSliceReadiness } from '../shell/sliceReadiness';

export function MobilePrepare() {
  const { t } = useTranslation();
  const s = useAppStore();
  const plates = usePlatesStore();
  const objects = usePlateStore(state => state.objects);
  const selectedObjectId = usePlateStore(state => state.selectedObjectId);
  const selectedInstanceId = usePlateStore(state => state.selectedInstanceId);
  const extraSelection = usePlateStore(state => state.extraSelection);
  const mode = usePlateStore(state => state.gizmoMode);
  const [sheet, setSheet] = useState<'objects' | 'settings' | null>(null);
  const [tools, setTools] = useState(false);
  const busy = mobileBusy(s);
  const readiness = useSliceReadiness();
  const plate = plates.plates.find(p => p.index === plates.activePlateIndex);
  const selectedObject = objects.find(object => object.id === selectedObjectId);
  const selectedInstance = selectedObject?.instances.find(instance => instance.id === selectedInstanceId);
  const canTransform = selectedObject && selectedInstance && !extraSelection.length &&
    plate?.instances.some(ref => ref.objectId === selectedObject.id && ref.instanceId === selectedInstance.id);
  const count = objects.filter(object => object.instances.some(instance => plate?.instances.some(ref => ref.objectId === object.id && ref.instanceId === instance.id))).length;
  const sliceDisabledReason = readiness || (!count ? 'Add a model to slice.' : s.engineError || '');
  return <section className="wm-prepare">
    <div className="wm-row"><h1>{t('Prepare')}</h1><span className="wm-help">{plate?.name} · {count ? t(count === 1 ? '{{count}} object' : '{{count}} objects', { count }) : t('Empty')}</span></div>
    <div className={`wm-viewport ${tools ? 'wm-tools-open' : ''}`}><PlateView /></div>
    {tools && canTransform && (mode === 'translate' || mode === 'scale') && <NumericTransform
      object={selectedObject} instance={selectedInstance} mode={mode === 'translate' ? 'move' : 'scale'} idPrefix="mobile-nt" />}
    <button aria-expanded={tools} onClick={() => { setTools(!tools); window.dispatchEvent(new Event('resize')); }}>{t('Plate tools')}</button>
    <button className="wm-row" aria-haspopup="dialog" onClick={() => setSheet('objects')}><strong>{t('Objects')} · {objects.length}</strong><span>{t('Open')} ›</span></button>
    <section className="wm-card"><div className="wm-row"><h2>{t('Process Settings')}</h2><button aria-haspopup="dialog" onClick={() => setSheet('settings')}>{t('Settings')}</button></div>
      <p>{s.selectedProcess || t('No process preset selected')}</p><small>{s.selectedFilaments.join(', ') || s.selectedFilament || t('No filament selected')}</small>
    </section>
    <MobileImport disabled={busy} />
    <button className="wm-primary" disabled={!!sliceDisabledReason} aria-describedby={sliceDisabledReason ? 'mobile-slice-readiness' : undefined}
      onClick={() => void plates.slicePlate(plates.activePlateIndex)}>{t('Slice plate')}</button>
    {sliceDisabledReason && <p id="mobile-slice-readiness" className="wm-help">{t(sliceDisabledReason)}</p>}
    {sheet === 'objects' && <MobileSheet title={`${t('Objects')} · ${objects.length}`} onClose={() => setSheet(null)}>
      {objects.length ? <ObjectListPanel /> : <div className="wm-empty"><h2>{t('No objects yet')}</h2><p>{t('Add a model to arrange it on the plate and edit its settings.')}</p><MobileImport disabled={busy} onImported={() => setSheet(null)} /></div>}
    </MobileSheet>}
    {sheet === 'settings' && <MobileProcessSettings onClose={() => setSheet(null)} />}
  </section>;
}
