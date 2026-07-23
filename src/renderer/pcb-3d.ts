import { fabricationBounds } from './footprint.ts'
import type { Board, Recess } from './pcb-board.ts'
import { footprintByPlacement, placePoint } from './pcb-board.ts'
import type { BoardRouting, CopperLayer } from './pcb-route.ts'
import type { Stackup, StackupLayer } from './pcb-stackup.ts'

/**
 * A from-scratch, TO-SCALE 3-D renderer for the PCB — the real board in real space, the way a CAD
 * program shows it, built without any 3-D library (the same from-scratch stance as the solvers, the
 * Gerber writer and the FFT). Everything is in REAL millimetres: the board is a solid FR4 slab at its
 * true finished thickness (1.6 mm), the copper sits on its real top and bottom surfaces, and vias are
 * real barrels through the board. Nothing is exaggerated — what you orbit is the board's true geometry.
 *
 * The pipeline is the classic one: world geometry (mm) → an orbit camera (azimuth / elevation /
 * distance) → a perspective projection → screen. Faces are painter-sorted by their centroid depth;
 * because the bare board is a convex slab, sorting its six faces by depth is exact, and each surface's
 * copper/silk artwork is drawn attached to (immediately after) its own face, so it is shown only when
 * that face is toward the camera — correct occlusion without a per-pixel depth buffer.
 */

export type Vec3 = { x: number; y: number; z: number }

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const norm = (a: Vec3): Vec3 => {
  const m = Math.hypot(a.x, a.y, a.z) || 1
  return { x: a.x / m, y: a.y / m, z: a.z / m }
}

/** A flat filled polygon in world space (mm) — a face of a solid, or a piece of surface artwork. */
export type Poly = { verts: Vec3[]; color: string }
/**
 * A solid face plus the coplanar artwork (copper, silk) that rides on it, drawn right after it.
 * `doubleSided` skips back-face culling (a thin floating sheet — a separated copper layer — is seen
 * from both sides); `alpha` draws the face translucent (the faint layer planes in the exploded view).
 */
export type Face = {
  verts: Vec3[]
  color: string
  decals: Poly[]
  doubleSided?: boolean
  alpha?: number
}

/** The coordinate reference drawn on the ground plane (z=0): the mm grid, the x/y axes through the
 *  origin, and the quadrant / axis labels — our coordinate system, in real 3-D. */
export type GridRef = {
  lines: { a: Vec3; b: Vec3; axis: boolean }[]
  labels: { at: Vec3; text: string }[]
}

export type Scene = {
  faces: Face[]
  center: Vec3
  /** The board's 3-D diagonal in mm — used to frame the default camera. */
  diagonal: number
  /** The z-height (mm) of EVERY copper layer's surface — where a routing click on that layer lands.
   *  Assembled: top = board thickness, bottom = 0, inner layers at their true buried mid-height in the
   *  slab. Exploded: the separated slabs' copper surfaces. Inner keys are present only when the board
   *  actually has those layers (4-/6-layer); top and bottom are always present. */
  copperZ: { top: number; bottom: number } & Partial<Record<CopperLayer, number>>
  /** The coordinate grid (present when built with showGrid). */
  grid?: GridRef
}

export type OrbitCamera = {
  /** Rotation around the board's up (Z) axis, degrees. */
  azimuthDeg: number
  /** Tilt above the board plane, degrees (90 = straight down). */
  elevationDeg: number
  /** Camera distance from the target, mm. */
  distance: number
  /** Look-at point (board centre), mm. */
  target: Vec3
  /** Perspective field of view, degrees. */
  fovDeg: number
}

const COLORS = {
  fr4: '#0c3a24', // the board EDGE (bare FR4 laminate)
  maskTop: '#0e5836', // green soldermask over the copper planes
  maskBottom: '#0b4a2d',
  core: '#116a42', // the FR4 dielectric core slab (opaque) in the exploded stack
  copper: '#d7a13c', // gold — real tinned/ENIG-ish copper, both sides (the blue is a 2-D EDA convention)
  copperEdge: '#8a6321',
  silk: '#eef0f2',
  body: '#242932', // component body — near-black plastic (ICs, chip resistors, headers)
  pin: '#c2c6cd', // metal pins (tin-plated header posts)
} as const

const LIGHT = norm({ x: -0.35, y: -0.45, z: 0.82 }) // upper-front light for the shading
const GRID_COLOR = '#6b8fc0' // the coordinate ground grid + axes (matches the flat view's axes)

/** The board's true finished thickness (mm) from the stack-up. */
function boardThicknessMm(stackup: Stackup): number {
  return stackup.layers.reduce((sum, l) => sum + l.thicknessMm, 0)
}

/** Map a stack-up copper layer's name (F.Cu / In1.Cu … / B.Cu, per buildStackup) to its CopperLayer. */
function stackupCopperLayer(name: string): CopperLayer | null {
  switch (name) {
    case 'F.Cu':
      return 'top'
    case 'In1.Cu':
      return 'inner1'
    case 'In2.Cu':
      return 'inner2'
    case 'In3.Cu':
      return 'inner3'
    case 'In4.Cu':
      return 'inner4'
    case 'B.Cu':
      return 'bottom'
    default:
      return null
  }
}

