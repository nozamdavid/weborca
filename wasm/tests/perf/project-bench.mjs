#!/usr/bin/env node
/**
 * Project round-trip timing harness: opens a .3mf the way the web app does,
 * then repeats the saves an undo commit or autosave runs and the open an undo
 * restore runs. Records hashes of the saved archive's entries (timestamps
 * removed) so a faster save can be checked for identical content.
 *
 * Usage: node wasm/tests/perf/project-bench.mjs <project.3mf> [--runs N] [--out result.json] [--save-dir DIR]
 *   ORCA_ENGINE_MODULE / ORCA_ENGINE_CORE select the engine and its JS driver.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const projectPath = argv[0];
const runs = Number(arg('--runs', '3'));
const outFile = arg('--out', null);
const saveDir = arg('--save-dir', null);
const threads = Number(process.env.BENCH_THREADS || 4);
const saveArgs = JSON.parse(process.env.BENCH_SAVE_ARGS || '{}');

const modulePath = path.resolve(process.env.ORCA_ENGINE_MODULE ||
  path.join(repoRoot, 'wasm/build/orca-step-runtime/wasm/engine/orca_engine.mjs'));
const corePath = path.resolve(process.env.ORCA_ENGINE_CORE || path.join(repoRoot, 'wasm/web/engine-core.js'));
const bundleDir = path.join(repoRoot, 'wasm/build/tests-node');
const vendors = (process.env.BENCH_VENDORS || 'OrcaFilamentLibrary,BBL').split(',');

const timings = {};
async function timed(name, fn) {
  const t0 = performance.now();
  const r = await fn();
  (timings[name] ||= []).push(performance.now() - t0);
  return r;
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Hash every archive entry; the metadata dates are the only intended difference between two saves.
function entryHashes(file) {
  const dir = fs.mkdtempSync('/tmp/project-bench-');
  try {
    execFileSync('unzip', ['-q', '-o', file, '-d', dir]);
    const out = {};
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else {
          let data = fs.readFileSync(p);
          if (/\.(model|config|xml|json|rels)$/.test(e.name)) {
            data = Buffer.from(data.toString('utf8')
              .replace(/<metadata name="(CreationDate|ModificationDate)">[^<]*<\/metadata>/g, '')
              .replace(/"(CreationDate|ModificationDate|creation_date)":\s*"[^"]*"/g, ''));
          }
          out[path.relative(dir, p)] = sha(data);
        }
      }
    };
    walk(dir);
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const { createEngineCore } = await import(pathToFileURL(corePath).href);
  const mod = await import(pathToFileURL(modulePath).href);
  const core = await createEngineCore({ moduleFactory: mod.createOrcaEngine || mod.default, threads });
  for (const f of ['resources.json', ...vendors.map((v) => `profiles/${v}.json`)]) {
    await core.addVendorBundle(JSON.parse(fs.readFileSync(path.join(bundleDir, f), 'utf8')));
  }
  await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
  await timed('loadVendors', () => core.call('loadVendors', {}));

  const bytes = fs.readFileSync(projectPath);
  let opened;
  for (let i = 0; i < runs; i++) {
    core.writeFile('/models/input.3mf', bytes);
    opened = await timed('openProject', () => core.call('openProject', { path: '/models/input.3mf' }));
  }
  const objects = await timed('listObjects', () => core.call('listObjects', {}));
  await timed('getObjectTree', () => core.call('getObjectTree', {}));
  const config = await timed('getConfig', () => core.call('getConfig', {}));
  const mesh = await timed('getMesh', () => core.call('getMesh', { objectId: objects[0].id }));
  const state = async (objs, cfg) => ({
    config: sha(JSON.stringify(cfg)),
    meshes: await Promise.all(objs.map(async (o) => {
      const m = await core.call('getMesh', { objectId: o.id });
      return sha(core.readFile(m.path));
    }))
  });
  const openedState = await state(objects, config);
  for (let i = 0; i < runs * 3; i++) await timed('listObjectsRepeat', () => core.call('listObjects', {}));
  const inst = objects[0].instances[0];
  for (let i = 0; i < runs; i++) {
    await timed('setInstanceTransform', () => core.call('setInstanceTransform', { objectId: objects[0].id, instanceId: inst.id, offset: inst.offset }));
  }

  let saved;
  for (let i = 0; i < runs; i++) {
    await timed('saveProject', () => core.call('saveProject', { path: '/out/bench.3mf', ...saveArgs }));
    saved = core.readFile('/out/bench.3mf');
  }
  const savedCopy = path.join(saveDir || '/tmp', 'project-bench-saved.3mf');
  fs.writeFileSync(savedCopy, saved);

  for (let i = 0; i < runs; i++) {
    core.writeFile('/models/resaved.3mf', saved);
    await timed('reopenSaved', () => core.call('openProject', { path: '/models/resaved.3mf' }));
  }
  const objectsAfter = await core.call('listObjects', {});
  const reopenedState = await state(objectsAfter, await core.call('getConfig', {}));

  core.dispose();
  const summary = {};
  for (const [k, v] of Object.entries(timings)) {
    const s = [...v].sort((a, b) => a - b);
    summary[k] = { n: v.length, min: +s[0].toFixed(1), median: +s[Math.floor(s.length / 2)].toFixed(1), max: +s[s.length - 1].toFixed(1) };
  }
  const out = {
    module: modulePath, core: corePath, project: projectPath, threads, runs, summary,
    savedBytes: saved.length, savedPath: savedCopy,
    objects: objects.map((o) => ({ name: o.name, volumes: o.volumes, size: o.size, instances: o.instances.length })),
    objectsAfterReopen: objectsAfter.map((o) => ({ name: o.name, volumes: o.volumes, size: o.size })),
    meshVertices: mesh.vertexCount ?? mesh.vertices ?? null,
    saveArgs, openedState, reopenedState,
    roundTripMeshesEqual: JSON.stringify(openedState.meshes) === JSON.stringify(reopenedState.meshes),
    openWarnings: opened.warnings?.length ?? 0,
    savedEntries: entryHashes(savedCopy)
  };
  console.log(JSON.stringify(out, null, 2));
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
