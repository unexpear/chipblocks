/**
 * The from-scratch 3-D board engine. This proves the geometry is REAL and to-scale: the slab is the
 * board's true finished thickness from the stack-up, the four sides are bare FR4 and the top+bottom
 * carry the copper artwork, copper pads/traces land as decals on the right surface, and the default
 * camera frames the board. The projection is exercised for basic sanity (a point in front lands on
 * screen; the board centre projects near the middle).
 */
import { describe, expect, test } from 'vitest'
import {
  buildBoardScene,
  defaultCamera,
  makeProjector,
  type OrbitCamera,
  projectToScreen,
  rayPlaneZ,
  renderScene,
  screenToBoardMm,
} from '../src/renderer/pcb-3d.ts'
import { deriveBoard, type Recess } from '../src/renderer/pcb-board.ts'
import type { BoardRouting } from '../src/renderer/pcb-route.ts'
import { buildStackup, defaultStackup } from '../src/renderer/pcb-stackup.ts'

/** A minimal 2-D-context stand-in that records each filled polygon's colour + first vertex. */
function mockCtx() {
  const fills: { color: string; x: number; y: number }[] = []
  let pending: { x: number; y: number } | null = null
  const ctx = {
    fillStyle: '',
    lineJoin: '',
    setTransform() {},
    fillRect() {},
    beginPath() {
      pending = null
    },
    moveTo(x: number, y: number) {
      if (!pending) pending = { x, y }
    },
    lineTo() {},
    closePath() {},
    fill() {
      if (pending) fills.push({ color: String(ctx.fillStyle), x: pending.x, y: pending.y })
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills }
}

const rgb = (s: string) => {
  const m = s.match(/rgb\((\d+),(\d+),(\d+)\)/)
  return m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) } : null
}

const board = deriveBoard([
  { id: 'R1', definition: 'resistor' },
  { id: 'R2', definition: 'resistor' },
])
const routing: BoardRouting = {
  traces: [
    {
      net: 'N1',
      widthMm: 0.25,
      layer: 'top',
      points: [
        { x: board.outline.x + 1, y: board.outline.y + 1 },
        { x: board.outline.x + 4, y: board.outline.y + 1 },
      ],
    },
  ],
  vias: [
    {
      net: 'N1',
      at: { x: board.outline.x + 4, y: board.outline.y + 1 },
      diameterMm: 0.6,
      drillMm: 0.3,
    },
  ],
  unrouted: [],
}

// a bare board (no parts) — isolates pure slab + cull behaviour from the component bodies
const bareBoard = { outline: { x: 0, y: 0, w: 20, h: 8 }, placements: [] }
const noRouting: BoardRouting = { traces: [], vias: [], unrouted: [] }

describe('buildBoardScene — real to-scale geometry', () => {
  test('the slab is the board’s true finished thickness (1.6 mm default)', () => {
    const scene = buildBoardScene(bareBoard, noRouting, defaultStackup())
    // every z is either 0 (bottom) or the finished thickness (top) — no exaggeration
    const zs = new Set(scene.faces.flatMap((f) => f.verts.map((v) => Number(v.z.toFixed(3)))))
    expect(zs.has(0)).toBe(true)
    expect(zs.has(1.6)).toBe(true)
    expect(scene.center.z).toBeCloseTo(0.8, 6) // half the bare board
  })

  test('a 2 mm board makes a 2 mm slab (thickness follows the stack-up)', () => {
    const scene = buildBoardScene(
      bareBoard,
      noRouting,
      buildStackup({ thicknessMm: 2.0, copperWeight: 'one_oz', surfaceFinish: 'enig' }),
    )
    const maxZ = Math.max(...scene.faces.flatMap((f) => f.verts.map((v) => v.z)))
    expect(maxZ).toBeCloseTo(2.0, 6)
  })

  test('the top face carries the copper (traces, pad, via cap) as decals; sides are bare', () => {
    const scene = buildBoardScene(board, routing, defaultStackup())
    const top = scene.faces[0] // top face, built first
    expect(top).toBeDefined()
    // the trace segment + both resistors' pads (2 each) + the via cap all land on top
    expect(top?.decals.length ?? 0).toBeGreaterThanOrEqual(1 + 4 + 1)
    // a bare side face has no decals
    const sides = scene.faces.filter((f) => f.decals.length === 0 && f.verts.length === 4)
    expect(sides.length).toBeGreaterThanOrEqual(4)
  })

  test('a via adds a barrel through the board (extra side faces spanning 0..T)', () => {
    const withVia = buildBoardScene(board, routing, defaultStackup())
    const noVia = buildBoardScene(board, { traces: [], vias: [], unrouted: [] }, defaultStackup())
    expect(withVia.faces.length).toBeGreaterThan(noVia.faces.length) // barrel side quads added
  })
})

