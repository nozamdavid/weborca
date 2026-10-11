The UI catalogs are editable JSON files: `en.json` for English and `es.json` for Spanish. Keys are the English source strings used by `t()`. Add each new key to both catalogs, keeping file formats, printer names, G-code tokens and placeholders such as `{{count}}` unchanged. Missing keys fall back to their English source text.

Choose the language in Preferences → General. The preference is stored in this browser and applies immediately.

Spanish settings terminology reuses the desktop catalog in `localization/i18n/es/OrcaSlicer_es.po`. New web-only Spanish translations were produced with AI and should receive human review. Refer to the desktop localization glossary when changing recurring terms.

Run `npm run check:locales` from `wasm/app` to check that both catalogs contain the same keys.
