/** Profile bed artwork resolves through nozzle presets, model metadata and custom overrides. */
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'orca-bed-assets-'));
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => JSON.parse(await readFile(new URL('../../build/web' + url, import.meta.url), 'utf8'))
  });
  const result = await build({ entryPoints: [new URL('../../app/src/plate/bedAssets.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
  const path = join(dir, 'bed.mjs');
  await writeFile(path, result.outputFiles[0].text);
  const { resolveBedAssets } = await import(pathToFileURL(path));
  const profile = await resolveBedAssets('Voron', 'Voron 2.4 300 0.4 nozzle', {});
  assert.equal(profile.model, '/profiles/assets/Voron/Voron_300_build_plate.stl');
  assert.equal(profile.texture, '/profiles/assets/Voron/voron_logo.svg');
  for (const url of Object.values(profile)) {
    assert.ok((await stat(new URL('../../build/web' + url, import.meta.url))).size > 0);
  }
  const custom = await resolveBedAssets('Voron', 'Voron 2.4 300 0.4 nozzle', { texture: 'data:image/svg+xml;base64,PHN2Zy8+' });
  assert.equal(custom.model, profile.model);
  assert.equal(custom.texture, 'data:image/svg+xml;base64,PHN2Zy8+');
  assert.deepEqual(await resolveBedAssets('', '', {}), {});
  console.log('Profile and custom bed artwork checks passed.');
} finally {
  globalThis.fetch = originalFetch;
  await rm(dir, { recursive: true, force: true });
}
