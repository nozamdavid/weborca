# Planar Cutting API (`cutObject`)

This document describes the planar cutting engine operations in OrcaSlicer WebAssembly (`orca_engine`), their JavaScript/TypeScript bindings, coordinate system contracts, and the architectural path for future connector integration.

---

## 1. Overview

OrcaSlicer WASM planar cutting uses upstream `libslic3r::Cut` (`src/libslic3r/CutUtils.hpp`, `src/libslic3r/CutUtils.cpp`) and `cut_mesh()` (`src/libslic3r/TriangleMeshSlicer.hpp`, `src/libslic3r/TriangleMeshSlicer.cpp`).

Key architectural guarantees:
- **Watertight Capped Halves**: `cut_mesh()` triangulates the planar caps at the cut boundary by default (`triangulate_caps = true`), yielding closed manifold meshes (`openEdges == 0`) with positive volume.
- **Config & Material Preservation**: When cutting into separate objects or parts, volume settings (region configs, materials, extruders) and object settings are cloned and assigned to the resulting halves.
- **Plate Membership Continuity**: Instances of cut objects retain their spatial world offsets and are automatically assigned to the proper plate via `OrcaEngine::assignInstancesToPlates`.
- **Integrity Guarantee on Failure**: If a plane does not intersect the object or an error occurs during cutting, the original object is preserved completely unmodified.

---

## 2. API Contract

### Engine Operation: `cutObject`

Dispatched via `Engine.cpp` -> `OrcaWasm::cutObject(...)`.

#### Parameters (`CutObjectParams`)

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `objectId` | `number` | **Required** | The ID of the target `ModelObject`. |
| `instanceIndex` | `number` | `0` | The index of the instance being cut. |
| `instanceId` | `number` | Optional | Alternative to `instanceIndex`: matches specific instance ID. |
| `z` | `number` | Optional | Height for a horizontal cut plane. |
| `plane` | `{ point: [x,y,z], normal: [nx,ny,nz] }` | Optional | Explicit 3D plane definition. |
| `coordinateSystem` | `'world' \| 'object'` | `'world'` | Coordinate system for `z` or `plane`. |
| `keepUpper` | `boolean` | `true` | Whether to retain the upper half ($Z > 0$ relative to cut plane). |
| `keepLower` | `boolean` | `true` | Whether to retain the lower half ($Z < 0$ relative to cut plane). |
| `keepMode` | `'both' \| 'upper' \| 'lower'` | `'both'` | High-level convenience to select which halves to keep. |
| `keepAsParts` | `boolean` | `false` | If `true`, keeps both halves as multiple volumes in a single object. If `false`, creates separate objects. |
| `placeOnCutUpper` | `boolean` | `false` | Place the cut face of the upper half onto the print bed. |
| `placeOnCutLower` | `boolean` | `false` | Place the cut face of the lower half onto the print bed. |
| `flipUpper` | `boolean` | `false` | Flip upper half by 180 degrees. |
| `flipLower` | `boolean` | `false` | Flip lower half by 180 degrees. |
| `keepPaint` | `boolean` | `true` | Preserve facet paint annotations across the cut. |

Either `z` or `plane` must be provided.

---

### Coordinate System Contracts

1. **`coordinateSystem: 'world'` (Default)**:
   - For horizontal cutting with `z`: `z` specifies the absolute height above the print bed in millimeters. The plane center is `(center_x, center_y, z)` in world space, and the normal is `(0, 0, 1)`.
   - The instance's world offset `instance_offset` is subtracted to compute the local cut matrix: `cut_center_offset = plane_point - instance_offset`.
   - This directly aligns with the 3D plater and UI slice planes.

2. **`coordinateSystem: 'object'`**:
   - `z` or `plane.point` is specified in object-local coordinates (prior to instance scaling, rotation, and translation).
   - The engine transforms the local point and normal into world coordinates using the instance transformation matrix $M_{\text{inst}}$:
     $$P_{\text{world}} = M_{\text{inst}} \cdot P_{\text{obj}}$$
     $$N_{\text{world}} = (M_{\text{inst}}^{\text{linear}})^{-T} \cdot N_{\text{obj}}$$
   - This mode is useful for model-centric operations regardless of where the instance is placed on the bed.

