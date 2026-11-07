// Parity test for the standalone STEP tessellation module (wasm/step).
//
// Runs wasm/build/step-module/step_tessellate.mjs on the STEP fixtures and
// compares its packed output with what the current OCCT engine
// (wasm/build/orca-step-runtime) builds for the same file and deflections.
// The comparison is per facet, in facet order: names, triangle counts, the
// three vertex positions of every triangle and the overall bounds must match
// exactly (bit-identical float32). The engine deduplicates imported vertices
// (TriangleMesh::from_stl), so its vertex array is not comparable positionally,
// while the module keeps the pre-dedupe face/node order Step::mesh feeds into
// the same import path.
//
// The OCCT-free main engine (wasm/build/orca-wasm64) then imports the module's
// packed output through loadStepMesh. Its object, volume names and getMesh
// bytes must be identical to what the OCCT engine's loadModel produced.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEngineCore } from '../../web/engine-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// Reference: the engine with OCCT linked in (the former STEP import path).
const referenceEngineModulePath = process.env.ORCA_OCCT_ENGINE_MODULE
  ? path.resolve(process.env.ORCA_OCCT_ENGINE_MODULE)
  : path.join(repoRoot, 'wasm', 'build', 'orca-step-runtime', 'wasm', 'engine', 'orca_engine.mjs');

// Engine under test: built with SLIC3R_WITH_OCCT=OFF.
const engineModulePath = process.env.ORCA_ENGINE_MODULE
  ? path.resolve(process.env.ORCA_ENGINE_MODULE)
  : path.join(repoRoot, 'wasm', 'build', 'orca-wasm64', 'wasm', 'engine', 'orca_engine.mjs');

const stepModulePath = process.env.ORCA_STEP_MODULE
  ? path.resolve(process.env.ORCA_STEP_MODULE)
  : path.join(repoRoot, 'wasm', 'build', 'step-module', 'step_tessellate.mjs');

const bundleDir = path.join(repoRoot, 'wasm', 'build', 'tests-node');

const LINEAR_DEFLECTION = 0.003;
const ANGLE_DEFLECTION = 0.5;

