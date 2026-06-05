# SIMULATION-AND-VISUALIZATION-ARC.md

> **Status:** Research notes capturing the multi-year arc from "static catalog with declared values" (where the foundation is at v3 Sprint 11 close) to "circuit simulator + multi-lens visualization" (the project's eventual goal). Includes framing-accuracy verdicts, tool-by-tool license verification, and explicit defers / risks.
>
> **Verified:** 2026-06-05 via deep-research workflow (5 search angles, 22 sources fetched, 25 claims adversarially verified by 3-vote panel, 21 confirmed + 4 killed). Background-knowledge claims and unverified stage assessments are explicitly flagged.
>
> **Not a sprint plan.** This is a roadmap doc that captures the destination so individual sprints can be planned with the right shape. Specific sprint scoping happens in `sprints/` per the normal cadence.

---

## Why this doc exists

The user explicitly asked for the simulation + visualization arc to be made durable so the foundation work being done in Sprints 1-11 has a clear destination beyond "the catalog grows." They want the system to eventually catch voltage drop-off, LED overloading, hotspots, EMI from bad shapes — and to visualize all of that on a canvas with multiple overlay "lenses."

This doc maps that vision against:
- The dependency chain of what infrastructure is needed for each stage
- Which open-source tools could implement each stage
- Whether those tools fit the project's MIT/Apache 2.0/BSD/ISC/CC0-only bundling rule (per CLAUDE.md core principle 4)
- Realistic effort: which stages are "next few sprints" vs "multi-year"

---

## The 8-stage arc

| Stage | What | Dependencies | Realistic horizon |
|---|---|---|---|
| **1** | Net model formalization — `connects:` becomes first-class | Foundation + cross-FK validator (Sprint 5/6 work) | Near-term (a sprint or two) |
| **2** | Behavior-derives-value pattern — devices declare formulas | Stage 1 not strictly required but helpful | Near-term (sprint candidate post-Sprint 11) |
| **3** | DC analysis solver — Modified Nodal Analysis + Newton-Raphson | Stages 1, 2 | 3-5 sprints (more complex than initial framing) |
| **4** | Safety / failure-mode checks — compare computed values vs max ratings | Stage 3 | Sprint or two after stage 3 |
| **5** | Canvas-based schematic visualization | Stage 1 (topology) — stages 3-4 not strictly required for static schematic | Major direction-decision sprint (Electron + React + React Flow per CLAUDE.md tech stack) |
| **6** | Visualization lenses overlaid on canvas | Stages 3-4 for electrical lenses; stage 7 for thermal; stage 8 for EMI | Years of work to match commercial; subset replicable per sprint |
| **7** | Thermal model + solver — heat conduction at PCB scale | Stage 5 for visualization; some thermal data per device | 1-2 sprints for in-app FD solver from scratch |
| **8** | EMI/EMC analysis — full-wave Maxwell solver | Stage 1 (geometry), eventually stages 5-6 for visualization | Out of scope for in-app — external process only |

---

## Per-stage detail

### Stage 1 — Net model formalization

**Framing:** `connects:` syntax becomes first-class. The validator can answer "which components are wired together?" deterministically.

**Status:** §15 deferred row exists. Sprint 7 added an ad-hoc demo circuit using the existing loose `connects:` shape; cross-FK doesn't yet enforce net topology.

**Verification:** Framing-accuracy not adversarially submitted in 2026-06-05 research (absence of refutation, not positive verification). Project should not treat as fully validated.

**No license issue** — this is internal schema + validator work.

### Stage 2 — Behavior-derives-value pattern

**Framing:** Devices declare formulas like R = ρ × L / A or λ = h·c / E_g so component parameters can be derived from inputs (material properties + geometry) rather than declared directly.

**Status:** Sprint 12 candidate; planned but not started. The design from the Sprint 12 planning conversation (structured derived_from blocks + input source path resolution) is consistent with what's needed.

**Verification:** Framing-accuracy not adversarially submitted in 2026-06-05 research. The user clarified that **users don't write formulas** — formulas are shipped with the catalog by ChipBlocks maintainers, citing physics laws. Validator just needs to confirm the inputs resolve.

**No license issue.**

### Stage 3 — DC analysis solver

**Framing in CLAUDE.md (corrected 2026-06-05):** Was "Ohm + KCL + KVL." Actual reality is more nuanced.

**Verified correction (3-0 adversarial pass):**
- Production SPICE-class solvers use **Modified Nodal Analysis (MNA)** — combines KCL with branch constitutive equations. Pure KVL is *not* used directly because pure nodal analysis cannot handle voltage sources (infinite conductance problem).
- **Nonlinear elements** (diodes, transistors) require **iterative Newton-Raphson** methods on Jacobian matrices.
- **Convergence is not guaranteed.** Production solvers need specific heuristics — the `pnjlim` algorithm with critical voltage thresholds, iterating in current rather than voltage for the exponential diode equation, otherwise numerical overflow kills the solver.

**Sources:**
- IEEE EMC Society — "How SPICE Works" (https://ewh.ieee.org/soc/emcs/acstrial/newsletters/summer09/HowSpiceWorks.pdf)
- Qucs technical docs — Newton-Raphson + exponential diode convergence (https://qucs.sourceforge.net/tech/node16.html)
- SPICE# Modified Nodal Analysis docs (https://spicesharp.github.io/SpiceSharp/articles/custom_components/modified_nodal_analysis.html)

**Implications for ChipBlocks:**
- Stage 3 is **3-5 sprints of work**, not 1-2.
- Option A: restrict v1 to linear elements only (resistors, capacitors as DC blockers, voltage sources). Limits LED failure-mode checks because LEDs are nonlinear.
- Option B: implement MNA + Newton-Raphson + pnjlim convergence aids. Real engineering effort.

**No external tool needed if implementing in-app.** The TypeScript or Python implementation can be authored from scratch — math is well-documented in textbooks (Ho/Ruehli/Brennan 1975 MNA paper, plus Vlach + Singhal "Computer Methods for Circuit Analysis and Design").

### Stage 4 — Safety / failure-mode checks

**Framing:** Compare computed values (from stage 3) against device max ratings declared in the catalog (max_forward_current on LEDs, peak_inverse_voltage on diodes, max_zener_current on Zener, etc.). Flag overcurrent, undervoltage, exceeded forward voltage, thermal limits.

**Status:** Catalog already has max ratings declared per device (Sprint 7 LED, Sprint 8 diodes). What's missing is the solver to produce computed values to compare against.

**Verification:** Framing-accuracy not adversarially submitted. Stage 4 is genuinely simple if stages 1-3 work.

**No license issue.**

### Stage 5 — Canvas-based schematic visualization

**Framing:** Render the circuit as a schematic diagram using IEEE/ANSI 315 or IEC 60617 standard symbols. CLAUDE.md tech stack: Electron + React + React Flow.

**Verification:** Framing-accuracy not adversarially submitted; no license blockers expected.

**Symbol libraries:** SCHEMATIC-SYMBOLS.md verified 2026-06-05:
- **KiCad symbol library** — GPL-licensed (would be inspiration, not direct code import; symbol shapes follow public IEC 60617 / IEEE 315 standards which are not copyrightable as shapes)
- **upb-lea/Inkscape_electric_Symbols** — CC0-1.0, bundleable
- **AcheronProject/electrical_template** — BSD 3-Clause, bundleable

**Effort:** Major direction-decision sprint. Per CLAUDE.md none of the frontend exists yet. The foundation is now mature enough to begin.

### Stage 6 — Visualization lenses

**Framing:** Overlay modes on the canvas showing voltage maps, current flow animation, power dissipation, thermal hot spots, etc. — what the user asked for explicitly ("see the stuff while its running including hotspots and bad shapes causing interference").

**State-of-the-art (assessed 2026-06-05, directional not adversarially verified):**

| Tool | What it provides |
|---|---|
| **KiCad** (open source, GPL) | Voltage probe + current arrows + power calculation. No real-time animation or thermal/EMI overlay. |
| **Altium** (commercial reference) | Voltage map, current density, power integrity analyzer, signal integrity (eye diagrams), thermal hotspot via Keysight Power Analyzer integration. Most complete commercial reference. |
| **LTspice** (free proprietary) | Voltage/current plotting + .ac/.tran result viewers. No canvas overlay (separate waveform viewer). |
| **Cadence Allegro / OrCAD** (commercial reference) | Signal integrity, power integrity, thermal — commercial reference for the full stack. |
| **Synopsys HSPICE** (commercial reference) | Plot Analyzer for waveform overlays + signal integrity. |
| **Saturn PCB Toolkit** (free Windows) | Reference calculator for trace width / current capacity but not overlay visualization. |

**Realistically replicable in ChipBlocks within a few sprints (assuming stages 1-3 work):**
- Static voltage map (color overlay per net)
- Static current arrows (per branch)
- Computed power dissipation as color overlay (per component)
- Component max-rating violation highlighting (stage 4 feeds this)

**Many years of work:**
- Real-time animated current flow at >30 fps for large circuits
- Signal integrity eye diagrams (requires transient simulation = ngspice external process)
- Full EMI surface plots (requires stage 8 solver)

**Sources:**
- KiCad SPICE simulator docs: https://www.kicad.org/discover/spice/
- Altium Power Analyzer (Keysight integration): https://www.altium.com/documentation/altium-designer/analyzing-pcb/pi-analysis/power-analyzer-keysight
- Altium SI Analyzer: https://www.altium.com/documentation/altium-designer/analyzing-pcb/si-analysis/si-analyzer-altium
- LTspice product page: https://www.analog.com/en/resources/design-tools-and-calculators/ltspice-simulator.html

**No license issue** for the in-app overlay rendering (we draw the lenses ourselves). The data feeding them comes from stages 3, 7, 8.

### Stage 7 — Thermal model + solver

**Framing:** Heat conduction through PCB materials (FR4 thermal conductivity ~0.3 W/m·K — already cited in material-fr4.yaml), convection to ambient air, possibly radiation. Identify hot spots.

**Verified status of open-source thermal solvers (2026-06-05):**

| Tool | License | Bundleable? | Notes |
|---|---|---|---|
| **OpenFOAM** | GPL family | NO (external process only) | Massive, CFD-focused |
| **Code_Saturne** (EDF) | GPL | NO | Industrial CFD |
| **SU2** | LGPL + Apache (mixed) | NO (complex licensing) | CFD-focused, not thermal-specific |
| **Elmer FEM** | LGPL core + GPL physics | **MIXED — see below** | The relevant solver modules are GPL |
| **CalculiX** | GPL | NO | FEM, GPL throughout |

**Elmer FEM specifically (high-confidence verified 3-0):**
- ElmerLicensePolicy.md verbatim: "The code under LGPL license include the ElmerSolver main library (libelmersolver, codewise /fem/src/*.F90)"
- BUT: "The parts of Elmer project still under the more restrictive GPL license include ElmerGUI, ElmerGrid, and most of the existing physical modules a.k.a. solvers of Elmer."
- **The heat-conduction modules — exactly what ChipBlocks would need — are GPL.** The LGPL core alone has no physics in it.
- Wholesale bundling: impossible. Even LGPL-only-linking has copyleft obligations and minimal value without the GPL physics.

**Recommended path: from-scratch.** Write a simple 2-D finite-difference heat solver in TypeScript using:
- FR4 thermal conductivity 0.3 W/m·K (cited in material-fr4.yaml)
- Lumped thermal-resistance network for component-to-ambient paths
- Per-component power dissipation from stage 3 results
- 1-2 sprints of work for v1 (no FEM mesh complexity)

The accuracy ceiling vs full FEM is real but acceptable for ChipBlocks' v1 goal of "catch hotspots." Production thermal analysis (Ansys Icepak class) is far beyond v1.

**Sources:**
- ElmerLicensePolicy.md: https://github.com/ElmerCSC/elmerfem/blob/devel/license_texts/ElmerLicensePolicy.md
- Elmer blog license page: https://www.elmerfem.org/blog/license/
- Wikipedia Elmer FEM solver: https://en.wikipedia.org/wiki/Elmer_FEM_solver
- PCB thermal FEM survey: https://www.electronics-cooling.com/2004/05/modeling-heat-conduction-in-printed-circuit-boards-using-finite-element-analysis/
- Open-source PCB thermal walkthrough (blog): https://jrainimo.com/build/2024/11/oss-thermal-simulation-of-pcbs/

### Stage 8 — EMI/EMC analysis

**Framing:** Full-wave Maxwell's equations solver on PCB geometry to detect interference sources, parasitic antenna effects, ground loops, signal integrity problems.

**Verified status of open-source full-wave solvers (2026-06-05):**

| Tool | License | Bundleable? | Notes |
|---|---|---|---|
| **MEEP** | **GPL-2.0-or-later** | NO | The "MIT" in name = Massachusetts Institute of Technology, NOT MIT license. Common misconception, corrected here. |
| **openEMS** | **GPL-3.0** | NO | 3-D FDTD with EC-FDTD variant. Cartesian + cylindrical. Active maintenance (copyright "2010-2026"). |
| **gprMax** | GPL | NO | FDTD focused on ground-penetrating radar but mathematically the same |

**Sources:**
- MEEP LICENSE file: https://github.com/NanoComp/meep/blob/master/LICENSE
- MEEP COPYRIGHT: https://github.com/NanoComp/meep/blob/master/COPYRIGHT
- openEMS repo: https://github.com/thliebig/openEMS
- openEMS COPYING: https://github.com/thliebig/openEMS/blob/master/COPYING
- openEMS docs: https://docs.openems.de/intro.html

**Recommended approach: two-track.**

**Track A — advanced users:** Provide openEMS-compatible geometry export from ChipBlocks. User installs openEMS separately, runs it, brings results back. Same posture as KLayout.

**Track B — in-app EMI heuristics:** Write checks for common errors that don't require a full-wave solver:
- Flag traces longer than λ/10 at the highest signal frequency (transmission-line effect threshold)
- Flag ground loops in net topology
- Flag missing decoupling capacitors near IC power pins
- Flag parallel adjacent traces longer than X mm (crosstalk threshold)

These heuristics catch the common errors that hurt real designs without claiming to be a real EM solver.

**Important physics ceiling (verified 2-1 adversarial):** KCL/KVL itself **breaks down at high frequency** where Faraday's Law makes voltage path-dependent. The IEEE EMC Society source: "If there is a changing magnetic flux through a given mesh, Faraday's Law of magnetic induction ∇ × E = −Ḃ affects the branch equations and breaks KVL by making the electric field non-conservative and the voltage undefined. At that point you need to switch to an EM solver."

**Stage 3 (DC analysis) has a real ceiling well below where Stage 8 begins. They are not on a continuum.**

---

## Tool-by-tool license verification

Verified 2026-06-05 at canonical sources. The CLAUDE.md tech-stack picks are either confirmed or corrected here.

| Tool | License | Maintained? | ChipBlocks posture |
|---|---|---|---|
| **Magic VLSI** | UC Berkeley BSD-style permissive ✅ | Active (8.3.657 released 2026-06-05; near-daily builds) | **BUNDLE-COMPATIBLE** |
| **KLayout** | GPL-3.0 ❌ | Active (last push 2026-05-29; 1109 stars) | External user-installed process — NOT bundled |
| **ngspice** | Mixed: primarily 3-clause BSD + LGPL/GPL components | Active (44.2 released Jan 2025) | **External process** OR stripped build. Bundling not viable without removing LGPL/GPL files (numparam LGPLv2+, XSPICE table module GPLv2+, TCL integration LGPLv2, ADMST LGPLv2.1 per maintainer Holger Vogt's inventory) |
| **MEEP** | GPL-2.0-or-later ❌ | Active | External user-installed process — NOT bundled (name "MIT" = institution, not license) |
| **openEMS** | GPL-3.0 ❌ | Active (copyright 2010-2026) | External user-installed process — NOT bundled |
| **Elmer FEM** | Dual: core LGPL + most modules GPL ❌ | Active | Wholesale bundling impossible. Even LGPL-core-only linking has obligations + most physics modules are GPL anyway. **Recommended: skip; write from-scratch thermal solver.** |

### Sources for license verification

- ngspice mixed-license: https://ngspice.sourceforge.io/devel.html + Holger Vogt's license inventory (2017, still applies in v44.2)
  - License-question thread: https://sourceforge.net/p/ngspice/discussion/127605/thread/55a1e118d2/
- Magic permissive: https://github.com/RTimothyEdwards/magic/blob/master/LICENSE
- KLayout GPL-3.0: https://github.com/KLayout/klayout (auto-detected SPDX "GPL-3.0", maintained by Matthias Köfferlein)
- MEEP GPL-2.0-or-later: https://github.com/NanoComp/meep/blob/master/LICENSE
- openEMS GPL-3.0: https://github.com/thliebig/openEMS/blob/master/COPYING
- Elmer license policy: https://github.com/ElmerCSC/elmerfem/blob/devel/license_texts/ElmerLicensePolicy.md

---

## Top 5 risks / surprises

Things that would surprise the project lead if they were only working from the original framing.

### Risk 1 — DC analysis is 3-5 sprints, not 1-2

The "Ohm + KCL + KVL" framing made it sound like a single afternoon's worth of math. Real SPICE-class solvers are MNA + Newton-Raphson + convergence aids — production-grade engineering. **Implication:** when planning the post-Sprint-12 sequence, scale expectations. Either restrict v1 to linear elements (limits LED checks) or commit to building the real solver.

### Risk 2 — ngspice cannot be bundled

CLAUDE.md's implicit framing was that ngspice is BSD and can ship with the app. **It can't.** The LGPL/GPL components (numparam, XSPICE table, TCL, ADMST) block the BSD whole. Either:
- Build a stripped ngspice (extra build complexity, ongoing maintenance burden)
- Invoke as external user-installed process

Both work. Pick one explicitly when stage 3+ work approaches.

### Risk 3 — MEEP is NOT MIT

The "MIT" in MEEP's name fools many. Any plan that referenced MEEP as "MIT licensed and bundleable" was wrong. It's GPL-2.0-or-later. External process only.

### Risk 4 — Stage 8 (EMI/EMC) is realistically out of scope for in-app

No permissively-licensed full-wave solver exists. Commercial dominance (Ansys HFSS, CST Studio Suite, Keysight ADS) is hundreds of person-years of physics engineering. **The realistic path is in-app heuristics + optional external openEMS invocation.** Trying to write a full-wave solver from scratch in ChipBlocks would consume years and probably never reach commercial parity.

### Risk 5 — KCL/KVL breaks down at high frequency (Faraday's Law)

The in-app DC analysis has a fundamental physics ceiling — not a "we haven't gotten around to it" ceiling. At high frequency, voltage becomes path-dependent due to ∇ × E = −Ḃ, and KVL is no longer well-defined. **Stage 3's solver and stage 8's solver are on opposite sides of this wall.** The "everything is just KCL/KVL bigger" intuition is wrong. There is genuine discontinuity between AC/DC and high-frequency analysis.

---

## Open questions (carried from the 2026-06-05 deep-research caveats)

1. **Thermal solver from scratch — what's the accuracy ceiling?** Can a 2-D finite-difference heat solver with lumped thermal-resistance networks meet ChipBlocks' v1 needs? At PCB scale with FR4 conductivity ~0.3 W/m·K, the textbook says yes for "catch hotspots" use cases, but no head-to-head comparison was done in this research pass.

2. **Stages 1, 2, 4, 5, 6 framing accuracy** — not adversarially submitted in the 2026-06-05 research round. The absence of refutation is not positive verification. Worth a focused re-verification pass before any of those stages becomes a sprint.

3. **The supplementary symbol libraries from SCHEMATIC-SYMBOLS.md** — were verified for license at the canonical source (CC0 + BSD 3-Clause confirmed). The IEC 60617 / IEEE 315 symbol-inventory coverage was NOT independently verified — the project should check completeness when stage 5 lands.

4. **If ngspice is external process, what's the per-call latency for a typical 20-50 node circuit?** This affects whether stage 6's "real-time" visualization lens experience is achievable on top of an external subprocess, or whether ChipBlocks needs to write its own DC solver in-app anyway. Not measured in this research pass.

5. **Magic 8.3.657's coincidental 2026-06-05 release date** — the same-day release as the verification is suspicious. Either real coincidence (Magic does have a near-daily build cadence) or verifier-generated artifact. The broader claim (Magic is actively maintained, BSD permissive) is robust regardless; the specific version number should be re-checked before commitment.

---

## When to revisit

- **Before any sprint that depends on stage 3 (DC solver)** — re-verify MNA + Newton-Raphson approach against current SPICE literature; verify ngspice license + maintenance status (the LGPL/GPL component situation could change).
- **Before any sprint that depends on stage 7 (thermal)** — re-verify Elmer dual-license situation; check if a permissively-licensed alternative has emerged.
- **Before any sprint that depends on stage 8 (EMI/EMC)** — re-verify openEMS / MEEP / gprMax license status; check if a permissively-licensed full-wave solver has emerged (low probability).
- **Quarterly** — re-check that ngspice maintainer Holger Vogt's license inventory is still current (last verified posture from 2017 ngspice-devel thread, still applied to v44.2 as of Jan 2025).
- **Before any sprint that creates an installer / packaging** — re-verify license claims at canonical sources. License auto-detection on GitHub can lag the actual upstream LICENSE file by days.

---

## Verified sources (2026-06-05)

### Primary (canonical project sources)
- **ngspice license inventory** (Holger Vogt mailman thread 2017, still current): https://sourceforge.net/p/ngspice/mailman/ngspice-users/thread/9f2bb04a-8299-ab82-bd89-4720110a10f5@t-online.de/
- **ngspice devel page**: https://ngspice.sourceforge.io/devel.html
- **Magic LICENSE**: https://github.com/RTimothyEdwards/magic/blob/master/LICENSE
- **Magic releases**: https://github.com/RTimothyEdwards/magic/releases
- **KLayout repo**: https://github.com/KLayout/klayout (auto-detected SPDX GPL-3.0)
- **MEEP LICENSE**: https://github.com/NanoComp/meep/blob/master/LICENSE
- **MEEP COPYRIGHT**: https://github.com/NanoComp/meep/blob/master/COPYRIGHT
- **openEMS repo**: https://github.com/thliebig/openEMS
- **openEMS COPYING**: https://github.com/thliebig/openEMS/blob/master/COPYING
- **Elmer license policy**: https://github.com/ElmerCSC/elmerfem/blob/devel/license_texts/ElmerLicensePolicy.md
- **Elmer blog license page**: https://www.elmerfem.org/blog/license/

### Technical depth (DC analysis + visualization lenses)
- **IEEE EMC Society — How SPICE Works**: https://ewh.ieee.org/soc/emcs/acstrial/newsletters/summer09/HowSpiceWorks.pdf
- **Qucs technical docs — Newton-Raphson + exponential diode convergence**: https://qucs.sourceforge.net/tech/node16.html
- **SPICE# Modified Nodal Analysis**: https://spicesharp.github.io/SpiceSharp/articles/custom_components/modified_nodal_analysis.html
- **Wikipedia — Modified Nodal Analysis**: https://en.wikipedia.org/wiki/Modified_nodal_analysis
- **Altium Power Analyzer (Keysight integration)**: https://www.altium.com/documentation/altium-designer/analyzing-pcb/pi-analysis/power-analyzer-keysight
- **Altium SI Analyzer**: https://www.altium.com/documentation/altium-designer/analyzing-pcb/si-analysis/si-analyzer-altium
- **KiCad SPICE simulator overview**: https://www.kicad.org/discover/spice/
- **LTspice product page**: https://www.analog.com/en/resources/design-tools-and-calculators/ltspice-simulator.html

### Secondary (background + comparison)
- **Wikipedia — Elmer FEM solver**: https://en.wikipedia.org/wiki/Elmer_FEM_solver
- **PCB thermal FEM analysis survey**: https://www.electronics-cooling.com/2004/05/modeling-heat-conduction-in-printed-circuit-boards-using-finite-element-analysis/
- **Open-source PCB thermal walkthrough**: https://jrainimo.com/build/2024/11/oss-thermal-simulation-of-pcbs/
- **Antmicro — Open-source signal integrity analysis (2023)**: https://antmicro.com/blog/2023/11/open-source-signal-integrity-analysis
- **FastField solvers**: https://www.fastfieldsolvers.com/

---

## Cross-references

- [CLAUDE.md](CLAUDE.md) Tech stack section — verified tools list + corrections folded in
- [SCHEMATIC-SYMBOLS.md](SCHEMATIC-SYMBOLS.md) — stage 5 symbol library research
- [OBJECT-MODEL.md](OBJECT-MODEL.md) §15 deferred questions — stages 1, 2, 4, 7, 8 each have a deferred row to track
- [PHYSICS-COVERAGE-MAP.md](PHYSICS-COVERAGE-MAP.md) — long-horizon physics roadmap

## Provenance

This doc captures findings from a deep-research workflow run on 2026-06-05:
- 5 search angles
- 22 sources fetched
- 93 falsifiable claims extracted
- 25 claims adversarially verified (3-vote panel)
- 21 confirmed + 4 killed
- Findings synthesized into 10 ranked claims with sources

Full workflow output at the conversation's task artifact (task ID `w461s6f1m`).
