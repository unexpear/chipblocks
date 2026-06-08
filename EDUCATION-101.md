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
