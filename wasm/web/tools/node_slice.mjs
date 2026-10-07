#!/usr/bin/env node
/**
 * @file node_slice.mjs
 * Standalone Node integration script to verify slicing with engine-core.js.
 *
 * Runs only if wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs exists.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createEngineCore } from '../engine-core.js';

const repoRoot = path.resolve('.');
const modulePath = path.join(
  repoRoot,
  'wasm',
  'build',
  'orca-wasm64',
  'wasm',
  'engine',
  'orca_engine.mjs'
);

if (!fs.existsSync(modulePath)) {
  console.log(`WebAssembly engine module does not exist at ${modulePath}. Skipping node slice check.`);
  process.exit(0);
}

async function main() {
  console.log('Loading WebAssembly engine module from:', modulePath);
  const mod = await import(modulePath);
  const moduleFactory = mod.createOrcaEngine || mod.default;

  const core = await createEngineCore({
    moduleFactory,
    threads: 4
  });

  const webBuildDir = path.join(repoRoot, 'wasm', 'build', 'web');
  const resPath = path.join(webBuildDir, 'resources.json');
  const voronPath = path.join(webBuildDir, 'profiles', 'Voron.json');
  const orcaFilamentPath = path.join(webBuildDir, 'profiles', 'OrcaFilamentLibrary.json');

  if (!fs.existsSync(resPath) || !fs.existsSync(voronPath) || !fs.existsSync(orcaFilamentPath)) {
    throw new Error('Required profile bundles not found. Run pack_profiles.mjs first.');
  }

  console.log('Writing packed bundles into MEMFS...');
  await core.addVendorBundle(JSON.parse(fs.readFileSync(resPath, 'utf8')));
  await core.addVendorBundle(JSON.parse(fs.readFileSync(orcaFilamentPath, 'utf8')));
  await core.addVendorBundle(JSON.parse(fs.readFileSync(voronPath, 'utf8')));

  console.log('Running init...');
  await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });

  console.log('Loading vendors...');
  await core.call('loadVendors', {});

  console.log('Selecting presets...');
  await core.call('selectPresets', {
    printer: 'Voron 2.4 300 0.4 nozzle',
    process: '0.20mm Standard @Voron',
    filaments: ['Generic PLA @System']
  });

  const modelPath = path.join(repoRoot, 'tests', 'data', '20mm_cube.obj');
  const modelBytes = fs.readFileSync(modelPath);
  console.log(`Loading model (${modelBytes.length} bytes)...`);
  await core.loadModel('20mm_cube.obj', modelBytes);

  console.log('Arranging plate...');
  await core.call('arrange', {});

  console.log('Slicing with 4 threads...');
  const sliceResult = await core.call('slice', {
    outPath: '/out/plate_1.gcode',
    threads: 4
  });
  console.log('Slice complete:', sliceResult);

  const outGcode = core.readFile('/out/plate_1.gcode');
  const tmpGcodePath = '/tmp/w_cube.gcode';
  fs.writeFileSync(tmpGcodePath, outGcode);
  console.log(`Wrote ${outGcode.length} bytes to ${tmpGcodePath}`);

  core.dispose();

  const referenceGcode = path.join(repoRoot, 'wasm', 'build', 'p6_cube.gcode');
  if (fs.existsSync(referenceGcode)) {
    console.log('Comparing against reference G-code...');
    const compareScript = path.join(repoRoot, 'wasm', 'spike', 'compare_gcode.sh');
    const cmd = `bash "${compareScript}" "${referenceGcode}" "${tmpGcodePath}"`;
    execSync(cmd, { stdio: 'inherit' });
    console.log('Comparison passed!');
  }
}

main().catch((err) => {
  console.error('node_slice failed:', err);
  process.exit(1);
});
