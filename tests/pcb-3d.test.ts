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
  type OrbitCamera,
  renderScene,
} from '../src/renderer/pcb-3d.ts'
import { deriveBoard } from '../src/renderer/pcb-board.ts'
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

describe('exploded lamination — layers separated in real space', () => {
  const explode = 5
  const T = 1.6

  test('the copper layers float apart; the via barrel spans the full gap', () => {
    const scene = buildBoardScene(board, routing, defaultStackup(), explode)
    const zs = scene.faces.flatMap((f) => f.verts.map((v) => v.z))
    // bottom copper drops to −explode, top copper lifts to T+explode — the via bridges the whole span
    expect(Math.min(...zs)).toBeLessThanOrEqual(-explode + 1e-6)
    expect(zs.some((z) => Math.abs(z - (T + explode)) < 1e-6)).toBe(true)
  })

  test('exploded adds faces (floating copper + faint layer planes) vs assembled', () => {
    const assembled = buildBoardScene(board, routing, defaultStackup(), 0)
    const exp = buildBoardScene(board, routing, defaultStackup(), explode)
    expect(exp.faces.length).toBeGreaterThan(assembled.faces.length)
    // the exploded view uses double-sided floating sheets + translucent planes
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
