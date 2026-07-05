# CREDITS

> Centralized credits, acknowledgments, and references for the ChipBlocks project. Citations also appear inline in per-fixture provenance fields and per-doc verification sections; this file consolidates the full picture.
>
> **Last updated:** 2026-07-05

---

## Project authors

| Role | Name | Notes |
|---|---|---|
| Project lead | **unexpear** | Originator, maintainer, direction setter. Per CLA.md, copyright holder for original contributions. |

Future contributors will be listed here after their first merged contribution. Per [CLA.md](CLA.md), contributions are licensed to the project under MIT (or whatever the project's then-current license is); contributors retain copyright in their original work.

---

## Commercial-use posture

The principle:

1. **The ChipBlocks app itself is free and open-source — forever.** Per [README.md](README.md) and [CLAUDE.md](CLAUDE.md) Core principle 4, no paid tier exists or will exist. The MIT license ([LICENSE](LICENSE)) keeps the source available for forking, study, modification, and personal use.

2. **Users own the files they create with ChipBlocks.** Per [PRD.md](PRD.md) §3 principle 5, every project produces **two deliverables**:
   - An editable source-form folder (`MyProject.chipblocks/`)
   - A manufacturing-ready ZIP (BOM, schematic, README, validation report) suitable for sending to a fab or assembler
   
   Both deliverables are the **user's intellectual property**. The user authored the design; ChipBlocks was a tool that helped them author it. The relationship is the same as a word processor producing a document or a CAD tool producing a model — the output belongs to the human creator.

3. **What users can do with their files:**
   - Keep them private
   - Share them freely
   - **Sell them** (designs, schematics, manufacturing-ready ZIPs, custom component packs they author, anything they create)
   - Use them in commercial products
   - Send to fabs, assemblers, or manufacturers
   - License them however the user chooses
   - Anything else the law permits

4. **What ChipBlocks (the project) does NOT do:**
   - **Does not** charge users for using the app
   - **Does not** take a cut of files users sell
   - **Does not** restrict users' commercial activity with files they create
   - **Does not** claim ownership of user-created content (per MIT, the output of the tool is not derivative of the tool's code)
   - **Does not** require attribution to ChipBlocks in user-created designs (good practice but not required)

5. **What the project may eventually offer (optional, future):**
   - A community-library / community-pack system where users can publish reusable blocks (analogous to npm packages or KiCad libraries). This is referenced in PRD.md §10 as a Later/maybe item. **NOT a marketplace** — a sharing infrastructure where the licensing of each pack is up to its author. Some may be permissively licensed; some may be commercial. The project itself wouldn't broker the transactions.

6. **About third parties selling forks of the APP:**
   - MIT permits this technically. Anyone can fork the code and try to charge money for their fork.
   - The **project name "ChipBlocks" is a trademark concern** — see [LEGAL-CONSIDERATIONS.md](LEGAL-CONSIDERATIONS.md) §3. The expected enforcement model: code is open-source forkable; the name "ChipBlocks" is reserved for the official project (Firefox / Mozilla model). A commercial fork would have to use a different name.
   - Trademark filing is recommended before significant launch — see LEGAL-CONSIDERATIONS.md action items.

---

## AI assistance disclosure

This project's development uses AI assistance, transparently and per the project's load-bearing principle:

> *"AI assists. ChipBlocks validates. The user approves."* — [CLAUDE.md](CLAUDE.md) Core principle 1

### Specific use

- **Claude Opus** (Anthropic, available via [claude.com/claude-code](https://claude.com/claude-code)) — primary AI collaborator during the v3 foundation-spec phase. Used for:
  - Drafting markdown documentation
  - Authoring YAML fixtures with cited values (every value traceable to authoritative sources — see Reference works below)
  - Writing TypeScript schema/validator code + Vitest tests
  - Conducting deep-research verification rounds (license verification, industry-standard claims, source authentication)
  - Drafting sprint plans and retros

### Per-commit attribution

Every AI-assisted commit carries a `Co-Authored-By:` trailer naming the specific AI model. Browse the git log to see the full per-commit trail. The user (project lead) directs every decision; AI surfaces options and drafts content; nothing ships without human approval — consistent with the project's core principle.

### What AI does NOT do

Per the project's core principles, AI does NOT:
- Produce the manufacturing-deliverable ZIP (Gerbers, BOM, manifest) that would go to a fab
- Produce the foundation's deterministic engine output (physics, units, conservation laws, net correctness, simulation results)
- Make autonomous decisions about project direction or scope

---

## Reference works

### Fundamental physical constants

- **NIST CODATA** (National Institute of Standards and Technology, US Department of Commerce) — fundamental physical constants used in copper resistivity, electron charge, Planck's constant, Boltzmann constant, etc. Public domain. Canonical URL: [physics.nist.gov/cuu/Constants/](https://physics.nist.gov/cuu/Constants/)

### Semiconductor physics

- **Sze, S. M., and Kwok K. Ng.** *Physics of Semiconductor Devices*, 3rd edition. Wiley-Interscience, 2007. — Bandgap energies, carrier mobilities, diode equation derivations, transistor physics. ISBN 978-0-471-14323-9
- **Schubert, E. Fred.** *Light-Emitting Diodes*, 2nd edition. Cambridge University Press, 2006. — LED material systems, III-nitride heterostructures, the green gap phenomenon, electroluminescence physics. ISBN 978-0-521-86538-8
- **Ioffe NSM Archive** (Ioffe Institute, St. Petersburg, Russia) — semiconductor parameters database covering Si, Ge, GaAs, GaN, InP, SiC, Diamond, InGaN, AlGaN, AlGaInP. URL: [ioffe.ru/SVA/NSM/Semicond/](http://www.ioffe.ru/SVA/NSM/Semicond/)

### General materials & chemistry

- **CRC Handbook of Chemistry and Physics**, 102nd edition. CRC Press, 2021. — Densities, melting points, thermal conductivities, alloy properties. ISBN 978-0-367-71259-2
- **ASM Metals Handbook**, Volume 2: *Properties and Selection — Nonferrous Alloys and Special-Purpose Materials*. ASM International. — Aluminum, copper, solder alloys, resistive alloys.
- **ASM Handbook**, Volume 6: *Welding, Brazing, and Soldering*. ASM International. — Solder alloy properties, joint mechanics.
- **MatNavi (NIMS Materials Database)** (National Institute for Materials Science, Japan) — referenced in MATERIAL-SOURCES.md as a cross-reference for specialty materials. URL: [mits.nims.go.jp/en/](https://mits.nims.go.jp/en/)

### Standards bodies and specifications

- **IEC** (International Electrotechnical Commission) — 60028 (annealed copper resistivity standard), 60617 (graphical symbols for diagrams), 60086 (primary batteries), 61190 (electronic-grade solder alloys), 61960 (lithium secondary cells), 62317 (ferrite cores), 60404 (magnetic materials), 62471 (photobiological safety of lamps including LEDs)
- **IEEE** — 315 (US schematic symbols), 60028 (cross-reference to IEC)
- **ANSI** — Y32.2-1975 (graphic symbols for electrical and electronic diagrams), ANSI/IEC 60086 (battery designations)
- **IPC** (Association Connecting Electronics Industries) — J-STD-003 (solderability / OSP), J-STD-006 (electronic-grade solder alloys), J-STD-020 (component moisture/reflow sensitivity), 2221 (generic PCB design — trace ampacity sizing), 4101 (PCB laminates including FR4), 4552 (ENIG surface finish), 4553 (immersion silver), 4562 (copper foil / copper weight), 7351 (SMD land-pattern standard — the board-road footprints' pad geometry), 9701 (thermal cycling reliability), A-610 (acceptability of electronic assemblies), TM-650 (test methods)
- **JEDEC** (JEDEC Solid State Technology Association) — component package outlines used for the board-road 3-D component body dimensions: MS-012 (SOIC narrow), MS-001 (PDIP / dual-in-line), TO-236 (SOT-23). Registered outline dimensions (body size + seated height) are factual package specifications.
- **Ucamco** — the **Gerber format** specification (RS-274X / X2), the de-facto PCB fabrication artwork standard the board road's Gerber writer implements against. Companion **Excellon / XNC** drill format for the drill files. Format specs are open and freely published by Ucamco.
- **ASTM** — B344 (resistance heating wire including nichrome), B32 (electronic-grade solder)
- **ICAO Standard Atmosphere (ISO 2533)** — atmospheric values used in material-air.yaml

### Manufacturer datasheets (cited specific part numbers)

Per the project's per-fixture provenance discipline, specific datasheets are cited for instance values. Examples:

- **Diodes / LEDs:** Vishay (TSAL6200, 1N4001, 1N5817, 1N4733A series), ON Semiconductor, ST Micro, Lite-On (LTL-4223), Kingbright (WP7113SRD-D)
- **LEDs (visible/UV):** Cree XLamp XQ-E series, Lumileds LUXEON Z Color, Osram OSLON SSL/Royal Blue/Ostar, Nichia NCSU033C, Bolb BS-1-365-T, Stanley QBHP684-UV, LG Innotek
- **Solder:** AIM, Indium Corporation, Kester (Sn63Pb37 and SAC305 datasheets cross-referenced)
- **Switches:** C&K 7101 series, NKK S-series families
- **PCB laminates:** Isola 370HR, ITEQ IT-180A
- **Batteries:** Duracell MN1604 (Procell), Energizer 522 (9V alkaline)
- **Chip resistors / passives (0603 body height):** Yageo RC0603 series, Vishay CRCW0603 series
- **Transistors (SOT-23 body height):** ON Semiconductor and Diodes Incorporated SOT-23 package drawings
- **Pin headers (2.54 mm body + pin dimensions):** Würth Elektronik and Amphenol 0.1″ (2.54 mm) header series

All values cited from manufacturer datasheets are factual measurements (not copyrighted expression); the citations are the standard professional practice for traceable engineering work.

---

## Standards reference materials

- **SCHEMATIC-SYMBOLS.md** references and uses inventory from the **ARRL standard schematic symbol catalog** (published by the American Radio Relay League). Used as a **what-to-render checklist** for the eventual canvas's symbol inventory. **The project does NOT copy ARRL's specific symbol graphics** — ChipBlocks's eventual SVG library will be original drawings following the same IEEE/ANSI 315 conventions. ARRL: [arrl.org](https://www.arrl.org/)

- **Wikipedia** — cited in verification rounds (Sprint 10, Sprint 11, deep-research workflow) for cross-referencing material systems by color, IEEE/ANSI 315 standards, MEEP licensing, and various other technical facts. Wikipedia is CC BY-SA 4.0; quoted facts are not subject to copyright (facts not copyrightable), and any verbatim quotation in cited material is short, attributed, and used per fair-use principles for reference purposes.

---

## Open-source projects referenced

None bundled at v3 Sprint 11 close. Projects referenced as design inspiration, future-integration candidates, or comparison references:

### Verified for symbol-library use

- **upb-lea/Inkscape_electric_Symbols** — CC0-1.0 (public domain). Comprehensive SVG schematic symbol library. Top supplementary candidate for the eventual canvas. Source: [github.com/upb-lea/Inkscape_electric_Symbols](https://github.com/upb-lea/Inkscape_electric_Symbols). Verified 2026-06-05.
- **AcheronProject/electrical_template** — BSD 3-Clause. SVG schematic symbols, explicit IEEE/ANSI 315-1975 alignment. Source: [github.com/AcheronProject/electrical_template](https://github.com/AcheronProject/electrical_template). Verified 2026-06-05.
- **KiCad symbol library** — GPL. Referenced as the de facto industry standard for schematic symbols. The project's eventual canvas will follow KiCad-compatible naming conventions but draw its own SVG symbols. Symbol library at [gitlab.com/kicad/libraries/kicad-symbols](https://gitlab.com/kicad/libraries/kicad-symbols).
- **KiCad footprint library** (`kicad-footprints`) — CC-BY-SA 4.0 **with the KiCad Library Exception** (the exception explicitly permits using the library's land patterns in your own designs/boards without the copyleft attaching to those designs). The board road's footprint pad geometry (0603, SOIC-8, DIP-8, pin header, SOT-23) is cited to this library as the reproducible source of the IPC-7351 land patterns; the DIMENSIONS themselves are functional facts (IPC-7351-derived land patterns), and each footprint was additionally ground-truthed against the project lead's installed KiCad 10.0. The library is NOT bundled or copied wholesale — only per-footprint dimensional values are reproduced, with provenance. Source: [gitlab.com/kicad/libraries/kicad-footprints](https://gitlab.com/kicad/libraries/kicad-footprints).
- **KiCad (kicad-cli)** — GPL-3.0, invoked as an external user-installed tool (never bundled). Used ONLY as ground-truth to verify the board road's from-scratch Gerber/Excellon output byte-shape against real fab files (`kicad-cli pcb export`); no KiCad code ships in ChipBlocks. Source: [gitlab.com/kicad/code/kicad](https://gitlab.com/kicad/code/kicad).

### Tools recommended for future integration (per CLAUDE.md + SIMULATION-AND-VISUALIZATION-ARC.md)

- **Magic VLSI** — UC Berkeley BSD-style permissive, bundleable. For IC layout. Source: [github.com/RTimothyEdwards/magic](https://github.com/RTimothyEdwards/magic). Verified 2026-06-05.
- **ngspice** — Mixed-license (primarily 3-clause BSD with embedded LGPL/GPL components). For transient circuit simulation. Invoked as external user-installed process. Source: [ngspice.sourceforge.io](https://ngspice.sourceforge.io/). License inventory verified 2026-06-05 against maintainer Holger Vogt's documentation.
- **KLayout** — GPL-3.0. For GDS file viewing. Invoked as external user-installed process. Source: [github.com/KLayout/klayout](https://github.com/KLayout/klayout). Verified 2026-06-05.
- **openEMS** — GPL-3.0. For full-wave electromagnetic simulation (FDTD). If EMI/EMC analysis is added, invoked as external process. Source: [github.com/thliebig/openEMS](https://github.com/thliebig/openEMS). Verified 2026-06-05.
- **MEEP** — GPL-2.0-or-later. Alternative EM solver. External process only. Source: [github.com/NanoComp/meep](https://github.com/NanoComp/meep). Verified 2026-06-05. **Note:** the "MIT" in MEEP's name refers to Massachusetts Institute of Technology (originating institution), NOT the MIT software license.

### Open PDKs referenced (Layer 0 sourcing in MATERIAL-SOURCES.md)

- **IHP SG13G2** — 130nm SiGe BiCMOS, Apache 2.0. The currently-active maintained open PDK. Source: [github.com/IHP-GmbH/IHP-Open-PDK](https://github.com/IHP-GmbH/IHP-Open-PDK). Verified 2026-05-18 in MATERIAL-SOURCES.md.
- **SkyWater SKY130** — 130nm CMOS, Apache 2.0. Archived 2026-04-18. Read-only historical reference. Source: [github.com/google/skywater-pdk](https://github.com/google/skywater-pdk).
- **GF180MCU** — 180nm CMOS, Apache 2.0. Archived 2026-04-22. Read-only historical reference. Source: [github.com/google/gf180mcu-pdk](https://github.com/google/gf180mcu-pdk).

### Runtime / bundled dependencies (ship in the app)

- **React** + **React-DOM** — MIT (the renderer UI framework)
- **@xyflow/react** (React Flow, v12) — MIT (the schematic canvas)
- **Electron** — MIT (the desktop shell; added Sprint 18)
- **mathjs** — Apache-2.0 (added Sprint 12; NOTICE preserved at project root)
- **Ajv** + **ajv-formats** — MIT (JSON-Schema validation of the catalog)
- **yaml** (npm package) — ISC (catalog parsing)

### Development toolchain (build/test only)

- **TypeScript** — Apache 2.0
- **Vite** + **electron-vite** + **@vitejs/plugin-react** — MIT (build tooling)
- **Vitest** — MIT
- **Biome** — MIT OR Apache-2.0 (dual)
- **@types/node** / **@types/react** / **@types/react-dom** — MIT (DefinitelyTyped)
- **Node.js** — MIT-based

All dependencies pass the project's permissive-license-only rule (CLAUDE.md principle 4: MIT / Apache-2.0 / BSD / ISC / CC0 / MPL-2.0) — every entry above is MIT, Apache-2.0, or ISC, verified 2026-07-05 against each package's own `license` field. The from-scratch board work (footprint model, copper router, DRC, Gerber/Excellon writers, manufacturing ZIP, and the 3-D board engine) adds **no new dependencies** — it is original TypeScript, consistent with the project's from-scratch stance. Per-package license verification done during Sprint 2 toolchain selection ([TOOLING-RESEARCH-2026-05.md](TOOLING-RESEARCH-2026-05.md)), Sprint 12 (mathjs), and Sprint 18 (Electron/React/React Flow). Full attribution + NOTICE compliance scaffolding lives in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) and [NOTICE](NOTICE).

---

## Historical context

- **ChipBlocks v1 (audio-synth direction)** — preserved on branch `legacy/audio-synth-direction` and tag `v0.1.0-alpha.9-final`. See [README.md](README.md) for full history of the reset.
- **ChipBlocks v2 (foundation-pre-second-reset)** — preserved on branch `archive/foundation-pre-second-reset` and tag `v0.2.0-foundation-2026-05-20`.

The current v3 work began at the second reset and has been documented in the `sprints/` directory.

---

## How to be added to this file

If you've made a substantive contribution to ChipBlocks (code, docs, design, or verification work that's been merged to master), you're welcome to add yourself to the Project authors table via pull request. Include:

- Your name (or pseudonym)
- A short role/contribution description
- Optional: link to your relevant work

Per the [CLA.md](CLA.md), submitting a contribution signals your agreement to license it under the project's then-current license (currently MIT) and grant the Maintainer the rights described therein.

---

## License of this file

This file is part of ChipBlocks and is licensed under MIT, same as the rest of the project — see [LICENSE](LICENSE).
