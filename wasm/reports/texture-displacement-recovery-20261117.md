# Focused texture Bake recovery verification — 2026-11-17

Result: PASS. No concrete failures found in the assigned checks.

Candidate: immutable `wasm/build/ui-texture-displacement-r2-20261117`, served at http://localhost:5299. T3 preview_status was called first; verification used a newly opened, separately owned 1280×800 tab. Port 5298 and its QA tab were untouched. No implementation edits or rebuilds.

Both the on-disk engine and browser-fetched `/engine/orca_engine.wasm` (17,702,480 bytes) SHA256 matched `9c680893c1f380241c7f0c7587cf05b757ef4d6186e354cc147b61f15f7c6c1d`.

## Method

Read `wasm/build/texture-displacement-evidence.md`. Imported a closed, outward-facing 20 mm cube OBJ through the app import action. Selected the object through the exposed store and opened TextureDialog through its store. Supplied a browser-generated 32×32 black/white PNG through the actual file input and change event. Used the rendered Bake texture and Retry update buttons; native displacement was never invoked directly by the harness. Default settings: depth 0.4 mm, tile 12.5 mm, triplanar, neutral 0, no inversion.

Instrumented only this tab's exposed engine call method to count successful native textureDisplace calls and throw a single saveProject error after native success. A second scenario temporarily replaced commitTransaction with a one-shot rejection that restored the original method. All remaining native calls and history operations used the candidate unchanged.

## Results

- Save failure: native textureDisplace succeeded once (object 29, captured volume 32), yielding 9,472 triangles / 4,738 vertices from 12 triangles / 8 vertices. The next saveProject threw `QA one-time saveProject failure`.
- The dialog truthfully displayed: “The geometry was baked, but updating the scene or saving Undo history failed. Retry update to finish without baking again. QA one-time saveProject failure”. Inputs were disabled, and Close / Retry update were available. Screenshot: [save failure](texture-displacement-recovery-save-failure-20261117.png).
- Retry closed the dialog, committed `Bake texture displacement`, and retained exactly one successful native bake. Mesh bytes before and after retry were identical (SHA256 `44521e00faa89ce9dd0da3df6039e49cf221cb12dad019a0abf5ad096912460a`). History held Initial state and Import in past, with Bake as current; no duplicate Bake entry.
- Undo restored the original 12-triangle cube, including exact mesh SHA256 `507943ec8487515842c29d29000fc42d4541cb4344662bb741ee0efcef24aa21`. Redo restored 9,472 triangles.
- Direct transaction rejection: after another successful native bake (object 104, volume 108), `QA one-time commitTransaction failure` appeared in the same truthful recovery message. Retry completed and closed the dialog without a second bake. Sorted vertex-coordinate hash before and after retry remained `d49f3f3487b4e2310901d6d803660ce15186ed2fda20574a8822e1d14196de27`. Undo restored the exact original cube; redo restored 4,738 vertices.
- Normal valid UI Bake with no injected failure closed the dialog, recorded `Bake texture displacement`, and produced 9,472 triangles. Undo and redo succeeded.

## Additional check prompted by a correctness concern

Raw mesh bytes and local coordinates changed across redo. Local nearest-vertex distance reached 0.20015055 mm. Investigated this specific discrepancy with a repeated normal Bake and compared world coordinates using native object-tree instance offsets. Restore recenters local geometry and compensates its instance offset: restored offset was [150, 150.00015020370483, 10.20015001296997]. Maximum restored-to-original nearest world-vertex distance was only 0.00000067435 mm, consistent with floating-point precision. This is not evidence of lost displacement.

Scope: focused post-bake save/transaction recovery and normal Bake smoke. No broad eligibility, projection, export or transformed-part coverage was added. Slice invalidation was not independently measured. The separately opened verification tab was closed after completion.