describe('renderScene — cull, near-clip, copper on top', () => {
  const scene = buildBoardScene(board, routing, defaultStackup())

  test('the default view draws the slab + copper, and the copper (gold) is visible from the top', () => {
    const { ctx, fills } = mockCtx()
    renderScene(ctx, scene, defaultCamera(scene), 640, 480, 1)
    expect(fills.length).toBeGreaterThan(6) // several faces + copper decals
    // a copper fill reads gold (r > g > b); the green mask/FR4 reads g > r
    const copper = fills.map((f) => rgb(f.color)).filter((c) => c && c.r > c.g && c.g > c.b)
    expect(copper.length).toBeGreaterThan(0)
  })

  test('backface cull: viewed straight down, the TOP copper shows and the bottom face is culled', () => {
    const scene2 = buildBoardScene(bareBoard, noRouting, defaultStackup())
    const topCam: OrbitCamera = { ...defaultCamera(scene2), elevationDeg: 89, azimuthDeg: 0 }
    const { ctx, fills } = mockCtx()
    renderScene(ctx, scene2, topCam, 480, 480, 1)
    // straight down: exactly one big green face (the top) is visible; the 4 sides + bottom are culled
    const greens = fills.map((f) => rgb(f.color)).filter((c) => c && c.g > c.r)
    expect(greens.length).toBe(1)
  })

  test('a grazing / zoomed-in camera still renders (near-plane clip, no throw, still draws)', () => {
    const grazeIn: OrbitCamera = {
      ...defaultCamera(scene),
      elevationDeg: 3,
      distance: scene.diagonal * 0.5, // close enough that the near edge crosses the eye plane
    }
    const { ctx, fills } = mockCtx()
    expect(() => renderScene(ctx, scene, grazeIn, 640, 480, 1)).not.toThrow()
    expect(fills.length).toBeGreaterThan(0)
  })
})

describe('component 3-D bodies — the assembled board, at cited heights', () => {
  test('each footprinted part extrudes a body box to its cited height above the board', () => {
    const scene = buildBoardScene(board, { traces: [], vias: [], unrouted: [] }, defaultStackup())
    // 6 slab faces + 6 faces per component body (2 resistors) = 18
    expect(scene.faces.length).toBeGreaterThanOrEqual(6 + 2 * 6)
    // a 0603 body tops out at board 1.6 + standoff 0.02 + height 0.45 = 2.07 mm
    const maxZ = Math.max(...scene.faces.flatMap((f) => f.verts.map((v) => v.z)))
    expect(maxZ).toBeCloseTo(2.07, 3)
  })

  test('a pin header extrudes its plastic base AND its metal posts to the cited pin height', () => {
    const headerBoard = {
      outline: { x: 0, y: 0, w: 12, h: 14 },
      placements: [
        {
          partId: 'J1',
          footprintId: 'PinHeader_1x04_P2.54mm_Vertical',
          x: 3,
          y: 3,
          rotation: 0 as const,
        },
      ],
    }
    const scene = buildBoardScene(
      headerBoard,
      { traces: [], vias: [], unrouted: [] },
      defaultStackup(),
    )
    // base box (6) + 4 pin posts × 6 = 30, plus the 6 slab faces
    expect(scene.faces.length).toBeGreaterThanOrEqual(6 + 6 + 4 * 6)
    // the pins reach board 1.6 + base 2.5 + pin 6.0 = 10.1 mm
    const maxZ = Math.max(...scene.faces.flatMap((f) => f.verts.map((v) => v.z)))
    expect(maxZ).toBeCloseTo(10.1, 3)
  })

  test('the camera frames the whole assembly — the tall header raises the framing height', () => {
    const flat = buildBoardScene(board, { traces: [], vias: [], unrouted: [] }, defaultStackup())
    const tall = buildBoardScene(
      {
        outline: { x: 0, y: 0, w: 12, h: 14 },
        placements: [
          {
            partId: 'J1',
            footprintId: 'PinHeader_1x04_P2.54mm_Vertical',
            x: 3,
            y: 3,
            rotation: 0 as const,
          },
        ],
      },
      { traces: [], vias: [], unrouted: [] },
      defaultStackup(),
    )
    expect(tall.center.z).toBeGreaterThan(flat.center.z) // framing rises with the header
  })
})

