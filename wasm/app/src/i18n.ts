import { usePrefsStore } from './prefs/prefsStore';
import en from './locales/en.json';
import es from './locales/es.json';

const dictionaries: Record<string, Record<string, string>> = {
  en,
  es,
};

export function useTranslation() {
  const language = usePrefsStore((s) => s.general.language) || 'en';
  const dict = dictionaries[language] || dictionaries['en'];

  const t = (key: string, fallbackOrValues?: string | Record<string, string | number>) => {
    const text = dict[key] || (typeof fallbackOrValues === 'string' ? fallbackOrValues : key);
    if (!fallbackOrValues || typeof fallbackOrValues === 'string') return text;
    return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => String(fallbackOrValues[name] ?? match));
  };

  return { t, language };
}