/** Turn a footprint-local rectangle (centre + half extents) into its four board-space corners at z. */
function padCornersAtZ(
  pl: Board['placements'][number],
  center: { x: number; y: number },
  w: number,
  h: number,
  z: number,
): Vec3[] {
  const hw = w / 2
  const hh = h / 2
  const local = [
    { x: center.x - hw, y: center.y - hh },
    { x: center.x + hw, y: center.y - hh },
    { x: center.x + hw, y: center.y + hh },
    { x: center.x - hw, y: center.y + hh },
  ]
  return local.map((c) => {
    const b = placePoint(pl, c)
    return { x: b.x, y: b.y, z }
  })
}

/**
 * The thinnest a layer is DRAWN in the exploded stack-up (mm). Real copper is ~0.035 mm and solder mask
 * ~0.01 mm — next to a 1.51 mm core those are sub-pixel, so the stack reads as sheets of paper with only
 * the core having any depth. The exploded view is a stack-up DIAGRAM (its layers are already separated by
 * gaps that do not exist on the real board), so every layer is drawn at least this thick to make the
 * lamination legible. The ASSEMBLED view stays exactly to scale, and the true per-layer thickness is what
 * the stack-up panel and the fab files carry — nothing here changes a manufactured number.
 */
export const MIN_EXPLODED_LAYER_MM = 0.12

/**
 * Extrude a flat polygon (its own z ignored) into a solid prism z0..z1 — how a copper trace, pad ring or
 * via cap gets real thickness instead of being an infinitely thin decal. Double-sided: these are small
 * slabs seen from any angle in the exploded stack.
 */
function pushPrism(faces: Face[], base: Vec3[], z0: number, z1: number, color: string): void {
  if (base.length < 3) return
  const top = base.map((v) => ({ x: v.x, y: v.y, z: z1 }))
  const bot = base.map((v) => ({ x: v.x, y: v.y, z: z0 }))
  faces.push({ verts: top, color, decals: [], doubleSided: true })
  faces.push({ verts: [...bot].reverse(), color, decals: [], doubleSided: true })
  for (let i = 0; i < base.length; i++) {
    const j = (i + 1) % base.length
    const b0 = bot[i]
    const b1 = bot[j]
    const t1 = top[j]
    const t0 = top[i]
    if (!b0 || !b1 || !t1 || !t0) continue
    faces.push({ verts: [b0, b1, t1, t0], color, decals: [], doubleSided: true })
  }
}

/** A trace segment as a flat copper ribbon of the trace width, at surface height z. */
function ribbonSegment(
  a: { x: number; y: number },
  b: { x: number; y: number },
  widthMm: number,
  z: number,
): Vec3[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const px = (-dy / len) * (widthMm / 2)
  const py = (dx / len) * (widthMm / 2)
  return [
    { x: a.x + px, y: a.y + py, z },
    { x: b.x + px, y: b.y + py, z },
    { x: b.x - px, y: b.y - py, z },
    { x: a.x - px, y: a.y - py, z },
  ]
}

/** A regular n-gon disk (approximating a circle) centred at (cx,cy) at height z. */
function disk(cx: number, cy: number, r: number, z: number, sides = 12): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i < sides; i++) {
    const t = (i / sides) * Math.PI * 2
    out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t), z })
  }
  return out
}

/**
 * Extrude a 4-corner base (board-space XY) from z0 to z1 as a closed box (top, bottom, 4 sides) with
 * outward-facing winding — used for component bodies and header pins. Colour is one per box; the flat
 * shading differentiates the faces by their angle to the light.
 */
function pushBox(
  faces: Face[],
  corners: { x: number; y: number }[],
  z0: number,
  z1: number,
  color: string,
): void {
  if (corners.length < 4) return
  const b = corners.map((p) => ({ x: p.x, y: p.y, z: z0 }))
  const t = corners.map((p) => ({ x: p.x, y: p.y, z: z1 }))
  const [b0, b1, b2, b3] = b
  const [t0, t1, t2, t3] = t
  if (!b0 || !b1 || !b2 || !b3 || !t0 || !t1 || !t2 || !t3) return
  faces.push({ verts: [t0, t1, t2, t3], color, decals: [] }) // top (+z)
  faces.push({ verts: [b3, b2, b1, b0], color, decals: [] }) // bottom (−z)
  faces.push({ verts: [b0, b1, t1, t0], color, decals: [] })
  faces.push({ verts: [b1, b2, t2, t1], color, decals: [] })
  faces.push({ verts: [b2, b3, t3, t2], color, decals: [] })
  faces.push({ verts: [b3, b0, t0, t3], color, decals: [] })
}

/**
 * A full-board-outline slab from z0 to z1 (a stack-up layer in the exploded view). The TOP face carries
 * any copper/silk decals. `alpha` makes it translucent (thin mask/copper sheets you can see through) and
 * then draws all faces (double-sided) so the translucency reads through the box.
 */
