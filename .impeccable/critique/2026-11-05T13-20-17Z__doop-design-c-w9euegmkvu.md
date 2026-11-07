---
target: Doop canvas w9eUegMkVU — current desktop design
total_score: 21
max_score: 36
na_heuristics: 9
p0_count: 0
p1_count: 1
target_identity: "url:https://doop.design/c/w9eUegMkVU"
timestamp: 2026-11-05T13-20-17Z
slug: doop-design-c-w9euegmkvu
---
Method: dual-agent (A: Codex critique A · B: Codex critique B).

Target: https://doop.design/c/w9eUegMkVU?page=9TjUfOxOuo
Mode: Operate. Primary scope: six Desktop polish frames (five 1440×900 screens and the 360×900 Quality sidebar specimen), updated 2026-11-04. Original desktop capture and mobile Prepare are contextual references.

The desktop has a convincing slicer identity, but its workflow needs clearer direction. Preserve the dark workbench, teal accent and expert density. The biggest opportunity is making add model → configure → slice → inspect → export easier to follow. These findings concern the canvas prototype, not independently verified current production behavior.

| Heuristic | Score / 4 | Main finding |
|---|---:|---|
| System status | 2 | Two Slice buttons communicate different readiness |
| Match to users' world | 3 | Strong slicer vocabulary; calibration assumes expertise |
| User control | 2 | Escape cues exist; cancellation remains untested |
| Consistency | 2 | Duplicate actions and shifting Preview chrome |
| Error prevention | 2 | Preset overrides need explanation |
| Recognition over recall | 3 | Useful labels/search; import remains hard to discover |
| Efficiency | 2 | Expert affordances exist; interactions only partly demonstrated |
| Aesthetic restraint | 3 | Coherent workbench; Preview repeats information |
| Error recovery | n/a | No actual failure state supplied |
| Help | 2 | Field help exists; task guidance is weaker |
| Total | 21/36 | 58% — Acceptable band; significant workflow improvements needed |

Design specificity: authored for a slicer. The build plate, printer/material/process stack, actual toolpaths and layer vocabulary are coherent and worth preserving. The problem is task orchestration.

Strengths:
- The plate dominates Prepare while the configuration stack follows printer → filament → process.
- Quality fields align and form meaningful groups, with search and category navigation.
- The actual Benchy, 240 layers, 39m 5s, 3.88m and 11.58g make successful slicing tangible. Device pairs its empty-state explanation with Add a printer.

Priority issues:

1. [P1] Empty Prepare promotes slicing before importing.
Evidence: vEytJlzoX2, #slice-btn is disabled while #slice-plate-btn is visibly teal and has no disabled attribute. No comparable Add model action or drop prompt appears on the empty plate. D8bFH7ssZb's #preview-empty-prompt is wired for click/Enter return but looks like plain instructional text.
Impact: newcomers must discover import in menus; both newcomers and experts receive conflicting readiness signals.
Fix: Add model and a concise file/drop hint on the empty plate; align Slice readiness and explain the disabled state. Prefer one primary Slice action. Give empty Preview a visible Go to Prepare button. The mobile Prepare frame already makes Add model explicit.
Suggested command: $impeccable onboard, then $impeccable clarify.
Limit: confirmed prototype appearance/markup, not a claim that the native engine slices an empty plate.

2. [P2] Preset state undermines confidence.
Evidence: vEytJlzoX2 and D1RM4tNCIq display 0.20mm Standard @Voron with effective layer height 0.08mm and no visible Modified marker/reset. Save appears at multiple scopes.
Impact: users cannot confidently distinguish an intentional override from preset defaults before committing material and print time.
Fix: mark Modified, highlight overridden values, offer Reset to preset, and distinguish Save process preset from saving a project. If these are inconsistent frozen captures, align their state.
Suggested command: $impeccable clarify / $impeccable harden.

3. [P2] Loaded Preview divides attention across competing inspectors.
Evidence: SulHyUxl0c repeats feature durations in the left legend and right Time by Feature table. A tall L240/L1 rail resembles a slider beside a separate bottom Top layer scrubber; both areas show All. The rail is aria-hidden markup; the range input is horizontal.
Impact: users spend attention interpreting control roles and duplicate information rather than inspecting print defects.
Fix: give layer inspection one clear control area; distinguish a readout from an interactive slider. Keep essential time/material and Download G-code visible, disclose detailed timings on demand, or remove timing duplication from the legend.
Suggested command: $impeccable distill / $impeccable layout.
Limit: two-capture playback, local-only feature switches and export intent feedback are documented prototype constraints, not engine failures.

