import { MobileInput } from '../mobile/MobileInput';
import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { SettingInput } from '../settings/SettingInput';
import { useTranslation } from '../i18n';
import { classifySetting, settingKind, vectorTypes, geometryTypes, geometryFormats, validGeometry } from './mobileConfig';
import { getOption } from '../engine/orcaEngine';
import { MobileContextSetting, contextKeys } from './MobileContextSetting';

function HeightEditor({ onValidityChange }: { onValidityChange: (valid: boolean) => void }) {
  const { t } = useTranslation();
  const { currentConfig, configDefs, applyOptionChange } = useAppStore();
  const key = 'extruder_printable_height';
  const value = currentConfig[key];
  const def = configDefs[key];
  const [drafts, setDrafts] = useState(value.split(','));
  useEffect(() => { setDrafts(value.split(',')); }, [value]);
  const valid = (value: string) => /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) &&
    Number.isFinite(Number(value)) && Number(value) >= Math.max(0, def.min ?? 0) && Number(value) <= (def.max ?? Infinity);
  useEffect(() => { onValidityChange(drafts.every(valid)); }, [drafts, def.min, def.max, onValidityChange]);
  return <>{drafts.map((draft, index) => <div key={index} className="mobile-setting-cell" data-cell={index}>
    <label htmlFor={`mobile-height-${index}`}>{t('Value')} {index + 1} ({t('mm')})</label>
    <MobileInput id={`mobile-height-${index}`} type="text" inputMode="decimal" value={draft} aria-invalid={!valid(draft)}
      onChange={e => setDrafts(values => values.map((value, cell) => cell === index ? e.target.value : value))}
      onBlur={() => { if (drafts.every(valid) && draft !== value.split(',')[index]) void applyOptionChange(key, draft.trim(), 'printer', index); }} />
    {!valid(draft) && <p role="alert">{t('Enter a finite height between {{min}} and {{max}} mm.', { min: Math.max(0, def.min ?? 0), max: def.max ?? Infinity })}</p>}
  </div>)}</>;
}

function TextValueInput({ optionKey, index, kind, multiline }: { optionKey: string; index?: number; kind?: 'print' | 'filament' | 'printer'; multiline?: boolean }) {
  const raw = useAppStore(s => s.currentConfig[optionKey]);
  const slot = useAppStore(s => s.activeFilamentSlot);
  const apply = useAppStore(s => s.applyOptionChange);
  const [value, setValue] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void getOption({ key: optionKey, layoutIndex: index, filamentIndex: kind === 'filament' ? slot : undefined })
      .then(result => { if (live) setValue(result.value); });
    return () => { live = false; };
  }, [optionKey, index, kind, slot, raw]);
  const props = { id: `setting-input-${optionKey}`, value: draft ?? value ?? '', disabled: value === null,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(e.target.value);
      void apply(optionKey, e.target.value, kind, index);
    }, onBlur: () => setDraft(null) };
  return multiline ? <textarea className="ds-input" {...props} rows={4} /> : <MobileInput {...props} type="text" />;
}

function SerializedInput({ optionKey, type, kind, nullable, onValidityChange }: { optionKey: string; type: string; nullable?: boolean; kind?: 'print' | 'filament' | 'printer'; onValidityChange: (valid: boolean) => void }) {
  const { t } = useTranslation();
  const value = useAppStore(s => s.currentConfig[optionKey] ?? '');
  const apply = useAppStore(s => s.applyOptionChange);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const valid = geometryTypes.includes(type) ? validGeometry(type, draft) : draft === '' ||
    type === 'strings' || draft.split(',').every(cell =>
      nullable && cell === 'nil' || (type === 'bools' ? /^[01]$/.test(cell) : type === 'enums' ? true :
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?$/.test(cell.trim()) && Number.isFinite(Number(cell.replace(/%$/, '')))));
  useEffect(() => { onValidityChange(valid); }, [valid, onValidityChange]);
  return <><label htmlFor={`setting-input-${optionKey}`}>{t(geometryTypes.includes(type) ? 'Coordinate format' : 'Serialized values')}: <code>{geometryFormats[type] ?? '1,2,3'}</code></label>
    <textarea className="ds-input" id={`setting-input-${optionKey}`} value={draft} rows={4} aria-invalid={!valid}
      onChange={e => setDraft(e.target.value)} onBlur={() => {
        if (valid && draft !== value) void apply(optionKey, draft, kind, undefined, null);
      }} />
    {!valid && <p role="alert">{t('Enter finite numbers in the shown format.')}</p>}</>;
}

