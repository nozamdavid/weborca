# Preset metadata investigation — 2026-11-07

No product fix is justified by the seven residual fields. They compare installed **CLI** configuration assembly with WebOrca's GUI-style preset bundle assembly. Neither missing empty groups nor CLI override provenance should be fabricated in the web export. The two web-only keys exist in the installed Flatpak schema; a newer-source schema explanation is disproven for these keys.

This investigation owns only this report and the ignored evidence script `wasm/build/sample-parity-20261107/metadata-contract.mjs`. No product source, shared benchmark harness, README, Taproot, deployment, commit, push or PR was changed. Consequently there is no before/after product candidate or compilation requirement. The seven differences remain exactly as recorded.

## Reproduction and contract

Worktree: `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1`, branch `integrate/v250-deployed-browser-workflows`. Evidence root: [sample-parity-20261107](../../wasm/build/sample-parity-20261107). Existing [sample comparison](sample-parity-20261107.md) describes the actual full-app Helium trials; these recorded UI exports are the primary observed web behavior. No new browser acceptance run is claimed.

Read-only extraction of `helium-ui/native-final-obj_1_Corner_bracket_stl-1/plate_1.gcode` and `helium-ui/trial-1/obj_1_Corner_bracket_stl.gcode` with `/^; (\w+) = (.*)$/gm` reproduced exactly seven differences. Assertions on the count, missing web `inherits_group`, and web colour passed (`Recorded seven-field reproduction PASS`). This is a symptom reproduction, not a requirement to make the files identical.

The focused production API contract command is:

```sh
node wasm/build/sample-parity-20261107/metadata-contract.mjs
```

Result: `PASS selected-preset metadata and save/reopen identities, colour, plugin override` (exit 0, approximately 0.7 seconds). It loads the immutable shipped engine and **its own** `profiles/resources.json`, `profiles/OrcaFilamentLibrary.json` and `profiles/Voron.json`, selects the exact three presets, asserts all five absent bookkeeping keys and the two present web fields, loads `tests/data/20mm_cube.obj`, saves and reopens a project, and compares all three preset identities plus colour and plugin override. It invokes real `getConfig`, `selectPresets`, `saveProject` and `openProject` paths. An assertion fails on any violation of these specific values. This supplementary API probe is not full-app acceptance or proof of installed-GUI output equality.

Initial probe setup attempts failed before reaching assertions: stdin `--input-type=module` leaked into Emscripten worker startup (`ERR_INPUT_TYPE_NOT_ALLOWED`); the subsequent script initially looked for `candidate/resources.json` rather than `candidate/profiles/resources.json`. Both were corrected in the ignored probe only. Node also emits its existing typeless-package warning. No production fix or failing production-contract assertion was observed, so no product regression test was added.

Candidate: `wasm/build/v250-export-align/candidate`; engine `engine/orca_engine.mjs` and `engine/orca_engine.wasm`. Existing recorded WASM SHA256: `452c0ab51a0b935f691384e629d73ad0005fda99733b059d18cc600c0d4c1f19`. Reused without rebuild. Installed baseline is user Flatpak `com.orcaslicer.OrcaSlicer`, commit `e6c923c16c51c60d015167c442e4b1f387ce75e07f6e6dce19c8c3b124dd167c`, not `/tmp/orca-native`.

## Field producers and consumers

