# Text & Emboss API (`addText`, `updateText`, `getText`)

This document describes the 3D Text and Emboss engine operations in OrcaSlicer WebAssembly (`orca_engine`), their serialization contracts, coordinate system conventions, font loading architecture, and 3MF project round-tripping.

---

## 1. Overview

OrcaSlicer WASM Text and Embossing is ported directly from desktop OrcaSlicer (`src/libslic3r/Emboss.cpp`, `src/slic3r/GUI/Gizmos/GLGizmoEmboss.cpp`, and `src/slic3r/GUI/Jobs/EmbossJob.cpp`).

Key architectural principles:
- **Zero FreeType Dependency**: `Emboss.cpp` evaluates TrueType/OpenType font outlines using embedded `stb_truetype` (`imgui/imstb_truetype.h`), which is compiled into `libslic3r.a`.
- **Exact Vector Outlines**: Glyphs are extracted as bezier contours, converted to integer polygon representations (`ExPolygonsWithIds`), healed with Clipper union (`union_with_delta`), and extruded via `Emboss::polygons2model` with `ProjectZ` and `ProjectTransform`.
- **Closed 2-Manifold Meshes**: Extruded text meshes are watertight with zero open boundary edges, suitable for slicing and CSG boolean subtraction.
- **Round-Trip Persistence**: Text parameters are stored in `ModelVolume::text_configuration` (`TextConfiguration`) and `ModelVolume::emboss_shape` (`EmbossShape`), which serialize to 3MF project archives (`Format/bbs_3mf.cpp`).
- **Font Buffer & MEMFS Injection**: In the browser sandbox, bundled open-source fonts (`DejaVu Sans`, `Liberation Sans`) are served from static assets and written to MEMFS (e.g. `/fonts/DejaVuSans.ttf`). Custom user TTF/OTF fonts can also be written to MEMFS or passed as font bytes.

---

## 2. Engine Operations

### 2.1 `addText`

Adds 3D embossed or engraved text as a new object or as a part, modifier, or negative volume on an existing object.

#### Parameters (`AddTextParams`)

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `objectId` | `number` | Optional | Parent object ID. Required when `volumeType` is `'part'`, `'modifier'`, or `'negative'`. |
| `volumeType` | `'part' \| 'modifier' \| 'negative' \| 'new_object'` | `'new_object'` | Target volume type. `'new_object'` creates a new `ModelObject` on the print bed. |
| `text` | `string` | **Required** | The UTF-8 text string to emboss (e.g. `"Orca"`). |
| `fontData` | `string` | Optional | MEMFS path to font file (e.g. `"/fonts/DejaVuSans.ttf"`) or base64-encoded font bytes. |
| `fontPath` | `string` | Optional | Alternative MEMFS file path to font file. |
| `fontName` | `string` | `'DejaVu Sans'` | Human-readable font name stored in `TextConfiguration`. |
| `size` | `number` | `10.0` | Font height in millimeters (`size_in_mm`). |
| `depth` | `number` | `1.0` | Extrusion thickness in millimeters (`projection.depth`). |
| `charGap` / `char_gap` | `number` | `0` | Extra character spacing in font points. |
| `lineGap` / `line_gap` | `number` | `0` | Extra line spacing in font points. |
| `boldness` | `number` | `0.0` | Contour stroke offset in millimeters. |
| `skew` | `number` | `0.0` | Italic slant ratio (CW tilt). |
| `align` | `object \| string` | `'center'` | Alignment pivot. Object `{ horizontal: 'left'\|'center'\|'right', vertical: 'top'\|'center'\|'bottom' }`. |
| `useSurface` / `use_surface` | `boolean` | `false` | Whether text conforms to curved model surface or stays planar. |
| `position` | `[number, number, number]` | Optional | Surface click / anchor position in world coordinates `[x, y, z]`. |
| `normal` | `[number, number, number]` | `[0, 0, 1]` | Surface outward normal unit vector `[nx, ny, nz]`. |
| `rotation` | `number` | `0.0` | Rotation angle around normal in radians (or degrees). |
| `name` | `string` | Optional | Custom name for the volume/object. Defaults to `text`. |