// These release fixtures exercise the changed mesher and shape collector
// directly, without treating the former unpatched OCCT engine as an oracle.
describe('STEP release geometry regressions', () => {
  let module;
  before(async () => { module = await (await import(stepModulePath)).default(); });
  after(() => { module = null; });

  function mesh(bytes, split = false) {
    module.FS.writeFile('/release.step', bytes);
    assert.equal(module.step_tessellate_to_file('/release.step', LINEAR_DEFLECTION,
      ANGLE_DEFLECTION, split, '/release.bin'), '');
    const solids = parsePackedMesh(module.FS.readFile('/release.bin'));
    assert.ok(solids.length > 0);
    for (const solid of solids) {
      assert.ok(solid.indices.length > 0);
      assert.ok(solid.positions.every(Number.isFinite));
      assert.ok(solid.indices.every(index => index < solid.positions.length / 3));
    }
    return solids;
  }

  const fixture = name => fs.readFileSync(path.join(repoRoot, 'tests/data', name));

  test('tilted cone seam produces a closed mesh', t => {
    const solids = mesh(fixture('cone_tilted_seam_pcurve.step'));
    assert.equal(solids.length, 1);
    const { positions, indices } = solids[0];
    // OCCT duplicates vertices along face boundaries. Weld by exact float32
    // coordinates before counting incident triangles on the seam and caps.
    const key = index => Array.from(positions.subarray(index * 3, index * 3 + 3)).join(',');
    const edges = new Map();
    for (let i = 0; i < indices.length; i += 3) {
      const corners = [key(indices[i]), key(indices[i + 1]), key(indices[i + 2])];
      assert.equal(new Set(corners).size, 3, 'triangle must have three distinct positions');
      for (let c = 0; c < 3; c++) {
        const edge = [corners[c], corners[(c + 1) % 3]].sort().join('|');
        edges.set(edge, (edges.get(edge) || 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(count => count === 2), 'every cone edge must have two incident triangles');
    const box = bounds([positions]);
    assert.ok(box.max.every((value, axis) => value > box.min[axis]));
    t.diagnostic(`${indices.length / 3} triangles, bounds ${JSON.stringify(box)}`);
  });

  for (const split of [false, true]) {
    test(`compound of loose faces imports with split=${split}`, () => {
      const solids = mesh(fixture('surface_model_geometric_set.step'), split);
      assert.equal(solids.length, 1);
      assert.deepEqual(bounds(solids.map(solid => solid.positions)), { min: [0, 0, 0], max: [10, 10, 10] });
      assert.equal(solids[0].indices.length / 3, 4);
    });

    test(`shell without a solid imports with split=${split}`, () => {
      const bytes = fixture('security_classification.step').toString('utf8')
        .replace("FACETED_BREP_SHAPE_REPRESENTATION('',(#21,#22),#17)", "MANIFOLD_SURFACE_SHAPE_REPRESENTATION('',(#21,#22),#17)")
        .replace("FACETED_BREP('',#23)", "SHELL_BASED_SURFACE_MODEL('',(#23))");
      assert.match(bytes, /SHELL_BASED_SURFACE_MODEL/);
      const solids = mesh(Buffer.from(bytes), split);
      assert.equal(solids.length, 1);
      assert.equal(solids[0].indices.length / 3, 4);
      assert.deepEqual(bounds(solids.map(solid => solid.positions)), { min: [0, 0, 0], max: [10, 10, 10] });
    });
  }
});

function alignedCopy(buf, offset, length) {
  const copy = new Uint8Array(length);
  copy.set(buf.subarray(offset, offset + length));
  return copy.buffer;
}

// "STM1", u32 count, then per solid: u32 name length + bytes, u32 vertex count,
// u32 triangle count, float32 xyz, u32 indices. See wasm/step/main.cpp.
function parsePackedMesh(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = Buffer.from(buf.subarray(0, 4)).toString('latin1');
  if (magic !== 'STM1') throw new Error(`Bad step module magic: ${JSON.stringify(magic)}`);
  let offset = 4;
  const count = view.getUint32(offset, true);
  offset += 4;
  const solids = [];
  for (let solid = 0; solid < count; solid++) {
    const nameLength = view.getUint32(offset, true);
    offset += 4;
    const name = Buffer.from(buf.subarray(offset, offset + nameLength)).toString('utf8');
    offset += nameLength;
    const vertexCount = view.getUint32(offset, true);
    offset += 4;
    const triangleCount = view.getUint32(offset, true);
    offset += 4;
    const positions = new Float32Array(alignedCopy(buf, offset, vertexCount * 3 * 4));
    offset += vertexCount * 3 * 4;
    const indices = new Uint32Array(alignedCopy(buf, offset, triangleCount * 3 * 4));
    offset += triangleCount * 3 * 4;
    solids.push({ name, positions, indices });
  }
  assert.equal(offset, buf.length, 'packed STEP mesh must be fully consumed');
  return solids;
}

// Engine getMesh binary: "MESH", u32 vertex count, u32 triangle or index count,
// u32 zero, float32 vertices, u32 indices. Accept either count convention so
// the test also works against a freshly rebuilt engine.
function parseEngineMesh(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const vertexCount = view.getUint32(4, true);
  const second = view.getUint32(8, true);
  const vertexOffset = 16;
  const indexOffset = vertexOffset + vertexCount * 3 * 4;
  const remaining = buf.length - indexOffset;
  let triangleCount;
  if (remaining === second * 3 * 4) triangleCount = second;
  else if (remaining === second * 4) triangleCount = second / 3;
  else throw new Error(`Unexpected engine mesh size ${buf.length} (vertexCount=${vertexCount}, second=${second})`);
  return {
    vertexCount,
    triangleCount,
    vertices: new Float32Array(alignedCopy(buf, vertexOffset, vertexCount * 3 * 4)),
    indices: new Uint32Array(alignedCopy(buf, indexOffset, remaining))
  };
}

function bounds(vertexArrays) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const vertices of vertexArrays) {
    for (let i = 0; i < vertices.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        if (vertices[i + c] < min[c]) min[c] = vertices[i + c];
        if (vertices[i + c] > max[c]) max[c] = vertices[i + c];
      }
    }
  }
  return { min, max };
}