function addSlab(
  faces: Face[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z0: number,
  z1: number,
  color: string,
  topDecals: Poly[],
  alpha?: number,
): void {
  const b00 = { x: x0, y: y0, z: z0 }
  const b10 = { x: x1, y: y0, z: z0 }
  const b11 = { x: x1, y: y1, z: z0 }
  const b01 = { x: x0, y: y1, z: z0 }
  const t00 = { x: x0, y: y0, z: z1 }
  const t10 = { x: x1, y: y0, z: z1 }
  const t11 = { x: x1, y: y1, z: z1 }
  const t01 = { x: x0, y: y1, z: z1 }
  const extra = alpha !== undefined ? { alpha, doubleSided: true } : {}
  faces.push({ verts: [t00, t10, t11, t01], color, decals: topDecals, ...extra }) // top (+z)
  faces.push({ verts: [b01, b11, b10, b00], color, decals: [], ...extra }) // bottom
  faces.push({ verts: [b00, b10, t10, t00], color, decals: [], ...extra })
  faces.push({ verts: [b10, b11, t11, t10], color, decals: [], ...extra })
  faces.push({ verts: [b11, b01, t01, t11], color, decals: [], ...extra })
  faces.push({ verts: [b01, b00, t00, t01], color, decals: [], ...extra })
}

/** Merge overlapping [a,b] x-intervals (sorted, coalesced) — for tiling the surface around pockets. */
function mergeIntervals(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0])
  const out: [number, number][] = []
  for (const [a, b] of sorted) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/**
 * Tile a board surface into the frame quads that survive around a set of rectangular recesses — a slab
 * decomposition: split into horizontal bands at every recess y-edge, and in each band subtract the
 * active recesses' x-intervals from the full width. Handles any number of recesses; a recess touching
 * the board edge leaves no frame on that side (which is exactly what reads as a step).
 */
function frameStrips(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  recs: Recess[],
): { x0: number; y0: number; x1: number; y1: number }[] {
  const ys = [
    ...new Set(
      [y0, y1, ...recs.flatMap((r) => [r.y, r.y + r.h])].filter((y) => y >= y0 && y <= y1),
    ),
  ].sort((a, b) => a - b)
  const strips: { x0: number; y0: number; x1: number; y1: number }[] = []
  for (let i = 0; i + 1 < ys.length; i++) {
    const ya = ys[i]
    const yb = ys[i + 1]
    if (ya === undefined || yb === undefined || yb - ya < 1e-6) continue
    const active = recs.filter((r) => r.y <= ya + 1e-6 && r.y + r.h >= yb - 1e-6)
    const covered = mergeIntervals(
      active.map((r) => [Math.max(x0, r.x), Math.min(x1, r.x + r.w)] as [number, number]),
    )
    let cur = x0
    for (const [a, b] of covered) {
      if (a > cur + 1e-6) strips.push({ x0: cur, y0: ya, x1: a, y1: yb })
      cur = Math.max(cur, b)
    }
    if (cur < x1 - 1e-6) strips.push({ x0: cur, y0: ya, x1: x1, y1: yb })
  }
  return strips
}

/** Does a copper poly's bounding box overlap any recess (so that copper is milled away in the pocket)? */
function copperInRecess(verts: Vec3[], recs: Recess[]): boolean {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const v of verts) {
    minX = Math.min(minX, v.x)
    minY = Math.min(minY, v.y)
    maxX = Math.max(maxX, v.x)
    maxY = Math.max(maxY, v.y)
  }
  return recs.some((r) => maxX > r.x && minX < r.x + r.w && maxY > r.y && minY < r.y + r.h)
}

const RECESS_COPPER_LIFT_MM = 0.01 // surviving surface copper drawn a hair proud of the mask, so it paints on top

/**
 * Render a recessed board surface: the mask frame around the pockets, plus each pocket's four milled
 * walls + floor (bare FR4) at the controlled depth. `sign` = +1 for the top surface (the pocket cuts
 * DOWN from surfaceZ), −1 for the bottom (it cuts UP). Copper in a pocket is dropped (milled away); the
 * surviving copper is lifted a hair off the mask so it paints over the frame.
 */
