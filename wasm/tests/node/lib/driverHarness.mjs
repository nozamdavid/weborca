import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../app');
const { build } = createRequire(path.join(appDir, 'package.json'))('esbuild');

/** Bundles the app's printer drivers (TypeScript) so tests run exactly the code the browser runs. */
export async function loadDrivers() {
  const outfile = path.join(os.tmpdir(), `orca-printer-drivers-${process.pid}.mjs`);
  await build({
    entryPoints: [path.join(appDir, 'src/printers/api.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error'
  });
  return import(pathToFileURL(outfile).href);
}

const realFetch = globalThis.fetch;

/** Points the browser globals the drivers use (window.location, relative fetch URLs) at a gateway. */
export function useGateway(gateway) {
  globalThis.window = { location: { protocol: 'http:', host: `127.0.0.1:${gateway.port}`, origin: gateway.url } };
  globalThis.fetch = (input, init) => realFetch(typeof input === 'string' && input.startsWith('/') ? gateway.url + input : input, init);
}

export function restoreGlobals() {
  globalThis.fetch = realFetch;
  delete globalThis.window;
}
