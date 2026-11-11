# Installed OrcaSlicer / Helium WebOrca sample comparison — 2026-11-07

## Follow-up — 2026-11-07

Completed subsequent controls refine the initial baseline below; they do not establish full configuration or toolpath parity:

* [Preset metadata investigation](preset-metadata-parity-20261107.md) traces the seven exported metadata differences to CLI-versus-GUI configuration assembly. [Installed desktop GUI verification](desktop-gui-metadata-20261107.md) confirms **all seven match** the actual installed desktop GUI using the exact source presets, including inherited vendor files. Six other project-state keys still differ: bed type/first-layer bed temperature, AMS/nozzle state, and wipe-tower X/Y. Full exported configurations do not match.
* [Toolpath causal checks](toolpath-cause-20261107.md) reproduce the bracket discrepancy with matching serialized mesh vertices, triangle indices/order and transforms, and matching substantive exported fields except four bookkeeping fields and thumbnail-list formatting. Wall segment sets match while traversal differs; sparse-infill connectors differ. A one-thread web replay matches the default-thread output. These controls do not prove internal native geometry or full configuration-byte equality.
* The same toolpath report shows that import/project normalization dominates the tree's original −2165.54199 mm travel gap. Shared-project input reduces it to −7.61358 mm; replaying the native-normalized project reduces it to **+0.02328 mm** (web minus native). Executable outputs still differ. No exact normalization operation or complete per-layer geometry equality was isolated.
* [Bracket source causal controls](bracket-source-cause-20261107.md) show that variant A, restoring two upstream sorts, makes three complete sparse-infill layer groups match native (Z=1.8, 5.2 and 10.4) but worsens overall agreement. Variant B, restoring upstream random mapping, affects solid/bridge/surface paths only and rules out that call for the original wall/sparse-infill discrepancy. The intentional determinism policies are retained.
* [Wall traversal control](wall-traversal-cause-20261107.md) confirms that the original bracket wall-direction differences arise from WebOrca's supported-endpoint coordinate ordering versus upstream's unordered-map iteration. Incoming state matches before the first choice. Restoring only upstream endpoint selection resolves the original Z=0.4 and Z=12.4 direction differences but introduces another at Z=12; wall segment multisets and sparse-infill sequences remain unchanged. Retain the intentional endpoint policy. The earlier wall-cause-open conclusion is superseded; remaining sparse connectors and small E-only wall differences remain unresolved. [KNOWLEDGE.md](../../KNOWLEDGE.md) is the central findings and decisions entry point.

No product bug or product fix is confirmed, and no deployment resulted. The investigation milestone is complete; strict parity remains open. The measured benchmark and initial observations below are preserved as the historical initial baseline, separate from these subsequent controls.

## Historical initial baseline

Actual WebOrca UI runs now replace the earlier worker-only assessment. Three STLs complete import, preset selection, Slice and Export. Both 3MFs reach the normal project path and then fail validation; neither is a missing-project-support result. Strict native/web toolpath parity is **not established**.

The old `sample-benchmark.mjs` synthetic page and all of its worker runs are excluded from web app results. Its historical report is retained in the ignored evidence directory as `helium-ui/superseded-worker-report.md`. A native probe preflight reused the historical `2-0-native` warmup destination; that legacy warmup was superseded and is excluded. Final actual trials use separate destinations. No product fixes, deployment, commits or pushes were made.

## Actual app workflow and coverage

Headed `/opt/helium/helium` reports Helium 0.20.3.1, Chromium 156.0.8078.79. Each invocation uses a fresh temporary profile on display `:0`. Recorded GPU: ANGLE / AMD Radeon RX 9070 / radeonsi gfx1201 ACO / OpenGL 4.6. Helium reports hardwareConcurrency=12; the application uses its default eight slicing threads. Native threading stays at the installed default; active native worker count was not measured. Host: Ryzen 9 9950X3D, 16 cores / 32 logical CPUs. Services, CPU frequency and affinity were not isolated.

The harness drives the real `#project-file-input` for projects, `#model-file` for STLs, preset selects, visible `Slice Plate 1` button and File → Export G-code download. It passively observes app worker messages to capture configuration, object/plate data and progress; it never invokes engine/import methods. High-triangle imports choose **Keep original** in the normal Simplify Mesh dialog. Initialization, import, settings and downloads occur outside the process timers. Every STL side has one warmup plus three fresh trials, executed sequentially. Each original input has one plate; all source plates were attempted.

Shipped app runs used the authenticated public URL `https://server-1.barbel-hops.ts.net:5070`. After HTTP 429 during repeated sign-ins, the last tree/lily shipped trials used `http://localhost:5081`, serving the exact frozen candidate with private alpha state. Benchmark instrumentation uses the same full app assets at `http://localhost:5082` with only its engine module replaced. The private benchmark server was restarted once after its own login limit. Failed startup, recovery-dialog, hidden-button, late simplification-dialog and recorder-serialization attempts are excluded. Reusing authentication cookies alone caused an engine-fetch 403; that attempt is also excluded and cookie reuse was removed.

## Timings

