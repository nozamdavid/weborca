# Original desktop GUI tree comparison — 2026-11-08

This check compares the installed original desktop GUI's unchanged STL import with the prior full headed Helium original-STL capture. No project was reopened before the desktop slice. Results and evidence limits follow below.

## Procedure and provenance

Worktree `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`; evidence [desktop-tree-parity-20261108](../../wasm/build/desktop-tree-parity-20261108/). The reference is user Flatpak `com.orcaslicer.OrcaSlicer`, version 2.5.0, manifest source `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`. The installed executable was rehashed: `9c42194b612e85b29ec269124d8f1b83d768f3e8a3dfdfb65e26625942e947cc` (`provenance.sha256`).

The session used its own `data/` beneath the evidence directory, `single_instance=false`, and dedicated `Xvfb :89 -screen 0 1440x1000x24 -nolisten tcp`. Its configuration and user preset seed came only from the [previous isolated desktop evidence](desktop-gui-metadata-20261107.md). Complete current `resources/profiles/Voron{,.json}` and `OrcaFilamentLibrary{,.json}` were copied into its `data/system/` before launch. Recursive vendor directory comparisons passed (`vendor.diff` is empty). No human project or configuration was read or changed.

Launch, under an exclusive `flock /tmp/weborca-parity-benchmark.lock` held throughout the owned GUI session:

```sh
DISPLAY=:89 flatpak run --user com.orcaslicer.OrcaSlicer \
  --datadir "$PWD/wasm/build/desktop-tree-parity-20261108/data"
```

The system certificate prompt was accepted. A private-display `kwin_x11 --replace` was needed for reliable custom dropdowns. Input used `xdotool`; screenshots used ImageMagick `import`. Desktop portal file dialogs appeared on host display `:0`; only the task-owned `Choose one or more files`, `Save file as`, and `Save G-code file as:` windows were targeted by title. No host desktop screenshot was taken.

Selected source leaves (hashes in `provenance.sha256`) were `Voron/machine/Voron 2.4 300 0.4 nozzle.json` (`8fd63a9d…`), `Voron/process/0.20mm Standard @Voron.json` (`8fc8ba05…`), and `OrcaFilamentLibrary/filament/Generic PLA @System.json` (`37494b20…`). All exported colour fields are `#26A69A`.

An exploratory model was discarded after an accidental auto-orient click while finding controls. The authoritative model was freshly imported through the normal Add dialog from `/mnt/appdata/workspace/OrcaSlicer/samples/obj_1_Ribbed_Christmas_Tree_Flat_48.stl`, without simplification, orientation or arrange after that fresh import. Prepare reports 131,504 triangles (`preslice.png`). Save project wrote `desktop-original.3mf` before Slice plate. The original imported object remained in memory for both exports; no 3MF was opened. An early empty save was overwritten with the populated project before slicing.

The first source-default export is retained as `desktop-high-temp.gcode` and its project as `desktop-high-temp.3mf`. It uses High Temp Plate/55°C. In Printer settings → Basic information, enabling “Support multi bed types” exposes the bed dropdown. Selecting “Smooth Cool Plate” produces exported `curr_bed_type=Cool Plate` and `first_layer_bed_temperature=35`. Disabling the checkbox resets bed type to the printer default. Therefore the final Cool Plate export retains the explicit `support_multi_bed_types=1` override. Save project again captured that state before Slice plate and Export G-code wrote `desktop-original.gcode`. `currentcool.png` captures the final preview. This input difference is recorded, not hidden.

The web reference is the existing `sample-parity-cause-20261107/tree-project/input.3mf` and accompanying `obj_1_Ribbed_Christmas_Tree_Flat_48_stl.gcode`. Its `browser.json` records headed `/opt/helium/helium`, version `156.0.8078.79`, at `http://localhost:5083/`. The [prior workflow](toolpath-cause-20261107.md) used normal model input, Keep original, preset selection, arrange, Save project before slice, Slice and File → Export G-code in the actual app. That capture is reused intact; no worker-only run, frontend instrumentation or new build was used here.

## Results