describe('exploded lamination — the board SPLIT into its real stack-up layers', () => {
  const explode = 5

  test('the stack rises from z=0 through separated layers; the via barrel bridges the two copper layers', () => {
    const scene = buildBoardScene(board, routing, defaultStackup(), explode)
    const zs = scene.faces.flatMap((f) => f.verts.map((v) => v.z))
    expect(Math.min(...zs)).toBeCloseTo(0, 6) // the bottom layer sits at the base
    expect(Math.max(...zs)).toBeGreaterThan(explode * 3) // several real layers + gaps stacked up
    // the tallest single face is the via barrel spanning the separated top + bottom copper layers
    const maxSpan = Math.max(
      ...scene.faces.map((f) => {
        const fz = f.verts.map((v) => v.z)
        return Math.max(...fz) - Math.min(...fz)
      }),
    )
    expect(maxSpan).toBeGreaterThan(explode * 2)
  })

  test('the FR4 core becomes its OWN thinner slab (not the full board thickness)', () => {
    const scene = buildBoardScene(
      board,
      { traces: [], vias: [], unrouted: [] },
      defaultStackup(),
      explode,
    )
    // the core slab (opaque, distinct colour) spans ~1.51 mm — the real core, NOT the 1.6 mm board
    const coreFace = scene.faces.find((f) => {
      const fz = f.verts.map((v) => v.z)
      const span = Math.max(...fz) - Math.min(...fz)
      return span > 1 && span < 1.6 // a slab between 1 and 1.6 mm tall = the core
    })
    expect(coreFace).toBeDefined()
  })

  test('exploded adds faces (per-layer slabs + copper + translucent sheets) vs assembled', () => {
    const assembled = buildBoardScene(board, routing, defaultStackup(), 0)
    const exp = buildBoardScene(board, routing, defaultStackup(), explode)
    expect(exp.faces.length).toBeGreaterThan(assembled.faces.length)
    // the exploded view uses double-sided copper sheets + translucent mask/marker planes
    expect(exp.faces.some((f) => f.doubleSided)).toBe(true)
    expect(exp.faces.some((f) => f.alpha !== undefined)).toBe(true)
  })

  test('assembled mode (explode=0) is unchanged — copper stays as decals on the slab, no floating faces', () => {
    const assembled = buildBoardScene(board, routing, defaultStackup(), 0)
    expect(assembled.faces[0]?.decals.length ?? 0).toBeGreaterThan(0) // copper on the slab top
    expect(assembled.faces.every((f) => !f.doubleSided)).toBe(true)
    expect(assembled.faces.every((f) => f.alpha === undefined)).toBe(true)
  })

  test('the framing spans the exploded gap (taller than assembled)', () => {
    const assembled = buildBoardScene(board, routing, defaultStackup(), 0)
    const exp = buildBoardScene(board, routing, defaultStackup(), explode)
    expect(exp.diagonal).toBeGreaterThan(assembled.diagonal)
  })
})

describe('multilevel board — inner copper planes appear in the exploded view', () => {
  const COPPER_GOLD = '#d7a13c' // COLORS.copper
  const flatZ = (f: { verts: { z: number }[] }): number | null => {
    const z0 = f.verts[0]?.z
    if (z0 === undefined) return null
    return f.verts.every((v) => Math.abs(v.z - z0) < 1e-9) ? z0 : null
  }

  test('a 4-layer board shows solid copper planes strictly BETWEEN the top and bottom copper', () => {
    const stack4 = buildStackup({
      thicknessMm: 1.6,
      copperWeight: 'one_oz',
      surfaceFinish: 'hasl',
      copperLayers: 4,
    })
    const scene = buildBoardScene(board, routing, stack4, 5) // exploded so the layers separate
    // inner copper = a flat copper quad whose z sits between the two outer copper layers (a via barrel
    // spans z so it is excluded by flatZ; the outer copper sits AT copperZ.top / .bottom).
    const innerPlanes = scene.faces.filter((f) => {
      if (f.color !== COPPER_GOLD) return false
      const z = flatZ(f)
      return z !== null && z > scene.copperZ.bottom + 1e-6 && z < scene.copperZ.top - 1e-6
    })
    expect(innerPlanes.length).toBeGreaterThanOrEqual(2) // In1.Cu + In2.Cu pour planes
  })

  test('a plain 2-layer board has NO copper between its two copper layers', () => {
    const scene = buildBoardScene(board, routing, defaultStackup(), 5)
    const between = scene.faces.filter((f) => {
      if (f.color !== COPPER_GOLD) return false
      const z = flatZ(f)
      return z !== null && z > scene.copperZ.bottom + 1e-6 && z < scene.copperZ.top - 1e-6
    })
    expect(between).toHaveLength(0)
  })
})

