# v2.5.0 local integration checkpoint

Existing browser workflows passed scoped local validation on one immutable
production candidate. This milestone retains the staged merge of upstream
`40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19` and WebOrca
`413cb95cb6107a6b8786444925d672b142e3f690`, foundation
`709ff3ecd09824b4f2bd3a78f398c3a038811243`, on
`t3/merge-upstream-v250-foundation`. It does not qualify every upstream feature.

CURRENT5070 remains the background-engine release
`wasm/build/ui-background-engine-release-20261107`. The candidate is local to
`/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`; no main promotion, push,
deployment or live configuration change forms part of this checkpoint.

## Accepted evidence

| Scope | Accepted result | Report |
| --- | --- | --- |
| Dependency/core | Fresh CGAL 6.2.1 geometry, all 251 native core objects; 98 selected cases / 2,053 assertions | [Dependency/core](dependency-core.md) |
| Semantic merge seam | Cooling first-value fallback restored; regression included in the native result above | [Source review](core-semantic-review.md) |
| Configuration | S2 matching module: 43 checks, zero failures; legacy baselines/renames, typed slot deletion/rollback and repair | [Config adapters](config-adapters.md) |
| Preview | Chromium lighting/shadows, four lighting/quality combinations, 13 numeric views; six value/source-line tests and zero-upload benchmark assertions | [Adapters](preview-adapters.md), [final runtime](preview-runtime.md) |
| STEP | Five direct geometry checks + five import/slicing checks; old cone module fails the new closed-edge control | [STEP integration](step-integration.md) |
| Integrated browser | Preparation 34/34; startup 16 scenario assertions; gated admin/tester/recovery; STEP nine recorded checks; slice/export/Preview at 1440/1280/390/320px | [Browser acceptance](browser-integration.md) |

Reports preserve failed initial attempts and harness corrections. The final
runtime/browser reports supersede earlier owners' pending handoffs only for
the checks they explicitly record. This finalization runs documentation/link,
whitespace and Git checks only; it does not rerun builds or acceptance suites.

## Immutable candidate and inputs

Exact candidate: [wasm/build/v250-browser-integration/candidate-gated](../../wasm/build/v250-browser-integration/candidate-gated/),
recursively nonwritable. The following evidence is **ignored local evidence**,
not source-controlled artifacts or a portable release package:

- [Build inputs](../../wasm/build/v250-browser-integration/build-inputs.env)
  and [input manifest](../../wasm/build/v250-browser-integration/input.sha256),
  manifest SHA256 `a67c9fca29a99079289ea919bff7f3d7e8922dcc975e0459fbfd92142e85290d`.
- [Candidate manifest](../../wasm/build/v250-browser-integration/candidate.sha256),
  SHA256 `d666a64185fbe5801c8a6f955fa10e708672cd7d792c7b8fff863ac0e32089d8`;
  [final manifest verification](../../wasm/build/v250-browser-integration/candidate-final.log).
- [Build script](../../wasm/build/v250-browser-integration/build-candidate.sh)
  binds source/data/module inputs, packages once, compares exact bytes and
  freezes outputs. Retries used this same candidate.

All directories below are relative to the integration worktree. Both dev serving
and production packaging honor these explicit overrides:

| Variable | Candidate input directory |
| --- | --- |
| `ORCA_ENGINE_DIR` | `wasm/build/v250-engine-module-s2` |
| `ORCA_STEP_MODULE_DIR` | `wasm/build/v250-step-module` |
| `ORCA_PREVIEW_DIR` | `wasm/build/v250-preview-adapters/frozen-preview` |
| `ORCA_PROFILES_DIR` | `wasm/build/v250-config-evidence/catalog/profiles` |
| `ORCA_SETTINGS_DIR` | `wasm/build/v250-config-evidence/settings` |

