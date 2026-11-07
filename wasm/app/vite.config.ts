import { printerGatewayPlugin } from './printerGateway';
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
 *      - `/engine/*`   -> `wasm/build/orca-wasm64/wasm/engine/*` (OCCT-free orca_engine.mjs, orca_engine.wasm)
 *      - `/engine/step/*` -> `wasm/build/step-module/*` (lazily loaded STEP module + OCCT license texts)
 *      - `/preview/*`  -> `wasm/build/orca-wasm64-preview/wasm/preview/*` (orca_preview.js, orca_preview.wasm)
 *      - `/profiles/*` -> `wasm/build/web/profiles/*` (packed vendor profiles and index.json)
 *      - `/web/*`      -> `wasm/web/*` (orca-engine.js, engine-worker.js, engine-core.js)
 *      - `/resources/calib/*` -> `resources/calib/*` (Draco calibration models)
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
 *      - the engine dir above -> `dist/engine`, the STEP module dir -> `dist/engine/step`
 *      - `wasm/build/orca-wasm64-preview/wasm/preview` -> `dist/preview` and root `dist/`
 *      - `wasm/build/web/profiles`           -> `dist/profiles`
 *      - `wasm/web` (worker & client libs)   -> `dist/web` and root `dist/`
 *      - `resources/calib` (.drc models only) -> `dist/resources/calib`
 *      - `wasm/build/settings/layout.json`   -> `dist/settings/layout.json` and `dist/layout.json`
 *    This allows zero-config deployment without runtime backend proxying.
 */

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { buildSync } from 'esbuild';
import { createOctoEverywhereGateway } from './gateway/octoEverywhere';
import { createAlphaAccess } from './gateway/alphaAccess';

const repoRoot = path.resolve(__dirname, '../..');
// The main engine is built without OpenCASCADE (SLIC3R_WITH_OCCT=OFF, wasm/scripts/build_orca.sh).
// STEP import lazily loads the separate tessellation module (wasm/scripts/build_step_module.sh) in
// its own worker and hands the packed mesh to the engine's loadStepMesh op.
// Explicit directories bind dev serving and production packaging to the same inputs.
const engineBuildDir = process.env.ORCA_ENGINE_DIR
  ? path.resolve(process.env.ORCA_ENGINE_DIR)
  : path.resolve(repoRoot, 'wasm/build/orca-wasm64/wasm/engine');
const stepModuleBuildDir = process.env.ORCA_STEP_MODULE_DIR
  ? path.resolve(process.env.ORCA_STEP_MODULE_DIR)
  : path.resolve(repoRoot, 'wasm/build/step-module');
const previewBuildDir = process.env.ORCA_PREVIEW_DIR
  ? path.resolve(process.env.ORCA_PREVIEW_DIR)
  : path.resolve(repoRoot, 'wasm/build/orca-wasm64-preview/wasm/preview');
const profilesBuildDir = process.env.ORCA_PROFILES_DIR
  ? path.resolve(process.env.ORCA_PROFILES_DIR)
  : path.resolve(repoRoot, 'wasm/build/web/profiles');
const settingsBuildDir = process.env.ORCA_SETTINGS_DIR
  ? path.resolve(process.env.ORCA_SETTINGS_DIR)
  : path.resolve(repoRoot, 'wasm/build/settings');
const webDir = path.resolve(repoRoot, 'wasm/web');
const calibBuildDir = path.resolve(repoRoot, 'resources/calib');
const handyModelsDir = path.resolve(repoRoot, 'resources/handy_models');

