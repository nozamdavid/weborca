# Layer Event Engine API (`API-layer-events.md`)

This document specifies the layer event engine foundation in OrcaSlicer WebAssembly (`orca_engine`), covering layer-specific pause instructions and explicit custom G-code execution at designated print $Z$ heights. It details the JSON-RPC interface, native data structures, desktop GUI correspondence, batch validation semantics, duplicate same-$Z$ handling, 3MF roundtrip persistence, plate isolation, and concrete native pipeline limitations.

---

## 1. Overview & Desktop Behavioral Correspondence

In desktop OrcaSlicer (`src/slic3r/GUI/IMSlider.cpp`, `src/slic3r/GUI/GUI_Preview.cpp`, and `src/slic3r/GUI/PartPlate.cpp`), users interact with the vertical layer slider in the 3D plater preview to attach special events to specific print heights:
- **Pause Print**: Instructs the printer firmware to pause execution (e.g., to insert magnets, nuts, or weights) and optionally display a notification message on the printer screen. Emits the machine pause G-code (such as `PAUSE` or `M601`) at the requested layer.
- **Custom G-code**: Injects arbitrary raw G-code commands (e.g., temperature changes, fan speed overrides, macro triggers) directly before the target layer starts printing.
- **Plate Isolation**: Layer events are plate-specific; each build plate maintains its own discrete list of custom G-codes stored in `Model::plates_custom_gcodes[plate_index]`.
- **Project Persistence**: All custom layer events are serialized into 3MF archives under `Metadata/custom_gcode_per_layer.xml` upon `saveProject` and restored upon `openProject`.

---

## 2. Native Representation & Data Structures

Layer events are stored directly using `libslic3r` native data structures:

### `Slic3r::CustomGCode::Item`
Defined in `src/libslic3r/CustomGCode.hpp`:
```cpp
struct Item
{
    double      print_z;  // Target print height in millimeters
    Type        type;     // Event type (PausePrint, Custom, etc.)
    int         extruder; // 1-based extruder index (default 1)
    std::string color;    // Printer display message for PausePrint
    std::string extra;    // Custom G-code string or pause message
};
```

### `Slic3r::CustomGCode::Info`
Contains a vector of `Item` entries and a printer extruder mode (`SingleExtruder`, `MultiAsSingle`, `MultiExtruder`):
```cpp
struct Info
{
    Mode mode = Undef;
    std::vector<Item> gcodes;
};
```

### Model Storage
In `Slic3r::Model`:
```cpp
std::map<int, CustomGCode::Info> plates_custom_gcodes; // plate_index -> CustomGCode::Info
```

During slicing, `ToolOrdering::assign_custom_gcodes(print)` iterates over `plates_custom_gcodes` sorted ascending by `print_z`. Each custom event is associated with the layer tool whose slice height spans that $Z$ coordinate.

---

## 3. Native Pipeline Limitations (Filament & Color Changes, Duplicate Same-Z)

### Concrete Native Core Limitation (Color & Filament Changes)
In upstream desktop OrcaSlicer core (`src/libslic3r/GCode.cpp:5055-5085`), the code responsible for emitting color changes (`M600`) and tool changes in `ProcessLayer::emit_custom_gcode_per_print_z` has been disabled with `#if 0`:
```cpp
            //BBS: inserting color gcode is removed
#if 0
            if (color_change || tool_change)
            {
                ...
                gcode += gcodegen.placeholder_parser_process("color_change_gcode", ...);
                ...
            }
            else {
#endif
```
Because the slicer core sources are strictly preserved and color change emission is disabled upstream, filament and color change layer events cannot produce valid emitted G-code via the native print pipeline.
- The engine exclusively supports `'pause'` (`CustomGCode::PausePrint`) and `'custom'` (`CustomGCode::Custom`) layer events.
- Any attempt to set `'color_change'`, `'filament_change'`, or `'tool_change'` is rejected during batch validation with an explicit `RuntimeError`.

### Native Engine Behavior on Duplicate Same-$Z$ Heights
In upstream desktop OrcaSlicer:
1. The GUI slider (`IMSlider` / `TickCodeInfo`) stores ticks in a `std::set<TickCode>` sorted strictly by layer tick index, permitting at most one event tick per layer.
2. In the slicing engine (`ToolOrdering::assign_custom_gcodes`), each layer tool contains only a single `lt.custom_gcode` pointer. If multiple events exist at the exact same $Z$ height, only one event can be attached to the layer tool, and any duplicate same-$Z$ event is dropped.
- **Engine Policy**: To prevent claiming unsupported semantics, `setLayerEvents` strictly rejects batches containing multiple events at the same `printZ` height (within $|Z_1 - Z_2| < 10^{-4}$). The entire batch is rejected with an explanatory error, leaving existing state untouched.

---

## 4. Engine JSON-RPC Operations

All layer event operations are dispatched via `Engine::submit(op, argsJson)` and processed on the engine worker thread.

### 4.1 `getLayerEvents`
Retrieves configured layer events for a specific plate.

#### Parameters
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `plateIndex` | `number` (integer) | No | Target 0-based plate index (default: `0`). Must be an integer $\ge 0$ within integer range. Malformed types, out-of-range integer values (e.g. $\ge 2^{32}$), or negative values throw `RuntimeError`. |