export function MobileSetting(props: { optionKey: string; onValidityChange: (valid: boolean) => void }) {
  return contextKeys.includes(props.optionKey) ? <MobileContextSetting {...props} /> : <GlobalMobileSetting {...props} />;
}

function GlobalMobileSetting({ optionKey, onValidityChange }: { optionKey: string; onValidityChange: (valid: boolean) => void }) {
  const { t } = useTranslation();
  const { configDefs, layout, currentConfig, rulesState, activeFilamentSlot, selectedFilaments, selectedPrinter } = useAppStore();
  const def = configDefs[optionKey];
  const kind = settingKind(optionKey, layout);
  const field = rulesState.fields[optionKey];
  const classification = currentConfig[optionKey] === undefined && def ? { widget: 'skip', reason: 'Not available in the current configuration' } : classifySetting(def, kind, field, optionKey);
  const vector = def && vectorTypes[def.type];
  const [count, setCount] = useState(0);
  const [projectionError, setProjectionError] = useState('');
  const [emptyVector, setEmptyVector] = useState(false);
  // Native getOption/setOption project each vector cell and preserve its siblings.
  useEffect(() => {
    let live = true;
    setProjectionError('');
    onValidityChange(true);
    setEmptyVector(false);
    setCount(vector ? 0 : 1);
    if (vector && !classification.reason) void (async () => {
      let cells = 0;
      try {
        // Ask the native serializer for the size, since string cells can contain separators.
        for (;; cells++) await getOption({ key: optionKey, layoutIndex: cells,
          filamentIndex: kind === 'filament' ? activeFilamentSlot : undefined });
      } catch (error) {
        if (live) {
          setCount(cells);
          if (!cells && String(error).includes('Invalid layout index')) { setEmptyVector(true); setCount(1); }
          else if (!cells) setProjectionError(String(error));
        }
      }
    })();
    return () => { live = false; };
  }, [optionKey, vector, kind, activeFilamentSlot, classification.reason, selectedFilaments.length, selectedPrinter]);
  const hasEditableCell = Array.from({ length: count }, (_, index) =>
    classifySetting(def, kind, rulesState.fields[`${optionKey}#${index}`] ?? field, optionKey)).some(cell => !cell.reason);
  return <div className="mobile-setting" data-mobile-key={optionKey} data-kind={kind}
    data-vector-whole={emptyVector || undefined}
    data-widget={classification.reason || projectionError ? 'skip' : count === 0 ? 'loading' : !hasEditableCell ? 'skip' : emptyVector ? 'textarea' : classification.widget}>
    <h2 className="ds-title ds-title--page">{t(field?.label || def?.label || optionKey)}</h2>
    <p>{t(def?.tooltip || '')}</p>
    {projectionError && <p role="status">{t('No editable vector values')}: {projectionError}</p>}
    {classification.reason ? <p role="status">{t(classification.reason, { type: def?.type ?? '' })}: <code>{optionKey}</code>. {t('This step will be skipped.')}</p> :
      optionKey === 'extruder_printable_height' ? <HeightEditor onValidityChange={onValidityChange} /> : Array.from({ length: count }, (_, index) => {
        const indexedField = rulesState.fields[`${optionKey}#${index}`] ?? field;
        const indexed = classifySetting(def, kind, indexedField);
        const scalarType = vector ?? def.type;
        const inputDef = def.nullable && scalarType === 'bool'
          ? { ...def, type: 'enum', enumValues: ['nil', '0', '1'], enumLabels: [t('Inherit'), t('Disabled'), t('Enabled')] }
          : { ...def, type: def.nullable && ['float', 'int', 'percent', 'floatOrPercent'].includes(scalarType) ? 'floatOrPercent' : scalarType };
        return <div key={index} className="mobile-setting-cell" data-cell={index}>
          {vector && <span>{t('Value')} {index + 1}</span>}
          {indexed.reason ? <p role="status">{t(indexed.reason, { type: def.type })}</p> : geometryTypes.includes(def.type) || emptyVector ?
            <SerializedInput optionKey={optionKey} type={def.type} kind={kind} nullable={def.nullable} onValidityChange={onValidityChange} /> : (vector ?? def.type) === 'string' ?
            <TextValueInput optionKey={optionKey} index={vector ? index : undefined} kind={kind} multiline={def.multiline} /> : <SettingInput
            optionKey={optionKey} index={vector ? index : undefined}
            def={inputDef} kind={kind} fieldState={indexedField} />}
        </div>;
      })}
  </div>;
}
