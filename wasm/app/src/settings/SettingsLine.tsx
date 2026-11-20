import React, { useId, useState } from 'react';
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
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();

  const helpLink = (keys: Array<string | undefined>) => {
    const key = keys.find(key => getSettingDocUrl(key));
    const url = getSettingDocUrl(key);
    const description = key ? configDefs[key]?.tooltip : undefined;
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className="setting-help-link" title={description ? t(description) : undefined} aria-label={t("Open documentation")}>?</a>
    ) : null;
  };

  const renderMobileHelp = (label: string, tooltip: string, keys: Array<string | undefined>) => {
    const docKey = keys.find(key => getSettingDocUrl(key));
    const docUrl = getSettingDocUrl(docKey);
    const resolvedTooltip = (tooltip && tooltip.trim() ? tooltip : undefined)
      || (docKey && configDefs[docKey]?.tooltip?.trim() ? configDefs[docKey]?.tooltip : undefined)
      || keys.map(key => (key ? configDefs[key]?.tooltip : undefined)).find(tip => Boolean(tip && tip.trim()))
      || '';
    if (!resolvedTooltip && !docUrl) return null;

    return (
      <div className="setting-help-mobile">
        <button
          type="button"
          className="setting-help-toggle"
          aria-expanded={helpOpen}
          aria-controls={helpId}
          aria-label={`${t('Help')}: ${t(label)}`}
          onClick={() => setHelpOpen(open => !open)}
        >
          <span>{t('Help')}</span>
          <svg className="setting-help-chevron" aria-hidden="true" viewBox="0 0 16 16">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
        {helpOpen && (
          <div id={helpId} className="setting-help-body">
            {resolvedTooltip && <p className="wm-help">{t(resolvedTooltip)}</p>}
            {docUrl && (
              <a
                href={docUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="setting-help-doc-link"
              >
                {t("Open documentation")}
              </a>
            )}
          </div>
        )}
      </div>
    );
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
        className={`setting-row ${def?.multiline ? 'setting-row--multiline' : ''} ${isHighlighted ? 'highlighted-row' : ''}`}
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
        {renderMobileHelp(displayLabel, tooltip, [line.key])}
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
    const rowLabel = line.label || firstDef?.label || visibleOptions[0];
    const tooltip = firstDef?.tooltip || '';
    const isHighlighted = visibleOptions.some((k) => k === highlightedKey);

    return (
      <div
        id={`setting-row-${visibleOptions[0]}`}
        className={`setting-row multi-option-row ${isHighlighted ? 'highlighted-row' : ''}`}
        title={tooltip ? t(tooltip) : ''}
      >
        <span className="setting-label" title={tooltip ? t(tooltip) : ''}>
          {t(rowLabel)}
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
        {renderMobileHelp(rowLabel, tooltip, visibleOptions)}
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
