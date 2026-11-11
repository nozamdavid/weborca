# Toolpath causal checks — 2026-11-07

The bracket difference survives shared-project replay with identical serialized mesh vertices, facet order and transforms. Its wall segment sets match, but traversal differs; its sparse-infill boundary connectors differ. The tree's large travel discrepancy substantially shrinks when native imports the WebOrca project instead of independently importing the STL. No single algorithm or compiler cause is proven. No product changes or rebuilds were made.

## Evidence and controls

All new runtime evidence is in `wasm/build/sample-parity-cause-20261107/` (ignored). Previous evidence is preserved. Full headed `/opt/helium/helium` runs use isolated temporary profiles, ordinary imports, preset selects, Slice and File → Export G-code. File → Save project captures the input before slicing. T3 preview_status reported unavailable. `diagnose-helium-ui.mjs` is a diagnostic copy of the existing UI driver; it never calls engine methods. Local port 5083 serves the frozen candidate through the existing server and a separate private alpha state. Private state must not be published.

`integrity.log` validates the candidate manifest. Engine WASM is the supplied `452c0ab51a0b935f691384e629d73ad0005fda99733b059d18cc600c0d4c1f19` artifact. Native executable hash remains `9c42194b612e85b29ec269124d8f1b83d768f3e8a3dfdfb65e26625942e947cc`. Samples are the unchanged originals under `/mnt/appdata/workspace/OrcaSlicer/samples`.

The deterministic red command, already executed with exit 1, is:

```sh
node wasm/tests/parity/diagnose-sample-parity.mjs \
  wasm/build/sample-parity-20261107/helium-ui/native-final-obj_1_Corner_bracket_stl-1/plate_1.gcode \
  wasm/build/sample-parity-20261107/helium-ui/trial-1/obj_1_Corner_bracket_stl.gcode \
  --assert-equal
```

It reports 51,789 / 51,797 deposition segments and 98 / 106 differing native/web segment keys. This is a captured actual-app differential loop, not a replacement engine harness. `bracket-control.json` preserves hashes and representative coordinates. Syntax checks for both new scripts and comparator self-checks (same, reversed/reordered, perturbed, unsupported arcs) pass. No C++/TS translation units changed.

Ranked predictions tested: effective settings should explain a discrepancy if it vanishes with shared project settings; independent import/placement should explain it if shared project geometry removes it; concurrency should explain it if one web thread removes it; comments/progress should explain it if executable and deposition comparisons match after filtering. Source/build behavior remains a candidate after these controls.

## Bracket: matched input still differs

`ui-project/input.3mf` is saved by the real web app after original STL import and preset selection. Native loads that exact file with `--arrange 0 --orient 0`, exports `native-project/input.3mf`, and slices with its original binary. Web imports the same saved project normally into a fresh profile (`ui-replay`). Commands are:

```sh
APP_URL=http://localhost:5083 TRIAL=ui-project SAMPLE='obj_1_Corner bracket.stl' node wasm/tests/parity/diagnose-helium-ui.mjs
flatpak run --user com.orcaslicer.OrcaSlicer \
  --datadir "$PWD/wasm/build/sample-parity-cause-20261107/native-project/data" \
  --slice 0 --arrange 0 --orient 0 \
  --outputdir "$PWD/wasm/build/sample-parity-cause-20261107/native-project" \
  --export-3mf input.3mf "$PWD/wasm/build/sample-parity-cause-20261107/ui-project/input.3mf"
APP_URL=http://localhost:5083 TRIAL=ui-replay SAMPLE=bracket.3mf \
  INPUT_PATH="$PWD/wasm/build/sample-parity-cause-20261107/ui-project/input.3mf" node wasm/tests/parity/diagnose-helium-ui.mjs
```

Reproduction overwrites these NEW destinations; archive them first. An initial absolute `--export-3mf` filename failed because native prepends outputdir; `run.log` retains that failure, `retry.log` is the successful command with a relative filename. A first UI Save locator was ambiguous; corrected successful runs use an exact locator. Earlier failed captures are excluded.

All three exported bracket mesh XML blobs have SHA256 `9f3a4adb5facba31bcb601b921ae1e8f6b4d779793cb1d0cfee4b0d03f0f57e3`: identical vertex values, triangle indices/order, not merely equal bounds. Component transform is identity and instance translation is `(150,150,22.5)` on all sides. Whole model XML hashes differ because of metadata; geometry transforms were inspected separately. `bracket-project-mesh-hashes.json` preserves hashes.

`project-replay-comparison.json` shows web STL versus project replay executable equality, and native versus web retains the exact 98/106 segment discrepancy. Effective exported values match except four native bookkeeping fields (`compatible_machine_expression_group`, `compatible_process_expression_group`, `different_settings_to_system`, `inherits_group`) and spacing in the thumbnails list. Full config maps are retained; this is not exact config-byte equality and does not independently prove bookkeeping irrelevance. The original seven-field issue is being investigated separately.

