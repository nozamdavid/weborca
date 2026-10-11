#!/usr/bin/env node
/**
 * @file native-parity.mjs
 * Focused real native x86_64 versus WebAssembly parity runner.
 *
 * Covers 3 bounded cases:
 * 1. cube Voron existing baseline (cube-voron)
 * 2. Benchy Voron (benchy-voron)
 * 3. cube BBL single filament (cube-bbl)
 *
 * Environment variables:
 * - NATIVE_ORCA: Path to native OrcaSlicer binary/wrapper (default: /tmp/orca-native/squashfs-root/AppRun)
 * - ORCA_ENGINE_MODULE: Path to frozen WASM engine module (default: wasm/build/native-parity-baseline/orca_engine.mjs)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createEngineCore } from '../../web/engine-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const nativeBinary = process.env.NATIVE_ORCA
  ? path.resolve(process.env.NATIVE_ORCA)
  : '/tmp/orca-native/squashfs-root/AppRun';

const wasmModulePath = process.env.ORCA_ENGINE_MODULE
  ? path.resolve(process.env.ORCA_ENGINE_MODULE)
  : path.join(
      repoRoot,
      'wasm',
      'build',
      'native-parity-baseline',
      'orca_engine.mjs'
    );

const scratchBaseDir = path.join(repoRoot, 'wasm', 'build', 'native-parity');
const compareScript = path.join(repoRoot, 'wasm', 'spike', 'compare_gcode.sh');
const bundleDir = path.join(repoRoot, 'wasm', 'build', 'tests-node');
const macosRefsDir = path.join(__dirname, 'refs-macos-x86_64');

const TARGET_CASES = [
  {
    id: 'cube-voron',
    title: 'cube Voron existing baseline',
    model: 'tests/data/20mm_cube.obj',
    printer: 'Voron 2.4 300 0.4 nozzle',
    process: '0.20mm Standard @Voron',
    filaments: ['Generic PLA @System']
  },
  {
    id: 'benchy-voron',
    title: 'Benchy Voron',
    model: 'wasm/build/models/3DBenchy.stl',
    printer: 'Voron 2.4 300 0.4 nozzle',
    process: '0.20mm Standard @Voron',
    filaments: ['Generic PLA @System']
  },
  {
    id: 'cube-bbl',
    title: 'cube BBL single filament',
    model: 'tests/data/20mm_cube.obj',
    printer: 'Bambu Lab X1 Carbon 0.4 nozzle',
    process: '0.20mm Standard @BBL X1C',
    filaments: ['Bambu PLA Basic @BBL X1C']
  }
];

function ensureBundles() {
  fs.mkdirSync(scratchBaseDir, { recursive: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  const required = [
    path.join(bundleDir, 'resources.json'),
    path.join(bundleDir, 'profiles', 'Voron.json'),
    path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json'),
    path.join(bundleDir, 'profiles', 'BBL.json')
  ];
  if (required.some((p) => !fs.existsSync(p))) {
    const packScript = path.join(repoRoot, 'wasm', 'web', 'tools', 'pack_profiles.mjs');
    execFileSync(
      process.execPath,
      [packScript, repoRoot, bundleDir, 'Voron', 'OrcaFilamentLibrary', 'BBL'],
      { stdio: 'inherit' }
    );
  }

  // Ensure downloaded model artifacts exist (e.g. 3DBenchy.stl)
  const benchyPath = path.join(repoRoot, 'wasm', 'build', 'models', '3DBenchy.stl');
  if (!fs.existsSync(benchyPath)) {
    const fetchScript = path.join(repoRoot, 'wasm', 'tests', 'data', 'fetch_models.sh');
    if (fs.existsSync(fetchScript)) {
      console.log('Fetching missing model artifact 3DBenchy.stl...');
      execFileSync('bash', [fetchScript], { cwd: repoRoot, stdio: 'inherit' });
    }
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

function getRepoVersion() {
  try {
    const versionInc = fs.readFileSync(path.join(repoRoot, 'version.inc'), 'utf8');
    const match = versionInc.match(/set\(SLIC3R_VERSION\s+"([^"]+)"\)/);
    const ver = match ? match[1] : 'unknown';
    let commit = 'unknown';
    try {
      const gitRes = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8'
      });
      if (gitRes.status === 0) commit = gitRes.stdout.trim();
    } catch (_) {}
    return { version: ver, commit };
  } catch (err) {
    return { version: 'unknown', commit: 'unknown', error: err.message };
  }
}

function inspectNativeBinary(binPath) {
  const result = {
    path: binPath,
    exists: fs.existsSync(binPath),
    isExecutable: false,
    fileType: 'unknown',
    versionString: 'unknown',
    arch: 'unknown'
  };

  if (!result.exists) return result;

  try {
    fs.accessSync(binPath, fs.constants.X_OK);
    result.isExecutable = true;
  } catch (_) {
    result.isExecutable = false;
  }

  // Inspect file type
  try {
    const fileRes = spawnSync('file', ['-L', binPath], { encoding: 'utf8' });
    if (fileRes.status === 0) {
      result.fileType = fileRes.stdout.trim().replace(/^[^:]+:\s*/, '');
    }
  } catch (_) {}
  // Determine actual target executable if wrapper script
  let actualBinary = binPath;
  try {
    const stat = fs.statSync(binPath);
    if (stat.isFile()) {
      const firstLine = fs.readFileSync(binPath, 'utf8', { flag: 'r' }).slice(0, 100);
      if (firstLine.startsWith('#!')) {
        // AppRun or wrapper script
        const binDir = path.join(path.dirname(binPath), 'bin', 'orca-slicer');
        if (fs.existsSync(binDir)) {
          actualBinary = binDir;
        }
      }
    }
  } catch (_) {}
  // Inspect actual binary ELF architecture & strings
  try {
    const fileRes = spawnSync('file', ['-L', actualBinary], { encoding: 'utf8' });
    if (fileRes.status === 0) {
      const out = fileRes.stdout.trim();
      if (out.includes('x86-64')) result.arch = 'x86_64';
      else if (out.includes('aarch64') || out.includes('ARM aarch64')) result.arch = 'arm64';
      else result.arch = out.replace(/^[^:]+:\s*/, '');
    }
  } catch (_) {}
  // Extract version string from binary
  try {
    const stringsRes = spawnSync(
      'sh',
      ['-c', `strings "${actualBinary}" | grep -E "OrcaSlicer [0-9]|OrcaSlicer-[0-9]|02\\.08\\.[0-9]+" | head -n 5`],
      { encoding: 'utf8' }
    );
    if (stringsRes.status === 0 && stringsRes.stdout.trim()) {
      const lines = stringsRes.stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
      result.versionString = lines.join('; ');
    }
  } catch (_) {}
  return result;
}

