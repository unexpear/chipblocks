# PHYSICS-COVERAGE-MAP.md

> **What this is:** the long-term physics-coverage roadmap for ChipBlocks. Names every phenomenon class a CPU/PCB design system eventually has to model, classifies each by support tier, and tags each with a solver strategy (compute directly / approximate / warn-only / external-solver / future research). Acts as a **completeness checklist** when authoring new behaviors and as a **scope guard** against fake precision.
>
> **Status:** research-derived roadmap doc, not a sprint task. Last reviewed 2026-05-18.
>
> **Current-state note (2026-05-20):** "Already in `behaviors.yaml` / `materials.yaml`" references below reflect the v2 state before the second reset. As of 2026-05-20, `materials.yaml`, `behaviors.yaml`, and the corresponding `*.schema.json` files don't exist on master — they return in v3 Sprint 2+. The architectural claims (tier tagging, the `solver_level` enum, the completeness checklist) still hold; only the "already in X" phrasing is forward-looking.
>
> **Why this exists:** the project's ambition ceiling is "ground-up electronics design from materials to full systems." That covers ~16 phenomenon classes, hundreds of named behaviors, and multiple physics regimes (DC, AC, semiconductor device physics, transmission lines, reliability). Without an explicit coverage map, the validator's scope drifts implicitly and the project either over-extends ("simulate everything") or under-extends ("only model what's convenient"). This doc draws the line.

---

## The governing principle

> **Start with simple laws, encode every phenomenon as a named behavior, and only simulate deeply when the project has enough inputs to make the result meaningful. Otherwise you'll build fake precision.**

The right first move is *not* "simulate Maxwell's equations." The right first move is:

> Recognize which blocks and conditions make Maxwell-level effects relevant — then warn, approximate, or route to an external solver.

This is the same discipline as the Sprint 2 sourcing rule (*"useful, cited, and condition-aware"*) and the audit-cleanup widening of silicon resistivity from a single overconfident number to a range (`640–3400 ohm·m` with `confidence: medium`). Physics coverage gets the same treatment: every claim sized to its evidence.

---

## Architectural primitives

Four primitives govern how ChipBlocks handles physics:

1. **Behaviors as named entries.** Every phenomenon ChipBlocks knows about is an entry in [`behaviors.yaml`](behaviors.yaml). The validator dispatches by name. (Math-at-the-meaning-level decision — see CLAUDE.md core principle 2.)

2. **`solver_level` enum (planned schema addition).** Each behavior declares what the validator should *do* with it:

   | Tag | Meaning |
   |---|---|
   | `builtin_simple` | Validator computes directly (Ohm, KVL, Joule heating, basic Cap/Ind) |
   | `builtin_approximation` | Validator runs a rule-of-thumb estimate, marks confidence:medium |
   | `warning_only` | Validator detects when the phenomenon may matter, emits a warning, does not compute |
   | `external_solver` | Validator routes to ngspice / Yosys / specialist tool; carries the I/O contract |
   | `research_future` | Phenomenon known but not yet implemented at any level |

   This pairs with the existing `law` field. When this lands as a schema change, every behavior gets a `solver_level` tag.

3. **Property function-types** (planned, per [TOOLING-RESEARCH-2026-05.md](TOOLING-RESEARCH-2026-05.md)). Material properties evolve from scalars to one of: `scalar / analytic / interpolation_table / piecewise`. Temperature-dependent resistivity, frequency-dependent permittivity all use this.

4. **Tier-to-sprint mapping.** Each phenomenon carries an explicit tier (1–5 plus 15-DFM and 16-firmware) that maps to the sprint where its first-cut support lands. Implementation order = tier order.

---

## Tier definitions

