#!/usr/bin/env node
/**
 * @file run_parity.mjs
 * Parity test runner:
 * (a) Engine vs Driver (native CLI exported flattened config + orca_slice_driver.js)
 * (b) Engine vs macOS x86_64 reference (refs-macos-x86_64/<id>.gcode)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createEngineCore } from '../../web/engine-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const modulePath = process.env.ORCA_ENGINE_MODULE
  ? path.resolve(process.env.ORCA_ENGINE_MODULE)
  : path.join(
      repoRoot,
      'wasm',
      'build',
      'orca-wasm64',
      'wasm',
      'engine',
      'orca_engine.mjs'
    );
const driverPath = process.env.ORCA_DRIVER_MODULE
  ? path.resolve(process.env.ORCA_DRIVER_MODULE)
  : process.env.ORCA_ENGINE_MODULE
  ? path.resolve(path.dirname(process.env.ORCA_ENGINE_MODULE), '../spike/orca_slice_driver.js')
  : path.join(
      repoRoot,
      'wasm',
      'build',
      'orca-wasm64',
      'wasm',
      'spike',
      'orca_slice_driver.js'
    );
const compareScript = path.join(repoRoot, 'wasm', 'spike', 'compare_gcode.sh');
const nativeCli = '/tmp/orca-native/squashfs-root/AppRun';

const bundleDir = path.join(repoRoot, 'wasm', 'build', 'tests-node');
const parityOutDir = path.join(bundleDir, 'parity');
const refsDir = path.join(__dirname, 'refs-macos-x86_64');
const casesFile = process.env.PARITY_CASES ? path.resolve(process.env.PARITY_CASES) : path.join(__dirname, 'cases.json');

function ensureBundles() {
  fs.mkdirSync(parityOutDir, { recursive: true });
  const required = [
    path.join(bundleDir, 'resources.json'),
    path.join(bundleDir, 'profiles', 'Voron.json'),
    path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json'),
    path.join(bundleDir, 'profiles', 'BBL.json'),
    path.join(bundleDir, 'profiles', 'Prusa.json')
  ];
  if (required.some((p) => !fs.existsSync(p))) {
    const packScript = path.join(repoRoot, 'wasm', 'web', 'tools', 'pack_profiles.mjs');
    execFileSync(
      process.execPath,
      [packScript, repoRoot, bundleDir, 'Voron', 'OrcaFilamentLibrary', 'BBL', 'Prusa'],
      { stdio: 'inherit' }
    );
  }
}

function findPresetFile(kind, name) {
  const profilesDir = path.join(repoRoot, 'resources', 'profiles');
  const vendors = fs.readdirSync(profilesDir);
  for (const v of vendors) {
    const candidate = path.join(profilesDir, v, kind, `${name}.json`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Preset file not found: kind="${kind}" name="${name}"`);
}

function normalizeGcodeLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const result = [];
  let inThumb = false;
  let inBtt = false;

  for (let line of lines) {
    if (/;[ \t]*(THUMBNAIL_BLOCK_START|thumbnail.*begin)/.test(line)) {
      inThumb = true;
      continue;
    }
    if (inThumb) {
      if (/;[ \t]*(THUMBNAIL_BLOCK_END|thumbnail.*end)/.test(line)) inThumb = false;
      continue;
    }
    if (/^[ \t]*;[0-9a-fA-F]{8}[ \t]*$/.test(line)) {
      inBtt = true;
      continue;
    }
    if (inBtt) {
      if (/;[ \t]*bigtree thumbnail end/.test(line)) inBtt = false;
      continue;
    }

    line = line.replace(/[ \t]*;.*$/, '');
    line = line.trim();
    if (line === '') continue;
    if (/^EXCLUDE_OBJECT/.test(line)) continue;
    if (/^M73([ \t]|$)/.test(line)) continue;
    line = line.replace(/[ \t]+/g, ' ');
    result.push(line);
  }
  return result;
}

function getFirst30Diffs(fileA, fileB) {
  const linesA = normalizeGcodeLines(fileA);
  const linesB = normalizeGcodeLines(fileB);
  const max = Math.max(linesA.length, linesB.length);
  const diffs = [];

  for (let i = 0; i < max && diffs.length < 30; i++) {
    const a = linesA[i];
    const b = linesB[i];
    if (a !== b) {
      diffs.push(`Line ${i + 1}:\n  < ${a ?? '(EOF)'}\n  > ${b ?? '(EOF)'}`);
    }
  }
  return diffs;
}

async function main() {
  ensureBundles();

  const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));

  const mod = await import(modulePath);
  const moduleFactory = mod.createOrcaEngine || mod.default;

  const core = await createEngineCore({
    moduleFactory,
    threads: 4
  });

  const resJson = JSON.parse(fs.readFileSync(path.join(bundleDir, 'resources.json'), 'utf8'));
  const orcaFilJson = JSON.parse(
    fs.readFileSync(path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json'), 'utf8')
  );
  const voronJson = JSON.parse(fs.readFileSync(path.join(bundleDir, 'profiles', 'Voron.json'), 'utf8'));
  const bblJson = JSON.parse(fs.readFileSync(path.join(bundleDir, 'profiles', 'BBL.json'), 'utf8'));
  const prusaJson = JSON.parse(fs.readFileSync(path.join(bundleDir, 'profiles', 'Prusa.json'), 'utf8'));

  await core.addVendorBundle(resJson);
  await core.addVendorBundle(orcaFilJson);
  await core.addVendorBundle(voronJson);
  await core.addVendorBundle(bblJson);
  await core.addVendorBundle(prusaJson);

  await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
  await core.call('loadVendors', {});

  const tableRows = [];
  const skippedRefCases = [];
  const failureDetails = [];

  for (const c of cases) {
    process.stdout.write(`Running case ${c.id}... `);

    let wasmGcodePath = path.join(parityOutDir, `${c.id}.wasm.gcode`);
    let driverGcodePath = path.join(parityOutDir, `${c.id}.driver.gcode`);
    let flatJsonPath = path.join(parityOutDir, `${c.id}.flat.json`);

    let sliceMs = '-';
    let layers = '-';
    let exitA = 'error';
    let exitB = 'no ref';
    let sliceErr = null;

    // 1. Slice with engine-core
    try {
      await core.call('selectPresets', {
        printer: c.printer,
        process: c.process,
        filaments: c.filaments
      });

      if (c.options) {
        await core.call("setOptions", {
          options: c.options
        });
      }

      const modelFullPath = path.resolve(repoRoot, c.model);
      const modelBytes = fs.readFileSync(modelFullPath);
      await core.loadModel(path.basename(c.model), modelBytes);
      await core.call('arrange', {});

      const tStart = performance.now();
      const sliceRes = await core.call('slice', {
        outPath: `/out/${c.id}.gcode`,
        threads: 4
      });
      const tEnd = performance.now();
      sliceMs = Math.round(tEnd - tStart);
      layers = sliceRes.layers;

      const gcodeBytes = core.readFile(`/out/${c.id}.gcode`);
      fs.writeFileSync(wasmGcodePath, gcodeBytes);
    } catch (err) {
      sliceErr = err;
      process.stdout.write(`[engine slice failed: ${err.message}]\n`);
      failureDetails.push({
        caseId: c.id,
        stage: 'engine slice',
        error: err.message
      });
    }

    // 2. Check (a) Engine vs driver
    if (!sliceErr) {
      try {
        const machFile = findPresetFile('machine', c.printer);
        const procFile = findPresetFile('process', c.process);
        const filFiles = c.filaments.map((f) => findPresetFile('filament', f)).join(';');

        const scratchDir = path.join(bundleDir, 'scratch');
        fs.mkdirSync(scratchDir, { recursive: true });

        // Export config with native CLI
        const exportRes = spawnSync(nativeCli, [
          '--load-settings',
          `${machFile};${procFile}`,
          '--load-filaments',
          filFiles,
          '--export-settings',
          flatJsonPath
        ], { encoding: 'utf8', cwd: scratchDir });

        if (exportRes.status !== 0) {
          throw new Error(`Native CLI export failed (exit ${exportRes.status}): ${exportRes.stderr || exportRes.stdout}`);
        }

        const flat = JSON.parse(fs.readFileSync(flatJsonPath, "utf8"));
        // When multiple filaments are specified, native CLI export-settings produces
        // single-slot arrays for filament_colour, filament_map, flush matrices, etc.
        // Synchronize these effective multi-filament configuration values from engine config.
        if (c.filaments && c.filaments.length > 1) {
          const engineCfg = await core.call("getConfig", {});
          for (const [k, v] of Object.entries(engineCfg)) {
            flat[k] = String(v);
          }
        }
        if (c.options) {
          for (const [key, val] of Object.entries(c.options)) {
            if (key in flat && Array.isArray(flat[key])) {
              flat[key] = Array.isArray(val) ? val.map((v) => String(v)) : [String(val)];
            } else if (Array.isArray(val)) {
              flat[key] = val.map((v) => String(v));
            } else {
              flat[key] = String(val);
            }
          }
        }
        fs.writeFileSync(flatJsonPath, JSON.stringify(flat, null, "\t"));

        // Slice with spike driver
        const modelFullPath = path.resolve(repoRoot, c.model);
        const driverRes = spawnSync(
          process.execPath,
          [driverPath, modelFullPath, driverGcodePath, flatJsonPath, '4'],
          { encoding: 'utf8' }
        );

        if (driverRes.status !== 0) {
          throw new Error(`Spike driver slice failed (exit ${driverRes.status}): ${driverRes.stderr || driverRes.stdout}`);
        }

        // Compare
        const cmpRes = spawnSync('bash', [compareScript, wasmGcodePath, driverGcodePath], {
          encoding: 'utf8'
        });

        exitA = cmpRes.status !== null ? String(cmpRes.status) : 'error';

        if (cmpRes.status !== 0) {
          const diffs = getFirst30Diffs(wasmGcodePath, driverGcodePath);
          failureDetails.push({
            caseId: c.id,
            stage: 'check (a) compare',
            status: cmpRes.status,
            output: cmpRes.stdout + (cmpRes.stderr ? `\n${cmpRes.stderr}` : ''),
            diffs
          });
        }
      } catch (err) {
        exitA = 'error';
        failureDetails.push({
          caseId: c.id,
          stage: 'check (a) driver/export',
          error: err.message
        });
      }
    } else {
      exitA = 'error (engine)';
    }

    // 3. Check (b) Engine vs selected native reference
    const refPath = path.join(c.id === 'cube-voron' ? path.join(__dirname, 'refs-current-native') : refsDir, `${c.id}.gcode`);
    if (fs.existsSync(refPath)) {
      if (!sliceErr) {
        const cmpRes = spawnSync('bash', [compareScript, wasmGcodePath, refPath], {
          encoding: 'utf8'
        });
        exitB = cmpRes.status !== null ? String(cmpRes.status) : 'error';
        if (cmpRes.status !== 0) {
          const diffs = getFirst30Diffs(wasmGcodePath, refPath);
          failureDetails.push({
            caseId: c.id,
            stage: 'check (b) native reference compare',
            status: cmpRes.status,
            output: cmpRes.stdout + (cmpRes.stderr ? `\n${cmpRes.stderr}` : ''),
            diffs
          });
        }
      } else {
        exitB = 'error (engine)';
      }
    } else {
      exitB = 'no ref';
      skippedRefCases.push(c.id);
    }

    if (!sliceErr) {
      process.stdout.write(`(a) exit ${exitA}, (b) ${exitB}, layers: ${layers}, ${sliceMs} ms\n`);
    }

    tableRows.push({
      id: c.id,
      exitA,
      exitB,
      layers: String(layers),
      sliceMs: String(sliceMs)
    });

    if (c.options) {
      try {
        await core.call("resetOptions", {});
      } catch (_) {}
    }
  }

  core.dispose();

  console.log('\n=== Parity Test Summary Table ===\n');
  const pad = (str, len) => str.padEnd(len);
  const header = `| ${pad('Case ID', 22)} | ${pad('(a) Exit', 14)} | ${pad('(b) Exit', 10)} | ${pad('Layers', 8)} | ${pad('Slice (ms)', 10)} |`;
  const sep = `|-${'-'.repeat(22)}-|-${'-'.repeat(14)}-|-${'-'.repeat(10)}-|-${'-'.repeat(8)}-|-${'-'.repeat(10)}-|`;
  console.log(header);
  console.log(sep);

  for (const r of tableRows) {
    console.log(
      `| ${pad(r.id, 22)} | ${pad(r.exitA, 14)} | ${pad(r.exitB, 10)} | ${pad(r.layers, 8)} | ${pad(r.sliceMs, 10)} |`
    );
  }
  console.log(sep);

  console.log('\nCases without native reference (skipped in check b):');
  for (const sk of skippedRefCases) {
    console.log(`  - ${sk}`);
  }

  if (failureDetails.length > 0) {
    console.log('\n=== Failure & Mismatch Details ===\n');
    for (const f of failureDetails) {
      console.log(`Case: ${f.caseId} [Stage: ${f.stage}]`);
      if (f.error) {
        console.log(`  Error: ${f.error}`);
      }
      if (f.status !== undefined) {
        console.log(`  Compare Exit Code: ${f.status}`);
      }
      if (f.output) {
        console.log(`  Compare Output:\n${f.output.trim().split('\n').map((l) => '    ' + l).join('\n')}`);
      }
      if (f.diffs && f.diffs.length > 0) {
        console.log('  First differing normalized lines:');
        for (const d of f.diffs) {
          console.log(`    ${d}`);
        }
      }
      console.log('');
    }
    process.exitCode = 1;
  } else {
    console.log('\nNo parity failures or mismatches detected.');
  }
}

main().catch((err) => {
  console.error('Fatal error in run_parity.mjs:', err);
  process.exit(1);
});
