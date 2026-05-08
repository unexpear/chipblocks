/**
 * Manual eval script for the ChipBlocks AI consultant.
 *
 * Sends the 7 smoke-test queries from SPRINT-8.md to the Anthropic API
 * with the same system prompt and tools the Electron renderer uses, and
 * grades each response with a permissive substring/tool-use check. Output
 * goes to stdout and `eval-results.md` at the repo root.
 *
 * Imports the prompt module directly from the frontend package
 * (path option A in the Sprint 9 brief): the module's runtime deps are
 * just the PALETTE constant, so cross-boundary import works once
 * NODE_PATH points at frontend/node_modules.
 *
 * Run from the frontend directory so npx + node module resolution find
 * the @anthropic-ai/sdk dep:
 *
 *   bash:
 *     cd frontend
 *     NODE_PATH=node_modules \
 *     ANTHROPIC_API_KEY=sk-ant-... \
 *     npx tsx ../scripts/eval-ai.ts
 *
 *   PowerShell:
 *     cd frontend
 *     $env:NODE_PATH = "node_modules"
 *     $env:ANTHROPIC_API_KEY = "sk-ant-..."
 *     npx tsx ../scripts/eval-ai.ts
 *
 * Exit code: 0 if all 7 grades pass, 1 otherwise (also 1 if no API key).
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import {
  STATIC_SYSTEM,
  buildSystemBlocks,
  buildTools,
} from '../frontend/src/ai/prompt'
import type { AppNode } from '../frontend/src/blocks'
import type { Edge } from '@xyflow/react'

const MODEL = 'claude-sonnet-4-6'

// "Two oscillators mixed" — the canonical fixture, mirrors the bundled
// example in frontend/src/examples.ts. Inlined so this script doesn't
// need to import the React-Flow-typed examples module at runtime.
const FIXTURE_NODES: AppNode[] = [
  { id: 'osc1',  type: 'oscillator', position: { x: 50,  y: 60  }, data: { freq: 440 } },
  { id: 'osc2',  type: 'sawtooth',   position: { x: 50,  y: 220 }, data: { freq: 660 } },
  { id: 'mixer', type: 'mixer',      position: { x: 400, y: 130 }, data: {} },
  { id: 'out',   type: 'output',     position: { x: 700, y: 130 }, data: {} },
]
const FIXTURE_EDGES: Edge[] = [
  { id: 'e1', source: 'osc1',  target: 'mixer', sourceHandle: 'audio-out', targetHandle: 'in-1' },
  { id: 'e2', source: 'osc2',  target: 'mixer', sourceHandle: 'audio-out', targetHandle: 'in-2' },
  { id: 'e3', source: 'mixer', target: 'out',   sourceHandle: 'mix-out',   targetHandle: 'audio-in' },
]

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

interface QueryResult {
  index: number
  question: string
  text: string
  toolUses: ToolUseBlock[]
  status: 'pass' | 'fail'
  expectedDescription: string
}

type Grader = (text: string, toolUses: ToolUseBlock[]) => boolean

interface QuerySpec {
  question: string
  expectedDescription: string
  grade: Grader
}

const ci = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.toLowerCase())

const QUERIES: QuerySpec[] = [
  {
    question: 'Where do I click to play the audio?',
    expectedDescription: 'Mentions "Play" button or "click play"',
    grade: (text) =>
      ci(text, '▶ Play') || ci(text, 'Play button') || ci(text, 'click play'),
  },
  {
    question: 'Save my graph',
    expectedDescription: 'Mentions Save button or chipblocks-graph or Save+JSON',
    grade: (text) =>
      ci(text, 'Save button') ||
      ci(text, 'chipblocks-graph') ||
      (ci(text, 'Save') && ci(text, 'json')),
  },
  {
    question: 'Build me a kick drum',
    expectedDescription: 'Mentions Gate, an oscillator (or sine), ADSR, and Output',
    grade: (text) =>
      ci(text, 'Gate') &&
      (ci(text, 'oscillator') || ci(text, 'sine')) &&
      ci(text, 'ADSR') &&
      ci(text, 'Output'),
  },
  {
    question: "What's the cutoff range for the low-pass filter?",
    expectedDescription: 'Includes the numbers 1, 22050, and the 800 default',
    grade: (text) => ci(text, '1') && ci(text, '22050') && ci(text, '800'),
  },
  {
    question: 'Can I export to MIDI?',
    expectedDescription: 'Acknowledges MIDI is not supported in v0.1',
    grade: (text) =>
      ci(text, 'not yet') ||
      ci(text, "doesn't support MIDI") ||
      ci(text, 'no MIDI') ||
      ci(text, 'not in v0.1'),
  },
  {
    question: 'Add a sawtooth at 110 Hz to my mixer',
    expectedDescription:
      'Calls add_node with type "sawtooth" and 110 in input.data.freq',
    grade: (_text, toolUses) =>
      toolUses.some((tu) => {
        if (tu.name !== 'add_node') return false
        const input = tu.input as { type?: unknown; data?: Record<string, unknown> }
        if (input.type !== 'sawtooth') return false
        const freq = input.data?.freq
        return freq === 110 || freq === '110'
      }),
  },
  {
    question: "Why doesn't my graph play?",
    expectedDescription:
      'Mentions Output and one of "wired" / "missing" / "exactly one"',
    grade: (text) =>
      ci(text, 'Output') &&
      (ci(text, 'wired') || ci(text, 'missing') || ci(text, 'exactly one')),
  },
]

function ensureApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || !key.trim()) {
    process.stderr.write(
      'ANTHROPIC_API_KEY is not set.\n' +
        '\n' +
        'Set it for this command (bash):\n' +
        '  cd frontend\n' +
        '  NODE_PATH=node_modules ANTHROPIC_API_KEY=sk-ant-... npx tsx ../scripts/eval-ai.ts\n' +
        '\n' +
        'Or in PowerShell:\n' +
        '  cd frontend\n' +
        '  $env:NODE_PATH = "node_modules"\n' +
        '  $env:ANTHROPIC_API_KEY = "sk-ant-..."\n' +
        '  npx tsx ../scripts/eval-ai.ts\n' +
        '\n' +
        'Get a key at https://console.anthropic.com/.\n',
    )
    process.exit(1)
  }
  return key
}

async function runQuery(
  client: Anthropic,
  query: QuerySpec,
  index: number,
): Promise<QueryResult> {
  const system = buildSystemBlocks(FIXTURE_NODES, FIXTURE_EDGES) as Anthropic.TextBlockParam[]
  const tools = buildTools() as Anthropic.Tool[]

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    tools,
    messages: [{ role: 'user', content: query.question }],
  })

  let text = ''
  const toolUses: ToolUseBlock[] = []
  for (const block of response.content) {
    if (block.type === 'text') {
      text += block.text
    } else if (block.type === 'tool_use') {
      toolUses.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: (block.input as Record<string, unknown>) ?? {},
      })
    }
  }

  const passed = query.grade(text, toolUses)
  return {
    index,
    question: query.question,
    text,
    toolUses,
    status: passed ? 'pass' : 'fail',
    expectedDescription: query.expectedDescription,
  }
}

function formatReport(results: QueryResult[]): string {
  const passCount = results.filter((r) => r.status === 'pass').length
  const lines: string[] = []
  lines.push(`# AI Consultant Eval — ${new Date().toISOString()}`)
  lines.push('')
  lines.push(`Model: ${MODEL}`)
  lines.push(`Pass rate: ${passCount}/${results.length}`)
  lines.push('')
  lines.push(
    `Fixture: "Two oscillators mixed" (${FIXTURE_NODES.length} nodes, ${FIXTURE_EDGES.length} edges).`,
  )
  lines.push(`System-prompt size (static portion): ${STATIC_SYSTEM.length} chars.`)
  lines.push('')

  for (const r of results) {
    const mark = r.status === 'pass' ? 'PASS' : 'FAIL'
    lines.push(`## ${r.index}. ${r.question}`)
    lines.push('')
    lines.push(`**Status:** ${mark}`)
    lines.push(`**Expected:** ${r.expectedDescription}`)
    if (r.toolUses.length > 0) {
      lines.push('**Tool calls:**')
      lines.push('')
      lines.push('```json')
      lines.push(
        JSON.stringify(
          r.toolUses.map((tu) => ({ name: tu.name, input: tu.input })),
          null,
          2,
        ),
      )
      lines.push('```')
    }
    lines.push('**Response:**')
    lines.push('')
    lines.push(r.text.trim() || '_(no text response)_')
    lines.push('')
  }

  return lines.join('\n')
}

async function main() {
  const apiKey = ensureApiKey()
  const client = new Anthropic({ apiKey })

  const results: QueryResult[] = []
  for (let i = 0; i < QUERIES.length; i++) {
    const query = QUERIES[i]
    process.stderr.write(`[${i + 1}/${QUERIES.length}] ${query.question}\n`)
    try {
      const result = await runQuery(client, query, i + 1)
      process.stderr.write(`        -> ${result.status.toUpperCase()}\n`)
      results.push(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      process.stderr.write(`        -> ERROR: ${message}\n`)
      results.push({
        index: i + 1,
        question: query.question,
        text: `(API error: ${message})`,
        toolUses: [],
        status: 'fail',
        expectedDescription: query.expectedDescription,
      })
    }
  }

  const report = formatReport(results)
  process.stdout.write(report)
  process.stdout.write('\n')

  // Write a copy alongside the repo root.
  // The script lives at <repo>/scripts/eval-ai.ts; the output goes one
  // directory up.
  const outPath = join(import.meta.dirname ?? __dirname ?? '.', '..', 'eval-results.md')
  writeFileSync(outPath, report + '\n', 'utf8')
  process.stderr.write(`\nReport written to ${outPath}\n`)

  const allPassed = results.every((r) => r.status === 'pass')
  process.exit(allPassed ? 0 : 1)
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exit(1)
})
