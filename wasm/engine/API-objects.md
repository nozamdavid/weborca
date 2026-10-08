# Orca WASM Engine API - Object Hierarchy and Volume Modifiers

Extensions to the Orca WASM engine for managing object hierarchies, volumes (parts, negative volumes, modifiers, support blockers/enforcers), per-object and per-volume configuration overrides, and extruder assignments.

All operations execute synchronously on the dedicated engine pthread and return standard `{"ok": true, "result": ...}` or `{"ok": false, "error": "..."}` JSON payloads.

---

## Operations

### `getObjectTree`
Returns the complete model object hierarchy including objects, instances, volumes, layer height ranges, and configuration overrides.

- **Arguments**:
  ```json
  {}
  ```
- **Result**:
  ```json
  {
    "objects": [
      {
        "id": 1,
        "name": "cube.stl",
        "instances": [
          { "id": 1 }
        ],
        "volumes": [
          {
            "id": 1,
            "name": "cube.stl",
            "type": "part",
            "extruder": 0,
            "config": {
              "wall_loops": "3"
            },
            "overrides": ["wall_loops"]
          }
        ],
        "layerRanges": [
          {
            "minZ": 0.0,
            "maxZ": 5.0,
            "config": {
              "layer_height": "0.12"
            },
            "overrides": ["layer_height"]
          }
        ],
        "config": {
          "wall_loops": "4"
        },
        "overrides": ["wall_loops"]
      }
    ]
  }
  ```
  - `id`: Stable ID (`ModelObject::id().id` or `ModelVolume::id().id`).
  - `type`: Volume type string: `"part"`, `"negative"`, `"modifier"`, `"support_blocker"`, `"support_enforcer"`.
  - `extruder`: Extruder index (1-based, or 0 for default/inherited).
  - `config`: Dictionary of overridden option keys to serialized string values on `ModelConfig`.
  - `overrides`: Array of overridden option key names.

---

### `addVolume`
Generates a procedural primitive mesh using `libslic3r` primitives and attaches it as a volume to the specified object.

- **Arguments**:
  ```json
  {
    "objectId": 1,
    "type": "modifier",
    "shape": "cube",
    "size": [20.0, 20.0, 20.0],
    "offset": [0.0, 0.0, 0.0],
    "name": "Cube Modifier"
  }
  ```
  - `objectId`: Target `ModelObject` ID (required).
  - `type`: One of `"part"`, `"negative"`, `"modifier"`, `"support_blocker"`, `"support_enforcer"` (required).
  - `shape`: One of `"cube"`, `"cylinder"`, `"sphere"`, `"cone"` (required).
  - `size`: Dimension `[x, y, z]` or single float scalar (optional, defaults to `20.0`).
  - `offset`: Translation `[x, y, z]` relative to object center (optional, defaults to `[0, 0, 0]`).
  - `name`: Display name (optional, defaults to shape name).
- **Result**:
  ```json
  {
    "volumeId": 2,
    "id": 2,
    "name": "Cube Modifier"
  }
  ```

---

### `deleteVolume`
Deletes a volume from the specified object.

- **Arguments**:
  ```json
  {
    "objectId": 1,
    "volumeId": 2
  }
  ```
- **Result**:
  ```json
  {}
  ```

---

### `renameObject`
Renames a model object.

- **Arguments**:
  ```json
  {
    "objectId": 1,
    "name": "New Object Name"
  }
  ```
- **Result**:
  ```json
  {}
  ```

---

### `renameVolume`
Renames a volume belonging to an object.

- **Arguments**:
  ```json
  {
    "objectId": 1,
    "volumeId": 2,
    "name": "New Volume Name"
  }
  ```
- **Result**:
  ```json
  {}
  ```

---

### `setObjectConfig`
Sets configuration option overrides on a model object or a specific model volume.

Keys are validated against the allowed scopes defined by desktop OrcaSlicer (`src/slic3r/GUI/GUI_Factories.cpp:194`):
- **Object scope** (`volumeId` omitted): Accepts keys from both `PrintObjectConfig` and `PrintRegionConfig`.
- **Volume/part scope** (`volumeId` specified): Accepts keys strictly from `PrintRegionConfig`.

Invalid keys or invalid values return error descriptions in `errors`.

- **Arguments**:
  ```json
  {
    "objectId": 1,
    "volumeId": 2,
    "options": {
      "sparse_infill_density": "80%"
    }
  }
  ```
- **Result**:
  ```json
  {
    "errors": []
  }
  ```

---

### `resetObjectConfig`
Removes configuration overrides from a model object or volume.

- **Arguments**:
  ```json
  {
    "objectId": 1,
    "volumeId": 2,
    "keys": ["sparse_infill_density"]
  }
  ```
  If `keys` is omitted or empty, all overrides on the target object/volume are reset.
- **Result**:
  ```json
  {}
  ```

---

### `setVolumeExtruder`
Assigns the extruder number for a specific volume.

- **Arguments**:
  ```json
  {
    "objectId": 1,
    "volumeId": 2,
    "extruder": 2
  }
  ```
  Passing `0` or negative values removes the volume's extruder override, inheriting the object or printer default extruder.
- **Result**:
  ```json
  {}
  ```
