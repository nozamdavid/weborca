#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../..');
const localesDir = path.resolve(__dirname, '../src/locales');
const poRootDir = path.resolve(repoRoot, 'localization/i18n');

const LANGUAGES = [
  'ca', 'cs', 'de', 'es', 'eu', 'fr', 'hu', 'it', 'ja', 'ko', 'lt',
  'nl', 'pl', 'pt_BR', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh_CN', 'zh_TW'
];

function unescapePoString(str) {
  let res = '';
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\' && i + 1 < str.length) {
      i++;
      const c = str[i];
      if (c === 'n') res += '\n';
      else if (c === 'r') res += '\r';
      else if (c === 't') res += '\t';
      else if (c === '\\') res += '\\';
      else if (c === '"') res += '"';
      else if (c === "'") res += "'";
      else if (c === 'a') res += '\x07';
      else if (c === 'b') res += '\b';
      else if (c === 'f') res += '\f';
      else if (c === 'v') res += '\v';
      else res += c;
    } else {
      res += str[i];
    }
  }
  return res;
}

function parsePo(content) {
  const lines = content.split(/\r?\n/);
  const entries = [];
  let cur = { flags: [], msgctxt: null, msgid: null, msgid_plural: null, msgstr: null, msgstrPlurals: {} };
  let state = null;

  function flush() {
    if (cur.msgid !== null && cur.msgid !== '') {
      const isFuzzy = cur.flags.some(f => f.includes('fuzzy'));
      const str = cur.msgstrPlurals[0] !== undefined ? cur.msgstrPlurals[0] : cur.msgstr;
      if (!isFuzzy && str !== null && str !== '') {
        entries.push({
          msgctxt: cur.msgctxt,
          msgid: cur.msgid,
          msgstr: str
        });
      }
    }
    cur = { flags: [], msgctxt: null, msgid: null, msgid_plural: null, msgstr: null, msgstrPlurals: {} };
    state = null;
  }

  function extractString(line) {
    const match = line.match(/^"(.*)"$/);
    if (!match) return '';
    return unescapePoString(match[1]);
  }

  for (let line of lines) {
    line = line.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith('#,')) {
      cur.flags.push(line.slice(2).trim());
      continue;
    }
    if (line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('msgctxt ')) {
      state = 'msgctxt';
      cur.msgctxt = extractString(line.slice(8).trim());
      continue;
    }
    if (line.startsWith('msgid ')) {
      state = 'msgid';
      cur.msgid = extractString(line.slice(6).trim());
      continue;
    }
    if (line.startsWith('msgid_plural ')) {
      state = 'msgid_plural';
      cur.msgid_plural = extractString(line.slice(13).trim());
      continue;
    }
    const pluralMatch = line.match(/^msgstr\[(\d+)\]\s*(.*)$/);
    if (pluralMatch) {
      const idx = parseInt(pluralMatch[1], 10);
      state = 'msgstr[' + idx + ']';
      cur.msgstrPlurals[idx] = extractString(pluralMatch[2].trim());
      continue;
    }
    if (line.startsWith('msgstr ')) {
      state = 'msgstr';
      cur.msgstr = extractString(line.slice(7).trim());
      continue;
    }
    if (line.startsWith('"')) {
      const s = extractString(line);
      if (state === 'msgctxt') cur.msgctxt = (cur.msgctxt || '') + s;
      else if (state === 'msgid') cur.msgid = (cur.msgid || '') + s;
      else if (state === 'msgid_plural') cur.msgid_plural = (cur.msgid_plural || '') + s;
      else if (state === 'msgstr') cur.msgstr = (cur.msgstr || '') + s;
      else if (state && state.startsWith('msgstr[')) {
        const idx = parseInt(state.slice(7, -1), 10);
        cur.msgstrPlurals[idx] = (cur.msgstrPlurals[idx] || '') + s;
      }
      continue;
    }
  }
  flush();
  return entries;
}

function getMustache(str) {
  return (str.match(/\{\{\w+\}\}/g) || []).sort().join(',');
}

function getPrintfTokens(str) {
  return (str.match(/%(?:\d+\$)?[+-]?(?:\d+)?(?:\.\d+)?[sdifg]|%zu|%[0-9]+%/g) || [])
    .map(p => p.replace(/%(?:\d+\$)?/, '%'))
    .sort()
    .join(',');
}

