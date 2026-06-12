# Sprint 20 — The curve tracer

> **Status: open (2026-06-12).** Sprint 19 closed with a complete oscilloscope
> whose current clamps read wires by Ohm's law on solved node voltages. This
> sprint goes one level deeper: the transient solver records EVERY device's
> terminal currents at every time step, and the scope's XY mode becomes a real
> curve tracer — the instrument that draws a device's defining I-V picture.

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
