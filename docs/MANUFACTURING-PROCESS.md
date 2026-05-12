# Technical Drawing — CPU manufacturing process (ChipBlocks edition)

```
+-------------------------------------------------------------------+
|  Drawing name        ChipBlocks — Visual graph to silicon         |
|                      End-to-end manufacturing process             |
|  Drawing number      DOC-MFG-001                                  |
|  Revision            A · 2026-05-12                               |
|  Author              ChipBlocks project (CLAUDE.md user)          |
|  Co-author           Claude Code (Opus 4.7)                       |
|  Scale               Process flow: not to scale (logarithmic       |
|                      scale would be needed — wafer is 300 mm,     |
|                      transistor gate is ~50 nm, ratio ≈ 6×10^6)   |
|  Units               Mixed by section:                            |
|                        - silicon features: nm (nanometres)        |
|                        - wafer / die / package: mm (millimetres)  |
|                        - PCB / installation: cm / inches          |
|  Standards           ISO 128 (line types) · ISO 129 (dimensions)  |
|                      · ISO 1101 (geometric tolerancing) ·         |
|                      ASME Y14.5 conventions used where the US     |
|                      semiconductor industry has set the de-facto  |
|                      shape (Tiny Tapeout submissions, OpenLane    |
|                      flow).                                       |
|  Projection          First-angle (Europe/Asia conventions) for    |
|                      flowcharts; cross-sections are layer-by-     |
|                      layer top-down stack views.                  |
|  Revision history                                                 |
|    A 2026-05-12 Initial issue. Covers iCE40 FPGA path + Tiny      |
|                 Tapeout SkyWater 130 / GlobalFoundries 180 ASIC   |
|                 paths. Excludes 5/3/2-nm nodes (see PRD non-goals)|
+-------------------------------------------------------------------+
```

## 1. Scope

This drawing documents the manufacturing process for a chip designed in **ChipBlocks** — the visual node-graph editor at the top of [README.md](../README.md). The pipeline has two terminal outputs:

- **FPGA bitstream** — flashed to a Lattice iCEstick, TinyFPGA BX, or 1BitSquared iCEBreaker board (~minutes from design to running silicon you can hold).
- **ASIC tape-out package** — submitted to Tiny Tapeout's quarterly shuttle on the SkyWater 130 nm or GlobalFoundries 180 nm open PDK (~months from design to packaged chip on your desk).

Both share the same first four stages (design → HDL → synthesis → place-and-route); they diverge at the bitstream-vs-mask-set fork.

The drawing is intended for **educational use** — teaching a non-technical reader what physically happens when they click `🔧 Build` in the app — and for **process documentation** so a future contributor can trace any artefact back to the stage that produced it.

## 2. Block diagram — the seven manufacturing stages

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   STAGE 1            STAGE 2            STAGE 3            STAGE 4       │
│  ┌─────────┐        ┌─────────┐        ┌─────────┐        ┌─────────┐    │
│  │ DESIGN  │───────►│   HDL   │───────►│  SYNTH  │───────►│   P&R   │    │
│  │         │        │         │        │         │        │         │    │
│  │ visual  │        │ Verilog │        │ gate    │        │ placed +│    │
│  │ graph   │        │ + sim   │        │ netlist │        │ routed  │    │
│  │ (.json) │        │ (.v)    │        │ (.json) │        │ (.asc)  │    │
│  └─────────┘        └─────────┘        └─────────┘        └─────────┘    │
│  ChipBlocks         Amaranth HDL       Yosys              nextpnr        │
│  app (renderer)     translator         synthesiser        placer-router  │
│                                                                          │
│                                            ┌──── FPGA path ──┐           │
│                                            ▼                  ▼          │
│                                       ┌─────────┐        ┌─────────┐    │
│                                       │ BITSTREAM        │  TAPE-OUT │   │
│                                       │ (.bin)  │        │  PACKAGE  │   │
│                                       │ icepack │        │  (zip)    │   │
│                                       └─────────┘        └─────────┘    │
│                                            │                  │          │
│                                            ▼                  ▼          │
│                                       STAGE 5a            STAGE 5b       │
│                                       ┌─────────┐        ┌─────────┐    │
│                                       │ FLASH   │        │ FAB     │    │
│                                       │ to dev  │        │ on      │    │
│                                       │ board   │        │ SkyWater│    │
│                                       │ via USB │        │ Sky130 /│    │
│                                       │ (iceprog)        │  GF180  │    │
│                                       └─────────┘        └─────────┘    │
│                                            │                  │          │
│                                            ▼                  ▼          │
│                                       STAGE 6a            STAGE 6b       │
│                                       ┌─────────┐        ┌─────────┐    │
│                                       │ TEST    │        │ DICE +  │    │
│                                       │ on dev  │        │ PACKAGE │    │
│                                       │ board   │        │  + TEST │    │
│                                       │ (you)   │        │ (TT lab)│    │
│                                       └─────────┘        └─────────┘    │
│                                            │                  │          │
│                                            ▼                  ▼          │
│                                       STAGE 7              STAGE 7       │
│                                       Working FPGA        Working ASIC   │
│                                       chip (re-flashable) (permanent)    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Material flow** is left-to-right and top-to-bottom. The fork at the end of STAGE 4 is the **bitstream-vs-mask-set** decision: an FPGA can be reflashed any number of times (its "metal layers" are made of pass-transistor LUTs, not real metal wires), while an ASIC's metal stack is photographically printed once and is permanent.