function parseCompareOutput(output) {
  const result = {
    summaryA: '',
    summaryB: '',
    diffCount: 0,
    firstDiffs: []
  };

  const diffMatch = output.match(/Differing normalized lines:\s*(\d+)/);
  if (diffMatch) {
    result.diffCount = parseInt(diffMatch[1], 10);
  }

  const lines = output.split('\n');
  let inFirstDiffs = false;
  for (const line of lines) {
    if (line.startsWith('Summary for ')) {
      inFirstDiffs = false;
      continue;
    }
    if (line.startsWith('First differing lines')) {
      inFirstDiffs = true;
      continue;
    }
    if (inFirstDiffs) {
      if (line.startsWith('<') || line.startsWith('>')) {
        result.firstDiffs.push(line);
      }
    }
  }
  return result;
}

function extractGcodeMetrics(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const layers = (content.match(/^[ \t]*;[ \t]*(?:LAYER_CHANGE|CHANGE_LAYER)\b/gm) ?? []).length ||
    (content.match(/^[ \t]*;[ \t]*Z:/gm) ?? []).length;
  const extrusionByFeature = {};
  let feature = 'Before first layer';
  let inLayers = false;
  let g1Count = 0;
  let totalExtrusion = 0;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]*;.*$/, '').trim();
    if (/^[ \t]*;[ \t]*(?:LAYER_CHANGE|CHANGE_LAYER)\b/.test(rawLine)) inLayers = true;
    const featureMatch = rawLine.match(/^[ \t]*;[ \t]*(?:FEATURE|TYPE):[ \t]*(.+)/);
    if (inLayers && featureMatch) feature = featureMatch[1].trim();
    if (!/^G1(?:[ \t]|$)/.test(line)) continue;
    g1Count++;
    const tokens = line.split(/[ \t]+/);
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      const code = tok[0];
      const val = parseFloat(tok.slice(1));
      if (isNaN(val)) continue;
      if (code === 'E') {
        totalExtrusion += val;
        extrusionByFeature[feature] = (extrusionByFeature[feature] ?? 0) + val;
      }
      else if (code === 'X') { if (val < minX) minX = val; if (val > maxX) maxX = val; }
      else if (code === 'Y') { if (val < minY) minY = val; if (val > maxY) maxY = val; }
      else if (code === 'Z') { if (val < minZ) minZ = val; if (val > maxZ) maxZ = val; }
    }
  }

  return {
    layers,
    g1Count,
    totalExtrusion: Number(totalExtrusion.toFixed(4)),
    extrusionByFeature: Object.fromEntries(Object.entries(extrusionByFeature).map(([key, value]) => [key, Number(value.toFixed(5))])),
    xRange: minX !== Infinity ? `${minX.toFixed(3)} - ${maxX.toFixed(3)}` : 'N/A',
    yRange: minY !== Infinity ? `${minY.toFixed(3)} - ${maxY.toFixed(3)}` : 'N/A',
    zRange: minZ !== Infinity ? `${minZ.toFixed(3)} - ${maxZ.toFixed(3)}` : 'N/A'
  };
}