| Field, native → web | Actual origin and consumer | Decision |
| --- | --- | --- |
| `compatible_machine_expression_group`, `;;` → absent | CLI filament loading in `src/OrcaSlicer.cpp` maps scalar `compatible_printers_condition` to a filament-count-plus-two vector, even when empty. GUI `PresetBundle::full_fff_config()` collects conditions then calls `add_if_some_non_empty`; all-empty values are omitted. `PresetBundle::load_config_file_config()` expands missing groups to empty conditions and splits them back into print/filament presets. | Preserve GUI omission. A real nonempty expression is meaningful compatibility metadata and must not be globally discarded. |
| `compatible_printers_condition`, empty → absent | The CLI's assembled process/printer configuration retains the empty scalar. `full_fff_config()` explicitly erases the scalar to avoid the clash between preset types, using the grouped representation for nonempty conditions. Preset compatibility evaluation consumes the individual condition after loading. | Preserve the shared GUI implementation. Empty scalar is not a missing setting. |
| `compatible_process_expression_group`, literal `""` → absent | CLI maps filament `compatible_prints_condition` to a one-slot string vector. `ConfigOptionStrings` serializes a single empty string as `""`. GUI collects the same conditions and omits an all-empty group. Project loading splits the group back into filament conditions. | Preserve omission; do not confuse the serialized quote pair with a substantive expression. |
| `different_settings_to_system`, `;;extruder_colour` → absent | Native harness explicitly supplies `--extruder-colour '#26A69A'` and `--filament-colour '#26A69A'`; CLI override tracking places the printer key in its third column. GUI `full_fff_config()` compares edited presets against their parents and emits only nonempty dirty columns. Web selection has no such explicit printer edit. Web `ProjectOps.cpp::op_saveProject()` separately appends genuine `options_override` keys to their appropriate dirty columns, allowing desktop project loading to restore overrides. `load_config_file_config()`/`project_different_keys` consume those columns. | No spoofed CLI provenance in G-code. Save/reopen follows the existing project tracking path; absence in this unedited slice does not imply lost overrides. |
| `inherits_group`, `;;` → absent | CLI sizes three columns for process, filament and printer even when using system presets. GUI gathers **loaded** preset inheritance and emits a group only if a column is nonempty. Resource JSON ancestry is used during preset resolution, not blindly copied into export ancestry: system-base file ancestry and user-preset inheritance have different roles. Project loader expands absent groups and resolves system identities from settings IDs. | Preserve omission. Runtime save/reopen retained all three selected preset identities. |
| `filament_multi_colour`, absent → `#26A69A` | Schema `PrintConfig.cpp` defines a string vector. Web `Engine.cpp::op_selectPresets()` copies the selected filament colour to both project colour vectors; `op_loadVendors()` restores them similarly. Desktop `Plater.cpp`'s filament synchronization also falls back to the single colour when multi-colour data is missing or mismatched. `PresetBundle` includes it in project options; project loading restores it. GUI colour preview consumes it. CLI does not perform this GUI project-colour synchronization. | Retain actual GUI project colour metadata. Installed binary contains the exact key. No schema difference is established. |
| `filament_plugin_config_overrides`, absent → empty | `PrintConfig.cpp` defines a scalar string defaulting to empty. `Preset::filament_options()` includes it; GUI bundle assembly merges filament scalar options. Recorded installed CLI log line 2462 explicitly says `skip scalar option filament_plugin_config_overrides from filament 1: Generic PLA @System`. CLI filament loading handles compatibility scalars specially and skips other scalars. `Preset::plugin_overrides_key()` and `src/slic3r/plugin/PluginConfig.cpp` consume it for plugin configuration resolution. | Keep the upstream setting. Both installed binary and local `v2.5.0` tag contain it; this is scalar-loading behavior, not evidence of a newer schema. Empty means no per-preset plugin configuration. |

## Loading, export and baseline boundaries

`native-ui-comparison.mjs` loads the original resource JSON paths with the installed Flatpak CLI, applies both intentional colour overrides and `--flush-volumes-vector '140,140'`, and slices the STL. The exact selected JSON files inherit `fdm_klipper_common`, `fdm_process_voron_common` and `fdm_filament_pla`. The web loads vendor bundles through `PresetBundle::load_presets`, selects actual loaded presets, and calls the shared `full_config()` (`full_fff_config()` for this printer). `getPresetConfig` exposes the loaded baseline rather than a flattened export copied back into the preset.

G-code export is `GCode::append_full_config()`: it iterates the effective `print.full_print_config()` keys and serializes present, non-nil, non-banned values. These seven fields are not selectively stripped by a web text normalizer. In particular the web plugin scalar is inherited from GUI bundle composition and the multi-colour vector is project state. Web `getConfig` and slicing construct from `m_bundle->full_config()` plus actual option overrides. Project saving uses `full_config_secure()` plus override provenance; opening loads embedded presets, then `load_config_model()` and clears the external override layer after incorporating the project.

Schema check commands (read-only):

```sh
flatpak info --user --show-location com.orcaslicer.OrcaSlicer
strings /home/david/.local/share/flatpak/app/com.orcaslicer.OrcaSlicer/current/active/files/bin/orca-slicer | rg '^filament_(multi_colour|plugin_config_overrides)$'
git show v2.5.0:src/libslic3r/PrintConfig.cpp | rg -n 'filament_multi_colour|plugin_config_overrides'
rg -n 'skip scalar option filament_plugin_config_overrides' wasm/build/sample-parity-20261107/helium-ui/native-final-obj_1_Corner_bracket_stl-1/engine.log
```

Both schema keys were found in the installed binary; the tag also defines them. The installed log directly confirms the scalar skip. Source traces explain the empty groups and GUI colour synchronization. This is stronger evidence than classifying fields by their names, but it is not a fresh installed-GUI export with identical interactions. That remains a verification limit. No new claim of byte parity, arbitrary-project round-trip coverage, plugin execution equivalence, or toolpath equivalence follows from this report. The independent toolpath investigation remains necessary.
