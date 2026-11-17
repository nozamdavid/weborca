# Independent browser QA — texture displacement, 2026-11-17

Tested frozen `wasm/build/ui-texture-displacement-20261117` at http://localhost:5298 using T3 preview tools, starting with `preview_status`. Read the [initial build evidence](texture-displacement-initial-20261117.md). Engine SHA256 verified: `599d36461f1738f3b3372ad26993e951a84d53a2e401f7959ae4f8d49ac289f8`. No build or implementation edits; concurrent parent source edits do not affect these results. Opened test tab closed on completion.

## Method and fixtures

Actual file inputs, object/part rows, Edit menu, projection select, Bake button, transform input, Preferences and mobile Save project controls exercised. DOM clicks/events through `preview_evaluate` were used alongside `preview_act` upload/select/resize/scroll after an initial click timed out. Geometry was read through the app's engine-backed `getMesh`; no direct displacement API calls. This verifies rendered-control handlers, not physical pointer hit testing for every action.

CNCKitchen archive downloaded to `/tmp/cnckitchen-textures.zip` from https://codeload.github.com/CNCKitchen/stlTexturizer/zip/refs/heads/main (archive commit `a2f8db6af96ecbec21e5861ccba673519f91b59e`). GitHub API listing hit its anonymous rate limit; archive download succeeded. Unmodified textures extracted under `/tmp/texture-browser-fixtures/stlTexturizer-main/textures`:

- `knurling.png`: 512×512 grayscale, SHA256 `b3558074f9d398e00f99c55d660131f0364c403c316660004d1c6789a2d56f46`.
- `carbonFiber.jpg`: 525×525 progressive JPEG, SHA256 `b749cc13cc4a6f541c7e30d65c2907363bf877ff228fb1d53bdd660f9a6f412e`.
- `brick.png`: SHA256 `1faa6eddd375b0f1e9667d6c3787bcaaa3023f0a46e3eca774a3fa950b6feac7`.

Generated temporary STL fixtures through browser File/DataTransfer import: 32-sided radius-10 mm, height-20 mm cylinder (128 triangles); radius-10 mm sphere (32 longitude ×16 latitude bands, 960 triangles). Temporary `/tmp/texture-multipart.3mf` contains two separated tetrahedral parts (4 triangles each) in one object, imported through model file input.

## Verified

| Case | Result and evidence |
| --- | --- |
| Cylinder + real knurling PNG + Cylindrical projection | Dialog decoded image; default depth 0.4 mm / tile 12.5 mm; Bake completed and dialog closed. 128 →199,998 triangles. Maximum vertex distance to ideal cylinder side/cap surfaces 0.411499977 mm; minimum local Z remained −10 mm. |
| Sphere + real carbon-fiber JPEG + Spherical projection | Bake completed and dialog closed. 960 →200,000 triangles. Before: radial error against ideal radius 10 below 0.00000046 mm. After: signed radial deltas −0.042219922 to +0.248972384 mm. Faceted input has chord interiors inside the ideal sphere, so negative radial values alone do not establish inward displacement. |
| Transformed model + brick PNG + Triplanar | Entered 37° Z rotation in the sphere transform input and committed by focus/blur. Engine instance rotation was 0.6457718232379019 radians before and after bake; offset [150,150,10] and scale [1,1,1] preserved. Bake completed; final maximum radial delta 0.741651547 mm versus +0.248972384 before this second bake. |
| Multipart whole-object eligibility | Selecting object row, opening Edit → Texture displacement shows “Select one model part in the object list before opening this tool.” Bake disabled. |
| Multipart selected-part isolation | Closed dialog, selected volume row 168, reopened tool, uploaded brick, baked. Selected part changed from volume 168 /4 facets to volume 200 /200,000 facets. Sibling volume 182 retained 4 facets and its complete ordered triangle-coordinate sequence exactly. Used copied snapshots and volume facet ranges to compare independent geometry. |
| Unsupported modifier selection | Changed sibling type using Volume actions → Change Type → Modifier. Selected modifier row, opened texture tool, uploaded knurling, clicked Bake. Alert “Select a model part”; dialog remained open, busy cleared, positions exactly unchanged. |
| Mobile layout and light readability | Set Light using Preferences → Appearance → theme select. At 390×844 CSS viewport, light dialog text/background measured rgb(37,39,42)/rgb(236,236,239); labels, inputs, explanation and footer readable in screenshot. Dialog opened at desktop then resized; mobile tool discovery is not covered. Dark dialog with uploaded image also retained footer inside viewport (bottom 843); body scroll accommodates content. |
| Actual browser download | At mobile viewport used Menu → Save project after cylinder and initial sphere bakes. Download registry confirmed `sphere.3mf`, 4,888,802 bytes, completed 2026-11-17T00:27:18.188Z. Copied to `/tmp/texture-browser-export.3mf`. `unzip -t` passes all entries. Geometry object XML contains 200,003 vertices /399,998 triangles combined, matching 199,998 +200,000 baked facets. SHA256 `d4209e69cd224f425881911faac145da0b4d27c0e3180d43f51fbe17e688891c`. |

Ideal-surface metrics establish actual displaced geometry, not an exact closest-distance comparison to every original triangle. Cylinder metric uses min(abs(radius−10),abs(abs(z)−10)); sphere metric uses radius−10. No claim of exact depth bounds or seam quality follows from those metrics. Mesh buffers can be reused: retained object references were unsuitable for an initial transformed before/after comparison; that comparison was discarded. Multipart checks explicitly clone buffers.

## Findings and limits

No new confirmed functional blocker in these cases. Modifier eligibility is enforced on Bake rather than disabling the button before submission; rejection is clear and preserves geometry. Cylinder ideal-surface distance exceeds nominal depth by approximately 0.0115 mm; recorded as an observation, not a confirmed defect without exact faceted-surface/algorithm tolerance analysis.

Native PNG dimension preflight and post-commit failure messaging were reported by parent review and are being fixed separately. Neither fix is verified by this frozen-candidate run.

Untested: nonuniform scale/mirror and volume transforms; painted/UV/multi-instance rejection; mobile entry path to texture tool; mobile bake with touch/virtual keyboard; exact surface-distance or projection seam/pole quality; actual downloaded G-code; reopening this particular downloaded 3MF; new candidate fixes. Prior PNG/JPEG synthetic-pattern, corrupt-input, undo/redo, 3MF reopening and slicing coverage is described only in the earlier build evidence and was not repeated here. A temporary multi-instance 3MF imported as two separate single-instance objects, so it did not establish multi-instance rejection.

## Screenshots

All retained under `wasm/reports/texture-displacement-browser-20261117/`:

- `cylinder-dialog.png`: knurling preview and cylindrical projection selection.
- `rotated-result.png`: rotated sphere after brick bake.
- `ambiguous-selection.png`: whole multipart object alert.
- `mobile-light.png`: light dialog at 390×844.
- `unsupported-modifier.png`: native unsupported-selection alert.

Only this report and the five screenshot files were added by this QA task. Temporary downloads/fixtures remain outside the repository. No deployment, commits, delegation, README or Taproot milestone changes.
