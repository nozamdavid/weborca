# Snapmaker Cloud machine filament mapping

Current release, 2026-11-05: the exact filament candidate is published on CURRENT5070. Device displays read-only printer-reported assignments: material, vendor, subtype, color and explicit presence. The [actual idle comparator](../wasm/build/tests-snapmaker-filaments/actual/report.md) matched all four physical tools in order: Grey PLA/Generic `#8C9099`, Blue PLA/Bambu Lab Silk `#0047BB`, Black PLA/Bambu Lab Matte `#000000`, White PLA/Generic `#FFFFFF`; all source presence values were boolean true. The physical comparison establishes color families, not measured hex equality. Explicit extruder indices 0–3 matched array positions, and exact source/gateway/decoder inventories survived nonretained heater deltas and a fresh query.

Physical unload/reassignment, no-tag behavior, job lifetime, live empty/unknown transitions and other accounts remain unvalidated. `filaments` stays omitted; read-only `filamentSlots` enables no project synchronization, uploads or controls. [Sealed QA](../wasm/build/tests-snapmaker-filaments/qa-recovered/report.md) records reconstructed source provenance, exactly one Vite build/zero native builds, 101 tests without skips, 12 layouts, preserved shipped lighting/desktop CSS and no FPS. See [publication/rollback evidence](../wasm/build/tests-snapmaker-filaments/publication/report.md). Restart cleared OrcaCloud RAM sign-in; browser presets remain. Bambu China and physical Safari/accessibility TODOs remain open.

The investigation and acceptance plan below are historical, preceding implementation and the bounded actual idle acceptance. Their idle acceptance requirement is now satisfied for the tested account/device; the broader physical transitions remain open.

Investigated 2026-11-05. **Yes, first-party consumers expose a material assignment per tool through `print_task_config`. Native Orca deliberately treats these values as connected-machine filaments and offers filament sync from them.** This is stronger evidence than the object's name or subscription field list. It supports displaying **printer-reported material assignments**; it does not prove that every assignment describes a physically fed spool, was detected automatically, or remains fresh after a spool change. At research time, idle, unload and reassignment behavior still required live acceptance.

This follows [native UI research](snapmaker-cloud-native-ui.md), [MQTT research](snapmaker-cloud-mqtt.md), [account research](snapmaker-cloud-integration.md) and [Control API research](snapmaker-control-api.md). The parent reports deployed, real-tested status, five heater temperatures and deltas. Filaments have not been accepted live. The current monitor's selectors and browser decoder expose status/progress/heaters only: [monitor](../wasm/app/gateway/snapmakerMonitor.ts), [decoder](../wasm/app/src/printers/snapmakerTelemetry.ts). This document specifies a read-only extension, not a new transport or control API. Local UI seams are covered by the separate [seams report](../wasm/build/tests-snapmaker-filaments/seams/report.md).

## Evidence identities

All GitHub source citations below pin Snapmaker/OrcaSlicer commit **`6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c`**. `[O]` is the checked-in Flutter JS, whose SHA-256 is `b347974c91352c2f912471e71659a4d2f96d69c9772a9fc2430f4dee7ad577d5`. Its F13/F15/F16 selector/model traces establish requested fields and incremental storage, not physical semantics by themselves. [O-fields][O-update][O-config]