| Tier | Domain | First-cut sprint | Discipline |
|---|---|---|---|
| **1 — Core early engine** | DC laws + basic energy storage + simple failure checks | S3 (devices) → S5 (validator first cut) | Simulate directly. The LED demo runs end-to-end here. |
| **2 — First real behavior** | RC/RL, thermal resistance, IR drop, brownout, decoupling, basic ESD | S7–S9 | Mostly `builtin_simple`; first real engineering judgments. |
| **3 — Advanced PCB / CPU high-speed** | Transmission lines, crosstalk, EMC, jitter, PDN impedance | S10–S15 | Mostly `warning_only` first; full simulation routes to external solver later. |
| **4 — Semiconductor deep physics** | MOSFET internals, mobility, leakage, breakdown, tunneling | S15+ | Two layers: simple educational model in ChipBlocks; serious work routes to ngspice + PDK + BSIM. |
| **5 — Reliability + aging** | Electromigration, TDDB, NBTI, HCI, solder fatigue, ESD lifetime | S12+ | `warning_only` lifetime estimates. Never claim simulation accuracy. |
| **15 — Manufacturing + DFM** | Solder paste, tombstoning, panelization, DFM rules, part availability | S6 manufacturing ZIP first cut → ongoing | Rule engines + warnings; part data routes to external (DigiKey/Mouser API). |
| **16 — Firmware / HW interaction** | GPIO drive, ADC impedance, I2C timing, brownout, watchdog | S6+ (AI as project-compiler) | Constraint checks + warnings; AI generates firmware/docs. |

---

## Per-category phenomena (the completeness map)

### Category 1 — Fundamental electrical laws

The bedrock. Every Tier-1 device adopts at least one of these via its `behaviors` list.

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| Ohm's law | 1 | builtin_simple | L3 `conducts`; L4 wire / resistor / LED | Already in behaviors.yaml as `conducts.law: ohm` |
| Kirchhoff's voltage law (KVL) | 1 | builtin_simple | Circuit topology (S5 validator) | The LED-demo loop equation |
| Kirchhoff's current law (KCL) | 1 | builtin_simple | Every node (S5 validator) | Net-correctness check |
| Joule heating (P = I²R) | 1 | builtin_simple | L3 `resists`; L4 wire / resistor | Already in behaviors.yaml as `resists.law: joule` |
| Coulomb's law | 4 | research_future | Underpinning semiconductor + dielectric physics | Never invoked directly |
| Maxwell's equations | 4 | external_solver | Foundational; field solvers (SI/EMC) | Reach via specialist tool |
| Faraday's law / Lenz's law | 2 | builtin_simple | L3 `stores_magnetic_energy`; inductor + transformer | Already exists as DC-only; AC behavior comes in T2 |

### Category 2 — Circuit theory & AC behavior

Stops the system feeling toy-like.

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| Capacitance | 1 | builtin_simple | L3 `stores_charge`; capacitor | Already in behaviors.yaml |
| Inductance | 1 | builtin_simple | L3 `stores_magnetic_energy`; inductor | DC handling exists; AC reactance is T2 |
| Impedance Z(ω) | 2 | builtin_simple | All reactive elements | Complex-valued; first introduced when validator gains AC capability |
| Reactance | 2 | builtin_simple | Capacitor, inductor | Frequency-dependent |
| RC time constant | 2 | builtin_simple | Filter circuits | Single-pole responses |
| RL time constant | 2 | builtin_simple | Inductive circuits | Single-pole responses |
| RLC resonance + Q factor | 2 | builtin_simple | Filters, tanks, oscillators | Closed-form |
| Phase, power factor | 2 | builtin_simple | AC analysis | Comes with impedance |
| Frequency response | 3 | external_solver | All AC systems | Bode plots; route to specialist sim |
| Transfer functions | 3 | external_solver | Filter, control circuits | Symbolic + numeric solver |

### Category 3 — Semiconductor physics

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| Band theory | 4 | research_future | Material understanding only | Cite Ioffe NSM + Sze |
| Fermi level | 4 | research_future | Doped-Si modeling | |
| Bandgap | 1 (data) / 4 (model) | builtin_simple (as a property) | Materials.yaml | Already exists in silicon entry |
| PN junctions | 2 | builtin_simple | Diode (T2) | Shockley equation closed form |
| Depletion region, built-in potential | 4 | external_solver | Diode/transistor internals | ngspice + PDK |
| Carrier mobility (T- and doping-dependent) | 4 | builtin_approximation → external_solver | Doped Si, MOSFETs | Caughey-Thomas model first, BSIM later |
| Drift, diffusion, recombination, generation | 4 | external_solver | Transistor physics | Drift-diffusion solver territory |
| Avalanche / Zener breakdown | 2 | warning_only + builtin_approximation | Diodes, junctions | Threshold model; warn when reached |
| Tunneling (Zener, direct, Fowler-Nordheim) | 4 | external_solver | Modern transistor gate leakage | Quantum effect |