function pushRecessedSurface(
  faces: Face[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  surfaceZ: number,
  recs: Recess[],
  maskColor: string,
  copper: Poly[],
  sign: 1 | -1,
  boardT: number,
): void {
  for (const s of frameStrips(x0, y0, x1, y1, recs)) {
    faces.push({
      verts: [
        { x: s.x0, y: s.y0, z: surfaceZ },
        { x: s.x1, y: s.y0, z: surfaceZ },
        { x: s.x1, y: s.y1, z: surfaceZ },
        { x: s.x0, y: s.y1, z: surfaceZ },
      ],
      color: maskColor,
      decals: [],
      doubleSided: true,
    })
  }
  for (const r of recs) {
    // the pocket floor, clamped inside the slab so a too-deep recess can't punch through the far side
    // (the UI already caps depth < thickness; this makes the engine safe for any input).
    const floorZ = Math.max(0.02, Math.min(surfaceZ - sign * r.depthMm, boardT - 0.02))
    const corners = [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ]
    faces.push({
      verts: corners.map((c) => ({ x: c.x, y: c.y, z: floorZ })),
      color: COLORS.fr4,
      decals: [],
      doubleSided: true,
    })
    for (let i = 0; i < 4; i++) {
      const p = corners[i]
      const q = corners[(i + 1) % 4]
      if (!p || !q) continue
      faces.push({
        verts: [
          { x: p.x, y: p.y, z: surfaceZ },
          { x: q.x, y: q.y, z: surfaceZ },
          { x: q.x, y: q.y, z: floorZ },
          { x: p.x, y: p.y, z: floorZ },
        ],
        color: COLORS.fr4,
        decals: [],
        doubleSided: true,
      })
    }
  }
  const liftedZ = surfaceZ + sign * RECESS_COPPER_LIFT_MM
  for (const poly of copper) {
    if (copperInRecess(poly.verts, recs)) continue
    faces.push({
      verts: poly.verts.map((v) => ({ x: v.x, y: v.y, z: liftedZ })),
      color: poly.color,
      decals: [],
      doubleSided: true,
    })
  }
}

/**
 * Build the board's real 3-D geometry from the derived board + routing + stack-up. All millimetres:
 * the FR4 slab at true thickness, the copper pads/traces on their real surfaces, and via barrels
 * through the board. `explodeMm` > 0 SPLITS the board into its real stack-up layers (F.Mask / F.Cu /
 * FR4 core / B.Cu / B.Mask), each a slab at its true thickness, separated in space with its own artwork.
 * `recesses` are controlled-depth pockets milled into the assembled board (cavity / stepped boards).
 */
export function buildBoardScene(
  board: Board,
  routing: BoardRouting,
  stackup: Stackup,
  explodeMm = 0,
  showGrid = false,
  recesses: Recess[] = [],
): Scene {
  const T = boardThicknessMm(stackup)
  const o = board.outline
  const x0 = o.x
  const y0 = o.y
  const x1 = o.x + o.w
  const y1 = o.y + o.h

  const exploded = explodeMm > 0

  // EXPLODED LAYOUT: place each real stack-up layer bottom→top, its own slab at its true thickness,
  // separated by explodeMm gaps (contiguous when explodeMm = 0 → the real board). Record the copper
  // layers' surface heights + the top of the stack (where the parts ride).
  type Placed = { name: string; type: StackupLayer['type']; z0: number; z1: number }
  const placed: Placed[] = []
  if (exploded) {
    let z = 0
    for (const L of [...stackup.layers].reverse()) {
      // Each layer is a SLAB of its own thickness — but drawn at least MIN_EXPLODED_LAYER_MM, or the
      // 0.035 mm copper and 0.01 mm mask vanish beside the 1.51 mm core and the stack reads as paper.
      const drawn = Math.max(L.thicknessMm, MIN_EXPLODED_LAYER_MM)
      placed.push({ name: L.name, type: L.type, z0: z, z1: z + drawn })
      z = z + drawn + explodeMm
    }
  }
  const layerTop = (name: string, fallback: number) =>
    placed.find((p) => p.name === name)?.z1 ?? fallback
  const topCuZ = exploded ? layerTop('F.Cu', T) : T // copper on the top-copper layer's surface
  const botCuZ = exploded ? layerTop('B.Cu', 0) : 0 // copper on the bottom-copper layer's surface
  const compBase = exploded ? (placed[placed.length - 1]?.z1 ?? T) : T // parts ride the top layer

  // The real surface height (mm) of EVERY copper layer the board has. Assembled: the outer copper sits
  // on the board's two faces (T / 0); an inner layer sits at its true buried mid-height inside the 0..T
  // slab. Exploded: each separated slab's copper surface (its z1). This is what puts an inner-layer
  // trace at its real depth instead of collapsing it onto the bottom.
  const copperZByLayer = new Map<CopperLayer, number>()
  if (exploded) {
    for (const p of placed) {
      const cl = stackupCopperLayer(p.name)
      if (cl !== null) copperZByLayer.set(cl, p.z1)
    }
  } else {
    let z = T
    for (const L of stackup.layers) {
      const zHi = z
      const zLo = z - L.thicknessMm
      if (L.type === 'copper') {
        const cl = stackupCopperLayer(L.name)
        if (cl !== null) {
          copperZByLayer.set(cl, cl === 'top' ? T : cl === 'bottom' ? 0 : (zHi + zLo) / 2)
        }
      }
      z = zLo
    }
  }
  const zOfLayer = (l: CopperLayer): number =>
    copperZByLayer.get(l) ?? (l === 'bottom' ? botCuZ : topCuZ)
  // The copper layers the board actually has, in stack order (top → inner → bottom) — a plated
  // through-via and a through-hole pad put copper on every one of them.
  const boardCopperLayers = [...copperZByLayer.keys()]

  // Copper artwork bucketed PER LAYER (traces + pad rings + via caps) at each layer's real height —
  // exactly the copper that layer's Gerber carries, so the 3-D board matches the manufacturing files.
  const copperByLayer = new Map<CopperLayer, Poly[]>()
  const bucketOf = (l: CopperLayer): Poly[] => {
    const existing = copperByLayer.get(l)
    if (existing !== undefined) return existing
    const fresh: Poly[] = []
    copperByLayer.set(l, fresh)
    return fresh
  }
  bucketOf('top') // the two outer buckets always exist (they back the assembled board's two faces)
  bucketOf('bottom')
  for (const t of routing.traces) {
    const target = bucketOf(t.layer)
    const z = zOfLayer(t.layer)
    for (let i = 0; i + 1 < t.points.length; i++) {
      const a = t.points[i]
      const b = t.points[i + 1]
      if (!a || !b) continue
      target.push({ verts: ribbonSegment(a, b, t.widthMm, z), color: COLORS.copper })
    }
  }
  for (const pl of board.placements) {
    const fp = footprintByPlacement(pl)
    if (fp === undefined) continue
    for (const pad of fp.pads) {
      // an SMD pad is copper on the top only; a through-hole pad has an annular ring on EVERY layer.
      bucketOf('top').push({
        verts: padCornersAtZ(pl, pad.center, pad.size.w, pad.size.h, zOfLayer('top')),
        color: COLORS.copper,
      })
      if (pad.type === 'through_hole') {
        for (const cl of boardCopperLayers) {
          if (cl === 'top') continue
          bucketOf(cl).push({
            verts: padCornersAtZ(pl, pad.center, pad.size.w, pad.size.h, zOfLayer(cl)),
            color: COLORS.copper,
          })
        }
      }
    }
  }
  for (const v of routing.vias) {
    // a plated through-via's barrel puts a copper ring on every copper layer it passes
    for (const cl of boardCopperLayers) {
      bucketOf(cl).push({
        verts: disk(v.at.x, v.at.y, v.diameterMm / 2, zOfLayer(cl)),
        color: COLORS.copper,
      })
    }
  }
  const topCopper = bucketOf('top')
  const bottomCopper = bucketOf('bottom')

  const faces: Face[] = []
  if (!exploded) {
    // ASSEMBLED: one FR4 slab (z=0..T). The top/bottom carry the copper; when the board has controlled-
    // depth recesses (cavity / stepped boards) on a side, that surface becomes a milled frame + pockets.
    const c = {
      b00: { x: x0, y: y0, z: 0 },
      b10: { x: x1, y: y0, z: 0 },
      b11: { x: x1, y: y1, z: 0 },
      b01: { x: x0, y: y1, z: 0 },
      t00: { x: x0, y: y0, z: T },
      t10: { x: x1, y: y0, z: T },
      t11: { x: x1, y: y1, z: T },
      t01: { x: x0, y: y1, z: T },
    }
    const topRecs = recesses.filter((r) => r.side === 'top')
    const botRecs = recesses.filter((r) => r.side === 'bottom')
    if (topRecs.length > 0) {
      pushRecessedSurface(faces, x0, y0, x1, y1, T, topRecs, COLORS.maskTop, topCopper, 1, T)
    } else {
      faces.push({ verts: [c.t00, c.t10, c.t11, c.t01], color: COLORS.maskTop, decals: topCopper })
    }
    if (botRecs.length > 0) {
      pushRecessedSurface(faces, x0, y0, x1, y1, 0, botRecs, COLORS.maskBottom, bottomCopper, -1, T)
    } else {
      faces.push({
        verts: [c.b01, c.b11, c.b10, c.b00],
        color: COLORS.maskBottom,
        decals: bottomCopper,
      })
    }
    faces.push(
      { verts: [c.b00, c.b10, c.t10, c.t00], color: COLORS.fr4, decals: [] },
      { verts: [c.b10, c.b11, c.t11, c.t10], color: COLORS.fr4, decals: [] },
      { verts: [c.b11, c.b01, c.t01, c.t11], color: COLORS.fr4, decals: [] },
      { verts: [c.b01, c.b00, c.t00, c.t01], color: COLORS.fr4, decals: [] },
    )
  } else {
    // EXPLODED: the board SPLIT into its real layers — the FR4 core as its own slab (its true, thinner
    // thickness), the copper layers as their own planes carrying the real copper, the soldermask as thin
    // translucent sheets. Each at its true height, separated in space.
    for (const p of placed) {
      if (p.type === 'core' || p.type === 'prepreg') {
        addSlab(faces, x0, y0, x1, y1, p.z0, p.z1, COLORS.core, []) // the opaque dielectric slab
      } else if (p.type === 'solder_mask') {
        addSlab(faces, x0, y0, x1, y1, p.z0, p.z1, COLORS.maskTop, [], 0.28) // thin translucent green
      } else if (p.type === 'copper') {
        // a faint marker plane for the copper LEVEL + the REAL etched copper on it — every copper layer
        // (top, bottom, AND the inner layers) shows exactly its own routed traces, pad rings and via
        // caps at this separated height, so the exploded stack matches that layer's Gerber. An inner
        // layer with nothing routed on it shows just the faint marker (its Gerber is empty too).
        const cl = stackupCopperLayer(p.name)
        const copper = cl !== null ? copperByLayer.get(cl) : undefined
        // The faint plane marks the layer's LEVEL (its Gerber extent) and sits at the slab's base, so the
        // etched copper standing on it never fights it for the same pixels.
        faces.push({
          verts: [
            { x: x0, y: y0, z: p.z0 },
            { x: x1, y: y0, z: p.z0 },
            { x: x1, y: y1, z: p.z0 },
            { x: x0, y: y1, z: p.z0 },
          ],
          color: COLORS.maskTop,
          decals: [],
          doubleSided: true,
          alpha: 0.12,
        })
        // Only the ETCHED copper is solid (a real layer is mostly removed) — each trace, pad ring and via
        // cap becomes a slab of the layer's drawn thickness, so copper reads as metal with depth.
        if (copper !== undefined) {
          for (const poly of copper) {
            pushPrism(faces, poly.verts, p.z0, p.z1, poly.color)
          }
        }
      }
    }
  }

  // via barrels — real copper cylinders. Assembled: through the board (0..T). Exploded: they SPAN the
  // gap between the separated copper layers (botCuZ..topCuZ) — the visible between-layers connection.
  const viaLo = exploded ? botCuZ : 0
  const viaHi = exploded ? topCuZ : T
  for (const v of routing.vias) {
    const sides = 8
    const r = v.diameterMm / 2
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2
      const b = ((i + 1) / sides) * Math.PI * 2
      const ax = v.at.x + r * Math.cos(a)
      const ay = v.at.y + r * Math.sin(a)
      const bx = v.at.x + r * Math.cos(b)
      const by = v.at.y + r * Math.sin(b)
      faces.push({
        verts: [
          { x: ax, y: ay, z: viaLo },
          { x: bx, y: by, z: viaLo },
          { x: bx, y: by, z: viaHi },
          { x: ax, y: ay, z: viaHi },
        ],
        color: COLORS.copper,
        decals: [],
      })
    }
  }

  // component 3-D bodies — each part's real X/Y (its fabrication outline) extruded to its cited body
  // height, sitting on the (possibly lifted) top surface; pin headers also get metal posts.
  let topZ = Math.max(T, compBase)
  for (const pl of board.placements) {
    const fp = footprintByPlacement(pl)
    const body = fp?.body3d
    if (fp === undefined || body === undefined) continue
    const bb = fabricationBounds(fp)
    if (bb === undefined) continue
    const z0 = compBase + body.standoffMm
    const z1 = z0 + body.heightMm
    const corners = [
      { x: bb.x, y: bb.y },
      { x: bb.x + bb.w, y: bb.y },
      { x: bb.x + bb.w, y: bb.y + bb.h },
      { x: bb.x, y: bb.y + bb.h },
    ].map((p) => placePoint(pl, p))
    pushBox(faces, corners, z0, z1, COLORS.body)
    topZ = Math.max(topZ, z1)
    if (body.pinPosts) {
      const half = body.pinPosts.widthMm / 2
      const pinTop = z1 + body.pinPosts.heightMm
      for (const pad of fp.pads) {
        const post = [
          { x: pad.center.x - half, y: pad.center.y - half },
          { x: pad.center.x + half, y: pad.center.y - half },
          { x: pad.center.x + half, y: pad.center.y + half },
          { x: pad.center.x - half, y: pad.center.y + half },
        ].map((p) => placePoint(pl, p))
        pushBox(faces, post, z1, pinTop, COLORS.pin)
      }
      topZ = Math.max(topZ, pinTop)
    }
  }

  // frame the whole assembly (exploded: from the bottom of the stack up to the tallest part on top)
  const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: topZ / 2 }
  const diagonal = Math.hypot(o.w, o.h, topZ)

  // the coordinate reference on the ground plane (z=0): our mm grid + the x/y axes through the origin
  // (0,0) + the four quadrants — so the board sits on our coordinate system, CAD-style.
  let grid: GridRef | undefined
  if (showGrid) {
    const step = 5 // mm
    const margin = 6
    const gx0 = Math.floor((Math.min(0, x0) - margin) / step) * step
    const gx1 = Math.ceil((Math.max(0, x1) + margin) / step) * step
    const gy0 = Math.floor((Math.min(0, y0) - margin) / step) * step
    const gy1 = Math.ceil((Math.max(0, y1) + margin) / step) * step
    const lines: GridRef['lines'] = []
    for (let gx = gx0; gx <= gx1; gx += step) {
      lines.push({ a: { x: gx, y: gy0, z: 0 }, b: { x: gx, y: gy1, z: 0 }, axis: gx === 0 })
    }
    for (let gy = gy0; gy <= gy1; gy += step) {
      lines.push({ a: { x: gx0, y: gy, z: 0 }, b: { x: gx1, y: gy, z: 0 }, axis: gy === 0 })
    }
    grid = {
      lines,
      labels: [
        { at: { x: gx1 - 1, y: -1.2, z: 0 }, text: 'x' },
        { at: { x: -1.2, y: gy1 - 1, z: 0 }, text: 'y' },
        { at: { x: 2, y: 2, z: 0 }, text: 'I' },
        { at: { x: -3, y: 2, z: 0 }, text: 'II' },
        { at: { x: -3.5, y: -2.5, z: 0 }, text: 'III' },
        { at: { x: 2, y: -2.5, z: 0 }, text: 'IV' },
      ],
    }
  }

  const copperZ: { top: number; bottom: number } & Partial<Record<CopperLayer, number>> = {
    top: zOfLayer('top'),
    bottom: zOfLayer('bottom'),
  }
  for (const cl of ['inner1', 'inner2', 'inner3', 'inner4'] as const) {
    const z = copperZByLayer.get(cl)
    if (z !== undefined) copperZ[cl] = z
  }
  return {
    faces,
    center,
    diagonal,
    copperZ,
    ...(grid ? { grid } : {}),
  }
}

