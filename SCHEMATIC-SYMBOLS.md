# SCHEMATIC-SYMBOLS.md

> **Status:** Research notes for the eventual canvas. Captures the design commitment to use **standard schematic shorthand** as the visual layer, plus a reference inventory of the common symbols and the international (IEC 60617) vs US (IEEE 315) differences. **Last verified 2026-05-20.**
>
> Not yet a decision-implementation doc — when the canvas lands (v3 canvas sprint), the actual `symbol:` field on device definitions and the symbol-library integration get designed against this reference. See [OBJECT-MODEL.md](OBJECT-MODEL.md) §15 ("Visual symbol library") for the deferred design question.

---

## Why standard symbols

When a circuit is drawn on paper, an electrical engineer reads it instantly:

- Zigzag with two leads → resistor
- Two parallel lines → capacitor
- Triangle pointing at a bar → diode
- Triangle pointing at a bar with two outward arrows → LED

These are **the shorthand of the field**, not stylistic icons. Custom invented icons would force an audience that already reads circuits to re-learn what a resistor looks like. **The canvas uses standard schematic symbols** — no novel icons, no decorative graphics, no photo-realistic component renderings.

This is consistent with the [OBJECT-MODEL.md Design priority section](OBJECT-MODEL.md): correctness-first, usability-aware. Standard symbols *are* the usability hook for the engineering audience; inventing icons would be the anti-pattern.

---

## The two standards

| Standard | Maintained by | Region | Visual style |
|---|---|---|---|
| **IEC 60617** | International Electrotechnical Commission | International (most of the world) | Rectangle-style: rectangle resistors, rectangle-with-bumps inductors |
| **IEEE 315** (with ANSI Y32.2-1975) | IEEE | US, Canada | Zigzag-style: zigzag resistors, loop-style inductors |

Both are widely used; both are valid. The Wikipedia article on Electronic symbols notes the tension explicitly: *"The standards do not all agree, and use of unusual (even if standardized) symbols can lead to confusion and errors."* — which is exactly why we shouldn't invent a third convention.

### KiCad as the de facto implementation

KiCad (the open-source EDA tool) ships both styles. The default library uses zigzag-style (IEEE-derived), and explicit `_IEEE` variant libraries exist alongside conventional ones. Library names are organized by component family (`Device`, `Diode`, `Switch`, `Transistor_BJT`, etc.).

