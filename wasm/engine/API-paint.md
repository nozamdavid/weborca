# Orca WASM Engine API - Support Painting

Extensions to the Orca WASM engine for facet-level support painting annotations (support enforcers, support blockers, and clearing annotations) on model volume meshes.

All operations execute synchronously on the dedicated engine pthread and return standard `{"ok": true, "result": ...}` or `{"ok": false, "error": "..."}` JSON payloads.

---

## Concepts & Data Representation

### Triangle Index Mapping & getMesh Volume Partitioning
Support painting operates directly on original mesh triangle IDs of a model volume.
- Index mapping is **0-indexed** and corresponds 1:1 with `volume->mesh().its.indices` in `libslic3r`.
- Valid triangle indices are in the range `0 <= facetId < triangleCount`, where `triangleCount` equals `volume->mesh().its.indices.size()`.
- The triangle order and IDs are preserved across mesh serialization and deserialization, matching standard 3MF `custom_supports` triangle attribute ordering.
- Untouched split/subdivided facet annotations from brush painting in imported 3MF projects are preserved when modifying sibling facets.

#### Relationship with `getMesh` Merged Geometries
When an object consists of multiple model-part volumes, `getMesh` merges all transformed volumes into a single binary mesh buffer and returns metadata partitioning the merged triangles across volumes:
```json
{
  "path": "/out/mesh_1.bin",
  "vertexCount": 16,
  "triangleCount": 24,
  "volumes": [
    { "volumeId": 1, "firstFacet": 0, "facetCount": 12 },
    { "volumeId": 2, "firstFacet": 12, "facetCount": 12 }
  ]
}
```
- Each entry in `volumes` identifies the `volumeId`, the index of the volume's first triangle in the merged output (`firstFacet`), and the number of triangles belonging to that volume (`facetCount`).
- The merged triangles for a volume reside in the continuous half-open interval `[firstFacet, firstFacet + facetCount)`.
- **Transform & Winding Invariance**: Volume transforms (including translation, rotation, scaling, and left-handed reflection) do not alter the order or count of triangles in `its.indices`.
- **Local Facet Mapping**: When hit-testing or picking a merged triangle index $F_{merged}$, UI consumers identify the volume where `v.firstFacet <= F_merged < v.firstFacet + v.facetCount`. The volume-local facet ID is:
  `facetId = F_merged - firstFacet`
- All support painting operations (`getSupportPainting`, `setSupportPainting`, `clearSupportPainting`) consume this local `facetId` with the corresponding `volumeId`.
### State Values
Each facet can be in one of three support annotation states, corresponding to `libslic3r::EnforcerBlockerType`:\n
| State Name | Numeric Type | Accepted Input Strings | Description |
|:---|:---:|:---|:---|
| `NONE` | `0` | `"none"`, `"clear"`, `"neutral"`, `"reset"`, `"0"` | Unannotated facet (default mesh state) |
| `ENFORCER` | `1` | `"enforcer"`, `"support_enforcer"`, `"1"` | Custom support enforcer |
| `BLOCKER` | `2` | `"blocker"`, `"support_blocker"`, `"2"` | Custom support blocker |

Numeric values `0`, `1`, `2` or string names may be supplied interchangeably. Any other state value is rejected as invalid.

### Reset & Clearing Behavior
- **Individual facet clearing**: Setting a facet's state to `NONE` (or `"clear"`) clears the annotation on that facet.
- **Volume clearing**: `clearSupportPainting` resets the volume's `supported_facets` annotation completely via `vol->supported_facets.reset()`.
- **Reset flag**: Passing `"reset": true` to `setSupportPainting` clears all existing annotations on the volume before applying any newly specified facet updates.

### Validation & Atomic Mutation Semantics
Input validation is strictly atomic:
1. `objectId` must exist in the model and be a valid integer ID.
2. The target volume must exist on the object and must be a model part (`vol->is_model_part()`).
3. All facet IDs in the request (`facets`, `enforcers`, `blockers`, `clear`, `facetIds`) must be strict non-negative integers within bounds `[0, triangleCount - 1]`. Fractional or negative IDs are rejected.
4. All state values must be valid support states.
5. If **any** facet ID, state, or structure is invalid, the request throws an error and **no partial updates** are applied to the volume.