function buildAlphaBootstrap(outfile: string, write = true) {
  return buildSync({
    entryPoints: [path.resolve(__dirname, 'src/alpha/bootstrap.ts')], outfile, write,
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'warning',
    define: { 'import.meta.env.VITE_ALPHA_GATE_ENABLED': '"1"', 'process.env.NODE_ENV': '"production"' }
  });
}

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
  let alphaUiEnabled = false;

  return {
    name: 'orca-assets-plugin',

    configResolved(config: any) {
      alphaUiEnabled = config.env?.VITE_ALPHA_GATE_ENABLED === '1';
      if (config.build?.outDir) {
        resolvedDistDir = path.resolve(config.root || __dirname, config.build.outDir);
      }
    },

    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        const url = req.url ? req.url.split('?')[0] : '';

        if (url.startsWith('/profiles/assets/')) {
          const subPath = decodeURIComponent(url.substring('/profiles/assets/'.length));
          if (serveStaticFile(subPath, path.join(repoRoot, 'resources/profiles'), res)) return;
        }

        // Serve calibration models (Draco) at /resources/calib/
        if (url.startsWith('/resources/calib/')) {
          const subPath = url.replace(/^\/resources\/calib\//, '');
          if (serveStaticFile(subPath, calibBuildDir, res)) return;
        }

        // Serve the handy example models (Draco) at /resources/handy_models/
        if (url.startsWith('/resources/handy_models/')) {
          const subPath = url.replace(/^\/resources\/handy_models\//, '');
          if (serveStaticFile(subPath, handyModelsDir, res)) return;
        }

        // Serve the lazily loaded STEP module at /engine/step/
        if (url.startsWith('/engine/step/')) {
          const subPath = url.replace(/^\/engine\/step\//, '');
          if (serveStaticFile(subPath, stepModuleBuildDir, res)) return;
        }

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
          const subPath = decodeURIComponent(url.replace(/^\/profiles\//, '').split('?')[0]);
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
          url === '/step-worker.js' ||
          url === '/engine-core.js' ||
          url === '/engine-assets.js' ||
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

      const copyRuntimeAsset = (source: string, destinations: string[]) => {
        // Native linking can temporarily truncate these files. Capture once and fail
        // rather than silently publish an empty runtime during a concurrent build.
        const bytes = fs.readFileSync(source);
        if (bytes.length === 0 || (source.endsWith('.wasm') && (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))))) {
          throw new Error(`Invalid runtime asset ${source}; finish the native build before packaging`);
        }
        for (const destination of destinations) fs.writeFileSync(destination, bytes);
      };

      // 1. Copy engine module into dist/engine
      const distEngine = path.join(distDir, 'engine');
      if (fs.existsSync(engineBuildDir)) {
        fs.mkdirSync(distEngine, { recursive: true });
        for (const file of fs.readdirSync(engineBuildDir)) {
          if (file.endsWith('.mjs') || file.endsWith('.wasm') || file.endsWith('.txt')) {
            copyRuntimeAsset(path.join(engineBuildDir, file), [path.join(distEngine, file)]);
          }
        }
      }

      // 1b. Copy the lazily loaded STEP module (and the OCCT license texts it embeds) into dist/engine/step
      const distStep = path.join(distEngine, 'step');
      if (fs.existsSync(stepModuleBuildDir)) {
        fs.mkdirSync(distStep, { recursive: true });
        for (const file of fs.readdirSync(stepModuleBuildDir)) {
          if (file.endsWith('.mjs') || file.endsWith('.wasm') || file.endsWith('.txt')) {
            copyRuntimeAsset(path.join(stepModuleBuildDir, file), [path.join(distStep, file)]);
          }
        }
      }

      // 2. Copy preview module into dist/preview and dist/ root
      const distPreview = path.join(distDir, 'preview');
      if (fs.existsSync(previewBuildDir)) {
        fs.mkdirSync(distPreview, { recursive: true });
        for (const file of fs.readdirSync(previewBuildDir)) {
          if (file.endsWith('.js') || file.endsWith('.wasm')) {
            copyRuntimeAsset(path.join(previewBuildDir, file), [path.join(distPreview, file), path.join(distDir, file)]);
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
        for (const directory of ['covers', 'assets']) {
          const source = path.join(profilesBuildDir, directory);
          if (fs.existsSync(source)) fs.cpSync(source, path.join(distProfiles, directory), { recursive: true });
        }
      }

      // 4. Copy web worker & orca-engine files into dist/web and dist/ root
      const distWeb = path.join(distDir, 'web');
      fs.mkdirSync(distWeb, { recursive: true });
      const webFiles = ['engine-worker.js', 'step-worker.js', 'engine-core.js', 'engine-assets.js', 'orca-engine.js', 'orca-engine.d.ts'];
      for (const file of webFiles) {
        const src = path.join(webDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(distWeb, file));
          fs.copyFileSync(src, path.join(distDir, file));
        }
      }

      // 5. Copy the calibration models (.drc only) into dist/resources/calib
      if (fs.existsSync(calibBuildDir)) {
        fs.cpSync(calibBuildDir, path.join(distDir, 'resources/calib'), {
          recursive: true,
          filter: (src) => fs.statSync(src).isDirectory() || src.endsWith('.drc')
        });
      }

      if (fs.existsSync(handyModelsDir)) {
        fs.cpSync(handyModelsDir, path.join(distDir, 'resources/handy_models'), {
          recursive: true,
          filter: (src) => fs.statSync(src).isDirectory() || src.endsWith('.drc') || src.endsWith('.3mf')
        });
      }

      // 6. Copy layout.json into dist/settings/layout.json and dist/layout.json
      const distSettings = path.join(distDir, 'settings');
      fs.mkdirSync(distSettings, { recursive: true });
      const layoutSrc = path.join(settingsBuildDir, 'layout.json');
      if (fs.existsSync(layoutSrc)) {
        fs.copyFileSync(layoutSrc, path.join(distSettings, 'layout.json'));
        fs.copyFileSync(layoutSrc, path.join(distDir, 'layout.json'));
      }

      // The hosted server loads only this restricted cloud bridge, without printer routes.
      buildSync({
        entryPoints: [path.resolve(__dirname, 'gateway/orcaCloud.ts')],
        outfile: path.join(distDir, 'orca-cloud-bridge.mjs'),
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node20',
        logLevel: 'warning'
      });
      buildSync({
        entryPoints: [path.resolve(__dirname, 'gateway/hostedPrinterCloud.ts')],
        outfile: path.join(distDir, 'printer-cloud-bridge.mjs'),
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node20',
        external: ['bufferutil', 'utf-8-validate'],
        banner: { js: "import { createRequire as __orcaCreateRequire } from 'node:module'; const require = __orcaCreateRequire(import.meta.url);" },
        logLevel: 'warning'
      });
      buildSync({
        entryPoints: [path.resolve(__dirname, 'gateway/alphaAccess.ts')],
        outfile: path.join(distDir, 'alpha-access.mjs'),
        bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning'
      });
      if (alphaUiEnabled) {
        // Independent entry: sharing the main app's vendor chunks would expose app code before login.
        buildAlphaBootstrap(path.join(distDir, 'alpha-public/bootstrap.js'));
        fs.copyFileSync(path.resolve(__dirname, 'alpha-bootstrap.html'), path.join(distDir, 'alpha-bootstrap.html'));
      }
      buildSync({
        entryPoints: [path.resolve(__dirname, 'gateway/octoEverywhere.ts')],
        outfile: path.join(distDir, 'octoeverywhere-bridge.mjs'),
        bundle: true, platform: 'node', format: 'esm', target: 'node20',
        external: ['bufferutil', 'utf-8-validate'],
        banner: { js: "import { createRequire as __orcaCreateRequire } from 'node:module'; const require = __orcaCreateRequire(import.meta.url);" },
        logLevel: 'warning'
      });

      console.log('[orca-assets] Assets successfully copied to dist/.');
    }
  };
}

export default defineConfig(({ mode }) => {
  const attachAlpha = (server: any, preview = false) => {
    const root = preview ? path.resolve(server.config.root, server.config.build.outDir) : __dirname;
    // Dev asset mappings include paths elsewhere in the repo, beyond the HTML root.
    const alpha = createAlphaAccess({ webRoot: root, forbiddenDataRoots: preview ? [] : [repoRoot] });
    server.middlewares.use((req: any, res: any, next: () => void) => {
      void alpha.guard(req, res, async html => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(req.method === 'HEAD' ? undefined : html);
      }).then(handled => {
        if (handled) return;
        if (!preview && alpha.enabled && /^\/alpha-public\/bootstrap\.(?:js|css)$/.test(req.url?.split('?')[0] || '')) {
          const output = buildAlphaBootstrap(path.resolve(__dirname, 'alpha-public/bootstrap.js'), false);
          const suffix = req.url.split('?')[0].endsWith('.css') ? '.css' : '.js';
          const file = output.outputFiles?.find(file => file.path.endsWith(suffix));
          if (!file) { res.statusCode = 404; res.end('Not found'); return; }
          res.setHeader('Content-Type', suffix === '.css' ? 'text/css' : 'application/javascript');
          res.end(req.method === 'HEAD' ? undefined : file.contents);
          return;
        }
        next();
      }).catch(() => {
        res.statusCode = 503; res.end('Alpha unavailable');
      });
    });
    // EventEmitter prependListener cannot stop later provider listeners. Intercept dispatch itself.
    if (alpha.enabled && server.httpServer) {
      const emit = server.httpServer.emit;
      const close = server.httpServer.close;
      server.httpServer.close = function (...args: any[]) {
        alpha.close();
        return close.apply(this, args);
      };
      server.httpServer.emit = function (event: string, ...args: any[]) {
        if (event === 'upgrade' && !alpha.authorizeUpgrade(args[0], args[1])) {
          args[1].destroy(); return false;
        }
        return emit.call(this, event, ...args);
      };
      server.httpServer.once('close', () => {
        alpha.close();
        server.httpServer.emit = emit;
        server.httpServer.close = close;
      });
    }
  };
  const attachOctoEverywhere = (server: any) => {
    const gateway = createOctoEverywhereGateway();
    server.middlewares.use((req: any, res: any, next: () => void) => {
      void gateway.handle(req, res).then(handled => { if (!handled) next(); });
    });
    // Other gateways own their upgrade listeners. Observe only this provider's route.
    server.httpServer?.prependListener('upgrade', (req: any, socket: any, head: Buffer) => {
      if (req.url?.startsWith('/_octoeverywhere/')) void gateway.handleUpgrade(req, socket, head);
    });
    server.httpServer?.once('close', () => gateway.close());
  };
  const env = loadEnv(mode, __dirname, 'MOBILE_');
  const mobileSliceSteps = process.env.MOBILE_SLICE_STEPS ?? env.MOBILE_SLICE_STEPS ??
    'layer_height,wall_loops,sparse_infill_density,sparse_infill_pattern,enable_support,support_type';
  const mobileConfigMiddleware = (server: any) => { server.middlewares.use((req: any, res: any, next: () => void) => {
    if (req.url?.split('?')[0] === '/orca-cloud/callback') {
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      // Vite's HTML fallback sets no-cache later; callback credentials must never
      // become cacheable, even when the fallback supplies its own header.
      const setHeader = res.setHeader.bind(res);
      res.setHeader = (name: string, value: string | number | readonly string[]) =>
        setHeader(name, name.toLowerCase() === 'cache-control' ? 'no-store' : value);
    }
    if (req.url?.split('?')[0] !== '/app-config.json') return next();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ mobileSliceSteps }));
  }); };
  return {
  define: { 'import.meta.env.VITE_MOBILE_SLICE_STEPS': JSON.stringify(mobileSliceSteps) },
  plugins: [{ name: 'alpha-access', enforce: 'pre', configureServer: (server: any) => attachAlpha(server),
    configurePreviewServer: (server: any) => attachAlpha(server, true) },
    react(), orcaAssetsPlugin(), printerGatewayPlugin(), {
    name: 'octoeverywhere-gateway', configureServer: attachOctoEverywhere, configurePreviewServer: attachOctoEverywhere
  }, {
    name: 'mobile-app-config', configureServer: mobileConfigMiddleware, configurePreviewServer: mobileConfigMiddleware
  }],
  server: {
    allowedHosts: ['server-1.barbel-hops.ts.net', 'weborca.noz.am'],
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
    allowedHosts: ['server-1.barbel-hops.ts.net', 'weborca.noz.am'],
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
  };
});
