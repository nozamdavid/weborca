/**
 * vite.config.ts - OrcaSlicer Web App Configuration
 *
 * Architecture & Asset Serving Strategy:
 * ---------------------------------------
 * 1. Cross-Origin Isolation (COOP / COEP):
 *    WebAssembly multi-threaded slicing utilizes SharedArrayBuffer and pthreads.
 *    Browsers mandate Cross-Origin Opener Policy ('same-origin') and
 *    Cross-Origin Embedder Policy ('require-corp') headers to enable SharedArrayBuffer.
 *    Both `server.headers` (dev) and `preview.headers` (vite preview) inject these headers.
 *
 * 2. Development Mode Asset Serving:
 *    During development (`npm run dev`), we do not duplicate heavy artifacts. A custom
 *    Vite middleware plugin maps:
 *      - `/engine/*`   -> `wasm/build/orca-step-runtime/wasm/engine/*` (orca_engine.mjs, orca_engine.wasm,
 *                         OCCT license texts), falling back to `wasm/build/orca-wasm64/wasm/engine/*`
 *      - `/preview/*`  -> `wasm/build/orca-wasm64-preview/wasm/preview/*` (orca_preview.js, orca_preview.wasm)
 *      - `/profiles/*` -> `wasm/build/web/profiles/*` (packed vendor profiles and index.json)
 *      - `/web/*`      -> `wasm/web/*` (orca-engine.js, engine-worker.js, engine-core.js)
 *      - `/settings/*` -> `wasm/build/settings/*` (layout.json)
 *      - Root worker   -> `/engine-worker.js`, `/engine-core.js`, `/orca-engine.js` from `wasm/web/*`
 *      - Root preview  -> `/orca_preview.js`, `/orca_preview.wasm`
 *    Correct MIME types (application/wasm, application/javascript, application/json) and
 *    COOP/COEP headers are applied directly to all served responses.
 *
 * 3. Production Build (`vite build`):
 *    To ensure `dist/` is a completely self-contained static site that can be hosted on
 *    any static web server (or tested via `vite preview`), a custom `closeBundle` plugin hook
 *    copies:
 *      - the engine dir above (STEP-enabled if built) -> `dist/engine`
 *      - `wasm/build/orca-wasm64-preview/wasm/preview` -> `dist/preview` and root `dist/`
 *      - `wasm/build/web/profiles`           -> `dist/profiles`
 *      - `wasm/web` (worker & client libs)   -> `dist/web` and root `dist/`
 *      - `wasm/build/settings/layout.json`   -> `dist/settings/layout.json` and `dist/layout.json`
 *    This allows zero-config deployment without runtime backend proxying.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

const repoRoot = path.resolve(__dirname, '../..');
// The STEP-enabled engine (wasm/scripts/build_step_engine.sh) is preferred. It is always loaded
// rather than swapped in on STEP import: swapping workers mid-session would mean serializing the
// whole project. Measured cost: 28 MB vs 15 MB of wasm. Without it, STEP imports fail with an error.
const stepEngineBuildDir = path.resolve(repoRoot, 'wasm/build/orca-step-runtime/wasm/engine');
const engineBuildDir = fs.existsSync(path.join(stepEngineBuildDir, 'orca_engine.wasm'))
  ? stepEngineBuildDir
  : path.resolve(repoRoot, 'wasm/build/orca-wasm64/wasm/engine');
const previewBuildDir = path.resolve(repoRoot, 'wasm/build/orca-wasm64-preview/wasm/preview');
const profilesBuildDir = path.resolve(repoRoot, 'wasm/build/web/profiles');
const settingsBuildDir = path.resolve(repoRoot, 'wasm/build/settings');
const webDir = path.resolve(repoRoot, 'wasm/web');

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.wasm':
      return 'application/wasm';
    case '.mjs':
    case '.js':
      return 'application/javascript';
    case '.json':
      return 'application/json';
    case '.html':
      return 'text/html';
    case '.css':
      return 'text/css';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function serveStaticFile(reqPath: string, baseDir: string, res: any): boolean {
  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const targetPath = path.join(baseDir, safePath);

  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
    const mime = getMimeType(targetPath);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    fs.createReadStream(targetPath).pipe(res);
    return true;
  }
  return false;
}

function orcaAssetsPlugin() {
  let resolvedDistDir = path.resolve(__dirname, 'dist');

  return {
    name: 'orca-assets-plugin',

    configResolved(config: any) {
      if (config.build?.outDir) {
        resolvedDistDir = path.resolve(config.root || __dirname, config.build.outDir);
      }
    },

    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        const url = req.url ? req.url.split('?')[0] : '';

        // Serve engine module at /engine/
        if (url.startsWith('/engine/')) {
          const subPath = url.replace(/^\/engine\//, '');
          if (serveStaticFile(subPath, engineBuildDir, res)) return;
        }

        // Serve preview module at /preview/
        if (url.startsWith('/preview/')) {
          const subPath = url.replace(/^\/preview\//, '');
          if (serveStaticFile(subPath, previewBuildDir, res)) return;
        }

        // Serve preview files directly at root if requested
        if (url === '/orca_preview.js' || url === '/orca_preview.wasm') {
          const fileName = url.substring(1);
          if (serveStaticFile(fileName, previewBuildDir, res)) return;
        }

        // Serve packed profiles at /profiles/
        if (url.startsWith('/profiles/')) {
          const subPath = url.replace(/^\/profiles\//, '');
          if (serveStaticFile(subPath, profilesBuildDir, res)) return;
        }

        // Serve settings layout at /settings/layout.json or /layout.json
        if (url === '/settings/layout.json' || url === '/layout.json') {
          if (serveStaticFile('layout.json', settingsBuildDir, res)) return;
        }

        // Serve worker and client files at /web/
        if (url.startsWith('/web/')) {
          const subPath = url.replace(/^\/web\//, '');
          if (serveStaticFile(subPath, webDir, res)) return;
        }

        // Serve worker / core / orca-engine directly at root if requested
        if (
          url === '/engine-worker.js' ||
          url === '/engine-core.js' ||
          url === '/orca-engine.js'
        ) {
          const fileName = url.substring(1);
          if (serveStaticFile(fileName, webDir, res)) return;
        }

        next();
      });
    },

    closeBundle() {
      const distDir = resolvedDistDir;
      if (!fs.existsSync(distDir)) return;

      console.log('[orca-assets] Packaging engine, preview, profiles, and worker into dist/...');

      // 1. Copy engine module into dist/engine
      const distEngine = path.join(distDir, 'engine');
      if (fs.existsSync(engineBuildDir)) {
        fs.mkdirSync(distEngine, { recursive: true });
        for (const file of fs.readdirSync(engineBuildDir)) {
          if (file.endsWith('.mjs') || file.endsWith('.wasm') || file.endsWith('.txt')) {
            fs.copyFileSync(path.join(engineBuildDir, file), path.join(distEngine, file));
          }
        }
      }

      // 2. Copy preview module into dist/preview and dist/ root
      const distPreview = path.join(distDir, 'preview');
      if (fs.existsSync(previewBuildDir)) {
        fs.mkdirSync(distPreview, { recursive: true });
        for (const file of fs.readdirSync(previewBuildDir)) {
          if (file.endsWith('.js') || file.endsWith('.wasm')) {
            fs.copyFileSync(path.join(previewBuildDir, file), path.join(distPreview, file));
            fs.copyFileSync(path.join(previewBuildDir, file), path.join(distDir, file));
          }
        }
      }

      // 3. Copy profiles into dist/profiles
      const distProfiles = path.join(distDir, 'profiles');
      if (fs.existsSync(profilesBuildDir)) {
        fs.mkdirSync(distProfiles, { recursive: true });
        for (const file of fs.readdirSync(profilesBuildDir)) {
          if (file.endsWith('.json')) {
            fs.copyFileSync(path.join(profilesBuildDir, file), path.join(distProfiles, file));
          }
        }
      }

      // 4. Copy web worker & orca-engine files into dist/web and dist/ root
      const distWeb = path.join(distDir, 'web');
      fs.mkdirSync(distWeb, { recursive: true });
      const webFiles = ['engine-worker.js', 'engine-core.js', 'orca-engine.js', 'orca-engine.d.ts'];
      for (const file of webFiles) {
        const src = path.join(webDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(distWeb, file));
          fs.copyFileSync(src, path.join(distDir, file));
        }
      }

      // 5. Copy layout.json into dist/settings/layout.json and dist/layout.json
      const distSettings = path.join(distDir, 'settings');
      fs.mkdirSync(distSettings, { recursive: true });
      const layoutSrc = path.join(settingsBuildDir, 'layout.json');
      if (fs.existsSync(layoutSrc)) {
        fs.copyFileSync(layoutSrc, path.join(distSettings, 'layout.json'));
        fs.copyFileSync(layoutSrc, path.join(distDir, 'layout.json'));
      }

      console.log('[orca-assets] Assets successfully copied to dist/.');
    }
  };
}

export default defineConfig({
  plugins: [react(), orcaAssetsPlugin()],
  server: {
    fs: {
      allow: [repoRoot]
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  preview: {
    port: 5058,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
});
