# Sprint 19 — Make the canvas read like a real circuit

> **Status: CLOSED 2026-06-11 — the interactive-canvas + simulation mega-sprint,
> 84 increments (S19-v3-1..84). The close-out + retro is at the end of this file.**
>
> *(Previous banner, 2026-06-09):* Status: open — grown far beyond the written scope.
> The scope below (A–D: labels, loop layout, drag-and-drop, physics-driven
> arrows) shipped in the first days. The sprint then kept going as the
> **interactive-canvas + simulation mega-sprint**, per-feature increments
> `S19-v3-NN` in the commit log. Landed beyond the written scope (through
> S19-v3-55): the editable Properties panel with cited defaults, live readings
> and provenance; real wire resistance + the per-point voltage probe; LED
> color physics; the unified engineering-units formatter; the native menu +
> Settings (light mode, grid color); transistors (NPN + PNP, Ebers-Moll, in
> both solvers); the whole **transient/time-domain solver** (R/C/L, AC
> sources, rectifiers, amplifiers) + the **Scope** waveform view; capacitor +
> inductor + transformer + center-tapped transformer parts (core loss +
> saturation detection); four **visualization lenses** (voltage / power / temp
> / flow); the **lumped thermal model** + over-temperature checks + the
> **electro-thermal feedback loop**; capacitor polarity + overvoltage checks;
> terminal hover labels; circuit **Save/Load**; the **multimeter tool**
> (S19-v3-53..55: red/black probes on terminal dots with a mode dial — DC
> volts, true-RMS AC volts with frequency counted from the waveform's own
> zero crossings, powered-off Ω + continuity done the textbook Thévenin way,
> a real diode test — plus clamp-style amps by touching a wire). The original
> text below is the sprint's opening plan, kept as written.
>
> *(Original banner, 2026-06-06):* Sprint 18 landed the canvas: standard symbols, real
> render. But it lays parts out in a 3-column grid and draws the wires as bezier
> curves through the middle — so the wires cross into a rat's nest that looks
> nothing like a schematic. The project lead showed the target: a hand-drawn
> **rectangular loop** — components on the edges of a rectangle, wires as straight
> right-angle runs, a ground tap off the corner. This sprint closes that gap.

## Goal

The educational anchor circuit renders as a clean **rectangular loop** — the way a
person draws a circuit on paper — instead of a scatter-grid with crossing curves.

## Why

A schematic is a *reading aid*. The grid+bezier render (Sprint 18) is technically
correct (right symbols, right connections) but visually unreadable: a viewer can't
trace the loop. The rectangular-loop convention is how every textbook, every
engineer, every hand sketch draws a simple circuit. Matching it is the difference
between "the data is on screen" and "you can read the circuit."

This is the **"circuit-aware canvas layout"** deferred row in
[OBJECT-MODEL.md](../OBJECT-MODEL.md) §15, now pulled forward because the visible
gap makes it the highest-value canvas work.

## Scope

**A. Label readability (done — folds in here as the opener).**
- One net-id label per net, not one per star spoke (kills the `net_battery_neg` ×2
  clutter). Net identity stays on every edge for testing; a `showLabel` flag marks
  the one edge that renders it.
- Legible label chips (a small custom net edge via `EdgeLabelRenderer`) lifted
  clear of the wire line.

**B. Circuit-aware loop layout (the heart of the sprint).**
1. **Loop-order recovery** — a pure function that walks the netlist terminal-by-
   terminal to recover the order parts sit in the loop (battery → wire → switch →
   resistor → led → wire → back). Taps that aren't on the conduction path (the
   ground reference) are returned separately as stubs. Pure + unit-tested, same
   discipline as `world-to-flow`.
2. **Rectangle placement** — distribute the loop's components around a rectangle:
   half across the top (left→right), half across the bottom (right→left), the left
   and right sides left as bare vertical wire — exactly the hand-drawing shape, and
   it keeps every symbol horizontal (no rotation needed for the MVP).
3. **Orthogonal wiring** — wires route as right-angle runs along the rectangle
   sides (React Flow step routing + side-aware handles) instead of beziers across
   the middle.
4. **Ground / branch taps** — a tap (ground) sticks out from its net's corner, like
   the drawing.

**C. Drag-and-drop (project lead ask).** Grab a component and move it; it stays
where dropped. React Flow node state (`useNodesState`/`onNodesChange`) — in-session
only this sprint; persisting moved positions to `canvas/layout.yaml` is a later sprint.

**D. Physics-driven directional arrows (project lead ask: "wire in the physics").**
The arrows are NOT a topological guess at flow direction — they show the *real*
current the DC solver computes. Run `solveDC` (§18/§20), then for each wire orient
the arrowhead by the sign of the computed branch current (the solver's documented
convention: positive flows anode/positive/terminal_a/terminal_in → the negative
side), label it with the magnitude (e.g. `≈14.9 mA`), and show **no arrow when the
current is ~0** (switch open / no path) — honest, not decorative. This is the first
slice of the solver overlay: current is now visible on the canvas.

