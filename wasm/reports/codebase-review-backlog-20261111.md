# WebOrca codebase review backlog — 2026-11-11

Read-only audit of forgotten work and integration state. No source, test, build, service, tracking or deployment changes were made. The running private preview (PID 592057, HTTPS5065) was inspected and preserved; no preview tools, builds, test runs, commits or pushes were used beyond one read-only run of the documented `wasm/ci/check.sh --check`. Parent checkout source was not read, modified or copied.

## Baselines and state labels

| Label | Identity | Evidence |
| --- | --- | --- |
| Shipped baseline (git) | `origin/main` at `bb0848ad06` (PR6 merge), containing PR5 merge `afcf3da987` and the v2.5 integration commits `77a15ff923` / `709ff3ecd0` | `git log --graph`, `gh pr view 5/6` |
| Current branch | `prototype/html-in-canvas-plate-title` at `6773b526d0`, plus 10 modified and 17 untracked entries | `git status --porcelain` |
| Remote feature branch | `origin/prototype/html-in-canvas-plate-title` at `c19ac1cb7f`, a merge of `origin/main` into the feature branch | `git rev-parse`, `git log --graph` |
| Private candidate | `wasm/build/ui-transform-release-selection-20261111`, Vite PID 592057, port 5064, HTTPS5065 | `ps`, `wasm/build/preview-5064.pid`, `transform-release-selection-20261111.md` |
| CURRENT5070 deployment | PID 1928814, server `t3-c8aa6ae1/wasm/build/v250-empty-recovery/server.mjs`, `ORCA_ROOT=.../tests-desktop-ui-polish-20261108-r2/candidate` | `/proc/1928814/environ`, process args |
| Archived experiment | `experimental/canvas-first-ui` at `0e178a4fbe`, one commit not in `origin/main`, intentionally archived | `git log`, `git merge-base --is-ancestor` |
| Pull requests | PR1–PR6 merged; no open PRs | `gh pr list --state all` |
| Taproot | `YPttwK6VZASSDf`, read-only; three top-level TODO branches remain open | MCP `get_project` |

The current worktree is not production. It is a prototype branch based on an older commit than the remote feature branch and `origin/main`.

## Findings

### 1. The accepted prototype needs a coherent source snapshot (confirmed integration gap)

**Evidence**

- The working tree has 10 modified tracked files and 17 untracked entries.
- Tracked files import untracked modules:
  - `wasm/app/src/plate/PlateScene.ts:2` imports `boxSelection`; `:3` imports `./boxSelection.css`.
  - `wasm/app/src/plate/PlateView.tsx:13` imports `addBoxSelection`.
  - `wasm/app/src/plate/NumericTransform.tsx:10` imports `multiScale`.
  - `wasm/app/src/plate/plateStore.ts:9` imports `groupScaleEntries`.
- `git ls-files` returns nothing for `wasm/app/src/plate/boxSelection.ts`, `wasm/app/src/plate/multiScale.ts` and `wasm/app/src/plate/boxSelection.css`.
- `git ls-tree -r` on both `origin/prototype/html-in-canvas-plate-title` and `origin/main` finds none of the new source or test files.
- The exact working-tree contents are recoverable only from hidden T3 checkpoint ref `33a2525f0b` (`refs/t3/orchestration-v2/checkpoints/...`), not from a branch or remote.
- Four new test files are also untracked: `bed-boundary-slicing.test.mjs`, `box-selection.test.mjs`, `group-transform-gizmos.test.mjs`, `multi-scale.test.mjs`.

**Trigger and consequence**

A clean checkout of HEAD builds a different app. Committing only the modified tracked files fails TypeScript/Vite resolution because the imported files do not exist. The accepted candidate, its tests and its reports cannot be rebuilt or reviewed from git. Recoverability currently depends on an internal checkpoint ref.

**Confidence:** High. The imports and missing tracked files are deterministic; no build was needed to establish the failure.