function compareMeshes(t, fixtureName, moduleSolids, engineNames, engineMesh, engineVolumes) {
  assert.deepEqual(moduleSolids.map(s => s.name), engineNames, `${fixtureName}: solid names and order must match`);

  const facetTotal = engineVolumes.reduce((sum, volume) => sum + volume.facetCount, 0);
  const facetScale = facetTotal === engineMesh.triangleCount ? 1
    : facetTotal === engineMesh.triangleCount * 3 ? 3
    : null;
  assert.ok(facetScale, `${fixtureName}: engine volume facet ranges do not cover the mesh`);
  assert.equal(moduleSolids.length, engineVolumes.length, `${fixtureName}: solid count must match engine volume count`);

  for (let s = 0; s < moduleSolids.length; s++) {
    const solid = moduleSolids[s];
    const volume = engineVolumes[s];
    const moduleTriangles = solid.indices.length / 3;
    const engineTriangles = volume.facetCount / facetScale;
    const engineFirst = volume.firstFacet / facetScale;
    assert.equal(moduleTriangles, engineTriangles, `${fixtureName}: triangle count of solid ${s} (${solid.name})`);

    for (let triangle = 0; triangle < moduleTriangles; triangle++) {
      for (let corner = 0; corner < 3; corner++) {
        const moduleVertex = solid.indices[triangle * 3 + corner];
        const engineVertex = engineMesh.indices[(engineFirst + triangle) * 3 + corner];
        for (let axis = 0; axis < 3; axis++) {
          const moduleValue = solid.positions[moduleVertex * 3 + axis];
          const engineValue = engineMesh.vertices[engineVertex * 3 + axis];
          // Object.is also rejects -0 vs 0, i.e. it demands bit-identical components.
          if (!Object.is(moduleValue, engineValue)) {
            assert.fail(
              `${fixtureName}: vertex mismatch in solid ${s} (${solid.name}) triangle ${triangle} `
              + `corner ${corner} axis ${axis}: module ${moduleValue} engine ${engineValue}`
            );
          }
        }
      }
    }
  }

  const moduleBounds = bounds(moduleSolids.map(s => s.positions));
  const engineBounds = bounds([engineMesh.vertices]);
  assert.deepEqual(moduleBounds, engineBounds, `${fixtureName}: mesh bounds must match`);

  t.diagnostic(
    `${fixtureName}: ${moduleSolids.length} solids, ${moduleSolids.reduce((n, s) => n + s.indices.length / 3, 0)} triangles, `
    + `engine ${engineMesh.vertexCount} shared vertices, bounds [${moduleBounds.min}] .. [${moduleBounds.max}]`
  );
}

