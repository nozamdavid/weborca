const fs = require('fs');
const path = require('path');

const catalogs = path.resolve(__dirname, '../src/locales');
const en = JSON.parse(fs.readFileSync(path.join(catalogs, 'en.json'), 'utf8'));
const es = JSON.parse(fs.readFileSync(path.join(catalogs, 'es.json'), 'utf8'));

let errors = 0;

for (const key of Object.keys(en)) {
  if (!es[key]) {
    console.error(`Missing key in es.json: "${key}"`);
    errors++;
  }
  if (typeof es[key] === 'string' && es[key].startsWith('[ES] ')) {
    console.error(`Untranslated placeholder in es.json: "${key}"`);
    errors++;
  }
  const placeholders = value => (value.match(/\{\{\w+\}\}/g) || []).sort().join(',');
  if (typeof en[key] !== 'string' || typeof es[key] !== 'string') {
    console.error(`Catalog values must be strings: "${key}"`);
    errors++;
  } else if (placeholders(en[key]) !== placeholders(es[key])) {
    console.error(`Interpolation placeholders differ: "${key}"`);
    errors++;
  }
}

for (const key of Object.keys(es)) {
  if (!en[key]) {
    console.error(`Missing key in en.json: "${key}"`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`Locale check failed with ${errors} errors.`);
  process.exit(1);
} else {
  console.log('Locale check passed.');
}
