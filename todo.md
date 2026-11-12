# Deferred WebOrca work

Source: [consolidated audit](wasm/reports/codebase-review-20261111.md). These items await separate implementation and qualification.

- [ ] Skip unnecessary containment projections for already-disabled instances; investigate conservative bounds and per-slice reuse. Verify equivalent eligibility and cancellation behavior; containment cancellation is already implemented.
- [ ] Investigate retained Print and incremental reslicing. Establish invalidation rules, output equivalence and memory checks.
- [ ] Show each plate as current, needing reslicing or having no output; verify transitions after edits and slicing.
- [ ] Explain which out-of-bed objects were skipped, with identifiable objects and a corrective action.
- [ ] Give readiness messages direct corrective actions; verify each action resolves its stated blocker.
- [ ] Review printer, material, plate and estimates beside export/send; verify the summary matches the chosen output.
- [ ] Retain per-plate outputs and selectively reslice invalidated plates; verify output provenance and invalidation.
- [ ] Evaluate and selectively port BatchZIP, QuickSettings and OutputReview from [archived experimental/canvas-first-ui at 0e178a4f](https://github.com/nozamdavid/weborca/tree/0e178a4fbe). Validate each chosen behavior independently before promotion.
- [ ] Repair stale mobile wizard tests/config; verify the supported mobile flow.
- [ ] Reconcile conflicting release documentation against the actual served candidate and its evidence.
- [ ] Qualify native/WASM output parity and slicing speed with matched inputs and repeatable measurements.
- [ ] Qualify physical-printer and provider lifecycle behavior with actual devices/accounts.
- [ ] Complete Firefox, Safari and physical-device coverage; record supported behavior and remaining limitations.
- [ ] Qualify hosted CI and cold dependency reproducibility; Docker delivery is verified in the [publication and rollback receipt](wasm/reports/docker-arcane-publication-20261111.md).
