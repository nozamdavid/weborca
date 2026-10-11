import React, { useEffect, useState } from 'react';
import { useAppStore, pendingOptionKey } from '../store/appStore';
import type { ConfigOptionDef, FieldState } from '../engine/types';
import { useTranslation } from '../i18n';
import { getOption } from '../engine/orcaEngine';
import { resolveSlotValue, extractScalarCell, getOptionStride } from './slotValue';

interface SettingInputProps {
  optionKey: string;
  index?: number;
  def?: ConfigOptionDef;
  fieldState?: FieldState;
  kind?: 'print' | 'filament' | 'printer';
}

export const SettingInput: React.FC<SettingInputProps> = ({
  optionKey,
  index,
  def,
  fieldState,
  kind
}) => {
  const { t } = useTranslation();
  const {
    currentConfig,
    pendingOptions,
    presetConfig,
    applyOptionChange,
    resetOption,
    activeFilamentSlot,
    selectedFilaments,
    activeDialog,
    isSelectingPreset
  } = useAppStore();

  const isFilament = kind === 'filament' || (activeDialog === 'filament' && kind !== 'print' && kind !== 'printer');
  const filamentSlot = isFilament ? (activeFilamentSlot ?? 0) : undefined;
  const layoutIdx = index;

  const rawVal = currentConfig[optionKey];
  const rawPresetVal = presetConfig[optionKey];

  const targetKey = `${optionKey}:${filamentSlot !== undefined ? filamentSlot : ''}:${layoutIdx !== undefined ? layoutIdx : ''}`;

  const [nativeCurrent, setNativeCurrent] = useState<{ targetKey: string; rawVal?: string; value: string } | null>(null);
  const [nativeBaseline, setNativeBaseline] = useState<{ targetKey: string; rawPresetVal?: string; value: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const shouldProject = isFilament || layoutIdx !== undefined || def?.type === 'string';
    if (!shouldProject) {
      return;
    }

    getOption({ key: optionKey, filamentIndex: filamentSlot, layoutIndex: layoutIdx })
      .then(res => {
        if (!cancelled && res?.value !== undefined) {
          setNativeCurrent({ targetKey, rawVal, value: res.value });
        }
      })
      .catch(() => {});

    if (rawPresetVal !== undefined && rawPresetVal.trim() !== '') {
      getOption({
        key: optionKey,
        filamentIndex: filamentSlot,
        layoutIndex: layoutIdx,
        serializedValue: rawPresetVal
      })
        .then(res => {
          if (!cancelled && res?.value !== undefined) {
            setNativeBaseline({ targetKey, rawPresetVal, value: res.value });
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [targetKey, optionKey, filamentSlot, layoutIdx, rawVal, rawPresetVal, isFilament, def?.type]);

  const effectiveNativeCurrent = (nativeCurrent && nativeCurrent.targetKey === targetKey && nativeCurrent.rawVal === rawVal)
    ? nativeCurrent.value
    : null;

  const effectiveNativeBaseline = (nativeBaseline && nativeBaseline.targetKey === targetKey && nativeBaseline.rawPresetVal === rawPresetVal)
    ? nativeBaseline.value
    : null;

  const extrudersCount = Math.max(1, (currentConfig['nozzle_diameter'] || '').split(',').length);
  const totalSlots = Math.max(
    1,
    selectedFilaments?.length || (currentConfig['filament_colour'] ? currentConfig['filament_colour'].split(';').length : 1)
  );

  const isNumericVector = /^(?:ints?|floats?|percents?|floats?OrPercents?)$/.test(def?.type ?? '');

  const fallbackCurrent = isFilament && isNumericVector
    ? resolveSlotValue({
        rawVal,
        filamentSlot: filamentSlot ?? 0,
        layoutIndex: layoutIdx,
        totalSlots,
        extrudersCount,
        defaultValue: def?.default ?? ''
      })
    : (rawVal ?? def?.default ?? '');

  const fallbackBaseline = isFilament && isNumericVector
    ? resolveSlotValue({
        rawVal: rawPresetVal,
        filamentSlot: filamentSlot ?? 0,
        layoutIndex: layoutIdx,
        totalSlots,
        extrudersCount,
        defaultValue: def?.default ?? ''
      })
    : (rawPresetVal ?? def?.default ?? '');

  // Commas in G-code and other strings are content, not numeric vector separators.
  const projectedCurrent = isNumericVector ? extractScalarCell(effectiveNativeCurrent, layoutIdx) : effectiveNativeCurrent;
  const projectedBaseline = isNumericVector ? extractScalarCell(effectiveNativeBaseline, layoutIdx) : effectiveNativeBaseline;

  const needsProjection = isFilament || layoutIdx !== undefined || def?.type === 'string';
  const serverValue = needsProjection
    ? (projectedCurrent !== null && projectedCurrent !== '' ? projectedCurrent : fallbackCurrent)
    : (rawVal ?? def?.default ?? '');

  const baselineValue = needsProjection
    ? (projectedBaseline !== null && projectedBaseline !== '' ? projectedBaseline : fallbackBaseline)
    : (rawPresetVal ?? def?.default ?? '');

  // Keep the draft until blur. An intermediate native acknowledgement must not
  // disable the field while the next keystroke is still being processed.
  const [localInput, setLocalInput] = useState<{ targetKey: string; value: string } | null>(null);
  useEffect(() => { setLocalInput(null); }, [targetKey, rawPresetVal]);

  const pending = pendingOptions[pendingOptionKey(kind ?? (isFilament ? 'filament' : activeDialog === 'printer' ? 'printer' : 'print'), optionKey, filamentSlot, layoutIdx)];
  const pendingValue = pending ? (isNumericVector ? extractScalarCell(pending.value, 0) ?? pending.value : pending.value) : serverValue;
  const displayValue = (localInput && localInput.targetKey === targetKey)
    ? localInput.value
    : pendingValue;

  const isModified = Boolean(
    baselineValue !== '' &&
    (serverValue !== baselineValue || displayValue !== baselineValue)
  );
  const isEnabled = !isSelectingPreset && fieldState?.enabled !== false;

  const stride = isNumericVector ? getOptionStride(rawVal, totalSlots, extrudersCount) : 1;

  const handleChange = (newVal: string) => {
    const payload = (isFilament && layoutIdx === undefined && stride > 1)
      ? Array(stride).fill(newVal).join(',')
      : newVal;
    applyOptionChange(optionKey, payload, isFilament ? 'filament' : kind, index);
  };

  const handleInputChange = (newVal: string) => {
    setLocalInput({ targetKey, value: newVal });
    // Clearing a number is an intermediate editing state, not an engine value.
    if (!newVal.trim() && /^(?:ints?|floats?|percents?|floats?OrPercents?)$/.test(def?.type ?? '')) return;
    handleChange(newVal);
  };

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLocalInput(null);
    resetOption(optionKey, isFilament ? 'filament' : kind, index);
  };

  const optType = def?.type || 'string';

  const renderControl = () => {
    if (optType === 'bool' || optType === 'bools') {
      const isChecked = displayValue === '1' || displayValue === 'true';
      return (
        <input
          type="checkbox"
          id={`setting-input-${optionKey}`}
          data-testid={`setting-input-${optionKey}`}
          name={optionKey}
          checked={isChecked}
          aria-busy={Boolean(pending)}
          disabled={!isEnabled}
          onChange={(e) => handleChange(e.target.checked ? '1' : '0')}
          className="setting-checkbox"
        />
      );
    }

    if ((optType === 'enum' || optType === 'enums') && def?.enumValues && def.enumValues.length > 0) {
      return (
        <select
          id={`setting-input-${optionKey}`}
          data-testid={`setting-input-${optionKey}`}
          name={optionKey}
          value={displayValue}
          aria-busy={Boolean(pending)}
          disabled={!isEnabled}
          onChange={(e) => handleChange(e.target.value)}
          className="setting-select"
        >
          {def.enumValues.map((val, idx) => (
            <option key={val} value={val}>
              {def.enumLabels && def.enumLabels[idx] ? def.enumLabels[idx] : val}
            </option>
          ))}
        </select>
      );
    }

    if (def?.multiline) {
      return (
        <textarea
          id={`setting-input-${optionKey}`}
          data-testid={`setting-input-${optionKey}`}
          name={optionKey}
          value={displayValue}
          onBlur={() => setLocalInput(null)}
          disabled={!isEnabled}
          onChange={(e) => handleInputChange(e.target.value)}
          className="setting-textarea font-mono"
          rows={4}
        />
      );
    }

    if (
      optType === 'int' ||
      optType === 'float' ||
      ((optType === 'ints' || optType === 'floats') && (index !== undefined || isFilament)) ||
      ((optType === 'ints' || optType === 'floats') && index === undefined && serverValue && !serverValue.includes(','))
    ) {
      const step = optType.startsWith('int') ? '1' : 'any';
      return (
        <input
          type="number"
          id={`setting-input-${optionKey}`}
          data-testid={`setting-input-${optionKey}`}
          name={optionKey}
          value={displayValue}
          onBlur={() => setLocalInput(null)}
          min={def?.min}
          max={def?.max}
          step={step}
          disabled={!isEnabled}
          onChange={(e) => handleInputChange(e.target.value)}
          className="setting-number"
        />
      );
    }

    if (
      optType.startsWith('point') ||
      optType === 'pointsGroups' ||
      optType === 'intsGroups'
    ) {
      return (
        <span className="setting-readonly" data-testid={`setting-input-${optionKey}`}>
          {serverValue || '(Custom vector)'}
        </span>
      );
    }

    // Default text input for strings, percent, floatOrPercent
    return (
      <input
        type="text"
        id={`setting-input-${optionKey}`}
        data-testid={`setting-input-${optionKey}`}
        name={optionKey}
        value={displayValue}
        onBlur={() => setLocalInput(null)}
        disabled={!isEnabled}
        onChange={(e) => handleInputChange(e.target.value)}
        className="setting-text"
      />
    );
  };

  return (
    <div className={`setting-control-wrapper ${isModified ? 'is-modified' : ''}`}>
      {isModified && <span className="modified-indicator" title={t("Modified from preset")} />}
      {renderControl()}
      {def?.sidetext && <span className="setting-unit">{def.sidetext}</span>}
      {isModified && (
        <button
          type="button"
          className="reset-arrow-btn"
          data-testid={`reset-btn-${optionKey}`}
          title={t('Reset to preset ({{value}})', { value: baselineValue })}
          onClick={handleReset}
          disabled={isSelectingPreset}
        >
          ↺
        </button>
      )}
    </div>
  );
};
