# Installed desktop GUI metadata verification — 2026-11-07

All seven CLI-versus-WebOrca metadata differences disappear against a fresh installed OrcaSlicer **desktop GUI** export. This confirms the assembly explanation in [preset-metadata-parity-20261107.md](preset-metadata-parity-20261107.md). No correction to those seven web fields is justified. Full exported configuration equality is **not** established: six other keys differ as listed below. This task makes no toolpath or performance claim.

## Actual GUI procedure and provenance

Worktree: `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`. Installed user Flatpak `com.orcaslicer.OrcaSlicer`, reported version 2.5.0, commit `e6c923c16c51c60d015167c442e4b1f387ce75e07f6e6dce19c8c3b124dd167c`. No source build or CLI slicing was used.

Evidence: [sample-parity-gui-metadata-20261107](../../wasm/build/sample-parity-gui-metadata-20261107). The installed application was launched with its own absolute `--datadir` beneath that directory. Only the prior isolated GUI evidence's configuration and system presets were copied to seed it; no human user configuration was copied or edited. The copied configuration has `single_instance=false`. The original STL `/mnt/appdata/workspace/OrcaSlicer/samples/obj_1_Corner bracket.stl` was opened read-only.

Display `:1` was unavailable and the first launch exited 139 before usable GUI initialization. A retry on `:0` reached the certificate prompt; that task-owned process was terminated and relaunched on a new dedicated `Xvfb :88 -screen 0 1440x1000x24 -nolisten tcp`. Interaction used `xdotool` and screenshots used ImageMagick `import`. The GUI onboarding selected Europe, Voron 2.4 300 with its default 0.4 nozzle, Generic PLA, and Stealth Mode. No networking plugin was installed. Prepare showed `0.20mm Standard @Voron`. The selected colours already were `#26A69A`; both exported colour fields confirm this. Slice plate and Export G-code file were clicked in the real GUI. The desktop portal placed the save dialog on `:0`; only that task-owned `Save G-code file as:` dialog was activated and supplied an absolute evidence filename. Other application sessions and sample files were preserved.

The first export, `desktop.gcode`, used the copied system caches. For definitive preset provenance, that task-owned app was stopped, its Voron and OrcaFilamentLibrary caches were moved to `initial-system/`, and the **complete** corresponding vendor directories and vendor JSON indexes from this integration checkout's `resources/profiles` were copied into the isolated `data/system/`. This retains inheritance resolution and system identities through normal GUI bundle loading, without flattened or renamed surrogate presets. On restart, the GUI log `data/log/debug_Sat_Nov_07_21_48_52_2.log.0`, lines 85–86, explicitly records parsing these isolated `OrcaFilamentLibrary.json` and `Voron.json` files. Both vendor-directory recursive comparisons against the source passed. The app recreated its caches. Prepare again showed the requested selections; Slice and Export produced **`desktop-source.gcode`**, the authoritative comparison here.

Selected exported identities are `Voron 2.4 300 0.4 nozzle`, `0.20mm Standard @Voron`, and `Generic PLA @System`. Source SHA256:

| Preset JSON | SHA256 |
| --- | --- |
| `Voron/machine/Voron 2.4 300 0.4 nozzle.json` | `8fd63a9d54c42639065c8bedd4573f75e2c93bd79e168a6ef5b630da38a4f74a` |
| `Voron/process/0.20mm Standard @Voron.json` | `8fc8ba05fc17318253c7d85ba64ccb59e13b2273b605b981461b29027ff696eb` |
| `OrcaFilamentLibrary/filament/Generic PLA @System.json` | `37494b202e9b636270ad8f08ac9cd28843cbbb547847473e41e7590afa1ce9a0` |

`vendor-source-sha256.txt` records hashes for all files in both vendor directories, including inherited bases; `source-preset-sha256.txt` records the three leaves. GUI screenshots are `source-presets.png` and `exported-source.png`. Authoritative G-code SHA256: `e4f82a0071bbe2bd354999d08289c8b111fce5cc14ab7c2d059147b6e39043a5`.

## Seven-field result

Compared with the recorded actual full Helium UI export `sample-parity-20261107/helium-ui/trial-1/obj_1_Corner_bracket_stl.gcode` from the [sample report](sample-parity-20261107.md):

| Field | Installed GUI | Recorded Helium UI |
| --- | --- | --- |
| `compatible_machine_expression_group` | absent | absent |
| `compatible_printers_condition` | absent | absent |
| `compatible_process_expression_group` | absent | absent |
| `different_settings_to_system` | absent | absent |
| `inherits_group` | absent | absent |
| `filament_multi_colour` | `#26A69A` | `#26A69A` |
| `filament_plugin_config_overrides` | empty | empty |

A focused Perl assertion on both actual G-code CONFIG_BLOCKs passed all seven checks (`seven-field-check.txt`). `extruder_colour` and `filament_colour` also equal `#26A69A`. Full effective exported configuration blocks are retained verbatim in `source-config.txt` and `web-config.txt`; `source-config.diff` retains every difference, including duplicate serialized wipe-tower entries. No normalization was used to erase differences.

## Remaining boundaries

| Key | Installed GUI source-preset export | Recorded Helium UI |
| --- | --- | --- |
| `curr_bed_type` | `High Temp Plate` | `Cool Plate` |
| `first_layer_bed_temperature` | `55` | `35` |
| `extruder_ams_count` | `1#0\|4#0;1#0\|4#0` | empty |
| `extruder_nozzle_stats` | `Standard#1` | empty |
| `wipe_tower_x` | `-31.040` / `-31.0405` | `15.000` / `15` |
| `wipe_tower_y` | `-31.040` / `-31.0405` | `220.000` / `220` |

Bed selection was not reconciled through additional GUI edits, so its temperature is an explicit input-state mismatch. AMS/nozzle state and wipe-tower placement also remain unequal; this metadata-only check does not establish their causes or justify a product fix. Exact source preset files and selected identities therefore do not imply equality of all GUI project state. The initial cache export also matched the seven fields, while some other state values differed from the repeat export. No claim of perfect desktop/web configuration or toolpath equality follows.

Only this new report and ignored evidence were written. No product fixes, builds, timing measurements, shared reports, README, commits, pushes, deployment, or Taproot updates were performed. Documentation links and evidence paths were checked; compilation and test suites are unnecessary for this documentation-only change. The isolated application and dedicated virtual display were stopped after evidence capture.
