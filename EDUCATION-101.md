# Education 101

Beginner-level, plain-language fundamentals for ChipBlocks — seed content for the
classes/lessons we'll build later. Everything here is kept simple but physically
correct.

> **⚠️ Editing rule (for the AI assistant / any future session):** This file is
> updated **only when the project lead explicitly asks.** Do **not** add, expand,
> reorder, or rewrite anything here on your own initiative — wait to be asked, and
> change only what's requested.

---

## What is a circuit?

A **circuit** is a **closed loop that carries electricity.**

For electricity to flow, the loop has to be **complete** — out of the source (for
example, a battery's **+** terminal), through the wires and parts, and back to the
source's **−** terminal.

- If the loop is **closed** (unbroken all the way around), current flows.
- If the loop is **open** (broken anywhere — a missing wire, an open switch, a
  gap), **no current flows.** Everything reads **0 amps.**

A simple circuit needs three things:

- a **source** that pushes the electricity (e.g. a battery),
- a **path** for it to travel (wires),
- and usually a **load** — something that uses the energy (a resistor, an LED).

---

## Source (where the electricity comes from)

The **source** is whatever **pushes the electricity** around the circuit — it provides
the **voltage** (the push) that drives the current. Every circuit needs one.

Two everyday kinds:

- **A battery** — stores energy chemically and gives steady **DC** (current flows one
  direction). It comes in many voltages and sizes: a 1.5 V AA, a 3 V coin cell, a 9 V
  block.
- **Wall power** — the **mains** from a wall outlet. It's **AC** (the direction keeps
  switching) at a high voltage. Most electronics can't use that directly, so a plug-in
  **adapter** (the brick on a charger) turns it into the low, steady **DC** the circuit
  actually runs on.

So a battery and wall power are really two kinds of the **same thing** — a source of
electrical push. That's why ChipBlocks can treat the source as **one configurable
part** (a **Source**): you pick what kind it is and its voltage, instead of being stuck
with a battery-only block.

In ChipBlocks: the **Source** is the push every voltage in the solve is built around.
The solver is **DC** today, so its sources supply steady DC — a battery, or a wall
adapter that has already turned the wall's AC into DC. Genuine AC-mains behavior
arrives with the later transient simulation.

---

## What is current?

**Current** is the **flow of electric charge** — how much charge moves past a point,
and how fast.

- It only flows in a **closed loop** (see above).
- **Conventional current** is defined as the direction **positive** charge flows:
  out of the battery's **+** terminal, around the circuit, and back into the **−**
  terminal. (This convention was chosen before electrons were discovered. The
  electrons themselves actually drift the *opposite* way, but by convention we draw
  and talk about current as flowing **+ → −** through the circuit.)
- More charge flowing per second = more current.

---

## Direct current (DC) and alternating current (AC)

Current comes in two kinds, depending on **which way it flows:**

- **DC (direct current)** — the current flows the **same way all the time:** one
  steady direction, like a constant push. **Batteries give DC.**
- **AC (alternating current)** — the current keeps **switching direction,** back and
  forth. **Wall outlets give AC.**

That's why a plug-in device has an adapter: it turns the wall's **AC** into the **DC**
the electronics inside actually run on.

In ChipBlocks: the simulator solves **DC** circuits today — steady current in one
direction, the kind a battery drives. AC (current that changes over time) belongs to
the later "transient" simulation we'll add down the road.

---

## Voltage — and how it differs from current

**Voltage** is the **"push"** — the electrical pressure that drives current around
the loop. It's the energy the source gives to each bit of charge. Measured in
**volts (V)**.

The easiest way to feel the difference is the **water analogy:**

|            | Electricity         | Water                     |
| ---------- | ------------------- | ------------------------- |
| **Voltage** | the push / pressure | the water pressure        |
| **Current** | the flow that push causes | the flow rate of water |
| **Resistor** | limits the flow   | a narrow section of pipe  |

The key differences:

- **Voltage is the push; current is the flow that push causes.** No push (0 V) → no
  flow. More push → more flow (for the same resistance).
- **Voltage is measured _across_ two points** — it's the *difference* between them
  (across a battery, across a resistor). **Current is measured _through_ a part** —
  the flow passing through it.
- **You can have voltage with no current.** An open (broken) circuit still has the
  battery's full voltage waiting at its terminals — there's pressure, but no complete
  path, so nothing flows (0 A). You generally can't have current without a voltage
  driving it.
- **Ohm's law ties them together:** voltage = current × resistance (**V = I × R**).
  More voltage pushes more current; more resistance lets through less.

In ChipBlocks: the simulator solves for **both** — the **voltage** at every point in
the circuit *and* the **current** through every part — because you need both to know
what a circuit is doing.

---

## Ground (the 0 V reference)

**Ground is the point you agree to call 0 volts** — the "sea level" that every other
voltage in the circuit is measured *from*.

Voltage is always a **difference** between two points (see above). So before you can
say "this point is at 5 V," you first have to pick one point as **zero**. That zero
point is **ground**.

