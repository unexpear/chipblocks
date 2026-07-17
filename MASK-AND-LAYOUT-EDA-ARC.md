# Masks, Layout & the EDA Back-End — the chip-side "manufacturing data" arc

> **Purpose.** ChipBlocks ships two deliverables per project: an editable design + a manufacturing-ready data package. For PCBs that package is Gerber/Excellon (built — see [footprint model / board road]). For **chips**, the equivalent is **mask-ready layout data (GDSII/OASIS)** that a mask shop / foundry can turn into physical masks and silicon. This document is the reference for building that chip-side path — what a mask is, what the layout format is, which sign-off checks gate it, the open-source/open-PDK landscape with **exact licenses** (so we know what to build vs. shell out to), and a concrete incremental build order.
>
> **Provenance.** Synthesized from two adversarially-verified deep-research passes (2026-07-17): a fundamentals pass (110 agents, 27 sources, 22/25 claims confirmed) and a gap-filling pass (5 source-grounded searchers reading primary repo LICENSE files / specs). Confidence is flagged per claim. Lithography numbers are **process-node-dependent** — treat them as parameters, not constants. Not legal advice; licenses must be re-confirmed before any bundling decision.
>
> **The one-line answer to "can we build our own?"** Yes for the software: the chip deliverable is a **DRC/LVS-clean GDSII file**, and a GDSII writer + a geometric DRC + an LVS engine are all buildable in-app from permissive first principles (the same way we built the Gerber writer instead of bundling a PCB tool). The **physical** mask-making (OPC, fracturing, e-beam writing) is firmly **foundry-side and out of scope**.

---

## 0. Who does what — the scope boundary

| Step | Whose job | ChipBlocks? |
|---|---|---|
| Schematic / netlist | designer / tool | ✅ have it |
| Synthesis, placement | tool | ✅ placement shipped; routing next |
| **Layout → DRC-clean, LVS-clean GDSII** | **the design tool** | ✅ **this is our finish line** |
| Mask Data Prep: fracturing, OPC, RET, MRC | **foundry / mask shop** | ❌ out of scope |
| Physical mask + wafer fabrication | **foundry** | ❌ out of scope |

Our deliverable stops at a **GDSII that passes DRC (geometry legal) and LVS (layout matches schematic)**. Everything past that is the fab's.

---

## 1. Photolithography & masks — the fundamentals

- A **photomask** (a.k.a. reticle) is a **fused-silica/quartz plate** carrying a **chrome (absorber) pattern** for **one** wafer layer, often protected by a **pellicle**. Light shines through it onto **photoresist** on the wafer; the resist is developed, then the layer is etched or implanted through it.
- **Resist tone** (verified, medium confidence — canonical but anchored on course notes): **positive resist** removes the **exposed** region; **negative resist** removes the **unexposed** region.
- A chip needs a **mask set — one mask per patterned layer** (well, active/diffusion, poly, implants, contact, metal1…N, via1…N, passivation). **⚠️ Do NOT hardcode a generic mask order** — a specific enumerated CMOS sequence was **refuted** in verification. Derive the real layer list + order from a **specific PDK's layermap** (see §2, SKY130 numbers).
- **Exposure physics** (verified high, Chris Mack / SPIE): resolution and depth of focus follow the **Rayleigh criterion**:

  ```
  R   = k₁ · λ / NA           (minimum printable feature / half-pitch)
  DOF = k₂ · λ / NA²          (depth of focus)
  ```

  where **λ** = exposure wavelength, **NA** = numerical aperture, **k₁, k₂** = process-dependent constants (typical k₁ ≈ 0.4–0.9, k₂ ≈ 0.5; a documented i-line example uses **k₁ = 0.46**). **Every value is node-dependent.** Wavelengths and the features they enable: i-line **365 nm**, DUV **248/193 nm**, **193i** immersion, EUV **13.5 nm**. Steppers/scanners typically image a **4× reduction** reticle.
- **Reference textbook:** Weste & Harris, *CMOS VLSI Design* (4th ed.), **Chapter 3 "CMOS Processing Technology"** — the mask-step walkthrough + λ-based design rules (the same λ-rule basis our `cell-layout.ts` already uses).

---

