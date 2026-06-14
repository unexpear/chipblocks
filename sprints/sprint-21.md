# Sprint 21 — The parts bench

> **Status: closed (2026-06-14).** Sprint 20 closed with second-order-honest
> device models and a finished instrument bench proven by self-audit. Before
> the digital chapter (logic gates from real transistors), this short sprint
> fills the four most-wanted gaps in the beginner parts a hobbyist reaches for
> first — chosen by the project lead from a catalog review: the potentiometer,
> the switch family (push button + SPDT), the fuse, and the thermistor.

## Goal

Add four primitive devices that round out the basic breadboard kit, each real
all the way down (cited values, solved physics, honest gaps stated), each a
clean fit on the existing engine:

- **Potentiometer** — a 3-terminal variable resistor: a track of total
  resistance split by a wiper position into R·p (one end → wiper) and
  R·(1−p) (wiper → other end). The adjustable divider, the volume knob.
- **Switch family** — a **momentary push button** (SPST, default open, closed
  while pressed) and an **SPDT selector** (one common routed to one of two
  throws). Our switch family today is a single SPST toggle.
- **Fuse** — a near-zero-resistance link that OPENS permanently once its
  current exceeds the rated value: real overcurrent protection, the part that
  sacrifices itself so the circuit doesn't.
- **Thermistor** — a resistor whose value follows the **Beta equation**
  R(T) = R₀·exp(B·(1/T − 1/T₀)) on its OWN junction temperature: the
  temperature sensor, and the first part whose resistance is a strongly
  nonlinear function of the heat the electro-thermal loop already computes.

## Why

The fundamentals (R, C, L, the diode and transistor families, transformer,
switch, source, ground, wire) are complete, but a beginner opening the palette
still misses parts that are in nearly every first project. These four are the
highest-value, cleanest-fit gaps, and three of them exercise machinery the
engine already has in a new, visible way:

- the potentiometer reuses the multi-element expansion pattern (one drawn part
  → several real parts for the solver, like the multi-lead source and blocks);
- the fuse reuses the failure-mode-check + re-solve pattern (like the LED
  overcurrent check), plus the fuse-rating physics we just built into the
  meter's series ammeter;
- the thermistor reuses the electro-thermal fixed-point loop — but is the first
  part to put a nonlinear R(T) law inside it, the on-ramp to real sensors.

## What makes this honest

- **No faked values.** Each part ships cited defaults with provenance: a
  10 kΩ linear pot, a tactile push button's contact resistance, a glass
  fast-blow fuse's rating, an NTC thermistor's B and R₀ from a real datasheet
  (e.g. a 10 kΩ NTC, B₂₅/₈₅ ≈ 3950 K).
- **The wiper is a real split, not a fudge.** The pot's two segments sum to
  the declared total at every position; probe the wiper and read the divider
  voltage the segments actually produce.
- **The fuse blows on real current.** Its open/closed state is driven by the
  solved current against the cited rating, the same way the LED overcurrent
  check fires — stateful (a blown fuse stays open until replaced), never a
  cosmetic flag.
- **The thermistor's curve is the Beta law on the solved temperature.** Its
  resistance is recomputed from the electro-thermal loop's own per-part
  temperature; self-heating and the R(T) response are one coupled solve, not a
  lookup table.

## Scope (per increment)

