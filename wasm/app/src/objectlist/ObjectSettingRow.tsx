import React from 'react';
import { useAppStore } from '../store/appStore';
import { TrashIcon } from './Icons';
import { useTranslation } from "../i18n";

interface ObjectSettingRowProps {
  optionKey: string;
  value: string;
  onChange: (newValue: string) => void;
  onRemove: () => void;
}

export const ObjectSettingRow: React.FC<ObjectSettingRowProps> = ({
  optionKey,
  value,
  onChange,
  onRemove
}) => {
  const { t } = useTranslation();
  const configDefs = useAppStore((state) => state.configDefs);
  const def = configDefs[optionKey];

  const label = def?.label || optionKey;
  const tooltip = def?.tooltip || '';
  const optType = def?.type || 'string';
  const unit = def?.sidetext || '';

  const renderInput = () => {
    if (optionKey === 'extruder') {
      const selectedFilaments = useAppStore.getState().selectedFilaments;
      const count = Math.max(1, selectedFilaments && selectedFilaments.length > 0 ? selectedFilaments.length : 1);
      const rawColors = (useAppStore.getState().currentConfig['filament_colour'] || '').split(';').map((c) => c.trim());
      const defaultColors = ['#16417C', '#58B957', '#F5D130', '#E53935', '#8E24AA', '#00ACC1', '#FB8C00', '#D81B60'];
      const currentValNum = parseInt(value || '0', 10);
      const currentColor = currentValNum > 0 ? (rawColors[currentValNum - 1] || defaultColors[(currentValNum - 1) % defaultColors.length]) : null;

      return (
        <div className="object-setting-extruder-wrap">
          {currentColor && (
            <span
              className="object-setting-swatch"
              style={{ backgroundColor: currentColor }}
            />
          )}
          <select
            id={`override-input-${optionKey}`}
            data-testid={`override-input-${optionKey}`}
            value={value || '0'}
            onChange={(e) => onChange(e.target.value)}
            className="setting-select object-setting-select"
          >
            <option value="0">{t("0: Default (Inherit)")}</option>
            {Array.from({ length: count }, (_, i) => {
              const ext = i + 1;
              const name = selectedFilaments?.[i] || `Filament ${ext}`;
              return (
                <option key={ext} value={String(ext)}>
                  {ext}: {name}
                </option>
              );
            })}
          </select>
        </div>
      );
    }

    if (optType === 'bool' || optType === 'bools') {
      const isChecked = value === '1' || value === 'true';
      return (
        <input
          type="checkbox"
          id={`override-input-${optionKey}`}
          data-testid={`override-input-${optionKey}`}
          checked={isChecked}
          onChange={(e) => onChange(e.target.checked ? '1' : '0')}
          className="setting-checkbox"
        />
      );
    }

    if ((optType === 'enum' || optType === 'enums') && def?.enumValues && def.enumValues.length > 0) {
      return (
        <select
          id={`override-input-${optionKey}`}
          data-testid={`override-input-${optionKey}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="setting-select object-setting-select-full"
        >
          {def.enumValues.map((val, idx) => (
            <option key={val} value={val}>
              {def.enumLabels && def.enumLabels[idx] ? def.enumLabels[idx] : val}
            </option>
          ))}
        </select>
      );
    }

    return (
      <div className="object-setting-value-wrap">
        <input
          type={optType === 'int' || optType === 'float' || optType === 'percent' ? 'number' : 'text'}
          id={`override-input-${optionKey}`}
          data-testid={`override-input-${optionKey}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={optType === 'int' || optType === 'float' ? 'setting-number object-setting-input' : 'setting-text object-setting-input'}
        />
        {unit && <span className="setting-unit object-setting-unit">{unit}</span>}
      </div>
    );
  };

  return (
    <div
      id={`override-row-${optionKey}`}
      data-testid={`override-row-${optionKey}`}
      className={`setting-row object-setting-row ${optType === 'bool' || optType === 'bools' ? 'object-setting-row-bool' : 'wm-field'}`}
      title={tooltip}
    >
      <label
        htmlFor={`override-input-${optionKey}`}
        className="setting-label object-setting-label wm-field-label"
        title={tooltip}
      >
        {label}
      </label>

      <div className="object-setting-controls">
        <div className="object-setting-input-wrap">{renderInput()}</div>
        <button
          type="button"
          id={`override-remove-${optionKey}`}
          data-testid={`override-remove-${optionKey}`}
          onClick={onRemove}
          aria-label={t("Remove override")}
          title={t("Remove override")}
          className="object-setting-remove-btn"
        >
          <TrashIcon size={14} />
        </button>
      </div>
    </div>
  );
};
