The UI catalogs are JSON files located in this directory. `en.json` serves as the authoritative source of truth for all English strings used by `t()`. Catalogs are provided for 23 languages: English (`en`), Catalan (`ca`), Czech (`cs`), German (`de`), Spanish (`es`), Basque (`eu`), French (`fr`), Hungarian (`hu`), Italian (`it`), Japanese (`ja`), Korean (`ko`), Lithuanian (`lt`), Dutch (`nl`), Polish (`pl`), Portuguese - Brazil (`pt_BR`), Russian (`ru`), Swedish (`sv`), Thai (`th`), Turkish (`tr`), Ukrainian (`uk`), Vietnamese (`vi`), Simplified Chinese (`zh_CN`), and Traditional Chinese (`zh_TW`).

Catalogs are loaded lazily upon selection in the application, ensuring minimal bundle size. English (`en.json`) is always bundled as the synchronous fallback; any missing keys in non-English catalogs automatically fall back to English.

Language is selected in Preferences → General. The preference is persisted across browser reloads.

Desktop translations originate from gettext `.po` files under `localization/i18n/<lang>/OrcaSlicer_<lang>.po`.
- Run `node tools/gen-locales.cjs` to build or update the language catalogs from the `.po` files.
- `es.json` retains its curated web-only translations; the generator script only fills keys that are missing or identical to English from the PO file.
- Run `npm run check:locales` (`node tools/check-locales.cjs`) from `wasm/app` to validate all catalogs against `en.json`. It reports coverage percentage per language and checks placeholder consistency (`{{count}}`, `%s`, `%d`, etc.).