#### Returns (`AddTextResult`)

```json
{
  "objectId": 1,
  "volumeId": 2,
  "name": "Orca",
  "triangleCount": 420,
  "boundingBox": [-12.5, -4.8, 18.0, 12.5, 4.8, 20.0]
}
```

---

### 2.2 `updateText`

Regenerates the 3D mesh of an existing text volume in-place while keeping its volume ID, object hierarchy position, and volume type.

#### Parameters (`UpdateTextParams`)

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `objectId` | `number` | **Required** | Target object ID. |
| `volumeId` | `number` | **Required** | Target volume ID to update. |
| `text` | `string` | Existing text | New text string. |
| `size` | `number` | Existing size | Font height in mm. |
| `depth` | `number` | Existing depth | Extrusion thickness in mm. |
| `fontData` / `fontPath` | `string` | Existing font | MEMFS path or font bytes. |
| `charGap`, `lineGap`, `boldness`, `skew`, `align` | ... | Existing values | Style properties. |
| `position`, `normal`, `rotation` | ... | Existing transform | Transformation update if re-placed. |

#### Returns (`UpdateTextResult`)

```json
{
  "objectId": 1,
  "volumeId": 2,
  "name": "OrcaSlicer",
  "triangleCount": 780,
  "boundingBox": [-22.1, -4.8, 18.0, 22.1, 4.8, 20.0]
}
```

---

### 2.3 `getText`

Reads the stored text parameters and configuration from an existing text volume.

#### Parameters (`GetTextParams`)

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `objectId` | `number` | Object ID containing the volume. |
| `volumeId` | `number` | Volume ID of the text volume. |

#### Returns (`GetTextResult`)

```json
{
  "objectId": 1,
  "volumeId": 2,
  "text": "Orca",
  "fontName": "DejaVu Sans",
  "fontPath": "/fonts/DejaVuSans.ttf",
  "size": 10.0,
  "depth": 1.0,
  "useSurface": false,
  "charGap": 0,
  "lineGap": 0,
  "boldness": 0.0,
  "skew": 0.0,
  "align": {
    "horizontal": "center",
    "vertical": "center"
  }
}
```

---

## 3. Geometric & Coordinate Contracts

### Surface Normal & Placement Matrix
1. **Surface Anchor (`create_transformation_onto_surface`)**:
   Given a surface hit point $P$ and outward normal $N$, the transformation matrix aligns the text's local $+Z$ axis with $N$ and sets the text origin at $P$.
   The volume transformation relative to the object instance $M_{\text{inst}}$ is:
   $$M_{\text{vol}} = M_{\text{inst}}^{-1} \cdot M_{\text{surface}}$$

2. **Negative vs. Positive Depth Offset (`SAFE_SURFACE_OFFSET`)**:
   - **`negative` volumes**: The text penetrates into the body by `depth`. To avoid degenerate coplanar surfaces at the interface during slicing CSG difference, the mesh starts slightly above the surface at $+0.015\text{ mm}$ and penetrates to $-(\text{depth} - 0.015)\text{ mm}$.
   - **`part` / `modifier` volumes**: The text extends outward along the normal by `depth`. The base extends $-0.015\text{ mm}$ into the model to guarantee watertight contact.
   - **`new_object`**: Placed directly on the build bed spanning $Z \in [0, \text{depth}]$.

---

## 4. 3MF Persistence & Slicing Guarantee

- **Project Save / Open**: `Format/bbs_3mf.cpp` stores `TextConfigurationSerialization::to_xml` and `EmbossShape` tags into `3D/3dmodel.model`. On reload, `ModelVolume::text_configuration` is populated and accessible via `getText`.
- **Slicing**:
  - `negative` text volumes subtract material from object slices, reducing extrusion line counts in affected layers.
  - `new_object` and `part` text volumes generate positive toolpaths.