Milliseconds, median [minimum–maximum] of trials 1–3; trial 0 is warmup.

| Input | Installed native logged slicing region | Benchmark-only web `Print::process` |
|---|---:|---:|
| Corner bracket | 39.4 [38.6–39.8] | 228.2 [223.8–233.0] |
| Ribbed Christmas Tree | 808.3 [804.5–809.5] | 2050.0 [2029.2–2060.5] |
| Lily | 561.4 [551.5–565.5] | 1129.0 [1124.2–1144.3] |

These columns have different boundaries: native measures the region between Print.cpp's `Starting the slicing process.` and `Slicing process finished.` messages; the former occurs after the function's setup. Web measures the entire `print.process()` call. Consequently no exact native/web function speed ratio is claimed. Native excludes the prologue preceding its first marker. Neither column includes G-code export or printer-estimated time.

The installed native executable is unchanged. `log-probe.so` interposes C++ file-buffer insertion (`basic_filebuf<char>::xsputn`), timestamps the two messages with CLOCK_MONOTONIC **before** buffered disk writes, and forwards every original insertion. `native-trace/writes.log` establishes why untimestamped buffered logfile arrival cannot itself supply precise boundaries. Source locations are `src/libslic3r/Print.cpp` and `set_logging_file` in `src/libslic3r/utils.cpp`; the latter's simple file sink differs from the separate auto-flushed GUI logging setup. A synthetic 10,000-pair file-buffer check measured 0.030 µs/pair without the probe and 0.552 µs/pair with it, approximately 0.52 µs added. This is a host microbenchmark, not a Flatpak-runtime worst-case bound. Per-trial original logs and monotonic markers are preserved. Clock resolution is not the same as end-to-end accuracy; values are rounded to 0.1 ms.

Web timing comes from a **temporary benchmark-only instrumented build**, not the shipped artifact. An ignored copy of Engine.cpp adds two steady-clock reads immediately around `print.process()` and returns `benchmarkProcessMs`; export follows afterwards. The affected translation unit and module link succeeded using the existing build's compile/link commands and dependency objects. Product source was not modified. Two clock reads add uncalibrated small overhead; no sub-millisecond accuracy claim is made. No comparator or other benchmark ran during final timed phases.

Every one of the twelve instrumented STL outputs matches its corresponding shipped-app output in executable commands and effective exported configuration. Timestamp-normalized whole-file equality fails because the UI-generated PNG thumbnails vary. Removing only those thumbnail blocks in addition to the generated timestamp gives identical text for all twelve pairs. Raw and timestamp-only hashes remain separate in `actual-comparison.json`. This validates output consistency for these samples, not arbitrary projects or equivalence of all build inputs.

## Native versus shipped-app output

All deltas are web minus native. The three measured trials have identical command counts and aggregate deltas; byte counts vary with embedded thumbnails.

| Input | Native / web layers | Net T0 extrusion delta (mm) | Linear travel delta (mm) | Extruding path delta (mm) | Native / web executable commands |
|---|---:|---:|---:|---:|---:|
| Corner bracket | 225 / 225 | −0.11090 | −7.92406 | −3.33626 | 70,849 / 70,860 |
| Ribbed Christmas Tree | 750 / 750 | +0.01365 | −2165.54199 (−2.52425%) | +0.67283 | 1,373,096 / 1,373,125 |
| Lily | 500 / 500 | +0.00733 | −8.50412 | −0.04909 | 469,250 / 469,776 |

All raw, timestamp-normalized and executable-command hashes differ between native and the shipped app. File-size deltas range +28,885–29,082 B, +42,582–42,645 B and +70,072–70,155 B respectively. Native/app printer estimates are 29m46s / 29m46s, 6h8m8s / 6h8m1s, and 1h32m34s / 1h32m43s. These are printer estimates, not slicing durations. The actual app tree travel result materially differs from the previous worker-only observation.

Command bounds match: bracket X/Y 0–172.3, Z 0–45.4 mm; tree X 0–195.651, Y 0–195.652, Z 0–150.4 mm; lily X 0–186.476, Y 0–186.741, Z 0–100.4 mm. These include startup moves. Original STL geometry is retained, import/placement records are captured, and neither side scales the models. Matching bounds and aggregates do **not** prove identical geometry, complete affine-transform equivalence, painting preservation or per-layer paths. Executable differences include progress ordering and coordinate/path differences; no root cause is assigned.

STLs select Voron 2.4 300 0.4 nozzle, 0.20mm Standard @Voron and Generic PLA @System. Native uses the original resource preset-loading path plus `--extruder-colour '#26A69A' --filament-colour '#26A69A' --flush-volumes-vector '140,140'`. This reconciles the two colours and flush-vector length from the prior ten differences. Exploratory copied/flattened-preset attempts are excluded because they either failed resolution or introduced additional differences.

The initial CLI-versus-web baseline recorded seven exact residual exported-config differences for all STLs (subsequent source traces and desktop GUI controls are linked above):

