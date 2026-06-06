# Sprint 19 — Make the canvas read like a real circuit

> **Status: open (2026-06-06).** Sprint 18 landed the canvas: standard symbols, real
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
