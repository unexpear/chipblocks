# ChipBlocks — Toolchain Roadmap

> The forward plan to make ChipBlocks a **full, KiCad-equivalent design toolchain** — every tool KiCad
> has, but with always-on live simulation underneath. Started 2026-06-24 after walking KiCad 10's
> launcher tool-by-tool ("i want them all"). Status last checked 2026-09-14 against the real app + catalog,
> not prose.

Canonical measured implementation status and verification gates: [PROJECT-STATUS.md](PROJECT-STATUS.md).

## The target — KiCad's nine tools, mapped

| KiCad tool | What it does | ChipBlocks status |
|---|---|---|
| Schematic Editor | draw the circuit | ✅ **have** — + always-on live sim (KiCad invokes ngspice on request; ours is live) |
| Calculator Tools | trace width, resistor values, … | ✅ **have** — the Math panel, computed on your REAL live circuit |
| Drawing Sheet Editor | page border + title block | ✅ **have** — just added |
| Symbol Editor | author a part's schematic symbol | ✅ **have** — in-app authoring from the New Part dialog; saved drawings persist with user parts |
| Plugin & Content Manager | install community libraries | ◐ catalog is origin-extensible; no install UI |
| Footprint Editor | a part's physical pads / outline | ✅ **have** — in-app pad/courtyard authoring with validation and persistence |
| PCB Editor | place parts + route copper | ◐ board workspace, placement, routing, DRC, and fab export are mounted; broader PCB parity remains |
| Gerber Viewer | check the factory files | ◐ Check Gerbers, next to Export ZIP, plots the ChipBlocks Gerber and Excellon the manufacturing ZIP writes (that dialect only — not a general gerbview) |
| Image Converter | logo → symbol / footprint | ❌ niche |

Have 5 (deeper than KiCad on each), 3 half-there, 1 to build.

## Track 1 — the manufacturing spine (the board road; the prize)

One dependency chain, built in order — this is PCB Editor + Footprint Editor + Gerber Viewer + the
second deliverable, all at once:

1. **Footprint model** — a part's physical package (copper pads, outline, courtyard); link each catalog
   part to one, plus a starter set (0603, SOIC-8, DIP-8, pin headers) and a viewer. ← **FIRST BRICK**
2. **PCB canvas** — a second canvas: place the footprints, draw the board outline.
3. **Copper routing + DRC** — draw traces following the schematic's netlist; spacing / clearance checks.
4. **Gerber + drill export** — the manufacturing ZIP (Gerbers, drill, BOM, README, validation report).
   Deterministic, **never AI-generated** — wrong files cost real money.

**Fast parallel win:** a **manufacturing-ZIP skeleton** — BOM + the SPICE netlist we already export + a
schematic image + the validation report, zipped. A real (minimal) second deliverable from pieces we
already have; ticks the PRD's defining metric (an outside user exports a manufacturing package).

## Track 2 — authoring & extensibility (parallel; reuses Track 1's rendering)

5. **User-made parts** — in-app Symbol + Footprint authoring is shipped; continue tightening the shared
   library and edit/reload flows.
