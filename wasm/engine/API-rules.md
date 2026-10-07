# Proposal: `evaluateRules` Operation

This document proposes the `evaluateRules` engine operation for inclusion in `wasm/engine/API.md`.

## Operation Specification

| op | args | result |
| :--- | :--- | :--- |
| `evaluateRules` | `{"kind": "print" \| "printer" \| "filament", "filamentIndex"?: 0}` | `{"fields": {key: FieldStateJson}, "fixes": [FixJson], "messages": [string], "context": RuleContextJson}` |

### Description

Evaluates GUI setting rules, visibility/enablement conditions, and automated value adjustments/fixes without requiring GUI libraries (wxWidgets/OpenGL). The rules are ported from desktop OrcaSlicer (`src/slic3r/GUI/ConfigManipulation.cpp` and `src/slic3r/GUI/Tab.cpp`) to headless C++ in `wasm/engine/ConfigRules.hpp` and `ConfigRules.cpp`.

Evaluation runs against the current full config (`PresetBundle::full_config()` merged with any active option overrides set via `setOptions`), matching the configuration returned by `getConfig`.

### Arguments

- `kind` (`"print"` | `"printer"` | `"filament"` | `"sla_print"` | `"sla_material"`): The category of rules to evaluate:
  - `"print"`: Evaluates FFF print settings constraints and option toggles (`update_print_fff_config`, `toggle_print_fff_options`).
  - `"printer"`: Evaluates printer limits such as extruder layer height bounds (`check_layer_height`) and printer UI visibility/enablement options (`toggle_printer_options` from `TabPrinter::toggle_options`).
  - `"filament"`: Evaluates filament temperature ranges, volumetric speeds, cooling limits, and filament UI option toggles (`check_filament_rules`, `toggle_filament_options` from `TabFilament::toggle_options`).
  - `"sla_print"`: Evaluates SLA supports and pad options (`update_print_sla_config`, `toggle_print_sla_options`).
  - `"sla_material"`: Evaluates SLA material options (`toggle_sla_material_options`).
- `filamentIndex` (optional `number`, defaults to `0`): Zero-based extruder / filament slot index used for per-extruder and per-filament option evaluation (e.g. `retract_length#0`, `pressure_advance#0`).

### Result Schema

```typescript
interface FieldStateJson {
  enabled: boolean;        // Whether the field is interactive (from toggle_field / toggle_option)
  visible: boolean;        // Whether the field or line is visible (from toggle_line)
  label?: string;          // Dynamic label override if changed (e.g., "Brim ear radius")
}

interface FixJson {
  key: string;             // Configuration option key to adjust
  value: string;           // Proposed or corrected value serialized as string
  reason: string;          // Explanation, warning text, or dialog prompt describing why
}

interface RuleContextJson {
  is_bbl_printer: boolean;
  support_wrapping_detection: boolean;
  support_chamber_temp_control: boolean;
  machine_supports_junction_deviation: boolean;
  single_extruder_multi_material: boolean;
  supports_wipe_tower_2: boolean;
  purge_in_prime_tower: boolean;
  support_parallel_printheads: boolean;
  support_multi_bed_types: boolean;
  printer_model: string;
  filament_cnt: number;
  extruders_count: number;
  curr_bed_type: number;
  is_mixed_filament: boolean[];
  min_layer_height: number;
  max_layer_height: number;
  variant_index: number;
  is_global_config: boolean;
  is_plate_config: boolean;
  has_variable_layer_height: boolean;
  no_warn_mixed_sublayer_variable_layer: boolean;
}

interface RuleResultJson {
  fields: { [key: string]: FieldStateJson };
  fixes: FixJson[];
  messages: string[];
  context: RuleContextJson;
}
```

### RuleContext Engine State Mapping

The engine populates the `RuleContext` structure required by `ConfigRules` from its internal state as follows:

