# Prusa Connect assigned filament material

Published to CURRENT5070 on 2026-11-05 in `ui-connected-filaments-candidate-20261105`, **SYNTHETIC_ONLY**. Representative source-contract fixtures verify rich assigned materials, material-only failure/timeout REST fallback and current-state gating. Real Prusa OAuth, physical MMU mapping and unload/reassignment acceptance remain open. See the [publication receipt](../wasm/build/tests-connected-filaments/publication/report.md).

Implemented 2026-11-05. The browser optionally reads the fixed gateway `GET /_printer/prusa-connect/app/printers/:canonicalUUID/materials` alongside printer telemetry and cameras. A complete validated rich response supplies assigned type, vendor, name and color. Failed, unsupported, unauthorized or malformed reads fall back to that poll's existing REST `tools[key].material`, clearing stale rich fields. Assignments describe cloud records, not physically inserted spools. Legacy `filaments` behavior is unchanged; no automatic Prepare synchronization occurs.

## Primary contracts

- The current first-party [REST consumer](https://connect.prusa3d.com/assets/api-BSmEteaA.js) (`connect-app@2026.42`) uses `Zo`/`Vo` for `/app/printers/{printer_uuid}`. `Eo` reads **each `tools` entry's `material`**, while `To` suppresses the `---` sentinel. `wo.tools()` separates integer print-head keys from dotted feeder keys; `wo.mmu()` reads dotted suffixes as MMU slot IDs and checks `tools[1].mmu.enabled`. These are distinct from `job_info` and job material consumption.
- Immutable firmware source: [Buddy v6.4.0 renderer, commit b91eeda](https://github.com/prusa3d/Prusa-Firmware-Buddy/blob/b91eeda0c16a9931126ea065f2fa2bcc8a983b8d/src/connect/render.cpp#L388) emits one-based tool keys under the enabled slot mask, retaining sparse XL indices. It emits the configured material or `---` for no configured material. [Material origin](https://github.com/prusa3d/Prusa-Firmware-Buddy/blob/b91eeda0c16a9931126ea065f2fa2bcc8a983b8d/src/connect/marlin_printer.cpp#L246) is `config_store().get_filament_type(i).parameters().name`, independently of job requirements. Firmware's INFO/telemetry transport is corroboration; the cloud REST consumer above establishes the account-facing field.
- Newer [Buddy renderer, commit baac5e6](https://github.com/prusa3d/Prusa-Firmware-Buddy/blob/baac5e6710204cc726b298be557c376f2abbee33/src/connect/render.cpp#L492) emits richer `material_package_instance` metadata, including color. This does **not** prove those nested fields occur in the existing REST response.
- The current first-party [Material page](https://connect.prusa3d.com/assets/MaterialPage-BssRmdSu.js) and [tool grouping](https://connect.prusa3d.com/assets/toolUnits-DILzHEe7.js) use GraphQL FFF tools, `materialPackageInstance.package.material`, `primaryColor.colorRgba`, and feeder grouping. The page explicitly says assignments do not mean the spool is inserted or loaded. The [retained contract](../wasm/build/tests-connected-filaments/prusa-rich-contract/report.md) and [complete source document](../wasm/build/tests-connected-filaments/prusa-rich-contract/GetPrinterFffTelemetry.graphql) establish the fixed projection used here.

Public frontend asset URLs have content-derived filenames but are publisher-controlled, not immutable repository permalinks. The exact inspected bytes are retained under [evidence](../wasm/build/tests-connected-filaments/prusa/upstream/) with these SHA-256 identities:

| Asset | SHA-256 |
| --- | --- |
| `api-BSmEteaA.js` | `24c93a105923dbcc221963bc7ebefda6193257ee59cd275a927db5167dd5e4a0` |
| `MaterialPage-BssRmdSu.js` | `7b2d3e075087b3b7590a7fe2016bf159e70d9545381ff2437c59eaad3f000df2` |
| `toolUnits-DILzHEe7.js` | `48026fe69b8ad6bbd03886003ffa365891707632863fb28c7018709165b4ef29` |

## Fixed rich read

Only a canonical lowercase printer UUID is browser input. Query strings (including bare `?`), bodies, non-GET methods and encoded/alternate paths are rejected. The server reads fixed `/app/printers`, requires exactly one matching UUID and a safe integer `team_id`, then reads fixed `/app/users/teams/:team_id` to obtain `organization_id`. Those two token-authorized reads establish account/team membership, not legal ownership or administrator rights. Neither organization IDs nor GraphQL text/options/targets come from the browser.

The server POSTs its minimal `GetPrinterFffTelemetry` projection with only `{organizationId, printerId}` to the configured `PRUSA_CONNECT_GRAPHQL_URL`/`prusaConnect.graphqlUrl`, defaulting to `https://connect-api.prusa3d.com/graphql`. The full configured endpoint path is preserved. Headers are server-owned JSON Accept/Content-Type, Bearer authorization and the source-proven `graphql-client-name: connect-web`; cookies and browser Origin are not forwarded. No application caller of generic `/graphql` was found, so unrestricted generic POST `/graphql` is disabled. Other existing routes retain their policies.

Each read is limited to 1 MiB JSON and 30 seconds, with a total deadline as well as socket timeout. Redirects, non-200 responses, GraphQL errors, wrong printer union/UUID and malformed or duplicate tool records fail with a fixed error and `Cache-Control: no-store`; raw upstream/account data is not returned. Token refresh is attempted at most once on HTTP 401 and starts membership resolution again with the rotated token. Rotation headers are set before subsequent reads, so a downstream failure retains the replacement credentials. Refresh JSON is capped at 64 KiB.

The DTO contains only `tools[]` with raw validated tool `id`, `type`, assignment `presence`, actual `material`, and optional `vendor`, `subtype`, `color`. It excludes account, package, warehouse and material UUID records. `FFFToolMaterialPackageInstance` with an instance/material identifier means an assigned record; `ToolMaterialPackageInstanceEmpty` means no assignment; missing, null or unrecognized unions remain unknown. It supplies no physical spool proof.

- Rich identity uses `prusa-gql-tool-<raw id>`. Integer head `2` displays `Tool 3`, `slotIndex: 2`; sparse IDs remain sparse. Feeder `0.4` displays `MMU slot 0.4`, omitting inferred `slotIndex`. Returned order is retained. A head with feeder records is suppressed to avoid duplicate inventory. No REST/GraphQL join or guessed ID conversion occurs.
- `package.material.type.abbreviation` is the material type; `brand.name` is vendor. `name`, falling back to material `abbreviation`, supplies subtype/details. Colors accept only trimmed hex with one optional leading `#`, exactly 6 or 8 digits, preserving alpha last (`#RRGGBBAA`). Color names and malformed values yield no color.
- A complete rich read replaces inventory, including successful `tools: []`. Optional errors and malformed DTOs use only the current REST poll; no prior rich cache is carried. Base monitoring continues after optional failures, and cancellation suppresses state/error callbacks. Known OFFLINE and UNKNOWN states use the existing offline Device display gate, including when rich records remain upstream.

## REST fallback normalization

- Integer key `3` remains `prusa-tool-3`, label `Tool 3`, zero-based `slotIndex: 2`. Dotted key `1.4` remains `prusa-tool-1.4`, label `MMU slot 1.4`; the optional `slotIndex` is omitted because REST suffix conversion has not been verified. The newer [firmware ID helper](https://github.com/prusa3d/Prusa-Firmware-Buddy/blob/baac5e6710204cc726b298be557c376f2abbee33/src/connect/tools.cpp#L26) emits zero-based `0.n`, whereas the REST helper groups its head at `1`; this does not establish how REST converts feeder suffixes. Both zero and nonzero suffixes are retained verbatim. A head with reported dotted feeder entries is suppressed to avoid duplicating its active feeder's material. No slots are inferred from heater count, tool count, array order, active slot, or model name.
- A nonempty material is a present **recorded material**. `---` is an explicitly empty **material record**; it does not establish sensor-confirmed physical absence. Missing, null, blank or non-string material is unknown. No color, vendor or subtype is invented. Invalid IDs and malformed entries are rejected.
- Missing/malformed REST `tools` means unavailable inventory (`undefined`); an explicit empty object means zero records (`[]`). Every complete poll replaces the previous value, clearing stale inventory. REST normalization and legacy explicit synchronization retain their initial behavior.

Acceptance is **source and synthetic fixture based**. The retained source proves the frontend's own Bearer contract; acceptance of this adapter's acquired token at the GraphQL service remains unverified. No authenticated account response, account-list completeness/pagination comparison, real MMU/XL, physical spool comparison, or live unload/reassignment was accessed. An authorized redacted comparison on single-tool, MMU and sparse XL printers remains necessary, including idle, unload and reassignment. Physical feeder suffix mapping and REST/GraphQL correspondence remain unproven; raw rich identities avoid depending on either.

## Verification

The [client target](../wasm/tests/node/prusa-connect-filaments.test.mjs) and [gateway suite](../wasm/tests/node/prusaConnect.test.mjs) pass 61 tests, including the preserved parent UNKNOWN regression, rich records, fallback/stale clearing, cancellation, fixed query/membership, forbidden inputs, configured endpoint, errors/redirects/size/deadline, refresh and malformed results. The affected gateway and UI TypeScript dependency graphs compile without errors.

Reproduce from the repository root with the retained capped runner:

```sh
bash wasm/build/tests-connected-filaments/prusa-rich/fix/run-capped.sh focused 2G node --test wasm/tests/node/prusaConnect.test.mjs wasm/tests/node/prusa-connect-filaments.test.mjs
bash wasm/build/tests-connected-filaments/prusa-rich/fix/run-capped.sh gateway-typescript 2G wasm/app/node_modules/.bin/tsc --project wasm/build/tests-connected-filaments/prusa-rich/fix/gateway.tsconfig.json --noEmit
bash wasm/build/tests-connected-filaments/prusa-rich/fix/run-capped.sh ui-typescript 2G wasm/app/node_modules/.bin/tsc --project wasm/build/tests-connected-filaments/prusa-rich/fix/ui.tsconfig.json --noEmit
```

Logs, scoped before/after snapshots and patches: [implementation evidence](../wasm/build/tests-connected-filaments/prusa-rich/fix/report.md). Runs use MemoryMax 2 GiB, swap disabled, CPU 200%, TasksMax 128, Node heap 1536 MiB, shared flock and at least 4 GiB host reserve, with the configured user DBus address. No integrated/native build, account probe, deployment, commit or hardware acceptance was performed.