6. **Plugin / Content Manager** — install community catalogs (community/user origins exist; the install
   UI doesn't).

## Track 3 — polish

7. **Image Converter** — logo → silkscreen. Last; genuinely niche.

## Track 4 — the solver scaling (the chip-depth road; the "thing from before")

The transistor-level DC solve doesn't scale to chip-size digital (~650-MOSFET decoder ≈ 60 s). Measured:
the cost is the gmin / source-stepping **continuation's iteration count**, NOT the per-solve linear
algebra — wiring in sparse hurt (its O(N²) overhead + no-pivoting issues on feedback circuits), and a
naive operating-point seed fights the stepping. The real fix is a better continuation:

- **Pseudo-transient** (lead-approved 2026-06-24, accepting a startup-ramp "offset") — find the steady
  state by ramping the supply up in *fake* time and letting the circuit "boot up", so each step starts
  near the last; rock-solid for CMOS, every transistor still real. The (correct, validated) logic-sim
  operating-point seed can feed it.
- Keep the instant logic-sim as the fast "does it compute" layer alongside the real transistor solve.

Already built + validated but isolated (not wired in): `src/sparse-linear.ts` (correct, but net-negative
when wired into real circuit matrices), `digitalSeed` in `src/renderer/logic-sim.ts` (correct mapping,
120/120 vs the converged operating point).

## HDL bridge — Verilog ⇄ gates (added 2026-07-13, lead: "Full RTL flow, including synthesis")

A hardware-description-language layer, adopted as another REPRESENTATION on the interchange hub (same
role SPICE/KiCad already play — the drawn gates stay the sim source of truth). Round-trips both ways.

| Increment | What | Status |
|---|---|---|
| 1a — structural export | gates → IEEE-1364-2005 structural Verilog (8 prims, output-first, powerless) | ✅ `src/renderer/verilog.ts` (commit 49c66b3) |
| 1b — structural import | structural Verilog → placed real gate cells (N-input decompose, power re-synth, honest reports) | ✅ `src/renderer/verilog-import.ts` (commit 4e8adea) |
| — menu/hub wiring | Import/Export Verilog in the File menu, on the shared CircuitFile path (like SPICE/KiCad) | ✅ `src/renderer/verilog-file.ts` (commit ddc5039) — Net Labels = module ports; import as one circuit block |
| 2a — combinational synthesis (scalar) | write a 1-bit logic equation → BUILD gates (`~ ! & \| ^ ~^ && \|\| == != ?:`, real precedence, folding) | ✅ `src/renderer/verilog-synth.ts` (commit 2748986) — design-verified + adversarial review (8 bugs fixed) |
| 2b — buses + arithmetic | `[N:0]` bit-blasting, bit/part-select, concat/repl, reductions, two-pass width, ripple-carry `+`/`-` | ✅ `src/renderer/verilog-synth.ts` (commit d11abae) — bracket bit-nets, adversarial review (5 bugs fixed); `assign sum = a + b` builds a real adder |
| 3 — sequential synthesis | `always @(posedge clk)` → real D flip-flops + next-state gates (nonblocking `<=`, sync reset, if/else + case, enable holds) | ✅ `src/renderer/verilog-synth.ts` + `verilog-import.ts` — clocked tests via `simulateLogic`; adversarial review (3 findings fixed: fresh-name guard for always-body nets, reported-else leak, for-loop capture) |

Both halves went through design-verify (adversarial, vs IEEE 1364-2005, 0 rules refuted) → build → four
gates → adversarial review (importer review caught + fixed 6 real bugs, all with regression tests).
`characterizeBlock` is the truth-table oracle proving decomposition correctness. Credits (IEEE 1364 +
Icarus/Verilator/Yosys cross-check, no code bundled) in CREDITS.md. Surfaced one pre-existing latent bug
(`isOutputPort` tests `'tri_state'`; real literal is `'tristate'`) — flagged as its own task, not bundled.

## Real-silicon target — iCE40 FPGA: RTL → real bitstream, and back (added 2026-07-25)

The natural continuation of the HDL bridge (Verilog ⇄ gates): once you have gates, compile them onto a
**real Lattice iCE40** and get a real bitstream — a from-scratch FPGA CAD flow, every wire / pin / bit
grounded in and cross-checked against Project IceStorm's own tool (`icebox.py`). **Built as library engines
(tested, each increment adversarially verified), but NOT yet wired into the app UI** — that wiring is the
"upgrade the hardware-coding flow so it works with all the new stuff" work below. Full design + staging in
[FPGA-FABRIC-RESEARCH.md](FPGA-FABRIC-RESEARCH.md) §5 + Appendix A.

**The engines that exist today** (`src/renderer/fpga-*.ts` — gates → real bitstream, and bitstream → design):

| Piece | What | Module |
|---|---|---|
| map | gates → *k*-LUT technology-map + pack | `fpga-fabric.ts` `coverToLuts`, `fpga-place.ts` `packLuts` |
| place (abstract) | VPR-grade simulated-annealing placer | `fpga-place.ts` |
| route | PathFinder negotiated-congestion router | `fpga-router.ts` (+ `fpga-flow.ts` place↔route loop) |
| sim | 0/1 simulate a placed + routed design | `fpga-sim.ts` |
| real iCE40 ingest | parse the real icebox chipdb | `fpga-icebox.ts` |
| real routing graph | chipdb → routing-resource graph + route on it | `fpga-icebox-rrg.ts` |
| real logic cell | LUT4 + flip-flop config ⇄ real CRAM bits | `fpga-icebox-logic.ts` |
| assemble | logic ⊕ routing → one CRAM bitstream | `fpga-icebox-bitstream.ts` |
| synth (placed) | bind a placed netlist → route cell-to-cell → bitstream | `fpga-icebox-synth.ts` |
| **auto-place** | choose the real cells (no hand-placement) | `fpga-icebox-autoplace.ts` |
| **parse** | bitstream → recover the design (cells + routing) | `fpga-icebox-parse.ts` |

So today, in library code, a mapped netlist auto-places + routes on a real iCE40 and produces a real
bitstream, and a bitstream reads back to its design. What's missing is the **app plumbing** to reach it.

**Upgrade the hardware-coding flow to use it (the ask):** wire these engines into the front-end so a user
goes **HDL / drawn gates → real iCE40 bitstream, and back, in-app** — not just in tests:

1. **"Compile to iCE40" action** — from the drawn gates (or an imported/synthesized Verilog module) run
   `coverToLuts → packLuts → autoPlace → synthesizeBitstream`, surfaced on the interchange hub / File menu
   the same way Verilog/SPICE export already is, and in the **Chip workspace** as a "target device: iCE40"
   mode (the Chip level is abstract standard cells today — see [[chip-workspace-plan]]).
2. **Bitstream load / inspect** — `parseBitstream` a CRAM image → show the recovered logic cells + routing
   on the canvas (and, once "watch it run" lands, simulate it live).
3. **Report honestly in the UI** — carry every "not modeled" the engines already return (excluded pips,
   unbound nets, truncated auto-place, undecodable bits) through to the user, never hidden.

**FPGA-side increments this integration depends on / unlocks** (tracked in FPGA-FABRIC-RESEARCH.md §5):

- **Stage 3a completion — "watch it run":** the parser recovers cells + ON pips but does NOT yet rebuild the
  logical connectivity (trace ON-pip paths cell-out → cell-in) and feed the fast logic engine to SIMULATE a
  loaded bitstream. This is the compelling "load a bitstream and watch it run" demo.
- **Whole-`.bin` file parse:** today we read the CRAM-bit representation; a real `.bin` file adds the frame
  format, CRC, and the IO / PLL / BRAM / unused-tile default bits.
- **Stage 3b — bit-exact loadable `.bin`:** fill those default / IO / PLL bits + the `.bin` framing so the
  emitted image actually loads on hardware (roadmap-flagged hardest / data-gated — treat like the
  manufacturing ZIP: engine-owned, bit-exact, never guessed).
- **HPWL-quality real-cell placement:** auto-place is routability-driven (first placement that routes); a
  simulated-annealing placer minimizing wirelength on real cells is the quality refinement.

## Footprint two-way sync — author OR derive, always matching (lead note 2026-07-19)

The footprint should work **both directions**, and one should always exist when something downstream
(a board, a chip) needs it:

- **Author-first** — draw/edit a footprint in the footprint editor, and every part using it picks it up.
- **Place-first** — just build in the schematic / board / chip editor, and the footprint is **derived
  from what you placed**, kept matching as you change things.

Either way you land on the same, consistent footprint.

**Where we already are (mapped 2026-07-19).** Both halves exist today — but on *opposite* levels, and
neither level has both:

- The **board** already does *author → downstream*: footprints are 15 hand-authored, cited const
  literals (`footprint.ts` `BUILTIN_FOOTPRINTS`), assigned per device-kind (`footprint-assignment.ts`
  `PART_FOOTPRINTS`, e.g. resistor → 0603), and `deriveBoard` (`pcb-board.ts:206`, live in an App
  useMemo at `App.tsx:3545`) re-projects them onto the board on *every* edit — the board is always a
  rotate+translate of footprint geometry plus an auto-fit outline. The in-app `footprint-editor.tsx`
  now authors pads and courtyard geometry, validates it, and persists user footprints; the remaining
  work is richer board/fabrication parity.
- The **chip** already does *place → derive*: a standard cell's geometry is **computed from the gates it
  contains** (`cell-polygons.ts` / `cell-layout.ts` — Euler-path netlist → per-mask rectangles), not
  authored. On the chip side the footprint-analog is already auto-derived from what you built.

So the vision is: bring **both directions to both levels**, unified — a footprint (board) or cell (chip)
that can be *authored* OR *derived*, always present, always matching.

**Three gaps to close:**

1. **Authoring parity.** Symbol and footprint authoring surfaces now exist. Remaining work is to make
   edit/reload flows and terminal→pad assignment equally complete for every user-part path.
2. **"A footprint always exists" isn't guaranteed.** Device kinds not in `PART_FOOTPRINTS` (op-amp,
   switch, transformer, circuit blocks, ill-fitting user parts) resolve to `undefined`, and `deriveBoard`
   **silently skips** them (`pcb-board.ts:224` `if (fp === undefined) continue`) — surfaced as "N wired
   pins not on the board yet" and an **export-blocking** fab failure (`pcb-fab.ts:286`). Closing this =
   an auto-derived fallback footprint (an N-pad land pattern from the part's pin count/spacing) so a part
   is never packageless.
3. **No keep-matching mechanism.** Footprints are immutable, so nothing re-derives a footprint from a
   placement or flows an edited footprint back to instances. *Cheap plumbing already there:* all
   instances share one footprint object by reference, and the forward re-derive is already automatic — add
   an editable footprint store to `deriveBoard`'s useMemo deps and an edited footprint reflows every
   placement with no other change. An authored footprint also needs a terminal→pad map (today
   `TERMINAL_PADS` is hand-authored per device kind).

Extends the **Footprint Editor** row above and **Track 2 item 5** (footprint authoring), and ties into
the "edit on the canvas, not in side dialogs" preference. The next increment is richer two-way syncing,
not the initial editor surface.
