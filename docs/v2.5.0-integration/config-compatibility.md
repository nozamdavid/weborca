# v2.5.0 configuration compatibility investigation

Research date: 2026-11-07. Compared `main` at `413cb95cb6107a6b8786444925d672b142e3f690` with pinned release `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`, using `git show` and `git diff`; no checkout, build, test execution or product edit. This report is for the next integration batch, not evidence of a verified merged engine. The working AGENTS.md and [integration assessment](../orcaslicer-v2.5.0-integration-assessment.md) were read and preserved.

## Recommended compatibility batch

1. Keep upstream legacy migration and the new feature-filament semantics. Emit canonical arc enum values from web rules.
2. Normalize persisted web values before definition filtering and baseline construction. Keep the existing bulk-set transaction/error contract.
3. Resolve saved system preset names through native rename metadata before browser exact-name checks; canonicalize selected slot names.
4. Preserve typed filament strides and project import bookkeeping. Project slot deletion must also project project maps and assignments, and mapped composition must precede extracting variant values.
5. Generate the settings layout and profile packs from the integrated source alongside the engine. Existing cached test bundles must be regenerated for acceptance.

Items below distinguish proven source behavior from risks that still require a fixture. No broad rules port, mixing editor, belt UI, or IMEX mode editor is required to preserve ordinary web settings and project workflows.

## 1. Arc fitting: migration works through strict setters; browser baselines can remain stale