## 2. Layout / mask data — the format we must emit

### GDSII (the "Gerber for chips")
- **Binary stream format**, the **de-facto EDA layout interchange standard**, literally **designed to drive photomask plotting** (Calma, 1978) — the historical tie between our deliverable and mask making.
- **Load-bearing fact for our writer (verified high):** GDSII identifies geometry by an **integer layer number + datatype**, **NOT by names**. Layer/datatype are 16-bit integers (guaranteed 0–32767 signed; vendors extend to 0–65535). Human layer names live in an **external layer-map file**, not in the stream.
- Structure (high level): a library (`HEADER`/`BGNLIB`/`LIBNAME`/`UNITS`) of **structures/cells**, each holding **elements** — `BOUNDARY` (polygon: LAYER + DATATYPE + XY point list), `PATH`, `SREF`/`AREF` (cell reference / array for hierarchy), `TEXT` — closed by `ENDEL`/`ENDSTR`/`ENDLIB`. `UNITS` sets the user-unit and the database grid (e.g. 1 µm user unit, 1 nm database unit).

### OASIS (SEMI P39) — the compact successor
- Interchange/encapsulation format for **hierarchical IC mask layout**, sitting in the EDA → mask-writer → mask-inspection pipeline. Targets **≥10× smaller files** than GDSII via 64-bit capability. Optional/later for us. (Not to be confused with SEMI **P44 OASIS.MASK**, a mask-tool format.)

### The layer-map mechanism (the refuted-then-resolved part)
The earlier "technology file / StreamIn-StreamOut keywords" framing was **refuted**. The **real, concrete convention** is a simple **per-layer `name → {gds_layer:int, gds_datatype:int}` table**, shipped by the PDK in several equivalent forms:
- **Magic techfile:** `calma NAME <layer> <datatype>` (e.g. `calma MET1 68 20`) — shipped as `sky130/magic/sky130gds.tech`. **This is the exact table our GDSII writer needs.**
- **KLayout:** `.lyp` (XML/YAML — binds layer/datatype → name + display color) and a `.map`/`.lyt` layer-map (grammar: `match_expr : target_expr`, supports ranges/wildcards/rename/remap).
- **LEF/DEF → GDS `layermap.txt`** (OpenROAD `def2gds`): 4 columns `LEF_NAME  PURPOSE  GDS_LAYER  GDS_DATATYPE`, where one LEF name splits by purpose.

**SKY130 real GDS numbers** (verified — ship these as the built-in default map; the *datatype* encodes purpose: drawing/net = **20**, pin = **16**, label = **5**, cut/via = **44**):

| Layer | GDS | | Layer | GDS |
|---|---|---|---|---|
| nwell | 64/20 | | mcon | 67/44 |
| diff | 65/20 | | met1 | 68/20 |
| poly | 66/20 | | via | 68/44 |
| licon1 | 66/44 | | met2 | 69/20 |
| li1 | 67/20 | | via2 | 69/44 |

