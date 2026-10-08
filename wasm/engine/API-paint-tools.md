# Orca WASM Engine API - Painting tools (brushes, fills, color and fuzzy skin)

Brush and fill painting with triangle splitting, matching the desktop painter gizmos
(src/slic3r/GUI/Gizmos/GLGizmoPainterBase.cpp, GLGizmoFdmSupports, GLGizmoSeam,
GLGizmoMmuSegmentation, GLGizmoFuzzySkin). All painting goes through
`Slic3r::TriangleSelector` (src/libslic3r/TriangleSelector.hpp), the same code the desktop
uses, so painted data is identical and round-trips through 3MF.

The facet-level ops in API-paint.md (getSupportPainting, setSeamPainting, ...) keep working.

## Layers

| `layer` | ModelVolume annotation | States |
| :--- | :--- | :--- |
| `support` | `supported_facets` | `none`, `enforcer`, `blocker` |
| `seam` | `seam_facets` | `none`, `enforcer`, `blocker` |
| `color` | `mmu_segmentation_facets` | `none` or filament number `1`..`ExtruderMax` |
| `fuzzy` | `fuzzy_skin_facets` | `none`, `fuzzy` |

## Coordinates

Points and camera positions are in world (bed) coordinates, the space the 3D plate renders in.
The engine converts them to the volume's mesh coordinates with the instance and volume
transforms, as the desktop does. `facet` is the volume-local triangle index of the hit
(see "Local Facet Mapping" in API-paint.md).

## Ops

### `paintStroke`

```json
{
  "objectId": 1, "instanceId": 2, "volumeId": 3,
  "layer": "support",
  "tool": "circle",
  "state": "enforcer",
  "radius": 2.0,
  "cameraPos": [150, 80, 200],
  "points": [ { "hit": [150, 150, 10], "facet": 7 }, { "hit": [152, 150, 10], "facet": 7 } ],
  "triangleSplitting": true,
  "overhangAngleDeg": 0,
  "smartFillAngleDeg": 30,
  "bucketPropagate": true,
  "clippingPlane": null
}
```

- `tool`: `circle` | `sphere` (brush; consecutive points are joined with the desktop's
  DoublePointCursor so a stroke has no gaps), `smart_fill` (seed fill limited by
  `smartFillAngleDeg`), `bucket` (bucket fill, `bucketPropagate` as the desktop),
  `triangle` (whole original triangle, no splitting), `height_range` (color layer only if
  the desktop offers it there).
- `state`: as in the Layers table; `none` erases.
- `overhangAngleDeg` > 0 limits painting to overhangs steeper than that angle
  (highlight_by_angle_deg), support layer only, as in the desktop.
- `clippingPlane`: optional `{ "normal": [x,y,z], "offset": d }`.
- Result: `{ "changed": true, "stats": { "<state>": facetCount, ... } }`.

### `getPaintOverlay`

`{ objectId, volumeId, layer }` -> writes `/out/paint_<objectId>_<volumeId>_<layer>.bin` with,
for each painted state, the split triangles from `TriangleSelector::get_facets(state)` in
volume mesh coordinates. Result:
`{ "path", "states": [ { "state": "enforcer", "firstTriangle": 0, "triangleCount": 120 }, ... ] }`.
Binary layout: header "PNT1", uint32 vertexCount, uint32 triangleCount, then Float32 xyz
positions and Uint32 triangle indices, triangles grouped by state in the order of `states`.

### `getPaintData` / `setPaintData`

`{ objectId, volumeId, layer }` -> `{ "data": "<base64 of the serialized TriangleSplittingData>" }`;
`setPaintData` takes the same plus `data` and restores it exactly. Used for undo/redo snapshots
of a stroke.

### `clearPaint`

`{ objectId, volumeId, layer, state? }` clears the layer, or only one state.

## Slicing effect

- `support`, `seam`: as in API-paint.md.
- `color`: painted regions print with that filament (multi-material segmentation).
- `fuzzy`: painted regions get fuzzy skin walls.