**The original desktop GUI is substantially closer to actual Helium than the historical CLI baseline. The evidence does not justify adding import normalization to WebOrca. Exact G-code parity remains open.**

`analyze.mjs` reuses the existing metrics and deposition comparators, and `commands.mjs` retains all meaningful executable commands before applying its explicitly labeled M73 diagnostic filter. Both ran under the exclusive lock. Existing comparator self-checks passed (`analysis.log`). Reproduction from the worktree root:

```sh
flock /tmp/weborca-parity-benchmark.lock \
  node --max-old-space-size=4096 wasm/build/desktop-tree-parity-20261108/analyze.mjs
flock /tmp/weborca-parity-benchmark.lock \
  node wasm/build/desktop-tree-parity-20261108/commands.mjs
```

### Geometry

`geometry.json` compares all 65,754 ordered parsed float32 vertices: desktop GUI original import and web original import have **zero differing components**. Their ordered vertex hash is `988088c97b7c4e9abc4de63296c6aa68f8a3a128f75545b697526af1ad76a820`. Ordered triangle tags, including indices, have equal hash `ebb8056f055573b738ad3b15dccc13571f5385bc6ebcb606487001013fb6a45f`; no reordering was applied.

Both serialized component matrices are identity plus translation `(-3.81469727e-06,3.81469727e-06,0)` and both instance matrices are identity plus `(150,150,75.0000381)`. Metadata volume matrices agree at greater precision: `(-3.814697265625e-06,3.814697265625e-06,0)`. Both metadata source offsets are `(128.00030899047852,127.99999618530273,75.000038165000007)`. UUIDs and mesh member filenames differ, as expected after the discarded exploratory import; those are not coordinate differences.

The prior native **project reload** retains identical ordered triangle tags but changes 131,508 coordinate components and reduces its component translation to approximately `(-4.37499971e-15,4.37499971e-15,0)`. Its float vertex hash is `7ebaba3ca34ef21f2c4644e71f871bb576856bb719c11fd66a88409b79bfa0d2`. The [prior recovered extra recenter operation](upstream-compatibility-20261108.md) describes that reload, not original desktop STL behavior. Original desktop import already agrees with web at the saved geometry level.

### Effective configuration

`desktop-config.txt`, `web-config.txt` and `config.diff` preserve complete effective CONFIG_BLOCKs and every duplicate wipe entry. All effective keys agree except these six:

| Key | Desktop GUI Cool Plate export | Helium original export |
| --- | --- | --- |
| `different_settings_to_system` | `;;support_multi_bed_types` | absent |
| `extruder_ams_count` | `1#0\|4#0;1#0\|4#0` | empty |
| `extruder_nozzle_stats` | `Standard#1` | empty |
| `support_multi_bed_types` | `1` | `0` |
| `wipe_tower_x` | `165.000` / `165` | `15.000` / `15` |
| `wipe_tower_y` | `250.000` / `250` | `220.000` / `220` |

Bed and temperature now agree, as do all three preset identities and all three colour fields. No accessible normal control was identified for clearing the auto-generated AMS/nozzle inventory. Wipe positions were retained rather than inventing a disabled-tower GUI placement. `enable_prime_tower=0` on both sides. Inspection of the manifest source and checkout confirms `Print::has_wipe_tower()` returns false in that case; the classic tower placement consumers are gated on tower existence. AMS/nozzle state is not universally inert: `get_extruder_nozzle_volume_count` consumes nozzle inventory. Here Standard#1 gives one nozzle volume, while absent stats fall back to the single extruder count; both are one. `state-consumers.txt` retains source references. These are scoped source checks, not a state-matched independent reslice proving every inventory consumer irrelevant.

The native high-temperature control and native Cool Plate export have identical ordered deposition keys and travel totals. After removing comments and M73, **only three commands differ**: `M190 S55` → `M190 S35`, `PRINT_START EXTRUDER=220 BED=55` → `PRINT_START EXTRUDER=220 BED=35`, and `M140 S55` → `M140 S35`. Thus enabling multi-bed support and selecting Cool Plate together do not change this native toolpath. Override provenance remains truthful in the export.

