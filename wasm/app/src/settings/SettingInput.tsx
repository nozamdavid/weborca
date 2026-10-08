import React from 'react';
import { useAppStore } from '../store/appStore';
import type { ConfigOptionDef, FieldState } from '../engine/types';

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
  const { currentConfig, presetConfig, applyOptionChange, resetOption } = useAppStore();

  const rawVal = currentConfig[optionKey];
  const rawPresetVal = presetConfig[optionKey];

  // Helper for vector values
  const getValue = (valStr: string | undefined): string => {
    if (valStr === undefined) return def?.default || '';
    if (index !== undefined && valStr.includes(',')) {
      const parts = valStr.split(',');
      return parts[index] !== undefined ? parts[index].trim() : parts[0]?.trim() || '';
    }
    return valStr;
  };

  const currValue = getValue(rawVal);
  const baselineValue = getValue(rawPresetVal);

  const isModified = rawPresetVal !== undefined && rawVal !== undefined && currValue !== baselineValue;
  const isEnabled = fieldState?.enabled !== false;

  const handleChange = (newVal: string) => {
    // If it's a vector option with multiple items in rawVal, update only the target index
    if (index !== undefined && rawVal && rawVal.includes(',')) {
      const parts = rawVal.split(',').map((p) => p.trim());
      while (parts.length <= index) parts.push('');
      parts[index] = newVal;
      applyOptionChange(optionKey, parts.join(','), kind);
    } else {
      applyOptionChange(optionKey, newVal, kind);
    }
  };

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    resetOption(optionKey, kind);
  };

  const optType = def?.type || 'string';

  const renderControl = () => {
    if (optType === 'bool' || optType === 'bools') {
      const isChecked = currValue === '1' || currValue === 'true';
      return (
        <input
          type="checkbox"
          id={`setting-input-${optionKey}`}
          data-testid={`setting-input-${optionKey}`}
          name={optionKey}
          checked={isChecked}
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
          value={currValue}
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
          value={currValue}
          disabled={!isEnabled}
          onChange={(e) => handleChange(e.target.value)}
          className="setting-textarea font-mono"
          rows={4}
        />
      );
    }

    if (
      optType === 'int' ||
      optType === 'ints' ||
      optType === 'float' ||
      optType === 'floats'
    ) {
      const step = optType.startsWith('int') ? '1' : 'any';
      return (
        <input
          type="number"
          id={`setting-input-${optionKey}`}
          data-testid={`setting-input-${optionKey}`}
          name={optionKey}
          value={currValue}
          min={def?.min}
          max={def?.max}
          step={step}
          disabled={!isEnabled}
          onChange={(e) => handleChange(e.target.value)}
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
          {currValue || '(Custom vector)'}
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
        value={currValue}
        disabled={!isEnabled}
        onChange={(e) => handleChange(e.target.value)}
        className="setting-text"
      />
    );
  };

  return (
    <div className={`setting-control-wrapper ${isModified ? 'is-modified' : ''}`}>
      {isModified && <span className="modified-indicator" title="Modified from preset" />}
      {renderControl()}
      {def?.sidetext && <span className="setting-unit">{def.sidetext}</span>}
      {isModified && (
        <button
          type="button"
          className="reset-arrow-btn"
          data-testid={`reset-btn-${optionKey}`}
          title={`Reset to preset (${baselineValue})`}
          onClick={handleReset}
        >
          ↺
        </button>
      )}
    </div>
  );
};
