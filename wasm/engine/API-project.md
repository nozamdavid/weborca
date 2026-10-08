# Orca WASM Engine API - Project Operations

Extensions to the Orca WASM engine for opening, saving, and round-tripping OrcaSlicer 3MF projects (`openProject`, `saveProject`) and loading 3MF model geometry (`loadModel`).
All operations run on the engine pthread and return standard `{"ok": true, "result": ...}` or `{"ok": false, "error": "..."}` JSON payloads.

---

## Operations

### `openProject`
Loads an OrcaSlicer 3MF project file archive (`.3mf`).
This operation reads:
- Model geometry, volume hierarchy, and per-object/per-volume configs (`Metadata/model_settings.config`, `Metadata/Slic3r_PE_model.config`)
- Plate metadata and object-to-plate instance mapping (`Metadata/model_settings.config`, `Metadata/slice_info.config`)
- Project-wide configuration (`Metadata/project_settings.config`)
- Embedded printer, process, and filament presets (`Metadata/project_embedded_presets/*.json`)
- Selects the loaded/associated presets in the `PresetBundle` and clears pending option overrides.

- **Arguments**:
  ```json
  {
    "path": "/models/OrcaBadge.3mf"
  }
  ```

- **Result**:
  ```json
  {
    "objects": [
      {
        "id": 18,
        "name": "OrcaSlicer Badge Horizontal",
        "instances": 1,
        "volumes": 17,
        "size": [98.85, 23.68, 1.4],
        "extruder": 1,
        "config": {
          "extruder": "1"
        },
        "instancesDetail": [
          {
            "id": 1,
            "offset": [135.5, 172.73, 0.8],
            "rotation": [0.0, 0.0, 0.0],
            "scale": [1.0, 1.0, 1.0]
          }
        ],
        "volumesDetail": [
          {
            "id": 1,
            "name": "orca_badge.obj",
            "type": 0,
            "extruder": 1,
            "config": {
              "extruder": "1"
            }
          }
        ]
      }
    ],
    "plates": [
      {
        "index": 0,
        "name": "Plate 1",
        "locked": false,
        "filamentMaps": [1, 2, 3, 4],
        "instances": [
          {
            "objectId": 18,
            "instanceId": 1
          }
        ],
        "config": {}
      }
    ],
    "selectedPresets": {
      "printer": "Voron 2.4 300 0.4 nozzle",
      "process": "0.20mm Standard @Voron",
      "filaments": ["Generic PLA @System"]
    },
    "substitutions": [],
    "warnings": []
  }
  ```

---

### `saveProject`
Exports the current model geometry, instance placements, per-object/per-volume overrides, active plates, project configuration, and current selected/embedded presets into a standard OrcaSlicer 3MF archive (`store_bbs_3mf`).
Does not generate or export thumbnails or sliced G-code.

- **Arguments**:
  ```json
  {
    "path": "/out/saved_project.3mf"
  }
  ```

- **Result**:
  ```json
  {
    "path": "/out/saved_project.3mf"
  }
  ```

---

### `loadModel` (with 3MF Support)
Loads model geometry from `.stl`, `.obj`, or `.3mf` files, replacing the currently loaded model.
For `.3mf` files, passes `LoadStrategy::LoadModel | LoadStrategy::AddDefaultInstances` so that model geometry and instance hierarchies are imported properly without requiring project-level preset bundle replacement.

- **Arguments**:
  ```json
  {
    "path": "/models/OrcaBadge.3mf"
  }
  ```

- **Result**:
  ```json
  {
    "objects": [
      {
        "id": 1,
        "name": "OrcaSlicer Badge Horizontal",
        "instances": 1,
        "volumes": 17,
        "size": [98.85, 23.68, 1.4]
      }
    ]
  }
  ```