## 3. Per-stage flowchart

For each stage: **input · process · key tool · output**.

| Stage | Input | Process | Key tool | Output |
|---|---|---|---|---|
| 1. Design | user's mental model of the chip | drag blocks onto a canvas, wire ports, set parameters | ChipBlocks renderer (Electron + React Flow) | `chipblocks-graph.json` |
| 2. HDL | `chipblocks-graph.json` | translate graph into Amaranth Python; elaborate into Verilog | `backend/synth.py` + `backend/build.py` (calls `amaranth.back.verilog.convert`) | `chipblocks.v` |
| 3. Synth | `chipblocks.v` | logic synthesis — boolean optimization, technology mapping to LUTs (FPGA) or standard cells (ASIC) | **Yosys** (ISC-licensed, open) | `chipblocks.json` (intermediate netlist) |
| 4. P & R | netlist | place each cell on the die, route the wires between them; satisfy timing and design-rule constraints | **nextpnr** (ISC) for iCE40; **OpenLane** (Apache 2.0) for Sky130 / GF180 | `chipblocks.asc` (iCE40) or `chipblocks.def` (Sky130) |
| 5a. Bitstream | `.asc` | pack the routed design into the flash format the FPGA hardware expects | **icepack** (part of Project IceStorm, ISC) | `chipblocks.bin` |
| 5b. Tape-out | `.def` | bundle GDS-II + LEF + verilog wrapper + `info.yaml` + cocotb testbench into the canonical 14-file Tiny Tapeout submission layout | `backend/tinytapeout.py` (this project) | submission zip → drop into `ttsky-verilog-template` GitHub template → push to TT |
| 6a. Flash | `.bin` + dev board | erase + program the iCE40's on-chip flash via USB | **iceprog** (Project IceStorm) | running FPGA chip |
| 6b. Fab | submission accepted | photomask set printed → wafer fabrication run on the next shuttle → wafer sliced + packaged | SkyWater Foundry (US) / GlobalFoundries Dresden (DE) | physical ASIC chip in a package |
| 7. Done | running silicon | user verifies behavior; if FPGA, can reflash for revisions; if ASIC, permanent | speaker + monitor + the user's ears + eyes | working chip |

**FPGA path total wall-clock:** ~minutes (synth + P&R: ~30 s; flash: ~10 s; revision iteration: instant).
**ASIC path total wall-clock:** ~3-6 months from tape-out to packaged chip (Tiny Tapeout shuttle cadence).

## 4. Cross-sectional view — what's physically on the die

Below: **simplified cross-section** of a single CMOS transistor and the metal stack above it. This is what stages 5b–7 (the ASIC path) actually produce. For the FPGA path the silicon was already manufactured by Lattice; flashing only programs the configuration bits.