### Category 4 — Transistor / MOSFET behavior

Two-layer model: simple educational behavior in ChipBlocks; serious work routes to ngspice + PDK + BSIM.

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| Threshold voltage Vth | 4 | builtin_simple + external_solver | MOSFET | Square-law for teaching; BSIM for real |
| Cutoff / triode / saturation regions | 4 | builtin_simple | MOSFET | Square-law model |
| Short-channel effects | 4 | external_solver | Modern MOSFET (<180nm) | BSIM only |
| DIBL | 4 | external_solver | Modern MOSFET | BSIM |
| Channel-length modulation (λ) | 4 | builtin_simple + external_solver | MOSFET in saturation | Lambda model; BSIM for accuracy |
| Subthreshold leakage | 4 | external_solver | Modern MOSFET | Exponential below Vth |
| Gate leakage | 4 | external_solver | Modern MOSFET (<90nm) | Tunneling-driven |
| Body effect | 4 | builtin_simple + external_solver | MOSFET | Square-root model + BSIM |
| Velocity saturation | 4 | external_solver | Short-channel MOSFET | BSIM |
| Parasitic caps (Cgs, Cgd, Cdb) | 4 | builtin_simple + external_solver | MOSFET | Lumped model + BSIM |
| Transconductance gm | 4 | builtin_simple | MOSFET in saturation | Closed form |

