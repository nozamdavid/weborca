#!/usr/bin/env node
/**
 * @file gcode_hash.mjs
 * Normalizes G-code and computes SHA-256 hash using the same normalization rules
 * as wasm/spike/compare_gcode.sh.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * Normalizes G-code content identically to wasm/spike/compare_gcode.sh.
 *
 * Normalization rules:
 * 1. Strips \r carriage returns.
 * 2. Strips thumbnail blocks (;THUMBNAIL_BLOCK_START ... ;THUMBNAIL_BLOCK_END or ;thumbnail begin ... ;thumbnail end).
 * 3. Strips BigTreeTech thumbnail blocks (;[hex 8 chars] ... ;bigtree thumbnail end).
 * 4. Strips comments (;.*).
 * 5. Trims leading and trailing whitespace.
 * 6. Drops empty lines.
 * 7. Drops lines starting with EXCLUDE_OBJECT.
 * 8. Drops lines starting with M73 followed by whitespace or end of line.
 * 9. Collapses multiple whitespace runs into a single space.
 * 10. Joins normalized lines with \n (ending with \n if non-empty).
 *
 * @param {string} text Raw G-code text
 * @returns {string} Normalized G-code text
 */
export function normalizeGcode(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  let inThumb = false;
  let inBtt = false;
  const out = [];

  for (let line of lines) {
    if (/;[ \t]*(THUMBNAIL_BLOCK_START|thumbnail.*begin)/.test(line)) {
      inThumb = true;
      continue;
    }
    if (inThumb) {
      if (/;[ \t]*(THUMBNAIL_BLOCK_END|thumbnail.*end)/.test(line)) {
        inThumb = false;
      }
      continue;
    }
    if (/^[ \t]*;[0-9a-fA-F]{8}[ \t]*$/.test(line)) {
      inBtt = true;
      continue;
    }
    if (inBtt) {
      if (/;[ \t]*bigtree thumbnail end/.test(line)) {
        inBtt = false;
      }
      continue;
    }

    line = line.replace(/[ \t]*;.*$/, '');
    line = line.replace(/^[ \t]+/, '');
    line = line.replace(/[ \t]+$/, '');
    if (line === '') continue;
    if (/^EXCLUDE_OBJECT/.test(line)) continue;
    if (/^M73([ \t]|$)/.test(line)) continue;
    line = line.replace(/[ \t]+/g, ' ');
    out.push(line);
  }
  return out.length > 0 ? out.join('\n') + '\n' : '';
}

/**
 * Computes SHA-256 of normalized G-code text or buffer.
 *
 * @param {string|Buffer} input
 * @returns {string} Hex-encoded SHA-256 hash
 */
export function hashGcode(input) {
  const text = typeof input === 'string' ? input : input.toString('utf8');
  const norm = normalizeGcode(text);
  return crypto.createHash('sha256').update(norm).digest('hex');
}

/**
 * Computes SHA-256 of normalized G-code from a file path.
 *
 * @param {string} filePath
 * @returns {string} Hex-encoded SHA-256 hash
 */
export function hashGcodeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return hashGcode(content);
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('gcode_hash.mjs')) {
  const targetFile = process.argv[2];
  if (!targetFile) {
    console.error('Usage: node gcode_hash.mjs <file.gcode>');
    process.exit(2);
  }
  if (!fs.existsSync(targetFile)) {
    console.error(`Error: File not found: ${targetFile}`);
    process.exit(2);
  }
  console.log(hashGcodeFile(targetFile));
}
