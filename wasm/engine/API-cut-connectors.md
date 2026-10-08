# Cut with connectors

`OrcaWasm::cutObjectWithConnectors(model, plates, config, args)` uses the actual
`Cut::perform_with_plane` pipeline. The two-argument overload has no plate
assignment. Inputs use `objectId` (`id` alias), optional `instanceId` or
`instanceIndex`, and `z` or `plane:{point:[x,y,z],normal:[x,y,z]}`.
`coordinateSystem` is `world` (default) or `object`. Object-space positions and
plane normals are transformed through the selected instance; connector
sizes/tolerances are always physical millimeters after that transformation.
Rotation is around the cut normal, following desktop's negative angle convention.

Each `connectors` element requires `pos` (`position` alias). Attributes may be
flat or under `attrs`:

- `type`: `plug` (default), `dowel`, `snap`.
- `style`: `prism` (default), `frustum`.
- `shape`: `circle` (default), `triangle`, `square`, `hexagon`.
- `radius`, or `size`/`diameter` (default diameter 3).
- `depthRatio`/`depth`/`height`: depth in mm (default 4), despite the legacy
  `depthRatio` name. Prism dowels span twice this depth; frustum dowels use the
  upstream generator's centered double-ended geometry.
- `rotationDeg`/`rotation`/`angle`: degrees (default 0).
- `radiusTolerance`: additive radial clearance; default half of `tolerance`.
  `heightTolerance`: additive height clearance; default `tolerance` (0.1 mm).
- `targetHalf`/`plugHalf`: `upper` (default) or `lower` for plugs. Upper plugs
  point along the negative cut normal. Lower plugs follow desktop orientation.
  Snap currently requires explicit `targetHalf:'lower'`, `style:'prism'`,
  `shape:'circle'`. Dowel pins are independent of targetHalf.

Positions must be finite and on the plane, dimensions positive and finite,
tolerances finite and nonnegative. Unknown enums and malformed arrays throw.
Nonempty connector cuts require both halves and `keepAsParts:false`, avoiding
an upstream null-lower dereference. Empty connector lists retain plain-cut
options, including flip/place-on-cut and `keepPaint`.

Generated connectors use native negative/positive volume roles. Upstream socket
tolerance includes a 0.05 mm preview overlap, and additive height clearance is
not necessarily symmetric for dowels. Upper plug conversion reverses geometry
before cutting, then removes native socket tolerance from the upper positive
volume and adds it to the matching lower negative volume. Exact connector
names prevent two connectors from both changing the first volume.

All model edits, result construction and plate memberships are staged before
success is committed. A returned failure or validation exception leaves the
live model and memberships unchanged. Successful calls replace model storage;
the integration must invalidate caches retaining model pointers.

The result includes `success`, original `objectId`, `connectorCount`,
`createdObjects`, and `fitValidated:false`. Each object has `id`, `name`, `part`
(`upper`, `lower`, `parts`, `dowel`), `openEdges`, world `boundingBox`, `volumes`,
`volume` and `volumeIsBooleanResult:false`. Per-volume metadata includes native
`type` (`normal_part`, `negative_part`, etc.), signed component `volume`,
`scalingFactor`, `offset`, world `boundingBox` and `openEdges`.

Component volume uses mesh volume magnitude times the volume-transform
absolute determinant, with negative sign for negative volumes. Object volume
sums model parts and subtracts negative parts, ignoring modifiers; it excludes
instance scaling. It is **not** boolean-union volume. Closed components and a
signed sum do not establish socket subtraction, attachment, clearance or fit.

Only a conservative cut-space bounding-box footprint check is performed.
Concave interiors, holes, shell thickness, socket depth and overlapping
connectors are not validated. `fitValidated:false` is deliberate; callers must
not advertise automatic fit validation. Full containment/overlap checks and
actual sliced peg/socket evidence remain integration acceptance work.

### Slice toolpath cavity evidence vs volume arithmetic
At sparse infill densities (e.g. 15%), sliced filament consumption comparison
between a plain solid cut and a socket cut is non-monotonic: the presence of
a negative socket void introduces additional internal hole perimeters and
solid surface transitions surrounding the cavity, which consume more extrusion
length than the sparse infill void displaced. Verifying cavity creation in
slicing therefore inspects real G-code toolpath features:
1. Additional internal hole wall contours (`Inner wall` / `Outer wall` blocks)
   present exclusively across the Z-layers spanning the socket depth (150 blocks
   in socket cut vs 100 blocks in plain solid cut) and socket hole perimeter moves.
2. Verified physical cavity clearance via G-code toolpath segment probing at
   socket layer Z=8 mm: modal XY tracking and relative/absolute E extrusion mode
   accounting (M82/M83, G92) examine all positive extrusion segments (walls and
   infill alike). Shortest segment-to-center distance proves zero extrusions enter
   or traverse the central socket core ($r < 1.4$ mm for the nominal $r=2.0$ mm socket).
3. Positive control comparison: the corresponding solid cut lower half at Z=8 mm
   verifies positive extrusion segments crossing directly through the central core
   ($r < 1.4$ mm), proving the parser detects through-center traversals and
   distinguishes solid infill from negative voids.

### 3MF serialization and multi-plate assignments
3MF project round-trips preserve cut connector objects, individual volume roles
(`part` and `negative` connector volumes), valid mesh vertex counts via
`getMesh.vertexCount` (retaining geometric manifoldness), and plate assignments
across multi-plate scenes. Connector coordinates specified in `world` space
project into instance cut space by accounting for instance offsets across plates.

## Integration handoff

Add `CutConnectorOps.cpp` to the existing CMake engine source list, include its
header, dispatch `cutObjectWithConnectors` with current model, plate pointers
and effective config. Add the worker case, JS wrapper and TypeScript interface.
Register successful calls with the same mutation/history/cache invalidation
path as basic cuts. No Engine/CMake/web files were changed in this review.

Run `wasm/tests/node/cut-connectors.test.mjs` against a fresh linked engine under
the memory cap. Prepared tests check two distinct upper plugs, downward bounds,
nominal peg/radial and height socket scales, volume roles, independent dowel,
plain cut and validation rollback. Arithmetic net-volume assertions were
removed. Runtime tests remain deferred. Before release, also test lower plugs,
frustum/snap geometry, rotated/scaled/mirrored instances, tilted planes,
flip/place-on-cut, actual slicing/fit, annotation preservation, plate and
project/undo round trips. Source compilation alone proves none of these.
