# Product Requirements Document: ChipBlocks

> **Status:** Draft v0.1 · Working name (rename anytime) · Author: [User] · Date: 2026-05-07

---

## Problem Statement

Designing a custom chip — even a simple one — is currently locked behind years of engineering training and tens of thousands of dollars in tools. Off-the-shelf microcontrollers and FPGAs cover many use cases, but a long tail of inventors, makers, artists, educators, and small hardware startups have specific needs that don't fit standard parts: a custom synth chip, a specialized sensor pre-processor, a retro-game video chip, or a glue-logic part for a product.

These users currently have only three options:
1. Bend their product around an off-the-shelf part (compromised design, often 100× more silicon area and power than needed)
2. Hire a chip-design consultancy ($50K–$2M+, months to years)
3. Give up and build something simpler

The bottleneck **isn't manufacturing** — fabs at mature nodes (130nm+) and FPGA dev boards have plenty of capacity. The bottleneck is the design tools and the skills required to use them. Cadence and Synopsys cost $50K–$1M per seat and require an engineering team. Free academic alternatives (Verilator, Yosys, LiteX, OpenLane) are powerful but assume the user is already a chip engineer.

**There is no tool that lets a non-technical person turn "I need a chip that does X" into a fabricable design.** That gap is what ChipBlocks addresses.

## Goals

1. **Make chip design accessible to non-engineers.** A user with no Verilog knowledge can produce a working chip design (ready for FPGA, ASIC tape-out, or fab handoff) by describing what they want and assembling visual blocks.
2. **Be free or near-free.** Core tool is open-source; an optional desktop bundle costs at most $5 one-time. No subscriptions, no AI-cost liability for the developer (BYOK model).
3. **Cover the full non-physical chip-design flow** — architecture, RTL, verification, simulation — in one workspace. Physical design integrates with existing open-source flows (OpenLane, LibreLane, F4PGA).
4. **Build trust through validation.** Non-technical users need confidence the chip will actually work. The validator (lint + simulation + formal checks) catches problems before users waste money on fabrication or burn time on broken designs.
5. **Keep advanced users productive.** Pro engineers using ChipBlocks should be at least as fast as a traditional flow — never slower. Full underlying access is always available.
6. **Apply pressure to the manufacturing side of chips at mature nodes** by lowering the design barrier, expanding the population of people who can produce custom silicon.

## Non-Goals