`W:L…` means original lines in the retained **Control v1.8.5** `main.dart.js`, SHA-256 **`96109093573873627edd92bc538d46eaa0f46470f337a8d1f281e0f4db07f657`**, from the official locked Linux archive SHA-256 **`7517626d127adcc057982b22c353ee38043bbe0bdece41c5df5e2d52dce3dd96`**. [Release provenance](snapmaker-control-api.md#verified-release-and-evidence) records verification. Packaging replaces the checked-in Flutter directory with the release web assets; the two JS versions must remain distinct. [lock][stage]

The [public archive URL][archive] is versioned but publisher-replaceable; the locked hash identifies the inspected bytes. Thus W citations are hash-pinned primary evidence, not a claim that a release URL is immutable. Numbered [W excerpts](../wasm/build/tests-snapmaker-filaments/research/control-filament-excerpts.txt) retain the consumer chain; full original bytes already exist in the earlier ignored evidence directory. Native public excerpts and hashes are retained in the same [research directory](../wasm/build/tests-snapmaker-filaments/research/).

## What proves machine material semantics

The complete native chain is:

1. `query_gateway_current_device()` obtains the connected selected serial, then queries `query.device.objects` and registers `action.device.watch`. This operates on the connected printer, without reading a local sliced-job material list. [current]
2. `GatewayDevice::parse_machine_slots()` reads **`objects.print_task_config`**, constructs `ConnectMachineInfo` entries with index `i`, vendor/type/subtype/color/existence and nozzle data, and ignores `extruder_map_table` and `extruders_used`. [slots]
3. `GUI_App` replaces `PresetBundle::m_connect_machine_info_list` with the decoded list and refreshes presets when the list changes. Notifications containing `print_task_config` or extruder objects trigger a fresh object query. [apply][delta]
4. `PresetComboBoxes` labels that list **“Machine Filament”**, matches compatible presets and draws numbered icons `i + 1`. Its comment explicitly says slot state is owned by device sync. [combo]
5. `build_machine_filament_list()` copies those exact entries into the machine side of filament sync. `continue_sync_filament_dialog()` distinguishes machine and design lists, rejects a non-U1 machine, and says **“No filaments detected on the printer. Please preload the filaments before syncing.”** when the machine list is empty/all empty. Accepted sync can alter project filament count, presets and colors. [machine-list][sync][sync-apply]

This is an intentional first-party interpretation of the object as machine material state. The exact native UI label is **“Machine Filament”**, not a quoted “Loaded slots” label. It would be inaccurate to dismiss the object as merely job requirements; it would also be inaccurate to claim the consumers prove physical feeding or automatic spool recognition.

The packaged Control UI independently confirms the interpretation:

- Its `bPF` provider selects the generic object state for `print_task_config`, and generated provider `bYG` binds `bPF` (W:L147699–147702, L190324). `c8s` converts its parallel arrays into indexed material records (W:L39117–39151); `bMx` creates `vendor`, `material`, `serie`, `filamentExist`, edit/SKU/official/nozzle/multicolor fields (W:L145618–145636).
- `ye.bS`/`mb` requires a connected current device, runs `c8s`, and constructs up to four `MaterialHead` records. `adj` uses the existence flag for `isFed`; false displays `/`, while an existing material whose type is `NONE` displays `?`. Detection info supplies ID and temperature limits, while the displayed vendor/type/color still come from `print_task_config` (W:L153190–153231, L145649–145651).
- `c8t` reads **`filament_detect.info` as an ordered list** and decodes each entry through `c0z`; `ye.adj` pairs detection entry `s` with assignment entry `s`. `c0z` reads uppercase RFID-like metadata (`VENDOR`, `MAIN_TYPE`, `SUB_TYPE`, `ARGB_COLOR`, `SN`, `CARD_UID`, temperature limits, etc.). That proves a detection consumer, not that every connected printer publishes a populated tag or that tag identity overrides manually assigned material (W:L39150–39155, L41828–41881, L153204–153221). `Vm` stores constructor argument 12 as `Q`, and its string representation calls `Q` `isFed`, completing that existence-to-display chain (W:L39259–39274, L145649–145651).

No firmware producer or proprietary Control server source was available in this chain. The binary distribution explicitly lacks source. [control-source] Consequently the lifetime of `print_task_config` across job completion, its update ordering with detection and its physical sensor guarantees remain unproven.

## Index mapping: physical tools and material slots

| Identifier | Proven interpretation | Implementation consequence |
| --- | --- | --- |
| Parallel array position `i` | Native sets `ConnectMachineInfo.index = i`, starting at zero. Control `c8s` also emits index `i`. [slots]; W:L39117–39151, L145618–145636 | Preserve positions, including empty positions. Never compact entries after unload. |
| Native visible number | Machine-filament icon uses `i + 1`. [combo] | Tool/slot index 0 can display as T1/1; do not change the stored identity. |
| Object name | Native nozzle parser maps `extruder` to ordinal 0 and numeric suffix to that ordinal, then sorts by ordinal. It does not consult `extruder_index`. [nozzles] | Keep the object key and ordinal; do not lexically sort `extruder10` before `extruder2`. |
| Explicit `extruder_index` | Packaged heater model retains it and resolves index to that value, falling back to the object ordinal (W:L150494–150522). `bSi` groups extruders by that resolved index and uses that index to read `print_task_config` type/subtype/color/multicolor arrays (W:L39430–39465). | This is the strongest inspected join between physical extruder telemetry and material arrays. For a tool-oriented view, join by resolved index; preserve raw object key, explicit index and array position for diagnosis. |
| `extruder_map_table`, `extruders_used` | Older selector/model requests/stores them, but neither native slot construction nor the traced packaged material-head/physical-extruder joins use them. [O-fields][O-config][slots]; W:L39117–39158, L39430–39465 | No authoritative mapping direction, index base, sentinel or loaded-state role was established. Do not reorder inventory through these fields or infer loaded tools from job-use flags. |

For a normal contiguous U1 configuration, array position 0 joins resolved extruder index 0 (`extruder` absent an override), position 1 joins index 1, and so on. Native slot/nozzle construction has a caveat: `parse_extruder_objects()` **pushes only valid nozzle entries into a dense vector**, then `parse_machine_slots()` associates vector position with array position. A missing/sparse/invalid nozzle can therefore shift associations; this is not proof that firmware tool IDs are dense. The packaged resolved-index join handles a different case. Reject/mark ambiguous duplicate, negative, nonintegral or conflicting indices rather than guessing. [nozzles][slots]; W:L39430–39465

There is no demonstrated AMS-style bank or independently addressed spool carousel in this trace. A “slot” here is the machine assignment at a tool index. It is not the project filament ordinal, mixed/virtual material ID, RFID serial, active-tool selection or a guaranteed spool identity. Sparse tool IDs must retain their holes; validate explicit index overrides on a real U1 before silently remapping labels.

## Exact native decoding and presence rules

These are **native compatibility rules**, not recommended sensor truth defaults. [slots][colors]

| Input | Native result |
| --- | --- |
| Missing/non-object `print_task_config`, or missing/non-array vendor **or** type | Decode fails; no new machine list applied. |
| Valid vendor/type arrays | Count is `max(vendor.length, type.length)`, not number of heaters or colors. Both empty can produce a successful empty list. |
| Missing/short/null/non-string vendor/type element | That element becomes string `NONE`. No enum validation or preset identity is established. |
| `filament_exist[i] === true` | Material considered present. |
| Existing in-range element `false`, `null`, numeric 0/1, string or other nonboolean | Material considered absent; type and vendor become `NONE`, display name is `NONE`. |
| Missing/non-array `filament_exist`, or no element at `i` | Native assumes present. This is a compatibility fallback, **not affirmative evidence of filament presence**. |
| Missing/short/non-string subtype | `NONE`; omitted in ordinary display name. `Support` yields `vendor + " Support For " + type`; other nonempty/non-`NONE` subtype appends to `vendor type`. |
| No usable nozzle diameter for any constructed slot | Whole decode fails. Config `nozzle_diameters`/`nozzle_volume_types` can override discovered extruder nozzle values. |

Native does not erase color on an absent slot. An old color beside `filament_exist:false` is not a loaded material. Unknown `NONE` strings with a true presence flag are not the same as empty.

**Packaged Control differs:** `c8s` enumerates the preferred nonempty color array, not the max vendor/type length. Its `bMx` defaults missing/null existence to **false**; `ye.adj` tests equality with `true` and labels absence `/`. Missing colors or a disconnected device instead produce four placeholder heads. Its placeholder count is a UI fallback, not discovery of four occupied slots (W:L39117–39185, L145618–145636, L153190–153231). Do not combine native's assumed-present fallback with Control's placeholder count to manufacture four loaded tools.

Recommended normalized read model: distinguish `present` (explicit boolean true), `empty` (explicit boolean false), and `unknown` (missing, null, invalid, stale or unsupported). Preserve raw presence and metadata separately. For invalid/null elements, native compatibility would render empty, but a conservative monitor should expose unknown and withhold sync. When false arrives, clear effective material/vendor/type/color/SKU for display/sync atomically, while optional raw diagnostics can retain the provider's old assignment. A missing field in a **delta** does not clear anything; a missing field in a new **snapshot** must not inherit the old session's value.

## Vendor, type and color

Vendor and type are free strings consumed by the native display/preset matcher; subtype is separate. `filament_sku` and `filament_official` are requested and used by the packaged material record, but native `ConnectMachineInfo` construction does not use them. No public SKU-to-WebOrca-preset identity contract was proven. Keep provider spelling and do not convert “official” into proof of RFID recognition. [slots][combo]; W:L145618–145636

Native color precedence is per element: string `filament_color_rgba[i]`, else string/integer `filament_color[i]`, else white fallback. Integer colors are masked to uint32 **ARGB `0xAARRGGBB`**, rotated into **RRGGBBAA**, formatted as eight hex digits, then normalized. Negative signed integers use their low 32 bits. String values pass straight to normalization, without integer ARGB rotation. [color-decode]

`NormalizeFilamentHexColor` trims whitespace, strips an optional `#`, accepts six or eight hex digits, **drops the final alpha byte** from eight digits, and uppercases to `#RRGGBB`. It does not accept a `0x` string prefix; invalid preferred RGBA strings fall back to white rather than retrying the legacy field. Therefore a white native swatch may be a decoding fallback, not measured white filament. [colors]

`filament_color_multi[i]` is an object with `colors` (normalized valid strings) and integer `mode`. Native maps 0 to Segment and other accepted nonnegative modes to Gradient; zero/one valid color forces Segment. An empty multicolor list falls back to the normalized single color. [slots][modes]

For example, **invented decoder input, not a public printer payload**:

```json
{
  "objects": {
    "extruder": {"nozzle_diameter": 0.4, "extruder_index": 0},
    "extruder1": {"nozzle_diameter": 0.4, "extruder_index": 1},
    "print_task_config": {
      "filament_vendor": ["ExampleCo", "PreviousCo"],
      "filament_type": ["PLA", "PETG"],
      "filament_sub_type": ["Matte", "NONE"],
      "filament_exist": [true, false],
      "filament_color": [4279312947, 4294901760]
    }
  }
}
```

Native result: index 0, “ExampleCo PLA Matte”, color `#112233` (`4279312947 = 0xFF112233` → `112233FF` → `#112233`); index 1, name/type `NONE`, though its native color remains `#FF0000`. A monitor should display the second tool as empty and suppress its stale PETG/red identity. Removing the entire presence field would make native assume both present; the recommended monitor would mark both presence values unknown. [slots][color-decode][colors]

## Minimal read-only monitoring extension

Restrict to objects actually advertised by `printer.objects.list`. Add this selector to the existing monitor's query, subscribe and serial-scoped subscribe-filter maps; do not change broker/authentication or issue material-edit commands. The older selector [O-fields] and packaged selector (W:L42065–42115) independently request these fields:

```json
{
  "print_task_config": [
    "filament_vendor", "filament_type", "filament_sub_type",
    "filament_exist", "filament_color_rgba", "filament_color",
    "filament_color_multi"
  ],
  "extruder": ["extruder_index", "nozzle_diameter", "nozzle_volume_type"],
  "extruder1": ["extruder_index", "nozzle_diameter", "nozzle_volume_type"]
}
```

This is a selector fragment: **union** extruder metadata with existing temperature/target selectors and include every advertised extruder key, not just the two illustrated. Vendor/type/presence are the minimum material identity/presence fields; subtype and both color encodings avoid misidentifying the native display. Multicolor preserves a supported material appearance. Nozzle metadata supports the native matching chain. `nozzle_diameters` and `nozzle_volume_types` are optional config-array overrides read by native but absent from the traced explicit packaged selector; do not assume delivery without checking the actual response. [slots]; W:L42085, L42105

SKU/official can be added if needed for displayed metadata; they are unnecessary to native name/type/color mapping. Do not add `extruder_map_table`, `extruders_used`, feed objects or detection to the minimal implementation merely because they exist. If the product requires tag identity/temperature limits, separately accept `filament_detect:null` and its `info` list before enabling that enrichment. `filament_feed left/right` was requested in both clients, but this investigation found no authoritative feed-channel-to-U1-tool join in the cited display chain. [O-fields]; W:L42098–42101, L39152–39158, L153204–153220

## Reassignment, deltas and stale data

The older MQTT decoder merges partial updates and only assigns `PrintTaskConfig` fields when non-null. Arrays replace their respective fields; it does not establish array-element patch semantics. [O-update][O-config] Packaged Control routes generic objects through `lt.dF` → `c9h`/`c8o` → `bMq`: nested maps merge, while non-map values (including arrays and explicit null) replace the old field. Omitted fields retain their values (W:L150287–150326, L150574–150576, L41725–41738, L150471–150486). Its typed heater decoder instead retains old fields for null/invalid values (W:L150494–150522). Thus even first-party clients differ on null handling; the generic config merge supplies a concrete reason to preserve explicit null through the cloud adapter. These are client behaviors, not firmware promises about the meaning of null.

For a monitoring adapter:

- Merge omitted delta fields into the current serial/session snapshot. Replace an explicitly supplied array as a whole; never append, compact, or retain an old tail after a shorter array. Recompute the complete tool inventory after a relevant change.
- Treat explicit null/non-array config or explicit empty identity arrays as invalid/empty new information, not permission to keep showing old material as current. Mark unknown and request a fresh read snapshot if the update cannot form a coherent inventory. Preserve missing-versus-null distinctions at the allowlist boundary.
- Reassignment belongs to the stable tool index: swap vendor/type/color/presence together on a full snapshot. Separate field deltas can briefly disagree; no atomic generation/timestamp contract was proven. After incompatible lengths, conflicting indices or a reassignment sequence, refresh before offering sync.
- Clear or mark inventory stale on disconnect, serial change, reconnect/resubscribe or telemetry timeout. Discard old in-flight replies by connection generation and serial. Native explicitly guards both, clears slots on device changes and disconnect, and coalesces an additional query when changes arrive during a query. Native parse/query errors otherwise leave the previous list in place; a web UI must not confuse that retained list with confirmed freshness. [current][apply][delta]
- Native refreshes on any config/extruder delta and compares the fully decoded lists, including color and nozzle metadata. The current cloud monitor should keep its existing transport and snapshot lifecycle; widen its allowlists and normalized model together so filament fields are not requested then silently dropped. [delta][apply]; [current local decoder](../wasm/app/src/printers/snapmakerTelemetry.ts)

Display “printer-reported” assignment plus connection/freshness state. Reserve “empty” for accepted explicit absence. A physical tool with unknown presence can show reported metadata as unconfirmed, but it should not become an automatically syncable occupied slot. Native sync is a user action that can change project presets/colors; monitoring should not silently synchronize projects. A matching material type alone does not prove an exact compatible preset. [combo][sync-apply]

## Remaining live acceptance

No new account/provider/device calls were made. Before describing this as live loaded-filament support, the parent task needs sanitized evidence from its already authorized monitor:

1. An idle initial snapshot containing advertised config fields and extruder indices; compare every tool against the official material display and known physical loading. This distinguishes persistent machine assignments from values populated only while a task is active.
2. A material reassignment and unload/reload on one tool: observe exactly which fields change, whether absence is boolean false, whether old metadata remains, and whether assignment/presence arrive in separate deltas. Include a manually assigned material and an unrecognized/no-tag spool if available.
3. Start/end or cancel an ordinary job whose material requirements differ from another idle tool. Confirm job-use/mapping fields do not reorder or replace idle inventory; capture the actual mapping only if it is needed. No such mapping should be implemented from this report's field names.
4. Confirm ARGB integer and RGBA-string examples against the official swatch, multicolor mode if present, sparse/explicit tool-index behavior if reported, and missing/null/short-array handling through sanitized replay fixtures.
5. Disconnect/reconnect and change selected serial: no previous printer's materials may be displayed as current or offered for sync. Verify resnapshot and delta clearing, including empty slots retaining old color/type values.

The supported implementation boundary is **read the connected printer's assignment arrays using the first-party index/decoder chain, retain explicit presence and freshness, and expose inventory for review**. Physical feed guarantees, tag accuracy, firmware null semantics, mapping-table direction and assignment lifetime across print tasks remain acceptance requirements, not established telemetry facts.

## Documentation checks

Read AGENTS.md and the research skill; followed the explicit no-delegation and restricted-write scope. Inspected retained primary JS before fetching pinned native public sources. Checked citation line bounds, local links, source hashes and whitespace. No builds, test suites, services, live authentication/provider/device calls or source edits were used. The selector examples are proposed read contracts, not commands or captured public payloads. README and project tracking changes belong to the parent task.

[O-fields]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L35185-L35224
[O-update]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L141968-L142117
[O-config]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/resources/web/flutter_web/main.b347974c91352c2f.js#L142250-L142290
[lock]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/.github/connect-bundle.lock.json#L1-L11
[stage]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/scripts/packaging/stage_connect_bundle.py#L210-L245
[archive]: https://github.com/Snapmaker/snapmaker_control/releases/download/v1.8.5/snapmaker_control-1.8.5-linux-x64.tar.gz
[control-source]: https://github.com/Snapmaker/snapmaker_control/blob/e664cba6adf7cd5cda9a164401662ea263aad6bf/README.md#L8-L16
[current]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/GUI_App.cpp#L5889-L5949
[apply]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/GUI_App.cpp#L5952-L6069
[slots]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayDevice.cpp#L190-L287
[delta]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayDevice.cpp#L290-L320
[color-decode]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/Utils/GatewayDevice.cpp#L138-L171
[nozzles]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/libslic3r/SSWCPProtocol.cpp#L141-L197
[combo]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/PresetComboBoxes.cpp#L1373-L1441
[machine-list]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/Plater.cpp#L788-L806
[sync]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/Plater.cpp#L9321-L9401
[sync-apply]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/slic3r/GUI/Plater.cpp#L9400-L9465
[colors]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/libslic3r/FilamentColorLibrary.cpp#L70-L89
[modes]: https://github.com/Snapmaker/OrcaSlicer/blob/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/src/libslic3r/FilamentColorLibrary.hpp#L11-L15
