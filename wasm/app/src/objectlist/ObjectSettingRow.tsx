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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
          {currentColor && (
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: currentColor,
                flexShrink: 0
              }}
            />
          )}
          <select
            id={`override-input-${optionKey}`}
            data-testid={`override-input-${optionKey}`}
            value={value || '0'}
            onChange={(e) => onChange(e.target.value)}
            className="setting-select"
            style={{ flex: 1, fontSize: '0.8rem' }}
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
          className="setting-select"
          style={{ width: '100%', fontSize: '0.8rem' }}
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
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 4 }}>
        <input
          type={optType === 'int' || optType === 'float' || optType === 'percent' ? 'number' : 'text'}
          id={`override-input-${optionKey}`}
          data-testid={`override-input-${optionKey}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={optType === 'int' || optType === 'float' ? 'setting-number' : 'setting-text'}
          style={{ flex: 1, minWidth: 60, fontSize: '0.8rem' }}
        />
        {unit && <span className="setting-unit" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
    );
  };

  return (
    <div
      id={`override-row-${optionKey}`}
      data-testid={`override-row-${optionKey}`}
      className="setting-row"
      title={tooltip}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 8px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        gap: 8
      }}
    >
      <label
        htmlFor={`override-input-${optionKey}`}
        className="setting-label"
        style={{
          flex: '0 0 45%',
          fontSize: '0.8rem',
          color: 'var(--text-color)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
        title={tooltip}
      >
        {label}
      </label>

      <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1 }}>{renderInput()}</div>
        <button
          type="button"
          id={`override-remove-${optionKey}`}
          data-testid={`override-remove-${optionKey}`}
          onClick={onRemove}
          title={t("Remove override")}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          <TrashIcon size={14} />
        </button>
      </div>
    </div>
  );
};
