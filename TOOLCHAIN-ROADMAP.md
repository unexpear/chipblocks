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

**Status (2026-10-05 slice, working tree):** the two measured walls for large transistor DC are addressed
in-tree — not commercial-ngspice parity, and not a claim of chip-scale transient. Honest limits below.

1. **Linear solve (pivoted sparse).** The old no-pivot sparse factor bailed on the zero diagonals that
   ideal wires / MOSFET-gate nets put into an MNA matrix, so every Newton pass of a transistor netlist
   fell through to dense GE (~90% of the hex→7-seg decoder's wall time). `factorizePivoted` /
   `solvePivoted` in `src/sparse-linear.ts` pivot around them; `SparseSession` prefers no-pivot while it
   works, then stays pivoted, absorbs a few consecutive near-singular misses before going dense, and
   applies one iterative-refinement step so ill-conditioned diode Newton linearisations stay dense-quality.
   Tests: `tests/solver-scale.test.ts` (pivoted unit + calculator stays on pivoted).
2. **Convergence (gmin stepping for CMOS).** Some built-in CMOS inputs never converged from a cold
   start (hex→7-seg: 831 direct passes / 60 s over-budget). `solveDCByGminStepping` in `src/dc-robust.ts`
   is SPICE-style gmin continuation; `solveDCRobust` caps the direct attempt (share of wall clock + a
   CMOS-only 200-pass cap) and routes a MOSFET+linear netlist to gmin stepping (else source stepping,
   unchanged). Correctness oracle: `digitalSeed` on every gate pin. Final level is the real circuit (no
   shunt); a stalled ramp returns the failed solve's honest status + how far the continuation got.

Still open (not this slice): pseudo-transient as another continuation; ngspice parity; wiring a logic
seed into the transistor solve as a warm start; anything beyond DC operating point at this scale.

Already validated alongside: `digitalSeed` in `src/renderer/logic-sim.ts` (correct mapping vs converged OP).

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
  now authors pads and courtyard geometry, validates it, and persists user footprints; board
  view + export now surface paste/mask (derived) and F.Fab body lines separately from silk.
- The **chip** already does *place → derive*: a standard cell's geometry is **computed from the gates it
  contains** (`cell-polygons.ts` / `cell-layout.ts` — Euler-path netlist → per-mask rectangles), not
  authored. On the chip side the footprint-analog is already auto-derived from what you built.

So the vision is: bring **both directions to both levels**, unified — a footprint (board) or cell (chip)
that can be *authored* OR *derived*, always present, always matching.

**Three gaps to close:**

1. **Authoring parity.** Symbol and footprint authoring surfaces now exist. Terminal→pad assignment
   now shares the same explicit / unique-name / declaration-order rules (with named refusals) for
   user parts and provisional lands; remaining work is edit/reload flow polish.
2. **"A footprint always exists" isn't guaranteed.** Device kinds not in `PART_FOOTPRINTS` (op-amp,
   switch, transformer, circuit blocks, ill-fitting user parts) resolve to `undefined`, and `deriveBoard`
   **silently skips** them (`pcb-board.ts:223` `if (fp === undefined) continue`) — surfaced as "N wired
   pins not on the board yet" and an **export-blocking** fab failure (`pcb-fab.ts:286`). Symmetric two-terminal kinds already get a labeled `provisional_<N>pad` land instead of being skipped. Role-sensitive kinds (transformer, SPDT, op-amp, relay) stay unassigned without explicit pin→pad data — this does not invent a manufacturer package for them. A circuit block without chip pin data stays skipped; with honest ports it uses chip-level author-or-derive (below). A part is still packageless when its pin order is not an honest total order.
3. **Keep-matching is the part ↔ board loop, not both levels.** Changing a part's footprint
   assignment re-derives its placement (`deriveBoard` reads `footprintForPart` on every call, and a
   hand spot stays put). The board view subscribes to the authored-footprint store, so a same-id
   edit reflows pad geometry without a schematic edit. A board-side edit of a *user-owned*
   footprint writes that id back onto the part (`applyUserOwnedFootprintEdit`) when the package
   honestly fits. Built-ins cannot be shadowed. Role-sensitive kinds are not given a guessed
   package. Provisional lands stay `provisional_<N>pad` and labeled provisional — that id cannot
   be registered over. Fabrication parity for this slice: the board view pages F.Fab / F.Paste /
   F.Mask alongside silk and copper; Gerber export ships paste and mask (ChipBlocks-derived =
   pad copper / SMD pad — labeled derived, not a vendor aperture) and an F.Fab assembly-drawing
   Gerber that strokes body outlines when a footprint has them — never redrawn as silk; a
   footprint with only silk invents no fab lines. Provisional lands stay `provisional_<N>pad`.
   Terminal→pad maps (this slice): `resolvePadMap` prefers explicit `pin.pad`, then unique
   pad-name match, then labeled declaration-order over leftover pads. A missing or already-claimed
   `pin.pad` refuses that pin (named `pad-missing` / `pad-claimed`) — no silent remap that looks
   like success; ambiguous shared names refuse (`name-ambiguous`). Built-in `TERMINAL_PADS` /
   per-footprint overrides still hand-author role-aware pinouts (diode cathode, transistor packages);
   when a fitting user land uses different pad ids, a labeled sequential-ordinal remap (`1..N` →
   pad list order) applies only when the hand map is a clean unique positive-integer set — otherwise
   the terminal stays unmapped. Failures surface with the handle id on `UnplacedPart.terminals` /
   `formatUnplacedPart` the same way fab validation names skipped parts. Role-sensitive kinds
   (transformer, SPDT, op-amp, relay) stay unassigned without explicit pin→pad data. Chip-level author-or-derive (2026-10-05 slice): `chip-footprint.ts` resolves a
   package from known pin/pad data (block ports, LEF-facing cell abstracts A/B/Y/VDD/VSS, top-level
   chip I/O) — **authored** when a fitting user/builtin package maps every pin honestly, else a
   labeled `provisional_<N>pad` **derived** land when pin ids are a unique total order. Role-sensitive
   kinds (transformer, SPDT, op-amp, relay) still refuse derive; they accept an authored package only
   with explicit `pin.pad` / unique pad-name maps (no declaration-order inventing of manufacturer
   pinouts). `deriveBoard` takes optional `chipPins` so a circuit block with ports is not packageless;
   `definition: 'block'` alone (no pin data) stays skipped. Keep-matching: `applyChipFootprintEdit`
   writes a user-owned id back onto the chip/block part when it fits; the chip workspace surfaces
   authored vs derived for the design and for standard-cell abstracts. Still open: a full Gerber
   viewer (still ≠ our dialect). Nothing re-derives a footprint *from* a placement. `TERMINAL_PADS`
   remains hand-authored for built-in device kinds that need a manufacturer pinout — that is
   intentional, not a gap to fill with guesses.

Extends the **Footprint Editor** row above and **Track 2 item 5** (footprint authoring), and ties into
the "edit on the canvas, not in side dialogs" preference. The part ↔ board loop, board/fabrication
parity (paste, mask, silk vs fab), richer terminal→pad maps, and chip-level author-or-derive above
are the current footprint-parity slices. Still open beyond this slice: place→re-derive a board
footprint from a placement, and Gerber viewer generality.