function validatePlaceholders(enStr, trStr) {
  if (getMustache(enStr) !== getMustache(trStr)) return false;
  if (getPrintfTokens(enStr) !== getPrintfTokens(trStr)) return false;
  return true;
}

function normalizeKey(str) {
  return str.trim()
    .replace(/[:：\s]+$/, '')
    .replace(/(?:\.\.\.|…)\s*$/, '')
    .trim()
    .toLowerCase();
}

function generate() {
  const enPath = path.join(localesDir, 'en.json');
  if (!fs.existsSync(enPath)) {
    console.error(`en.json not found at ${enPath}`);
    process.exit(1);
  }
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const enKeys = Object.keys(en);

  console.log(`Loaded en.json with ${enKeys.length} keys.`);

  for (const lang of LANGUAGES) {
    const poPath = path.join(poRootDir, lang, `OrcaSlicer_${lang}.po`);
    if (!fs.existsSync(poPath)) {
      console.warn(`Warning: PO file for ${lang} not found at ${poPath}`);
      continue;
    }

    const poContent = fs.readFileSync(poPath, 'utf8');
    const entries = parsePo(poContent);

    const exactMap = new Map();
    const normMap = new Map();

    for (const e of entries) {
      if (!exactMap.has(e.msgid) || !e.msgctxt) {
        exactMap.set(e.msgid, e.msgstr);
      }
      const n = normalizeKey(e.msgid);
      if (!normMap.has(n) || !e.msgctxt) {
        normMap.set(n, { origId: e.msgid, msgstr: e.msgstr });
      }
    }

    if (lang === 'es') {
      // For es: re-read es.json immediately before writing, preserve web-only translations
      const esPath = path.join(localesDir, 'es.json');
      let es = {};
      if (fs.existsSync(esPath)) {
        es = JSON.parse(fs.readFileSync(esPath, 'utf8'));
      }

      let updatedCount = 0;
      for (const key of enKeys) {
        let cand = null;
        if (exactMap.has(key)) {
          cand = exactMap.get(key);
        } else {
          const n = normalizeKey(key);
          if (normMap.has(n)) {
            const item = normMap.get(n);
            let s = item.msgstr;
            const hasColon = /[:：]\s*$/.test(key);
            const hasEllipsis = /(?:\.\.\.|…)\s*$/.test(key);
            s = s.replace(/[:：\s]+$/, '').replace(/(?:\.\.\.|…)\s*$/, '');
            if (hasColon) s += ':';
            else if (hasEllipsis) s += '...';
            cand = s;
          }
        }

        if (cand && validatePlaceholders(en[key], cand)) {
          // Only fill if missing or identical to English
          if (es[key] === undefined || es[key] === key) {
            es[key] = cand;
            updatedCount++;
          }
        } else if (es[key] === undefined) {
          es[key] = key;
        }
      }

      fs.writeFileSync(esPath, JSON.stringify(es, null, 2) + '\n', 'utf8');
      const coveragePct = ((Object.keys(es).filter(k => es[k] !== en[k] || es[k] === k).length / enKeys.length) * 100).toFixed(1);
      console.log(`Updated es.json (${Object.keys(es).length} keys, ${updatedCount} filled from PO)`);
    } else {
      // For other languages: emit only keys present in en.json
      const catalog = {};
      for (const key of enKeys) {
        let cand = null;
        if (exactMap.has(key)) {
          cand = exactMap.get(key);
        } else {
          const n = normalizeKey(key);
          if (normMap.has(n)) {
            const item = normMap.get(n);
            let s = item.msgstr;
            const hasColon = /[:：]\s*$/.test(key);
            const hasEllipsis = /(?:\.\.\.|…)\s*$/.test(key);
            s = s.replace(/[:：\s]+$/, '').replace(/(?:\.\.\.|…)\s*$/, '');
            if (hasColon) s += ':';
            else if (hasEllipsis) s += '...';
            cand = s;
          }
        }

        if (cand && validatePlaceholders(en[key], cand)) {
          catalog[key] = cand;
        }
      }

      const outPath = path.join(localesDir, `${lang}.json`);
      fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
      const count = Object.keys(catalog).length;
      const pct = ((count / enKeys.length) * 100).toFixed(1);
      console.log(`Generated ${lang}.json: ${count} / ${enKeys.length} (${pct}%)`);
    }
  }
}

if (require.main === module) {
  generate();
}

module.exports = { generate, parsePo, validatePlaceholders, normalizeKey };
