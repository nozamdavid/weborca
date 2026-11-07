import { MobileInput } from '../mobile/MobileInput';
import { MobileSelect } from '../mobile/MobileSelect';
import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useObjectListStore } from '../objectlist/objectListStore';
import { usePlatesStore } from '../plates/platesStore';
import { useTranslation } from '../i18n';

export const contextKeys = ['extruder', 'flush_into_objects', 'first_layer_sequence_choice', 'other_layers_sequence_choice'];

function effectiveFlushValue(objectConfig: Record<string, string> | undefined, currentConfig: Record<string, string>) {
  return objectConfig?.flush_into_objects ?? currentConfig.flush_into_objects ?? '0';
}

export function MobileContextSummary({ optionKey }: { optionKey: string }) {
  const { t } = useTranslation();
  const objects = useObjectListStore(state => state.objects);
  const currentConfig = useAppStore(state => state.currentConfig);
  const { plates, activePlateIndex } = usePlatesStore();
  const plate = plates.find(plate => plate.index === activePlateIndex);
  const isObject = optionKey === 'extruder' || optionKey === 'flush_into_objects';
  const sequenceKey = optionKey === 'first_layer_sequence_choice' ? 'first_layer_print_sequence' : 'other_layers_print_sequence';
  return <p><code>{optionKey}</code>: {isObject ? objects.filter(object => plate?.instances.some(instance => instance.objectId === object.id))
    .map(object => `${object.name}: ${optionKey === 'extruder' ? object.volumes.map(volume => volume.extruder).join(',') : effectiveFlushValue(object.config, currentConfig)}`).join('; ') :
    `${plate?.name}: ${plate?.config[sequenceKey] || t('Auto')}`}</p>;
}

