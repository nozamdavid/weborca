import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from '../../app/node_modules/fflate/esm/index.mjs';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const out = new URL('../../build/tests-node/archive-models.mjs', import.meta.url);
await mkdir(new URL('.', out), { recursive: true });
const bundled = await build({ entryPoints: [new URL('../../app/src/shell/archiveModels.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(out, bundled.outputFiles[0].text);
const { readArchiveModels } = await import(pathToFileURL(out.pathname));

test('ZIP import extracts supported models from folders and ignores documents', async () => {
  const files = { 'models/cube.obj': strToU8('cube geometry'), 'parts/cube.stl': new Uint8Array([1, 2, 3]), 'README.txt': strToU8('ignored') };
  const models = await readArchiveModels(zipSync(files));
  assert.deepEqual(models.map(model => model.name), ['cube.obj', 'cube.stl']);
  assert.deepEqual(models[0].bytes, files['models/cube.obj']);
});

test('ZIP import rejects corrupt, empty, unsafe and oversized model inventories before loading', async () => {
  await assert.rejects(readArchiveModels(new Uint8Array([1, 2, 3])));
  await assert.rejects(readArchiveModels(zipSync({ 'README.txt': strToU8('none') })), /no supported model/);
  await assert.rejects(readArchiveModels(zipSync({ '../cube.obj': strToU8('unsafe') })), /unsafe/);
  const entries = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`${i}.obj`, new Uint8Array([1])]));
  await assert.rejects(readArchiveModels(zipSync(entries)), /200 models/);
  const oversized = zipSync({ 'huge.obj': new Uint8Array([1]) });
  const view = new DataView(oversized.buffer);
  for (let i = 0; i < oversized.length - 28; i++) {
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, 129 * 1024 * 1024, true);
      break;
    }
  }
  await assert.rejects(readArchiveModels(oversized), /128 MB/);
});
