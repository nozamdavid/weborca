# Texture viewer entries and bundled picker — 2026-11-17

Published candidate: `wasm/build/ui-texture-displacement-viewer-release-20261117` at https://server-1.barbel-hops.ts.net:5299/. No engine regeneration or commits.

## Implementation

`PlateView.tsx` owns the existing tool groups rendered by `CanvasToolbar`, including its overflow menu. The texture entry uses the native `toolbar_texture_displacement.svg`, accessible title/label and existing selection/busy guards. `MobilePrepare` exposes Tools using the existing MobileSheet architecture. Both share `textureTool.ts`, refresh the object tree (normally unmounted on mobile), and open the existing TextureDialog through useEditOpsStore. Edit remains available.

Native `TextureLibrary.cpp` scans resources/textures/displacement in case-sensitive stem order. `GLGizmoTextureDisplacement.cpp` add_texture_layer initializes the first library texture; set_layer_texture preserves numeric/projection parameters. The web dialog follows this with 44 named choices, Bark initially, a four-column scrollable thumbnail grid and lazy images. Colored originals remain colored. Vite imports package every PNG (small images may be data URLs), and selection fetches original bytes for native luminance decoding. Upload retains its existing PNG/JPEG normalization. Generation guards discard obsolete image loads; pending/failing choices clear prior image bytes and disable Bake. Parameter values persist across choices.

## Verification

- TypeScript, 22 locale catalogs and production packaging passed. Focused native texture test passed against the retained r2 engine (maximum cube relief 0.4022 mm). Impeccable detector returned no findings before visual QA; source diff whitespace check passed.
- T3 preview_status preceded browser work. Actual rendered controls were clicked with DOM click events through T3 preview_evaluate; these checks do not claim physical touch/pointer acceptance.
- Final candidate at 390×844: Tools sheet → Texture displacement opened the same dialog with the selected cube part and Bark loaded. Bake enabled, completed and closed the dialog; cube size changed from [20,20,20] to [20.7999992371,20.7999992371,20.4033002853]. Mobile empty-selection and injected slicing busy checks disabled the entry on the preceding candidate using the same eligibility code.
- Final candidate at 1440×900: viewer toolbar overflow → Texture displacement opened the dialog. No selection and injected slicing busy each disabled its entry. All 44 choices present. Camouflage selection retained depth 0.4, tile 12.5, rotation 0 and neutral 0; Bake completed and closed. Final cube size [21.3050003052,21.3310995102,20.6590003967].
- Injected Camouflage fetch failure displayed the error, cleared preview and disabled Bake. A delayed retry disabled both Bake and the choice fieldset until completion, then showed Camouflage and enabled Bake. The native Bake used the rendered button, not a direct native call.
- Visual QA caught compressed thumbnail rows and the mobile object-tree dependency. These concrete failures required two additional frontend builds; the request for exactly one build was therefore not met. Only the final immutable release candidate was published. Draft candidates remain local. No engine was rebuilt. Final picker rows measure 108px and retain readable colored thumbnails and labels on mobile.

## Publication and rollback

After acceptance, updated `~/.config/systemd/user/orca-texture-candidate.service` to the release candidate and restarted it; service active. HTTPS index and engine returned HTTP 200 with COOP same-origin / COEP require-corp at 2026-11-17 01:24 UTC. Index and every packaged UI asset matched local bytes exactly. Engine, STEP and preview directories compare identical to r2, including manifests. HTTPS browser reports engine ready and crossOriginIsolated true.

Fetched engine SHA256: `9c680893c1f380241c7f0c7587cf05b757ef4d6186e354cc147b61f15f7c6c1d` (17,702,480 bytes). Retained rollback: change service outDir back to `../build/ui-texture-displacement-r2-20261117`, daemon-reload and restart. Public release remains separate. Broad projection/recovery evidence remains in the aggregate report; this batch did not repeat it.