**S21-v3-2 — Switch family.** `switch_spst_momentary` (push button) and
`switch_spdt`. The push button is electrically an SPST short (default open);
the value is the symbol + default-open semantics + the press interaction. The
SPDT is a 3-terminal part (common + throw A + throw B) whose `position`
parameter shorts common to one throw and leaves the other open — a new
two-position topology stamped from the existing 0 Ω-short machinery. Symbols,
palette, cited defaults, canvas interaction (toggle/press), tests (each
position's continuity), live verify.

**S21-v3-3 — Potentiometer.** `potentiometer`: total resistance +
`wiper_position` (0..1). A canvas-to-world expansion (after block flatten,
beside the multi-lead source expansion) turns one pot into two resistors
sharing the wiper net, lengths/values from the split. Symbol (resistor body
with the wiper arrow), palette, Properties slider, tests (divider voltage vs
position, segment sum = total, endpoints), live verify (sweep the wiper, watch
the divider).

**S21-v3-4 — Fuse.** `fuse`: rated current + a (near-zero) cold resistance.
Solved as a short until its current exceeds the rating, then OPEN and reported
blown (a failure-mode check + re-solve, the LED-overcurrent pattern); the blown
state persists until the user replaces it. Symbol, palette, cited default
(a 500 mA glass fast-blow), tests (carries under rating, opens over it, stays
open), live verify (overload it, watch it blow and the circuit go dark).

**S21-v3-5 — Thermistor.** `thermistor` (NTC default): R₀, B, and the
reference temperature. A new exponential branch in the electro-thermal loop's
`worldAtTemperatures` (beside the linear tempco) computes R from the part's
own temperature via the Beta equation. Symbol, palette, cited NTC default,
tests (R at the reference = R₀, the Beta curve at two temperatures, self-heating
drives the value down for an NTC), live verify.

## Non-goals (this sprint)

- Light-dependent parts (LDR, photodiode, phototransistor): need a light /
  illumination input the engine doesn't have — deferred.
- Relay (coil-driven mechanical switch), crystal/resonator, JFET, SCR/triac:
  more specialized, deferred.
- Steinhart-Hart (the 3-coefficient thermistor model): the Beta equation is the
  standard 2-parameter datasheet form and the honest first rung; Steinhart-Hart
  is a later refinement if needed.
- Multi-gang / log-taper pots, slow-blow fuse I²t timing: single-gang linear pot
  and an instantaneous-rating fuse first; the curves/timing are refinements.

## Done when

- All four parts drop from the palette, solve correctly, and carry cited
  defaults with provenance.
- The pot's wiper produces the right divider voltage at every position; the
  SPDT routes to the selected throw; the fuse blows on real overcurrent and
  stays blown; the thermistor's resistance follows the Beta law on its solved
  temperature.
- Tests per part (continuity / divider / blow / Beta curve) pass; gates stay
  green throughout (tsc, biome, vitest, build).

## Sub-commits (planned)

- **S21-v3-1** — this plan.
- **S21-v3-2** — switch family (push button + SPDT).
- **S21-v3-3** — potentiometer.
- **S21-v3-4** — fuse.
- **S21-v3-5** — thermistor.
- **S21-v3-6** — retro.

## Close-out (2026-06-14) — Sprint 21 closes

Planned as a short four-part bench-rounding sprint; it grew into the longest
post-S19 stretch as each part opened the next door and the project lead kept
pulling threads. What landed, in three waves:

**Wave 1 — the planned parts bench (S21-v3-2 … 5).** The switch family
(momentary push button + SPDT selector), the potentiometer (a real wiper split
into two solver resistors), the fuse (stateful overcurrent blow), and the NTC
thermistor (the Beta law on the electro-thermal loop's own temperature). All
four drop, solve, carry cited defaults, tested + live-verified exactly as
scoped.

**Wave 2 — past the plan.** Adding an illumination input (the stated blocker
for light parts) turned out clean, so the "deferred" light family landed too
(S21-v3-7 … 9): the photoresistor (LDR) on a per-part incident-light axis, a
light source casting E = I/d² by canvas distance, and the photodiode +
phototransistor as light-driven current sources. Plus worst-case tolerance
analysis (S21-v3-10 — every value's ± band swept to the corner extremes), and
the relay — another non-goal — built as pure composition (a coil driving a
switch, no new physics).

**Wave 3 — honest-gap closure + interface depth.** A self-review surfaced a
backlog of "defined but not fully modelled" / "cited to a class" caveats; the
lead chose to close them all rather than carry them. Localized wire hot-spots
(the fin model colouring the real hot section, ends heat-sunk by the connected
parts) + the wire over-temperature failure; LED forward-voltage droop (Varshni
bandgap); Zener reverse breakdown (regulates at V_Z in both engines);
transformer core saturation (the magnetizing inductance collapses past the
rated flux — the real magnetizing-current spike, not just a warning); per-wire
gauge with its derived ampacity rating + a default-gauge picker; panel
tab-grouping (drag one panel onto another to stack into tabs); and a
datasheet-verification pass that caught a mislabelled inductor (a µH-package
part cited for a 10 mH value) and tied the class-cited defaults to specific
part numbers. Wire shielding was raised and honestly DEFERRED to the future EM
stage — logged in PHYSICS-COVERAGE-MAP.md, not faked.

### Retro

- **Reuse over re-engineering.** Every increment rode existing machinery: the
  pot the multi-element expansion, the fuse the failure-check + re-solve, the
  thermistor + light parts the electro-thermal loop, the panel tabs a small
  pure reducer, the saturation the volt-second flux the solver already tracked.
- **Build → four gates → drive it live → then done.** This caught real errors
  green tests alone would not have: the mislabelled inductor (datasheet pass),
  and back in S20 the meter once reading a cold circuit (self-audit).
- **"Fine taking time" held.** The sprint ran long because correctness, not a
  deadline, set the pace — and it ends with no remaining honest-gap debt: every
  shipped value is either tied to a real part or clearly labelled a class /
  model / representative value.
- **Honestly deferred (named, not faked).** Wire shielding's EMI rejection,
  characteristic impedance, and twisted-pair coupling → the future EM-field
  stage. Steinhart-Hart, log-taper pots, slow-blow I²t timing, JFET/SCR → later
  refinements.

**Sprint 22** opens on the project lead's direction: **more analog depth** —
the op-amp as the keystone (amplifiers, comparators, active filters,
oscillators), then the everyday analog toolbox.