describe('cavity / stepped boards — controlled-depth recesses milled into the assembled board', () => {
  const FR4 = '#0c3a24' // COLORS.fr4 — bare laminate (the pocket floor + walls)
  const T = 1.6
  const recess: Recess = {
    x: board.outline.x + 2,
    y: board.outline.y + 2,
    w: 4,
    h: 3,
    depthMm: 0.8,
    side: 'top',
  }
  const flatZ = (f: { verts: { z: number }[] }, z: number) =>
    f.verts.length === 4 && f.verts.every((v) => Math.abs(v.z - z) < 1e-6)

  test('a top recess cuts a pocket — a bare-FR4 floor at the reduced depth, and more faces than the flat board', () => {
    const flat = buildBoardScene(board, routing, defaultStackup(), 0, false, [])
    const cav = buildBoardScene(board, routing, defaultStackup(), 0, false, [recess])
    expect(cav.faces.length).toBeGreaterThan(flat.faces.length) // frame strips + 4 walls + floor
    const floor = cav.faces.find((f) => f.color === FR4 && flatZ(f, T - recess.depthMm))
    expect(floor).toBeDefined() // a flat FR4 floor sits at z = T − depth (0.8 mm)
  })

  test('the pocket has vertical walls spanning the full milled depth (T down to the floor)', () => {
    const cav = buildBoardScene(board, routing, defaultStackup(), 0, false, [recess])
    const wall = cav.faces.find((f) => {
      if (f.color !== FR4) return false
      const zs = f.verts.map((v) => v.z)
      return (
        Math.abs(Math.max(...zs) - T) < 1e-6 &&
        Math.abs(Math.min(...zs) - (T - recess.depthMm)) < 1e-6
      )
    })
    expect(wall).toBeDefined()
  })

  test('a recess spanning to the board edge (a step) still cuts a floor at depth', () => {
    const o = board.outline
    const step: Recess = { x: o.x, y: o.y, w: o.w, h: o.h * 0.3, depthMm: 0.6, side: 'top' }
    const cav = buildBoardScene(board, routing, defaultStackup(), 0, false, [step])
    expect(cav.faces.some((f) => f.color === FR4 && flatZ(f, T - step.depthMm))).toBe(true)
  })

  test('a bottom recess cuts UP from z=0 (floor at +depth)', () => {
    const bot: Recess = { ...recess, side: 'bottom' }
    const cav = buildBoardScene(board, routing, defaultStackup(), 0, false, [bot])
    expect(cav.faces.some((f) => f.color === FR4 && flatZ(f, bot.depthMm))).toBe(true)
  })
})

describe('coordinate grid — our coordinate system on the ground plane', () => {
  test('showGrid builds the mm grid on z=0 with the x/y axes through the origin and I–IV labels', () => {
    const withGrid = buildBoardScene(board, routing, defaultStackup(), 0, true)
    const noGrid = buildBoardScene(board, routing, defaultStackup(), 0, false)
    expect(noGrid.grid).toBeUndefined()
    expect(withGrid.grid).toBeDefined()
    const g = withGrid.grid
    if (!g) throw new Error('grid missing')
    // the grid lies on the ground plane z=0
    expect(g.lines.every((l) => l.a.z === 0 && l.b.z === 0)).toBe(true)
    // exactly two axes pass through the origin (the x-axis at y=0 and the y-axis at x=0)
    expect(g.lines.filter((l) => l.axis).length).toBe(2)
    // the four quadrants + the axis names are labelled
    const texts = g.labels.map((l) => l.text)
    expect(texts).toEqual(expect.arrayContaining(['I', 'II', 'III', 'IV', 'x', 'y']))
  })
})