```
                  Cross-section through one CMOS transistor + 5 metal layers
                                  (Sky130 process, simplified, not to scale)

       y/nm                                                  Layer    Material      Function
       ▲                                                     name     code          
       │                                                     
2400 ──┤  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░     Passivation (SiN)     scratch + ion barrier
2350 ──┤  ┃ M5 ┃           ┃ M5 ┃          ┃    M5     ┃     metal5 — Cu          top routing
2300 ──┤  ┌───────────────────────────────────────────┐     ILD-5 — SiO2          insulator
2200 ──┤  ┃        M4 ┃          ┃ M4 ┃               ┃     metal4 — Cu          routing
2100 ──┤  ┌───────────────────────────────────────────┐     ILD-4 — SiO2          insulator
2000 ──┤  ┃ M3 ┃   ┃ M3 ┃   ┃ M3 ┃    ┃ M3 ┃          ┃     metal3 — Cu          routing
1900 ──┤  ┌───────────────────────────────────────────┐     ILD-3 — SiO2          insulator
1800 ──┤  ┃ M2 ┃   ┃ M2 ┃                  ┃ M2 ┃     ┃     metal2 — Cu          routing
1700 ──┤  ┌───────────────────────────────────────────┐     ILD-2 — SiO2          insulator
1600 ──┤  ┃M1┃ ┃M1┃ ┃M1┃ ┃M1┃ ┃M1┃ ┃M1┃ ┃M1┃ ┃M1┃    ┃     metal1 — Cu / Al     local cell wiring
1500 ──┤  ┌───────────────────────────────────────────┐     pre-metal dielectric  insulator
       │     │      │       │      │       │
1450 ──┤     ╨ via  ╨ via   ╨ via  ╨ via   ╨ via              via — tungsten     vertical hop
       │     │      │       │      │       │
1400 ──┤  ┌───────────────────────────────────────────┐     gate dielectric — HfO2 (high-K)
       │       ╔═══════════╗       ╔═══════════╗
1350 ──┤       ║   POLY    ║       ║   POLY    ║              poly-Si (or metal gate)  transistor gate
       │       ║   gate    ║       ║   gate    ║
1300 ──┤       ╚═══════════╝       ╚═══════════╝
       │       ┌─────────────────┐ ┌─────────────────┐
1250 ──┤       │  Source │  N+   │ │   N+    │ Drain │      source / drain — N+ doped Si
       │       └─────────────────┘ └─────────────────┘
1200 ──┤  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░     STI (shallow trench isolation) — SiO2
1100 ──┤
       │  ............................................     P-substrate — lightly doped Si bulk
   0 ──┤  ............................................     (the actual silicon wafer; 725 µm
       │                                                     thick before back-grinding)
       └─────────────────────────────────────────────►
                                                        x

Materials key (cross-section)
┌────────┬───────────────────────┬──────────────────────────────────────┐
│ Symbol │ Material              │ Notes                                │
├────────┼───────────────────────┼──────────────────────────────────────┤
│ ┃ ░ ┃  │ Copper (Cu)           │ Damascene metal lines (M2–M5)        │
│ ┃ # ┃  │ Aluminium (Al)        │ Lowest metal in older Sky130 flows   │
│ ╨      │ Tungsten (W)          │ Vias — vertical contacts             │
│ ╔═╗    │ Poly-silicon          │ Transistor gate (also high-K metal   │
│ ║ ║    │ (or HfO2 + metal)     │ gate stacks at sub-28nm nodes)       │
│ N+     │ Doped silicon         │ Source / drain — arsenic / boron     │
│ ░      │ Silicon nitride (SiN) │ Passivation                          │
│ ┌─┐    │ Silicon dioxide (SiO2)│ ILD = inter-layer dielectric         │
│ . . .  │ Bulk silicon (Si)     │ The wafer itself; very lightly doped │
└────────┴───────────────────────┴──────────────────────────────────────┘

Critical dimensions on Sky130 (Tiny Tapeout target)
┌──────────────────────────────────┬────────────┬──────────────────────────┐
│ Feature                          │ Typical    │ Tolerance / process note │
├──────────────────────────────────┼────────────┼──────────────────────────┤
│ Minimum gate length (Lg)         │ 150 nm     │ ±10% (process variation) │
│ Gate dielectric (HfO2 equiv.)    │ 2.5 nm     │ ±0.2 nm                  │
│ M1 minimum pitch                 │ 380 nm     │ M1 is the densest layer  │
│ M5 minimum pitch                 │ 1.6 µm     │ Top routing — wider      │
│ Wafer thickness (pre-grind)      │ 725 µm     │ Post-grind: 250-300 µm   │
│ Wafer diameter                   │ 200 mm     │ Sky130 uses 200mm wafers │
│ Tiny Tapeout tile size           │ 167 × 108 µm   one TT "tile" unit    │
│ Number of TT tiles per design    │ 1, 2, 4, 8 │ Pick at submission       │
└──────────────────────────────────┴────────────┴──────────────────────────┘
```

