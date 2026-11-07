const fs = require('fs');
const path = require('path');

const catalogsDir = path.resolve(__dirname, '../src/locales');
const enPath = path.join(catalogsDir, 'en.json');
if (!fs.existsSync(enPath)) {
  console.error(`en.json not found at ${enPath}`);
  process.exit(1);
}

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const enKeys = Object.keys(en);
const totalEn = enKeys.length;

function getMustache(str) {
  return (str.match(/\{\{\w+\}\}/g) || []).sort().join(',');
}

function getPrintfTokens(str) {
  return (str.match(/%(?:\d+\$)?[+-]?(?:\d+)?(?:\.\d+)?[sdifg]|%zu|%[0-9]+%/g) || [])
    .map(p => p.replace(/%(?:\d+\$)?/, '%'))
    .sort()
    .join(',');
}

const files = fs.readdirSync(catalogsDir)
  .filter(f => f.endsWith('.json') && f !== 'en.json')
  .sort();

let totalErrors = 0;
console.log(`Checking ${files.length} language catalogs against en.json (${totalEn} keys)...`);

for (const file of files) {
  const filePath = path.join(catalogsDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const keys = Object.keys(data);
  let catalogErrors = 0;

  for (const key of keys) {
    if (!en.hasOwnProperty(key)) {
      console.error(`[${file}] Key missing from en.json: "${key}"`);
      catalogErrors++;
      continue;
    }

    const val = data[key];
    if (typeof val !== 'string') {
      console.error(`[${file}] Value must be a string for key: "${key}"`);
      catalogErrors++;
      continue;
    }

    if (file === 'es.json' && val.startsWith('[ES] ')) {
      console.error(`[${file}] Untranslated placeholder in es.json: "${key}"`);
      catalogErrors++;
      continue;
    }

    const enMustache = getMustache(en[key]);
    const valMustache = getMustache(val);
    if (enMustache !== valMustache) {
      console.error(`[${file}] Mustache placeholder mismatch for key: "${key}" (en: "${enMustache}", val: "${valMustache}")`);
      catalogErrors++;
    }

    const enPrintf = getPrintfTokens(en[key]);
    const valPrintf = getPrintfTokens(val);
    if (enPrintf !== valPrintf) {
      console.error(`[${file}] Printf placeholder mismatch for key: "${key}" (en: "${enPrintf}", val: "${valPrintf}")`);
      catalogErrors++;
    }
  }

  const pct = ((keys.length / totalEn) * 100).toFixed(1);
  if (catalogErrors === 0) {
    console.log(`✓ ${file.padEnd(12)}: ${keys.length} / ${totalEn} (${pct}%)`);
  } else {
    console.error(`✗ ${file.padEnd(12)}: ${catalogErrors} errors found`);
    totalErrors += catalogErrors;
  }
}

if (totalErrors > 0) {
  console.error(`\nLocale check failed with ${totalErrors} errors.`);
  process.exit(1);
} else {
  console.log(`\nAll ${files.length} catalogs passed validation.`);
}
