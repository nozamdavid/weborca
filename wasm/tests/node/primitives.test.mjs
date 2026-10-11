/** Primitive meshes must be closed, consistently oriented solids before native import. */
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'orca-primitives-'));
try {
  const bundle = await build({ entryPoints: [new URL('../../app/src/plate/primitives.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
  const file = join(dir, 'primitives.mjs');
  await writeFile(file, bundle.outputFiles[0].text);
  const { primitiveMesh, PRIMITIVE_LABELS } = await import(pathToFileURL(file));
  for (const shape of Object.keys(PRIMITIVE_LABELS)) {
    const { vertices, faces } = primitiveMesh(shape, 20);
    const edges = new Map();
    for (const face of faces) {
      assert.equal(new Set(face).size, 3, `${shape}: degenerate face indices`);
      for (let i = 0; i < 3; i++) {
        const a = face[i], b = face[(i + 1) % 3];
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        const edge = edges.get(key) || { count: 0, orientation: 0 };
        edge.count++;
        edge.orientation += a < b ? 1 : -1;
        edges.set(key, edge);
      }
    }
    for (const [key, edge] of edges) {
      assert.equal(edge.count, 2, `${shape}: open/nonmanifold edge ${key}`);
      assert.equal(edge.orientation, 0, `${shape}: inconsistent triangle winding at edge ${key}`);
    }
    let volume = 0;
    for (const [a, b, c] of faces.map(face => face.map(index => vertices[index])))
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    assert.ok(volume > 0, `${shape}: outward winding yields positive volume`);
    console.log(`${shape}: closed outward solid (${faces.length} faces)`);
  }
} finally { await rm(dir, { recursive: true, force: true }); }
