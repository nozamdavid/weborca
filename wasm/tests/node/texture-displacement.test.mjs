import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createEngineCore } from '../../web/engine-core.js';

test('texture bake changes surface positions and invalid inputs preserve geometry', async () => {
  const { default: moduleFactory } = await import(path.resolve(process.env.ORCA_ENGINE_MODULE));
  const engine = await createEngineCore({ moduleFactory, threads: 2 });
  try {
    await engine.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    engine.writeFile('/models/cube.obj', fs.readFileSync('tests/data/20mm_cube.obj'));
    await engine.call('loadModel', { path: '/models/cube.obj' });
    const tree = await engine.call('getObjectTree', {});
    const objectId = tree.objects[0].id;
    const volumeId = tree.objects[0].volumes[0].id;
    const mesh = async () => {
      const result = await engine.call('getMesh', { objectId });
      return new Uint8Array(engine.readFile(result.path));
    };
    const before = await mesh();
    const args = { objectId, volumeId, depth: 0.4, tileSize: 12.5,
      image: Array.from(fs.readFileSync('resources/textures/displacement/Knurl.png')) };
    await assert.rejects(engine.call('textureDisplace', { ...args, depth: 0 }));
    assert.deepEqual(await mesh(), before);
    await assert.rejects(engine.call('textureDisplace', { ...args, image: [1, 2, 3] }));
    assert.deepEqual(await mesh(), before);
    for (const [offset, size] of [[16, 2049], [20, 65536], [16, 0]]) {
      const oversized = Buffer.from(args.image);
      oversized.writeUInt32BE(size, offset);
      await assert.rejects(engine.call('textureDisplace', { ...args, image: Array.from(oversized) }), /dimensions/);
      assert.deepEqual(await mesh(), before);
    }
    await engine.call('textureDisplace', args);
    const after = await mesh();
    const data = new DataView(after.buffer, after.byteOffset, after.byteLength);
    let maxDistance = 0;
    // Cube surface planes are the coordinate extrema of the original geometry.
    const original = new DataView(before.buffer, before.byteOffset, before.byteLength);
    const bounds = Array.from({ length: 3 }, () => [Infinity, -Infinity]);
    for (let i = 0; i < original.getUint32(4, true); i++) for (let axis = 0; axis < 3; axis++) {
      const p = original.getFloat32(16 + (3 * i + axis) * 4, true);
      bounds[axis][0] = Math.min(bounds[axis][0], p); bounds[axis][1] = Math.max(bounds[axis][1], p);
    }
    for (let i = 0; i < data.getUint32(4, true); i++) {
      let nearestPlane = Infinity;
      for (let axis = 0; axis < 3; axis++) {
        const p = data.getFloat32(16 + (3 * i + axis) * 4, true);
        nearestPlane = Math.min(nearestPlane, ...bounds[axis].map(b => Math.abs(p - b)));
      }
      maxDistance = Math.max(maxDistance, nearestPlane);
    }
    assert(maxDistance > 0.01, `surface displacement ${maxDistance} mm`);
    console.log(`Maximum distance from original cube surface: ${maxDistance.toFixed(4)} mm`);
  } finally { await engine.dispose?.(); }
});
