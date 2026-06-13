# Sprint 20 — The curve tracer (and where it led)

> **Status: CLOSED (2026-06-13).** Opened as the curve tracer; grew into the
> sprint that made the device models second-order-honest, finished the
> instrument bench, and then turned those instruments on the system itself.
> 17 increments (S20-v3-1..17), 10 commits, 633 → 701 tests, four gates green
> throughout, all pushed to `origin/master` (`8b983c7`). Close-out + retro at
> the foot of this file.
>
> **Original framing (kept for the record):** Sprint 19 closed with a complete
> oscilloscope whose current clamps read wires by Ohm's law on solved node
> voltages. This sprint goes one level deeper: the transient solver records
> EVERY device's terminal currents at every time step, and the scope's XY mode
> becomes a real curve tracer — the instrument that draws a device's defining
> I-V picture.

## Goal

Sweep a voltage across a device and plot its current against it: the diode's
exponential knee, the resistor's straight line whose slope IS 1/R, the
capacitor's ellipse, and — the showpiece — the MOSFET's family of curves
(drain current vs drain-source voltage at several gate voltages), the exact
picture printed in every datasheet. All of it from the shipped device models,
none of it drawn from anything but solved physics.

## Why

Two reasons, one practical and one foundational.

Practical: the scope's current story is wire clamps — exact, but indirect
(every branch needs a wire, and a 0 Ω ideal wire can't be clamped). Recording
currents at the source — inside the solver, per device, per step — makes any
part's current directly probeable, including the currents no wire carries
separately (a BJT's base current; a transformer's core-loss current).

Foundational: the project's horizon is chips. The I-V characteristic is THE
language of semiconductor devices — datasheets, textbooks, and device
engineering all speak in curves. A curve tracer that draws those curves from
our own models is both the strongest verification instrument we can build
(any model error becomes a visibly wrong curve) and the bridge from circuit
work to device work.

## What makes this honest

- **No new physics.** Every recorded current is computed from quantities the
  solver already produced: the MNA auxiliary variables (wires, switches,
  sources — solved exactly), companion-model state (capacitors, inductors,
  transformers), and the shipped device laws evaluated at the converged
  solution (Shockley for diodes, Ebers-Moll for BJTs, Level-1 for MOSFETs —
  the same exported, tested functions the stamps are built from).
- **Kirchhoff's current law closes per device.** Currents are recorded
  per-terminal (amps INTO each terminal); every device's terminal currents
  must sum to zero at every step — a testable invariant, not a hope.
- **The curves are swept, not synthesized.** The tracer drives the device
  with a real source in a real circuit and plots solved voltage against
  solved current. A wrong model produces a wrong curve in plain sight.

## Scope

**A. Per-terminal current recording (the core, accuracy-critical).**
`TransientPoint` gains `currents: Map<'instanceId/terminal', amps-into>`.
Derivations, device by device: resistors and clamp-style wires by ΔV/R;
wires/switches/sources read EXACTLY from their MNA auxiliary current
variables (including ideal 0 Ω shorts); capacitors from the backward-Euler
companion (G·v − I_hist; the t = 0 hold's auxiliary); inductors and
transformer windings from their companion step currents (shared helpers, not
duplicated formulas); diodes/LEDs by Shockley at the converged voltage; BJTs
by Ebers-Moll (all three terminals); MOSFETs by the Level-1 operating point.
Tests: per-device KCL closure + analytic targets per kind.

**B. Part-current probes on the scope.** With the Scope open, clicking a part
BODY clamps a current channel reading that device's recorded current
(2-terminal parts: the through current; transistors: the collector/drain).
Same channel pipeline as wire clamps — amps units everywhere, watts math.

**C. Curve tracing in XY.** XY mode plots a voltage channel against a part's
current channel; an AC source sweeps the device. Demos verified against the
math: resistor line (slope 1/R), diode exponential, capacitor ellipse (90°).

**D. Family curves (the showpiece).** A stepped-parameter harness: run the
simulation N times stepping one source's voltage, overlay the N XY traces
with a legend — the MOSFET I_D vs V_DS family at several V_GS.

## Non-goals (this sprint)

- Reverse breakdown (zener) and MOSFET temperature laws — still documented
  honest gaps; the tracer will draw what the models say, gaps included.
- A dedicated curve-tracer UI beyond the scope's XY machinery (axes presets,
  datasheet overlays) — polish after the physics is proven.
- Per-step electro-thermal feedback in transient (DC-only today).

## Done when

- Every solved transient point carries per-terminal currents; KCL closes per
  device at every step in tests; per-kind analytic checks pass.
- A diode's I-V exponential and a resistor's straight line draw live in XY
  from a swept source, verified against hand math.
- The MOSFET family-curve picture renders from N stepped runs.
- Gates stay green throughout: tsc, biome, vitest, build.

## Sub-commits (planned)

- **S20-v3-1** — this plan.
- **S20-v3-2** — per-terminal current recording in the transient solver + KCL
  and analytic tests.
- **S20-v3-3** — scope part-current probes (body click) + XY curve demos
  (diode exponential, resistor line) live-verified.
- **S20-v3-4** — family curves: the stepped-parameter sweep harness + the
  MOSFET characteristic family.
- **S20-v3-5** — retro.

---

## Close-out (2026-06-13)

The plan above ends at S20-v3-5 "retro." It didn't. The curve tracer landed
exactly as scoped (v3-1..4), and then drawing real device curves did what the
"Why" section predicted — it turned every model gap into a visible feature and
pulled the next four increments out of the work: the transient electro-thermal
fix the tracer's own audit demanded (v3-5), the BJT family (v3-6), and the two
second-order device physics the flat curves begged for (the Early effect v3-7,
MOSFET temperature laws v3-8). From there the project lead carried it through
the scope polish that was on the shelf (v3-9..10), then a top-to-bottom
multimeter rebuild against real-meter research (v3-11..16), and finally a
system-validation audit that used the finished instruments to cross-examine the
whole engine — which found, and fixed, the meter reading a cold circuit
(v3-17).

### What actually shipped

**The curve tracer (the planned core).**
- **v3-2** — the transient solver records every device's per-terminal current
  (amps INTO each terminal) at every step, derived from quantities the solver
  already produced: MNA auxiliaries (wires/switches/sources, exact), companion
  state (C/L/transformers), and the shipped device laws at the converged
  solution. Per-device KCL closure is a test invariant.
- **v3-3** — Alt+click a part body clamps a current channel; XY mode draws the
  diode's exponential knee and the resistor's straight line, live, from a
  swept source.
- **v3-4** — family curves: N stepped runs overlaid, the MOSFET I_D–V_DS family
  at several V_GS — the datasheet picture, with the square-law spacing visible.
- **v3-6** — the BJT family, equal-spaced plateaus (the linear β·ΔI_B law) — a
  different device's fingerprint in the same instrument.

**Device models made second-order-honest (the curve made them necessary).**
- **v3-5** — transient electro-thermal feedback: the scope's engine now heats
  parts like the DC engine, closing the 0.8 % cross-engine current gap the
  tracer's own audit measured. (Landed before v3-4 in commit order; the App
  wired both.)