| Key | Native CLI | Web | Initial interpretation / limit |
|---|---|---|---|
| compatible_machine_expression_group | `;;` | absent | compatibility bookkeeping |
| compatible_printers_condition | empty | absent | compatibility bookkeeping |
| compatible_process_expression_group | `""` | absent | compatibility bookkeeping |
| different_settings_to_system | `;;extruder_colour` | absent | native override tracking |
| inherits_group | `;;` | absent | inheritance tracking |
| filament_multi_colour | absent | `#26A69A` | web-only colour metadata |
| filament_plugin_config_overrides | absent | empty | web-only empty override field |

These initial CLI/web configurations are not byte-identical. The original classification was based on names/use and empty values; subsequent reports trace the producers/consumers and verify all seven against the installed desktop GUI. Source/compiler/standard-library equivalence remains uncontrolled, so strict parity is not claimed.

## 3MF outcomes

Both original archives and their complete extracted project settings/model metadata are retained. No project data was stripped, flattened, rescaled or corrected to obtain a result.

* **Christmas ornament:** actual app project import restores embedded Bambu A1, 0.28mm Extra Draft, two Bambu PLA slots and plate instance/configuration records. Slice fails `Config validation failed: raft_first_layer_expansion: -1 not in range [0, 3.40282e+38]`. The native GUI original-file attempt reaches its embedded-preset checks and displays the same invalid 3MF parameter; screenshot `native-gui/main.png` records the error. CLI `--allow-newer-file`, `--load-defaultfila`, and explicit original A1 machine/process/two-filament settings still abort at `std::vector<std::string>::front()` asserting nonempty. These are distinct native CLI and validation failures.
* **Sylvanas:** actual app project import succeeds; Slice fails `Relative extruder addressing requires resetting the extruder position at each layer ... Add "G92 E0" to layer_gcode.` Native newer-file and explicit P1S/process/filament CLI attempts retain the vector-front abort. The explicit process/filament selection was exploratory and is not evidence of reconciled project settings.

No valid G-code or slicing-time comparison exists for either project. They have no successful four-trial timing matrix. Complete cross-side painting/override preservation remains unverified because validation prevents successful slicing. This does not establish a project-import feature failure. No product fix was attempted.

## Evidence and reproduction

Checkout `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`, HEAD `60ec673eba54d4eb64ead491d7cf122fc3dae839`; inputs `/mnt/appdata/workspace/OrcaSlicer/samples`. Evidence root: [wasm/build/sample-parity-20261107](../../wasm/build/sample-parity-20261107), actual runs under `helium-ui/`. Original `inputs.json` records sample hashes. `actual-comparison.json`, `actual-summary.jsonl`, per-trial `.gcode`, app event/config JSON, native command JSON/logs, browser/GPU metadata, instrumentation source/objects/compile/link logs, GUI screenshots and integrity checks preserve the evidence. Private alpha state and browser profiles contain session data and must not be published.

Installed user Flatpak com.orcaslicer.OrcaSlicer 2.5.0, flathub commit `e6c923c16c51c60d015167c442e4b1f387ce75e07f6e6dce19c8c3b124dd167c`, GNOME runtime 50. Installed binary SHA256 `9c42194b612e85b29ec269124d8f1b83d768f3e8a3dfdfb65e26625942e947cc`. Shipped candidate `wasm/build/v250-export-align/candidate`, WASM SHA256 `452c0ab51a0b935f691384e629d73ad0005fda99733b059d18cc600c0d4c1f19`; full candidate manifest passes after the runs. Temporary app roots reference those frozen assets; instrumentation replaces only the engine pair. The historical `/tmp/orca-native` binary is unused.

```sh
node --check wasm/tests/parity/helium-ui-benchmark.mjs
node --check wasm/tests/parity/native-ui-comparison.mjs
node wasm/tests/parity/sample-compare.mjs --self-check
# Requires the existing private alpha configuration; never print credentials.
SAMPLE='obj_1_Corner bracket.stl' TRIAL=1 node wasm/tests/parity/helium-ui-benchmark.mjs
# Native runner requires the retained, compiled benchmark log probe.
node wasm/tests/parity/native-ui-comparison.mjs
node --expose-gc wasm/tests/parity/analyze-helium.mjs
```

Reproduction overwrites matching trial destinations; archive existing runs first. Instrumented compile/link command files and the copied Engine.benchmark.cpp are under `helium-ui/instrumented/` and its parent; no product rebuild/deployment is needed for shipped UI trials. Syntax/comparator checks and benchmark-only C/C++ compilation pass. The probe source's unused-return warning was cleaned up and separately recompiled as `log-probe.checked.so`; measured trials retain the original `log-probe.so`.

Comparator limits: baseline normalization removes only the generated timestamp. Executable hashing removes comments/blank lines without tolerances/reordering. Signed per-tool E deltas respect M82/M83/G92; net E includes retractions. Linear lengths start at zero and cannot model physical homing/macros/firmware retraction. No compared file contains G2/G3; arc metrics would be null. No per-layer geometric equivalence or material-volume proof is implemented. `firstCommandDifferences` is an illustrative raw non-comment-line comparison and is not a geometric distance metric.