Convention: each routing **metal = datatype 20**; the **cut/via above it reuses the metal's layer number at datatype 44** (met1 = 68/20 → via = 68/44). Verify higher metals (met3 70, met4 71, met5 72, pad ~76) against SkyWater's [Layers Reference](https://skywater-pdk.readthedocs.io/en/main/rules/layers.html) before shipping.

### What a PDK contains (and we consume)
Layer definitions + **design-rule deck (DRC)**, a **standard-cell library with real layout**, **SPICE device models**, and **LEF/tech-LEF** abstracts (**LEF** = cell/tech black-box: pins, layers, obstructions; **DEF** = placed-and-routed design instance).

---

## 3. The layout → mask flow, and tapeout sign-off

- **Mask Data Prep (MDP) — foundry-side, NOT ours:** **fracturing** (decompose polygons into the mask writer's trapezoid/rectangle shots), **OPC** (optical proximity correction) and **RET** (sub-resolution assist features, phase-shift masks, multiple patterning), **Mask Rule Check (MRC)**, then e-beam/multibeam mask writing (MEBES/OASIS.MASK).
- **Sign-off — OUR job (this is what gates a clean GDSII):**
  - **DRC** — geometric design-rule check: min width, min spacing, enclosure/overlap, min area, density, antenna. Each rule has a physics reason (lithography printability, etch, CMP, plasma charging).
  - **LVS** — layout-versus-schematic: extract a netlist from the polygons and prove it **equals** the schematic netlist. *This is exactly the "does the layout match the design?" consistency check the persistent-layers refactor sets up.*
  - Parasitic extraction, ERC, metal fill/density (CMP) — later refinements.

---

## 4. Open-source EDA + open-PDK landscape (with exact licenses)

**This table governs what ChipBlocks may BUNDLE vs. must invoke as an external process.** Whitelist (per CLAUDE.md): MIT / Apache-2.0 / BSD / ISC / CC0 / MPL-2.0.

| Tool / format | Role | License (SPDX, primary-source verified) | Verdict |
|---|---|---|---|
| **Yosys** | RTL synthesis | **ISC** | ✅ bundleable (we have our own bridge) |
| **Magic** | layout / DRC / extraction | **permissive** (UC-Berkeley HPND / BSD-MIT-style) | ✅ bundleable *(confirm HPND admitted)* |
| **OpenROAD** | RTL→GDS P&R engine | **BSD-3-Clause** | ✅ bundleable (heavy — usually external) |
| **OpenLane v1** | RTL→GDS flow wrapper | **Apache-2.0** | ✅ bundleable |
| **OpenLane 2 / LibreLane** | rewritten flow (now **LibreLane**, FOSSi) | **Apache-2.0** (Nix files MIT) | ✅ bundleable |
| **OpenDB / odb** | OpenROAD physical DB (LEF/DEF) | **BSD-3-Clause** | ✅ bundleable |
| **LEF/DEF parsers** | Si2 reference parsers | permissive (Apache/BSD) | ✅ bundleable |
| **gdstk** | GDSII/OASIS C++/Py library | **BSL-1.0** (verified from LICENSE) | ⚠️ permissive but **off-whitelist** → decision, or build our own |
| **gdspy** | older GDSII Py library (deprecated) | **BSL-1.0** | ⚠️ same; superseded by gdstk |
| **Netgen** | **LVS** | **GPL-1.0-or-later** (copyleft) | ❌ **external process only — do NOT bundle** |
| **ngspice** | SPICE | **mixed**: BSD-3 core + LGPL (numparam/tclspice/adms) + **GPL** XSPICE "table" model | ❌ external only (matches current stance) |
| **KLayout** | GDS/OASIS view + DRC scripting | **GPL-2.0-or-later** (copyleft) | ❌ external process only |

> **⚠️ Key correction — do not lump Magic and Netgen together.** They share a maintainer (R. T. Edwards) but have **opposite** postures: **Magic is permissive** (bundleable), **Netgen is GPL** (external-only). CLAUDE.md's tooling notes should reflect this.

**Open PDKs — all Apache-2.0, bundleable** (subject to the Apache-2.0 NOTICE-file obligation):

| PDK | Node | Steward | Notes |
|---|---|---|---|
| **SkyWater SKY130** | 130 nm CMOS | Google / CHIPS Alliance | first open *foundry* PDK; open subset is **experimental/alpha, "not for production"**; a fuller PDK (Calibre decks) is NDA-only |
| **GF180MCU** | 180 nm CMOS | Google+GF / CHIPS Alliance | 3.3V/(5V)6V MCU bulk |
| **IHP SG13G2** | 130 nm SiGe BiCMOS | IHP (EU public institute) | RF/analog HBT (~350 GHz fT); preview |

> **SKY130 legal caveat (the refuted "no restrictions at all" claim):** the open PDK needs **no NDA to obtain** and escapes US export control (**ECCN 3E001/3E991**) only via the EAR **"published information" exclusion** — *not* because PDKs are inherently unrestricted. Proprietary PDKs + physical fab access remain restricted.

### The path to actual silicon (⚠️ HIGHLY time-sensitive — verified July 2026, re-check before relying)
- **Efabless shut down (March 2025).** Its **chipIgnite** MPW was relaunched Sept 2025 by **UmbraLogic / "ChipFoundry"** ([chipfoundry.io](https://chipfoundry.io/faqs)) — operational in 2026 (~$14,950/project, SKY130).
- **Tiny Tapeout** — tile-based shuttle (~160×100 µm/tile ≈ 1000 gates; designs Apache-2.0; PDKs sky130A / ihp-sg13g2 / gf180). Current run **ttihp26a** (IHP SG13G2; submit by 23 Mar 2026; chips ~Sep 2026).
- **wafer.space** — new GF180 MPW pooling by Tim Ansell (mithro); GF180 runs Mar/May 2026 (~$7,000/slot, ~$7/die).
- Google's original **free** OpenMPW ended; the free-shuttle era is succeeded by **paid community services** (ChipFoundry, wafer.space, Tiny Tapeout).

---

## 5. What ChipBlocks builds (in-app, permissive) vs. reuses — with the algorithms

**Strategy: build the small permissive core in-app; never bundle the copyleft tools; bundle an open PDK for real layer/rule data.** Because we build our own writer/DRC/LVS, the copyleft tools (KLayout, Netgen, ngspice) are only ever *optional external cross-checks*.

### 5a. Technology / PDK model — **build**
A `name → {gds_layer, gds_datatype}` layer map + a design-rule table, seeded from a real open PDK (SKY130 numbers above; mirror Magic's `calma` table). **Do not hardcode a generic mask order — read the PDK's.**

### 5b. Real standard-cell layout geometry — **build** (upgrade from today's area rectangle)
Per-layer polygons via **Euler-path transistor ordering** (Uehara & vanCleemput 1981; Weste & Harris): order the series/parallel stack so it forms **one complete Euler path**, letting all transistors **share diffusion** (uninterrupted active). Every unavoidable **diffusion break costs one contacted-poly-pitch (CPP)** of cell width. The Euler path must be consistent across pull-up and pull-down nets. (Our `cell-layout.ts` already computes the area rectangle; this fills in the poly/diff/metal/well polygons + power rails.)

### 5c. GDSII writer — **build** (the binary twin of the Gerber writer)
Emit `HEADER → BGNLIB/UNITS → {BGNSTR → BOUNDARY[LAYER,DATATYPE,XY]… → ENDSTR} → ENDLIB`, layer-mapped via 5a. gdstk (BSL-1.0) is a reference implementation, not a dependency.

### 5d. Geometric DRC — **build**
The canonical approach is a **scanline / sweep-line**: sort layout edges into an event list; sweep a virtual line; only edges crossing it are "active"; width/spacing become distance checks between parallel active edge pairs (two orthogonal passes for Manhattan layouts). Most rules reduce to **layer Booleans (AND/OR/NOT/XOR) + sizing (grow/shrink = Minkowski)**: width ≈ shrink-then-grow (opening); spacing ≈ grow-then-shrink (closing); enclosure ≈ A NOT (B sized). Underlying primitives: **Bentley–Ottmann** segment-intersection sweep, **Vatti** (or Greiner–Hormann) polygon clipping. Optional foundation: **corner-stitching** (Ousterhout 1983 — Magic's tile structure) for a live editor. Modern buildable references: **X-Check (ICCAD'22), OpenDRC (DAC'23)**.

### 5e. LVS + extraction — **build** (and it's the schematic↔layout drift check)
1. **Connectivity extraction** — union-find (connected-component labeling) over the layer-overlap graph: shapes touching on the same layer, or overlapping across connected layers (met1–via–met2, contact–diff), are one net.
2. **Device recognition** — derived-layer intersection: **MOSFET = poly AND diffusion** (gate); source/drain = diffusion each side; W/L from the gate rectangle. Same pattern extracts R/C/diode.
3. **Netlist compare — the Gemini algorithm**: model each netlist as a bipartite device/net graph; **iterative graph coloring / partition refinement** (seed labels from local invariants like device type and net fan-out; re-hash each node's label from its neighbors' labels; alternate device↔net passes splitting partitions until singletons = isomorphism). **Netgen is the reference implementation to mirror** (net-fanout relabel ↔ device-partition fracture). Handle **permutable pins** (FET source/drain, resistor ends = unordered) and **symmetry/automorphism** (force-a-match + backtrack); **SubGemini** (DAC'93) for hierarchical/subcircuit matching.

### Recommended incremental build order
1. **Tech/PDK model** (5a) — layer map + rule table from SKY130. *Smallest, unblocks everything.*
2. **GDSII writer** (5c) — emit a layer-mapped GDS of the *current* placed floorplan (even as simple rectangles). First real "mask-ready" artifact.
3. **Real cell polygons** (5b) — Euler-path layout for the small standard-cell library.
4. **DRC** (5d) — scanline width/spacing/enclosure against the rule table; report violations (never auto-fix), twin of the board DRC.
5. **LVS** (5e) — extract + Gemini compare vs. the schematic netlist. Wires into the persistent-layer **drift/consistency** check.
6. **OASIS** (optional, compacter) + a documented hand-off to a real shuttle (Tiny Tapeout / ChipFoundry / wafer.space).

**Honest boundary — feasible:** a small DRC/LVS-clean standard-cell library + a real layer-mapped GDS on an open PDK (SKY130/GF180). **Not feasible / out of scope:** leading-edge OPC, EUV, multipatterning decomposition, and physical mask/wafer making — all foundry-side.

---

## Confidence, refuted claims & remaining gaps
- **Refuted (do NOT rely on):** a generic hardcoded CMOS mask sequence (derive from a PDK); the "technology-file StreamIn/Out keyword" layer-map mechanism (real = per-layer integer table); "SKY130 has zero NDA/export restrictions" (only the open subset, only via the published-info EAR exclusion).
- **Time-sensitive:** the entire fab-shuttle section (§4) churned in 2025–2026 — re-verify prices/dates/status before relying.
- **Medium-confidence anchors:** resist-tone and GDSII "de-facto/photomask-origin" facts are canonical but rest partly on secondary sources; obtain the actual **GDSII stream spec** and **SEMI P39** before implementing the writer.
- **Not yet done:** parasitic extraction and antenna-rule specifics; OASIS binary details.

## Primary sources
Mack, [Rayleigh resolution/DOF (SPIE)](https://www.lithoguru.com/scientist/litho_papers/1997_63_Resolution%20and%20Depth%20of%20Focus%20in%20OL.pdf) · [Weste & Harris Ch.3](https://pages.hmc.edu/harris/cmosvlsi/4e/index.html) · [GDSII](https://en.wikipedia.org/wiki/GDSII) · [SEMI P39 OASIS](https://store-us.semi.org/products/p03900-semi-p39-specification-for-oasis%C2%AE-open-artwork-system-interchange-standard) · [SKY130 layer numbers](https://skywater-pdk.readthedocs.io/en/main/rules/layers.html) + [open_pdks sky130gds.tech](https://github.com/RTimothyEdwards/open_pdks) · Euler-path cell layout — [ASP-DAC 2025](https://par.nsf.gov/servlets/purl/10626481) · corner stitching — [Ousterhout 1983 (UCB)](https://www2.eecs.berkeley.edu/Pubs/TechRpts/1983/6352.html) · [KLayout DRC model](https://deepwiki.com/KLayout/klayout/4.1-design-rule-checking-(drc)) · Gemini LVS — [ACM](https://dl.acm.org/doi/10.1145/157485.164556) + [netgen](http://opencircuitdesign.com/netgen/tutorial/tutorial.html) · Licenses — [Magic](https://raw.githubusercontent.com/RTimothyEdwards/magic/master/LICENSE), [Netgen(GPL)](https://raw.githubusercontent.com/RTimothyEdwards/netgen/master/base/query.c), [OpenROAD(BSD-3)](https://raw.githubusercontent.com/The-OpenROAD-Project/OpenROAD/master/LICENSE), [KLayout(GPL)](https://www.klayout.de/license.html), [gdstk(BSL-1.0)](https://raw.githubusercontent.com/heitzmann/gdstk/main/LICENSE) · PDKs — [SKY130](https://github.com/google/skywater-pdk), [GF180MCU](https://github.com/google/gf180mcu-pdk), [IHP SG13G2](https://github.com/IHP-GmbH/IHP-Open-PDK) · Shuttles — [Tiny Tapeout](https://tinytapeout.com/), [ChipFoundry](https://chipfoundry.io/faqs), [wafer.space](https://wafer.space/)