4. [P2] Calibration organizes tests without helping users choose.
Evidence: 6pIrGM46EN presents six equal Extrusion cards, including three pressure-advance variants described mainly by geometry and K values. Useful broad groups exist, but there is no outcome/prerequisite guidance.
Impact: recognizing a symptom does not tell a less experienced user which test addresses it.
Fix: add symptom/outcome cues and variant-selection guidance; group pressure advance under one concept while retaining direct expert access and an optional Where should I start path.
Suggested command: $impeccable clarify / $impeccable onboard.

5. [P2] Important context is too small.
Evidence: D1RM4tNCIq setting units/help use .6875rem (11px at a 16px root); SulHyUxl0c includes 11px secondary labels/timings/notes. Primary loaded Preview body is 13px, not 11px. Controls generally meet the 24px desktop minimum target benchmark.
Impact: units such as mm or % influence interpretation, so their low visual priority adds reading effort.
Fix: raise essential secondary text to 12–13px, enlarge help hit areas and verify fit/focus/zoom. Preserve desktop density through alignment.
Suggested command: $impeccable typeset and focused $impeccable audit.
Limit: no broad contrast failure or WCAG certification claim.

Cognitive load:
Single focus pass with caveat (controls serve the same slicing task); chunking pass; grouping pass; hierarchy fail; one thing at a time pass with caveat; minimal choices fail; working memory pass with caveat; progressive disclosure fail. Three failures: moderate. Calibration's six equal Extrusion choices are a stronger problem than the mere number of familiar camera views or feature filters.

Journey:
Arrival is credible but import discovery causes a valley. Configuration supports confidence until preset/override ambiguity. Slicing progress/cancel is unobserved. Real Benchy is the peak; repeated Preview panels dilute focus. Device's Add a printer is clear. Export completion cannot be inferred from this prototype.

Persona red flags:
- Jordan, newcomer: menu exploration to import; visually hidden return action; no guidance among pressure-advance variants.
- Alex, expert: conflicting Slice readiness and repeated timing/layer information interrupt a familiar workflow. Shortcut titles and setting search are strengths.
- Sam, reduced vision/accessibility needs: small units/captions increase reading effort. Existing toolbar aria-labels and input labels should be acknowledged; do not claim blanket missing labels. Loaded Preview's span-based menu mockup and unexercised focus/zoom remain prototype verification limits.

Minor observations:
- Stabilize shell/nav alignment between Prepare and loaded Preview.
- Use a consistent icon family instead of mixing line icons and emoji.
- Cost 0.23 lacks currency/basis; show configured meaning when known without inventing a unit.
- Empty lower space on Device/Calibration does not need decorative filler.
- Actual error, loading, unsaved navigation, long-label and 200% zoom states remain untested.
- Prototype graph has no incoming desktop route to the loaded example; it cannot demonstrate the complete import-to-export journey.

Deterministic scan:
28 raw findings from six current exported HTML documents. Locations are /tmp/weborca-critique-evidence/<frameId>.html; minified line numbers are 0.
- marquee: 10, shared loading-animation CSS, not visible scrolling content.
- codex-grid-background: 5, functional plate grids or unused shared CSS, false positives/inapplicable.
- cramped-padding: 8 (6 Prepare, 2 Quality), mostly zero-padding wrappers whose child heads have actual spacing.
- low-contrast: 1 Prepare, disabled controls (#818183/#2d2d31), not confirmed enabled-text failure.
- tiny-text: 2 loaded Preview, useful signal for 11px informative secondary text.
- flat-type-hierarchy: 1 loaded Preview, partly stale static CSS estimate; actual heading sizes 12/13/15px.
- dark-glow: 1 loaded Preview, overridden by box-shadow:none, not visible.
Primary white text on #008172 measured 4.79:1; secondary #b2b3b5 on #2d2d31 measured 6.54:1. No evidence supports a general dark-UI contrast failure. Not all toolpath/hover/focus states were audited.

Questions to consider:
- Can a user identify the next action from the empty plate without knowing the menus?
- Which Preview information must remain visible while inspecting a defect?

Assessment provenance:
Both delegated assessments completed independently before synthesis. A completed before the parent read B's detector output. All six current Doop screenshots succeeded. B used an owned browser tab to measure exported HTML because the canvas browser URL required sign-in. No real account/printer operations were attempted. No UI/source changes were made.
