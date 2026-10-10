import type { SettingsLayout } from './types';

export interface ModifiedSetting {
  tab: 'print' | 'filament' | 'printer';
  page: string;
  label: string;
  key: string;
  /** The value in the preset. */
  from: string;
  /** The value now. */
  to: string;
}

/** Every option of the settings layout whose current value differs from the selected preset. */
export function modifiedSettings(layout: SettingsLayout | null | undefined, current: Record<string, string>, preset: Record<string, string>): ModifiedSetting[] {
  if (!layout) return [];
  const found = new Map<string, ModifiedSetting>();
  for (const tab of layout.tabs) {
    for (const page of tab.pages) {
      for (const group of page.groups) {
        for (const line of group.lines) {
          const keys = line.key ? [line.key] : line.options ?? [];
          for (const key of keys) {
            if (found.has(`${tab.id}/${key}`) || current[key] === undefined || preset[key] === undefined || current[key] === preset[key]) continue;
            found.set(`${tab.id}/${key}`, { tab: tab.id, page: page.title, label: line.label || key.replace(/_/g, ' '), key, from: preset[key], to: current[key] });
          }
        }
      }
    }
  }
  return [...found.values()];
}
