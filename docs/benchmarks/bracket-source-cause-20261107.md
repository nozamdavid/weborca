# Bracket source causal controls — 2026-11-07

Controlled WASM variants establish that the two `connect_infill` sorts affect some bracket connectors, but restoring upstream `sort` does not reproduce native overall. Restoring upstream random mapping changes solid/bridge paths and leaves the existing wall and sparse-infill discrepancies intact. Neither operation explains the wall traversal difference. These experiments do not establish a slicing correctness bug.

## Controls and provenance

Continuation of [the prior report](toolpath-cause-20261107.md), using its fixed web-saved `input.3mf`, SHA256 `a010c0e496d57b5e7259d452493b4ef52caabcef9e399e321b0cd3c4b022a6cc`. Native reference is its `native-project/plate_1.gcode`, produced by installed Flatpak source commit `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`, executable SHA256 `9c42194b612e85b29ec269124d8f1b83d768f3e8a3dfdfb65e26625942e947cc`. Checkout HEAD is `60ec673eba54d4eb64ead491d7cf122fc3dae839`. Prior identical serialized geometry/settings controls remain applicable; internal native geometry was not newly instrumented.

New ignored evidence root: `wasm/build/bracket-source-cause-20261107/`. No product sources, earlier harness/report, README, Taproot, immutable candidate or original objects were changed. No integrated UI build, deployment, commit or push occurred.

`build.sh` extracts the existing compile commands from `orca-v250-wasm64/compile_commands.json` and saves per-variant `compile.sh`. Only copied `FillBase.cpp` (A) and `FillRectilinear.cpp` (B) are compiled, using original flags plus the original Fill directory for relative includes. Each variant copies `liblibslic3r.a`, replaces only its assigned object using `emar r`, then links existing dependency objects. `link-original.sh` is the saved Ninja link command; per-variant `link.sh` changes only the archive and output locations. Both translation units compiled and all three links succeeded. No incompatible dependency rebuild was needed. Logs retain compiler/linker warnings about MEMORY64 deprecation and pthread memory growth.

The baseline re-link is byte-identical to the shipped JS/WASM pair, establishing compatibility of the reused object set. All three JS hashes are `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7`. WASM hashes:

| Engine | SHA256 |
| --- | --- |
| Baseline | `452c0ab51a0b935f691384e629d73ad0005fda99733b059d18cc600c0d4c1f19` |
| A: two sorts | `af09b9c31019fe88a12e71aa51c264075527d15950674a61c210a4fe093572f0` |
| B: random mapping | `cd370458a5815ad38445d8c644edcd348a42489250cbab57f7dcd0e3f90e5bfd` |

Each `app/` is a copy of the frozen shipped UI/profile candidate. Directory comparisons show only engine WASM differs between variants. Candidate manifest validation passed (`candidate-integrity.log`); original source/archive hashes still validate (`source-baseline.sha256`). Source deltas are preserved in `A/source.patch` and `B/source.patch`. B removes only `Random.hpp` and restores the upstream distribution expression; `<random>` was already included, as upstream requires.

T3 preview reported `available:false`. The new env-configured `driver.mjs` copies the prior driver and uses headed `/opt/helium/helium`, fresh isolated profiles, normal project-file input, Save project, Slice Plate 1 and File → Export G-code. It observes worker messages but calls no engine API. Private port 5086 served one variant at a time with separate private alpha state. Sessions and the owned server were closed. Authentication state is excluded from this report.

Reproduction commands from the worktree root (existing output destinations must first be archived):

```sh
bash wasm/build/bracket-source-cause-20261107/build.sh
# For each variant: baseline, A, B; serve its frozen app copy separately.
bash wasm/build/bracket-source-cause-20261107/serve.sh A
APP_URL=http://localhost:5086 \
OUT=wasm/build/bracket-source-cause-20261107/A/ui \
SAMPLE=bracket.3mf \
INPUT_PATH="$PWD/wasm/build/sample-parity-cause-20261107/ui-project/input.3mf" \
node wasm/build/bracket-source-cause-20261107/driver.mjs
node wasm/build/bracket-source-cause-20261107/compare.mjs
```

## Measured effects

