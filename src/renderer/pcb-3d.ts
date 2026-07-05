import { fabricationBounds } from './footprint.ts'
import type { Board } from './pcb-board.ts'
import { footprintByPlacement, placePoint } from './pcb-board.ts'
import type { BoardRouting } from './pcb-route.ts'
import type { Stackup } from './pcb-stackup.ts'

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
/** A solid face plus the coplanar artwork (copper, silk) that rides on it, drawn right after it. */
export type Face = { verts: Vec3[]; color: string; decals: Poly[] }

export type Scene = {
  faces: Face[]
  center: Vec3
  /** The board's 3-D diagonal in mm — used to frame the default camera. */
  diagonal: number
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
  copper: '#d7a13c', // gold — real tinned/ENIG-ish copper, both sides (the blue is a 2-D EDA convention)
  copperEdge: '#8a6321',
  silk: '#eef0f2',
  body: '#242932', // component body — near-black plastic (ICs, chip resistors, headers)
  pin: '#c2c6cd', // metal pins (tin-plated header posts)
} as const

const LIGHT = norm({ x: -0.35, y: -0.45, z: 0.82 }) // upper-front light for the shading

/** The board's true finished thickness (mm) from the stack-up. */
function boardThicknessMm(stackup: Stackup): number {
  return stackup.layers.reduce((sum, l) => sum + l.thicknessMm, 0)
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
 * Build the board's real 3-D geometry from the derived board + routing + stack-up. All millimetres:
 * the FR4 slab at true thickness, the copper pads/traces on their real surfaces, and via barrels
 * through the board.
 */
export function buildBoardScene(board: Board, routing: BoardRouting, stackup: Stackup): Scene {
  const T = boardThicknessMm(stackup)
  const o = board.outline
  const x0 = o.x
  const y0 = o.y
  const x1 = o.x + o.w
  const y1 = o.y + o.h

  // the eight corners of the slab (z=0 bottom, z=T top)
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

  // --- surface artwork (decals) for the top and bottom copper faces ---
  const topDecals: Poly[] = []
  const bottomDecals: Poly[] = []

  // bottom copper first drawn under, top copper over — order within a face list is draw order
  for (const t of routing.traces) {
    const z = t.layer === 'top' ? T : 0
    const target = t.layer === 'top' ? topDecals : bottomDecals
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
      // every pad has copper on top; a through-hole pad has a ring on the bottom too
      topDecals.push({
        verts: padCornersAtZ(pl, pad.center, pad.size.w, pad.size.h, T),
        color: COLORS.copper,
      })
      if (pad.type === 'through_hole') {
        bottomDecals.push({
          verts: padCornersAtZ(pl, pad.center, pad.size.w, pad.size.h, 0),
          color: COLORS.copper,
        })
      }
    }
  }

  // via copper pads (caps) on both surfaces
  for (const v of routing.vias) {
    topDecals.push({ verts: disk(v.at.x, v.at.y, v.diameterMm / 2, T), color: COLORS.copper })
    bottomDecals.push({ verts: disk(v.at.x, v.at.y, v.diameterMm / 2, 0), color: COLORS.copper })
  }

  const faces: Face[] = [
    // top + bottom carry the copper artwork; the four sides are bare FR4
    { verts: [c.t00, c.t10, c.t11, c.t01], color: COLORS.maskTop, decals: topDecals },
    { verts: [c.b01, c.b11, c.b10, c.b00], color: COLORS.maskBottom, decals: bottomDecals },
    { verts: [c.b00, c.b10, c.t10, c.t00], color: COLORS.fr4, decals: [] },
    { verts: [c.b10, c.b11, c.t11, c.t10], color: COLORS.fr4, decals: [] },
    { verts: [c.b11, c.b01, c.t01, c.t11], color: COLORS.fr4, decals: [] },
    { verts: [c.b01, c.b00, c.t00, c.t01], color: COLORS.fr4, decals: [] },
  ]

  // via barrels — real copper cylinders through the board
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
          { x: ax, y: ay, z: 0 },
          { x: bx, y: by, z: 0 },
          { x: bx, y: by, z: T },
          { x: ax, y: ay, z: T },
        ],
        color: COLORS.copper,
        decals: [],
      })
    }
  }

  // component 3-D bodies — the assembled board. Each part's real X/Y (its fabrication outline) is
  // extruded to its cited body height above the board (+ standoff); pin headers also get metal posts.
  let topZ = T
  for (const pl of board.placements) {
    const fp = footprintByPlacement(pl)
    const body = fp?.body3d
    if (fp === undefined || body === undefined) continue
    const bb = fabricationBounds(fp)
    if (bb === undefined) continue
    const z0 = T + body.standoffMm
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

  // frame the whole assembly (a tall header raises topZ well above the board)
  const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: topZ / 2 }
  const diagonal = Math.hypot(o.w, o.h, topZ)
  return { faces, center, diagonal }
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

type Projector = {
  eye: Vec3
  /** World → camera/view space: x = right, y = up, z = forward (depth in front of the camera). */
  toView: (p: Vec3) => Vec3
  /** View space → screen (perspective divide). Assumes z > 0 (clip against the near plane first). */
  project: (v: Vec3) => { x: number; y: number }
}

function makeProjector(cam: OrbitCamera, width: number, height: number): Projector {
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
    if (dot(normal, sub(proj.eye, centroid)) <= 0) continue // facing away — cull
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
    fill(face.verts, shadeHex(face.color, shade))
    // decals ride on the same surface — shade them with the face so they sit flat on it
    for (const d of face.decals) fill(d.verts, shadeHex(d.color, shade))
  }
}
