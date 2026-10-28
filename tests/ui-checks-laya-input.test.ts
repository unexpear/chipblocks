/**
 * What ui-checks sends Laya: refusal text must arrive whole. The runner used to cut every line at
 * 200 characters and the whole state at 1200 from the front, so the Gerber refusal reached Laya as
 * "... Not plotted. Part of a file was skippe ..." with no file name or reason. These tests pin the
 * fix: long lines are shortened by whole sentences keeping the alert ones, an over-long state drops
 * plain lines before alert lines, the state never exceeds what Laya can read (512 tokens), and the
 * client hands the compacted text to the sidecar byte for byte. No network, no model: the sidecar here
 * is a tiny Node echo script in a temp folder.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

type Benign = { pattern: string }
type LayaClient = {
  start: () => void
  stop: () => void
  ask: (
    state: string,
    qs: { id: string; q: string }[],
  ) => Promise<{ error?: string; echo?: string; answers?: Record<string, { noul: number }> }>
}
type LayaMod = {
  compactForLaya: (aria: string, maxChars?: number, benign?: Benign[]) => string
  shortenLine: (line: string, cap?: number) => string
  estimateLayaTokens: (text: string) => number
  LAYA_STATE_TOKENS: number
  LAYA_LINE_CHARS: number
  Laya: new (o: Record<string, unknown>) => LayaClient
}

const load = async (): Promise<LayaMod> =>
  (await import(pathToFileURL(resolve('ui-checks/src/laya.mjs')).href)) as LayaMod
const map = JSON.parse(
  readFileSync(resolve('ui-checks/map/app-map.json'), 'utf8').replace(/^\uFEFF/, ''),
) as { benignText: Benign[] }

// A real Gerber-check refusal panel line, as the aria snapshot gives it (captured from the app).
const GERBER_REFUSAL =
  '- text: "Gerber check — plots ChipBlocks output only. Drawn from the Gerber and Excellon strings Export ZIP would write, read back and plotted. Not the board view. Hidden empty files: board-B_Paste.gbp, board-B_Silkscreen.gbo (no bottom-mounted parts). Not plotted. Part of a file was skipped, and a partial picture would look finished. board-B_Cu.gbl: units are not millimetres (%MOMM*%) — nothing is plotted Not plotted (not a Gerber or drill file): board-job.gbrjob, bom.csv, placement.csv, board-stackup.txt, netlist.cir, validation-report.txt, README.txt." [ref=e41]'
const REFUSAL_SENTENCES = [
  'Not plotted.',
  'Part of a file was skipped, and a partial picture would look finished.',
  'board-B_Cu.gbl: units are not millimetres (%MOMM*%) — nothing is plotted',
]
// A content-pack refusal well past the old 200-character line cut.
const PACK_REFUSAL =
  'The pack file no longer matches its publisher signature, so it was edited after install. The signature does not verify against the canonical pack body under the declared ed25519 key. Treated as untrusted. Reinstall it from a file you trust.'

// The Content Manager panel after a pack file was edited (aria snapshot captured from the Electron app).
const TAMPERED_PANEL =
  '- dialog "Plugin and Content Manager":\n  - text: Plugin & Content Manager\n  - button "Close"\n  - paragraph: "Browse planned community libraries (cited from FINAL-STATE-VISION.md) and manage packs you install from a local file or from a content registry whose index URL you set. Not a marketplace — ChipBlocks does not download arbitrary remote code, and it does not ship a registry URL because no public registry exists. Install validates format + permissive license, checks an optional declared SHA-256 content hash (a malformed or non-sha256 declaration is refused, not treated as \\"no hash\\"), and records a file hash for reload tamper-evidence. A declared ed25519 signature is checked: invalid signatures are refused; a valid signature is self-declared integrity under the key in the pack, not a certificate authority. The desktop app reads ~/.chipblocks/trusted-publishers.json. No publisher keys ship as trusted. A valid signature is treated as trusted only when that key is pinned in the file. A missing file means no key is pinned. Undeclared is not verified."\n  - text: No publisher keys are pinned. There is no ~/.chipblocks/trusted-publishers.json yet, or it lists none. No key is trusted by default. Content registry No content registry is configured. ChipBlocks does not ship one, because no public registry exists. Paste an https index URL you choose. Nothing is downloaded until you install a pack. Registry index URL\n  - textbox "Content registry index URL"\n  - button "Save registry URL"\n  - button "Load registry index"\n  - text: Pack in the loaded index\n  - combobox "Pack in the loaded index":\n    - option "No pack chosen" [selected]\n  - button "Install from registry"\n  - button "Install from local pack…"\n  - text: "Pack \\"uic_pack\\": Pack file no longer matches the SHA-256 recorded at install (tamper or edit). Recorded ee5d5c48585783dc892899714cdef5e87ca48e17007bd7be49d7917d7a938bf6, got 45cebd9e5930172f3180ce4fd10343e77b0e52ebacb1f9331ad159bede602acd. Pack left unloaded. Installed & catalog"\n  - list:\n    - listitem:\n      - strong: UIC Pack\n      - text: "v1.0.0 MIT ENABLED · NOT LOADED ui-checks test pack (generated at test time). 1 part · source: local pack Pack \\"uic_pack\\": Pack file no longer matches the SHA-256 recorded at install (tamper or edit). Recorded ee5d5c48585783dc892899714cdef5e87ca48e17007bd7be49d7917d7a938bf6, got 45cebd9e5930172f3180ce4fd10343e77b0e52ebacb1f9331ad159bede602acd. Pack left unloaded. Publisher key fingerprint (SHA-256 of the raw ed25519 public key): 72cbc165b87909495d858868957f00b67722d3877129f9212401c17f4b1a08e2 Publisher signature is valid. This key is not pinned in trusted-publishers, so it is not treated as a publisher you chose."\n      - button "Trust this publisher…"\n      - button "Disable"\n      - button "Uninstall…"\n    - listitem:\n      - strong: chipblocks-audio\n      - text: "PLANNED · NOT INSTALLED Inaugural starter library: audio-domain block groups (oscillators, filters, ADSR, etc.). Planned community pack — not shipped as an in-app download. Cited: FINAL-STATE-VISION.md § community libraries table. Suggested license: MIT. Not available as an in-app download — author or obtain a local pack and use Install from local pack…"\n    - listitem:\n      - strong: chipblocks-peripherals\n      - text: "PLANNED · NOT INSTALLED SPI / I²C / UART / GPIO / PWM and phone-class peripheral block groups. Community-driven; install from a local pack when available. Cited: FINAL-STATE-VISION.md § community libraries table. Suggested license: MIT. Not available as an in-app download — author or obtain a local pack and use Install from local pack…"\n    - listitem:\n      - strong: chipblocks-cpus\n      - text: "PLANNED · NOT INSTALLED Packaged CPU cores (picorv32 first) conforming to a chipblocks CPU socket. Planned — not auto-downloaded. Cited: FINAL-STATE-VISION.md § community libraries table. Suggested license: Apache-2.0. Not available as an in-app download — author or obtain a local pack and use Install from local pack…"\n    - listitem:\n      - strong: chipblocks-radios\n      - text: "PLANNED · NOT INSTALLED OOK / audio-FSK / LoRa-style radio block groups. Planned community pack. Cited: FINAL-STATE-VISION.md § community libraries table. Suggested license: MIT. Not available as an in-app download — author or obtain a local pack and use Install from local pack…"\n    - listitem:\n      - strong: chipblocks-video\n      - text: "PLANNED · NOT INSTALLED Sprite engine, framebuffer, character generator, HDMI/DVI outputs. Future community pack. Cited: FINAL-STATE-VISION.md § community libraries table. Suggested license: MIT. Not available as an in-app download — author or obtain a local pack and use Install from local pack…"\n    - listitem:\n      - strong: chipblocks-experimental\n      - text: "PLANNED · NOT INSTALLED Anything-goes experimental grab bag. Install at your own risk — still requires a declared permissive license and local validation. Cited: FINAL-STATE-VISION.md § community libraries table. Suggested license: MIT. Not available as an in-app download — author or obtain a local pack and use Install from local pack…"'

const scratch = mkdtempSync(join(tmpdir(), 'cb-laya-input-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('compactForLaya keeps refusal text whole', () => {
  test('the Gerber refusal reaches Laya with every refusal sentence intact', async () => {
    const { compactForLaya } = await load()
    const state = compactForLaya(GERBER_REFUSAL, 1200, map.benignText)
    for (const s of REFUSAL_SENTENCES) expect(state).toContain(s)
    // the benign footer's 'Not plotted (not a Gerber or drill file)' is removed (its leftover file list
    // stays, exactly as the v2 checkpoint was trained on it)
    expect(state).not.toMatch(/not a Gerber or drill file/)
    expect(state).not.toContain('[ref=')
  })

  test('a long refusal message is not cut at the old 200-character line limit', async () => {
    const { compactForLaya, LAYA_LINE_CHARS } = await load()
    const line = `- paragraph: "Publisher signature did not verify when this pack was loaded. ${PACK_REFUSAL}"`
    expect(line.length).toBeGreaterThan(LAYA_LINE_CHARS)
    const state = compactForLaya(line, 1200, [])
    expect(state).toContain(PACK_REFUSAL)
  })

  test('a refusal at the end of an over-long panel survives; plain lines go first', async () => {
    const { compactForLaya } = await load()
    const filler = Array.from(
      { length: 80 },
      (_, i) => `- button "Catalog entry ${i} with a longer label" [ref=e${i}]`,
    )
    const aria = [
      '- heading "Content Manager" [level=2]',
      ...filler,
      `- paragraph: "ENABLED · NOT LOADED. ${PACK_REFUSAL}"`,
    ].join('\n')
    const state = compactForLaya(aria, 1200, [])
    expect(state.length).toBeLessThanOrEqual(1200)
    expect(state).toContain(`ENABLED · NOT LOADED. ${PACK_REFUSAL}`)
    expect(state.startsWith('heading Content Manager')).toBe(true)
    expect(state).toContain('\u2026') // the dropped plain lines are marked, not silently gone
  })

  test('a tampered pack keeps its ENABLED · NOT LOADED badge and reason in a full Content Manager panel', async () => {
    const { compactForLaya } = await load()
    expect(TAMPERED_PANEL.length).toBeGreaterThan(4000)
    const state = compactForLaya(TAMPERED_PANEL, 1200, map.benignText)
    expect(state.length).toBeLessThanOrEqual(1200)
    expect(state).toContain('ENABLED · NOT LOADED')
    expect(state).toContain(
      'Pack file no longer matches the SHA-256 recorded at install (tamper or edit).',
    )
    expect(state).toContain('Pack left unloaded.')
    expect(state).toContain('strong: UIC Pack') // the line naming the pack comes along
    // 64-char digests are shortened, not spent on Laya's 512 tokens
    expect(state).not.toMatch(/[0-9a-f]{24,}/)
    expect(state).toContain('ee5d5c48…')
    // the policy intro is not an alert: its benign 'refused' wording is stripped
    expect(state).not.toContain('declaration is refused')
  })

  test('a plain long line keeps the exact pre-fix format the v2 checkpoint was trained on', async () => {
    const { compactForLaya } = await load()
    const intro = `paragraph: ${'Browse planned community libraries and manage packs you install. '.repeat(6)}`
    const state = compactForLaya(`- ${intro}`, 1200, [])
    expect(state).toBe(`${intro.trim().slice(0, 200)} \u2026`)
  })

  test('a short state is passed through unchanged apart from aria noise', async () => {
    const { compactForLaya } = await load()
    const aria =
      '- heading "Test bench" [level=2] [ref=e1]\n- img\n- paragraph: "Result: PASS" [ref=e2]'
    expect(compactForLaya(aria, 1200, [])).toBe(
      'heading Test bench [level=2]\nparagraph: Result: PASS',
    )
  })

  test("the state never exceeds Laya's real token room, even when the text is dense", async () => {
    const m = await load()
    // 512-token model input minus the longest checkpoint question leaves >= 465 tokens of state
    expect(m.LAYA_STATE_TOKENS).toBeLessThanOrEqual(512 - 45)
    // A net list like this ran 1162 chars = 496 real v2 tokens under the old 1200-char cap, so Laya
    // itself cut its end off. Within 1200 chars is not enough; the token estimate has to hold too.
    const nets = Array.from(
      { length: 40 },
      (_, i) =>
        `- group: D Flip-Flop.q${i} ↔ rq${i}.terminal_a ↔ V1.terminal_negative ↔ dq${i}.cathode`,
    )
    const aria = ['- heading "Network overview" [level=3]', ...nets].join('\n')
    const state = m.compactForLaya(aria, 1200, [])
    expect(state.length).toBeLessThanOrEqual(1200)
    expect(m.estimateLayaTokens(state)).toBeLessThanOrEqual(m.LAYA_STATE_TOKENS)
    expect(state.startsWith('heading Network overview')).toBe(true)
    // a huge maxChars cannot push the state past the token room either
    const plain = Array.from({ length: 400 }, (_, i) => `- text: "plain line ${i}"`).join('\n')
    expect(m.estimateLayaTokens(m.compactForLaya(plain, 100000, []))).toBeLessThanOrEqual(
      m.LAYA_STATE_TOKENS,
    )
  })

  test('the token estimate is an upper bound on these known v2 tokenizer counts', async () => {
    const { estimateLayaTokens } = await load()
    // real counts from the laya-chipblocks-v2 tokenizer (measured once, offline): 2, 19, 5, 1
    const real: [string, number][] = [
      ['button OK', 2],
      ['group: D Flip-Flop.q ↔ rq0.terminal_a', 19],
      ['a'.repeat(40), 5],
      ['12345', 1],
    ]
    for (const [text, n] of real) expect(estimateLayaTokens(text)).toBeGreaterThanOrEqual(n)
  })

  test('shortenLine drops plain sentences, never alert ones, and marks the gap', async () => {
    const { shortenLine } = await load()
    const line = `text: ${'This is a plain sentence about the panel. '.repeat(8)}Install refused: the license is copyleft.`
    expect(line.length).toBeGreaterThan(200)
    const out = shortenLine(line, 200)
    expect(out).toContain('Install refused: the license is copyleft.')
    expect(out).toContain('\u2026')
    expect(out.startsWith('text: ')).toBe(true)
  })
})

describe('the Laya client hands the state to the sidecar intact', () => {
  test('a long compacted refusal arrives at the sidecar byte for byte', async () => {
    const { compactForLaya, Laya } = await load()
    const sidecar = join(scratch, 'echo-sidecar.mjs')
    writeFileSync(
      sidecar,
      [
        "import readline from 'node:readline'",
        "process.stderr.write('sidecar ready (echo)\\n')",
        "readline.createInterface({ input: process.stdin }).on('line', (line) => {",
        '  const r = JSON.parse(line)',
        '  const answers = Object.fromEntries(Object.keys(r.questions).map((k) => [k, { noul: 0.5 }]))',
        '  process.stdout.write(JSON.stringify({ id: r.id, answers, echo: r.state }) + "\\n")',
        '})',
      ].join('\n'),
    )
    const laya = new Laya({ python: process.execPath, sidecar, readyTimeoutMs: 20000 })
    laya.start()
    try {
      const state = compactForLaya(
        `- heading "Gerber check" [level=2]\n${GERBER_REFUSAL}`,
        1200,
        map.benignText,
      )
      const res = await laya.ask(state, [{ id: 'refusal', q: 'Is a refusal shown?' }])
      expect(res.error).toBeUndefined()
      expect(res.echo).toBe(state)
      for (const s of REFUSAL_SENTENCES) expect(res.echo).toContain(s)
      expect(res.answers?.refusal?.noul).toBe(0.5)
    } finally {
      laya.stop()
    }
  }, 30000)
})