## Non-goals (this sprint)

- **General multi-loop / branchy auto-routing.** The rectangle is clean for a
  *single series loop* — which the anchor circuit is. Boards with parallel branches
  and multiple loops need a fuller router; that's a later sprint. We `log`/document
  the limitation rather than pretending the rectangle generalizes.
- **Symbol rotation on vertical edges.** MVP keeps components on the horizontal
  edges (top/bottom) so symbols stay upright; rotated side-components are a polish
  follow-on.
- **Drag-to-rearrange / manual layout persistence.** Still the interactivity sprint.
- **Full solver overlay (node voltages on every net, the overloaded LED painted
  red).** The directional arrows (scope D) bring *current* onto the canvas — the
  first slice — but the full voltage map + failure highlighting is still its own
  later sprint, painting onto this cleaner layout.

## Done when

- The anchor circuit renders as a rectangle: parts on the top and bottom edges,
  bare vertical sides, ground tapped off a corner — screenshot-verified against the
  hand-drawn target.
- Wires run as right angles along the rectangle, no crossings through the middle.
- Loop-order recovery is a pure, unit-tested function.
- Gates: `npm test`, `npx tsc --noEmit`, `npx biome check .`, `npm run build` all
  green.

## Sub-commits (planned)

- **S19-v3-1** — this plan.
- **S19-v3-2** — label readability (de-dup + legible lifted chips). [done]
- **S19-v3-3** — drag-and-drop (React Flow node state; parts stay where dropped). [done]
- **S19-v3-4** — pure loop-order recovery + tests (foundation for layout + arrow ref).
- **S19-v3-5** — physics-driven directional arrows: run solveDC, orient each wire's
  arrowhead by the real current sign, label the magnitude, hide when no current.
- **S19-v3-6** — rectangle placement + orthogonal wiring, screenshot-verified.
- **S19-v3-7** — ground / branch tap placement.
- **S19-v3-8** — retro.

---

## Close-out + retro (S19-v3-84, 2026-06-11)

Sprint 19 opened as "make the canvas read like a real circuit" -- a layout
sprint. It closed 84 increments later as the largest sprint in the project's
history: the static render became a full interactive circuit editor, the DC
solver gained a time-domain sibling, the device shelf grew through MOSFETs and
transformers, and the app grew two complete, verified instruments. Every
increment kept the four gates green and the per-feature `S19-v3-NN` numbering
in the commit log.

### What actually shipped, in arcs

1. **The written scope (v3-1..7, the first days):** label de-dup + legible
   chips, drag-and-drop, pure loop-order recovery, physics-driven current
   arrows (real solved current, no arrow at ~0 A), the rectangular-loop
   layout with orthogonal wires and the ground tap. The original "done when"
   was met in week one; the sprint then kept going.
2. **The editor arc:** drop parts from the palette; the editable Properties
   panel with cited defaults, live readings, and provenance; the CAD-style
   click-by-click wire tool (corners, junctions in open space, Line/Curve
   with three sweep sizes, path-true wire lengths); desktop-style selection
   (box marquee, freeform lasso, wires selected by touch); a Windows-style
   clipboard (15 copies + 1 cut); full undo/redo with burst coalescing;
   rebindable shortcuts; circuit Save/Load; themed scrollbars; unbounded
   zoom; hand-routed series-loop layout.
3. **The physics arc:** the whole transient/time-domain solver
   (backward-Euler + Newton-Raphson: R/C/L, AC sources, diodes/LEDs,
   NPN+PNP, transformers with core loss + saturation detection); the plain
   diode family in DC; MOSFETs (Level-1, three regions, both solvers --
   the CMOS inverter proven); the lumped thermal model + electro-thermal
   feedback; failure checks through over-temperature, gate overvoltage, and
   reverse breakdown; real wire resistance so long thin wires genuinely
   droop; multi-lead sources that expand into real tapped stacks before
   every solve; circuit blocks -- a drawn circuit becomes ONE reusable part
   that always flattens to its real parts for the solver.
