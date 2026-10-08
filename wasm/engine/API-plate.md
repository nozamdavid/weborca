# Orca WASM Engine API - Plate Operations

Extensions to the Orca WASM engine for 3D plate manipulation, object management, transforms, and mesh export.
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
    "triangleCount": 12
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
  - `useBed: true`: Arranges objects within the actual bed polygon defined by the printer's `printable_area` setting.
- **Result**:
  ```json
  {}
  ```
