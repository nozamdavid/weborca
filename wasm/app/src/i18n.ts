import { create } from 'zustand';
import { usePrefsStore } from './prefs/prefsStore';
import en from './locales/en.json';

export interface LanguageOption {
  code: string;
  name: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English' },
  { code: 'ca', name: 'Català' },
  { code: 'cs', name: 'Čeština' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'eu', name: 'Euskara' },
  { code: 'fr', name: 'Français' },
  { code: 'hu', name: 'Magyar' },
  { code: 'it', name: 'Italiano' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'lt', name: 'Lietuvių' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'pt_BR', name: 'Português (Brasil)' },
  { code: 'ru', name: 'Русский' },
  { code: 'sv', name: 'Svenska' },
  { code: 'th', name: 'ไทย' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'uk', name: 'Українська' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'zh_CN', name: '简体中文' },
  { code: 'zh_TW', name: '繁體中文' },
];

const catalogLoaders: Record<string, () => Promise<{ default: Record<string, string> }>> = {
  ca: () => import('./locales/ca.json'),
  cs: () => import('./locales/cs.json'),
  de: () => import('./locales/de.json'),
  es: () => import('./locales/es.json'),
  eu: () => import('./locales/eu.json'),
  fr: () => import('./locales/fr.json'),
  hu: () => import('./locales/hu.json'),
  it: () => import('./locales/it.json'),
  ja: () => import('./locales/ja.json'),
  ko: () => import('./locales/ko.json'),
  lt: () => import('./locales/lt.json'),
  nl: () => import('./locales/nl.json'),
  pl: () => import('./locales/pl.json'),
  pt_BR: () => import('./locales/pt_BR.json'),
  ru: () => import('./locales/ru.json'),
  sv: () => import('./locales/sv.json'),
  th: () => import('./locales/th.json'),
  tr: () => import('./locales/tr.json'),
  uk: () => import('./locales/uk.json'),
  vi: () => import('./locales/vi.json'),
  zh_CN: () => import('./locales/zh_CN.json'),
  zh_TW: () => import('./locales/zh_TW.json'),
};

const loadedDictionaries: Record<string, Record<string, string>> = {
  en,
};

const pendingLoads: Partial<Record<string, Promise<Record<string, string>>>> = {};

interface I18nStore {
  loadedLanguages: Record<string, boolean>;
  markLoaded: (lang: string) => void;
}

export const useI18nStore = create<I18nStore>((set) => ({
  loadedLanguages: { en: true },
  markLoaded: (lang: string) =>
    set((state) => ({
      loadedLanguages: { ...state.loadedLanguages, [lang]: true },
    })),
}));

export async function loadCatalog(lang: string): Promise<Record<string, string>> {
  if (lang === 'en' || loadedDictionaries[lang]) {
    return loadedDictionaries[lang] || loadedDictionaries['en'];
  }
  const pending = pendingLoads[lang];
  if (pending) {
    return pending;
  }
  const loader = catalogLoaders[lang];
  if (!loader) {
    return loadedDictionaries['en'];
  }

  const promise = loader()
    .then((mod) => {
      loadedDictionaries[lang] = mod.default;
      useI18nStore.getState().markLoaded(lang);
      delete pendingLoads[lang];
      return mod.default;
    })
    .catch((err) => {
      console.error(`[i18n] Failed to load catalog for "${lang}":`, err);
      delete pendingLoads[lang];
      return loadedDictionaries['en'];
    });

  pendingLoads[lang] = promise;
  return promise;
}

// Prefetch initial stored language
try {
  const initialLang = usePrefsStore.getState()?.general?.language;
  if (initialLang && initialLang !== 'en') {
    void loadCatalog(initialLang);
  }

  usePrefsStore.subscribe((state) => {
    const lang = state.general?.language;
    if (lang && lang !== 'en' && !loadedDictionaries[lang]) {
      void loadCatalog(lang);
    }
  });
} catch {
  // Ignore in environments where usePrefsStore isn't initialized yet
}

export function translate(
  key: string,
  fallbackOrValues?: string | Record<string, string | number>,
  dictOverride?: Record<string, string>
): string {
  const dict = dictOverride || loadedDictionaries[usePrefsStore.getState()?.general?.language || 'en'] || loadedDictionaries['en'];
  const text = dict[key] || en[key as keyof typeof en] || (typeof fallbackOrValues === 'string' ? fallbackOrValues : key);
  if (!fallbackOrValues || typeof fallbackOrValues === 'string') return text;
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => String(fallbackOrValues[name] ?? match));
}

if (typeof window !== 'undefined') {
  (window as unknown as { __t: typeof translate }).__t = translate;
}

export function useTranslation() {
  const language = usePrefsStore((s) => s.general.language) || 'en';
  const isLoaded = useI18nStore((s) => Boolean(s.loadedLanguages[language]));

  if (language !== 'en' && !isLoaded) {
    void loadCatalog(language);
  }

  const dict = loadedDictionaries[language] || loadedDictionaries['en'];

  const t = (key: string, fallbackOrValues?: string | Record<string, string | number>) => {
    const text = dict[key] || en[key as keyof typeof en] || (typeof fallbackOrValues === 'string' ? fallbackOrValues : key);
    if (!fallbackOrValues || typeof fallbackOrValues === 'string') return text;
    return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => String(fallbackOrValues[name] ?? match));
  };

  return { t, language, isLoaded: language === 'en' || isLoaded };
}