async function main() {
  console.log('================================================================');
  console.log('   OrcaSlicer Real Native x86_64 vs WebAssembly Parity Runner   ');
  console.log('================================================================\n');

  ensureBundles();

  // 1. Inspect provenance
  const repoVer = getRepoVersion();
  const nativeInfo = inspectNativeBinary(nativeBinary);
  const wasmExists = fs.existsSync(wasmModulePath);

  console.log('--- Environment & Provenance ---');
  console.log(`Repository Commit     : ${repoVer.commit}`);
  console.log(`Repository Version    : ${repoVer.version} (version.inc)`);
  console.log(`Native Binary Path    : ${nativeBinary}`);
  console.log(`Native Binary Exists  : ${nativeInfo.exists} (executable: ${nativeInfo.isExecutable})`);
  console.log(`Native Architecture   : ${nativeInfo.arch}`);
  console.log(`Native File Type      : ${nativeInfo.fileType}`);
  console.log(`Native Version Label  : ${nativeInfo.versionString}`);
  console.log(`Provenance Note       : Native binary version label indicates 02.08.01.55 / 2.5.0-dev family, but source commit equivalence to repo HEAD (${repoVer.commit}) is unproven.`);
  console.log(`WASM Module Path      : ${wasmModulePath} (exists: ${wasmExists})`);
  console.log(`Scratch Output Dir    : ${scratchBaseDir}\n`);

  if (!nativeInfo.exists || !nativeInfo.isExecutable) {
    console.error(`ERROR: Native OrcaSlicer binary is not usable at ${nativeBinary}.`);
    console.error('Actionable prerequisite: ensure /tmp/orca-native/squashfs-root/AppRun is present or specify NATIVE_ORCA.');
    process.exit(1);
  }

  if (!wasmExists) {
    console.error(`ERROR: WASM engine module not found at ${wasmModulePath}.`);
    console.error('Actionable prerequisite: build or copy orca_engine.mjs to the target baseline directory or set ORCA_ENGINE_MODULE.');
    process.exit(1);
  }

  // 2. Initialize WebAssembly engine core
  console.log('Initializing WebAssembly engine core...');
  const wasmMod = await import(wasmModulePath);
  const moduleFactory = wasmMod.createOrcaEngine || wasmMod.default;
  const core = await createEngineCore({
    moduleFactory,
    threads: 4
  });

  const resJson = JSON.parse(fs.readFileSync(path.join(bundleDir, 'resources.json'), 'utf8'));
  const orcaFilJson = JSON.parse(fs.readFileSync(path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json'), 'utf8'));
  const voronJson = JSON.parse(fs.readFileSync(path.join(bundleDir, 'profiles', 'Voron.json'), 'utf8'));
  const bblJson = JSON.parse(fs.readFileSync(path.join(bundleDir, 'profiles', 'BBL.json'), 'utf8'));

  await core.addVendorBundle(resJson);
  await core.addVendorBundle(orcaFilJson);
  await core.addVendorBundle(voronJson);
  await core.addVendorBundle(bblJson);

  await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
  await core.call('loadVendors', {});
  console.log('WebAssembly engine initialized successfully.\n');

  const summaryRows = [];
  const perCaseReports = [];

  for (const c of TARGET_CASES) {
    console.log(`----------------------------------------------------------------`);
    console.log(`Case: ${c.id} - ${c.title}`);
    console.log(`----------------------------------------------------------------`);

    const caseDir = path.join(scratchBaseDir, c.id);
    fs.mkdirSync(caseDir, { recursive: true });

    const modelFullPath = path.resolve(repoRoot, c.model);
    const machFile = findPresetFile('machine', c.printer);
    const procFile = findPresetFile('process', c.process);
    const filFiles = c.filaments.map((f) => findPresetFile('filament', f)).join(';');

    const nativeGcodePath = path.join(caseDir, 'native.gcode');
    const wasmGcodePath = path.join(caseDir, 'wasm.gcode');
    const diffReportPath = path.join(caseDir, 'diff_report.txt');
    const resultJsonPath = path.join(caseDir, 'result.json');

    let nativeSliceMs = '-';
    let wasmSliceMs = '-';
    let compareExit = 'error';
    let macosRefExit = 'no ref';
    let nativeErr = null;
    let wasmErr = null;

    // --- (A) Slice independently with Native CLI ---
    const nativeCmdArgs = [
      '--load-settings', `${machFile};${procFile}`,
      '--load-filaments', filFiles,
      '--slice', '0',
      '--outputdir', caseDir,
      modelFullPath
    ];
    const nativeCmdStr = `${nativeBinary} ${nativeCmdArgs.map((a) => (a.includes(' ') || a.includes(';') ? `"${a}"` : a)).join(' ')}`;
    console.log(`[Native] Command:\n  ${nativeCmdStr}`);

    const tNatStart = performance.now();
    const nativeProc = spawnSync(nativeBinary, nativeCmdArgs, {
      cwd: caseDir,
      encoding: 'utf8',
      timeout: 120000 // 120s limit per slice
    });
    const tNatEnd = performance.now();
    nativeSliceMs = Math.round(tNatEnd - tNatStart);

    if (nativeProc.status !== 0) {
      nativeErr = nativeProc.stderr || nativeProc.stdout || `Process exited with code ${nativeProc.status}`;
      console.error(`[Native] Slice failed (${nativeSliceMs} ms, exit ${nativeProc.status}): ${nativeErr.trim()}`);
    } else {
      const producedPlate = path.join(caseDir, 'plate_1.gcode');
      if (fs.existsSync(producedPlate)) {
        fs.renameSync(producedPlate, nativeGcodePath);
        const nativeSize = fs.statSync(nativeGcodePath).size;
        console.log(`[Native] Slice succeeded in ${nativeSliceMs} ms (${nativeSize} bytes)`);
      } else {
        nativeErr = 'Expected plate_1.gcode output not found';
        console.error(`[Native] Output missing: ${producedPlate}`);
      }
    }

    // --- (B) Slice with WebAssembly Engine ---
    console.log(`[WASM] Slicing with engine-core presets [${c.printer} | ${c.process} | ${c.filaments.join(', ')}]...`);
    try {
      await core.call('selectPresets', {
        printer: c.printer,
        process: c.process,
        filaments: c.filaments
      });

      const modelBytes = fs.readFileSync(modelFullPath);
      await core.loadModel(path.basename(c.model), modelBytes);
      await core.call('arrange', {});

      const tWasmStart = performance.now();
      const sliceRes = await core.call('slice', {
        outPath: `/out/${c.id}.gcode`,
        threads: 4
      });
      const tWasmEnd = performance.now();
      wasmSliceMs = Math.round(tWasmEnd - tWasmStart);

      const gcodeBytes = core.readFile(`/out/${c.id}.gcode`);
      fs.writeFileSync(wasmGcodePath, gcodeBytes);
      console.log(`[WASM] Slice succeeded in ${wasmSliceMs} ms (${gcodeBytes.length} bytes, ${sliceRes.layers} layers)`);
    } catch (err) {
      wasmErr = err.message;
      console.error(`[WASM] Slice failed: ${wasmErr}`);
    }

    // --- (C) Compare Native vs WASM with compare_gcode.sh ---
    let cmpParsed = null;
    let compareOutputRaw = '';
    if (!nativeErr && !wasmErr) {
      console.log(`[Compare] Running compare_gcode.sh native vs WASM...`);
      const cmpProc = spawnSync('bash', [compareScript, nativeGcodePath, wasmGcodePath], {
        encoding: 'utf8',
        timeout: 60000
      });
      compareExit = cmpProc.status !== null ? String(cmpProc.status) : 'error';
      compareOutputRaw = (cmpProc.stdout || '') + (cmpProc.stderr || '');
      fs.writeFileSync(diffReportPath, compareOutputRaw);
      cmpParsed = parseCompareOutput(compareOutputRaw);

      console.log(`[Compare] compare_gcode exit code: ${compareExit}`);
      console.log(`[Compare] Differing normalized lines: ${cmpParsed.diffCount}`);
      if (cmpParsed.diffCount > 0 && cmpParsed.firstDiffs.length > 0) {
        console.log(`[Compare] First differing normalized lines:`);
        for (const diffLine of cmpParsed.firstDiffs.slice(0, 10)) {
          console.log(`    ${diffLine}`);
        }
      }
    }

    // --- (D) Compare WASM vs macOS x86_64 reference if available ---
    const macosRefPath = path.join(macosRefsDir, `${c.id}.gcode`);
    if (fs.existsSync(macosRefPath) && !wasmErr) {
      const macCmpProc = spawnSync('bash', [compareScript, macosRefPath, wasmGcodePath], {
        encoding: 'utf8',
        timeout: 60000
      });
      macosRefExit = macCmpProc.status !== null ? String(macCmpProc.status) : 'error';
      console.log(`[macOS Golden] compare_gcode WASM vs macOS golden reference: exit ${macosRefExit}`);
    }

    // Extract metrics
    const nativeMetrics = extractGcodeMetrics(nativeGcodePath);
    const wasmMetrics = extractGcodeMetrics(wasmGcodePath);

    let extrusionDelta = null;
    let extrusionDeltaPct = null;
    if (nativeMetrics && wasmMetrics) {
      extrusionDelta = Number((wasmMetrics.totalExtrusion - nativeMetrics.totalExtrusion).toFixed(4));
      extrusionDeltaPct = nativeMetrics.totalExtrusion > 0
        ? Number(((Math.abs(extrusionDelta) / nativeMetrics.totalExtrusion) * 100).toFixed(5))
        : 0;
    }

    const caseReport = {
      caseId: c.id,
      title: c.title,
      nativeCmd: nativeCmdStr,
      nativeSliceMs,
      wasmSliceMs,
      compareExit,
      macosRefExit,
      diffCount: cmpParsed ? cmpParsed.diffCount : 'N/A',
      firstDiffs: cmpParsed ? cmpParsed.firstDiffs : [],
      nativeMetrics,
      wasmMetrics,
      extrusionDelta,
      extrusionDeltaPct,
      nativeErr,
      wasmErr,
      artifacts: {
        nativeGcode: nativeGcodePath,
        wasmGcode: wasmGcodePath,
        diffReport: diffReportPath,
        resultJson: resultJsonPath
      }
    };

    perCaseReports.push(caseReport);
    fs.writeFileSync(resultJsonPath, JSON.stringify(caseReport, null, 2));

    summaryRows.push({
      id: c.id,
      nativeExit: nativeErr ? 'failed' : 'ok',
      wasmExit: wasmErr ? 'failed' : 'ok',
      compareExit,
      macosRefExit,
      diffs: cmpParsed ? String(cmpParsed.diffCount) : '-',
      natMs: String(nativeSliceMs),
      wasmMs: String(wasmSliceMs),
      natExtr: nativeMetrics ? String(nativeMetrics.totalExtrusion) : '-',
      wasmExtr: wasmMetrics ? String(wasmMetrics.totalExtrusion) : '-'
    });

    console.log('');
  }

  core.dispose();

  // Print final summary
  console.log('================================================================');
  console.log('                     Parity Summary Table                       ');
  console.log('================================================================');
  const pad = (str, len) => String(str).padEnd(len);
  const header = `| ${pad('Case ID', 14)} | ${pad('Cmp Exit', 8)} | ${pad('macOS Ref', 9)} | ${pad('Diff Lines', 10)} | ${pad('Nat (ms)', 8)} | ${pad('WASM (ms)', 9)} | ${pad('Nat Extr', 10)} | ${pad('WASM Extr', 10)} |`;
  const sep = `|-${'-'.repeat(14)}-|-${'-'.repeat(8)}-|-${'-'.repeat(9)}-|-${'-'.repeat(10)}-|-${'-'.repeat(8)}-|-${'-'.repeat(9)}-|-${'-'.repeat(10)}-|-${'-'.repeat(10)}-|`;
  console.log(header);
  console.log(sep);
  for (const r of summaryRows) {
    console.log(`| ${pad(r.id, 14)} | ${pad(r.compareExit, 8)} | ${pad(r.macosRefExit, 9)} | ${pad(r.diffs, 10)} | ${pad(r.natMs, 8)} | ${pad(r.wasmMs, 9)} | ${pad(r.natExtr, 10)} | ${pad(r.wasmExtr, 10)} |`);
  }
  console.log(sep);

  console.log('\n--- Observed Parity Assessment & Diagnosis ---');
  for (const rep of perCaseReports) {
    console.log(`Case [${rep.caseId}]: compare_gcode exit ${rep.compareExit} (${rep.diffCount} differing normalized lines)`);
    if (rep.nativeMetrics && rep.wasmMetrics) {
      console.log(`  Extrusion : Native ${rep.nativeMetrics.totalExtrusion} mm vs WASM ${rep.wasmMetrics.totalExtrusion} mm`);
      console.log(`  X bounds  : Native [${rep.nativeMetrics.xRange}] vs WASM [${rep.wasmMetrics.xRange}]`);
      console.log(`  Y bounds  : Native [${rep.nativeMetrics.yRange}] vs WASM [${rep.wasmMetrics.yRange}]`);
      console.log(`  Z bounds  : Native [${rep.nativeMetrics.zRange}] vs WASM [${rep.wasmMetrics.zRange}]`);
    }

    let deltaSummary = null;
    if (rep.nativeMetrics && rep.wasmMetrics) {
      const natE = rep.nativeMetrics.totalExtrusion;
      const wasmE = rep.wasmMetrics.totalExtrusion;
      const delta = Number((wasmE - natE).toFixed(4));
      const absDelta = Math.abs(delta);
      const pct = natE > 0 ? (absDelta / natE) * 100 : 0;
      const pctStr = pct < 0.001 ? `${pct.toFixed(5)}%` : `${pct.toFixed(3)}%`;
      deltaSummary = {
        natE,
        wasmE,
        delta,
        absDelta,
        pct,
        pctStr,
        isExact: absDelta === 0,
        deltaStr: `${delta >= 0 ? '+' : ''}${delta.toFixed(4)} mm`
      };
    }

    if (rep.compareExit === '2') {
      console.log(`  Observations & Hypotheses:`);
      console.log(`    - Normalized lines differ across ${rep.diffCount} lines (compare_gcode exit 2).`);
      if (deltaSummary) {
        if (deltaSummary.isExact) {
          console.log(`    - Total extrusion matches (${deltaSummary.natE} mm), but summed E and bounding box extents do not prove geometric equivalence.`);
        } else {
          console.log(`    - Total extrusion delta: ${deltaSummary.deltaStr} (${deltaSummary.pctStr}), but summed E and bounding box extents do not prove geometric equivalence.`);
        }
      }

      if (rep.macosRefExit === '0') {
        console.log(`    - macOS Reference: WASM output matches pre-recorded macOS x86_64 reference with exit 0 (0 differing lines).`);
        if (rep.caseId === 'cube-voron') {
          console.log(`    - Hypothesis: Toolchain differences (GNU libstdc++ on native Linux vs LLVM libc++ in WASM and macOS) are consistent with container hash/iteration reordering on cube-voron, but libstdc++ hashing is not established as the sole cause.`);
        }
      } else if (rep.macosRefExit !== 'no ref') {
        console.log(`    - macOS Reference: compare_gcode WASM vs macOS reference exited with ${rep.macosRefExit}.`);
      } else {
        console.log(`    - macOS Reference: No pre-recorded macOS x86_64 reference available for ${rep.caseId}.`);
      }

      if (rep.caseId === 'benchy-voron') {
        console.log(`    - Limits: The macOS cube match does not prove root cause for benchy-voron; floating-point order, optimization differences, or mesh handling remain unverified.`);
      } else if (rep.caseId === 'cube-bbl') {
        console.log(`    - Limits: Summed metrics and bounds do not prove geometry equivalence or isolate specific causes (e.g. prime-line/wipe sequences).`);
      }
    } else if (rep.compareExit === '1') {
      console.log(`  Observations:`);
      console.log(`    - Normalized lines differ within numeric tolerance (0.001 mm) (compare_gcode exit 1).`);
      if (rep.macosRefExit === '0') {
        console.log(`    - macOS Reference: WASM output matches pre-recorded macOS x86_64 reference with exit 0.`);
      } else if (rep.macosRefExit !== 'no ref') {
        console.log(`    - macOS Reference: compare_gcode WASM vs macOS reference exited with ${rep.macosRefExit}.`);
      } else {
        console.log(`    - macOS Reference: No pre-recorded macOS x86_64 reference available for ${rep.caseId}.`);
      }
    } else if (rep.compareExit === '0') {
      console.log(`  Observations:`);
      console.log(`    - Normalized output matches exactly (exit 0).`);
      if (rep.macosRefExit === '0') {
        console.log(`    - macOS Reference: WASM output matches pre-recorded macOS x86_64 reference with exit 0.`);
      } else if (rep.macosRefExit !== 'no ref') {
        console.log(`    - macOS Reference: compare_gcode WASM vs macOS reference exited with ${rep.macosRefExit}.`);
      }
    }
  }

  const hasFatalErrors = perCaseReports.some(
    (r) => r.nativeErr || r.wasmErr || r.compareExit === 'error'
  );
  const hasMismatches = perCaseReports.some((r) => r.compareExit !== '0');

  if (hasFatalErrors) {
    console.error('\nExecution encountered fatal errors during slicing or comparison.');
    process.exit(1);
  }

  if (hasMismatches) {
    // Retain per-case 0/1/2 semantics: if any case has exit 2, exit 2; otherwise exit 1
    const exitCode = perCaseReports.some((r) => r.compareExit === '2') ? 2 : 1;
    console.log(`\nParity mismatches observed (runner exiting with code ${exitCode}). Retaining per-case exit codes.`);
    process.exit(exitCode);
  }

  console.log('\nAll parity cases matched exactly (exit 0).');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error in native-parity.mjs:', err);
  process.exit(1);
});