### Category 5 — Thermal effects

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| Heat generation (resistive + switching) | 1 | builtin_simple | Every component | P = I²R for DC; CV²f for switching |
| Thermal conductivity | 1 (data) | builtin_simple | Materials | Already in materials.yaml |
| Thermal resistance (θJA, θJC) | 2 | builtin_simple | Packaged devices | T_rise = P × θ |
| Temperature coefficients (R, C, bandgap) | 1 → 2 | builtin_simple | Materials | Already partially in materials notes; T-dependent function model is the upgrade |
| Mobility degradation with T | 4 | external_solver | MOSFETs | BSIM |
| Thermal runaway | 2 | warning_only | Power devices, BJTs | Positive feedback detection |
| Electromigration (Black's eqn) | 5 | warning_only | Wires, vias | MTTF estimate |

### Category 6 — Signal integrity (high-speed)

ChipBlocks should not fully solve these internally at first. Detect when they may matter; estimate rough risk; route to external solver later.

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| Transmission-line theory | 3 | warning_only → external_solver | PCB traces, cables | Trigger: edge rate × trace length |
| Characteristic impedance Z₀ | 3 | builtin_simple + warning_only | PCB stack-up | Closed form from geometry; warn on mismatch |
| Reflections from impedance mismatch | 3 | warning_only + external_solver | Fast digital traces | Termination warnings |
| Propagation delay | 3 | builtin_simple | PCB traces | Speed-of-light from εr |
| Skin effect | 3 | builtin_approximation | Wires at high f | Loss increases with √f |
| Dielectric losses (tan δ) | 3 | builtin_simple (data) | Materials | Already in FR4 notes |
| Crosstalk (NEXT, FEXT) | 3 | external_solver | Adjacent traces | Specialist sim |
| Jitter (random, deterministic, ISI) | 3 | external_solver | Clock + serial links | Statistical model |
| Ground bounce | 3 | warning_only + external_solver | Switching outputs near GND | Return-current analysis |
| Return-path discontinuities | 3 | warning_only | Plane splits | Trigger: trace crosses split |
| Via parasitics | 3 | warning_only + external_solver | Vias | Stub-length warning |
| Stub resonances | 3 | warning_only | Unterminated stubs | Wavelength-based detection |

### Category 7 — Electromagnetic compatibility (EMC)

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| EMI: radiated emissions | 3 | external_solver | Whole-board level | Field solvers |
| EMI: conducted emissions | 3 | warning_only + external_solver | Power lines, cables | Filter design rules |
| Susceptibility / immunity | 3 | external_solver | Whole-system | Compliance domain |
| Antenna effects (unintentional) | 3 | warning_only | Long traces near edges | Length vs wavelength |
| Magnetic coupling, eddy currents | 3 | external_solver | Inductors, transformers | Field solver |
| Shielding / Faraday cages | 3 | warning_only + external_solver | Enclosures, shielded sections | Apertures, slot dimensions |
| Wire/cable shielding (coax, STP) | 3 | builtin_simple (shield C) + external_solver | Shielded wires, coax, twisted pair | Wire shielding type + effects. Shield-to-conductor C is a lumped C-to-GND that loads the signal (modelable now — DEFERRED 2026-06-14 so shielding lands whole). EMI rejection (the headline), characteristic impedance Z₀, and twisted-pair magnetic cancellation are EM-stage work. |

### Category 8 — Noise sources

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| Johnson-Nyquist thermal noise | 2 | builtin_simple | All resistors | V = √(4kTRΔf), closed form |
| Shot noise | 2 | builtin_simple | Diodes, junctions, transistors | I_n = √(2qIΔf) |
| Flicker (1/f) noise | 3 | external_solver | Active devices, esp. MOSFETs | Empirical model |
| Phase noise | 3 | external_solver | Oscillators, clocks | Specialist sim |
| Quantization noise | 2 | builtin_simple | ADC/DAC | SQNR = 6.02N + 1.76 dB |

### Category 9 — Power delivery network (PDN)

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| Dynamic power (CV²f) | 2 | builtin_simple | Digital switching | Closed form |
| Leakage power | 2 | builtin_approximation | Modern digital | Process-dependent |
| Short-circuit power | 2 | builtin_approximation | CMOS switching | Small for slow edges |
| IR drop on supply rails | 2 | builtin_simple | PCB power planes | Ohm + KCL on power net |
| L·di/dt droop | 3 | warning_only + external_solver | Fast switching loads | PDN time-domain |
| Decoupling-cap behavior | 2 | builtin_simple | Decoupling networks | Impedance vs frequency |
| PDN impedance profile | 3 | external_solver | Whole-PDN analysis | Specialist sim |
| PDN resonances | 3 | external_solver | Plane-pair cavities | Field solver |

### Category 10 — Reliability + aging

Lifetime warnings, never simulation. *"This might work today, but it is high-risk over time."*

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| Electromigration (Black's eqn) | 5 | warning_only | Wires, vias, bond wires | MTTF estimate from J, T |
| Time-dependent dielectric breakdown (TDDB) | 5 | warning_only | Thin oxides, dielectrics | Stress-time model |
| Hot carrier injection (HCI) | 5 | warning_only | NMOS at high Vds | Lifetime impact |
| NBTI / PBTI | 5 | warning_only | PMOS / NMOS gate stress | Vth shift over time |
| Soft errors (alpha, neutrons, cosmic) | 5 | warning_only | Memory cells, latches | FIT-rate estimates |
| ESD (HBM / MM / CDM) | 5 | builtin_simple + warning_only | All pins | Match component rating |
| Latch-up | 5 | warning_only | CMOS chips | Triggering conditions |

### Category 11 — Process variation

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| Component tolerances | 1 | builtin_simple | All parts | Already in materials.yaml `tolerance: {min, max}` |
| Process corners (FF / SS / TT / FS / SF) | 4 | external_solver | IC designs | PDK + ngspice Monte-Carlo |
| Random dopant fluctuation | 4 | external_solver | Sub-22nm transistors | Statistical PDK |
| Line-edge roughness | 4 | external_solver | Modern lithography | PDK |
| Etching, plating, drill variation (PCB) | 5 | warning_only | PCB fab tolerances | DFM range checks |

### Category 12 — PCB-specific physics

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| Dielectric constant εr (frequency-dependent) | 2 | builtin_simple → analytic function | Substrates | Already noted in FR4 entry; analytic upgrade per function-types pattern |
| Loss tangent tan δ | 2 | builtin_simple | Substrates | Materials data |
| Glass-weave / fiber-weave effect | 3 | warning_only | Differential pairs at high f | Trigger on diff-pair length |
| Copper surface roughness | 3 | builtin_approximation | High-f loss | Hammerstad / Huray model |
| Stack-up + plane capacitance | 2 | builtin_simple | Multi-layer PCBs | Closed form from geometry |
| Plane-pair cavity resonances | 3 | external_solver | Power/ground plane pairs | Field solver |

### Category 13 — Quantum effects (modern nodes)

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| Direct tunneling through thin gate oxide | 4 | external_solver | Sub-90nm CMOS | BSIM / PDK |
| Quantum confinement in narrow channels | 4 | external_solver | Sub-22nm FinFETs / GAA | Out of v1 scope (per CLAUDE.md) |
| Discrete-dopant statistics | 4 | external_solver | Modern transistors | Monte-Carlo PDK |

### Category 14 — Mechanical-electrical coupling

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| CTE mismatch → strain → parasitic shifts | 5 | warning_only | Multi-material assemblies | Already cited in solder_joint notes |
| Humidity affecting dielectrics | 2 | builtin_simple (data) + warning_only | PCB substrates | FR4 already notes 50% RH conditions |
| Vibration | 5 | warning_only | Mechanical environments | Application-domain |
| Solder-joint fatigue | 5 | warning_only | All SMT/THT joints | Already cited in solder_joint entry (IPC-9701B) |
| Warpage | 5 | warning_only | Large PCBs, panels | Manufacturing concern |

### Category 15 — Manufacturing + assembly realities (added)

DFM is the discipline. Rule checks + warnings; data routes to external (vendor APIs).

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| Solder paste behavior | 15-DFM | warning_only | Stencil + pad design | Volume + coverage rules |
| Tombstoning | 15-DFM | warning_only | Small SMT chips | Asymmetric thermal mass detection |
| Component placement tolerance | 15-DFM | builtin_simple | Assembly | Datasheet-driven |
| Reflow profile | 15-DFM | builtin_simple | SMT assembly | Already in parameters.yaml (`default_reflow_peak_temp`) |
| Thermal reliefs | 15-DFM | warning_only | Power-plane connections | Hand-soldering issue |
| Panelization | 15-DFM | info-only | Manufacturing ZIP | Layout concern |
| Min trace / space | 15-DFM | builtin_simple | PCB layout | Already in parameters.yaml (`default_trace_width_min`) |
| Min drill size | 15-DFM | builtin_simple | PCB vias | Already in parameters.yaml (`default_via_drill_min`) |
| Annular ring limits | 15-DFM | warning_only | Via design | Pad-vs-drill geometry |
| DFM / DFT rules generally | 15-DFM | builtin_simple (rule engine) | Whole design | Sprint 6 first cut |
| Part availability | 15-DFM | external_data | BOM | DigiKey / Mouser API (later) |
| Substitution risk | 15-DFM | warning_only | BOM management | Cross-reference tolerances |
| Connector mating cycles | 15-DFM | warning_only | Connector selection | Datasheet-driven lifecycle |

### Category 16 — Firmware / hardware interaction (added)

Constraint checks + warnings on the firmware/silicon boundary. AI generates firmware/docs; this validates the interface contract.

| Phenomenon | Tier | Solver | Applies to | Notes |
|---|---|---|---|---|
| GPIO drive limits | 16-Firm | builtin_simple | MCU pin parameters | Match LED/load to pin spec |
| Pin modes (input/output/analog/Hi-Z) | 16-Firm | builtin_simple | MCU + peripherals | State enumeration |
| Pull-ups / pull-downs | 16-Firm | builtin_simple | I2C, reset, level shifting | Matches FUTURE-CAPABILITIES topic from research arc |
| ADC input impedance | 16-Firm | builtin_simple | Analog inputs | Z_source vs Z_in matching |
| PWM frequency effects | 16-Firm | builtin_approximation | LED drive, motor control | Filter requirements |
| I²C / SPI / UART timing | 16-Firm | warning_only | Digital buses | Setup/hold checks |
| Interrupt timing | 16-Firm | warning_only | Real-time firmware | Latency estimates |
| Boot states | 16-Firm | warning_only | Power-on sequencing | Default pin states |
| Brownout behavior | 16-Firm | builtin_simple | Voltage rails | Threshold detection |
| Watchdog behavior | 16-Firm | warning_only | Firmware design | Documentation gen |
| Firmware-controlled power states | 16-Firm | builtin_simple | Low-power design | State enumeration |

---

## Tier-to-sprint mapping (rough horizon)

| Sprint window | What tier opens for first-cut support |
|---|---|
| S3–S6 | Tier 1 (core engine) + start of Tier 15-DFM (manufacturing ZIP skeleton) + start of Tier 16-Firmware (AI-generated docs) |
| S7–S9 | Tier 2 (first real behavior — RC/RL, thermal resistance, IR drop, decoupling, noise basics) |
| S10–S15 | Tier 3 (advanced PCB / high-speed, as warning_only first; external_solver later) + Tier 12 (PCB substrate functions) |
| S12+ | Tier 5 (reliability / aging warnings) running in parallel |
| S15+ | Tier 4 (semiconductor + MOSFET — simple educational model + ngspice/PDK handoff) + Tier 13 (quantum, via PDK only) |
| Ongoing | Tier 15-DFM rule engine + Tier 16-Firmware constraints as the AI side matures |

---

## `solver_level` enum — proposed schema addition

Today's [behaviors.schema.json](behaviors.schema.json) carries `id / label / law / parameters_required / evaluates / consequences / steady_state_behavior`. The proposed addition:

```yaml
- id: joule_heating
  label: "Joule heating (resistive dissipation)"
  law: joule
  parameters_required: [current, resistance]
  evaluates: "P = I^2 * R"
  consequences: [heats]
  steady_state_behavior: "Power dissipates as heat..."
  solver_level: builtin_simple                          # ← NEW
  applies_to: [wire, resistor, pcb_trace, contact]      # ← NEW (or as a separate cross-FK)
  inputs_required: [current, resistance]                # ← could merge with parameters_required
  outputs: [power_dissipation, temperature_rise]        # ← NEW
```

The `solver_level` field is the cleanest single addition. The other proposed fields (`inputs`, `outputs`, `applies_to`) are useful but more invasive — defer or fold into the existing structure when adopted.

**When to schema-change:** before Sprint 5 opens. The validator needs `solver_level` to know what to do with each behavior; without it, every behavior has to be inspected in code.

**ADR worth drafting:** "Behavior solver-level enum + validator dispatch contract" — pairs with the math-at-meaning-level decision from earlier. ADR-009 candidate.

---

## When to revisit this doc

- **Before any new behavior lands in `behaviors.yaml`** — check the category, confirm the tier tag, set the `solver_level` (once the schema enhancement lands).
- **At the start of each sprint** — scan the tier-to-sprint mapping; confirm scope matches the sprint plan.
- **When the validator adds a new solver strategy** — update the `solver_level` enum and re-tag affected entries.
- **When a phenomenon graduates** (e.g., from `warning_only` to `builtin_approximation`) — update the row and the Notes.
- **When the v1 vs v2 scope shifts** — currently CLAUDE.md says v1 is DC-only; if AC behaviors graduate to v1, tier-mapping shifts.

---

## What this doc does NOT do

- It does not enumerate every device parameter — that's [devices.yaml](devices.yaml) (Sprint 3) and the per-device parameters list.
- It does not lock specific equations — equations live in `behaviors.yaml` (declared symbolically) and the validator code (implemented as tested functions).
- It does not promise that every phenomenon will be supported in v1 — many sit at Tier 3-5 explicitly to defer.
- It does not replace the Sprint plan docs — those carry the sprint-specific scope and done criteria. This is the long-horizon map.
- It does not list every external tool ChipBlocks might route to — Yosys, KiCad, ngspice, BSIM, foundry PDKs are noted as solver destinations; the integration contracts come when the routing is built.
- It is not a citation source itself — the canonical references for each phenomenon live in textbooks (Sze, Razavi, Johnson & Graham *High-Speed Digital Design*, etc.) and standards (IPC, IEEE, JEDEC). When a behavior lands in `behaviors.yaml`, cite the canonical reference for *that* phenomenon in the source field per [MATERIAL-SOURCES.md](MATERIAL-SOURCES.md) discipline.
