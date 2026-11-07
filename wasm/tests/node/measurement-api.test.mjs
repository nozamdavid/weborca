import test, { describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngineCore } from '../../web/engine-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const candidatePaths = [
  process.env.ORCA_ENGINE_MODULE,
  path.join(repoRoot, 'wasm', 'build', 'orca-step-runtime', 'wasm', 'engine', 'orca_engine.mjs'),
  path.join(repoRoot, 'wasm', 'build', 'orca-wasm64', 'wasm', 'engine', 'orca_engine.mjs'),
  path.join(repoRoot, 'wasm', 'build', 'native-parity-runtime', 'orca_engine.mjs')
].filter(Boolean);

let modulePath = candidatePaths.find((p) => fs.existsSync(p));

function makeCubeObj(size = 20) {
  const h = size / 2;
  const vertices = [
    [-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0],
    [-h, -h, size], [h, -h, size], [h, h, size], [-h, h, size]
  ];
  const faces = [
    [1, 4, 3], [1, 3, 2], // bottom
    [5, 6, 7], [5, 7, 8], // top
    [1, 2, 6], [1, 6, 5], // front
    [2, 3, 7], [2, 7, 6], // right
    [3, 4, 8], [3, 8, 7], // back
    [4, 1, 5], [4, 5, 8]  // left
  ];
  let obj = 'o Cube\n';
  for (const v of vertices) obj += `v ${v[0]} ${v[1]} ${v[2]}\n`;
  for (const f of faces) obj += `f ${f[0]} ${f[1]} ${f[2]}\n`;
  return obj;
}

function makeCylinderObj(radius = 10, height = 20, segments = 32) {
  let obj = 'o Cylinder\n';
  const vertices = [];
  // bottom center
  vertices.push([0, 0, 0]);
  // bottom rim
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    vertices.push([radius * Math.cos(a), radius * Math.sin(a), 0]);
  }
  // top center
  vertices.push([0, 0, height]);
  // top rim
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    vertices.push([radius * Math.cos(a), radius * Math.sin(a), height]);
  }

  for (const v of vertices) obj += `v ${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}\n`;

  // bottom cap
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    obj += `f 1 ${next + 2} ${i + 2}\n`;
  }
  // top cap
  const topCenterIdx = segments + 2;
  const topRimBase = segments + 3;
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    obj += `f ${topCenterIdx} ${topRimBase + i} ${topRimBase + next}\n`;
  }
  // side walls
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    const b1 = i + 2;
    const b2 = next + 2;
    const t1 = topRimBase + i;
    const t2 = topRimBase + next;
    obj += `f ${b1} ${b2} ${t2}\n`;
    obj += `f ${b1} ${t2} ${t1}\n`;
  }
  return obj;
}