## 5. Cross-sectional view — what's physically inside an iCE40 FPGA

The FPGA path uses **the same silicon every time** — Lattice already manufactured millions of iCE40 wafers. What `🔧 Build → iCEstick / iCEBreaker` produces is a `.bin` file that programs the **configuration SRAM cells** scattered throughout the chip. Each LUT (look-up table) is just a tiny SRAM that, when programmed, behaves as a 4-input truth table.

```
                 Cross-section through one iCE40 logic cell (CL)
                 (Lattice's 40nm proprietary process — simplified)

  Functional view (one cell = one LUT + one register + routing fabric):

  ┌─ user's chip ──────────────────────────────────────────┐
  │                                                         │
  │   inputs ──► [ 4-input LUT (16 config bits = 16 SRAM) ] │
  │                            │                            │
  │                            ▼                            │
  │                     [ optional D-flip-flop ]            │
  │                            │                            │
  │                            ▼                            │
  │                     [ programmable routing ]            │
  │                            │                            │
  │                            ▼                            │
  │                          output                         │
  └─────────────────────────────────────────────────────────┘

  Physical: those 16 + 1 + many config bits are SRAM cells holding the
  pattern your .bin file writes into them at power-on:

       SRAM cell (6 transistors per bit, repeated thousands of times)

            VDD ───┬───────────┬─── VDD
                   │           │
              ┌────┘           └────┐
              │  P-MOS │ P-MOS  │
              │ pull-up│ pull-up│      "0"            "1"
              └────┐           ┌────┘   stored        stored
                   │  ╱╲   ╱╲  │
                   │ ╱  ╲ ╱  ╲ │
                  Q ═════X═════ Q-bar
                   │ ╲  ╱ ╲  ╱ │
                   │  ╲╱   ╲╱  │
              ┌────┘           └────┐
              │ N-MOS  │ N-MOS  │
              │pull-dn │pull-dn │
              └────┐           ┌────┘
                   │           │
            GND ───┴───────────┴─── GND
                       │  │
                       │  └──── access transistor (gated by word-line)
                       └─────── access transistor (gated by word-line)

   Bit-line  ───────────────────────────────────────►
   Word-line ───────────────────────────────────────►

  iCE40HX-1K (Lattice iCEstick — the $30 board):
    1,280 LUTs (logic cells)
    each LUT = 16 SRAM bits + supporting routing-config bits
    total config = ~32 KB packed into chipblocks.bin
    flash chip (SPI, on-board) holds the .bin and writes to SRAM on every boot
```

The iCEbreaker (iCE40UP-5K, ~$70) is the same architecture with 5,280 LUTs — about 4× the capacity. The TinyFPGA BX (iCE40LP-8K, ~$40) is again the same shape at 7,680 LUTs.

## 6. Exploded / assembly view — packaged ASIC die

The Tiny Tapeout path ends with a real, hold-in-your-hand chip. The exploded view below shows the layers from the silicon outward:

