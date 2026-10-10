# Orca WASM Engine API - Plate Operations

Extensions to the Orca WASM engine for 3D plate manipulation, object management, transforms, mesh export, and multiple plates.
All operations run on the engine pthread and return standard `{"ok": true, "result": ...}` or `{"ok": false, "error": "..."}` JSON payloads.

---

## Operations

### `addModel`
Appends objects from the specified model file to the currently active model (unlike `loadModel`, which replaces the active model).

- **Arguments**:
  ```json
  {
    "path": "/models/cube.stl"
  }
  ```
- **Result**:
  ```json
  {
    "objects": [
      {
        "id": 1,
        "name": "cube.stl",
        "instances": 1,
        "volumes": 1,
        "size": [20.0, 20.0, 20.0]
      }
    ]
  }
  ```
  Returns the array of newly added objects. Stable IDs correspond to `ModelObject::id().id`.

---

### `listObjects`
Returns all objects currently in the model with their stable IDs, volume counts, dimensions, and per-instance transformations.

- **Arguments**:
  ```json
  {}
  ```
- **Result**:
  ```json
  [
    {
      "id": 1,
      "name": "cube.stl",
      "volumes": 1,
      "instances": [
        {
          "id": 2,
          "offset": [150.0, 150.0, 10.0],
          "rotation": [0.0, 0.0, 0.0],
          "scale": [1.0, 1.0, 1.0]
        }
      ],
      "size": [20.0, 20.0, 20.0]
    }
  ]
  ```
  - `id`: Stable ID (`ModelObject::id().id`).
  - `instances[].id`: Stable ID (`ModelInstance::id().id`).
  - `offset`: `[x, y, z]` coordinates in world / bed space (mm).
  - `rotation`: `[rx, ry, rz]` Euler angles in radians.
  - `scale`: `[sx, sy, sz]` scale factors along each axis.
  - `size`: `[width_x, depth_y, height_z]` exact bounding box dimensions (mm).

---

### `getMesh`
Combines all printable model volumes with their respective volume transforms into object coordinates, then writes the resulting vertex positions and triangle index list to a binary file in MEMFS at `/out/mesh_<id>.bin`.

- **Arguments**:
  ```json
  {
    "objectId": 1
  }
  ```
- **Result**:
  ```json
  {
    "path": "/out/mesh_1.bin",
    "vertexCount": 8,
    "triangleCount": 12,
    "volumes": [
      {
        "volumeId": 1,
        "firstFacet": 0,
        "facetCount": 12
      }
    ]
  }
  ```

#### Binary Mesh File Format (`/out/mesh_<id>.bin`)
The binary file consists of a 16-byte header followed by raw vertex coordinates and triangle vertex indices in little-endian format:

| Offset | Type | Description |
| :--- | :--- | :--- |
| `0` | `uint32` | Magic number `0x4D455348` (ASCII `"MESH"`) |
| `4` | `uint32` | Vertex count `V` |
| `8` | `uint32` | Triangle count `F` |
| `12` | `uint32` | Reserved (0) |
| `16` | `float32[V * 3]` | Contiguous XYZ coordinates: `x0, y0, z0, x1, y1, z1, ...` |
| `16 + V*12` | `uint32[F * 3]` | Contiguous triangle vertex indices: `i0, j0, k0, i1, j1, k1, ...` |

---

### `setInstanceTransform`
Updates the transformation of a specific instance on an object, then automatically drops the instance to rest on the print bed (`min_z == 0`), matching desktop OrcaSlicer behavior (`Selection::ensure_on_bed`).

- **Arguments**:
  ```json
  {
    "objectId": 1,
    "instanceId": 2,
    "offset": [180.0, 180.0, 0.0],
    "rotation": [0.0, 0.0, 0.785398],
    "scale": [2.0, 2.0, 2.0]
  }
  ```
  `offset`, `rotation`, and `scale` are optional.
  - `offset`: `[x, y, z]` in mm.
  - `rotation`: `[rx, ry, rz]` in radians.
  - `scale`: `[sx, sy, sz]` or a single float for uniform scaling.
- **Result**:
  ```json
  {}
  ```

---

### `mirrorInstance`
Reflects an instance along one of the object's own axes, then drops it onto the bed. Calling it again with the same axis restores the instance.

- **Arguments**: `{ "objectId": 1, "instanceId": 2, "axis": 0 }` (`axis`: 0 = X, 1 = Y, 2 = Z).
- **Result**: `{}`
- `listObjects` reports `mirror: [mx, my, mz]` (each ±1) per instance next to `rotation` and `scale` (always positive). A mirrored matrix has several equal decompositions, so `mirror` only means something together with the `rotation` reported with it: a viewer applies `rotation * (scale * mirror)`. `setInstanceTransform` keeps the instance's mirror when it changes the scale.

---

### `cloneObject`
Copies an object, with its volumes, settings, painting and instances, as an independent new object at the same position.

