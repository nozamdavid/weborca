# Stitch grid storage cost — 2026-11-08

Decision: retain the production small-vector header. The single contiguous indexed-chain alternative preserves output but does not demonstrate a speed benefit or no harm. No production code/test changes, deployment, commit or push were made by this investigation. Native-speed parity remains open.

## Candidate and mechanism

Private evidence: `wasm/build/stitch-grid-cost-20261108/`. Three private source trees retain the shipped unordered_multimap control (`old`), current production small_vector (`small`) and indexed chain (`chain`). The chain uses `unordered_map<GridPoint, size_t>` plus one `vector<Entry>` reserved to `lines.size()*2`; Entry contains Index and next. `try_emplace` creates a cell head only when absent. Append links to the previous head; traversal follows indices newest first. SquareGrid neighbor order and geometry policy are unchanged. No global SparseGrid API change or allocation instrumentation was added.

Measured native and WASM sizes agree: Index 16 bytes; small_vector<Index,2> 56; old map value 32; small-vector map value 72; chain map value 24; chain Entry 24. These are value/entry sizes, not allocator or complete hash-node sizes. Existing insertion traces contain 204 single-endpoint, 106 two-endpoint and six three-endpoint cells: 316 cells, 434 endpoints, 112 duplicate cells. Small-vector avoids separate endpoint storage for 310 cells but still allocates hash nodes and spills for six cells. Chain reduces cell-value bytes from 22,752 to 7,584 plus 10,416 live endpoint bytes (reserved capacity follows each stitch's exact endpoint upper bound); buckets, allocator overhead and small-vector spill capacity are excluded. Smaller representation alone does not establish faster execution.

## Build and output gates

`build.sh` compiles both WallToolPaths.cpp and Arachne/utils/PolylineStitcher.cpp for each variant on native and WASM, replaces those members in private copies of the baseline archives, and links clean and timer engines. Copied libslic3r dependencies preserve relative includes. The recompiled small-vector clean and timer WASM hashes exactly equal the prior qualification, validating the control reconstruction. Final chain insertion uses try_emplace; `build-chain.sh` and `chain-build.log` record that final rebuild. Frozen original archives, live frontend and earlier evidence remain intact.

`tests.sh`: existing native_stitch_regression synthetic test passes native/WASM; all 34 saved-native stdout fixtures pass on each platform. No test expansion was needed. `sizes.sh` measures the layouts with the recorded native/WASM flags. Clean headed Helium normal Slice/Export passes the full tree and bracket comparison with the current qualified small-vector candidate: every executable command including M73, complete configuration and ordered saved vertices/triangles/transforms match. The three solid fixes therefore remain; original-native upper wall differences remain. Raw G-code hashes differ because comments include runtime information.

Executable hashes: tree `dd04eb31051d70340a93dac0af5d952e47a2ec2612d4c0c3f4bea558dc45c12e`; bracket `e0992f3ce802c0946f9da180c00ff16520c01637b13ad3c7142099f93f756734`. Both full configurations: `2ad0cc2b4df031c50fc13ffa58b7e3de2fbcf4460f2d751c13f67f4f6c46b2c6`.

## Stage measurements

Every build/link, timed batch and analysis holds exclusive `/tmp/weborca-parity-benchmark.lock`. Preview reported available:false; the authorized existing headed `/opt/helium/helium` driver was reused with the frozen frontend. Normal project import/Slice/Export, default auto/eight threads, fresh Print via reimport. Each condition has three sessions of one first slice plus four warm fresh recomputations: 12 warm observations. Orders: old/small/chain, chain/small/old, small/old/chain. No affinity or host settings changed. Host load averages at block starts: one-minute 16.05–17.21, five-minute 18.64–19.45, fifteen-minute 18.22–18.40; 32 logical CPUs on 16 physical cores. These cores were not isolated.

An initial partial session stopped at a login-dialog timeout before chain import; it is retained under `partial-login-timeout` and excluded. A private driver copy adds one retry for that login action. Engine binaries were reused. All 45 exports from the restarted batch match bracket commands including M73 and complete config. Drivers close their browser profiles; server traps close the owned server. No other task's harness/report was edited.

Warm medians [min–max], ms:

| Variant | Perimeters | Prepare boundary | Infill | Entire aligned Print region |
| --- | --- | --- | --- | --- |
| Old | 37.257 [34.570–38.910] | 17.045 [16.060–18.465] | 24.163 [21.620–26.420] | 86.098 [81.010–91.260] |
| Small-vector | 37.198 [36.180–40.100] | 16.998 [16.055–19.275] | 24.098 [21.640–26.455] | 86.793 [82.545–92.905] |
| Chain | 38.163 [35.655–40.350] | 17.595 [16.290–32.435] | 24.343 [22.225–28.755] | 88.805 [83.495–108.445] |

The existing checkpoints are after slice, perimeters, prepare_infill and infill. Prepare boundary includes estimate_curled_extrusions and intervening orchestration; it is not a pure prepare_infill function timer. Region is entire aligned Print::process, not application wall time or export time.

Chain minus small-vector paired pass-position median differences [range], ms:

| Session | Perimeters | Prepare boundary | Infill | Region |
| --- | --- | --- | --- | --- |
| 1 | 2.945 [0.255,3.766] | 0.155 [-1.130,1.290] | 0.212 [-0.615,2.390] | 2.765 [0.965,7.435] |
| 2 | -0.507 [-1.790,0.640] | -0.055 [-2.010,14.160] | -0.510 [-3.970,2.300] | -0.360 [-6.145,15.540] |
| 3 | 0.678 [-2.185,3.385] | 0.520 [-0.915,2.840] | -0.378 [-2.255,4.890] | 1.160 [-2.085,8.940] |

Old to small-vector paired region differences are 0.025 [-4.550,2.525], 2.195 [-3.930,8.630], -0.360 [-4.105,2.025] ms. All stage block medians and paired ranges are retained in `results.json`. Conditions are sequential blocks; host drift and correlated observations preclude precise causal or confidence claims. Chain's smaller storage yields no clear benefit here; pooled perimeters and region are higher and session signs vary. This evidence does not qualify chain for production.

Reanalysis of the prior default qualification's 21 warm observations per condition resolves the previously unexamined stages: old/small-vector medians are perimeters 37.025/37.955, prepare boundary 17.050/17.305, infill 23.600/25.075, region 85.480/88.405 ms. Infill has the largest stage median difference (+1.475 ms); perimeters +0.930 and prepare boundary +0.255 ms. Medians are not additive. Infill ranges are 20.685–26.560 versus 21.660–40.590 ms. Thus the old 2–3 ms region concern cannot be dismissed by perimeter results alone. These direct consumers can affect infill, but timings do not identify the specific function causing that difference. The new small-vector/control batch has closer stage medians and +0.695 ms region difference; this does not erase historical uncertainty or prove zero overhead. No further sweep was run.

## Review identities and reproduction

| Variant | Header SHA256 | Clean WASM SHA256 |
| --- | --- | --- |
| Old | `59db36d2f24e174b2d6b17877a88d39e1a05be4527926845902e2fbe8e232ea6` | `452c0ab51a0b935f691384e629d73ad0005fda99733b059d18cc600c0d4c1f19` |
| Small | `4ed34af4dac628a7db21a7f08371ed7060095019ab74d0c8d7a445d6b470414e` | `2c19bf098841bb23a13b6d160c73a8b9866b616322a22d2e5812a9482cb40a18` |
| Chain | `620a98b1f94f28f4a138cc049c1c164f3138a4e44ea9bd8838558928a4e27e76` | `732af0e922c393906ff395bc55e68535370272275fbc5074a970662b15e5a30c` |

Final chain timer WASM: `b7af1f2bb44535e3f0127adfd2fe43656e624c55716cf2eb4b03d45eb18e6381`. Per-variant hashes.txt retains every engine identity. The production header still hashes to the Small row. Compile/link logs and scripts retain exact flags. Reproduction entrypoints are build.sh, build-chain.sh (final chain), tests.sh, sizes.sh, run.sh, retry.sh and analyze.mjs; preserve existing output destinations before reusing them and run under the exclusive lock. Tests and shell/JS syntax checks pass. The only tracked documentation changes owned here are this report, README.md and KNOWLEDGE.md. Ignored variants and evidence are retained for parent review.

Taproot receipt tracking-receipt.json records version 108 and completed node stitch_grid_cost_20261108. Recursive completed-subtree collapse found zero further branches (collapse-ops.json).
