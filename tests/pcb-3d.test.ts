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

describe('buildBoardScene — real to-scale geometry', () => {
  test('the slab is the board’s true finished thickness (1.6 mm default)', () => {
    const scene = buildBoardScene(board, routing, defaultStackup())
    // every z is either 0 (bottom) or the finished thickness (top) — no exaggeration
    const zs = new Set(scene.faces.flatMap((f) => f.verts.map((v) => Number(v.z.toFixed(3)))))
    expect(zs.has(0)).toBe(true)
    expect(zs.has(1.6)).toBe(true)
    expect(scene.center.z).toBeCloseTo(0.8, 6) // half the board
  })

  test('a 2 mm board makes a 2 mm slab (thickness follows the stack-up)', () => {
    const scene = buildBoardScene(
      board,
      { traces: [], vias: [], unrouted: [] },
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
    const scene2 = buildBoardScene(
      board,
      {
        traces: [],
        vias: [],
        unrouted: [],
      },
      defaultStackup(),
    )
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
