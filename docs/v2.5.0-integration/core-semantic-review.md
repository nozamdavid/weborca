# Core semantic merge review

One actionable lost behavior found: short filament cooling-temperature vectors no longer use the first value during post-extrusion cooling.

## Scope and snapshot

Reviewed the working tree at `/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1` against both merge parents: WebOrca `413cb95cb6107a6b8786444925d672b142e3f690` and upstream `40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19`. Merge checkpoint: `709ff3ecd09824b4f2bd3a78f398c3a038811243`; common ancestor: `e027f8b225edd3b05496f8c2e9e67f8352ebb9b3`.

Read the original checkout's `AGENTS.md` and [merge-foundation.md](merge-foundation.md). This is a source review only. No tests, compilation, product edits, index operations, commits or deployment were performed. Concurrent dependency/core/config/preview edits were present; all seven reviewed source files matched the merge checkpoint when checked before writing this report.

Git blob hashes of the reviewed working files:

| File under `src/libslic3r/` | Blob SHA-1 |
| --- | --- |
| `Print.cpp` | `e3b39d2e430cb3ed7d6c04c100786b9c49e5e9ce` |
| `GCode.cpp` | `84e2dfeac4db61e9a147fbb36b986a3f9a3b25c2` |
| `GCode/GCodeProcessor.cpp` | `007c8860caefe1b55606d6bcc00a80689839a921` |
| `GCode/GCodeProcessor.hpp` | `49c90f0e30c0ed25d3eeae4faeb526820833b913` |
| `Format/bbs_3mf.cpp` | `eb577d927d9d53306c582c5bf09af418b6f063c8` |
| `Fill/FillBase.cpp` | `de9149cbc7caa860cda75bc1598fd732af86f165` |
| `PerimeterGenerator.cpp` | `050dbd65d3c2fdf636116c5e3a7e2fa16044ac12` |

## Finding

### P2 — Restore first-value fallback for post-extrusion cooling

**File/lines:** `src/libslic3r/GCode/GCodeProcessor.cpp:2233–2243`, specifically the upper-bound guards at 2233 and 2240. Source blob: `007c8860caefe1b55606d6bcc00a80689839a921`.

The merge keeps WebOrca's `get_option_value(vector, id)` fallback but brings back upstream's early rejection of indices outside the vector. In the first parent, both lambdas reject only negative indices, then use the first element for a short nonempty vector. In the merge, the fallback cannot run for those indices. Parent processor blobs are `6220cb38c61d15b1745b5d66d9af2df05c2b767a` (WebOrca) and `0157c8cdb4a38b6578827501c3b427e5d691c1d0` (upstream).

Concrete input: filament nozzle temperatures `{220, 220}`, pre-cooling temperatures `{180}`, and a multi-extruder free block with `last_filament_id == 1`, a nonempty post-extrusion interval and positive heating/cooling rates. This short vector reaches the injector: `apply_config(PrintConfig)` copies `config.filament_pre_cooling_temperature.values` directly at line 3177, and finalization passes that member directly at line 2035. The injector constructor retains the reference without expansion.

Previously, `is_pre_cooling_valid(1)` used 180 and 220, returned true, and the permitted partial cooling drop was 40 degrees. It now returns false at line 2234. Consequently `apply_cooling_when_partial_free` is false at line 2330 and the `Multi extruder pre cooling in post extrusion` command at lines 2390–2394 is omitted. Cooling is delayed until the completely free interval, and the subsequent cooling/heating calculation starts from the higher temperature. The second guard also defeats the intended 40-degree fallback, returning a fixed 30 instead; that becomes observable once the validity guard is corrected.

**Minimal correction:** preserve the first parent's negative-index guards in these two lambdas and let the retained safe accessor handle short vectors. Empty cooling vectors still produce zero and fail the existing positive-temperature validity check.

**Minimal regression target, deferred until dependencies are ready:** add one case in `tests/fff_print/test_gcodewriter.cpp` covering a dual-extruder post-extrusion cooling interval for filament 1. Compare `filament_pre_cooling_temperature={180}` against `{180,180}`, with nozzle temperatures `{220,220}` and positive thermal rates. Assert equal injected commands and presence of `Multi extruder pre cooling in post extrusion`; make the interval long enough to exercise the full 40-degree drop. A small injector fixture with identical cumulative moves and usage blocks is also sufficient if the export helper does not create a post-extrusion interval. The existing `PreheatSafety` case varies physical mappings and heating/cooling **rates**, so it does not cover this lost filament-temperature fallback. This regression was reasoned from source and was not executed.

## Coverage without additional findings

- **Optional interpolation, preheat and backtrace:** `Print::export_gcode` forwards the flag through `GCode::do_export` to the processor. The calculation forces interpolation for both `m_enable_pre_heating` and `m_result.backtrace_enabled`. Time integration and per-move duration assignment precede the interpolation gate; the upstream non-motion `continue` remains independent of the flag. Existing skip-interpolation timing and preheat/backtrace tests remain present. No additional lost behavior identified by inspection.
- **Belt factory and IMEX coordinates:** the upstream `unique_ptr<GCode>` factory selects `BeltGCode`; export refreshes the IMEX slice offset and calls `set_gcode_offset_with_imex_shift` before export. These bodies match upstream apart from the optional argument forwarding. No additional finding.
- **Object mass and timing:** the upstream mass-locator construction/installation, object/body mass interface and processor mass accumulation remain present. `GCode.cpp` differs from upstream only in the optional export argument/setter; the processor's interpolation insertion algorithm remains upstream's implementation, including zero-duration inserted vertices. No merge-specific loss identified. This does not establish numerical correctness of mass estimates or Klipper timings.
- **3MF worker ownership, escaping and order:** all triangle attributes, including all texture displacement slots, append to worker-local `out`. Worker output is drained by task index and then line index, retaining triangle order and serial flush boundaries. `FacetsAnnotation::get_triangle_as_string` emits hexadecimal digits, so these paint values do not need XML entity escaping. Upstream IMEX free-text attribute escaping and the existing escaped volume-setting serialization remain present. No worker-buffer or escaping regression identified; archive ordering across independently exported objects and runtime race behavior were not established.
- **Portable tie order:** both upstream infill candidate sorts use `stable_sort`, retaining the WebOrca equal-cost policy while preserving the upstream join-count algorithm. Open-wall start selection retains supported-endpoint preference and coordinate ordering. Both perimeter paths retain the documented local `m_scaled_resolution` simplification policy. No additional lost tie-order behavior identified.

## Limits

The review covers the seven requested files and adjacent definitions needed to trace concrete inputs. It does not certify the full merge, concurrent edits outside those files, dependency ABI compatibility, runtime preheat placement, belt/IMEX hardware behavior, 3MF round trips, cross-standard-library toolpath equality, or native/WASM parity. No build or test result is implied by a no-finding entry. Recheck the recorded hashes before applying the finding to a later source candidate.
