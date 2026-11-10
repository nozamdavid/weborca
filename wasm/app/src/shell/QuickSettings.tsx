import React from 'react';
import { useAppStore } from '../store/appStore';
import { SettingInput } from '../settings/SettingInput';
import { useTranslation } from '../i18n';
import './workflow.css';
import { quickSettings } from './quickSettingDefinitions';

export function QuickSettings() {
  const { t } = useTranslation();
  const s = useAppStore();
  return <section className="workflow-quick" aria-label={t('Quick settings')}>
    <h2 className="ds-title--section">{t('Quick settings')}</h2>
    <fieldset disabled={s.isSlicing || s.isModelLoading || !s.selectedProcess}>
      {quickSettings.map(([key, label, help, path]) => s.configDefs[key] && s.currentConfig[key] !== undefined && s.rulesState.fields[key]?.visible !== false ?
        <div className="workflow-setting" data-setting={key} key={key}>
          <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={path} /></svg>
          <div><label title={t(help)} htmlFor={`quick-setting-${key}`}>{t(label)}</label><p>{t(help)}</p>
            <SettingInput strictNumeric idPrefix="quick-setting" optionKey={key} def={s.configDefs[key]} kind="print" fieldState={s.rulesState.fields[key]} />
          </div>
        </div> : null)}
    </fieldset>
  </section>;
}
