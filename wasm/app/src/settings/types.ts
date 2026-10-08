export interface LayoutLine {
  type: 'option' | 'line' | 'custom';
  key?: string;
  index?: number;
  label?: string;
  options?: string[];
  note?: string;
  helpLink?: string;
}

export interface LayoutGroup {
  title: string;
  anchor?: string;
  lines: LayoutLine[];
}

export interface LayoutPage {
  title: string;
  icon?: string;
  condition?: string;
  groups: LayoutGroup[];
}

export interface LayoutTab {
  id: 'print' | 'filament' | 'printer';
  function?: string;
  pages: LayoutPage[];
}

export interface SettingsLayout {
  source: { file: string; gitBlob: string };
  tabs: LayoutTab[];
}

export type SettingsMode = 'simple' | 'advanced' | 'expert';