**Smallest fix:** Commit the three source files, four tests, modified tracked files and reports in coherent commits, then verify a clean checkout. Do not treat the hidden checkpoint as the source of record.

**Effort:** S to commit, M to rebase and rebuild.

**Validation:** Create a clean worktree at the resulting commit, run `npm run build` in `wasm/app`, then run the four focused Node tests with `node --experimental-strip-types --test wasm/tests/node/{multi-scale,box-selection,group-transform-gizmos,bed-boundary-slicing}.test.mjs`.

### 2. Accepted fixes are layered on a pre-v2.5 base; remote and main have moved (confirmed drift, medium integration risk)

**Evidence**

- `6773b526d0` is an ancestor of `origin/main`; the remote feature branch is `c19ac1cb7f`, which merges `origin/main` into the feature branch. PR5 merged that newer head as `afcf3da987`.
- Four of the locally modified files differ substantially between `HEAD` and the remote feature branch: `README.md` (108 lines), `wasm/app/src/plate/PlateScene.ts` (46), `wasm/app/src/plate/PlateView.tsx` (57), `wasm/engine/Engine.cpp` (371).
- `Engine.cpp` was changed by the v2.5 integration commits `77a15ff923` and `709ff3ecd0`; the local bed-boundary edit is applied to the older file.
- The bed-boundary report states the engine was rebuilt against this worktree, so the accepted boundary engine is not validated against the v2.5 engine source.

**Trigger and consequence**

Committing the working tree as-is creates a stale-base commit. Overlapping changes create integration risk; diff counts alone do not prove conflicts or reversions. The accepted engine candidate is not the engine that current main would ship. A local `git push` of the current branch is also behind the remote branch and would be rejected.

**Confidence:** High for the base drift and changed-file overlap. Conflict severity is medium confidence until an integration attempt is made.

**Smallest fix:** First snapshot ALL current accepted work, including untracked source, tests and evidence, in coherent commits. Then integrate those preserved commits onto current `origin/main`, resolve overlap deliberately, rebuild the isolated engine and rerun boundary acceptance. Never rebase or discard unsaved work.

**Effort:** M.

**Validation:** Clean rebase or `git merge-tree` with no unresolved conflict; isolated engine build; `node wasm/tests/node/bed-boundary-slicing.test.mjs` against the rebuilt engine; byte comparison of the packaged loader/WASM with the accepted candidate where applicable.

### 3. Imported G-code shows zero time, layers and filament on Prepare (confirmed user-visible defect)

**Evidence**

- `wasm/app/src/store/appStore.ts:1104-1106` calls `loadGcodeBytes` and swallows every error with `catch (_) {}`.
- `wasm/app/src/preview/orcaPreviewModule.ts:231-234` throws `Preview module not initialized` until `initPreview` has run.
- `initPreview` runs only when Preview mounts: `wasm/app/src/preview/PreviewView.tsx:138-146`.
- `appStore.ts:1118-1121` then stores `layers: stats?.layers || 0`, `printTimeS: ... ?? 0`, `filamentMm: 0`, `filamentG: 0`.
- Prepare renders those values at `wasm/app/src/plate/PlateView.tsx:1350-1357`.
- Export naming consumes the same field at `wasm/app/src/shell/exportGcode.ts:41`.
- Taproot node `imported_gcode_prepare_time` records the observed Prepare 0s versus Preview 39m5s for the same imported Benchy file.

**Trigger and consequence**

Open a `.gcode` from the TopBar file input (`wasm/app/src/shell/TopBar.tsx:705-713`) or mobile/recent files while on Prepare, before Preview has ever mounted. The import succeeds, but Prepare shows zero layers, zero estimated time and zero filament. Preview later loads the bytes itself and shows correct values. Exporting before Preview can also feed `printTimeS = 0` into time-based filename placeholders.

**Confidence:** High from the code path and the recorded observation. No fresh browser run was performed in this audit.

**Smallest fix:** Do not silently convert a missing parser result to zero. Initialize the stats parser before import, or have `PreviewView` write its returned stats back into `appStore.sliceResult`. At minimum, preserve the error and render unknown values rather than zero until stats arrive.