- **v3-7** — the Early effect: the BJT plateaus tilt toward −V_A with a cited
  Fairchild/onsemi V_AF, where they had been dead flat.
- **v3-8** — MOSFET temperature laws: mobility falls as (T/T₀)^−1.5 and the
  threshold drifts by a coefficient extracted from the datasheet's own
  V_GS(th)-vs-temperature curve; the two laws give the real ZTC crossover.

**The instrument bench, finished.**
- **v3-9** — FFT dB(rms) vertical; **v3-10** — the scope's vertical position
  knob (the last "future increment" note in the scope, redeemed).
- **v3-11** — series ammeter with blowable fuses (the meter joins the circuit:
  burden voltage, and the famous across-a-battery pop).
- **v3-12** — 10 MΩ input impedance (the loading lesson); **v3-13** — lead
  resistance + REL/zero; **v3-14** — MIN/MAX/AVG; **v3-15** — a thermocouple
  reading real junction temperatures; **v3-16** — duty cycle + the 6000-count
  display.

**The self-audit.**
- A clean exact-integer rig (12 V/0 Ω → switch → 1 kΩ → 2 kΩ) cross-checked
  every instrument against hand math and against each other: KCL/KVL/power all
  close; one current measured four ways; the AC trio (meter V~, scope measure,
  FFT) agreeing; in-circuit Ω reading the parallel combination. It surfaced
  **v3-17** — the meter's live-circuit modes (V⎓, A⎓, V~, MIN/MAX) re-solved
  cold while the clamp/scope/panels solved hot, so the meter disagreed with
  itself. Fixed by routing those modes through the shared electro-thermal
  solver — every live measurement now reads one per-part temperature.

### Done-when checklist (from the plan)

- [x] Every solved transient point carries per-terminal currents; KCL closes
      per device at every step; per-kind analytic checks pass
- [x] A diode's I-V exponential and a resistor's straight line draw live in XY
      from a swept source, verified against hand math
- [x] The MOSFET family-curve picture renders from N stepped runs (and the BJT
      family too)
- [x] Gates green throughout (tsc, biome, vitest, build); 701 tests at close
- [x] Two of the plan's three non-goals consumed mid-sprint: MOSFET
      temperature laws (v3-8) and per-step electro-thermal in transient (v3-5)
      both shipped. Reverse breakdown (zener) remains the one documented gap.