- **Active library home:** [gitlab.com/kicad/libraries/kicad-symbols](https://gitlab.com/kicad/libraries/kicad-symbols)
- **Older GitHub mirror:** [github.com/KiCad/kicad-symbols](https://github.com/KiCad/kicad-symbols) — **archived 2020-10-02**, read-only. The project moved to GitLab.

Anchoring on KiCad's library names (when the `symbol:` field eventually lands on device definitions) makes export-to-KiCad nearly free.

---

## Symbol inventory

The visual conventions for components in the project's likely device set. Both styles described; both should be supported (probably per-project preference, default likely IEEE/KiCad style).

| Component | IEC 60617 (international) | IEEE 315 / ANSI (US / KiCad default) | KiCad library family |
|---|---|---|---|
| **Wire** | A simple line | A simple line | n/a (lines, not symbols) |
| **Wire crossing (insulated)** | Semicircle "jump" (paper) / direct crossing (CAD) | Same; convention varies | n/a |
| **Wire junction** | Dot at the meeting point | Same | n/a |
| **Resistor** | Rectangle with two leads | Zigzag with two leads | `Device` (R) |
| **Capacitor — non-polarized** | Two parallel lines | Two parallel lines | `Device` (C) |
| **Capacitor — polarized (electrolytic)** | One curved line + one straight line | One straight line marked with + / − | `Device` (C_Polar) |
| **Inductor** | Rectangle with internal bumps (or row of half-circles) | Series of loops or semicircles | `Device` (L) |
| **Diode** | Triangle pointing at a bar (cathode line) | Triangle pointing at a bar | `Diode` (D) |
| **LED** | Diode + two arrows pointing outward (emitting light) | Diode + two arrows pointing outward | `Diode` (LED) |
| **Switch — SPST** | Line with a break + hinged contact (open / closed) | Same | `Switch` (SW_SPST) |
| **Battery — single cell** | One long line + one short parallel line | Same | `Device` / `Battery` |
| **Battery — multi-cell** | Alternating long / short lines | Same | `Device` / `Battery` |
| **Ground (earth)** | Stack of horizontal lines decreasing in length downward | Same | n/a (special) |
| **Chassis ground** | Angled hatched lines | Same | n/a (special) |
| **NPN transistor** | Two leads + emitter arrow pointing out, optional circle | Same shape; circle optional | `Transistor_BJT` (Q_NPN_*) |
| **PNP transistor** | Same as NPN but emitter arrow points in | Same | `Transistor_BJT` (Q_PNP_*) |
| **N-channel MOSFET** | Three terminals + arrow on body | Same | `Transistor_FET` |
| **P-channel MOSFET** | Same with arrow reversed | Same | `Transistor_FET` |
| **AC voltage source** | Circle with sine wave inside | Same | `Simulation_SPICE` / `Device` |
| **DC voltage source** | Circle with + and − | Same | `Device` |

---

## What this looks like in the object model (when it lands)

When the canvas sprint opens, the proposed mechanism (from OBJECT-MODEL.md §15 visual-symbol-library deferred row):

```yaml
# In a device definition (future)
kind: primitive_device
id: resistor
...
symbol:
  iec_60617: resistor_rectangle      # IEC style
  ieee_315: resistor_zigzag          # US style
  kicad_library: Device              # for KiCad export interop
  kicad_symbol: R                    # specific symbol within that library
```

Exact field shape deferred. The principle is: definitions name standard-symbol IDs from a known library; the canvas renders accordingly; export to KiCad becomes a matter of mapping the named symbol.

---

## Why support both IEC and IEEE styles, not pick one

1. **Audience.** Users from Europe / Asia read IEC; users from US / Canada read IEEE. Forcing one alienates half the audience.
2. **Tool interop.** KiCad ships both; other EDA tools (Altium, Eagle, OrCAD) use one or the other. Supporting both makes export-to-existing-EDA frictionless.

The project's per-project preference is a future decision. Likely default: IEEE 315 / KiCad style (the most common in open-source EDA today). Users switchable.

---

## Out of scope

- **Custom symbol authoring** (drawing new symbols from scratch) — deferred indefinitely; standard library symbols come first
- **Animated symbols, 3D component models, photo-realistic component renderings** — none of these are schematic conventions; canvas stays schematic
- **Layout-style component shapes (PCB footprints)** — a different concern, covered by the manufacturing / DFM tier in [PHYSICS-COVERAGE-MAP.md](PHYSICS-COVERAGE-MAP.md) category 15
- **Hierarchical sheet / sub-circuit visual** — beyond primitive-device symbols; eventual canvas concern, not a Layer 0–4 modeling concern

---

## When to revisit

- **Before the v3 canvas sprint** — re-verify the KiCad symbol library URL + current default convention; this doc is a snapshot, not a frozen spec
- **When the `symbol:` field lands on device definitions** — formalize the exact field shape and the library-ID convention
- **When export-to-KiCad becomes a real feature** — verify the symbol IDs we adopted round-trip cleanly through KiCad's library system
- **Quarterly** — re-check that the GitLab library URL is still active

---

## Verified sources (2026-05-20)

- [KiCad symbol library — archived GitHub mirror](https://github.com/KiCad/kicad-symbols) — archived 2020-10-02; cites the GitLab move
- [KiCad symbol library — active GitLab home](https://gitlab.com/kicad/libraries/kicad-symbols) — current canonical
- [Wikipedia — Electronic symbol](https://en.wikipedia.org/wiki/Electronic_symbol) — overview of common symbols + IEC vs IEEE differences; quoted in the standards-tension section above

## Standards referenced (not directly fetched this pass)

- **IEC 60617** — international graphical symbols for diagrams. Maintained as an online database by IEC at [webstore.iec.ch](https://webstore.iec.ch/) (specific publication number varies by version).
- **IEEE 315-1975** + **ANSI Y32.2-1975** — US schematic symbol conventions. Older standards, both technically withdrawn from active maintenance, but still the de facto US convention and what KiCad's defaults derive from.