4. **The instrument arc:** the multimeter (red/black probes, DC volts,
   true-RMS AC volts with a Schmitt-hysteresis frequency counter,
   powered-off ohms + continuity, diode test, capacitance, clamp amps --
   numbers verified against Fluke 117 documentation); the Math panel (every
   equation with the real numbers in it, Kirchhoff's current law re-summed
   at every net -- the checkmark computed, not assumed); five lenses
   (voltage / power / temperature / flow / magnetic field); and the
   oscilloscope, built feature-by-feature from a tier list of what real
   scopes do: pick-your-probes by clicking terminals, edge trigger with
   Auto/Normal/Single and pretrigger, timebase + per-channel volts/div on a
   10x8 graticule with honest-sampling refusals, draggable cursors,
   ~20 live auto-measurements (sharing the meter's verified math), math
   channels with unit algebra, an FFT written from scratch, persistence,
   XY mode, CSV export, and current clamps on wires -- making volts x amps
   read REAL WATTS.

### Done criteria

- [x] The original scope (A-D) shipped and screenshot-verified in week one
- [x] Every increment passed all four gates before being declared done
      (tsc, biome, vitest, build)
- [x] 633 tests at close (240 at Sprint 18 close)
- [x] Headline physics verified against textbook identities live: RMS = A/sqrt(2),
      sine rise time = 0.2952/f, square-wave fundamental = 4A/pi, power at
      2x the source frequency, average power agreeing three ways
- [x] Retro written; CLAUDE.md status refreshed

### Project state after Sprint 19

| | Sprint 18 close | Sprint 19 close |
|---|---|---|
| Solvers | DC (MNA + Newton-Raphson) | + transient (backward-Euler + NR), electro-thermal feedback |
| Canvas | static render of the anchor circuit | full editor: drop, wire, drag, select/lasso, clipboard, undo/redo, blocks, Save/Load |
| Devices | the anchor circuit's kinds | through diode family, BJTs, MOSFETs, transformers, multi-lead sources, user-made blocks |
| Instruments | none | multimeter (Fluke-verified) + full oscilloscope + Math panel + 5 lenses |
| Tests | 240 | 633 |
| Increments | 6 | 84 |

### Lessons surfaced

1. **Live verification catches what unit tests structurally can't.** Three
   times a passing test suite hid a real bug: ungroup dropped internal wires
   (the current-comparison test passed falsely at ~0 A), the Math card
   multiplied hot current by cold resistance (violating Kirchhoff on its own
   page), and the re-solve rebuild silently wiped user edge state for ten
   increments. Each was found by driving the real canvas and reading the
   numbers. **General lesson:** unit tests prove the pieces; only the
   assembled, running thing proves the assembly.
2. **When the tool and your expectation disagree, check the expectation
   first.** A live NMOS read 19.4 mA where hand math said 18.9 -- the solver
   was RIGHT (the resistor's temperature coefficient at +59 C sags its
   resistance 3%). And a "flat scope bug" that burned ~20 debugging steps
   was a mis-built test circuit, not a solver fault -- the headless
   reproduction passing is what exposed it. **General lesson:** a verified
   engine earns the benefit of the doubt; suspect the rig before the physics.
3. **Honest refusal is a design pattern, not an error state.** The span-too-
   wide meter, the timebase that names the slowest honest setting instead of
   aliasing, the dash in the measurement strip, the unclampable 0-ohm wire,
   volts-minus-amps refused with an explanation. Every refusal states WHY and
   what to do instead. **General lesson:** when the honest answer is "can't
   measure that," saying so beats a plausible wrong number -- and the
   explanation turns the refusal into teaching.
4. **Share the math; let the old tests prove the move.** The meter's RMS +
   frequency counter moved verbatim into a shared module the scope also
   calls; the meter's 29 tests passing unchanged WAS the proof the
   extraction was faithful. Same trick for the single tempco formula.
   **General lesson:** two implementations of one formula will eventually
   disagree; one implementation with two callers cannot.
5. **Honesty pays compound interest.** Wires got real resistance in v3-32
   because pretending they were ideal would have been fake physics. Fifty
   increments later that decision made current clamps nearly free: a wire IS
   a resistor the solver already solved, so its current is exact Ohm's law
   on existing data -- no solver surgery, and the microvolt return-wire drop
   is genuinely visible on the scope. **General lesson:** model the truth
   early, even when nothing uses it yet; later features inherit it.
6. **A gate is only a gate if you read its exit code.** Nine lint errors and
   three warnings had slipped through increments that were declared "gates
   green." Re-running honestly at commit time caught them. **General
   lesson:** declaring done requires LOOKING at the gate's verdict, every
   time -- the discipline is cheap and the alternative compounds.
7. **Per-feature commits need per-feature timing.** Features built
   interleaved through the same files cannot be split into clean commits
   after the fact -- the intermediate states never existed. Sprints 70-78
   and 79-83 landed as batch commits whose messages document each increment
   individually. **General lesson:** commit cadence is decided while
   building, not at the end; if features interleave, the message must carry
   the per-feature record the history can't.

### What this unblocks

- **The digital chapter.** MOSFETs + blocks were built so logic gates are
  pure content: NAND/NOR/NOT as named blocks of real transistors, then
  adders, then sequential logic -- the on-ramp to the chip-level goal. The
  CMOS inverter is already proven in both solvers.
- **The curve tracer.** Per-device current recording in the transient solver
  turns XY mode into an I-V curve tracer -- the diode exponential and the
  MOSFET's triode/saturation family drawn from the shipped models.
- **An instrument bench for everything that follows.** Every future device
  model lands into a canvas with a verified meter, a full scope, live
  measurements, and a Math panel -- new physics is immediately probeable,
  measurable, and explainable.

### Sprint 19 closed

All 84 increments are on master and pushed. 633 tests, four gates green. The
project went from "a static schematic you can look at" to "a circuit lab you
can build in, measure with verified instruments, and interrogate down to the
equations." The next sprint opens on the project lead's direction -- the
digital chapter (gates from real transistors) and the curve tracer are the
two candidates on the table.