- **Arguments**: `{ "objectId": 1 }`
- **Result**: `{ "objectId": 7, "id": 7 }`

---

### `deleteObject`
Removes an object and all of its volumes and instances from the model.

- **Arguments**:
  ```json
  {
    "objectId": 1
  }
  ```
- **Result**:
  ```json
  {}
  ```

---

### `duplicateInstance`
Duplicates an existing instance of an object, generating a new unique stable instance ID.

- **Arguments**:
  ```json
  {
    "objectId": 1,
    "instanceId": 2
  }
  ```
- **Result**:
  ```json
  {
    "instanceId": 3,
    "id": 3
  }
  ```

---

### `arrange`
Arranges objects on the bed.

- **Arguments**:
  ```json
  {}
  ```
  or
  ```json
  {
    "useBed": true
  }
  ```
- **Behavior**:
  - Default (`useBed: false` or omitted): Centers objects around the bed center point and arranges them using an infinite bed, preserving exact slicing parity with baseline `slice_driver`.
  - `useBed: true`: Arranges objects within the actual bed polygon defined by the printer's `printable_area` setting, using desktop OrcaSlicer's arrange spacing (`min_object_distance`).
- **Result**:
  ```json
  {}
  ```

---

## Multiple Plates

Plates in the engine manage multiple print beds tiled in a 2D grid matching desktop OrcaSlicer's `PartPlateList` layout. Instances are assigned to plates according to spatial intersection in world coordinates.

### Grid Layout and Coordinate Space
- **Column Count**: Computed dynamically as `cols = std::max(1, (int)std::round(std::sqrt(count)))` (incremented if `sqrt > round`).
- **Plate Stride**:
  $$\text{stride}_x = \text{bed\_width} \times 1.2$$
  $$\text{stride}_y = \text{bed\_depth} \times 1.2$$
- **Origin for Plate $i$**:
  $$\text{row} = \lfloor i / \text{cols} \rfloor, \quad \text{col} = i \pmod{\text{cols}}$$
  $$\text{origin}(i) = (\text{col} \times \text{stride}_x, \, -\text{row} \times \text{stride}_y, \, 0)$$

---

### `listPlates`
Returns all current plates with their index, display name, lock state, world origin, dimensions, instance assignments, per-plate configuration overrides, and filament maps.

- **Arguments**:
  ```json
  {}
  ```
- **Result**:
  ```json
  [
    {
      "index": 0,
      "name": "Plate 1",
      "locked": false,
      "origin": [0.0, 0.0, 0.0],
      "size": [256.0, 256.0, 256.0],
      "instances": [
        { "objectId": 1, "instanceId": 2, "objectIndex": 0, "instanceIndex": 0 }
      ],
      "config": {
        "curr_bed_type": "textured_plate"
      },
      "filamentMaps": [1, 2]
    }
  ]
  ```

---

### `addPlate`
Adds a new plate to the project. If adding the plate changes the grid column count, existing plates and their assigned instances reflow to their updated grid positions. Per-plate wipe towers are positioned automatically.

- **Arguments**:
  ```json
  {
    "name": "Plate 2",
    "config": {
      "curr_bed_type": "textured_plate"
    }
  }
  ```
  `name` and `config` are optional.
- **Result**: Array of all plates (same as `listPlates`).

---

### `deletePlate`
Deletes the specified plate. Cannot delete if only one plate remains. If `deleteObjects` is false (default), objects on the deleted plate move to the adjacent remaining plate. Subsequent plates and their instances shift to updated grid coordinates.

- **Arguments**:
  ```json
  {
    "plateIndex": 1,
    "deleteObjects": false
  }
  ```
  - `plateIndex`: 0-based plate index.
  - `deleteObjects`: `true` to delete objects assigned to the plate; `false` to move them to the adjacent plate.
- **Result**: Array of remaining plates (same as `listPlates`).

---

### `setPlateConfig`
Updates configuration overrides and metadata for a specific plate (e.g. `curr_bed_type`, `print_sequence`, `spiral_mode`).

- **Arguments**:
  ```json
  {
    "plateIndex": 0,
    "name": "Bed A",
    "locked": false,
    "config": {
      "curr_bed_type": "textured_plate",
      "print_sequence": "by_object"
    }
  }
  ```
- **Result**:
  ```json
  {}
  ```

---

### Slicing a Specific Plate (`slice` with `plateIndex`)
When `slice` receives `"plateIndex"`, only instances assigned to that plate are sliced (`printable = true` on that plate, `false` elsewhere). The engine calls `Print::set_plate_origin(plate_origin)` and `Print::set_plate_index(plateIndex)`, which automatically translates all emitted toolpaths and wipe tower coordinates from world coordinates back into bed coordinates `[0, width] x [0, depth]`.

- **Arguments**:
  ```json
  {
    "outPath": "/out/plate_2.gcode",
    "plateIndex": 1,
    "threads": 4
  }
  ```
- **Result**: Standard slice result object containing `layers`, `gcodeBytes`, `printTimeS`, etc.
