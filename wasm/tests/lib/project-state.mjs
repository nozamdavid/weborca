/**
 * @file project-state.mjs
 * Builds a project that uses the features a 3MF project stores (parts and modifiers, cloned
 * objects sharing a mesh, per-object and per-volume settings, support, seam and color painting,
 * variable layer heights, plates, layer events, filament colors) and reads that state back in a
 * form that can be compared across a save and open. Engine-assigned ids are left out, because
 * opening a project assigns new ones.
 */

import crypto from 'node:crypto';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const ID_KEYS = new Set(['id', 'objectId', 'volumeId', 'instanceId']);
function withoutIds(value) {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !ID_KEYS.has(k)).map(([k, v]) => [k, withoutIds(v)]));
  }
  return value;
}

/**
 * Builds the project on an engine with the Voron and OrcaFilamentLibrary bundles loaded.
 * @param {any} core engine-core instance
 * @param {Uint8Array} cubeBytes 20 mm cube OBJ
 */
export async function buildFeatureProject(core, cubeBytes) {
  await core.call('selectPresets', {
    printer: 'Voron 2.4 300 0.4 nozzle',
    process: '0.20mm Standard @Voron',
    filaments: ['Generic PLA @System', 'Generic PETG @System']
  });
  await core.call('setOptions', { options: { filament_colour: ['#FF0000', '#00AA00'], sparse_infill_density: '25%' } });

  core.writeFile('/models/cube.obj', cubeBytes);
  await core.call('loadModel', { path: '/models/cube.obj' });
  let tree = await core.call('getObjectTree', {});
  const object = tree.objects[0];
  const volumeId = object.volumes[0].id;
  await core.call('renameObject', { objectId: object.id, name: 'Feature cube' });

  await core.call('addVolume', { objectId: object.id, type: 'modifier', shape: 'cube', size: [8, 8, 8], offset: [0, 0, 5], name: 'Infill modifier' });
  await core.call('addVolume', { objectId: object.id, type: 'negative', shape: 'cylinder', size: [4, 4, 30], offset: [5, 5, 0], name: 'Hole' });
  await core.call('addVolume', { objectId: object.id, type: 'part', shape: 'cube', size: [5, 5, 5], offset: [0, 0, 12.5], name: 'Second part' });
  tree = await core.call('getObjectTree', {});
  const modifier = tree.objects[0].volumes.find((v) => v.type === 'modifier');
  const part = tree.objects[0].volumes.find((v) => v.name === 'Second part');
  await core.call('setObjectConfig', { objectId: object.id, options: { wall_loops: '4' } });
  await core.call('setObjectConfig', { objectId: object.id, volumeId: modifier.id, options: { sparse_infill_density: '80%' } });
  await core.call('setVolumeExtruder', { objectId: object.id, volumeId: part.id, extruder: 2 });

  await core.call('setSupportPainting', { objectId: object.id, volumeId, facets: [{ facetId: 0, state: 'enforcer' }, { facetId: 3, state: 'blocker' }] });
  await core.call('setSeamPainting', { objectId: object.id, volumeId, facets: [{ facetId: 5, state: 'enforcer' }] });
  const [ox, oy, oz] = tree.objects[0].instances[0].offset;
  await core.call('paintStroke', {
    objectId: object.id, instanceId: tree.objects[0].instances[0].id, volumeId,
    layer: 'color', tool: 'circle', state: 2, radius: 4,
    cameraPos: [ox + 10, oy + 10, oz + 120], points: [{ hit: [ox + 10, oy + 10, oz + 20], facet: 2 }],
    triangleSplitting: true
  });

  await core.call('setLayerHeightProfile', { objectId: object.id, profile: [0, 0.2, 5, 0.2, 10, 0.12, 20, 0.28] });
  await core.call('cloneObject', { objectId: object.id });

  await core.call('listPlates', {});
  await core.call('setPlateConfig', { plateIndex: 0, name: 'Bed A', config: { curr_bed_type: 'Textured PEI Plate', print_sequence: 'by object' } });
  await core.call('addPlate', { name: 'Plate B' });
  await core.call('setLayerEvents', { plateIndex: 0, events: [{ printZ: 2.0, type: 'pause', message: 'Insert magnet' }, { printZ: 4.0, type: 'custom', gcode: 'M117 Layer event' }] });
}

/**
 * Reads the project state that a save and open must preserve.
 * @param {any} core engine-core instance
 */
export async function readProjectState(core) {
  const tree = await core.call('getObjectTree', {});
  const objects = [];
  for (const object of tree.objects) {
    const mesh = await core.call('getMesh', { objectId: object.id });
    const volumes = [];
    for (const volume of object.volumes) {
      const paint = {};
      for (const layer of ['support', 'seam', 'color']) {
        paint[layer] = (await core.call('getPaintData', { objectId: object.id, volumeId: volume.id, layer })).data ?? null;
      }
      volumes.push({ name: volume.name, type: volume.type, paint });
    }
    objects.push({
      volumes,
      mesh: sha(core.readFile(mesh.path)),
      layerHeights: await core.call('getLayerHeightProfile', { objectId: object.id })
    });
  }
  const plates = await core.call('listPlates', {});
  const layerEvents = [];
  for (let plateIndex = 0; plateIndex < (plates.plates ?? plates).length; plateIndex++) {
    layerEvents.push(await core.call('getLayerEvents', { plateIndex }));
  }
  // A save lists the overridden options in different_settings_to_system, as the desktop does.
  const { different_settings_to_system: _overrides, ...config } = await core.call('getConfig', {});
  return withoutIds({ tree, objects, plates, layerEvents, config });
}
