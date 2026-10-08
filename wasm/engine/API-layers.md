# Variable Layer Height API (`API-layers.md`)

This document specifies the variable layer height and adaptive slicing engine operations in OrcaSlicer WebAssembly (`orca_engine`), their JSON RPC interfaces, desktop GUI correspondence, and 3MF lifecycle persistence.

---

## 1. Overview & Desktop Behavioral Correspondence

In desktop OrcaSlicer (`src/slic3r/GUI/GLCanvas3D.hpp:334`, `GLCanvas3D.cpp:768-830`), the Variable Layer Height tool enables fine-grained control over slice thicknesses along the $Z$ axis of an object:
- **Profile Bar & Interactive Brush**: A vertical bar positioned adjacent to the object represents $Z$ height (vertical) versus layer thickness (horizontal). Users interactively brush on the bar:
  - Left click / drag: increases (raises) layer thickness (`action: 'increase'`).
  - Right click / drag: decreases (lowers) layer thickness (`action: 'decrease'`).
  - Shift + drag: smooths layer transitions (`action: 'smooth'`) or reduces towards nominal (`action: 'reduce'`).
  - Scroll wheel: dynamically adjusts the brush band width (`bandWidth`).
- **Adaptive Calculation**: Uses exact facet slopes via `Slic3r::layer_height_profile_adaptive()` to automatically thin layers on shallow overhangs/domes for surface fidelity while thickening layers on steep vertical walls for print speed.
- **Gaussian Smoothing**: Applies moving-average Gaussian kernel smoothing via `Slic3r::smooth_height_profile()` with configurable `radius` and optional `keepMin` preservation.
- **3D Visualization**: The object is visually rendered with layer coloring matching the RdYlGn palette (thin layers in green, thick layers in orange/red).
- **Project Persistence & Slicing**: Profiles stored in `ModelObject::layer_height_profile` are serialized into 3MF project files (`Metadata/Slic3r_PE_layer_heights_profile.txt`) during `saveProject` and restored during `openProject`. Slicing (`PrintObjectSlice.cpp`) directly consumes the profile to generate discrete slice layers.

---

## 2. Profile Representation & Contracts

### Profile Format
A layer height profile is represented as a contiguous linear sequence of alternating `(z, height)` coordinate pairs:
```json
[z_0, h_0, z_1, h_1, z_2, h_2, ..., z_n, h_n]
```
- Even indices ($2k$): Height $Z$ from the object's bottom in millimeters ($0.0 \le z \le Z_{\text{max}}$), using the transformed object height independently of instance translation.
- Odd indices ($2k+1$): Layer thickness in millimeters at that height.
- Bound constraints: Layer thicknesses are constrained to $[h_{\text{min}}, h_{\text{max}}]$ defined by printer nozzle parameters (`min_layer_height`, `max_layer_height`).

### Layer Boundaries (`getObjectLayers`)
Discrete layer slice boundaries are computed by `Slic3r::generate_object_layers()` and represented as low/high pairs:
```json
[z_low_0, z_high_0, z_low_1, z_high_1, ...]
```
where layer $i$ spans $[z_{\text{low}, i}, z_{\text{high}, i}]$ with thickness $h_i = z_{\text{high}, i} - z_{\text{low}, i}$.

---

## 3. Engine JSON-RPC Operations

All operations are dispatched via `Engine::submit(op, argsJson)` and processed on the engine worker thread.

### 3.1 `getLayerHeightProfile`
Retrieves the current layer height profile for an object. If no custom profile has been generated or set, returns the default nominal profile generated from print configuration.

#### Parameters
| Field | Type | Description |
| :--- | :--- | :--- |
| `objectId` | `number` | **Required**. Target `ModelObject` ID or index. |

#### Return Value
```json
{
  "objectId": 1,
  "profile": [0.0, 0.2, 0.2, 0.2, ..., 20.0, 0.2],
  "minLayerHeight": 0.08,
  "maxLayerHeight": 0.28,
  "nominalHeight": 0.20,
  "layerHeight": 0.20,
  "firstLayerHeight": 0.20,
  "totalHeight": 20.0,
  "objectHeight": 20.0,
  "hasCustomProfile": false,
  "layerCount": 100,
  "layers": [0.0, 0.2, 0.2, 0.4, ...],
  "ranges": [
    { "bottom": 0.0, "top": 0.2, "height": 0.2 },
    { "bottom": 0.2, "top": 0.4, "height": 0.2 }
  ]
}
```

---

### 3.2 `setLayerHeightProfile`
Directly applies an explicit layer height profile to an object. Layer heights are clamped to $[h_{\text{min}}, h_{\text{max}}]$.