```
                                            Exploded view
                                          (drawing not to scale —
                                           silicon die is < 1 mm,
                                           package is ~ 25-50 mm)

           ▼ press-fit direction during assembly
   ┌─────────────────────────────────────────────────┐
   │                                                 │   marking / lid
   │             "TINY TAPEOUT 2026"                 │   (sometimes a
   │             "your-design-name"                  │   plastic top with
   │                                                 │   silk-screened text)
   ├─────────────────────────────────────────────────┤
   │  ┌─────────────────────────────────────────────┐│
   │  │              Heat spreader                  ││   nickel-plated
   │  │            (Ni-plated copper)               ││   copper, ~0.5 mm
   │  │                                             ││   thick
   │  └─────────────────────────────────────────────┘│
   ├──────────│ ▼ thermal interface material (TIM) │─┤
   │          │   silicone grease or pre-cured pad  │
   │          ▼                                      │
   │       ┌─────────────────────────────┐           │   bare silicon die
   │       │   ░░░░░░░░░░░░░░░░░░░░░░░   │           │   (your chip!)
   │       │   ░░  your CPU  ░░░░░░░░░   │           │   ~1 mm × 1 mm
   │       │   ░░  (Sky130)  ░░░░░░░░░   │           │   250 µm thick after
   │       │   ░░░░░░░░░░░░░░░░░░░░░░░   │           │   back-grinding
   │       └─────────────────────────────┘           │
   │                                                 │
   ├─────────────────────────────────────────────────┤
   │  ┌─────────────────────────────────────────────┐│
   │  │    Die-attach paste (Ag-filled epoxy)       ││   electrically and
   │  │                                             ││   thermally conductive
   │  └─────────────────────────────────────────────┘│
   │  ┌─────────────────────────────────────────────┐│
   │  │             Substrate (FR-4 + Cu)           ││   PCB-style layered
   │  │   ────── trace ────────  ────── trace ──────││   substrate with signal
   │  │  Bond                                       ││   routing from chip
   │  │  pad ◄── bond wire (Au, 25 µm) ────────────►││   pads out to package
   │  │                                             ││   pins
   │  └─────────────────────────────────────────────┘│
   ├─────────────────────────────────────────────────┤
   │                                                 │
   │  ┌──┐  ┌──┐  ┌──┐  ┌──┐  ┌──┐  ┌──┐  ┌──┐    │   package pins
   │  └──┘  └──┘  └──┘  └──┘  └──┘  └──┘  └──┘    │   (DIP, QFP, BGA,
   │  pin 1  pin 2  pin 3 ...                       │   depending on the
   │                                                 │   submission)
   └─────────────────────────────────────────────────┘

   ASSEMBLY ORDER (bottom to top during fabrication):
     1.  Substrate is manufactured separately (PCB-like)
     2.  Die-attach paste applied to substrate pocket
     3.  Bare silicon die placed face-up on the paste
     4.  Wire-bonder threads gold wires from die pads to substrate pads
     5.  Thermal interface material applied to top of die
     6.  Heat spreader pressed down onto the TIM
     7.  Lid / marking cover added; final package sealed
     8.  Electrical test (continuity, leakage, basic functional)
     9.  Tape-and-reel or tray packaging for shipping
```

For Tiny Tapeout specifically, the shipped form is typically a **QFN-44 package** (44-pin Quad Flat No-leads, ~7 × 7 mm) with the user's design occupying one or more 167 × 108 µm tiles on a shared 4–8 mm² die alongside ~100 other Tiny Tapeout submissions.

## 7. Legend — symbols and conventions used in this drawing

```
┌────────────────┬──────────────────────────────────────────────────────┐
│ Symbol         │ Meaning                                              │
├────────────────┼──────────────────────────────────────────────────────┤
│ ────►          │ Material flow (left to right, top to bottom)         │
│ ┌───┐          │ Process stage (box)                                  │
│ ┃ ┃            │ Solid material in cross-section (Cu / Al / etc.)     │
│ ░ ░ ░          │ Insulator (SiO2 / SiN / passivation)                 │
│ ╔═╗            │ Polysilicon / metal gate                             │
│ ╨              │ Vertical contact (via — tungsten)                    │
│ N+ / P+        │ Doped silicon region (source / drain)                │
│ . . .          │ Bulk silicon substrate                               │
│ ▼              │ Press-fit / assembly direction (exploded view)       │
│ ◄──────────►   │ Bond wire (gold, 25 µm diameter)                     │
└────────────────┴──────────────────────────────────────────────────────┘
```

