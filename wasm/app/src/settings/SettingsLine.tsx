import React from 'react';
import { useAppStore } from '../store/appStore';
import { SettingInput } from './SettingInput';
import type { LayoutLine } from './types';
import { getSettingDocUrl } from './settingDocs';
import './settings-ui.css';
import { isModeVisible } from './visibility';
import { useTranslation } from "../i18n";

interface SettingsLineProps {
  line: LayoutLine;
  kind?: 'print' | 'filament' | 'printer';
}

export const SettingsLine: React.FC<SettingsLineProps> = ({ line, kind }) => {
  const { t } = useTranslation();
  const { configDefs, rulesState, settingsMode, highlightedKey } = useAppStore();

  const helpLink = (keys: Array<string | undefined>) => {
    const key = keys.find(key => getSettingDocUrl(key));
    const url = getSettingDocUrl(key);
    const description = key ? configDefs[key]?.tooltip : undefined;
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className="setting-help-link" title={description ? t(description) : undefined} aria-label={t("Open documentation")}>?</a>
    ) : null;
  };

  if (line.type === 'option' && line.key) {
    const def = configDefs[line.key];
    if (!isModeVisible(settingsMode, def?.mode)) return null;

    const ruleKey = line.index !== undefined ? `${line.key}#${line.index}` : line.key;
    const fieldState = rulesState.fields[ruleKey] || rulesState.fields[line.key];
    if (fieldState && fieldState.visible === false) return null;

    const displayLabel = fieldState?.label || def?.label || line.key;
    const tooltip = def?.tooltip || '';
    const isHighlighted = highlightedKey === line.key;

    return (
      <div
        id={`setting-row-${line.key}`}
        className={`setting-row ${isHighlighted ? 'highlighted-row' : ''}`}
        title={tooltip ? t(tooltip) : ''}
      >
        <label
          htmlFor={`setting-input-${line.key}`}
          className="setting-label"
          title={tooltip ? t(tooltip) : ''}
        >
          {t(displayLabel)}
          {helpLink([line.key])}
        </label>
        <SettingInput
          optionKey={line.key}
          index={line.index}
          def={def}
          fieldState={fieldState}
          kind={kind}
        />
      </div>
    );
  }

  if (line.type === 'line' && line.options && line.options.length > 0) {
    // Multi-option line
    const visibleOptions = line.options.filter((k) => {
      const def = configDefs[k];
      if (!isModeVisible(settingsMode, def?.mode)) return false;
      const fieldState = rulesState.fields[k];
      if (fieldState && fieldState.visible === false) return false;
      return true;
    });

    if (visibleOptions.length === 0) return null;

    const firstDef = configDefs[visibleOptions[0]];
    const tooltip = firstDef?.tooltip || '';
    const isHighlighted = visibleOptions.some((k) => k === highlightedKey);

    return (
      <div
        id={`setting-row-${visibleOptions[0]}`}
        className={`setting-row multi-option-row ${isHighlighted ? 'highlighted-row' : ''}`}
        title={tooltip ? t(tooltip) : ''}
      >
        <span className="setting-label" title={tooltip ? t(tooltip) : ''}>
          {t(line.label || firstDef?.label || visibleOptions[0])}
          {helpLink(visibleOptions)}
        </span>
        <div className="multi-option-inputs">
          {visibleOptions.map((optKey) => {
            const def = configDefs[optKey];
            const fieldState = rulesState.fields[optKey];
            return (
              <div key={optKey} className="inline-option-item">
                <SettingInput
                  optionKey={optKey}
                  def={def}
                  fieldState={fieldState}
                  kind={kind}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (line.type === 'custom') {
    const key = line.key;
    const def = key ? configDefs[key] : undefined;
    if (def && !isModeVisible(settingsMode, def.mode)) return null;

    const fieldState = key ? rulesState.fields[key] : undefined;
    if (fieldState && fieldState.visible === false) return null;

    return (
      <div
        id={key ? `setting-row-${key}` : undefined}
        className="setting-row custom-widget-row"
      >
        <span className="setting-label">{t(line.note || def?.label || key || 'Custom Widget')}</span>
        <span className="setting-readonly-note">
          {key && def ? (
            <SettingInput optionKey={key} def={def} fieldState={fieldState} kind={kind} />
          ) : (
            <span className="custom-summary">{t(line.note || 'Custom Setting')}</span>
          )}
        </span>
      </div>
    );
  }

  return null;
};