**Effort:** M.

**Validation:** Chromium/Playwright fixture importing `wasm/tests/node/fixture.gcode` from the TopBar on Prepare, then asserting `#stat-layers` and `#stat-time` match the values Preview reports, and that an exported filename does not contain a zero-time placeholder.

### 4. The documented local CI validator is hardcoded to 15 test files (confirmed defect)

**Evidence**

- `wasm/ci/check.sh:227-236` requires exactly 15 files matching `wasm/tests/node/*.test.mjs`.
- The working tree has 102 test files; HEAD tracks 98; `origin/main` tracks 101.
- `bash wasm/ci/check.sh --check` exits 1 with `[ERROR] Expected exactly 15 Node unit test suites under wasm/tests/node/, found 102`.
- `wasm/ci/README.md:22`, `:77` and `:86` all state 15 suites.
- `.github/workflows/wasm.yml:279` runs the wildcard `wasm/tests/node/*.test.mjs`, so the hosted job does not use this count.

**Trigger and consequence**

Any contributor following the documented local validation entrypoint gets a guaranteed failure. The single error masks whether any other check failed. The documentation also overstates what the script validates.

**Confidence:** High. Reproduced directly with the read-only check command.

**Smallest fix:** Replace the exact count with a non-empty check, or derive the count from the workflow globally. Update `wasm/ci/README.md` to say all `*.test.mjs` suites.

**Effort:** S.

**Validation:** `bash wasm/ci/check.sh --check` exits 0 while still validating paths, artifacts and workflows; `git diff --check`.

### 5. CURRENT5070 release documentation contradicts the live process (confirmed obsolete claims)

**Evidence**

- The live process is PID 1928814 with `ORCA_ROOT=/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/tests-desktop-ui-polish-20261108-r2/candidate` and server `v250-empty-recovery/server.mjs`.
- `README.md:43` calls `wasm/build/ui-background-engine-release-20261107` the current immutable release.
- `README.md:47` says “The alpha publication above is current.”
- `README.md:59` says CURRENT5070 serves `wasm/build/ui-alpha-design-release-20261107`.
- Taproot root metadata says `wasm/build/v250-export-align/candidate`, while its own desktop-polish child records the r2 publication on 2026-11-08.
- The r2 root directory and worktree exist, so the process is not running from a missing path.

**Trigger and consequence**

Reviewers and operators get three different “current” roots for one service. Rollback guidance and release comparisons can target the wrong artifact. The service itself is healthy; this is a documentation and tracking defect.

**Confidence:** High for the process environment. The served root was not re-hashed over HTTP in this read-only audit.

**Smallest fix:** Add one dated “Current 5070 release” line naming the r2 candidate and the stable service pointer, mark older “current” paragraphs historical, and update the Taproot root note (tracking writes belong to the parent). Remove duplicate claims rather than adding another release paragraph.

**Effort:** S.

**Validation:** `ps` plus `/proc/<pid>/environ` and a served-file hash check, not only document comparison.

### 6. Private preview receipt in README points to an older candidate and PID (confirmed obsolete claim)

**Evidence**

- `README.md:338` says `wasm/build/ui-bed-boundary-slicing-20261111` is at HTTPS5065 and “Vite PID1649811”.
- PID 592057 currently runs `vite preview --outDir .../ui-transform-release-selection-20261111`; `wasm/build/preview-5064.pid` contains `592057`.
- `wasm/reports/transform-release-selection-20261111.md` records PID 592057.
- `wasm/reports/empty-selection-tool-20261111.md` records PID 1862610.
- `wasm/reports/bed-boundary-slicing-20261111.md` and `export-button-alignment-20261111.md` record PID 1649811.

**Trigger and consequence**

A reader following the README can believe the older boundary candidate is served or use a stale stop command. The report chain has three successive PIDs and the README names the oldest one.

