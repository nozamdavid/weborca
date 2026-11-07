# Local v2.5 integration tracking receipt

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