`VITE_ALPHA_GATE_ENABLED=1` selects the accepted gated build. Profiles contain
all 72 merged-source vendor packs and assets; settings contain the matching
`layout.json`. Engine S2, frozen Preview, patched STEP and both LGPL notices
must travel together. Exact JS/WASM hashes are in the browser report. Static-off
packaging and direct mounting have focused coverage; a second static production
candidate was not built.

## Required build contract

CGAL 6.2.1 is checksum-pinned by `wasm/deps/build_cgal.sh`. The accepted isolated
prefix is `wasm/build/prefix-v250-wasm64`, build root
`wasm/build/orca-v250-wasm64`, SDK Emscripten 6.0.11 with memory64,
`-pthread -fwasm-exceptions`, C++17. Geometry consumers rebuild together with
consistent `CGAL_LINKED_WITH_TBB`; the old 5.6.3 geometry cache is unsuitable.
Unchanged dependency reuse was audited in the core report.

The accepted configure uses `SLIC3R_GUI=OFF`, `SLIC3R_CAD=OFF`,
`SLIC3R_PCH=OFF`, `SLIC3R_STATIC=ON`, `CMAKE_DISABLE_FIND_PACKAGE_libigl=ON`,
`ORCA_WASM_PREVIEW=ON`, `ORCA_WASM_SIZE_TIERS=ON`, `ORCA_WASM_NOLOG=ON` and
`ORCA_WASM_MESH_BOOLEAN_OPTIMIZATION=-O1`. OCCT, OpenCV, Assimp, Draco,
OpenSSL and FreeType are disabled in the main engine. The complete
[configure script](../../wasm/build/v250-core-evidence/configure-wasm.sh)
and [core report](dependency-core.md) record flags, prefix roots and commands.
Heavy validation used the serialized 2 GiB, zero-swap runner. STEP uses its
separate patched OCCT prefix `wasm/build/prefix-v250-occt-step` and isolated
output; see its report for audited unchanged-toolkit reuse and rebuild commands.

## Preserved behavior and remaining qualification

Chromium acceptance covers responsive startup before engine readiness, lazy
catalog/retry, saved legacy presets and reset, filament add/delete, STL append,
numeric model edits, undo/redo, repair, 3MF reopen, real slicing/download,
Preview controls/lighting/quality and FPS publication. Alpha login/admin launch,
revocation, denied-backup Retry and durable recovery retain their tested flow.
STEP remains lazy; cancellation/retry is exercised through the production client
and worker. There is no exposed in-progress STEP Cancel UI.

Same-source native/WASM toolpath parity is **not established**. Old golden
differences were retained and reported, never silently accepted or replaced:
the legacy cube and current candidate differ in paths, extrusion, planner output
and estimates. Current desktop/mobile slices agree with each other and export
their current raw bytes; that is not a native parity result.

Firefox fails at empty-page creation before module load under the 128-task cap,
including an observed thread-creation EAGAIN; no Firefox renderer pass is claimed.
Native OCCT8 parity is absent; historical two-engine STEP comparison exceeded
the 2 GiB cap. Hardware GPU, physical mobile/Safari, printers and real provider
lifecycle acceptance remain open. SwiftShader checks and CPU/FPS publication
do not establish hardware performance parity. Transparency remains deferred.

New belt, IMEX parallel-print, collision-volume, mixing/Hybrid mapped slicing,
texture, center-of-mass, Python plugin and Design-tab browser workflows require
separate work and qualification. Passive metadata/config support does not prove
those features usable. Main promotion and deployment remain separate open work.

## History and tracking

- [Original assessment](../orcaslicer-v2.5.0-integration-assessment.md).
- [Configuration research](config-compatibility.md) and
  [Preview/build research](preview-build-compatibility.md), preserved as research.
- [Foundation resolutions](merge-foundation.md) and
  [foundation changed-path inventory](changed-paths.txt).
- [Patch inventory](../../wasm/PATCHES.md), [tracking receipt](tracking.md).
- [Taproot project](http://192.168.0.199:8789/p/YPttwK6VZASSDf): scoped local
  validation is complete; shipped baseline and remaining qualification stay distinct.