### Project Persistence (3MF Save / Open)
- Custom support annotations are stored on the volume's `supported_facets` (`FacetsAnnotation`).
- Upon saving via `saveProject` (`store_bbs_3mf`), annotations are serialized into the 3MF archive's triangle metadata (`custom_supports` attribute).
- Upon loading via `openProject` (`Model::read_from_archive`), annotations are deserialized into `supported_facets` with identical object and volume assignment.

---

## Operations

### `getSupportPainting`
Retrieves support painting annotations, statistics, and optionally queries specific triangle states for an object volume.

- **Arguments**:
  ```json
  {
    "objectId": 1,
    "volumeId": 1,
    "facetIds": [0, 5, 12]
  }
  ```
  - `objectId`: Target `ModelObject` ID (required, integer).
  - `volumeId`: Target `ModelVolume` ID (optional if object has only one model part, integer).
  - `volumeIndex`: Zero-based volume index on object (optional fallback, integer).
  - `facetIds`: Optional array of specific facet IDs to query state for (strictly validated).
- **Result**:
  ```json
  {
    "objectId": 1,
    "volumeId": 1,
    "triangleCount": 120,
    "hasCustomSupports": true,
    "enforcers": [0, 1, 2],
    "blockers": [10, 11],
    "facets": [
      { "facetId": 0, "state": "enforcer", "type": 1 },
      { "facetId": 1, "state": "enforcer", "type": 1 },
      { "facetId": 2, "state": "enforcer", "type": 1 },
      { "facetId": 10, "state": "blocker", "type": 2 },
      { "facetId": 11, "state": "blocker", "type": 2 }
    ],
    "statistics": {
      "enforcersCount": 3,
      "blockersCount": 2,
      "totalPainted": 5
    },
    "queriedFacets": [
      { "facetId": 0, "state": "enforcer", "type": 1 },
      { "facetId": 5, "state": "none", "type": 0 },
      { "facetId": 12, "state": "none", "type": 0 }
    ]
  }
  ```

---

### `setSupportPainting`
Updates or resets support painting annotations on an object volume.

- **Arguments (Facet List Format)**:
  ```json
  {
    "objectId": 1,
    "volumeId": 1,
    "facets": [
      { "facetId": 0, "state": "enforcer" },
      { "facetId": 1, "state": "blocker" },
      { "facetId": 2, "state": "clear" }
    ]
  }
  ```
- **Arguments (Category Arrays Format)**:
  ```json
  {
    "objectId": 1,
    "volumeId": 1,
    "enforcers": [0, 1, 2],
    "blockers": [3, 4],
    "clear": [5, 6]
  }
  ```
- **Arguments (Reset and Replace)**:
  ```json
  {
    "objectId": 1,
    "volumeId": 1,
    "reset": true,
    "enforcers": [10, 11]
  }
  ```
- **Result**:
  ```json
  {
    "updated": true,
    "objectId": 1,
    "volumeId": 1,
    "triangleCount": 120,
    "enforcersCount": 2,
    "blockersCount": 0,
    "modifiedCount": 2
  }
  ```

---

### `clearSupportPainting`
Clears all support annotations from an object volume.

- **Arguments**:
  ```json
  {
    "objectId": 1,
    "volumeId": 1
  }
  ```
- **Result**:
  ```json
  {
    "cleared": true,
    "objectId": 1,
    "volumeId": 1
  }
  ```

---

## JavaScript / Web API

The `OrcaEngine` class in `web/orca-engine.js` provides first-class async wrappers:

```javascript
// Readback
const paint = await engine.getSupportPainting(objectId, volumeId);

// Update support painting
await engine.setSupportPainting({
  objectId,
  volumeId,
  enforcers: [0, 1],
  blockers: [2]
});

// Clear all support painting
await engine.clearSupportPainting(objectId, volumeId);
```