### Project state after Sprint 20

| | Sprint 19 close | Sprint 20 close |
|---|---|---|
| Solvers | DC + transient, DC electro-thermal feedback | + transient electro-thermal; every engine and live instrument shares one per-part temperature |
| Device models | first-order (Shockley, Ebers-Moll, Level-1) | + Early effect (BJT), mobility + V_th drift (MOSFET) — second-order, cited |
| Currents | wire clamps (Ohm on node voltages) | every device's per-terminal current recorded in the solver |
| Instruments | meter + scope + Math + 5 lenses | + curve tracer (XY + family); meter grown to series amps, loading, REL, MIN/MAX, °C, duty, honest counts |
| Verification | unit tests + live spot-checks | + a full instrument self-audit cross-examining the engine |
| Tests | 633 | 701 |
| Increments | 84 | 17 |

### Lessons surfaced

1. **An instrument that measures the system can audit the system.** The two
   sharpest findings of the sprint — the cross-engine thermal gap (v3-5) and
   the meter's cold/hot self-contradiction (v3-17) — were both caught by using
   ChipBlocks's own meter, scope, and Math panel to cross-examine the engine
   on hand-computable circuits. The curve tracer was built as a verification
   instrument; the whole bench turned out to be one. **General lesson:** build
   measurement well and the measurement becomes a verifier that finds what the
   test suite structurally can't.
2. **Two ways to compute one quantity will disagree; the fix is one shared
   path.** The same bug shape appeared twice — an engine/mode solving cold
   while the rest solved hot (transient vs DC; meter modes vs clamp/scope).
   Both times the fix was identical: route through the one electro-thermal
   solver. **General lesson:** every time you add a second route to the same
   physical number, schedule its eventual divergence; collapse to one path
   instead of reconciling two. (Sprint 19's "share the math," now at the
   engine level.)
3. **The curve makes the model honest.** Before v3-7 the BJT plateaus were
   dead flat; the tracer drew that flatness as plainly as it later drew the
   tilt. The MOSFET's square-law family spacing versus the BJT's linear
   spacing are device fingerprints visible at a glance. **General lesson:**
   for physics, the most rigorous test is the picture a domain expert would
   recognize instantly — a wrong model draws a wrong curve in plain sight.
4. **When the datasheet publishes a curve but not a number, the curve is the
   citation.** The MOSFET threshold tempco (v3-8) exists only as a graph, so
   it came from decompressing the datasheet PDF's vector stream, calibrating
   the axes off the gridline rectangles, and least-squaring the actual plotted
   points (−3.35 mV/°C, through 25 °C/0.000 V exactly). **General lesson:**
   read the manufacturer's own data rather than guessing a plausible value;
   the provenance is stronger and the number is real.
5. **A surprising reading is usually a feature you forgot you specified.** The
   "4.02 → 3.95 mA drift" flagged during the audit was the 50 Ω source
   impedance the AC preset had correctly added (a function generator's real
   output resistance), carried over when the source was switched back to DC.
   The engine was being more real than the observer. **General lesson:**
   suspect the rig before the physics — and when a verified engine surprises
   you, it is usually telling you something true about the circuit you set up.
6. **Per-part, never global — and the layering proves it.** Heat is computed
   per component (T = ambient + its own P · its own θ), stored per instance;
   part-to-part conduction is deliberately deferred to the PCB layer where
   board geometry will exist. **General lesson:** contain each layer's physics
   to its own scope; the discipline is what lets higher layers compose without
   anything global leaking across a boundary.

### What this unblocks

- **The digital chapter** is still the on-ramp to chips: logic gates as named
  blocks of the now-second-order-honest transistors, then adders, then
  sequential logic. The instruments that just audited the analog engine will
  measure the digital one the same way.
- **Device work has its language.** The curve tracer draws the I-V picture
  every datasheet and textbook speaks in — the bridge from circuit work to
  device work, and a permanent regression instrument (any future model error
  becomes a visibly wrong curve).
- **A trusted bench.** The self-audit established that conservation, Ohm's
  law, self-heating, burden, loading, and two solver engines all cross-agree
  on hand-computable circuits. New physics lands into a bench that has been
  proven against itself.

### Sprint 20 closed

All 17 increments are on master and pushed (`8b983c7`). 701 tests, four gates
green. The sprint set out to draw a device's defining curve and ended up
making the devices worth drawing — second-order-honest models, a finished
instrument bench, and the proof, by the instruments' own cross-examination,
that the whole thing behaves like real electronics. The next sprint opens on
the project lead's direction; the digital chapter is the standing candidate.