export function defaultCamera(scene: Scene): OrbitCamera {
  return {
    azimuthDeg: -55,
    elevationDeg: 26,
    distance: Math.max(scene.diagonal * 2.4, 30),
    target: scene.center,
    fovDeg: 32,
  }
}

/** The camera eye position in world space from the orbit parameters. */
function eyeOf(cam: OrbitCamera): Vec3 {
  const az = (cam.azimuthDeg * Math.PI) / 180
  const el = (cam.elevationDeg * Math.PI) / 180
  const horiz = Math.cos(el) * cam.distance
  return add(cam.target, {
    x: horiz * Math.cos(az),
    y: horiz * Math.sin(az),
    z: Math.sin(el) * cam.distance,
  })
}

export type Projector = {
  eye: Vec3
  /** The camera basis in world space (right / up / forward) — also the rows that map view → world. */
  right: Vec3
  up: Vec3
  forward: Vec3
  /** Perspective focal length in px (height / 2 / tan(fov/2)). */
  focal: number
  width: number
  height: number
  /** World → camera/view space: x = right, y = up, z = forward (depth in front of the camera). */
  toView: (p: Vec3) => Vec3
  /** View space → screen (perspective divide). Assumes z > 0 (clip against the near plane first). */
  project: (v: Vec3) => { x: number; y: number }
}