test('Measurement API', async (t) => {
  if (!modulePath) {
    console.log('Engine module not yet present, skipping node test until runtime ready.');
    return;
  }

  const { default: moduleFactory } = await import(modulePath);
  const engine = await createEngineCore({ moduleFactory, threads: 2 });

  await engine.call('init', { resourcesDir: '/resources', dataDir: '/data' });

  // 1. Explicit invalid input rejection
  await t.test('explicit invalid input rejection', async () => {
    // Missing objectId
    const res1 = await engine.call('getMeasurementFeature', {});
    assert.equal(res1.success, false);
    assert.match(res1.error, /Missing objectId/i);

    // Non-existent objectId
    const res2 = await engine.call('getMeasurementFeature', {
      objectId: 999999,
      facetIndex: 0,
      position: [0, 0, 0]
    });
    assert.equal(res2.success, false);
    assert.match(res2.error, /Object not found/i);

    // Invalid facetIndex
    engine.writeFile('/models/cube.obj', Buffer.from(makeCubeObj(20)));
    await engine.call('addModel', { path: '/models/cube.obj' });
    const tree = await engine.call('getObjectTree', {});
    const objId = tree.objects[tree.objects.length - 1].id;

    const res3 = await engine.call('getMeasurementFeature', {
      objectId: objId,
      facetIndex: 999999,
      position: [0, 0, 0]
    });
    assert.equal(res3.success, false);
    assert.match(res3.error, /facetIndex/i);

    // Invalid/NaN position
    const res4 = await engine.call('getMeasurementFeature', {
      objectId: objId,
      facetIndex: 0,
      position: [NaN, 0, 0]
    });
    assert.equal(res4.success, false);
    assert.match(res4.error, /position/i);

    // Unknown selection string rejection
    const resUnknown = await engine.call('getMeasurementFeature', {
      objectId: objId,
      facetIndex: 0,
      position: [0, 0, 0],
      selection: 'invalid_mode'
    });
    assert.equal(resUnknown.success, false);
    assert.match(resUnknown.error, /Unknown selection mode/i);

    // Invalid / missing feature in measureFeatures
    const res5 = await engine.call('measureFeatures', {});
    assert.equal(res5.success, false);
    assert.match(res5.error, /Missing first feature/i);

    // Malformed feature in measureFeatures must be rejected and not return zero distance
    const resMalformed = await engine.call('measureFeatures', {
      first: { type: 'circle', circle: { center: [0, 0, 0], normal: [0, 0, 0], radius: -5 } }
    });
    assert.equal(resMalformed.success, false);
    assert.match(resMalformed.error, /Invalid or malformed/i);

    // Missing point coordinates
    const resNoPt = await engine.call('measureFeatures', {
      first: { type: 'point' }
    });
    assert.equal(resNoPt.success, false);
    assert.match(resNoPt.error, /Invalid or malformed/i);

    // Undefined feature type
    const resUndef = await engine.call('measureFeatures', {
      first: { type: 'undef' }
    });
    assert.equal(resUndef.success, false);
    assert.match(resUndef.error, /Invalid or malformed/i);

    // Unsupported feature shape
    const resUnsupported = await engine.call('measureFeatures', {
      first: { type: 'cylinder' }
    });
    assert.equal(resUnsupported.success, false);
    assert.match(resUnsupported.error, /Invalid or malformed/i);

    // Degenerate zero-length edge
    const resZeroEdge = await engine.call('measureFeatures', {
      first: { type: 'edge', edge: { start: [0, 0, 0], end: [0, 0, 0] } }
    });
    assert.equal(resZeroEdge.success, false);
    assert.match(resZeroEdge.error, /Invalid or malformed/i);

    // Zero-normal plane
    const resZeroNormalPlane = await engine.call('measureFeatures', {
      first: { type: 'plane', plane: { normal: [0, 0, 0], origin: [0, 0, 0] } }
    });
    assert.equal(resZeroNormalPlane.success, false);
    assert.match(resZeroNormalPlane.error, /Invalid or malformed/i);

    // Malformed raw representation (missing pt1 must not default to zero point)
    const resRawMissingPt1 = await engine.call('measureFeatures', {
      first: { raw: { type: 1 } }
    });
    assert.equal(resRawMissingPt1.success, false);
    assert.match(resRawMissingPt1.error, /Invalid or malformed/i);

    // Malformed second feature rejected (not returning misleading zero distance)
    const resBadSecond = await engine.call('measureFeatures', {
      first: { type: 'point', point: [10, 20, 30] },
      second: { type: 'circle', circle: { center: [0, 0, 0], normal: [0, 0, 0], radius: 10 } }
    });
    assert.equal(resBadSecond.success, false);
    assert.match(resBadSecond.error, /Invalid or malformed/i);
  });

  // 2. Parallel face clearance and 90 deg angle on cube
  await t.test('cube parallel face clearance and 90 degree angle', async () => {
    engine.writeFile('/models/cube20.obj', Buffer.from(makeCubeObj(20)));
    await engine.call('addModel', { path: '/models/cube20.obj' });
    const tree = await engine.call('getObjectTree', {});
    const objId = tree.objects[tree.objects.length - 1].id;

    // Top face is at z=20, normal [0, 0, 1]
    // Bottom face is at z=0, normal [0, 0, -1]
    const topFeatRes = await engine.call('getMeasurementFeature', {
      objectId: objId,
      facetIndex: 2, // top face triangle
      position: [0, 0, 20],
      selection: 'plane'
    });
    assert.equal(topFeatRes.success, true);
    assert.equal(topFeatRes.feature.type, 'plane');
    assert.ok(Math.abs(topFeatRes.feature.plane.normal[2] - 1.0) < 0.05);

    const bottomFeatRes = await engine.call('getMeasurementFeature', {
      objectId: objId,
      facetIndex: 0, // bottom face triangle
      position: [0, 0, 0],
      selection: 'plane'
    });
    assert.equal(bottomFeatRes.success, true);
    assert.equal(bottomFeatRes.feature.type, 'plane');
    assert.ok(Math.abs(bottomFeatRes.feature.plane.normal[2] - (-1.0)) < 0.05);

    // Parallel faces measurement: distance should be 20.0 mm
    const parallelMeasure = await engine.call('measureFeatures', {
      first: topFeatRes.feature,
      second: bottomFeatRes.feature
    });
    assert.equal(parallelMeasure.success, true);
    assert.equal(parallelMeasure.distanceType, 'infinite');
    assert.ok(Math.abs(parallelMeasure.distance - 20.0) < 0.1, `expected 20mm, got ${parallelMeasure.distance}`);
    assert.ok(parallelMeasure.distanceInfinite != null);

    // Front face (normal [0, -1, 0]) vs Top face (normal [0, 0, 1]) -> angle 90 degrees
    const frontFeatRes = await engine.call('getMeasurementFeature', {
      objectId: objId,
      facetIndex: 4, // front face
      position: [0, -10, 10],
      selection: 'plane'
    });
    assert.equal(frontFeatRes.success, true);

    const angleMeasure = await engine.call('measureFeatures', {
      first: topFeatRes.feature,
      second: frontFeatRes.feature
    });
    assert.equal(angleMeasure.success, true);
    assert.ok(angleMeasure.angle != null);
    assert.ok(Math.abs(angleMeasure.angle.deg - 90.0) < 0.5, `expected 90 deg, got ${angleMeasure.angle.deg}`);
  });

  // 3. Cylinder diameter known value and rejection under non-uniform scaling
  await t.test('cylinder diameter known value and non-uniform scaling ellipse rejection', async () => {
    // Cylinder radius 10 -> diameter 20
    engine.writeFile('/models/cyl.obj', Buffer.from(makeCylinderObj(10, 20, 32)));
    await engine.call('addModel', { path: '/models/cyl.obj' });
    const tree = await engine.call('getObjectTree', {});
    const objId = tree.objects[tree.objects.length - 1].id;
    const instId = tree.objects[tree.objects.length - 1].instances[0].id;

    // Detect circle feature on the top circular cap rim
    const cylFeatRes = await engine.call('getMeasurementFeature', {
      objectId: objId,
      instanceId: instId,
      facetIndex: 33, // top cap facet
      position: [10, 0, 20],
      selection: 'circle'
    });
    assert.equal(cylFeatRes.success, true);
    assert.equal(cylFeatRes.feature.type, 'circle');
    assert.ok(Math.abs(cylFeatRes.feature.circle.diameter - 20.0) < 0.2, `expected diameter 20, got ${cylFeatRes.feature.circle.diameter}`);

    // Single feature measurement on circle gives diameter
    const singleCircle = await engine.call('measureFeatures', {
      first: cylFeatRes.feature
    });
    assert.equal(singleCircle.success, true);
    assert.ok(Math.abs(singleCircle.diameter - 20.0) < 0.2);

    // Apply non-uniform scaling: scale X by 2, scale Y by 1 (ellipse)
    await engine.call('setInstanceTransform', {
      objectId: objId,
      instanceId: instId,
      scale: [2.0, 1.0, 1.0]
    });

    // Querying circle selection on the ellipse must fail / be rejected rather than returning false diameter
    const ellipseRes = await engine.call('getMeasurementFeature', {
      objectId: objId,
      instanceId: instId,
      facetIndex: 33,
      position: [20, 0, 20],
      selection: 'circle'
    });
    assert.equal(ellipseRes.success, false, 'Non-uniformly scaled circle must not be reported as a circle');
  });

  // 4. Transformed multipart measurement
  await t.test('transformed multipart measurement preserves world coordinates', async () => {
    engine.writeFile('/models/cube_part.obj', Buffer.from(makeCubeObj(20)));
    await engine.call('addModel', { path: '/models/cube_part.obj' });
    const tree = await engine.call('getObjectTree', {});
    const objId = tree.objects[tree.objects.length - 1].id;
    const instId = tree.objects[tree.objects.length - 1].instances[0].id;

    // Translate instance to [50, 50, 10]
    await engine.call('setInstanceTransform', {
      objectId: objId,
      instanceId: instId,
      offset: [50, 50, 10]
    });

    const topFeat = await engine.call('getMeasurementFeature', {
      objectId: objId,
      instanceId: instId,
      facetIndex: 2,
      position: [50, 50, 20],
      selection: 'plane'
    });
    assert.equal(topFeat.success, true);
    // Origin in world coordinates should reflect the offset (z=20)
    assert.ok(Math.abs(topFeat.feature.plane.origin[2] - 20) < 1.0);
  });
});