First ordered deposition divergence is at Z=0.4, Inner wall, index 538: native `(134.157,130.740) → (133.957,130.730)`, E=0.00928; web `(133.371,130.738) → (133.957,130.730)`, E=0.02676. Unordered wall segment keys match, identifying traversal/direction selection rather than missing wall segments. Every differing native segment key is Sparse infill, across 11 layers (`bracket-different-groups.json`). First is Z=1.8: native connects `(161.228,167.890) → (161.228,169.518)` while web connects `(161.228,169.518) → (161.228,171.147)`. These are different connector choices, not only start-G-code or progress placement.

`ui-one-thread` sets Preferences → Slicing threads to 1 through the real UI before importing the shared project. Its commands match default-thread web output (`one-thread.json`). This rules out web thread count for this bracket. Native has no advertised thread CLI option; native one-thread control was not obtained, and active native thread count is unmeasured. Prior four actual trials on each side have one unique executable hash per sample (`determinism.txt`), establishing same-side repeatability for those trials.

## Tree: import path matters

Original captures have 1,284,442 / 1,284,474 deposition segments, 9,500 / 9,532 differing segment keys and web travel −2,165.54199 mm. `tree-control.json` retains the first difference and examples; several wall differences are segmentation of otherwise similar lines, so counts are not missing-material counts.

`tree-project` repeats the original STL through the full frozen app and saves its project. Native reads that project with arrange/orient disabled (`native-tree-project`, same command structure as bracket). The travel difference becomes **−7.61358 mm**, native 83,631.65708 versus web 83,624.04350 mm (`tree-project-comparison.json`). Original native versus project-native config differences are only compatibility/override tracking, web colour/empty plugin metadata, and thumbnail spacing (`tree-native-original-vs-project.json`). Thus switching native's input route removes most of the original travel gap without changing the native binary or substantive exported settings. This does not prove that only transforms changed: the project route carries mesh representation and normalization too.

The tree mesh XML is not byte identical after native import/re-export. Web component translation is `(-3.81469727e-06,3.81469727e-06,0)` and native re-export is approximately `(-4.37499971e-15,4.37499971e-15,0)`; instance translation remains `(150,150,75.0000381)`. Therefore this is not a fully matched internal tree mesh control. At first differing ordered segment, Z=0.2 Inner wall, the same start `(170.784,184.624)` ends at Y=184.954 native versus 184.955 web, with identical E=0.0126. Small geometry rounding persists; connector ordering can amplify small changes. Attribution to rounding alone is unproven.

A further normal UI import of the native-re-exported tree project (`tree-native-replay`) reduces the travel difference to **+0.02328 mm**: native 83,631.65708 versus web 83,631.68036 mm. Executable hashes still differ (`tree-native-replay-metrics.json`). This further isolates geometry/project normalization as the dominant contributor to this sample's original travel discrepancy, without proving per-layer geometry equality or identifying the precise normalization operation. Every web result here comes from the full actual UI.

## Source provenance and remaining cause

Installed Flatpak `files/manifest.json` is captured as `native-manifest.json`. It identifies upstream source commit `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`, LLVM21, Release, GNOME SDK/runtime 50. Checkout HEAD is `60ec673eba54d4eb64ead491d7cf122fc3dae839`. `native-source-diff.patch` records two concrete relevant differences: `Fill::connect_infill` uses `stable_sort` in this checkout where installed source uses `sort`, and monotonic region selection uses `Random::uniform_bounded` where installed source uses `std::uniform_int_distribution`. These map to observed connector/traversal behavior, but no variant build was performed and the frozen binary's individual object provenance was not independently recovered. Neither a generic toolchain explanation nor these source changes are a proven single cause.

Next exact discriminating check: in a separately authorized diagnostic build, hold the bracket saved project and all settings fixed, build native at the manifest commit with only the two `connect_infill` sort calls changed to the checkout's stable_sort, and run the saved-project command above. Compare Z=1.8 sparse-infill connector keys first. A separate variant should change only the random mapping and inspect Z=0.4 traversal. For tree, extract ordered mesh vertices/indices plus component/instance matrices immediately after load for the completed native-normalized replay; export evidence alone prevents claiming matched internal inputs. Trace its residual +0.02328 mm through layer/role segmentation before attributing it to rounding or algorithms.

## Metric limits

The comparator groups positive-E linear segments by emitted Z layer and role, ignores direction and ordering, and counts multiplicity. Coordinates are rounded to a 0.001 mm grid; this is quantization, not a rigorous distance-within-tolerance matching algorithm. It does not merge collinear subdivisions or compare deposited volume; direction reversal, splitting and shifted geometry must be distinguished using the representative moves. It preserves raw hashes separately and removes comments and M73 only for a labeled structural hash. Arcs, relative XYZ, inch units and multiple tools are explicitly unsupported. Startup extrusion is excluded from deposition segment comparison. These samples use relative E with layer resets; homing/firmware macros are not modeled. No painting was altered; the controlled fixtures are STLs without painting. Invalid original 3MFs and lily were not rerun.
