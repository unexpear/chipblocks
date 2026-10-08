/**
 * Read back the Gerber and Excellon text ChipBlocks itself writes (pcb-gerber.ts) and turn it into
 * millimetre draws. This is not a general Gerber parser. The only format accepted is the one the
 * writer emits: %FSLAX46Y46*% (leading-zero-omitted 4.6), %MOMM*%, circle / rect / obround
 * apertures, the RoundRect macro, and D01 / D02 / D03 — plus Excellon TnnC diameters with decimal
 * X…Y… hits. Anything else is reported and not plotted. If any command is skipped, the plot is
 * empty (`complete: false`): a partial picture would look like the whole file. A guessed coordinate
 * would be a false check of a file that goes to a fab.
 *
 * The writer negates Y (board y-down → Gerber y-up). Every point returned here is flipped back to
 * board-down, so the known flash X9175000Y-10000000 is (9.175 mm, 10 mm), not y = -10.
 */

/** Empty bottom paste and silk are real ZIP entries with no artwork (no bottom-mounted parts).
 *  These names are FAB_FILE_NAMES.bottomPaste / bottomSilk — the parse test pins that. */
const HIDDEN_WHEN_EMPTY = new Set(['board-B_Paste.gbp', 'board-B_Silkscreen.gbo'])

export function isHiddenEmptyBottom(name: string, drawCount: number): boolean {
  return drawCount === 0 && HIDDEN_WHEN_EMPTY.has(name)
}

export type MmPoint = { x: number; y: number }

export type ApertureShape =
  | { kind: 'circle'; dMm: number }
  | { kind: 'rect'; wMm: number; hMm: number }
  | { kind: 'obround'; wMm: number; hMm: number }
  | { kind: 'roundrect'; wMm: number; hMm: number; rMm: number }

export type PlotDraw =
  | { op: 'flash'; at: MmPoint; shape: ApertureShape }
  | { op: 'draw'; from: MmPoint; to: MmPoint; widthMm: number }
  | { op: 'drill'; at: MmPoint; diameterMm: number }

export type ParsedPlot = {
  kind: 'gerber' | 'excellon' | 'text'
  fileFunction: string | null
  polarity: 'Positive' | 'Negative' | null
  draws: PlotDraw[]
  warnings: string[]
  /**
   * True only when every graphics command was plotted. A skipped arc, region, mirror, step-repeat,
   * hole, or unknown command clears `draws` — a partial picture would look like the whole file.
   */
  complete: boolean
}

const TEXT: ParsedPlot = {
  kind: 'text',
  fileFunction: null,
  polarity: null,
  draws: [],
  warnings: [],
  complete: true,
}

/** Any warning means the picture is not the file. Drop the draws so a caller cannot paint a lie. */
function finish(plot: Omit<ParsedPlot, 'complete'>): ParsedPlot {
  if (plot.warnings.length > 0) return { ...plot, draws: [], complete: false }
  return { ...plot, complete: true }
}

function group(text: string, re: RegExp): string | null {
  return text.match(re)?.[1] ?? null
}

/** 4.6, leading zeros omitted: the decimal point sits six digits from the right. */
function gerber46Mm(raw: string): number {
  const neg = raw.startsWith('-')
  const digits = neg ? raw.slice(1) : raw
  const value = Number(digits) / 1e6
  return neg ? -value : value
}

function xNumbers(body: string): number[] | null {
  const nums: number[] = []
  for (const part of body.split('X')) {
    if (!/^-?\d+(\.\d+)?$/.test(part)) return null
    const n = Number(part)
    if (!Number.isFinite(n)) return null
    nums.push(n)
  }
  return nums
}

function positive(n: number | undefined): n is number {
  return n !== undefined && Number.isFinite(n) && n > 0
}

/** RoundRect parameters as ChipBlocks writes them: $1 radius, four inset corner centres, rotation 0.
 *  The corner centres sit `r` in from the pad box, so the pad size is the corner span plus 2r. */
function roundRect(nums: readonly number[]): ApertureShape | 'rotated' | null {
  const r = nums[0]
  if (!positive(r) || nums.length < 9) return null
  const rotation = nums[9]
  if (rotation !== undefined && rotation !== 0) return 'rotated'
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < 4; i++) {
    const x = nums[1 + i * 2]
    const y = nums[2 + i * 2]
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null
    }
    xs.push(x)
    ys.push(y)
  }
  const wMm = Math.max(...xs) - Math.min(...xs) + 2 * r
  const hMm = Math.max(...ys) - Math.min(...ys) + 2 * r
  if (!positive(wMm) || !positive(hMm)) return null
  return { kind: 'roundrect', wMm: snapMm(wMm), hMm: snapMm(hMm), rMm: snapMm(r) }
}