### Commands and residual paths

| Comparison, web minus native | Historical CLI original → web | Desktop GUI original → web |
| --- | --- | --- |
| Deposition segment counts | 1,284,442 / 1,284,474 | 1,284,474 / 1,284,474 |
| Differing undirected segment keys | 9,500 / 9,532 | 3 / 3 |
| Travel difference | −2165.54198875 mm | +0.01915875 mm |
| Extruding path difference | +0.67282915 mm | +0.00615507 mm |
| Net E difference | +0.01365000 mm | +0.00019000 mm |

Desktop travel is 83,624.02434113 mm; web is 83,624.04349988 mm. Both report estimated printing time **6h 8m 1s** and 750 layers. These are printer estimates, not slicing speed measurements.

Raw files differ: desktop SHA256 `98fb196c5b588328be0bc26aea3b132b5ffa3589dbe739524f25605c0807307b`, web `bf62974d762b554f621c99234a3487724fc87f6aabbca7aefe2de692a946262d`. Executable hashes including M73 also differ: desktop `4a1e0166df5e9ddbcff33a77988bc380a86cff4c63c679c0c34b71578f394fab`, web `2bd5a75dfc493e62ec012a59d0e578cdc90f9eb8b33060a2220216330275277d`. Comment/M73-filtered hashes remain unequal (`commands.json`). No timestamps, thumbnails or original files were modified.

After filtering comments/M73, both have 1,372,656 commands; **15 command positions differ**. Three are short internal solid infill geometry/E residuals: one at Z=55.4, two at Z=56.8 (`desktop-web-groups.json`). First ordered deposition divergence, index 582,579, starts at `(162.585,173.259,55.4)` and ends at X=162.852 native / 162.855 web, E=0.00760 / 0.00770. The next pair uses `(177.239,143.433)` native versus `(177.240,143.432)` web and endpoints `(177.292,143.276)` versus `(177.293,143.273)`.

The other twelve command differences comprise approach travel and five reordered inner-wall moves at each of deposition Z=149.0 and Z=149.8 (approach travel Z=149.4 and Z=150.2). These trace the same tiny closed segment sets in differing traversal order/direction; the undirected comparator does not report them. Full differing commands are retained in `commands.json`. Aggregate agreement therefore does not establish traversal or executable parity. The segment comparator uses 0.001 mm quantization, ignores direction/order/E for its keys, and does not model firmware macros; E and command comparisons are reported separately.

## Conclusion and next step

The historical CLI comparison exaggerated the original GUI import discrepancy. Saved original desktop and web geometry agrees in ordered float values, facets and serialized volume/component/instance transforms. Extra project-reload recentering would move web away from this desktop original-import evidence. **No web import correction is supported by this check.**

Next, isolate the remaining three internal-solid-infill geometry/E differences and two tiny inner-wall traversal differences using these captured original-GUI outputs and matched serialized geometry. Establish the responsible source/build operation before authorizing a diagnostic variant. Only if that residual specifically points back to transform precision should a separate internal-state capture be needed; saved exports cannot prove those live bits. Full state parity is still limited by the six explicit effective-config differences above.

## Boundaries

Saved XML can establish serialized geometry equality and parsed float32 equality, but cannot prove the live double transform bits or pre-slice arithmetic. Component transforms are printed to limited decimal precision; metadata matrices preserve more digits where present. The historical CLI original-STL trial retained G-code, not a corresponding original-import mesh snapshot. The existing `native-tree-project/input.3mf` is explicitly a **project reload/re-export**, not that missing CLI original-import snapshot.

Original STL SHA256 remains `47b5811659d769576c9a1139c3085de27f4c208829839fdfa12486f47b019556` (`sample.sha256`). Only this report and ignored artifacts were created. No product source, shared report, KNOWLEDGE, README, Taproot, commits, pushes or deployment were changed. No performance measurements were taken. No build or product test suite is applicable to this documentation/artifact-only work. Comparator self-checks passed, report links and retained artifact paths were checked, and the report passes whitespace checks. The owned application, window manager and Xvfb were stopped; other sessions were preserved.
