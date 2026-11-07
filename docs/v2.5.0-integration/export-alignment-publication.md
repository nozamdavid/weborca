# Export G-code alignment publication

Published 2026-11-07 to https://server-1.barbel-hops.ts.net:5070/.
Live root: `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/v250-export-align/candidate`.

The current service root was verified before work. Its paint-exit input manifest
matches every current build input except the assigned CSS change.
`SliceStatsPanel.css` set the Export anchor to `display: block`, overriding the
shared `.ds-btn` flex layout. Changing this to `inline-flex` restores its existing
center alignment. Generic Preview label rules do not apply to this anchor's direct
text node. Send already uses flex. Dimensions, colors, translations, click handler
and states are retained.

Evidence is in `wasm/build/v250-export-align` in the integration worktree.
One integrated build passed TypeScript and 22 locale catalogs. `build.sh` compares
frozen native engine, Preview, STEP, profiles and settings. `artifact-diff.txt`
shows only frontend asset changes and index references; shipped backend and other
assets remain identical. Candidate hashes pass after publication. Detector output
is retained in `detector.json`.

T3 preview supplied local and public loaded Preview acceptance at 1280×800,
1440×900 and 1366×768. The Export button remained 136×26 CSS pixels; text center
offset was -0.004px horizontally and -0.453px vertically, with no clipping.
Before the fix the vertical offset was -5.25px. The rendered dark/teal button was
visually inspected. `public-preview.png` retains the public capture.
Local cube slicing loaded 100 layers and the Export click downloaded 388,704 bytes.
Public recovered-model slicing loaded 240 layers and Export downloaded 4,990,357
bytes. Browser-native download completion was confirmed.

`deploy.log` records authenticated exact public bytes, COEP/COOP, engine version
and cache headers, backend protection, authorization separation and revocation.
Durable invites were unchanged. `release.sh` guards previous/candidate manifests,
existing overrides, frozen server, runtime environment and Tailscale routes;
it automatically rolls back activation/public asset verification failures.
Only a lexical-last ORCA_ROOT override was added. Private config, providers,
routes, frozen `v250-empty-recovery/server.mjs`, native artifacts, recovery,
startup caching and paint-exit code are retained. Restart resets memory sessions.

Rollback:

```sh
bash /home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/v250-export-align/release.sh --rollback
```

This removes only the matching override and verifies the exact paint-exit root.
No native rebuild, commit, push or delegation occurred. Acceptance is limited to
the shared Chromium browser; physical GPU and other browsers were not exercised.