function nz(n: number): number {
  return n === 0 ? 0 : n
}

function snapMm(n: number): number {
  return nz(Math.round(n * 1e6) / 1e6)
}

function boardDown(x: number, gerberY: number): MmPoint {
  return { x: nz(x), y: nz(-gerberY) }
}

function parseGerber(text: string): ParsedPlot {
  const warnings: string[] = []
  const fileFunction = group(text, /%TF\.FileFunction,([^*%]+)\*%/)
  const polarityRaw = group(text, /%TF\.FilePolarity,(Positive|Negative)\*%/)
  const polarity = polarityRaw === 'Positive' || polarityRaw === 'Negative' ? polarityRaw : null
  if (!text.includes('%FSLAX46Y46*%') || !text.includes('%MOMM*%')) {
    warnings.push('not the ChipBlocks dialect (%FSLAX46Y46*% and %MOMM*%) — nothing plotted')
    return finish({ kind: 'gerber', fileFunction, polarity, draws: [], warnings })
  }
  const apertures = new Map<number, ApertureShape>()
  const draws: PlotDraw[] = []
  let currentCode: number | null = null
  let fileX: number | null = null
  let fileY: number | null = null
  let inMacro = false
  let linear = true
  let region = false
  const warnOnce = (msg: string) => {
    if (!warnings.includes(msg)) warnings.push(msg)
  }
  const applyOp = (op: number, xRaw: string | null, yRaw: string | null): void => {
    const nextX = xRaw !== null ? gerber46Mm(xRaw) : fileX
    const nextY = yRaw !== null ? gerber46Mm(yRaw) : fileY
    if (nextX === null || nextY === null) {
      warnOnce('draw before both X and Y were set')
      return
    }
    const at = boardDown(nextX, nextY)
    if (op === 2) {
      fileX = nextX
      fileY = nextY
      return
    }
    const shape = currentCode === null ? undefined : apertures.get(currentCode)
    if (op === 3) {
      if (shape === undefined) {
        warnOnce('flash with no ChipBlocks aperture selected — nothing is plotted')
      } else draws.push({ op: 'flash', at, shape })
      fileX = nextX
      fileY = nextY
      return
    }
    if (fileX === null || fileY === null) {
      warnOnce('D01 with no current point')
      fileX = nextX
      fileY = nextY
      return
    }
    if (region) {
      warnOnce(
        'region fill (G36/G37) is not plotted — a region contour is not a stroke, so nothing is plotted',
      )
      fileX = nextX
      fileY = nextY
      return
    }
    if (!linear) {
      warnOnce('arcs (G02/G03) are not plotted — nothing is plotted')
      fileX = nextX
      fileY = nextY
      return
    }
    if (shape === undefined || shape.kind !== 'circle') {
      warnOnce(
        shape === undefined
          ? 'draw with no ChipBlocks aperture selected — nothing is plotted'
          : 'D01 stroke is only plotted for a circle aperture — nothing is plotted',
      )
      fileX = nextX
      fileY = nextY
      return
    }
    draws.push({ op: 'draw', from: boardDown(fileX, fileY), to: at, widthMm: shape.dMm })
    fileX = nextX
    fileY = nextY
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    if (inMacro) {
      if (line.endsWith('%')) inMacro = false
      continue
    }
    if (line.startsWith('%')) {
      if (line.startsWith('%LP') && line !== '%LPD*%') {
        warnOnce(
          'level polarity is not dark (%LPD*%) — a clear (%LPC*%) would punch holes, so nothing is plotted',
        )
      } else if (line.startsWith('%SR')) {
        warnOnce('step-and-repeat (%SR) is not expanded — nothing is plotted')
      } else if (line.startsWith('%MI')) {
        warnOnce('image mirror (%MI) is not applied — nothing is plotted')
      } else if (line.startsWith('%IR') || line.startsWith('%RO')) {
        warnOnce('image rotation is not applied — nothing is plotted')
      } else if (line.startsWith('%SF')) {
        warnOnce('scale factor (%SF) is not applied — nothing is plotted')
      } else if (line.startsWith('%OF')) {
        warnOnce('offset (%OF) is not applied — nothing is plotted')
      } else if (line.startsWith('%MO') && line !== '%MOMM*%') {
        warnOnce('units are not millimetres (%MOMM*%) — nothing is plotted')
      } else if (line.startsWith('%FS') && line !== '%FSLAX46Y46*%') {
        warnOnce('coordinate format is not 4.6 leading-zero-omitted — nothing is plotted')
      } else if (line.startsWith('%IP') && line !== '%IPPOS*%') {
        warnOnce('negative image polarity (%IPNEG*%) is not applied — nothing is plotted')
      } else if (line.startsWith('%AM')) {
        const macroName = line.match(/^%AM([A-Za-z][A-Za-z0-9]*)/)?.[1]
        if (macroName !== 'RoundRect') {
          warnOnce(
            `aperture macro ${macroName ?? 'unknown'} is outside the ChipBlocks dialect — nothing is plotted`,
          )
        }
        if (!line.endsWith('%')) inMacro = true
      } else if (!isKnownPercent(line)) {
        warnOnce(`unsupported Gerber command (${line.slice(0, 60)}) — nothing is plotted`)
      }
      const add = line.match(/^%ADD(\d+)([A-Za-z][A-Za-z0-9]*),([^*]+)\*%$/)
      if (add) {
        const codeRaw = add[1]
        const name = add[2]
        const body = add[3]
        if (codeRaw === undefined || name === undefined || body === undefined) continue
        const nums = xNumbers(body)
        if (nums === null) {
          warnOnce(`aperture D${codeRaw} is not a ChipBlocks parameter list`)
          continue
        }
        let shape: ApertureShape | null = null
        if (name === 'C' && positive(nums[0]) && nums.length === 1) {
          shape = { kind: 'circle', dMm: nums[0] }
        } else if (name === 'C' && positive(nums[0]) && nums.length !== 1) {
          warnOnce(`circle aperture D${codeRaw} has a hole or extra parameter — nothing is plotted`)
        } else if ((name === 'R' || name === 'O') && positive(nums[0]) && positive(nums[1])) {
          if (nums.length > 2) {
            warnOnce(
              `aperture ${name} D${codeRaw} has a hole or extra parameter — nothing is plotted`,
            )
          } else {
            shape = { kind: name === 'R' ? 'rect' : 'obround', wMm: nums[0], hMm: nums[1] }
          }
        } else if (name === 'RoundRect') {
          const rr = roundRect(nums)
          if (rr === 'rotated') warnOnce(`RoundRect D${codeRaw} rotation is not plotted`)
          else shape = rr
        } else {
          warnOnce(`aperture ${name} is outside the ChipBlocks dialect`)
        }
        if (shape !== null) apertures.set(Number(codeRaw), shape)
        else if (name === 'RoundRect' && rrWasNull(nums)) {
          warnOnce(`RoundRect D${codeRaw} could not be read`)
        }
      }
      continue
    }
    if (line.startsWith('G04') || line === 'G75*' || line === 'G74*' || line === 'M02*') continue
    if (line === 'G01*') {
      linear = true
      continue
    }
    if (line === 'G36*' || line === 'G37*') {
      region = line === 'G36*'
      warnOnce(
        'region fill (G36/G37) is not plotted — a region contour is not a stroke, so nothing is plotted',
      )
      continue
    }
    if (/^G0[23]/.test(line) || (/[IJ]-?\d/.test(line) && /D0[123]\*$/.test(line))) {
      linear = false
      warnOnce('arcs (G02/G03) are not plotted — nothing is plotted')
      continue
    }
    const dOnly = line.match(/^D(\d+)\*$/)
    if (dOnly) {
      const codeRaw = dOnly[1]
      if (codeRaw === undefined) continue
      const code = Number(codeRaw)
      if (code >= 10) currentCode = code
      else if (code === 1 || code === 2 || code === 3) applyOp(code, null, null)
      else warnOnce(`unsupported Gerber D-code D${String(code)} — nothing is plotted`)
      continue
    }
    const coord = line.match(/^(?:X(-?\d+))?(?:Y(-?\d+))?D(0[123])\*$/)
    if (coord) {
      const opRaw = coord[3]
      if (opRaw === undefined) continue
      applyOp(Number(opRaw), coord[1] ?? null, coord[2] ?? null)
      continue
    }
    warnOnce(`unsupported Gerber command (${line.slice(0, 60)}) — nothing is plotted`)
  }
  if (inMacro) warnOnce('aperture macro was not closed — nothing is plotted')
  if (!text.split(/\r?\n/).some((raw) => raw.trim() === 'M02*')) {
    warnOnce('file does not end with M02* — it may be cut off, so nothing is plotted')
  }
  return finish({ kind: 'gerber', fileFunction, polarity, draws, warnings })
}