- It's **not** the same as the battery's +/−. The **+** and **−** are the *source*
  (the push); **ground** is the *reference* (the zero you measure from). Two different
  jobs.
- In a simple one-battery circuit, the battery's **−** terminal *is* the natural
  ground — everything is measured relative to it, so it sits at 0 V.
- You mark a ground on purpose when it isn't obvious where zero should be — for example
  with **more than one battery**, or when you want 0 V pinned at a specific spot.
- Its schematic symbol is the little stack of shrinking horizontal lines.

In ChipBlocks: ground is the 0 V reference the solver measures every voltage from.
(Professional tools like SPICE and KiCad always need a ground/reference too, for
exactly this reason.)

---

## Resistance

**Resistance opposes the flow of current** — it's how much a part "pushes back"
against the current and slows it down. Measured in **ohms** (symbol **Ω**).

Back to the **water analogy:** resistance is a **narrow section of pipe.** A wide pipe
(low resistance) lets water flow easily; a pinched, narrow pipe (high resistance)
restricts it.

- **More resistance → less current** (for the same voltage). Less resistance → more
  current.
- This is the third piece of **Ohm's law**: from V = I × R, rearranged, **current =
  voltage ÷ resistance (I = V ÷ R)** — so bigger resistance means smaller current.
- **Everything resists a little** — even wires (just a tiny amount). A **resistor** is
  a part built to have a specific, controlled resistance, used to *deliberately* limit
  current. (An open circuit acts like *infinite* resistance — nothing flows; a perfect
  conductor would be *zero* resistance.)
- The energy the current loses to resistance turns into **heat** — that's why
  resistors and overloaded wires warm up.

**How size ties in:** the resistance of a wire (or any conductor) depends on its shape
and what it's made of:

- **Longer → more resistance.** A longer path is harder to push current through (a
  longer pipe has more wall to drag on). Twice as long ≈ twice the resistance.
- **Thicker → less resistance.** A fatter conductor gives the current more room (a
  wider pipe). Twice the cross-section area ≈ half the resistance.
- **Material matters.** For the same size, copper barely resists while nichrome
  resists a lot. That "how much the material itself resists" number is its
  **resistivity** (ρ).

Put together, that's the formula **R = ρ × L ÷ A** — resistance = resistivity ×
length ÷ thickness (cross-section area). It's why a long, thin wire has real resistance
and warms up, while a short, fat copper wire barely resists at all.

In ChipBlocks: this is exactly how a wire's (and a resistor's) resistance is computed —
pick the material + length + thickness and R = ρL/A falls out. The **resistor** is the
part you drop in to *deliberately* limit current (like the 470 Ω resistor that keeps an
LED at a safe ~15 mA). Stretch a wire longer or thinner and watch its resistance — and
its voltage drop — climb.

---

## Short circuit

A **short circuit** is a **faster, easier path straight back to the battery** that
**skips the parts** you wanted the current to flow through. Because almost nothing
slows it down (very little resistance), a **huge current** rushes through — usually
something you **don't** want: it drains the battery fast and can overheat wires and
parts.

It's the flip side of resistance: the load you meant the current to flow through is
gone, so by **I = V ÷ R** with R near **zero**, the current shoots up toward huge. (A
**closed loop isn't always a _good_ loop** — a short is a closed loop too, just the
wrong one.)

In ChipBlocks: a short is just a **near-zero-resistance path**, so the solver computes
a very large current through it — and the **safety checks flag that overcurrent** (the
same way they catch an LED being overdriven).

---

## Amps (amperes)

The **ampere** (symbol **A**), or "amp," is the **unit of current** — how we measure
how much is flowing.

- **1 ampere = 1 coulomb of charge flowing past a point every second.** (A coulomb
  is a fixed, large amount of electric charge.)
- Smaller everyday units:
  - **milliamp (mA)** = one-thousandth of an amp (1/1,000 A)
  - **microamp (µA)** = one-millionth of an amp (1/1,000,000 A)
  - A typical small indicator LED runs at about **20 mA** (0.02 A).

In ChipBlocks: the simulator computes the current (in amps) through **every** part
and **every** wire, and shows it to you — and it correctly drops to **0** anywhere
the loop isn't closed.

---

## Hole current (what actually carries the current)

Electric current is carried by tiny charge **carriers**. In a metal wire, those are
**electrons** (negative charge). But in a **semiconductor** — the material inside an
LED, a diode, or a chip — there are **two** kinds of carriers:

- **Electrons** — negative charge.
- **Holes** — a "missing electron" in the material that behaves like a **positive**
  charge moving the other way.

So in a semiconductor, the **total current = electron current + hole current.**

In a **PN junction** (the heart of a diode or LED), holes flow in from the p-side and
electrons flow in from the n-side. They meet in the middle and **recombine** — and in
an LED, each recombination can release a **photon** (that's the light!).

In ChipBlocks: we model the **total** current — what you'd actually measure at a
part's terminals. The electron part and the hole part are **folded together** into
that single total; we don't split them out, because circuit-level analysis only needs
the total. (Splitting them apart is *device physics* — a deeper "look inside the
part" view that classes can explore later on.)