Release [PrintConfig.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/PrintConfig.cpp#L4428), `PrintConfigDef::init_fff_params`, changes `enable_arc_fitting` from bool to enum with `disabled`, `enabled`, `sparse_infill`, default `disabled`. Its `handle_legacy` converts `0`/`false` to `disabled` and `1`/`true` to `enabled`, with case-insensitive textual booleans.

The existing [Engine.cpp](../../wasm/engine/Engine.cpp) `op_setOptions` and scalar `op_setOption` call `DynamicPrintConfig::set_deserialize_strict`. “Strict” disables forward substitutions; it **does not bypass legacy conversion**: [Config.hpp](../../src/libslic3r/Config.hpp), `ConfigBase::set_deserialize_strict`, delegates to `set_deserialize`, and [Config.cpp](../../src/libslic3r/Config.cpp), `set_deserialize_nothrow`, invokes `handle_legacy` before raw deserialization. The web numeric guard accepts enums without treating them as numeric values. Therefore the existing rule fix `{"enable_arc_fitting":"0"}` is not by itself a proven setter failure after the merge.

Suggested minimal fixes:

- [ConfigRules.cpp](../../wasm/engine/ConfigRules.cpp), `evaluate_print_rules` near the volumetric extrusion rate slope check: emit `disabled` instead of `0`. Keep disabling arc fitting when smoothing is active; cover both `enabled` and `sparse_infill`. This makes the rule result match `getConfigDef`, even though native migration already accepts the old fix.
- [appStore.ts](../../wasm/app/src/store/appStore.ts), `computeBaselineConfig`: it copies saved printer/process values directly into the baseline when their keys exist. A saved `enable_arc_fitting: "1"` can therefore produce baseline `"1"` while effective native config is `"enabled"`. `resetOption` then projects serialized baselines through `op_getOption`, whose direct `ConfigOption::deserialize` does not call legacy migration. Normalize saved values before baseline merge, and use canonical serialized values for override bookkeeping. This is a concrete source-level reset/display risk, not a demonstrated runtime failure.
- `Engine::Impl::op_getOption` with `serializedValue`: if the bridge continues accepting legacy serialized scalar values here, parse them through a temporary `DynamicPrintConfig` before projecting them. Do not change literal string-cell handling or escaped string-vector handling.
- `op_parsePreset` already uses native JSON/INI loading; retain that path. Re-imported desktop presets should already receive canonical enum values. Existing browser storage predates that import, so parsePreset alone does not migrate stored web presets.

[SettingInput.tsx](../../wasm/app/src/settings/SettingInput.tsx) selects checkbox versus dropdown from the runtime definition and already renders `enumValues`. The existing Tab.cpp arc-fitting row is a plain key reference. No special arc widget is necessary; refresh definitions and layout with the new engine.

## 2. TPMS and IXEX aliases: native file loaders differ from web value maps

Release [PrintConfig.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/PrintConfig.cpp#L9765), `PrintConfigDef::handle_legacy`, owns these conversions:

| Input | Canonical key |
| --- | --- |
| `tpms_adaptive` | `adaptive_infill_mode` |
| `tpms_interior_density` | `adaptive_infill_interior_density` |
| `tpms_adaptive_gradient` | `adaptive_infill_gradient` |
| `is_ixex` | `is_imex` |
| `ixex_*` | corresponding `imex_*`, if defined |
| `ixex_carriage_width_x`, `ixex_carriage_width_y` | `imex_nozzle_clearance_x`, `imex_nozzle_clearance_y` |

The prefix migration is specifically `ixex_`. Do not invent an `idex_` alias or assume current `imex_carriage_width_*` is covered by this branch. Removed `ixex_primary_col`/`ixex_primary_row` have no modern counterpart and are dropped by the native definition check. Keep native handling of retired belt keys as well; do not revive them as arbitrary web settings.

Proven bridge gaps in [Engine.cpp](../../wasm/engine/Engine.cpp):

- `op_setOptions` checks `print_config_def.has(key)` before native deserialization, reports an alias as nonfatal `unknown_key`, and commits other valid keys. The native alias handler never sees it.
- `apply_json_values_to_config`, used for compatibility evaluation, silently skips undefined keys first. An old `is_ixex` value could disappear before evaluating capability-dependent compatibility.
- `op_mergeFilamentPresets` also checks definitions before deserialization; these named aliases are process/printer keys, so do not broaden filament override acceptance to accommodate them.
- `op_setOption` rejects unknown keys before loading; the interactive settings UI uses canonical definition keys, so old aliases belong primarily at the persisted/import boundary.
- `appStore.computeBaselineConfig` filters saved maps against current config before copying values. Old TPMS keys disappear from the reset baseline even if a separate setter path is repaired.

Suggested minimal change: normalize the persisted config maps through native legacy handling before schema filtering, numeric validation and baseline construction. Reuse `PrintConfigDef::handle_legacy` for keys/values; do not duplicate the alias table in TypeScript. If normalization is added inside `op_setOptions`/`apply_json_values_to_config`, use the migrated key for definition checks and storage, retain the original key in error diagnostics, and preserve atomic rollback for invalid known values. Avoid applying legacy conversion twice to non-idempotent older migrations; a temporary config parsed once, then canonically serialized, is safer than blindly calling the handler and deserializer in sequence for every historic key. Define collision handling when both old and canonical keys occur; canonical values should take precedence rather than JSON iteration order deciding it.

TPMS/adaptive infill aliases protect saved or externally imported configuration. IMEX aliases protect release-era desktop projects/profiles; main has no dedicated IMEX web workflow. Recognizing the aliases does not qualify parallel printing, zone arrangement or hardware behavior.

## 3. Default feature filament: accept the upstream correction

The release removes fallback propagation in **both** `DynamicPrintConfig::normalize_fdm` and `normalize_fdm_1`: nonzero sparse-infill selection no longer fills default internal-solid selection, and internal-solid selection no longer fills default top/bottom selections. See release [PrintConfig.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/PrintConfig.cpp#L10348) and the main-to-release diff of these functions.

`0` continues to mean Default. A feature whose selector is Default should use its object's filament, independently of another feature's explicit selector. Explicit nonzero feature selections remain explicit. Object `extruder` normalization still propagates the object's own assignment into unset/default feature selectors; do not remove that separate block.

Suggested fix: retain the release's deletion of fallback propagation. Do not materialize the old sparse→solid→surface cascade in `ConfigRules` or appStore to make historical output match. Old projects can intentionally slice differently after this upstream fix; retain their saved selectors rather than rewriting zeros into the previous implied filament. The web `op_slice` calls `normalize_fdm`, so existing browser objects are affected even without a new UI.

## 4. Filament strides, maps and composition: several contracts already exist on main

The assessment's suggestion that the optional filament-volume parameter is newly added by this release does not hold against current main. [PresetBundle.hpp](../../src/libslic3r/PresetBundle.hpp), `construct_full_config`, already has the seventh optional `filament_volume_maps_new` parameter. Both pinned trees read `filament_volume_map` from project config when that argument is absent. The six-argument call in `Engine::Impl::op_mergeFilamentPresets` is already intentional and compatible; merely adding `std::nullopt` cannot fix map semantics.

Main already has typed clone/set/serialize projections in `op_getConfig`, `op_getOption`, `op_setOption` and `op_resetOptions`. It handles a whole filament's nozzle-variant stride, nullable values and native escaped strings. Preserve these paths. Do not replace them with splitting/joining on commas or semicolons in appStore.

Concrete existing risks, relevant to imported projects and slot operations:

- `op_slice` composes `m_bundle->full_config()`, applies web overrides, normalizes, then overlays the selected `PlateData::config`. A plate `filament_map` or `filament_volume_map` applied at the end changes map metadata **after** `PresetBundle` has selected/merged mapped variant values. There is no recomposition using the selected plate maps. Suggested fix in `op_slice`: resolve effective project/plate maps before `full_config(..., filament_maps, filament_volume_maps)`, then overlay non-map options in the intended precedence. Audit `op_mergeFilamentPresets` at the same seam: its composer receives bundle project config, while effective web map overrides live outside it. Do not assume overlaying a map recomputes variant temperatures/retractions. This is an existing composition risk; the release signature is not its cause.
- `appStore.removeFilamentSlot` projects `filamentOverrides` plus colors before reselecting. Imported maps are generally project settings and can land in `processOverrides`; `op_resetOptions(removeFilamentSlot)` passes keys outside `Preset::filament_options` through unchanged. `filament_map` and `filament_volume_map` therefore need explicit per-slot projection, with their own one-entry-per-slot semantics, instead of being mistaken for filament variant vectors. Reselecting fewer presets truncates project arrays at the tail; that does not remove the original middle slot's mapping.
- Geometry `extruder` assignments and explicit `*_filament_id` selectors also refer to slot identities. A slot deletion should remap surviving IDs and apply an explicit fallback for the deleted slot. Preserve `0` Default semantics. Existing removal code does not perform that remap, so a saved/reopened project with assigned geometry is a focused correctness case, not a new mixing feature request.
- Upstream `PresetBundle` changes minimum filament count: shared-nozzle multimaterial printers may have fewer slots than nozzles; tool changers still require their tool count. appStore assumes its requested list is the resulting list after `selectPresets`. Capture native returned names/count before deriving baseline widths, selected slot, and rules context; do not store fewer web slots while native silently tops up. Preserve shared-nozzle one-slot operation. This is a release behavior adjustment around an existing web assumption.

Suggested changes belong in `Engine::Impl::op_slice`/`op_mergeFilamentPresets`/`op_resetOptions`, appStore `removeFilamentSlot` and selection actions. Use the existing project and filament tests below to establish exactly which mappings need projection; do not introduce a general slot-management framework.

## 5. Project and plate preservation

[ProjectOps.cpp](../../wasm/engine/ProjectOps.cpp), `openProject`, loads native config with substitutions, embedded presets, `Preset::normalize` and `load_config_model`, then retains the loaded `PlateData` pointers. `saveProject` serializes secure full config plus overrides and records web overrides in `different_settings_to_system`. Preserve that metadata: otherwise native import may discard apparently redundant global/project edits.

[appStore.ts](../../wasm/app/src/store/appStore.ts), `openProjectFile`, already clears stale web bookkeeping by reading imported config, reselecting its presets, reconstructing the baseline, then reapplying the imported diff. Preserve this sequence and canonicalize the reconstructed values; otherwise changing a filament after import can reintroduce the previous project's edits. A new loader does not replace this web responsibility.

Release [bbs_3mf.cpp](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/src/libslic3r/Format/bbs_3mf.cpp#L4669) stores `imex_parallel_mode`, `imex_head_filament_map` and `filament_volume_map` in `PlateData::config`. Existing `ProjectOps.openProject`, `PlateOps.listPlates` and `PlateOps.duplicatePlate` serialize/copy that generic config, so these particular fields need no speculative new PlateData members or duplicate JSON fields. `filament_maps` remains a separate vector already returned as `filamentMaps` and copied on duplicate. New `statistics` and the widened `limit_filament_maps` bitset in release bbs_3mf.hpp are separate concerns; do not describe them as newly added volume-map storage.

`PlateOps::setPlateConfig` already routes values through strict native deserialization but swallows exceptions. This is an existing diagnostic weakness; only change its error behavior if the focused invalid/legacy setting fixture demonstrates a needed caller contract. Generic config persistence does not validate IMEX geometry or make that feature usable in the browser.

## 6. Old preset names: native support exists; browser exact checks bypass it

`PresetCollection::find_preset` resolves `renamed_from` in **both** main and release before first-visible fallback; see [Preset.cpp](../../src/libslic3r/Preset.cpp), `find_preset` and `update_map_system_profile_renamed`. Do not add a second native rename mechanism. A concrete release fixture is `Printalot ABS @System` → `PrintaLot ABS @System`, recorded in release [PrintaLot ABS @System.json](https://github.com/OrcaSlicer/OrcaSlicer/blob/40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19/resources/profiles/OrcaFilamentLibrary/filament/Printalot/PrintaLot%20ABS%20%40System.json).

Suggested minimal fixes:

- appStore `restoreLastSetup` currently checks `.some(p => p.name === savedName)` for printer/process/filaments before calling selection. Resolve the system name through loaded native collections first, including user preset `inherits`; then compare/update with canonical names. `resolveDeviceVendor` already derives a hint from saved `vendor`, but still requires an exact profile-name match before accepting the hinted vendor. Allow the hint to load the native collection and resolve its rename map before rejecting the old name.
- `Engine::Impl::op_selectPresets` validates aliases through `find_preset`, but assigns the raw requested filament strings to `bundle->filament_presets`. Canonicalize each to the resolved preset's `name` before storing/returning it. Printer/process already return edited preset names. Keep user preset display names in browser user-preset records while canonicalizing their system parents.
- `op_getPresetConfig` and `op_mergeFilamentPresets` already use `find_preset`; preserve their unknown-name errors rather than silently selecting the first preset. A missing profile without `renamed_from` is a real unresolved name and should surface as such.

## 7. Generated layout and profile packs

[extract_tab_layout.mjs](../../wasm/settings/extract_tab_layout.mjs) parses integrated `Tab.cpp` and `PublishSettings.cpp`; [appStore.ts](../../wasm/app/src/store/appStore.ts) fetches `/settings/layout.json`, while `getConfigDef` exports runtime definitions. Regenerate the layout with the integrated inputs to avoid old key rows and missing canonical adaptive-infill rows. Retain the extractor's existing structure; adding release-only desktop sections does not implement the corresponding browser workflows. Enum choices themselves come from runtime definitions.

[pack_profiles.mjs](../../wasm/web/tools/pack_profiles.mjs) copies complete vendor JSON trees, manifest JSON, resources/info and supported assets. It already preserves `renamed_from`, inheritance and filament identity as JSON. No format change is indicated by these findings. Repack the vendor set and OrcaFilamentLibrary from the integrated tree with the matching engine; avoid serving old bundles with new definitions. Desktop updater migrations for on-disk user preset files do not migrate browser-stored user presets.

Existing configdef/rules tests pack only when selected bundle files are absent; preset-config assumes prepared bundles. Delete/regenerate the designated test output via the parent build workflow before acceptance, rather than accepting stale files as release coverage. This report did not regenerate artifacts.

## Minimal regression cases for the implementation batch

Add cases to these existing files only as needed for the corresponding fix. These are proposed checks, not executed results.

| Existing test file | Smallest meaningful case and expected result |
| --- | --- |
| [configdef.test.mjs](../../wasm/tests/node/configdef.test.mjs) | Assert arc type `enum`, default `disabled`, choices `disabled/enabled/sparse_infill`; set each choice and read it back. Preserve the check that every current config key has a definition. |
| [parse-preset.test.mjs](../../wasm/tests/node/parse-preset.test.mjs) | Table of arc `0/1/false/true` plus three TPMS aliases and IXEX master/clearance alias; JSON and the existing INI path produce canonical keys/values. Removed keys are reported/dropped, not retained as settings. |
| [set-options-rollback.test.mjs](../../wasm/tests/node/set-options-rollback.test.mjs) | A migrated TPMS key commits as its canonical key; canonical+legacy conflict obeys the chosen precedence; a second malformed known option rolls the entire batch back. Keep unknown future keys nonfatal. Arc `0/1` bulk calls read back as canonical enum values. |
| [rules.test.mjs](../../wasm/tests/node/rules.test.mjs) | With smoothing active, start from each non-disabled arc mode; the emitted fix is `disabled`, applying it succeeds and the next config is canonical. With smoothing inactive, no forced disabling. |
| [preset-config.test.mjs](../../wasm/tests/node/preset-config.test.mjs) | Load the packed release library and resolve `Printalot ABS @System` through getPresetConfig and selectPresets; config equals the canonical preset and returned filament name is canonical. Keep an actually unknown name failing. |
| [filament-temperature-settings.test.mjs](../../wasm/tests/node/filament-temperature-settings.test.mjs) | Extend existing store-action cases: saved process arc baseline `1` becomes `enabled`, edit then reset, switch preset and reapply. Extend first/middle/last deletion using distinct per-slot map and volume-map entries plus existing two-cell retraction stride and escaped G-code; surviving identity, vector cells and maps must agree. Verify Default zero and geometry assignments after deletion. |
| [project.test.mjs](../../wasm/tests/node/project.test.mjs) | Extend global override/import coverage with old arc serialization and canonical readback; import into dirty web state, then change a filament and reset. Use a two-variant filament with distinguishable values and a plate volume map selecting the other variant; assert effective composition selects it before slicing. Save/reopen and duplicate the plate, then compare config maps. |
| [project-roundtrip.test.mjs](../../wasm/tests/node/project-roundtrip.test.mjs) | Extend existing feature-project state comparison with plate `filament_volume_map` and generic IMEX config strings to verify passive persistence only. Do not claim parallel-print support from this check. |

For feature-filament semantics, use the existing project fixture with object filament 2, sparse filament 1 and solid/top/bottom selectors 0. Save/reopen retains zeros; slicing uses filament 2 for the default features and filament 1 for sparse infill. Add one explicit solid selector and verify that top/bottom Default remain on the object's filament. A native normalization assertion belongs alongside the existing [test_print.cpp](../../tests/fff_print/test_print.cpp) coverage only if the parent batch needs to isolate whether a failure originates in normalization or web state; no new harness is needed.

For minimum-slot behavior, extend the existing filament store case with a shared-nozzle two-nozzle printer reduced to one filament and a tool changer requiring one filament per tool. Assert browser/native counts agree after selection/removal. Use an existing packed matching profile rather than create a new profile family solely for the test.

## Evidence and verification limits

Read-only reproduction commands used the two pinned trees, for example:

```sh
git rev-parse main
git diff main 40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19 -- src/libslic3r/PrintConfig.cpp src/libslic3r/PresetBundle.hpp src/libslic3r/PresetBundle.cpp src/libslic3r/Preset.cpp
git show 40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19:src/libslic3r/Format/bbs_3mf.cpp
```

The report's source references and whitespace were checked. No compile or behavioral result is claimed. Only this report was written; README, Taproot, product source, test source, existing dirty files and generated artifacts were left for the coordinating worker's integration milestones.
