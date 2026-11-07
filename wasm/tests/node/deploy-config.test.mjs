import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../deploy/server.mjs');
const DEFAULT_STEPS = 'layer_height,wall_loops,sparse_infill_density,sparse_infill_pattern,enable_support,support_type';
const CANARY = 'CANARY_SECRET_VALUE_12345';

let tmp;
let port;
const running = new Set();

// server.mjs serves dist/ next to itself by default; run a temp copy on a free port.
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-deploy-config-'));
  fs.mkdirSync(path.join(tmp, 'dist', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'dist', 'preview'));
  fs.writeFileSync(path.join(tmp, 'dist', 'index.html'), '<!doctype html><title>spa</title>');
  fs.writeFileSync(path.join(tmp, 'dist', 'assets', 'a.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]));
  fs.writeFileSync(path.join(tmp, 'dist', 'preview', 'orca_preview.js'), 'export default {};');
  port = await freePort();
  fs.copyFileSync(serverSource, path.join(tmp, 'server.mjs'));
});

after(() => {
  for (const child of running) child.kill('SIGKILL');
  fs.rmSync(tmp, { recursive: true, force: true });
});

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port: found } = probe.address();
      probe.close(() => resolve(found));
    });
    probe.on('error', reject);
  });
}

async function start(extraEnv) {
  const env = { PATH: process.env.PATH, UNRELATED_CANARY: CANARY, PORT: String(port), ORCA_BIND: '127.0.0.1', ...extraEnv };
  const child = spawn(process.execPath, [path.join(tmp, 'server.mjs')], { cwd: tmp, env, stdio: ['ignore', 'pipe', 'inherit'] });
  running.add(child);
  child.exited = new Promise(resolve => child.on('exit', (code, signal) => { running.delete(child); resolve({ code, signal }); }));
  await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { if (String(chunk).includes('listening')) resolve(); });
    child.on('exit', () => reject(new Error('server exited before listening')));
  });
  return child;
}

const get = (pathname, host = 'weborca.noz.am') => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: pathname, headers: { host } }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      resolve({ status: res.statusCode, headers: { get: name => res.headers[name] }, text: async () => body, json: async () => JSON.parse(body) });
    });
  }).on('error', reject);
});

test('explicit MOBILE_SLICE_STEPS is served verbatim and the process stops on SIGTERM', async () => {
  const steps = 'enable_support,support_type,infill_pct,infill_pattern';
  const child = await start({ MOBILE_SLICE_STEPS: steps });

  const health = await get('/healthz');
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  assert.equal((await get('/healthz', 'evil.example')).status, 421);
  assert.equal((await get('/healthz', 'localhost')).status, 200);

  const config = await get('/app-config.json');
  assert.equal(config.status, 200);
  assert.match(config.headers.get('content-type'), /^application\/json/);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  const text = await config.text();
  assert.deepEqual(JSON.parse(text), { mobileSliceSteps: steps });
  assert.ok(!text.includes(CANARY), 'unrelated environment value leaked');

  // Cross-origin isolation headers the threaded WASM engine needs, plus SPA and asset handling.
  const spa = await get('/calibration');
  assert.equal(spa.status, 200);
  assert.match(spa.headers.get('content-type'), /^text\/html/);
  assert.match(await spa.text(), /<title>spa<\/title>/);
  assert.equal(spa.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(spa.headers.get('cross-origin-embedder-policy'), 'require-corp');
  for (const route of ['/prepare', '/preview', '/preview/', '/preview?scheme=Speed', '/device', '/calibration']) {
    const response = await get(route);
    assert.equal(response.status, 200, `${route} opens the app directly`);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(await response.text(), /<title>spa<\/title>/);
  }
  const previewScript = await get('/preview/orca_preview.js');
  assert.equal(previewScript.status, 200);
  assert.equal(previewScript.headers.get('content-type'), 'application/javascript');
  for (const route of ['/preview/missing.js', '/preview/missing.wasm', '/preview/missing', '/preview/nested/']) {
    assert.equal((await get(route)).status, 404, `${route} never falls back to HTML`);
  }
  const wasm = await get('/assets/a.wasm');
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal(wasm.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.match(wasm.headers.get('cache-control'), /immutable/);
  assert.equal((await get('/assets/missing.js')).status, 404);

  child.kill('SIGTERM');
  assert.deepEqual(await child.exited, { code: 0, signal: null });
});

test('unset MOBILE_SLICE_STEPS serves the build-time default; empty stays empty', async () => {
  let child = await start({});
  assert.deepEqual(await (await get('/app-config.json')).json(), { mobileSliceSteps: DEFAULT_STEPS });
  child.kill('SIGTERM');
  await child.exited;

  child = await start({ MOBILE_SLICE_STEPS: '' });
  assert.deepEqual(await (await get('/app-config.json')).json(), { mobileSliceSteps: '' });
  child.kill('SIGTERM');
  assert.deepEqual(await child.exited, { code: 0, signal: null });
});

test('server default, Vite default, Dockerfile and Compose defaults agree', () => {
  const root = path.resolve(path.dirname(serverSource), '..');
  const files = [
    path.join(root, 'app/vite.config.ts'),
    path.join(root, 'deploy/Dockerfile'),
    path.join(root, '../compose.staging.yaml'),
    serverSource
  ];
  for (const file of files) assert.ok(fs.readFileSync(file, 'utf8').includes(DEFAULT_STEPS), `${file} default differs`);
});
