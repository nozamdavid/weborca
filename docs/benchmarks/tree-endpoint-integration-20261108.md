# Tree endpoint production integration — 2026-11-08

The production change adds six lines to `src/libslic3r/PerimeterGenerator.cpp`. For one fully supported open clipped path with two distinct endpoint keys, it selects the last endpoint, matching the original native traversal verified in [the upper wall investigation](tree-upper-wall-cause-20261108.md). The preexisting supported-endpoint preference and canonical coordinate fallback remain intact for every other topology. No height, coordinate, material or sample-specific condition is introduced.

With one path, two map keys imply distinct ends, each inserted once. Both map flags must be supported. An overhang path fails those flags; coincident ends produce one key; multiple paths fail the path-count guard. Closed extrusions never enter this branch. The unchanged fallback handles these cases. This is a bounded native compatibility policy, not general unordered-map emulation.

## Regression boundary

The choice is inside the internal `traverse_extrusions` implementation. Extracting a public selector solely to test this six-line change would broaden production scope. A unit test copying the condition would not exercise the clipping/chaining call site. Therefore the regression gate is the real full application original-STL replay, compared to the actual desktop GUI export, including M73. The original sample and desktop oracle are external ignored fixtures; this is not a portable permanent CI fixture. The existing native endpoint helper exercises real chaining as supplemental independent evidence, not a production selector test. Overhang/zero-length/multiple-path exclusions above are structural review evidence, not claimed runtime unit coverage.

## Build and capture provenance

Ignored evidence: `wasm/build/tree-endpoint-integration-20261108/`. `build.sh` compiles the actual production `PerimeterGenerator.cpp` for native clang and WASM using each original compile database's flags, changing only the output object destination. It copies the immutable clean native/WASM archives from [stitch qualification](native-stitch-qualification-20261108.md), replaces only `PerimeterGenerator.cpp.o`, and links a private engine. No product source copies or diagnostic probes enter this candidate. The frozen full frontend is `wasm/build/v250-export-align/candidate`; only its engine pair is replaced. No frontend rebuild is needed.

`inputs.sha256`, `qualified-build.sha256`, the per-platform compile scripts/logs and `wasm-link.sh` record source, object, archive and link provenance. The qualified stitch header hash is `4ed34af4dac628a7db21a7f08371ed7060095019ab74d0c8d7a445d6b470414e`; this archive policy is deliberately independent of the concurrently edited cost candidate. Current header identity is recorded separately. PerimeterGenerator does not include the stitch implementation header.

All compilation, linking, slicing and comparison runs acquire exclusive `/tmp/weborca-parity-benchmark.lock`. The preview tool returned `available:false`; the authorized existing driver uses headed `/opt/helium/helium` and normal import, Keep original, preset selection, arrangement, Save project, Slice and Export. Private auth state is excluded. These runs establish no speed result; native-speed parity remains open.

## Reproduction

The native private-archive link also passes (`native-link.sh`, `native-link.log`, `native-replay`). It forces inclusion of `_ZN6Slic3r18PerimeterGenerator15process_arachneEv`; `nm` confirms that symbol in the resulting executable, so this checks the modified perimeter object's actual link dependencies. Existing TBB LTO warnings remain. The helper executable is supplemental link evidence, not the GUI oracle.

The pre-fix qualified-stitch tree fails the original-GUI executable assertion with **79 differing positions** (`red.log`). After the production patch, fresh clean headed Helium export matches **all 1,373,125 original-native executable commands including M73**, SHA256 `4a1e0166df5e9ddbcff33a77988bc380a86cff4c63c679c0c34b71578f394fab`. Complete baseline config and ordered saved vertices/facets/component/instance matrices are retained. The normal shared-project bracket retains **all 70,860 baseline executable commands including M73** and full baseline config (`result.json`). The supplemental native chaining fixtures pass at layers744/748 (`fixture-result.txt`).

Native and WASM production TU compilation and the clean WASM link pass. Candidate engine pair: `wasm/build/tree-endpoint-integration-20261108/engine/`; WASM SHA256 `df6c8b6aae6fd8ba1558bcff09c79240de45bd6d3728ddfbfc135096021d7d4a`. Full frozen app: `wasm/build/tree-endpoint-integration-20261108/J/app/`. Tree capture: `J/ui/`; bracket capture: `bracket/ui/`. `check.mjs` asserts the exact native command gate, baseline config, saved geometry and bracket preservation. This ignored capture checker is integration evidence, not a new mirrored unit test. Shell/JS syntax and scoped `git diff --check` pass. Owned server/browser sessions close and private per-run auth state is removed after capture.

Run from this worktree, preserving existing capture destinations before repeating:

```sh
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/tree-endpoint-integration-20261108/build.sh
flock /tmp/weborca-parity-benchmark.lock sh -c 'cd wasm/build/orca-v250-native-clang && bash ../tree-endpoint-integration-20261108/native-link.sh'
flock /tmp/weborca-parity-benchmark.lock bash wasm/build/tree-endpoint-integration-20261108/qa.sh
git diff --check -- src/libslic3r/PerimeterGenerator.cpp
```

The historical C engine's zero-effect contradiction remains unresolved pending artifact provenance, as preserved in the upper-wall report. New counterfactual and production integration evidence do not retroactively prove those historical C captures. Six original-native GUI configuration state differences remain; executable equality must not be reported as raw G-code byte equality or full native state parity. Parent coordination owns the final stitch-cost combination, final QA, central documentation and tracking. No deployment, commit or push is part of this integration.
