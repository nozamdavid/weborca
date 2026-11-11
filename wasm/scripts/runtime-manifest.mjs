import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const roots = ['CMakeLists.txt', 'version.inc', 'cmake', 'deps', 'deps_src', 'src', 'wasm/CMakeLists.txt', 'wasm/engine', 'wasm/preview', 'wasm/step', 'wasm/deps', 'wasm/scripts'];
function files(root, relative = '', sourceOnly = false) {
  const result = {};
  // CMake copies these build outputs into the demo for local serving. They are
  // artifacts, never inputs to the next native compilation.
  if (sourceOnly && /^wasm\/preview\/demo\/orca_preview\.(?:js|wasm)(?:\.map)?$/.test(relative.split(path.sep).join('/'))) return result;
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) return result;
  if (sourceOnly && (/\.(?:o|log)$|(?:^|\/)(?:\.DS_Store|\.env(?:\..*)?)$/.test(relative) ||
      (fs.statSync(full).isDirectory() && /(?:^|\/)(?:node_modules|dist|build_[^/]*|install_[^/]*)(?:\/|$)|^deps\/build(?:\/|$)/.test(relative)))) return result;
  if (fs.lstatSync(full).isSymbolicLink()) throw new Error(`Symlink input is unsupported: ${relative}`);
  if (fs.statSync(full).isDirectory()) {
    for (const entry of fs.readdirSync(full).sort()) Object.assign(result, files(root, path.join(relative, entry), sourceOnly));
  } else result[relative.split(path.sep).join('/')] = hash(fs.readFileSync(full));
  return result;
}
export function sourceFingerprint(root) {
  return hash(JSON.stringify(Object.assign({}, ...roots.map(entry => files(root, entry, true)))));
}
function dependencyHash(prefix, kind) {
  if (!prefix || !fs.existsSync(prefix)) throw new Error('WASM_PREFIX must identify build dependencies');
  const dependencies = { base: files(prefix) };
  if (kind === 'step') {
    if (!process.env.OCCT_PREFIX) throw new Error('OCCT_PREFIX must identify STEP build dependencies');
    dependencies.occt = files(process.env.OCCT_PREFIX);
  }
  return hash(JSON.stringify(dependencies));
}
function configuration(root) {
  const architecture = process.env.WASM_ARCH ?? '64';
  return {
    architecture,
    cFlags: process.env.WASM_CFLAGS ?? `${architecture === '64' ? '-sMEMORY64=1 ' : ''}-pthread -fwasm-exceptions -O2`,
    toolchain: process.env.ORCA_EMSCRIPTEN_VERSION ?? '6.0.11',
    recipe: hash(JSON.stringify(Object.assign({}, files(root, 'wasm/deps', true), files(root, 'wasm/scripts', true))))
  };
}
export function captureIdentity(root, kind, prefix) {
  return { dependencies: dependencyHash(prefix, kind), build: configuration(root) };
}
function receiptPath(root, kind) {
  return path.join(process.env.ORCA_RUNTIME_IDENTITIES ?? path.join(root, 'wasm/build/runtime-identities'), `${kind}.json`);
}
function expectedIdentity(root, kind) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath(root, kind), 'utf8'));
  if (JSON.stringify(receipt.build) !== JSON.stringify(configuration(root))) throw new Error('Build configuration/recipe mismatch');
  if (process.env.WASM_PREFIX && receipt.dependencies !== dependencyHash(process.env.WASM_PREFIX, kind)) throw new Error('Dependency inputs changed');
  return receipt;
}
const required = {
  engine: ['orca_engine.mjs', 'orca_engine.wasm'],
  preview: ['orca_preview.js', 'orca_preview.wasm'],
  step: ['step_tessellate.mjs', 'step_tessellate.wasm', 'LICENSE_LGPL_21.txt', 'OCCT_LGPL_EXCEPTION.txt']
};
function runtimeFiles(dir, kind) {
  if (!required[kind]) throw new Error(`Unknown runtime kind: ${kind}`);
  for (const file of required[kind]) if (!fs.statSync(path.join(dir, file)).size) throw new Error(`Empty runtime: ${file}`);
  const entries = Object.fromEntries(Object.entries(files(dir)).filter(([name]) => /\.(?:m?js|wasm|txt)$/.test(name) && !(kind === 'engine' && name.startsWith('step/'))));
  for (const name of Object.keys(entries).filter(name => name.endsWith('.wasm'))) {
    if (!fs.readFileSync(path.join(dir, name)).subarray(0, 8).equals(Buffer.from([0,97,115,109,1,0,0,0]))) throw new Error(`Invalid WASM: ${name}`);
  }
  return entries;
}
export function createManifest(root, dir, kind, prefix) {
  if (!prefix || !fs.existsSync(prefix)) throw new Error('WASM_PREFIX must identify the dependencies used for this build');
  const source = sourceFingerprint(root);
  if (process.env.ORCA_BUILD_SOURCE && process.env.ORCA_BUILD_SOURCE !== source) throw new Error('Source changed during native build; rebuild before stamping');
  const identity = captureIdentity(root, kind, prefix);
  const manifest = { version: 1, kind, source, ...identity, artifacts: runtimeFiles(dir, kind) };
  fs.writeFileSync(path.join(dir, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
export function verifyManifest(root, dir, kind, expected = expectedIdentity(root, kind)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'runtime-manifest.json'), 'utf8'));
  if (manifest.version !== 1 || manifest.kind !== kind || !/^[a-f0-9]{64}$/.test(manifest.dependencies)) throw new Error(`Invalid ${kind} manifest`);
  if (manifest.source !== sourceFingerprint(root)) throw new Error(`Stale ${kind} runtime: source/build inputs changed; rebuild this runtime`);
  if (JSON.stringify(expected.build) !== JSON.stringify(configuration(root)) || manifest.dependencies !== expected.dependencies || JSON.stringify(manifest.build) !== JSON.stringify(expected.build)) throw new Error(`Mismatched ${kind} dependency/build identity`);
  if (JSON.stringify(manifest.artifacts) !== JSON.stringify(runtimeFiles(dir, kind))) throw new Error(`Mismatched ${kind} runtime bytes`);
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, kind, dir] = process.argv.slice(2);
  const root = fileURLToPath(new URL('../..', import.meta.url));
  if (command === 'fingerprint') console.log(sourceFingerprint(root));
  else if (command === 'identity') {
    const version = execFileSync('emcc', ['--version'], { encoding: 'utf8' }).split('\n')[0];
    const identity = captureIdentity(root, kind, process.env.WASM_PREFIX);
    if (!version.includes(identity.build.toolchain)) throw new Error(`Unexpected Emscripten: ${version}`);
    const target = receiptPath(root, kind);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(identity, null, 2) + '\n');
  }
  else if (command === 'create') {
    if (!process.env.ORCA_BUILD_SOURCE) throw new Error('Capture ORCA_BUILD_SOURCE with fingerprint before starting the native build');
    createManifest(root, dir, kind, process.env.WASM_PREFIX);
    verifyManifest(root, dir, kind);
  }
  else if (command === 'verify') verifyManifest(root, dir, kind);
  else throw new Error('Usage: runtime-manifest.mjs create|verify engine|preview|step DIRECTORY');
}
