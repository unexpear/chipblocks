# Auto-router research — how to make wire routing look *organized*

> Research notes, 2026-06-26. Triggered by the 10-digit calculator rendering as a ~260-wire tangle even
> with the first "global router." Goal: a router that produces clean, breadboard-style orthogonal wiring —
> straight runs, evenly-spaced parallel tracks, tidy T-junctions, routed *around* parts. This is the
> reference for the rebuild; it records what real tools do and the algorithm we will implement (our own,
> for license reasons — see §4).

## 1. The problem with the first attempt

The first `routeAllWires` used a **uniform grid + congestion cost** (A\* on a fixed-step lattice, a cell's
cost rising with how many wires already use it). It *converges* and it *spreads* wires, but it does not
look *organized*:

- A fine uniform grid **stair-steps** — many tiny bends instead of long straight runs.
- Congestion **scatters** wires; it never **nudges** them into evenly-spaced, centered parallel tracks.
- Every wire routes independently — no shared **trunks** / **T-junctions** for same-net wires.
- It bypassed the neatness machinery we already had (`gridRouteAround`'s Hanan-grid A\*, the clean L/Z/
  detour shapes, lane offsets, the junction/crossing overlay).

## 2. What real tools do — Orthogonal Connector Routing (OCR)

The standard approach for diagram/circuit connectors (libavoid → Inkscape/Dunnart, Eclipse ELK, JointJS),
designed explicitly for "drawings representing electrical circuits." Three stages
([Wybrow, Marriott & Stuckey, *Orthogonal Connector Routing*, GD 2009][ocr09];
[Marriott, Stuckey & Wybrow, *Seeing Around Corners*, 2014][soc14]):

1. **Orthogonal visibility graph** (NOT a uniform grid). Project horizontal + vertical lines from **every
   part corner and pin**; nodes are the intersections, edges connect nodes that can "see" each other
   orthogonally. Routes ride these lines, so **segments are long and straight**. The 2014 follow-up uses a
   **1-bend visibility graph** (an edge exists iff two points are connectable with a single bend) and
   **obstacle-hugging** canonical routes — far fewer nodes, much faster, and routes prefer to **hug**
   parts and run down the **center of "alleys."**

2. **A\* with a heavy *bend* penalty.** Cost = length **+ (large weight × number of bends)**. Minimizing
   *bends*, not just distance, is what produces clean L/Z shapes.

3. **Nudging — the step that makes it look organized.** Take all wires sharing a channel and:
   order them to avoid needless crossings, **space them evenly apart**, push crossings to the **ends** of
   shared segments, and **center the bundle down the middle of the alley.** Done either by **linear
   programming** (balance the inter-wire gaps) or **iterative track-assignment** (each segment gets a
   track in its channel; a conflict bumps a segment to the next track). *No tool looks clean without this.*

**Junctions.** Same-net wires do not run as separate parallels — they share a **trunk** and connect with
**T-junctions** auto-placed at the branch points ([Altium buses & junctions][altium]).

## 3. What EDA / PCB routers add

[EDA routing][eda] does **coarse global route → detailed route**, with **rip-up-and-reroute** (pull the
worst wires and redo them). KiCad's [interactive push-and-shove router][kicad] adds **walk-around** (hug
obstacles), **shove** (push other traces aside), and **trace smoothing** afterward. Transferable for us:
**walk-around + post-route smoothing + rip-up-reroute** to clean up the stragglers.

## 4. Reuse or build? — license

A ready WebAssembly port exists — **[libavoid-js][libavoidjs]** — but [Adaptagrams/libavoid is
**LGPL-2.1**][adaptagrams]. That is **off our license whitelist** (MIT / Apache-2.0 / BSD / ISC / CC0 /
MPL-2.0 only — no LGPL bundling per CLAUDE.md). The **algorithm is published and free to implement**, so
we write our **own** from the papers (clean-room). No libavoid code or binary ships.

## 5. The plan for ChipBlocks

We already had the right foundation and the first global router detoured off it. The rebuild:

1. **Route on the visibility graph** — reuse `gridRouteAround` (already a Hanan/visibility-graph A\*); add
   a **heavy bend penalty** so runs stay straight and corners are few. (Raise its node cap / share one
   graph across the batch; consider the 1-bend graph from §2 if the full Hanan grid is too big.)
2. **Nudging pass** (the new piece, the neatness): group the routed segments sharing each channel, order
   them, **space them evenly**, and **center the bundle in the alley**. Pure geometry on the routed paths
   — shifting a horizontal run to a new track is just moving its two endpoints' `y`; the perpendicular
   connectors stretch to follow, so the path stays orthogonal.
3. **Same-net trunks + T-junctions** — route shared nets as a trunk and drop our existing junction dots at
   the branches (reuse the crossing/junction machinery in `net-edge.tsx`).
4. **Rip-up-reroute / walk-around** polish for the few that still collide.

Keep the live-canvas integration that already converges (`GlobalRoutesContext`, the endpoint-keyed
debounced route pass in `App`); only the routing *brain* (`routeAllWires`) is replaced.

## Sources

- [Orthogonal Connector Routing — Wybrow, Marriott, Stuckey, GD 2009][ocr09]
- [Seeing Around Corners: Fast Orthogonal Connector Routing — Marriott, Stuckey, Wybrow, 2014][soc14]
- [libavoid (Adaptagrams) overview][adaptagrams] · [libavoid-js (npm, LGPL)][libavoidjs] · [libavoid in Eclipse ELK][elk]
- [Routing (electronic design automation) — Wikipedia][eda]
- [KiCad interactive (push-and-shove) router docs][kicad]
- [Altium — buses, signal harnesses & auto-junctions][altium]

[ocr09]: https://users.monash.edu/~mwybrow/papers/wybrow-gd-2009.pdf
[soc14]: https://users.monash.edu/~mwybrow/papers/marriott-diagrams-2014.pdf
[adaptagrams]: https://www.adaptagrams.org/documentation/libavoid.html
[libavoidjs]: https://www.npmjs.com/package/libavoid-js
[elk]: https://eclipse.dev/elk/blog/posts/2022/22-11-17-libavoid.html
[eda]: https://en.wikipedia.org/wiki/Routing_(electronic_design_automation)
[kicad]: https://github.com/KiCad/kicad-doc/blob/master/src/pcbnew/pcbnew_interactive_router.adoc
[altium]: https://www.altium.com/documentation/altium-designer/schematic/buses-signal-harnesses
