import { SETTING_DOC_PATHS } from './settingDocsMap.ts';

/** Where desktop's option help links point (OptionsGroup::get_url). */
export const WIKI_BASE_URL = 'https://www.orcaslicer.com/wiki';

/** The documentation page of an option, or undefined when desktop has none for it. */
export function getSettingDocUrl(optionKey?: string): string | undefined {
  const path = optionKey ? SETTING_DOC_PATHS[optionKey] : undefined;
  return path ? `${WIKI_BASE_URL}/${path}` : undefined;
}

/** The first documented option of a row, for rows that group several options. */
export function getLineDocUrl(keys: Array<string | undefined>): string | undefined {
  for (const key of keys) {
    const url = getSettingDocUrl(key);
    if (url) return url;
  }
  return undefined;
}