export function makeProjector(cam: OrbitCamera, width: number, height: number): Projector {
  const eye = eyeOf(cam)
  const forward = norm(sub(cam.target, eye))
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 }
  // guard the gimbal when looking almost straight down
  const upRef = Math.abs(dot(forward, worldUp)) > 0.999 ? { x: 0, y: 1, z: 0 } : worldUp
  const right = norm(cross(forward, upRef))
  const up = cross(right, forward)
  const focal = height / 2 / Math.tan((cam.fovDeg * Math.PI) / 180 / 2)
  return {
    eye,
    right,
    up,
    forward,
    focal,
    width,
    height,
    toView: (p: Vec3) => {
      const d = sub(p, eye)
      return { x: dot(d, right), y: dot(d, up), z: dot(d, forward) }
    },
    project: (v: Vec3) => ({
      x: width / 2 + (v.x * focal) / v.z,
      y: height / 2 - (v.y * focal) / v.z,
    }),
  }
}

const NEAR_MM = 0.05 // near clip plane, in view-space depth (mm)

/**
 * Clip a view-space polygon against the near plane (keep z ≥ near), interpolating each crossing edge.
 * Without this, a single vertex behind the camera would drop the whole face — losing the board's near
 * edge on zoom-in or at grazing angles. Sutherland–Hodgman against the single near plane.
 */