1. **Cutting-edge nodes (5nm, 3nm, 2nm).** Fab-capacity-bound, not design-tool-bound. Also enterprise-only PDKs under heavy NDA. Out of scope.
2. **Physical-design tools (place-and-route, layout, DRC).** Existing open-source flows handle this. ChipBlocks integrates with them, doesn't replicate them.
3. **Enterprise EDA replacement.** Not "Cadence killer." Production teams designing flagship SoCs at advanced nodes will keep using enterprise tools. ChipBlocks serves the long tail those tools don't.
4. **Manufacturing or fulfillment.** ChipBlocks outputs files. The user takes them to a fab, FPGA programmer, or service like Tiny Tapeout. We never ship physical chips. Avoids inventory, NDA, and liability headaches.
5. **Real-time multi-user collaborative editing.** Single-user, file-based, version-controllable via git. Collaboration happens through GitHub, not in-app.
6. **Hosting paid AI inference.** Users bring their own API key (Claude, GPT, local Llama via Ollama). Project never pays AI bills on behalf of users.
7. **All HDL languages on day one.** Internal generation uses one HDL backbone (LiteX → Verilog) initially. Chisel, Amaranth, SpinalHDL support are designed-for but added later.
8. **Copyleft licensed code in the shipped product.** ChipBlocks ships only permissively-licensed code (MIT / Apache 2.0 / BSD / ISC / PSF). No GPL, AGPL, LGPL, MPL, or EUPL components are bundled in the distributed application, even transitively. This keeps the door open for future monetization (paid desktop bundle, Pro tier, hosted SaaS) without re-licensing surprises. We may **invoke** copyleft tools as separately-installed user binaries (e.g., the user's own GTKWave install), but we never redistribute them. Full licensing policy and dependency list in [CREDITS.md](CREDITS.md).

## Target Users / Personas

| Persona | Priority | Description |
|---|---|---|
| **Non-technical maker / inventor** | Primary | Has a product idea or hobby project. Knows what their chip should do but can't write Verilog. Off-the-shelf parts don't fit; currently has no path to a custom chip. |
| **Curious learner / student** | Primary | Wants to understand chip design by doing. Visual-first, with optional dive-deeper into the underlying code as they learn. |
| **Hobbyist engineer** | Secondary | Some technical background (Arduino, FPGA tinkering) but not a pro chip designer. Wants to make custom synths, retro chips, specialty sensors without a full EDA toolchain. |
| **Indie hardware founder** | Secondary | Small product company, can't afford a chip-design consultancy. Wants to prototype custom silicon. |
| **Educator / classroom user** | Secondary | Teaching chip design or digital logic. Wants visual, accessible, free tools for students. |
| **Pro engineer power user** | Tertiary | Already knows EDA. Uses ChipBlocks for fast prototyping or to access open-source flows in a friendlier UI. |

## User Stories

### Non-Technical Maker
- As a non-technical maker, I want to describe my problem in plain English so that the AI can suggest a starting template I can customize.
- As a non-technical maker, I want to drag pre-built blocks onto a canvas and wire them together so that I don't have to write code.
- As a non-technical maker, I want the validator to tell me clearly what's broken (in plain English) so that I can fix it without learning HDL.
- As a non-technical maker, I want to test my chip in simulation so that I don't waste money on a dead chip.
- As a non-technical maker, I want a zip of all manufacturing files so I can hand them off to a fab service or FPGA programmer.

### Curious Learner
- As a learner, I want to see the underlying RTL code my visual design generates so that I start understanding HDL.
- As a learner, I want the AI to explain what each block does and why it's needed so that I'm building intuition while I work.
- As a learner, I want to fork starter projects so that I can copy patterns from real designs.

### Hobbyist Engineer
- As a hobbyist, I want to design a 4-voice 8-bit synth chip and hear it in simulation so that I can iterate before flashing to my FPGA.
- As a hobbyist, I want to load my design onto an iCE40 / ECP5 / Xilinx / Intel FPGA dev board so that I can use it in a real project.
- As a hobbyist, I want the app to remember my settings, projects, and preferred dev boards so that I'm not re-configuring constantly.

### Indie Hardware Founder
- As a founder, I want to take a working FPGA prototype and convert it to an ASIC tape-out package (Tiny Tapeout, SkyWater MPW, IHP) so that I can produce real silicon when my product takes off.
- As a founder, I want my designs portable — exportable as Verilog/IP-XACT/SystemC — so that I'm not locked into ChipBlocks.

### Educator
- As an educator, I want a curriculum-friendly version with starter projects, lesson templates, and progress tracking so that I can use it in a classroom.

### Pro Engineer
- As a pro engineer, I want to bypass the visual editor and edit RTL directly when needed so that I can do things the visual editor doesn't support.
- As a pro engineer, I want to see all underlying tool outputs (Yosys logs, Verilator warnings, OpenLane reports) so that I can debug at depth.

## Requirements

### P0 — Must Have for Full Product

**Core Editor**
- Visual node-graph editor with drag-and-drop blocks, port-to-port wiring, zoom/pan, save/load
- Block library covering at least 3 domains by full release: audio/synth/retro (flagship), custom MCU, sensor/signal-conditioning
- Block parameter editing (frequency, voices, addresses, etc.)
- Project file format: JSON, version-controllable, human-readable

**AI Consultant**
- Chat sidebar that knows the block library and current canvas state
- BYOK — supports Claude, GPT, and at least one local model option (Ollama/Llama)
- Capabilities: answer "what block do I need for X?", explain block functions, suggest starter templates from a problem description, read simulation results, walk users through assembling a design step by step

**Validator**
- Static lint (Verilator `--lint-only`, Yosys check, Verible)
- Simulation (Verilator + auto-generated testbench from block metadata)
- Formal checks where applicable (SymbiYosys for combinational/sequential properties)
- **Plain-English error explanations**: every error gets translated by the AI into a beginner-friendly description with a suggested fix

**Output Engine**
- Generate Verilog RTL from the visual graph (via LiteX or equivalent)
- Run simulation and produce viewable results (waveforms via a permissively-licensed viewer — built-in or future TBD; **we drop GTKWave (GPL-2.0) and Surfer (EUPL-1.2)** from plans per the licensing policy below). For audio chips, also a playable WAV file.
- Generate FPGA bitstream for at least 3 popular dev boards: one iCE40 board (fully open flow), one ECP5 board, one Xilinx 7-Series board
- Generate Tiny Tapeout submission package
- Generate ASIC GDSII via OpenLane / LibreLane integration
- Output zip with all files, README, and a generated design document

**Power-User Mode**
- Direct RTL editing
- Full tool log access (Yosys, Verilator, OpenLane outputs)
- Ability to import existing Verilog modules as new blocks

**Cross-Platform**
- Mac, Windows, Linux desktop builds
- Project files portable between platforms

### P1 — Nice to Have

- Web-based version (browser-only, cloud workers for heavy synthesis)
- Real-time collaborative editing (à la Figma)
- Block marketplace where users contribute new blocks
- In-app waveform viewer built with permissive components (no copyleft viewers like GTKWave or Surfer)
- Templates beyond the flagship domain (sensor chips, custom MCUs, video chips)
- Mobile/tablet read-only viewer
- Curriculum/classroom mode with progress tracking
- Additional HDL backends (Chisel, Amaranth, SpinalHDL)

### P2 — Future Considerations (Designed-For-But-Not-Built)

- Direct foundry submission ("send to wafer.space / ChipFoundry" button)
- Real-silicon test framework (after fabrication, plug your chip in, run your tests on it)
- Hardware-software co-design (write firmware that runs on your chip in the same project)
- Mixed-signal design (analog blocks alongside digital)
- AI fully designs chip from English specification (architecture should not preclude, but unreliable in 2026)
- Closed-PDK support for advanced nodes (when more foundries open PDKs)
- Internationalization (multi-language UI and AI consultant)
- **Full general-purpose PCB / board design** — covers everything from hobby PCBs through motherboards, RAM modules (DIMMs / SODIMMs), expansion cards, server boards, and complex multi-layer boards. Schematic capture, comprehensive component library (passives, ICs, connectors, modules, MCUs, RAM, sockets), multi-layer layout + routing, design-rule checks (DRC), impedance control, Gerber + drill + BOM + pick-and-place output. **Goal: a free open-source competitor to KiCad / EasyEDA / Altium**, covering tier-1 (hobby) through tier-3 (prosumer/enterprise) board complexity. The visual node-graph + block-library architecture extends naturally to schematic capture; multi-layer routing is a much harder problem and may require a separate engine (or integration with an existing OSS router like FreeRouting). Possible "chip → product" flow as a special case: design a chip in ChipBlocks, drop it onto a PCB in the same app.
- **Beginner-friendly board views** — drag-and-drop breadboard view (Fritzing-style) for early prototyping before committing to a PCB layout. Useful for non-technical users learning electronics. Templates for common starter projects: Arduino shields, Raspberry Pi HATs, eurorack synth panels, sensor breakouts, custom carrier boards.

## Success Metrics

The defining metric is **(E) anyone other than the developer using the tool**. Without that, none of the rest matters.

### Leading Indicators (weeks)

**(B) Open-source traction**
- GitHub stars: 500 in 90 days, 2,000 by 6 months
- Forks: 50 by 6 months
- Contributors merging at least one PR: 10 by 6 months
- Discord / community channel: 200 members by 6 months

**(C) Real user activity**
- Downloads / active installs: 1,000 by 3 months, 5,000 by 6 months
- **Designs completed by users (not the developer)**: 10 by 30 days, 100 by 90 days, 500 by 6 months
- Manufacturing packages exported: 50 by 90 days

**(D) Education / community**
- ≥1 third-party YouTube tutorial within 90 days
- ≥1 classroom or workshop adoption by 6 months
- ≥1 Hackaday / Hackster.io feature article by 6 months

**(E) Anyone-but-me-using-it — single most important metric**
- ≥1 person who is not the developer completes a chip design end-to-end within 30 days of public launch
- ≥10 people other than the developer have completed at least one design by 90 days
- The "is anyone using this" graph trends up, not flat

### Lagging Indicators (months to years)

- **Real chips in the wild**: ≥5 user-designed chips successfully fabricated (Tiny Tapeout, MPW shuttle, or FPGA in production) within 18 months
- **Community blocks**: ≥20 user-contributed blocks accepted into the library within 12 months
- **Educational adoption**: ≥5 universities, schools, or formal workshops by 18 months
- **Sustained engagement**: developer is no longer top contributor by month 12 — i.e., the project becomes genuinely community-owned

### Anti-Metrics (signs of failure)

- AI consultant produces designs that fail validation more than ~30% of the time → AI is being asked to do too much; rein in scope
- Average time-to-first-working-chip for a new user > 4 hours → onboarding/UX has failed
- Issue tracker dominated by "I can't figure out X" with no clear pattern → docs/UX need work, not more features
- Six months in, all designs in the wild are still by the developer → the (E) metric has failed; product needs rethinking

## Open Questions

**Product / Design**
- Final product name? Working title is **ChipBlocks** — placeholder. [user]
- Visual style — playful (Scratch-like) or pro-tool (Figma-like)? Likely a blend, but lean direction? [user/design]
- How does the AI consultant handle disagreement with the user? ("I think you're wrong" vs. "Sure, let me help") [user/design]

**Technical**
- Node-graph library: React Flow vs. alternatives? Lock in early so block/port format aligns. [eng]
- Backend host: pure Electron + Node.js, or Electron + Python child process? Affects bundling complexity. [eng]
- Block authoring format: Python/LiteX directly, or higher-level metadata that compiles to LiteX? [eng]
- Cloud workers needed at all for v1, or can everything run locally? [eng]
- AI key management UX — how to make BYOK painless for non-technical users? [eng + design]

**Strategic / Business**
- ~~License: MIT, Apache 2.0, or AGPL?~~ **DECIDED 2026-05-07: MIT.** Permissive, monetization-friendly, the natural fit for the "free no strings" policy. See [LICENSE](LICENSE).
- Monetization: free forever, $5 desktop bundle, donate-ware (Patreon / GitHub Sponsors)? [user]
- Anonymous telemetry to understand usage? Privacy + open-source-ethic implications. [user]

**Legal**
- Export-control restrictions (EAR Cat 3 chip-design tools)? Almost certainly N/A at this scale, but worth confirming. [legal]
- IP attribution for blocks sourced from open-source projects (LiteX, OpenCores) — license review. [legal]

## Timeline Considerations

**Hard deadlines / dependencies**: None. User has stated this is a "fine taking time" project.

**Suggested phasing** (solo + AI dev tools, ~6–18 months):

| Phase | Months | Goal | Deliverable |
|---|---|---|---|
| **1 — Proof of Concept** | 1–3 | Prove the architecture end-to-end | 8-Bit Sound Chip Demo: ~7 audio blocks, drag-drop editor, simulation → WAV, basic AI sidebar. No FPGA/ASIC yet. |
| **2 — First External User** | 3–6 | Someone who isn't the developer makes a chip with it | Add 10–15 audio blocks, basic FPGA bitstream output (iCE40), polish UI, basic docs, ship to GitHub |
| **3 — Domain Expansion** | 6–12 | 100+ external users, community starts contributing | Add second domain (custom MCU or sensor), more FPGA targets, ASIC tape-out, Tiny Tapeout integration |
| **4 — Polish & Reach** | 12–18 | Real chips fabricated, sustained community | Web version, classroom mode, marketplace, more domains, conference / Hackaday presence |
| **5 — General-purpose PCB tool (future)** | 18+ | Free open-source competitor to KiCad / EasyEDA / Altium covering hobby through prosumer boards | Schematic editor, comprehensive component library, multi-layer layout + routing, DRC, Gerber + drill + BOM + pick-and-place output. Templates for common boards (Arduino shields, Pi HATs, eurorack, breakouts). Reuses the visual node-graph editor and block-library system from the chip side. Tier 1 (1–2 layer hobby) and tier 2 (4-layer prosumer) realistic for solo + AI dev. |
| **6 — High-complexity boards (future-future)** | 30+ | Tackle motherboards, RAM modules, server-class boards, high-speed digital | DDR4 / DDR5 memory routing, PCIe Gen 4–5 lanes, advanced power-delivery networks, signal-integrity simulation, impedance control, 8–16 layer stackups. Direct competitor space to Altium / Cadence Allegro. Almost certainly multi-developer / partnership / paid-tier territory. May be split off as a sibling project under the ChipBlocks brand. |

**Schedule risks**:
- Block library quality is the biggest single risk; one bad block breaks every user using it
- ASIC PnR runtime (hours per build) means Phase 3 needs an async UX or cloud workers
- Solo + non-technical means Claude Code reliability matters; Anthropic API outages or capability changes could slow specific weeks
- **Burnout** — solo 18-month projects often die at month 9 when the early excitement fades. Plan for sustainability: regular breaks, public progress posts, community engagement before you need it
- **Phase 5 (PCB) is essentially a second full product** — schematic capture, multi-layer layout, routing, and Gerber output is a fundamentally different workflow from chip RTL. Worth treating as a separate workstream when we get there, possibly a sibling project under the ChipBlocks brand. Don't let it bleed into Phases 1–4 timelines.
- **Phase 6 (motherboards / RAM / server-class boards) is genuinely hard** — DDR4/5 routing, PCIe high-speed lanes, multi-layer impedance control, signal integrity, and power-delivery networks require expertise that even Altium / Cadence Allegro users spend years acquiring. A free open-source tool replacing them at the cutting edge is extremely ambitious. Realistic plan: nail tier-1 (hobby) and tier-2 (4-layer prosumer) PCBs first; tier-3 (motherboards / RAM / DDR5) is multi-year, may need partnerships, possibly a paid tier, and the explicit option to never fully replace pro tools at the bleeding edge.