#### Parameters
| Field | Type | Description |
| :--- | :--- | :--- |
| `objectId` | `number` | **Required**. Target `ModelObject` ID. |
| `profile` | `number[]` | **Required**. Alternating `[z0, h0, z1, h1, ...]` pairs. Must have length $\ge 4$ and even. |

#### Return Value
```json
{
  "success": true,
  "objectId": 1,
  "profile": [...],
  "layerCount": 98,
  "layers": [...],
  "ranges": [...]
}
```

---

### 3.3 `adaptiveLayerHeights`
Computes an adaptive layer height profile based on surface cusp height and facet normal inclination.

#### Parameters
| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `objectId` | `number` | **Required** | Target `ModelObject` ID. |
| `quality` | `number` | `0.5` | Quality factor between `0.0` (speed, thicker layers) and `1.0` (quality, thinner layers). |

#### Return Value
```json
{
  "success": true,
  "objectId": 1,
  "profile": [...],
  "layerCount": 115,
  "layers": [...],
  "ranges": [...],
  "minLayerHeight": 0.08,
  "maxLayerHeight": 0.28
}
```

---

### 3.4 `smoothLayerHeights`
Applies a 1D Gaussian smoothing filter to the current layer height profile.

#### Parameters
| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `objectId` | `number` | **Required** | Target `ModelObject` ID. |
| `radius` | `number` | `5` | Gaussian smoothing kernel radius ($\ge 1$). |
| `keepMin` | `boolean` | `false` | When `true`, prevents smoothing from increasing layer heights above existing local minima. |

#### Return Value
```json
{
  "success": true,
  "objectId": 1,
  "profile": [...],
  "layerCount": 112,
  "layers": [...],
  "ranges": [...],
  "minLayerHeight": 0.08,
  "maxLayerHeight": 0.28
}
```

---

### 3.5 `adjustLayerHeights`
Applies an interactive brush edit at height `z` with specified delta and band width.

#### Parameters
| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `objectId` | `number` | **Required** | Target `ModelObject` ID. |
| `z` | `number` | **Required** | Height coordinate in mm where brush is applied. |
| `delta` | `number` | `0.005` | Layer thickness adjustment magnitude (`strength`). |
| `bandWidth` | `number` | `2.0` | Vertical influence band width in mm centered at `z`. |
| `action` | `'increase' \| 'decrease' \| 'smooth' \| 'reduce'` | `'increase'` | Editing action. |

#### Return Value
```json
{
  "success": true,
  "objectId": 1,
  "profile": [...],
  "layerCount": 104,
  "layers": [...],
  "ranges": [...],
  "minLayerHeight": 0.08,
  "maxLayerHeight": 0.28
}
```

---

### 3.6 `resetLayerHeights`
Clears custom layer height profile from the object and restores nominal uniform layering.

#### Parameters
| Field | Type | Description |
| :--- | :--- | :--- |
| `objectId` | `number` | **Required**. Target `ModelObject` ID. |

#### Return Value
```json
{
  "success": true,
  "cleared": true,
  "objectId": 1,
  "profile": [...],
  "layerCount": 100,
  "layers": [...],
  "ranges": [...]
}
```

---

### 3.7 `getObjectLayers`
Generates discrete slice layer boundaries for 3D visualization without mutating the object's stored profile.

#### Parameters
| Field | Type | Description |
| :--- | :--- | :--- |
| `objectId` | `number` | **Required**. Target `ModelObject` ID. |

#### Return Value
```json
{
  "objectId": 1,
  "layerCount": 100,
  "layers": [0.0, 0.2, 0.2, 0.4, ...],
  "ranges": [
    { "bottom": 0.0, "top": 0.2, "height": 0.2 },
    { "bottom": 0.2, "top": 0.4, "height": 0.2 }
  ]
}
```

---

## 4. Slicing and Persistence Lifecycle

1. **Storage**: `ModelObject::layer_height_profile` stores the custom profile. When non-empty, `has_custom_layering()` returns `true`.
2. **Project Save/Load**: Cereal and 3MF export/import write the profile to `Metadata/Slic3r_PE_layer_heights_profile.txt`. Calling `saveProject` preserves the profile; subsequent `openProject` deserializes it back into `ModelObject::layer_height_profile`.
3. **Slicing**: During `PrintObjectSlice.cpp::slice()`, `update_layer_height_profile()` evaluates `ModelObject::layer_height_profile` and applies the variable layers to `m_layers`. The resulting toolpath G-code coordinates directly reflect the variable $Z$ positions.
