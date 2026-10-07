# Proposal: `getConfigDef` Operation

This document proposes the `getConfigDef` engine operation for inclusion in `wasm/engine/API.md`.

## Operation Specification

| op | args | result |
| :--- | :--- | :--- |
| `getConfigDef` | `{"keys": [...]}` *(optional; all keys when absent)* | `{key: ConfigOptionDefJson}` mapping each requested or defined option key to its metadata |

### Description

Returns option metadata from `Slic3r::print_config_def` (defined in `src/libslic3r/PrintConfig.cpp` / `src/libslic3r/Config.hpp`). This metadata is used by the web settings UI to render inputs, determine option types, display tooltips and units, restrict input ranges, and filter by user mode (simple / advanced / develop).

Labels and tooltips are untranslated source strings.

### Arguments

- `keys` (optional, `string[]`): An array of configuration option keys to look up. If omitted or not an array, metadata for all known options in `Slic3r::print_config_def` is returned. Non-existent keys in the array are ignored.

### Result Schema

`{ [key: string]: ConfigOptionDefJson }`

Where `ConfigOptionDefJson` contains only fields that are set (empty strings, unset min/max, false boolean flags, and empty lists are omitted):

```typescript
interface ConfigOptionDefJson {
  // Option value type mapped from ConfigOptionType
  type: "float" | "floats" | "int" | "ints" | "string" | "strings" |
        "percent" | "percents" | "floatOrPercent" | "floatsOrPercents" |
        "point" | "points" | "point3" | "bool" | "bools" | "enum" | "enums" |
        "pointsGroups" | "intsGroups" | "none";

  // Display strings (omitted when empty)
  label?: string;
  fullLabel?: string;
  category?: string;
  tooltip?: string;
  sidetext?: string;

  // Settings visibility mode mapped from ConfigOptionMode
  mode: "simple" | "advanced" | "expert" | "develop";

  // Numeric boundaries (omitted when unset, i.e. min <= -FLT_MAX or max >= FLT_MAX)
  min?: number;
  max?: number;

  // Serialized default value from default_value->serialize() (omitted if unset or empty)
  default?: string;

  // Enum choices (omitted if empty)
  enumValues?: string[];
  enumLabels?: string[];

  // Flags (omitted when false)
  nullable?: boolean;
  readonly?: boolean;
  multiline?: boolean;

  // GUI presentation hints (omitted when undefined or empty)
  guiType?: "i_enum_open" | "f_enum_open" | "color" | "select_open" |
            "slider" | "legend" | "one_string" | "plugin_picker" |
            "plugin_config" | "printer_agent_select";
  guiFlags?: string;
}
```

---

## Examples

The following examples demonstrate the metadata returned for three representative configuration options, read directly from `src/libslic3r/PrintConfig.cpp`.

### 1. Scalar Float: `layer_height`
Source: [PrintConfig.cpp](file:///mnt/appdata/workspace/OrcaSlicer/src/libslic3r/PrintConfig.cpp#L1009-L1015) lines 1009–1015

```cpp
// src/libslic3r/PrintConfig.cpp:1009-1015
def = this->add("layer_height", coFloat);
def->label = L("Layer height");
def->category = L("Quality");
def->tooltip = L("This is the height for each layer. Smaller layer heights give greater accuracy but longer printing time.");
def->sidetext = L("mm");
def->min = 0;
def->set_default_value(new ConfigOptionFloat(INITIAL_LAYER_HEIGHT)); // 0.2
```

**Expected JSON result for `{"keys": ["layer_height"]}`**:
```json
{
  "layer_height": {
    "category": "Quality",
    "default": "0.2",
    "label": "Layer height",
    "min": 0.0,
    "mode": "simple",
    "sidetext": "mm",
    "tooltip": "This is the height for each layer. Smaller layer heights give greater accuracy but longer printing time.",
    "type": "float"
  }
}
```

---

### 2. Enum: `sparse_infill_pattern`
Source: [PrintConfig.cpp](file:///mnt/appdata/workspace/OrcaSlicer/src/libslic3r/PrintConfig.cpp#L3563-L3620) lines 3563–3620

```cpp
// src/libslic3r/PrintConfig.cpp:3563-3620
def = this->add("sparse_infill_pattern", coEnum);
def->label = L("Sparse infill pattern");
def->category = L("Strength");
def->tooltip = L("This is the line pattern for internal sparse infill.");
def->enum_keys_map = &ConfigOptionEnum<InfillPattern>::get_enum_values();
def->enum_values.push_back("rectilinear");
// ... (26 values total)
def->enum_labels.push_back(L("Rectilinear"));
// ... (26 labels total)
def->set_default_value(new ConfigOptionEnum<InfillPattern>(ipCrossHatch));
```

**Expected JSON result for `{"keys": ["sparse_infill_pattern"]}`**:
```json
{
  "sparse_infill_pattern": {
    "category": "Strength",
    "default": "crosshatch",
    "enumLabels": [
      "Rectilinear",
      "Aligned Rectilinear",
      "Zig Zag",
      "Cross Zag",
      "Locked Zag",
      "Line",
      "Grid",
      "Triangles",
      "Tri-hexagon",
      "Cubic",
      "Adaptive Cubic",
      "Quarter Cubic",
      "Support Cubic",
      "Lightning",
      "Honeycomb",
      "3D Honeycomb",
      "Lateral Honeycomb",
      "Lateral Lattice",
      "Cross Hatch",
      "TPMS-D",
      "TPMS-FK",
      "Gyroid",
      "Concentric",
      "Hilbert Curve",
      "Archimedean Chords",
      "Octagram Spiral"
    ],
    "enumValues": [
      "rectilinear",
      "alignedrectilinear",
      "zigzag",
      "crosszag",
      "lockedzag",
      "line",
      "grid",
      "triangles",
      "tri-hexagon",
      "cubic",
      "adaptivecubic",
      "quartercubic",
      "supportcubic",
      "lightning",
      "honeycomb",
      "3dhoneycomb",
      "lateral-honeycomb",
      "lateral-lattice",
      "crosshatch",
      "tpmsd",
      "tpmsfk",
      "gyroid",
      "concentric",
      "hilbertcurve",
      "archimedeanchords",
      "octagramspiral"
    ],
    "label": "Sparse infill pattern",
    "mode": "simple",
    "tooltip": "This is the line pattern for internal sparse infill.",
    "type": "enum"
  }
}
```

---

### 3. Vector: `retraction_length`
Source: [PrintConfig.cpp](file:///mnt/appdata/workspace/OrcaSlicer/src/libslic3r/PrintConfig.cpp#L5866-L5873) lines 5866–5873

```cpp
// src/libslic3r/PrintConfig.cpp:5866-5873
def = this->add("retraction_length", coFloats);
def->label = L("Length");
def->full_label = L("Retraction Length");
def->tooltip = L("Some amount of material in extruder is pulled back to avoid ooze during long travel. Set zero to disable retraction.");
def->sidetext = L("mm");
def->mode = comSimple;
def->set_default_value(new ConfigOptionFloats { 0.8 });
```

**Expected JSON result for `{"keys": ["retraction_length"]}`**:
```json
{
  "retraction_length": {
    "default": "0.8",
    "fullLabel": "Retraction Length",
    "label": "Length",
    "mode": "simple",
    "sidetext": "mm",
    "tooltip": "Some amount of material in extruder is pulled back to avoid ooze during long travel. Set zero to disable retraction.",
    "type": "floats"
  }
}
```