export function MobileContextSetting({ optionKey, onValidityChange }: { optionKey: string; onValidityChange: (valid: boolean) => void }) {
  const { t } = useTranslation();
  const app = useAppStore();
  const objects = useObjectListStore();
  const plates = usePlatesStore();
  const [target, setTarget] = useState<number | null>(null);
  const [volumeId, setVolumeId] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const isObject = optionKey === 'extruder' || optionKey === 'flush_into_objects';
  const plate = plates.plates.find(plate => plate.index === plates.activePlateIndex);
  const candidates = objects.objects.filter(object => plate?.instances.some(instance => instance.objectId === object.id));
  const object = candidates.find(object => object.id === target);
  const volume = volumeId !== null ? object?.volumes.find(volume => volume.id === volumeId) : object?.volumes[0];
  const def = app.configDefs[optionKey];
  const sequenceKey = optionKey === 'first_layer_sequence_choice' ? 'first_layer_print_sequence' : 'other_layers_print_sequence';
  const savedSequence = plate?.config[sequenceKey];
  const custom = !!savedSequence && savedSequence !== '0' &&
    (sequenceKey === 'first_layer_print_sequence' || Number(plate?.config.other_layers_print_sequence_nums) > 0);
  const mixed = !isObject && (app.rulesState.fields[optionKey]?.enabled === false || app.currentConfig.filament_is_mixed?.split(',').includes('1'));
  const disabled = mixed || optionKey === 'flush_into_objects' && app.rulesState.fields[optionKey]?.enabled === false;
  const unavailable = ready && (!def || disabled || (isObject ? !candidates.length : !plate));
  useEffect(() => {
    let live = true;
    void (async () => {
      await usePlatesStore.getState().fetchPlates();
      await useObjectListStore.getState().refreshTree();
      if (live) setReady(true);
    })().catch(error => { if (live) { setError(String(error)); setReady(true); } });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!object) {
      const id = candidates[0]?.id ?? null;
      setTarget(id);
      setVolumeId(null);
      if (id !== null) objects.selectItem(id);
    }
  }, [object, candidates.map(object => object.id).join(',')]);
  useEffect(() => { onValidityChange(!busy && !error && (unavailable || ready && (!isObject || !!object))); },
    [busy, error, unavailable, ready, isObject, object, onValidityChange]);
  const write = async (value: string) => {
    setDraft(value);
    setBusy(true);
    setError('');
    try {
      if (isObject && object) {
        const result = await objects.setObjectConfig(object.id, optionKey === 'extruder' ? volumeId : null, { [optionKey]: value });
        if (result.errors.length) throw new Error(result.errors.map(error => error.error).join(', '));
      } else if (plate) {
        // Choice fields are desktop UI controls. Slicing consumes the sequence
        // arrays, not the choice enum. Preserve saved custom ranges/orders.
        const order = app.selectedFilaments.map((_, index) => index + 1).join(',') || '1';
        const first = sequenceKey === 'first_layer_print_sequence';
        // ConfigOptionInts reserves INT_MAX for nil and cannot serialize it.
        // Use the largest serializable layer number for the initial range.
        const sequence = value === 'Auto' ? '' : custom ? savedSequence! : first ? order : `2,2147483646,${order}`;
        await plates.setPlateConfig(plate.index, { [sequenceKey]: sequence,
          ...(!first ? { other_layers_print_sequence_nums: value === 'Auto' ? '0' : custom ? plate.config.other_layers_print_sequence_nums : '1' } : {}) });
        if (usePlatesStore.getState().error) throw new Error(usePlatesStore.getState().error!);
      }
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); setDraft(null); }
  };
  return <div className="mobile-setting" data-mobile-key={optionKey} data-kind="print" data-context={isObject ? 'object' : 'plate'}
    data-widget={!ready ? 'loading' : unavailable ? 'skip' : optionKey === 'flush_into_objects' ? 'checkbox' : 'select'}>
    <h2 className="ds-title ds-title--page">{t(def?.label || optionKey)}</h2><p>{t(def?.tooltip || '')}</p>
    {unavailable ? <p role="status">{t(disabled ? 'Disabled by the current settings' : 'Not available in the current configuration')}. {t('This step will be skipped.')}</p> : ready && <>
      {isObject ? <><label htmlFor="mobile-object-target">{t('Object')}</label>
        <MobileSelect id="mobile-object-target" value={target ?? ''} disabled={busy} onValueChange={value => {
          const id = Number(value); setTarget(id); setVolumeId(null); objects.selectItem(id);
        }}>
          {candidates.map((object, index) => <option key={object.id} value={object.id}>{index + 1}: {object.name}</option>)}
        </MobileSelect>{optionKey === 'extruder' && <><label htmlFor="mobile-part-target">{t('Part')}</label>
          <MobileSelect id="mobile-part-target" value={volumeId ?? ''} disabled={busy || !object} onValueChange={value => {
            const id = value === '' ? null : Number(value);
            setVolumeId(id); if (object) objects.selectItem(object.id, id);
          }}>
            <option value="">{t('Object')}</option>
            {object?.volumes.map((volume, index) => <option key={volume.id} value={volume.id}>{index + 1}: {volume.name}</option>)}
          </MobileSelect></>}
        <p>{t(optionKey === 'extruder' ? volumeId !== null ? 'Applies to this part in all instances of this object, including other plates.' : 'Applies to all parts and instances of this object, including other plates.' : 'Applies to all instances of this object, including other plates.')}</p></> :
        <><p>{t('Current plate')}: {plate?.name}</p><p>{t('Customize uses the saved sequence, or the current filament order.')}</p></>}
      <div className="mobile-setting-cell" data-cell="0">
        {optionKey === 'flush_into_objects' ? <MobileInput id={`setting-input-${optionKey}`} aria-label={t(def?.label || optionKey)} type="checkbox" disabled={busy || !object}
          checked={(draft ?? effectiveFlushValue(object?.config, app.currentConfig)) === '1'} onChange={event => void write(event.target.checked ? '1' : '0')} /> :
          <MobileSelect id={`setting-input-${optionKey}`} aria-label={t(def?.label || optionKey)} disabled={busy || isObject && !object} value={draft ?? (isObject ? String(volume?.extruder ?? 0) : custom ? 'Customize' : 'Auto')}
            onValueChange={value => void write(value)}>
            {isObject ? <><option value="0">{t('Inherit')}</option>{app.selectedFilaments.map((name, index) =>
              <option key={index} value={index + 1}>{index + 1}: {name}</option>)}</> :
              def?.enumValues?.map((value, index) => <option key={value} value={value}>{t(def.enumLabels?.[index] ?? value)}</option>)}
          </MobileSelect>}
      </div>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