## 8. Tooling — what produces each artefact

The full toolchain is open-source and permissively licensed (per the project's MIT-only-permissive core constraint).

| Tool | License | Role | Lives in |
|---|---|---|---|
| Electron / React / React Flow | MIT | Visual editor (Stage 1) | `frontend/` |
| Amaranth HDL | BSD-2 | Python → Verilog translator (Stage 2) | invoked from `backend/build.py` |
| Yosys | ISC | Logic synthesis (Stage 3) | external (OSS CAD Suite) |
| nextpnr-ice40 | ISC | Place-and-route for iCE40 (Stage 4 FPGA) | external (OSS CAD Suite) |
| icepack | ISC | Bitstream packer (Stage 5a) | external (OSS CAD Suite) |
| iceprog | ISC | Flasher (Stage 6a) | external (OSS CAD Suite) |
| OpenLane | Apache 2.0 | ASIC place-and-route flow (Stage 4 ASIC) | runs in TT's CI, not locally |
| SkyWater 130nm PDK | Apache 2.0 | Process design kit for Sky130 fabs | runs in TT's CI |
| GlobalFoundries 180nm PDK | Apache 2.0 | Alternative open PDK (older, larger) | runs in TT's CI |

**Nothing in the shipped product is GPL or AGPL.** Verilator (BSD-3), SymbiYosys (MIT), and the rest of the OSS CAD Suite tools above are all installed as separate user tooling in WSL2, not bundled into the Electron installer.

## 9. Verification — what each stage checks

| Stage | Verification done | Catches |
|---|---|---|
| 1. Design | ChipBlocks' typed-bus validator (ADR-001) rejects incompatible port connections at drag time + at Load time | wrong-width wires, sign-class mismatches |
| 2. HDL | Amaranth's elaboration step; `synth.py` Simulator run | logic errors visible as wrong WAV output |
| 3. Synth | Yosys's design-rule checks | unsynthesizable constructs, undefined nets |
| 4. P&R | nextpnr's timing analysis + DRC | timing failures, signal-integrity violations |
| 5a. Bitstream | bitstream-format integrity (size, CRC) | rare; corruption in pack step |
| 5b. Tape-out | Tiny Tapeout's pre-submission CI (LVS, DRC, antenna checks against the PDK) | mask-set design-rule violations |
| 6a. Flash | `iceprog --read` verifies the flash contents after write | wrong bitstream loaded |
| 6b. Fab | foundry-level metrology (CD-SEM measurements during lithography, electrical wafer probe) | process variation, particle defects, yield |
| 7. Done | the user's ears (audio) / eyes (VGA) / multimeter (electrical) | the only verification that actually matters: does it do what you wanted? |

## 10. References

- Tiny Tapeout — [tinytapeout.com](https://tinytapeout.com) — submission shape + Sky130/GF180 process notes.
- SkyWater 130nm Open Source PDK — [github.com/google/skywater-pdk](https://github.com/google/skywater-pdk) — Apache 2.0 process design kit.
- Project IceStorm — [clifford.at/icestorm](http://www.clifford.at/icestorm/) — the open iCE40 reverse-engineering effort that made Yosys + nextpnr-ice40 + icepack possible.
- Amaranth HDL docs — [amaranth-lang.org](https://amaranth-lang.org) — Python-to-Verilog elaboration.
- ADR-001 in this repo — [../ADR-001-multi-bit-bus-types.md](../ADR-001-multi-bit-bus-types.md) — the typed-bus system that does stage-1 verification.
- ARCHITECTURE.md — [../ARCHITECTURE.md](../ARCHITECTURE.md) — the renderer ↔ backend boundary and how stages 1–4 are stitched.

---

*End of drawing DOC-MFG-001 revision A. Subsequent revisions should append to the revision-history block at the top and use `git diff` against the previous revision as the change record.*