describe('defaultCamera', () => {
  test('frames the board: distance scales with the board diagonal, targets its centre', () => {
    const scene = buildBoardScene(board, routing, defaultStackup())
    const cam = defaultCamera(scene)
    expect(cam.distance).toBeGreaterThan(scene.diagonal)
    expect(cam.target).toEqual(scene.center)
    expect(cam.elevationDeg).toBeGreaterThan(0)
    expect(cam.elevationDeg).toBeLessThan(90)
  })
})

describe('3-D routing pick — the inverse projection that turns a click into a board-mm point', () => {
  test('the scene exposes each copper layer’s z (top = board thickness, bottom = 0)', () => {
    const scene = buildBoardScene(board, routing, defaultStackup())
    expect(scene.copperZ.top).toBeCloseTo(1.6, 6)
    expect(scene.copperZ.bottom).toBeCloseTo(0, 6)
  })

  test('exploded: the two copper layers separate in z (top well above bottom)', () => {
    const scene = buildBoardScene(board, routing, defaultStackup(), 5)
    expect(scene.copperZ.top).toBeGreaterThan(scene.copperZ.bottom + 5)
  })

  test('a click round-trips on the TOP plane: project a board point, then unproject it back', () => {
    const scene = buildBoardScene(board, routing, defaultStackup())
    const cam = defaultCamera(scene)
    const proj = makeProjector(cam, 800, 600)
    const world = { x: board.outline.x + 5, y: board.outline.y + 3, z: scene.copperZ.top }
    const screen = proj.project(proj.toView(world))
    const back = screenToBoardMm(cam, 800, 600, screen.x, screen.y, scene.copperZ.top)
    expect(back).not.toBeNull()
    expect(back?.x).toBeCloseTo(world.x, 3)
    expect(back?.y).toBeCloseTo(world.y, 3)
  })

  test('the SAME screen click lands on different mm per layer (the z-plane picks top vs bottom)', () => {
    const scene = buildBoardScene(board, routing, defaultStackup(), 5)
    const cam = defaultCamera(scene)
    const proj = makeProjector(cam, 800, 600)
    // a real board point on the bottom copper plane projects to some pixel...
    const world = { x: board.outline.x + 2, y: board.outline.y + 2, z: scene.copperZ.bottom }
    const px = proj.project(proj.toView(world))
    // ...unprojecting that pixel against the bottom plane recovers it exactly...
    const onBottom = screenToBoardMm(cam, 800, 600, px.x, px.y, scene.copperZ.bottom)
    expect(onBottom?.x).toBeCloseTo(world.x, 3)
    expect(onBottom?.y).toBeCloseTo(world.y, 3)
    // ...but against the (separated) top plane it lands somewhere else — the layers are not co-planar
    const onTop = screenToBoardMm(cam, 800, 600, px.x, px.y, scene.copperZ.top)
    expect(onTop).not.toBeNull()
    expect(Math.hypot((onTop?.x ?? 0) - world.x, (onTop?.y ?? 0) - world.y)).toBeGreaterThan(0.5)
  })

  test('rayPlaneZ returns null when the ray is parallel to the plane or the plane is behind the eye', () => {
    const parallel = rayPlaneZ({ origin: { x: 0, y: 0, z: 5 }, dir: { x: 1, y: 0, z: 0 } }, 0)
    expect(parallel).toBeNull()
    const behind = rayPlaneZ({ origin: { x: 0, y: 0, z: 5 }, dir: { x: 0, y: 0, z: 1 } }, 0)
    expect(behind).toBeNull() // the z=0 plane is behind a ray looking up from z=5
  })

  test('projectToScreen drops points at/behind the near plane, keeps points in front', () => {
    const scene = buildBoardScene(board, routing, defaultStackup())
    const cam = defaultCamera(scene)
    const proj = makeProjector(cam, 800, 600)
    const behindEye = {
      x: proj.eye.x - proj.forward.x * 50,
      y: proj.eye.y - proj.forward.y * 50,
      z: proj.eye.z - proj.forward.z * 50,
    }
    expect(projectToScreen(proj, behindEye)).toBeNull()
    expect(projectToScreen(proj, scene.center)).not.toBeNull()
  })
})
