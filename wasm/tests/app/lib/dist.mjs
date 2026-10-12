import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');

async function isServerRunning(port) {
  const url = `http://127.0.0.1:${port}`;
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function getMaxMtime(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  const stat = fs.statSync(dirPath);
  if (stat.isFile()) return stat.mtimeMs;
  let max = stat.mtimeMs;
  for (const child of fs.readdirSync(dirPath)) {
    max = Math.max(max, getMaxMtime(path.join(dirPath, child)));
  }
  return max;
}

let serverProcess = null;

async function startServer(port, testName, { frozenDist = false } = {}) {
  let outDir;
  if (process.env.APP_TEST_DIST) {
    outDir = path.resolve(process.env.APP_TEST_DIST);
  } else {
    const safeName = testName === 'calibration' ? 'calibration-test' : testName;
    outDir = path.resolve(repoRoot, `wasm/build/ui-${safeName}-dist`);
    console.log(`[Server] Building into ${outDir} ...`);
    execSync(`npx vite build --outDir ${outDir} --emptyOutDir`, {
      cwd: path.resolve(repoRoot, 'wasm/app'),
      stdio: 'inherit'
    });
  }

  const srcDir = path.resolve(repoRoot, 'wasm/app/src');
  const webDir = path.resolve(repoRoot, 'wasm/web');
  const stepEngineBuildDir = path.resolve(repoRoot, 'wasm/build/orca-step-runtime/wasm/engine');
  const fallbackEngineBuildDir = path.resolve(repoRoot, 'wasm/build/orca-wasm64/wasm/engine');
  const engineWasm = fs.existsSync(path.join(stepEngineBuildDir, 'orca_engine.wasm'))
    ? path.join(stepEngineBuildDir, 'orca_engine.wasm')
    : path.join(fallbackEngineBuildDir, 'orca_engine.wasm');

  const appDir = path.resolve(repoRoot, 'wasm/app');
  const latestSrcTime = Math.max(
    getMaxMtime(srcDir),
    getMaxMtime(path.join(appDir, 'public')),
    getMaxMtime(path.join(appDir, 'vite.config.ts')),
    getMaxMtime(path.join(appDir, 'index.html')),
    getMaxMtime(webDir),
    getMaxMtime(engineWasm)
  );

  const outDirTime = getMaxMtime(outDir);
  // Performance comparisons deliberately run a specified pre-change artifact.
  if (outDirTime < latestSrcTime && !(frozenDist && process.env.APP_TEST_DIST)) {
    throw new Error(`The dist directory (${outDir}) is older than the source files. Refusing to run.`);
  }

  if (await isServerRunning(port)) {
    throw new Error(`Port ${port} is occupied by an unrelated server; failing per test isolation requirements`);
  }

  const previewArgs = ['vite', 'preview', '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'];

  console.log(`[Server] Launching 'vite preview' on port ${port}...`);
  serverProcess = spawn('npx', previewArgs, {
    cwd: path.resolve(repoRoot, 'wasm/app'),
    stdio: 'ignore',
    detached: true
  });

  const start = Date.now();
  let ready = false;
  while (Date.now() - start < 15000) {
    if (await isServerRunning(port)) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!ready) {
    await stopServer(port);
    throw new Error(`Server failed to respond on port ${port} within timeout`);
  }
  console.log(`[Server] Vite preview server ready at http://127.0.0.1:${port}`);
}

async function stopServer(port) {
  console.log(`[Server] Terminating server on port ${port}...`);
  if (serverProcess && serverProcess.pid) {
    try {
      process.kill(-serverProcess.pid, 'SIGTERM');
      await new Promise((r) => setTimeout(r, 1000));
      process.kill(-serverProcess.pid, 'SIGKILL');
    } catch (e) {
      // ignore
    }
    serverProcess = null;
  }
}

export { startServer, stopServer, isServerRunning };
