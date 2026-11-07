# Local v2.5 integration tracking receipt

Combined startup publication, 2026-11-07: CURRENT5070 serves
`/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1/wasm/build/ui-v250-startup-release-20261107`
with the updated frozen source server. The [combined report](startup-publication.md)
records cache-enabled public desktop/mobile startup, truthful percent, early
Prepare, slice/Preview, exact artifacts and rollback to the previous v2.5 release.
Taproot version **84 → 85** adds completed/collapsed
`v250_startup_publication_20261107`, updates root/shipped notes and metadata, and
recursively collapses fully completed branches. Existing open qualification and
main-promotion statuses remain. Receipts are in
`wasm/build/v250-startup-publication/taproot-*.json` in this worktree.
No commit, push or main change was made. The following receipts are historical.

Publication update, 2026-11-07: CURRENT5070 now serves immutable
`wasm/build/ui-v250-release-20261107`. The [publication report](publication.md)
records public acceptance, exact hashes and rollback. Taproot version 83 → 84
adds completed/collapsed `v250_publication_20261107`, updates the shipped pointer
and leaves main promotion and qualification open. The original local checkpoint
receipt below records the earlier state; publication made no commit or push.

Date: 2026-11-07. Scope: existing-browser integration and local validation on
`t3/merge-upstream-v250-foundation`, following signed foundation
`709ff3ecd09824b4f2bd3a78f398c3a038811243`.

This receipt is included in the signed checkpoint; identify that commit with
`git log -1 --format=fuller -- docs/v2.5.0-integration/tracking.md` and verify
with `git verify-commit HEAD`. Its own hash is deliberately not embedded here.
Author and committer: `nozamdavid <davidmarcosg98@gmail.com>`, signed using
the existing GitHub SSH key. No attribution trailers are added.

The [summary](README.md) binds the accepted reports and ignored local candidate
manifests. Only documentation, link, scoped whitespace and Git object/diff
checks are performed during finalization; prior builds/tests are retained as
reported evidence. Source/tests from the coordinated batch are checkpointed
without further product modifications. Runtime state, dependency symlinks,
ignored reports, binaries and secrets are excluded from the index.

After committing, record the final commit as evidence in one atomic Taproot
milestone update at [WebOrca](http://192.168.0.199:8789/p/YPttwK6VZASSDf),
project `YPttwK6VZASSDf`. The direct configured tools are unavailable to this
client; use the documented authenticated HTTP MCP fallback. Add branch
`v250_integration_20261107` and completed local milestone
`v250_local_validation_20261107` with report/manifests/metrics and commit evidence.
Keep promotion/deployment, native/WASM and OCCT parity, Firefox/physical browser
and hardware acceptance, and new browser features open. Collapse completed
subtrees recursively, preserving unrelated completion states and the current
shipped pointer. The final response records the confirmed update result and SHA.

CURRENT5070 remains `wasm/build/ui-background-engine-release-20261107`.
Original checkout `AGENTS.md` user preferences are preserved; no main switch,
merge, push, deployment or live change is authorized by this receipt.
