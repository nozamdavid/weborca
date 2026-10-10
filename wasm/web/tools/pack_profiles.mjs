#!/usr/bin/env node
/**
 * @file pack_profiles.mjs
 * Packs OrcaSlicer vendor profiles and runtime resources into JSON bundles.
 *
 * Usage:
 *   node wasm/web/tools/pack_profiles.mjs <repoRoot> <outDir> [Vendor ...]
 */

import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.error('Usage: node pack_profiles.mjs <repoRoot> <outDir> [Vendor ...]');
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) {
  usage();
}

const repoRoot = path.resolve(args[0]);
const outDir = path.resolve(args[1]);
const specifiedVendors = args.slice(2);

const profilesDir = path.join(repoRoot, 'resources', 'profiles');
const resourcesDir = path.join(repoRoot, 'resources');
const profilesOutDir = path.join(outDir, 'profiles');

if (!fs.existsSync(profilesDir)) {
  console.error(`Error: profiles directory not found at ${profilesDir}`);
  process.exit(1);
}

fs.mkdirSync(profilesOutDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

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

// Determine vendor list
let vendorList = [];
if (specifiedVendors.length > 0) {
  vendorList = specifiedVendors;
} else {
  const entries = fs.readdirSync(profilesDir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.isDirectory()) {
      const vendorName = ent.name;
      const rootJson = path.join(profilesDir, `${vendorName}.json`);
      if (fs.existsSync(rootJson)) {
        vendorList.push(vendorName);
      }
    }
  }
  vendorList.sort();
}

const indexEntries = [];

// Pack each vendor
for (const vendor of vendorList) {
  const bundle = {
    vendor,
    files: {}
  };

  const rootJsonPath = path.join(profilesDir, `${vendor}.json`);
  if (fs.existsSync(rootJsonPath)) {
    bundle.files[`${vendor}.json`] = fs.readFileSync(rootJsonPath, 'utf8');
  } else {
    console.warn(`Warning: missing root profile ${vendor}.json`);
  }

  const vendorSubdir = path.join(profilesDir, vendor);
  const subFiles = walkFiles(vendorSubdir);
  for (const file of subFiles) {
    const relPath = path.relative(profilesDir, file).replace(/\\/g, '/');
    bundle.files[relPath] = fs.readFileSync(file, 'utf8');
  }

  // Printer pictures shown when adding a printer: profiles/covers/<vendor>/<model>_cover.png
  const coversOut = path.join(profilesOutDir, 'covers', vendor);
  for (const file of subFiles) {
    if (!file.endsWith('_cover.png')) continue;
    fs.mkdirSync(coversOut, { recursive: true });
    fs.copyFileSync(file, path.join(coversOut, path.basename(file)));
  }

  const bundleJson = JSON.stringify(bundle);
  const outFile = path.join(profilesOutDir, `${vendor}.json`);
  fs.writeFileSync(outFile, bundleJson, 'utf8');

  const byteLength = Buffer.byteLength(bundleJson, 'utf8');
  indexEntries.push({
    name: vendor,
    bytes: byteLength
  });
}

// Write profiles/index.json
indexEntries.sort((a, b) => a.name.localeCompare(b.name));
const indexJson = JSON.stringify(indexEntries, null, 2);
fs.writeFileSync(path.join(profilesOutDir, 'index.json'), indexJson, 'utf8');

// Pack resources (resources/info/**)
const infoDir = path.join(resourcesDir, 'info');
const infoFiles = walkFiles(infoDir);
const resourcesBundle = {
  vendor: 'resources',
  files: {}
};

for (const file of infoFiles) {
  const relPath = path.relative(resourcesDir, file).replace(/\\/g, '/');
  resourcesBundle.files[relPath] = fs.readFileSync(file, 'utf8');
}

const resourcesJson = JSON.stringify(resourcesBundle);
fs.writeFileSync(path.join(outDir, 'resources.json'), resourcesJson, 'utf8');
// Also write into profiles/ directory for flexible hosting
fs.writeFileSync(path.join(profilesOutDir, 'resources.json'), resourcesJson, 'utf8');

console.log(`Successfully packed ${vendorList.length} vendor(s) and resources bundle to ${outDir}`);
