# Creality connected filament inventory

Published to CURRENT5070 on 2026-11-05 in `ui-connected-filaments-candidate-20261105`, **SYNTHETIC_ONLY**. Representative source-contract fixtures verify CFS/racks, sparse indices, presence/color and failure clearing. Real Creality hardware and unload/reassignment acceptance remain open. See the [publication receipt](../wasm/build/tests-connected-filaments/publication/report.md).

`CrealityCloudApi` publishes read-only `PrinterState.filamentSlots` through its existing multicolor/CFS polling. The request remains `POST /api/rest/iotrouter/rpc/twoway/{tbId}` with exactly `{"method":"get","params":{"cfsList":1}}`. The gateway already permits this request; no gateway change is needed. Polling remains gated by `multicolor === 1` or `cfsInsert === 1`. Ordinary printers without those flags report inventory unavailable, including external spools that this RPC has not reported.

## First-party contract evidence

The owning consumer is [CrealityPrint device-manager asset D-MKTaRJ.js](https://github.com/CrealityOfficial/CrealityPrint/blob/b83100d320be8cddede57e0c2c5395d8c06ef7f4/resources/web/deviceMgr/assets/D-MKTaRJ.js), pinned to commit `b83100d320be8cddede57e0c2c5395d8c06ef7f4`. Relevant symbols are `GetDeviceCFS`, `setCFSFromCxCloud`, `CFSFilamentItem`, and the smart-rack `filamentDetected` projection. Local fetched bytes have SHA-256 `d09c6782acc07fda5a844688c1f70169e120eda441d9c9b18974a50ca0839a85`.

The [v6.0.3 device-manager asset CkH49cmA.js](https://github.com/CrealityOfficial/CrealityPrint/blob/c66cbc6b9d4759385cbec1aa94b9a2100bb21d71/resources/web/deviceMgr/assets/CkH49cmA.js) corroborates the RPC, array identities, color conversion, and ordinary rack assignment. Its SHA-256 is `e37624c645d8e9eaa6d543956daa85394488f1ef5b921a6392ef5e9dda9ab29b`. That older consumer hardcodes CFS material state to 1; the newer consumer forwards `rfidState` instead. Neither source is a captured account response or a firmware protocol guarantee.

| Reported field | Consumer evidence and normalization |
| --- | --- |
| `cfsList[].portList[]` | `setCFSFromCxCloud` sets box `id = array index + 1`, port `id = array index`; `CFSFilamentItem` displays that box and port identity. IDs remain `cfs-{box}-{port}` and labels `CFS {box}-{port}` with one-based display numbers. Null holes are skipped without compacting subsequent positions. No synthetic missing bays are added. |
| `cId` | Passed to `GetDeviceFilamentInfo` for material details; it is not a stable bay identity. No unverified `boxId`, `portId`, or serial-based identity is invented. Stability follows the upstream positional contract; upstream array reordering cannot be reconstructed. |
| `rfidState` | The newer consumer disables CFS state 0, treats state 2 as recognized filament (including remaining-length display), and allows state 1 as an occupied/unrecognized slot. Map 0 to empty and 1/2 to present, including their numeric-string forms. Missing, malformed, or future states are unknown even if cached material exists. Material text alone never proves CFS occupancy. |
| `filamentsColor` | Both consumers convert nine-character values with `"#" + color.slice(3,9)`: **ARGB**, not RGBA. Validate hex before reusing this conversion; retain valid RGB and three-digit CSS hex. Reject malformed/named colors. |
| `rackFilament` | Both consumers give the ordinary spool-holder material a fixed state 1, box 0, port 0, independent of RFID. `rack-1` / `External Spool` represents a reported material assignment when `filamentType` is nonempty, not sensed physical occupancy. Without material, presence is unknown; a missing assignment is never called physically empty. |
| `smartRackFilament` | The newer consumer projects detection `10` to left occupied/right empty, `01` to left empty/right occupied, `11` to both occupied, and `00` to both empty. Both occupied inlets share the reported material metadata. Publish `smart-rack-1` and `smart-rack-2`, labelled `External Spool 1/2`. Missing/invalid bits are conservatively unknown, with cached metadata suppressed. |

Empty and unknown CFS/smart-rack slots expose neither cached material nor color. Present slots may have unknown material or color. Missing, malformed, failed, or non-success RPC responses leave `filamentSlots` undefined (unavailable); a valid `cfsList: []` reports `[]` (zero assignments). Optional inventory failure does not stop basic monitoring. Each poll starts without cached inventory. No heater, current job, feed selection, or print-file metadata creates inventory.

Legacy `filaments` parsing remains unchanged for explicit Prepare sync, including its existing RFID and material requirements; smart-rack display does not add legacy sync entries. One correction applies before both projections: HTTP success with a failed/missing RPC result code no longer publishes cached material from its `result`. The focused fixture supplies `code: 1` with apparently valid material to verify this failure case. Accepted result codes follow existing cloud polling: 0 or 200. There is no automatic Prepare sync or device mutation.

## Verification and acceptance limits

Source-derived synthetic fixtures in `wasm/tests/node/creality-cloud-client.test.mjs` cover sparse multiple units/ports, physical IDs, present/empty/unknown states, cached metadata suppression, ARGB/RGB validation, ordinary and smart external spools, optional failures, and no heater/job inference. They exercise the actual polling client; the existing Creality suite also exercises polling through the gateway and exact read-RPC allowlisting.

Run with the established constrained runner copied into the ignored evidence directory:

```sh
bash wasm/build/tests-connected-filaments/creality/run-capped.sh focused node --test wasm/tests/node/creality-cloud-client.test.mjs wasm/tests/node/crealityCloud.test.mjs
bash wasm/build/tests-connected-filaments/creality/run-capped.sh compile wasm/app/node_modules/.bin/tsc --noEmit -p wasm/app/tsconfig.json
```

Results: 17/17 focused tests passed; affected UI TypeScript compilation passed. Evidence, fetched primary sources, and pre-edit owned-file snapshots are under `wasm/build/tests-connected-filaments/creality/`. This proves compatibility with the cited source contracts and fixtures. **Actual account acceptance and hardware inventory accuracy remain untested.** No credentials, hardware commands, integrated builds, deployment, or commits were used.