3. **Arbitrary Plane Support**:
   - `plane: { point: [px, py, pz], normal: [nx, ny, nz] }`
   - Normal is normalized $\vec{n} = \frac{\vec{N}}{\|\vec{N}\|}$.
   - A rotation matrix $R$ is derived mapping $\hat{z} = (0, 0, 1)$ to $\vec{n}$ using `Eigen::Quaterniond::FromTwoVectors`.
   - The cut matrix is $T(P - O_{\text{inst}}) \cdot R$. In cut space, the plane is always $Z = 0$ with normal $(0, 0, 1)$.

---

### Return Value (`CutObjectResult`)

```json
{
  "success": true,
  "objectId": 1,
  "createdObjects": [
    {
      "id": 2,
      "name": "Cube - Upper",
      "part": "upper",
      "volume": 4000.0,
      "openEdges": 0,
      "boundingBox": {
        "min": [0.0, 0.0, 10.0],
        "max": [20.0, 20.0, 20.0]
      },
      "volumes": [
        {
          "id": 3,
          "name": "Cube_Part",
          "volume": 4000.0,
          "openEdges": 0
        }
      ]
    },
    {
      "id": 4,
      "name": "Cube - Lower",
      "part": "lower",
      "volume": 4000.0,
      "openEdges": 0,
      "boundingBox": {
        "min": [0.0, 0.0, 0.0],
        "max": [20.0, 20.0, 10.0]
      },
      "volumes": [
        {
          "id": 5,
          "name": "Cube_Part",
          "volume": 4000.0,
          "openEdges": 0
        }
      ]
    }
  ]
}
```

On invalid plane or failure:
```json
{
  "success": false,
  "error": "Cut plane does not intersect object",
  "objectId": 1
}
```

---

## 3. Preservation on Invalid Cuts

Before performing any destructive operation on the model:
1. The engine computes the bounding box of the instance in cut space.
2. If `bb.min.z >= 0` or `bb.max.z <= 0`, the plane does not cross the interior of the object.
3. The method returns `success: false` without modifying `model.objects`.
4. Any exception during mesh slicing is caught, ensuring the original object remains intact.

---

## 4. Upstream Connector Facilities & Follow-Up Reuse

Desktop OrcaSlicer implements dowels, plugs, and snap connectors for planar cuts.

### Existing Upstream Structures
- **`CutConnector`** (`src/libslic3r/Model.hpp:320`):
  Stores `pos` (plane coordinate), `rotation_m` (plane rotation), `radius`, `height`, `radius_tolerance`, `height_tolerance`, `z_angle`, and `attribs`.
- **`CutConnectorAttributes`** (`src/libslic3r/Model.hpp:290`):
  - `type`: `Plug` (hole in upper, positive peg in lower), `Dowel` (holes in both + optional separate dowel object), `Snap` (snap-fit joint).
  - `style`: `Prism`, `Frustum`.
  - `shape`: `Triangle`, `Square`, `Hexagon`, `Circle`.
- **`GLGizmoCut3D::apply_cut_connectors`** (`src/slic3r/GUI/Gizmos/GLGizmoCut.cpp:4096`):
  Converts connectors to temporary `NEGATIVE_VOLUME` volumes on the `ModelObject` with `cut_info = { type, radius_tolerance, height_tolerance }`.
- **`process_connector_cut`** (`src/libslic3r/CutUtils.cpp:106`):
  Inspects `volume->cut_info.is_connector`. Automatically generates tolerance-expanded negative holes in the upper half and corresponding plug geometry in the lower half. When `CreateDowels` is enabled, clones a dowel `ModelObject` into the result list.

### Connector Follow-Up Roadmap
For a future agent adding interactive or programmatic connectors:
1. Define API `addCutConnector(objectId, connectorParams)` or allow a `connectors: CutConnectorDef[]` array in `CutObjectParams`.
2. Generate connector meshes using `its_make_cylinder`, `its_make_frustum`, or `get_connector_mesh(attribs)`.
3. Add the connector as a volume on the object with `cut_info.is_connector = true` and `cut_info.connector_type = type`.
4. Pass `ModelObjectCutAttribute::CreateDowels` when `type == Dowel`.
5. Call `cut.perform_with_plane()` — `process_connector_cut` will handle the geometry boolean subtractions and dowel generation automatically without requiring new upstream C++ code.