describe('Orca STANDALONE STEP Tessellation Module', () => {
  let core;          // OCCT-free engine under test
  let referenceCore; // OCCT engine, the former import path
  let stepModule;

  async function createCore(modulePath) {
    const resJsonPath = path.join(bundleDir, 'resources.json');
    const voronJsonPath = path.join(bundleDir, 'profiles', 'Voron.json');
    const orcaFilJsonPath = path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json');
    const engineModule = await import(modulePath);
    const created = await createEngineCore({ moduleFactory: engineModule.createOrcaEngine || engineModule.default, threads: 4 });
    await created.addVendorBundle(JSON.parse(fs.readFileSync(resJsonPath, 'utf8')));
    await created.addVendorBundle(JSON.parse(fs.readFileSync(orcaFilJsonPath, 'utf8')));
    await created.addVendorBundle(JSON.parse(fs.readFileSync(voronJsonPath, 'utf8')));
    await created.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    await created.call('loadVendors', {});
    return created;
  }

  before(async () => {
    fs.mkdirSync(bundleDir, { recursive: true });
    const resJsonPath = path.join(bundleDir, 'resources.json');
    const voronJsonPath = path.join(bundleDir, 'profiles', 'Voron.json');
    const orcaFilJsonPath = path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json');
    if (!fs.existsSync(resJsonPath) || !fs.existsSync(voronJsonPath) || !fs.existsSync(orcaFilJsonPath)) {
      const packScript = path.join(repoRoot, 'wasm', 'web', 'tools', 'pack_profiles.mjs');
      execFileSync(process.execPath, [packScript, repoRoot, bundleDir, 'Voron', 'OrcaFilamentLibrary'], { stdio: 'inherit' });
    }
    for (const modulePath of [referenceEngineModulePath, engineModulePath, stepModulePath]) {
      if (!fs.existsSync(modulePath)) throw new Error(`Required module does not exist: ${modulePath}`);
    }

    referenceCore = await createCore(referenceEngineModulePath);
    core = await createCore(engineModulePath);

    const stepModuleFactory = (await import(stepModulePath)).default;
    stepModule = await stepModuleFactory();
  });

  after(() => {
    if (referenceCore) referenceCore.dispose();
    if (core) core.dispose();
  });

  async function tessellateFixture(t, fixtureName) {
    const fixturePath = path.join(repoRoot, 'tests', 'data', fixtureName);
    assert.ok(fs.existsSync(fixturePath), `Fixture must exist: ${fixturePath}`);
    const fixtureBytes = fs.readFileSync(fixturePath);

    stepModule.FS.writeFile('/in.step', new Uint8Array(fixtureBytes));
    let started = performance.now();
    const error = stepModule.step_tessellate_to_file('/in.step', LINEAR_DEFLECTION, ANGLE_DEFLECTION, false, '/out.bin');
    const moduleMs = performance.now() - started;
    assert.equal(error, '', `${fixtureName}: step module must succeed`);
    const packed = stepModule.FS.readFile('/out.bin');
    const moduleSolids = parsePackedMesh(packed);
    assert.ok(moduleSolids.length > 0, `${fixtureName}: module must emit at least one solid`);

    started = performance.now();
    await referenceCore.loadModel(fixtureName, fixtureBytes);
    const engineMs = performance.now() - started;

    const tree = await referenceCore.call('getObjectTree', {});
    assert.equal(tree.objects.length, 1, `${fixtureName}: loadModel replaces the project with the loaded object`);
    const engineObject = tree.objects[0];
    const engineNames = engineObject.volumes.map(volume => volume.name);

    const objects = await referenceCore.call('listObjects', {});
    assert.equal(objects.length, 1, `${fixtureName}: one loaded object`);
    const objectId = objects[0].id;
    const meshResult = await referenceCore.call('getMesh', { objectId });
    const referenceMeshBytes = Buffer.from(referenceCore.readFile(meshResult.path));
    const engineMesh = parseEngineMesh(referenceMeshBytes);

    compareMeshes(t, fixtureName, moduleSolids, engineNames, engineMesh, meshResult.volumes);

    // OCCT-free engine: loadStepMesh must rebuild exactly the model the OCCT engine built.
    started = performance.now();
    const loaded = await core.loadStepMesh(fixtureName, packed, { replace: true });
    const loadStepMeshMs = performance.now() - started;
    assert.equal(loaded.objects.length, 1, `${fixtureName}: loadStepMesh yields one object`);
    assert.equal(loaded.objects[0].name, engineObject.name, `${fixtureName}: object name`);
    assert.deepEqual(loaded.objects[0].size, objects[0].size, `${fixtureName}: object size`);
    const loadedTree = await core.call('getObjectTree', {});
    assert.deepEqual(loadedTree.objects[0].volumes.map(volume => volume.name), engineNames, `${fixtureName}: volume names`);
    const loadedObjects = await core.call('listObjects', {});
    const loadedMeshResult = await core.call('getMesh', { objectId: loadedObjects[0].id });
    // volumeId comes from a per-engine id counter, so only the facet ranges are comparable.
    const facetRanges = (volumes) => volumes.map(({ firstFacet, facetCount }) => ({ firstFacet, facetCount }));
    assert.deepEqual(facetRanges(loadedMeshResult.volumes), facetRanges(meshResult.volumes), `${fixtureName}: volume facet ranges`);
    const loadedMeshBytes = Buffer.from(core.readFile(loadedMeshResult.path));
    assert.ok(loadedMeshBytes.equals(referenceMeshBytes), `${fixtureName}: getMesh bytes must be identical to the OCCT engine's`);

    t.diagnostic(
      `${fixtureName}: wall time step module ${moduleMs.toFixed(1)} ms, OCCT engine loadModel ${engineMs.toFixed(1)} ms, `
      + `loadStepMesh ${loadStepMeshMs.toFixed(1)} ms, getMesh ${loadedMeshBytes.length} bytes identical`
    );
  }

  test('module tessellation matches the OCCT engine exactly on utf8_part_names.step', async (t) => {
    await tessellateFixture(t, 'utf8_part_names.step');
  });

  test('module tessellation matches the OCCT engine exactly on security_classification.step', async (t) => {
    await tessellateFixture(t, 'security_classification.step');
  });
});