**Confidence:** High. Verified against the live process and pidfile.

**Smallest fix:** Update `README.md:338` to name `ui-transform-release-selection-20261111` and PID 592057, or remove the ephemeral PID and point to the latest report’s verified stop command. Treat the latest report as authoritative for service identity.

**Effort:** S.

**Validation:** `ps -p 592057` and the pidfile agree; a served hash check confirms the candidate.

### 7. PR5 merged with a failed required clang-tidy check; the lint result is unknown (verification gap)

**Evidence**

- `gh pr view 5` reports `state: MERGED`, `mergedAt: 2026-11-11T10:16:27Z`, merge commit `afcf3da987`, base `main`, head `prototype/html-in-canvas-plate-title`.
- Its `statusCheckRollup` records failures for `clang-tidy`, `Approve PR checks` and `cancel`; `clang-tidy` completed in about two seconds.
- PR5 changed only TypeScript/README/report/test files; `.github/workflows/clang_tidy.yml` looks for changed C++ files under `src/` or `tests/` and skips the lint steps when none are found.
- `gh run view --log-failed` for the clang-tidy run returned HTTP 502; the failure cause is unavailable.
- PR6 merged 18 seconds later and removed several automation workflows; `clang_tidy.yml` remains on `origin/main`.

**Trigger and consequence**

Current main contains the PR5 changes without a completed required clang-tidy result. The two-second failure is more consistent with workflow setup or automation than with a reported C++ finding, but that is an inference. Anyone treating the merge as validated would be assuming an unobserved result.

**Confidence:** High that the check failed and the logs are unavailable. Unknown whether any code issue existed.

**Smallest fix:** Re-run clang-tidy on the PR5 diff or dispatch the workflow on the merge commit and record the result. If the failure is infrastructure-only, document that instead of leaving the failed check unexplained.

**Effort:** S for a local lint of the changed files, M for a full workflow rerun.

**Validation:** A completed clang-tidy job, or `scripts/clang_tidy_diff.py` over the PR5 merge base, with the log retained.

## Coverage and gaps

- No in-source `TODO`, `FIXME`, `HACK` or `XXX` markers exist in `wasm/app/src` or `wasm/engine` (zero matches). The actionable backlog lives in Taproot and the reports.
- Taproot open work was not converted into findings where it requires product, credential, hardware or long-running benchmark access: provider real-account validation (`printer_cloud_real_accounts`), Bambu China routing (`bambu_china_regional_routing`), Snapmaker real account/transitions, OctoEverywhere App ID (`octoeverywhere_contract_validation`), physical Safari/Firefox/mobile (`xIq5JBNvVxHokN`, `objects_handy_r2_firefox_open`), live Orca Cloud writes (`cloud_live_refresh_writes`), native/WASM parity and slicing speed (`v250_parity_open`, `slice_speed_20261108`), and v2.5 main promotion (`v250_promotion_open`).
- Step/measurement/edit-operation code and focused tests exist (`wasm/step`, `wasm/app/src/measure`, `wasm/app/src/editops`, `step*.test.mjs`, `measurement-api.test.mjs`, `edit-ops.test.mjs`), but the aggregate integration requested by Taproot node `N28ueJUPagE3ZO` was not exercised here. No defect is claimed.
- The archived `experimental/canvas-first-ui` commit contains 79 files, including `CanvasPrepare.tsx`, `QuickSettings.tsx`, `OutputReview.tsx` and the unique tests `plate-batch-output.test.mjs` and `quick-settings.test.mjs`. It is intentionally unmerged; no promotion is assumed. Treat it as an archived product option, not current work.
- The native Linux parity cases remain recorded failures. Taproot node `ief1zTKxrrVa8k` keeps them open; no new parity run or performance measurement was performed.
- GitHub run logs were unavailable (HTTP 502), so Finding 7's failure cause remains unknown.
- The current private preview and CURRENT5070 were not restarted, reconfigured or modified. PID 592057 on HTTPS5065 remains the accepted transform-release candidate.
