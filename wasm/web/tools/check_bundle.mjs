#!/usr/bin/env node
/**
 * @file check_bundle.mjs
 * Verifies that a packed vendor bundle contains every file with identical content.
 *
 * Usage:
 *   node wasm/web/tools/check_bundle.mjs [repoRoot] [bundlePath] [vendor]
 */

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.argv[2] || '.');
const vendor = process.argv[4] || 'Voron';
const defaultBundlePath = path.join(repoRoot, 'wasm', 'build', 'web', 'profiles', `${vendor}.json`);
const bundlePath = path.resolve(process.argv[3] || defaultBundlePath);

if (!fs.existsSync(bundlePath)) {
  console.error(`Error: bundle file not found at ${bundlePath}`);
  process.exit(1);
}

const profilesDir = path.join(repoRoot, 'resources', 'profiles');
const vendorDir = path.join(profilesDir, vendor);
const vendorRootJson = path.join(profilesDir, `${vendor}.json`);

if (!fs.existsSync(vendorRootJson)) {
  console.error(`Error: root profile not found at ${vendorRootJson}`);
  process.exit(1);
}

function walkFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (ent.isFile()) {
      results.push(full);
    }
  }
  return results;
}

const bundleData = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));

if (bundleData.vendor !== vendor) {
  console.error(`Error: expected bundle vendor "${vendor}", got "${bundleData.vendor}"`);
  process.exit(1);
}

const expectedFiles = [vendorRootJson, ...walkFiles(vendorDir)];
let mismatches = 0;
let missing = 0;

for (const fullPath of expectedFiles) {
  const relPath = path.relative(profilesDir, fullPath).replace(/\\/g, '/');
  if (!(relPath in bundleData.files)) {
    console.error(`Missing file in bundle: ${relPath}`);
    missing++;
    continue;
  }

  const expectedContent = fs.readFileSync(fullPath, 'utf8');
  const bundleContent = bundleData.files[relPath];

  if (bundleContent !== expectedContent) {
    console.error(`Content mismatch for: ${relPath}`);
    mismatches++;
  }
}

const bundleFileCount = Object.keys(bundleData.files).length;
if (bundleFileCount !== expectedFiles.length) {
  console.error(
    `Count mismatch: bundle has ${bundleFileCount} files, disk has ${expectedFiles.length} files`
  );
  mismatches++;
}

if (mismatches > 0 || missing > 0) {
  console.error(`Check FAILED: ${missing} missing, ${mismatches} mismatches`);
  process.exit(1);
}

console.log(
  `Check PASSED: all ${expectedFiles.length} files in resources/profiles/${vendor}/** and ${vendor}.json are present with identical content.`
);