function clipNear(verts: Vec3[], near: number): Vec3[] {
  const out: Vec3[] = []
  const n = verts.length
  for (let i = 0; i < n; i++) {
    const cur = verts[i]
    const prev = verts[(i + n - 1) % n]
    if (!cur || !prev) continue
    const curIn = cur.z >= near
    const prevIn = prev.z >= near
    if (curIn) {
      if (!prevIn) out.push(lerpAtNear(prev, cur, near))
      out.push(cur)
    } else if (prevIn) {
      out.push(lerpAtNear(prev, cur, near))
    }
  }
  return out
}
function lerpAtNear(a: Vec3, b: Vec3, near: number): Vec3 {
  const t = (near - a.z) / (b.z - a.z || 1)
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near }
}

export type Ray = { origin: Vec3; dir: Vec3 }

/**
 * A screen point (CSS px) → a world-space ray from the camera eye. This INVERTS the perspective
 * projection: recover the view-space direction (vx, vy, 1) that `project` would map to (sx, sy), then
 * rotate it back to world with the camera basis. This is what makes 3-D routing possible — a click
 * becomes a real ray you can intersect with a copper layer.
 */
export function screenRay(proj: Projector, sx: number, sy: number): Ray {
  const vx = (sx - proj.width / 2) / proj.focal
  const vy = (proj.height / 2 - sy) / proj.focal
  const dir = norm(add(add(scale(proj.right, vx), scale(proj.up, vy)), proj.forward))
  return { origin: proj.eye, dir }
}

/**
 * Intersect a world ray with the horizontal plane z = zPlane (a copper layer's surface). Returns the
 * board-space (x, y) mm of the hit, or null if the ray is parallel to the plane or the hit is behind
 * the eye. This is the 3-D analogue of the flat view's `eventToMm`.
 */
export function rayPlaneZ(ray: Ray, zPlane: number): { x: number; y: number } | null {
  const dz = ray.dir.z
  if (Math.abs(dz) < 1e-9) return null
  const t = (zPlane - ray.origin.z) / dz
  if (t <= 0) return null
  return { x: ray.origin.x + ray.dir.x * t, y: ray.origin.y + ray.dir.y * t }
}

/** Convenience: a screen click → the board-mm point on the copper plane z = zPlane, using the same
 *  camera the renderer draws with. Builds the projector, casts the ray, hits the plane. */
