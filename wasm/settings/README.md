# OrcaSlicer Web Settings Layout Generator

Extracts OrcaSlicer's desktop settings UI layout from C++ source files into structured JSON for the WebAssembly web interface.

The web UI displays the same settings hierarchy—tabs, pages, groups, and lines—as the desktop application. This generator ensures the web interface stays synchronized with upstream C++ layout definitions without requiring a full C++ build.

---

## Usage

The script is a self-contained Node.js script with no external npm dependencies:

```bash
node wasm/settings/extract_tab_layout.mjs <repoRoot> <out.json>
```

### Example

From repository root:

```bash
node wasm/settings/extract_tab_layout.mjs . wasm/build/settings/layout.json
```

---

## Output Schema

```json
{
  "source": {
    "file": "src/slic3r/GUI/Tab.cpp",
    "gitBlob": "<git hash-object of Tab.cpp>"
  },
  "tabs": [
    {
      "id": "print",
      "function": "TabPrint::build",
      "pages": [
        {
          "title": "Quality",
          "icon": "custom-gcode_quality",
          "groups": [
            {
              "title": "Layer height",
              "anchor": "param_layer_height",
              "lines": [
                {
                  "type": "option",
                  "key": "layer_height",
                  "helpLink": "quality_settings_layer_height"
                },
                {
                  "type": "line",
                  "label": "Overhang speed",
                  "options": [
                    "overhang_1_4_speed",
                    "overhang_2_4_speed",
                    "overhang_3_4_speed",
                    "overhang_4_4_speed"
                  ],
                  "helpLink": "quality_settings_overhangs#overhang-speed"
                },
                {
                  "type": "custom",
                  "note": "custom widget: printable_area",
                  "key": "printable_area"
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "unparsed": [
    {
      "line": 5664,
      "text": "size_t\t\tn_before_extruders = 2;\t\t\t//\tCount of pages before Extruder pages"
    }
  ]
}
```

---

## What the Script Extracts

1. **Tabs & Functions**:
   - `print`: Defined in `TabPrint::build()`
   - `filament`: Defined in `TabFilament::build()` and `TabFilament::add_filament_overrides_page()`
   - `printer`: Defined in `TabPrinter::build_fff()`, `TabPrinter::build_unregular_pages()`, and `TabPrinter::build_kinematics_page()`

2. **Pages & Icons**:
   - Extracted from `page = add_options_page(L("Title"), "icon_name")`.

3. **Option Groups**:
   - Extracted from `page->new_optgroup(L("Title"), L"anchor")`.

4. **Option Lines**:
   - **Single Options (`type: "option"`)**:
     - Extracted from `optgroup->append_single_option_line("key", "helpLink")`.
     - Option indices (such as vector/extruder index `#0` or variable `extruder_idx`) are separated into an `index` integer field (`{"key": "nozzle_diameter", "index": 0}`).
   - **Multi-Option Lines (`type: "line"`)**:
     - Extracted from `Line line = { L("Label"), ... }; line.append_option(...); optgroup->append_line(line);`.
   - **Custom Widgets (`type: "custom"`)**:
     - Identified from calls like `create_line_with_widget(...)` or synthetic legend headers (`Normal` / `Silent`).

5. **Loop and List Expansions**:
   - Axis range loops (`speed_axes`, `axes`) generating `machine_max_speed_{x,y,z,e}`, `machine_max_acceleration_{x,y,z,e}`, and `machine_max_jerk_{x,y,z,e}`.
   - Retraction and Z-hop options dynamically synchronized with `src/libslic3r/PublishSettings.cpp` (`publishable_printer_retraction_options()` and `publishable_printer_z_hop_options()`).
   - Initializer list loops for filament retraction and ironing overrides.

6. **Conditional Blocks**:
   - C++ `if` conditions controlling entire pages or option groups (e.g., `m_use_silent_mode`, `is_marlin_flavor`, `from_initial_build`, `wxGetApp().getAgent() != nullptr`) are captured as raw `condition` strings scoped to their exact block boundaries.

7. **Unparsed Fallback**:
   - Any C++ statement within scanned functions that cannot be interpreted as layout structure is recorded in the top-level `unparsed` array (`line` and `text`), ensuring complete transparency.

---

## What the Script Does Not Extract

1. **Custom Desktop Widgets**:
   - Interactive native wxWidgets controls (such as the 3D bed shape configuration widget `create_bed_shape_widget`, preview buttons, or color pickers) cannot be rendered directly from a declarative schema and are flagged as `type: "custom"`.
2. **Dynamic Multi-Extruder Page Duplication**:
   - In desktop OrcaSlicer, multi-nozzle/extruder printers clone or re-target extruder controls dynamically at runtime according to `m_extruders_count`. The generator extracts the canonical baseline extruder page (extruder 0).
3. **Runtime Event Callbacks & Dynamic Visibility Logic**:
   - Desktop C++ event handlers (`optgroup->m_on_change` lambdas, preset sync callbacks, and runtime `toggle_option(...)` enable/disable states) depend on live desktop state and are not static layout definitions.