#### Return Value
```json
{
  "plateIndex": 0,
  "count": 2,
  "events": [
    {
      "printZ": 2.0,
      "type": "pause",
      "message": "Insert magnet",
      "gcode": "",
      "extruder": 1,
      "color": "Insert magnet",
      "extra": "Insert magnet"
    },
    {
      "printZ": 4.0,
      "type": "custom",
      "gcode": "M117 HelloLayer",
      "message": "",
      "extruder": 1,
      "color": "",
      "extra": "M117 HelloLayer"
    }
  ]
}
```

---

### 4.2 `setLayerEvents`
Replaces the layer events for a specified plate.

#### Batch Validation & Transactional Semantics
The entire `events` batch is validated prior to modifying the model:
1. `plateIndex` must be an integer $\ge 0$ within integer range. Malformed types, out-of-range integer values (e.g. $\ge 2^{32}$), or negative values trigger immediate rejection.
2. `printZ` must be a finite number $\ge 0.0$.
3. `type` must be `'pause'` or `'custom'`. Unsupported types (`color_change`, `filament_change`, etc.) trigger immediate failure.
4. For `'custom'` events, `gcode` must be a non-empty string.
5. For `'pause'` events, `message` (if specified) must be a string.
6. `extruder` (if specified) must be an integer between 1 and 255. Integer range is validated before narrowing; out-of-range values (including $\ge 2^{32}$ or negative overflows) trigger immediate rejection.
7. Duplicate events at the same `printZ` height are rejected.
8. If any validation failure occurs, an exception is thrown and the existing events on the plate are **completely untouched** (atomic validation, zero partial mutations).
9. Validated events are automatically sorted ascending by `printZ` to ensure correct native `ToolOrdering` evaluation.

#### Parameters
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `plateIndex` | `number` (integer) | No | Target 0-based plate index (default: `0`). |
| `events` | `LayerEvent[]` | Yes | Array of layer events to configure. |

#### Event Object Properties
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `printZ` | `number` | Yes | Target height $Z$ in millimeters (finite, $\ge 0.0$). |
| `type` | `string` | Yes | Event type: `'pause'` or `'custom'`. |
| `gcode` | `string` | For `custom` | Raw G-code to emit at target layer (must be non-empty string). |
| `message` | `string` | Optional | Pause message to display on printer screen (string). |
| `extruder` | `number` (integer) | Optional | Extruder index between 1 and 255 (default: `1`). |

#### Return Value
```json
{
  "plateIndex": 0,
  "count": 2,
  "events": [ ... ]
}
```

---

### 4.3 `clearLayerEvents`
Clears layer events from a plate or across all plates.

#### Parameters
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `plateIndex` | `number` (integer) | No | Target 0-based plate index (default: `0`). Must be an integer $\ge 0$ within integer range. |
| `printZ` | `number` | No | If provided, clears only events matching this $Z$ height. Must be a finite number $\ge 0.0$. Validated prior to checking plate existence; invalid values throw `RuntimeError` rather than silently returning. |
| `allPlates` | `boolean` | No | If `true`, clears events across all plates. Must be a boolean if specified. |

#### Return Value
```json
{
  "plateIndex": 0,
  "clearedCount": 2,
  "remainingCount": 0
}
```

---

## 5. Plate Isolation & Slicing Integration

### Multi-Plate Isolation
Each plate maintains its own independent entry in `model.plates_custom_gcodes`. Configuring events on Plate 1 (`plateIndex: 0`) does not affect Plate 2 (`plateIndex: 1`).

### Slicing Pipeline Synchronization
When slicing via `slice({ plateIndex, ... })`:
1. `plateIndex` is validated before integer narrowing (must be non-negative integer within standard integer range, or omitted to slice default plate `curr_plate_index = 0`).
2. `m_model.curr_plate_index` is synchronized to the active plate index (with `SliceCleanupGuard` restoring it upon completion or failure).
3. `print.apply(m_model, config)` pulls custom G-codes for the active plate via `model.get_curr_plate_custom_gcodes()`.
4. `ToolOrdering::assign_custom_gcodes` attaches the plate's custom G-codes to corresponding layer tools.
5. G-code generation (`ProcessLayer::emit_custom_gcode_per_print_z`) emits:
   - For `pause`: `; PAUSE_PRINT` followed immediately by the executable `machine_pause_gcode` command (e.g. `PAUSE`).
   - For `custom`: `; CUSTOM_GCODE` followed by the configured raw G-code string.
6. Other plates sliced separately emit only their own configured events without cross-contamination.

---

## 6. 3MF Roundtrip Persistence

During project export (`saveProject`), OrcaSlicer serializes `model.plates_custom_gcodes` into `Metadata/custom_gcode_per_layer.xml`:
```xml
<custom_gcodes_per_layer>
  <plate>
    <plate_info id=\"1\"/>
    <layer top_z=\"2.0\" type=\"1\" extruder=\"1\" color=\"Insert magnet\" extra=\"Insert magnet\" gcode=\"PAUSE\"/>
    <layer top_z=\"4.0\" type=\"4\" extruder=\"1\" color=\"\" extra=\"M117 HelloLayer\" gcode=\"M117 HelloLayer\"/>
    <mode value=\"SingleExtruder\"/>
  </plate>
</custom_gcodes_per_layer>
```
When loading a project (`openProject`), `_BBS_3MF_Importer` reads the XML archive and restores `model.plates_custom_gcodes`. All layer events survive saving and reloading with full fidelity.