/** Percent commands that carry no geometry in the ChipBlocks dialect (attributes, units, dark polarity). */
function isKnownPercent(line: string): boolean {
  if (line.startsWith('%TF.') || line.startsWith('%TA.') || line.startsWith('%TO.')) return true
  if (line === '%TD*%' || line === '%LPD*%' || line === '%IPPOS*%') return true
  if (line === '%FSLAX46Y46*%' || line === '%MOMM*%') return true
  if (line.startsWith('%LN') || line.startsWith('%IN')) return true
  if (line.startsWith('%ADD') || line.startsWith('%AM')) return true
  return false
}

function rrWasNull(nums: readonly number[]): boolean {
  const rr = roundRect(nums)
  return rr === null
}

function parseExcellon(text: string): ParsedPlot {
  const warnings: string[] = []
  const fileFunction = group(text, /TF\.FileFunction,([^\r\n;*]+)/)
  if (!/^METRIC$/m.test(text)) {
    warnings.push('Excellon file is not METRIC — ChipBlocks drill dialect only, nothing plotted')
    return finish({ kind: 'excellon', fileFunction, polarity: null, draws: [], warnings })
  }
  const tools = new Map<number, number>()
  const draws: PlotDraw[] = []
  let header = true
  let current: number | null = null
  const warnOnce = (msg: string) => {
    if (!warnings.includes(msg)) warnings.push(msg)
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith(';')) continue
    if (line === '%') {
      header = false
      continue
    }
    if (
      line === 'M48' ||
      line === 'M30' ||
      line === 'FMAT,2' ||
      line === 'METRIC' ||
      line === 'G90' ||
      line === 'G05' ||
      line === 'G00' ||
      line === 'M71'
    ) {
      continue
    }
    if (line === 'G91' || line.startsWith('G91')) {
      warnOnce(
        'incremental drill mode (G91) is not plotted — those hits would be read as absolute and land in the wrong place',
      )
      continue
    }
    if (line === 'INCH' || line.startsWith('INCH,') || line === 'M72') {
      warnOnce('inch drill coordinates are not plotted')
      continue
    }
    if (/^R\d/.test(line) || line.startsWith('M25') || line.startsWith('M01')) {
      warnOnce('drill step-and-repeat is not expanded — nothing is plotted')
      continue
    }
    const def = line.match(/^T0*(\d+)C(\d+\.\d+)$/)
    if (def) {
      const toolRaw = def[1]
      const diaRaw = def[2]
      if (toolRaw === undefined || diaRaw === undefined) continue
      const dia = Number(diaRaw)
      if (!Number.isFinite(dia) || dia <= 0) {
        warnOnce(`tool T${toolRaw} diameter is not a positive millimetre`)
        continue
      }
      tools.set(Number(toolRaw), dia)
      continue
    }
    const sel = line.match(/^T0*(\d+)$/)
    if (sel) {
      const toolRaw = sel[1]
      if (toolRaw === undefined) continue
      current = Number(toolRaw)
      header = false
      continue
    }
    const hit = line.match(/^X(-?\d+\.\d+)Y(-?\d+\.\d+)$/)
    if (hit) {
      const xRaw = hit[1]
      const yRaw = hit[2]
      if (xRaw === undefined || yRaw === undefined) continue
      if (header) warnOnce('drill hit before the end of the header')
      const dia = current === null ? undefined : tools.get(current)
      if (dia === undefined) {
        warnOnce(`drill hit with no tool diameter: ${line}`)
        continue
      }
      draws.push({
        op: 'drill',
        at: { x: Number(xRaw), y: -Number(yRaw) },
        diameterMm: dia,
      })
      continue
    }
    warnOnce(`unsupported drill line (${line.slice(0, 60)}) — nothing is plotted`)
  }
  if (!text.split(/\r?\n/).some((raw) => raw.trim() === 'M30')) {
    warnOnce('drill file does not end with M30 — it may be cut off, so nothing is plotted')
  }
  return finish({ kind: 'excellon', fileFunction, polarity: null, draws, warnings })
}

/** Parse one manufacturing file. Gerber and Excellon come back as draws; BOM/README/job text does not. */
export function parseChipblocksPlot(text: string): ParsedPlot {
  const start = text.trimStart()
  if (start.startsWith('M48')) return parseExcellon(text)
  if (text.includes('%FSLAX46Y46*%') || text.includes('%MOMM*%') || text.includes('%ADD')) {
    return parseGerber(text)
  }
  return TEXT
}
