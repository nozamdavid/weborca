# Mesh repair and health

`OrcaWasm::getMeshHealth(model, args)` (`checkMeshHealth` alias) and
`repairObject(model, args)` (`repairMesh` alias) take `objectId` (`id` alias),
with optional `volumeId` or `volumeIndex`. IDs take precedence over indexes.

Health returns `success`, `objectId`, `isManifold`, `openEdges`, `facetsCount`,
`numberOfParts`, `degenerateFacets`, import repair counters, `volume`,
`boundingBox`, and a `volumes` array with corresponding per-volume metrics,
`volumeId`, `volumeIndex`, and `name`.

`isManifold` is a nonempty-mesh boundary/degeneracy check using
`its_num_open_edges` and `its_remove_degenerate_faces`, not proof against
self-intersections or non-manifold vertices. Import repair counters describe
past repairs, not current reversed-face diagnosis. Volume is signed mesh-local
volume; the aggregate sums selected mesh volumes without transformations or
negative-volume subtraction. It is not printable boolean volume. Per-volume
bounds are mesh-local; top-level bounds cover the whole object including its
instances even when a volume is selected.

Repair calls the actual `MeshBoolean::cgal::repair`, with soup cleanup and one
retry on failure. The upstream implementation continues when self-union fails
and only checks closure afterward; success must not be advertised as proof
that all self-intersections have been removed. Its repair counters are mostly
zero. Empty repair output is rejected.

All geometry, hulls, annotation remapping and result construction happen on a
model copy before replacing the live model on success. Object/instance IDs,
configurations and transforms persist; repaired volumes get new IDs, returned
in `volumes`. Engine caches must not retain model pointers across this call.

`keepPainting` defaults to true. Upstream `save_painting` / `restore_painting`
remap support, seam, color and fuzzy annotations spatially. This is not exact
facet-index preservation. Texture displacement annotations have no upstream
remapping support: painted targets are rejected with `keepPainting:true`.
`keepPainting:false` clears every facet annotation after topology replacement.
`splitParts:true` is explicitly rejected: upstream `ModelVolume::split` can
remove degenerate volumes elsewhere in the object, outside the selected target.

Repair returns `success`, `wasRepaired`, `objectId`, before/after open-edge,
facet, volume, part and degeneracy counts, repair counters, `isManifold`, and
`volumes`. CGAL failure returns `success:false`, `wasRepaired:false`, `error`
and unchanged before/after edge/degeneracy counts. Invalid selections or
unsupported options throw without changing the model.

## Integration handoff

Add `RepairOps.cpp` to the existing engine CMake source list and include
`RepairOps.hpp` in Engine.cpp. Dispatch all four names to these free functions.
Only successful repair calls should participate in mutation/history handling;
health calls are reads. Add matching worker cases, JS methods and TypeScript
contracts; follow the current engine dispatch and history conventions rather
than copying an old Engine::Impl skeleton. No new library is needed.

Run `wasm/tests/node/repair.test.mjs` against a freshly linked engine, under the
memory cap. It covers a closed cube, missing triangle, bounds, volume-ID
replacement, support remapping/clearing, and rejected-split rollback. The STL
fixture has outward winding; import-time repair may affect its expected open
edge count and must be checked at runtime. Further acceptance needs seam,
color, fuzzy and texture annotations, multi-volume CGAL failure rollback,
project/undo round trips, and transformed volumes. No runtime result is claimed
by this compile-only handoff.
