# Box-selection bounds rejection — 2026-11-11

The rectangle now defines the broad-phase frustum, allowing a cached bounding sphere to reject misses before exact triangle clipping. Empty/outside rectangles and zero-size viewports return early. Existing exact intersection and instance union behavior remains.

The parent completed and verified the preserved partial implementation after reducing Mistral tasks. Six box-selection tests pass. A cached 80,000-triangle mesh missed by a small rectangle reads zero triangle vertices in both perspective and orthographic projections. One Node sample measured 0.73 ms and 0.08 ms respectively; these are harness timings, not browser-frame gains. Existing tests cover crossing triangles, near/far/behind-camera exclusions, DPR and deduplication. Combined box/scene tests: 10 passed, one optional historical comparison skipped. The latter now requires SCENE_COMPARE_BASELINE=1 because clean CI checkouts do not contain the local measurement baseline commit.

TypeScript compilation is pending the parallel Preview worker import-typing fix. No integrated UI build or service change.