The new baseline UI export matches the previous shipped bracket replay's executable commands **including M73** (`baseline/executable-control.txt`). Raw hashes differ because comments differ. Its 51,797 ordered deposition segments match exactly. Comparator self-checks and new script syntax checks pass. These full-app replays are the focused behavioral checks for the compiled changes.

`comparisons.json` records multiplicity-aware segment comparisons, directed ordered paths including E, per-layer/role counts, E totals and representative differences. `summary.json` provides a compact view. All native/variant and baseline/variant comparisons below differ even after comments and M73 are removed.

| Comparison | Deposition segments, left/right | Differing segment keys, left/right |
| --- | ---: | ---: |
| Native / baseline | 51,789 / 51,797 | 98 / 106 |
| Baseline / A | 51,797 / 51,800 | 69 / 72 |
| Native / A | 51,789 / 51,800 | 113 / 124 |
| Baseline / B | 51,797 / 51,801 | 206 / 210 |
| Native / B | 51,789 / 51,801 | 304 / 316 |

A affects sparse infill at Z=0.8, 1.8, 3.2, 5.2, 9.4, 10, 10.2, 10.4 and 10.8. Internal solid infill at Z=10.8 changes directed order/E sequence with the same segment multiset. Every wall's directed sequence and E remains identical to baseline. Native's original first wall divergence at Z=0.4 therefore remains unexplained by this operation.

A makes the complete directed sparse-infill group match native at Z=1.8, 5.2 and 10.4 (these groups disappear from native/A differences). Thus the sort operation is causally responsible for those observed differences under this control. At Z=1.8, all sides have 96 segments and summed E=10.68199; baseline/A has 16 differing keys, identifying connector choice rather than missing segment count or total E. A also creates discrepancies at other layers and worsens overall native agreement. At Z=10, baseline/A counts are 102/107 and E totals 11.76043/11.77108: this operation can affect path count and extrusion, not just traversal.

B affects bottom surface Z=0.2; bridges Z=8.4, 34.6 and 41; internal solid infill Z=44.6 and 44.8; and top surface Z=45. It changes no wall or sparse-infill directed segment/E group. Bottom surface counts are 254/258 and E=47.22550/47.22324; top surface retains all segment keys and E=8.67107 while traversal changes. This experimentally rejects this random-mapping call as the cause of the existing wall/sparse-infill discrepancy for this bracket. It demonstrates that the operation is active and affects other features.

No combined variant was needed: the isolated controls do not remove separate components of the original discrepancy. Combining them would not isolate the unresolved wall cause.

## Intent and interpretation

[Merge foundation](../v2.5.0-integration/merge-foundation.md) explicitly retains stable sorting for arc costs and contour candidates to preserve portable tie order while keeping upstream's join-count algorithm. [Semantic review](../v2.5.0-integration/core-semantic-review.md) documents the same policy. `Random.hpp` explicitly defines the GNU libstdc++ Lemire mapping to avoid platform-dependent distributions. `tests/libslic3r/test_random.cpp` contains fixed cross-library draw fixtures, rejection/boundary cases, consumed-draw checks and shuffle fixtures. Those tests were inspected, not rebuilt or claimed as newly passed. The focused experimental check here is actual-app slicing with each changed translation unit compiled and linked.

Restoring `std::sort` permits implementation-dependent equal-cost ordering; matching three native groups does not prove universal native parity. Restoring `std::uniform_int_distribution` reintroduces library-dependent mapping and draw consumption; upstream expression equality is insufficient to guarantee cross-platform paths. The current bounded mapping intentionally preserves GNU behavior, while the installed LLVM21 manifest alone does not identify every native standard-library detail.

Retain the intentional determinism policies. No measured result justifies a product correction or reverting them. If exact cross-platform paths are a requirement, the appropriate correction would require a separately specified canonical ordering/mapping policy shared by both builds, with geometry and extrusion invariants checked; copying one library's incidental ordering is insufficient. The wall traversal cause remains open in another operation, and the remaining connector discrepancy is not fully attributed. These controls establish neither print-quality harm nor equivalence of deposited volume.

Comparator limits from the prior report remain: 0.001 mm endpoint quantization, no collinear merging, linear positive-E deposition only, direction ignored for segment keys but retained in the new group checks, and emitted E totals are not a physical volume proof. Single new UI replay per variant was used; prior same-side repeatability evidence was reused. Tree residuals, other fixtures and performance suites were outside this task.
