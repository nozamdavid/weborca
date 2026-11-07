# Advanced Measurement Operations

Operations backed by the native `libslic3r/Measure.hpp/.cpp` kernel for geometric feature detection and measurement.

## Functions

### `OrcaWasm::getMeasurementFeature(Model& model, const json& args)`
- **Dispatch name:** `getMeasurementFeature`
- **Arguments:**
  - `objectId` (int, required): ID of the model object.
  - `volumeId` (int, optional): ID of the model volume (defaults to first volume).
  - `instanceId` (int, optional): ID of the model instance (defaults to first instance).
  - `facetIndex` (int, required): Raycasted mesh facet index.
  - `position` (`[x, y, z]` or `{x, y, z}`, required): Picked raycast intersection in world coordinates.
  - `selection` (`"auto" | "plane" | "edge" | "circle" | "point"`, optional, default `"auto"`): Desired feature snapping mode.
- **Transform & Geometry Handling:**
  - Mesh vertices are transformed into world space via the combined instance and volume transform matrix before passing to the native `Measuring` kernel.
  - This allows the native circular border detection and plane extraction to operate on true world geometry, naturally rejecting non-uniformly scaled circles that have deformed into ellipses.
- **Caching:**
  - Bounded LRU cache (up to 4 entries) keyed by object ID, volume ID, instance ID, vertex count, facet count, and world matrix to avoid re-extracting features during rapid hover/pointer moves.
  - Automatically invalidated upon model mutation or transform changes.
- **Returns:**
  - `{"success": true, "feature": <SurfaceFeature>}`
  - On error / invalid input: `{"success": false, "error": "<reason>"}`

### `OrcaWasm::measureFeatures(const json& args)`
- **Dispatch name:** `measureFeatures`
- **Arguments:**
  - `first` or `feature1` (object, required): Serialized `SurfaceFeature`.
  - `second` or `feature2` (object, optional): Second serialized `SurfaceFeature`.
- **Measurement Logic:**
  - Single feature:
    - Circle: returns `diameter`, `radius`, `distance` (= diameter), and `distanceStrict` to circle perimeter.
    - Edge: returns `length`, `distance` (= length), and endpoints.
    - Plane / Point: returns geometric coordinates.
  - Two features:
    - Calls native `Slic3r::Measure::get_measurement(f1, f2)`.
    - Returns `distanceStrict` (`{dist, from, to}`) when a finite/direct distance exists.
    - Returns `distanceInfinite` (`{dist, from, to}`) when perpendicular/infinite plane or line distance exists.
    - Distinguishes strict vs infinite distance types explicitly (`distanceType: "strict" | "infinite"`). Parallel planes return `distanceInfinite` and do not report false finite face clearances.
    - Returns `angle` (`{rad, deg, center, radius, coplanar, unit: "deg"}`) when non-parallel.
    - Returns coordinate deltas `delta` (`[dx, dy, dz]`) and `distanceXyz` whenever coordinate endpoints are available.

## SurfaceFeature Serialization Schema

```json
{
  "type": "point" | "edge" | "circle" | "plane",
  "point": [x, y, z],
  "edge": {
    "start": [x, y, z],
    "end": [x, y, z],
    "length": 10.0
  },
  "circle": {
    "center": [x, y, z],
    "normal": [nx, ny, nz],
    "radius": 5.0,
    "diameter": 10.0
  },
  "plane": {
    "normal": [nx, ny, nz],
    "origin": [x, y, z],
    "planeIndex": 0,
    "features": [ /* boundary edges and circles */ ]
  },
  "extraPoint": [x, y, z],
  "raw": {
    "type": 1 | 2 | 4 | 8,
    "pt1": [x, y, z],
    "pt2": [x, y, z],
    "pt3": [x, y, z] | null,
    "value": 0.0
  }
}
```

## Integration Handoff

- `MeasureOps.hpp` and `MeasureOps.cpp` are located in `wasm/engine/`.
- Add `MeasureOps.cpp` to `ORCA_ENGINE_SOURCES` in `wasm/engine/CMakeLists.txt`.
- Add `#include "MeasureOps.hpp"` to `wasm/engine/Engine.cpp`.
- Wire dispatch:
  - `"getMeasurementFeature"` -> `OrcaWasm::getMeasurementFeature(m_model, args)`
  - `"measureFeatures"` -> `OrcaWasm::measureFeatures(args)`
