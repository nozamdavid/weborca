import React from 'react';
import { SettingsLine } from './SettingsLine';
import type { LayoutGroup } from './types';

interface SettingsGroupProps {
  group: LayoutGroup;
  kind?: 'print' | 'filament' | 'printer';
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({ group, kind }) => {
  return (
    <section className="settings-group" data-testid={`settings-group-${group.title}`}>
      <h3 className="group-title">{group.title}</h3>
      <div className="group-lines">
        {group.lines.map((line, idx) => (
          <SettingsLine key={line.key || `${line.label}-${idx}`} line={line} kind={kind} />
        ))}
      </div>
    </section>
  );
};
