import { useTranslation } from "../i18n";
import React from 'react';
import { SettingsLine } from './SettingsLine';
import type { LayoutGroup } from './types';
import { useAppStore } from '../store/appStore';
import { isLineVisible } from './visibility';

interface SettingsGroupProps {
  group: LayoutGroup;
  kind?: 'print' | 'filament' | 'printer';
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({ group, kind }) => {
  const { t } = useTranslation();
  const { settingsMode, configDefs, rulesState } = useAppStore();
  if (!group.lines.some((line) => isLineVisible(line, settingsMode, configDefs, rulesState.fields))) return null;
  return (
    <section className="settings-group" data-testid={`settings-group-${group.title}`}>
      <h3 className="group-title">{t(group.title)}</h3>
      <div className="group-lines">
        {group.lines.map((line, idx) => (
          <SettingsLine key={line.key || `${line.label}-${idx}`} line={line} kind={kind} />
        ))}
      </div>
    </section>
  );
};