export function screenToBoardMm(
  cam: OrbitCamera,
  width: number,
  height: number,
  sx: number,
  sy: number,
  zPlane: number,
): { x: number; y: number } | null {
  return rayPlaneZ(screenRay(makeProjector(cam, width, height), sx, sy), zPlane)
}

/** Project a world point to screen (CSS px), or null if it is at/behind the near plane — for drawing
 *  the routing overlay (pending trace, pad rings, cursor) on top of the rendered board. */
export function projectToScreen(proj: Projector, p: Vec3): { x: number; y: number } | null {
  const v = proj.toView(p)
  if (v.z < NEAR_MM) return null
  return proj.project(v)
}

function shadeHex(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f))
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f))
  const b = Math.min(255, Math.round((n & 255) * f))
  return `rgb(${r},${g},${b})`
}

/** Flat-shade a face by its world normal against the light (ambient + diffuse). */
function shadeOf(verts: Vec3[]): number {
  if (verts.length < 3) return 1
  const a = verts[0]
  const b = verts[1]
  const c = verts[2]
  if (!a || !b || !c) return 1
  const n = norm(cross(sub(b, a), sub(c, a)))
  const lit = Math.abs(dot(n, LIGHT)) // both sides of a thin sheet catch the light
  return 0.5 + 0.5 * lit
}

/**
 * Render the scene to a 2-D canvas context. Faces turned away from the camera are culled (so a
 * surface's copper is drawn only when that surface is toward you — correct occlusion for the convex
 * slab + via barrels, independent of angle); the survivors are painter-sorted far → near by centroid
 * depth, and each face's copper/silk decals are drawn right after it so they sit on top of it. Every
 * polygon is clipped to the near plane, so the near edge never drops on zoom-in. `dpr` = device-pixel
 * ratio for crisp lines.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  cam: OrbitCamera,
  width: number,
  height: number,
  dpr: number,
  background = '#0a0f18',
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)
  ctx.lineJoin = 'round'

  const proj = makeProjector(cam, width, height)

  // the coordinate grid on the ground plane, drawn BEHIND the board (the board sits on it). A segment
  // is clipped to the near plane so a line crossing behind the camera doesn't smear across the screen.
  if (scene.grid !== undefined) {
    const drawSeg = (p: Vec3, q: Vec3, stroke: string, w: number, alpha: number) => {
      let va = proj.toView(p)
      let vb = proj.toView(q)
      if (va.z < NEAR_MM && vb.z < NEAR_MM) return
      if (va.z < NEAR_MM) va = lerpAtNear(vb, va, NEAR_MM)
      else if (vb.z < NEAR_MM) vb = lerpAtNear(va, vb, NEAR_MM)
      const a = proj.project(va)
      const b = proj.project(vb)
      ctx.globalAlpha = alpha
      ctx.strokeStyle = stroke
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    for (const l of scene.grid.lines) {
      drawSeg(l.a, l.b, GRID_COLOR, l.axis ? 1.4 : 0.6, l.axis ? 0.55 : 0.16)
    }
    ctx.globalAlpha = 0.6
    ctx.fillStyle = GRID_COLOR
    ctx.font = 'italic 12px Georgia, serif'
    for (const lbl of scene.grid.labels) {
      const v = proj.toView(lbl.at)
      if (v.z < NEAR_MM) continue
      const s = proj.project(v)
      ctx.fillText(lbl.text, s.x, s.y)
    }
    ctx.globalAlpha = 1
  }

  const visible: { face: Face; depth: number; shade: number }[] = []
  for (const face of scene.faces) {
    const a = face.verts[0]
    const b = face.verts[1]
    const c = face.verts[2]
    if (!a || !b || !c) continue
    const normal = cross(sub(b, a), sub(c, a))
    let cx = 0
    let cy = 0
    let cz = 0
    for (const v of face.verts) {
      cx += v.x
      cy += v.y
      cz += v.z
    }
    const k = face.verts.length || 1
    const centroid = { x: cx / k, y: cy / k, z: cz / k }
    // double-sided faces (floating copper layers / translucent planes) are never culled
    if (!face.doubleSided && dot(normal, sub(proj.eye, centroid)) <= 0) continue
    visible.push({ face, depth: proj.toView(centroid).z, shade: shadeOf(face.verts) })
  }
  visible.sort((p, q) => q.depth - p.depth) // far first

  const fill = (worldVerts: Vec3[], color: string) => {
    const clipped = clipNear(worldVerts.map(proj.toView), NEAR_MM)
    if (clipped.length < 3) return
    ctx.beginPath()
    for (let i = 0; i < clipped.length; i++) {
      const v = clipped[i]
      if (!v) continue
      const s = proj.project(v)
      if (i === 0) ctx.moveTo(s.x, s.y)
      else ctx.lineTo(s.x, s.y)
    }
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }

  for (const { face, shade } of visible) {
    if (face.alpha !== undefined) ctx.globalAlpha = face.alpha
    fill(face.verts, shadeHex(face.color, shade))
    // decals ride on the same surface — shade them with the face so they sit flat on it
    for (const d of face.decals) fill(d.verts, shadeHex(d.color, shade))
    if (face.alpha !== undefined) ctx.globalAlpha = 1
  }
}