| Field | Source / Derivation | Description |
| :--- | :--- | :--- |
| `is_bbl_printer` | `PresetBundle::is_bbl_vendor()` | `true` if active printer vendor is Bambu Lab |
| `extruders_count` | `config.option<ConfigOptionFloats>("nozzle_diameter")->size()` | Number of extruder nozzles configured |
| `filament_cnt` | `PresetBundle::filament_presets.size()` | Count of selected filament presets |
| `printer_model` | `config.opt_string("printer_model")` or edited preset config | Hardware model identifier string |
| `support_chamber_temp_control` | `config.opt_bool("support_chamber_temp_control")` | Whether printer supports chamber heating/temperature |
| `machine_supports_junction_deviation` | Marlin flavor + `machine_max_junction_deviation > 0` | Whether firmware supports junction deviation |
| `single_extruder_multi_material` | `config.opt_bool("single_extruder_multi_material")` | SEMM mode enabled |
| `supports_wipe_tower_2` | `!is_bbl_printer && wipe_tower_type == WipeTowerType::Type2` | OrcaSlicer Type 2 wipe tower compatibility |
| `purge_in_prime_tower` | `config.opt_bool("purge_in_prime_tower")` | Whether prime tower purge is enabled |
| `support_parallel_printheads` | `config.opt_bool("support_parallel_printheads")` | Multi-head IDEX / parallel printheads support |
| `support_multi_bed_types` | `config.opt_bool("support_multi_bed_types")` | Multiple build plate surface temperature support |
| `curr_bed_type` | `config.opt_enum<BedType>("curr_bed_type")` or project config | Currently active bed plate type (or -1 if unset) |
| `is_mixed_filament` | `PresetBundle::is_mixed_filament(i)` for each slot | Slot-by-slot check for multi-material mixed filaments |
| `min_layer_height`, `max_layer_height` | `min/max_element` of `min_layer_height` / `max_layer_height` | Printer nozzle extruder layer height limits |
| `variant_index` | `args["filamentIndex"]` (default 0) | Active variant / extruder index |
| `is_global_config` | `true` | Engine evaluates global full config |
| `is_plate_config` | `false` (default) | Left at default; engine evaluates full global config |
| `has_variable_layer_height` | `model.objects` scan: `layer_height_profile.size() > 4` | Whether any model object uses adaptive layer heights |
| `support_wrapping_detection` | `false` (default) | Left at default; desktop reads from GUI `DevPrinterConfigUtil` |
| `no_warn_mixed_sublayer_variable_layer` | `false` (default) | Left at default; desktop reads from GUI `AppConfig` dialog DSA |

---

## Examples

### 1. Print Rules (`{"kind": "print"}`)

Requesting print rules when support is disabled (`enable_support = 0`):

```json
{
  "fields": {
    "small_support_perimeter_speed": {
      "enabled": false,
      "visible": true
    },
    "support_base_pattern": {
      "enabled": false,
      "visible": true
    }
  },
  "fixes": [],
  "messages": []
}
```

Enabling spiral mode (`spiral_mode = 1`) returns proposed fixes matching desktop's spiral vase adjustments:

```json
{
  "fields": { ... },
  "fixes": [
    {
      "key": "wall_loops",
      "value": "1",
      "reason": "Spiral mode only works when wall loops is 1... [Yes: Change these settings and enable spiral/vase mode automatically]"
    },
    {
      "key": "top_shell_layers",
      "value": "0",
      "reason": "Spiral mode only works when wall loops is 1... [Yes: Change these settings and enable spiral/vase mode automatically]"
    },
    {
      "key": "sparse_infill_density",
      "value": "0%",
      "reason": "Spiral mode only works when wall loops is 1... [Yes: Change these settings and enable spiral/vase mode automatically]"
    },
    {
      "key": "enable_support",
      "value": "0",
      "reason": "Spiral mode only works when wall loops is 1... [Yes: Change these settings and enable spiral/vase mode automatically]"
    },
    {
      "key": "enforce_support_layers",
      "value": "0",
      "reason": "Spiral mode only works when wall loops is 1... [Yes: Change these settings and enable spiral/vase mode automatically]"
    },
    {
      "key": "detect_thin_wall",
      "value": "0",
      "reason": "Spiral mode only works when wall loops is 1... [Yes: Change these settings and enable spiral/vase mode automatically]"
    },
    {
      "key": "overhang_reverse",
      "value": "0",
      "reason": "Spiral mode only works when wall loops is 1... [Yes: Change these settings and enable spiral/vase mode automatically]"
    },
    {
      "key": "timelapse_type",
      "value": "traditional",
      "reason": "Spiral mode only works when wall loops is 1... [Yes: Change these settings and enable spiral/vase mode automatically]"
    },
    {
      "key": "enable_wrapping_detection",
      "value": "0",
      "reason": "Spiral mode only works when wall loops is 1... [Yes: Change these settings and enable spiral/vase mode automatically]"
    },
    {
      "key": "spiral_mode",
      "value": "0",
      "reason": "Spiral mode only works when wall loops is 1... [No: Cancel enabling spiral mode]"
    }
  ],
  "messages": []
}
```

### 2. Printer Rules (`{"kind": "printer"}`)

Evaluating printer options for Bambu Lab vs Voron:

- On Bambu Lab printers: `scan_first_layer` visible is `true`, `use_firmware_retraction` visible is `false`.
- On non-Bambuu printers (e.g. Voron): `scan_first_layer` visible is `false`, `use_firmware_retraction` visible is `true`.
- Extruder options carry `#index` key suffixes (e.g. `retract_length#0`).
