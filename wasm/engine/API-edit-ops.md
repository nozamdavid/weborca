# Edit operations

Object editing ops ported from the desktop gizmos and context menu. All of them change the model in place and return `{"success": true, ...}`; a failure that is not an exception returns `{"success": false, "error": "..."}` and leaves the model unchanged.

| op | args | result |
| :--- | :--- | :--- |
| `autoOrient` | `{"objectIds": [id, ...]}` | `{"rotations": [{"objectId", "instanceId", "matrix"}]}`; desktop's auto-orient (`Slic3r::orientation`) picks the orientation with the least support need and applies it to each instance |
| `getPlanarFacets` | `{"objectId", "instanceId"?}` | `{"clusters": [{"normal", "center", "area", "outline"}]}`; the flat regions the "place on face" tool offers, in the order `placeOnFace` indexes them |
| `placeOnFace` | `{"objectId", "instanceId"?, "facetIndex"}` | `{}`; rotates the instance so the chosen cluster lies on the bed |
| `splitObject` | `{"objectId"}` | `{"newObjectIds": [...]}`; one object per disconnected part, replacing the original |
| `splitVolume` | `{"objectId", "volumeId"}` | `{"newVolumeIds": [...]}`; one volume per disconnected part, replacing the original volume |
| `simplifyVolume` | `{"objectId", "volumeId", "targetTriangleCount"` or `"ratio"` or `"maxError", "keepPainting"?}` | `{"triangleCountBefore", "triangleCountAfter", "maxError"}`; quadric edge-collapse simplification |
| `meshBoolean` | `{"mode": "union" \| "difference" \| "intersection", "targetObjectId", "toolObjectIds": [...], "keepTools"?}` | `{"objectId", "volumeId"}`; the tools are combined into the target, placed by their instance transforms, and the target's volumes are replaced by one `Boolean Result` part. Tools are deleted unless `keepTools` is set. An empty result returns `success: false` |
| `addSvg` | `{"svgText", "depth"?, "useSurface"?, "volumeType"?, "objectId"?, "position"?, "name"?}` | `{"objectId", "volumeId"}`; embosses an SVG as a new object, or as a part of `objectId` |
| `updateSvg` | `{"objectId", "volumeId", "svgText"?, "depth"?, "useSurface"?, "name"?}` | `{"objectId", "volumeId"}`; regenerates the shape |
| `getSvg` | `{"objectId", "volumeId"}` | `{"svgText", "depth", "useSurface"}` |
| `setBrimEars` | `{"objectId", "points": [{"position": [x, y, z], "radius"}]}` | `{}`; replaces the object's mouse ears (brim anchor discs) |
| `getBrimEars` | `{"objectId"}` | `{"points": [...]}` |
| `clearBrimEars` | `{"objectId"}` | `{}` |

`instanceId` defaults to the first instance. Ids are the ones `getObjectTree` returns. Source: `EditOps.cpp`, `SvgOps.cpp`, `BrimEarsOps.cpp`; tests: `wasm/tests/node/edit-ops.test.mjs`.
