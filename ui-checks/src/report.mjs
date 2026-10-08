// Markdown + JSON report writer.
import fs from 'node:fs'
import path from 'node:path'

const local = (iso) =>
  `${new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'medium' })} ET`
const rel = (outDir, p) => (p ? path.relative(outDir, p).replace(/\\/g, '/') : '')

export function writeReports(run, map, outDir) {
  const totals = { pass: 0, fail: 0, skip: 0, known: 0, cats: {} }
  for (const w of run.workflows)
    for (const s of w.steps) {
      totals[s.status]++
      if (s.status === 'fail') totals.cats[s.category] = (totals.cats[s.category] ?? 0) + 1
    }
  totals.failByCategory =
    Object.entries(totals.cats)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ') || 'no failures'
  const flags = run.workflows.flatMap((w) => w.laya.flags.map((f) => ({ wf: w.name, ...f })))
  const layaRuns = run.workflows.flatMap((w) => w.laya.runs)
  const answers = layaRuns.flatMap((r) => r.answers)
  const L = []
  L.push(`# ChipBlocks UI click-through report`)
  L.push('')
  L.push(`- When: ${local(run.startedAt)} · took ${(run.ms / 1000).toFixed(1)} s`)
  if (run.target === 'electron')
    L.push(
      `- App: commit \`${run.commit}\` — the real Electron app (${run.browser}, built renderer over file://; ${run.build?.built ? `built by the runner in ${(run.build.ms / 1000).toFixed(1)} s` : `no rebuild: ${run.build?.reason}`}). One fresh sandbox (home, userData, Documents/Desktop/Downloads) per workflow, checked before any step runs; native dialogs stubbed in the main process.`,
    )
  else
    L.push(
      `- App: commit \`${run.commit}\` served by the browser-only dev server at ${run.url}${run.devServer?.started ? ' (started and stopped by the runner)' : ' (already running)'}`,
    )
  L.push(
    `- Result: **${totals.pass} pass · ${totals.fail} fail · ${totals.known} known issue · ${totals.skip} skip** — failures by category: ${totals.failByCategory}`,
  )
  L.push(
    `- Laya (advisory only): ${run.laya.enabled ? `on — ${run.laya.calls} batched calls, avg round trip ${run.laya.avgRoundtripMs} ms, cold start ${run.laya.coldMs} ms; ${answers.length} answers, ${answers.filter((a) => a.agree).length} agree with the asserts; **${flags.length} 'take a look' flags** (disagreement at ≥ ${run.laya.flagAt})` : `off (${run.laya.reason})`}`,
  )
  L.push('')
  L.push(
    '`known` = a step tagged `knownIssue` that still fails: evidence is saved but the run stays green. Failure categories: `assert`/`invariant` = the app did not do what the map says (suspected app issue); `unreachable` = the control exists but is covered or off-screen (layout issue); `console` = console.error / page error (and main-process errors in Electron); `crash` = error boundary or blank root; `dialog` = (Electron) an error box or a native dialog the step did not expect; `precondition`; `driver` = the runner itself could not drive (should be zero).',
  )
  L.push('')
  L.push('## Workflows')
  L.push('')
  L.push('| workflow | pass | fail | known | skip | time |')
  L.push('|---|---|---|---|---|---|')
  for (const w of run.workflows) {
    const c = (st) => w.steps.filter((s) => s.status === st).length
    L.push(
      `| [${w.name}](#${w.name}) | ${c('pass')} | ${c('fail')} | ${c('known')} | ${c('skip')} | ${(w.ms / 1000).toFixed(1)} s |`,
    )
  }
  for (const w of run.workflows) {
    L.push('')
    L.push(`### ${w.name}`)
    L.push('')
    L.push(
      `${w.title}. Viewport ${w.viewport.width}×${w.viewport.height}.${w.notes ? ` ${w.notes}` : ''}`,
    )
    L.push('')
    if (w.electron)
      L.push(
        `Electron: ${w.electron.launches} launch(es), last ${w.electron.launchMs} ms; sandbox ${w.sandbox.kept ? `kept at \`${w.sandbox.root}\`` : 'removed'}; app folders verified inside it: ${Object.keys(w.electron.isolatedPaths).join(', ')}.`,
        '',
      )
    L.push('| step | result | why / detail | ms |')
    L.push('|---|---|---|---|')
    for (const s of w.steps) {
      const asserts = s.asserts.filter((a) => a.kind === 'expect').length
      const inv = s.invariants.filter((i) => !i.global && !i.vacuous).length
      let why =
        s.reason ??
        `${asserts} assert${asserts === 1 ? '' : 's'}, ${inv} screen invariant${inv === 1 ? '' : 's'}, crash watch ok`
      if (s.status === 'fail') why = `**${s.category}**: ${why}`
      if (s.status === 'known')
        why = `known issue _${s.knownIssue}_ (does not fail the run) — ${s.category}: ${why}`
      if (s.note) why += ` — ${s.note}`
      if (s.artifacts)
        why += ` — artifacts: ${['screenshot', 'panelText', 'dom', 'console', 'electron']
          .filter((k) => s.artifacts[k])
          .map((k) => `[${k}](${rel(outDir, s.artifacts[k])})`)
          .join(' ')}`
      if (s.laya?.answers)
        why += ` — Laya: ${s.laya.answers.map((a) => `${a.id} ${a.agree ? 'agrees' : `disagrees (p=${a.layaP})`}${a.flag ? ' ⚑' : ''}`).join(', ')}`
      L.push(
        `| ${s.id} — ${s.title} | ${s.status.toUpperCase()} | ${why.replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${s.ms} |`,
      )
    }
    L.push('')
    L.push(
      `Console: ${w.console.errors} error(s) (${w.console.benignErrors} known-benign), ${w.console.warnings} warning(s)${w.console.http4xx.length ? `; HTTP ≥400: ${[...new Set(w.console.http4xx)].join(', ')}` : ''}.`,
    )
  }
  L.push('')
  L.push(`## Laya 'take a look' flags (${flags.length})`)
  L.push('')
  if (!flags.length) L.push('None. (Laya never disagreed with an assert at ≥ 0.9.)')
  else
    for (const f of flags)
      L.push(
        `- ${f.wf} › ${f.step} (${f.screen}): “${f.q}” — assert says **${f.assertSays ? 'yes' : 'no'}**, Laya says ${f.layaSays ? 'yes' : 'no'} at ${f.conf}. The assert decides; look at the panel if in doubt.`,
      )
  L.push('')
  L.push(run.target === 'electron' ? '## Skipped' : '## Skipped (browser-only dev server)')
  L.push('')
  const skips = run.workflows.flatMap((w) =>
    w.steps.filter((s) => s.status === 'skip').map((s) => `- ${w.name} › ${s.id}: ${s.reason}`),
  )
  L.push(skips.length ? skips.join('\n') : 'None.')
  L.push('')
  if (run.target === 'electron') {
    L.push('Not exercised in Electron mode (from the app map):')
    for (const e of map.electron?.notCovered ?? []) L.push(`- ${e.feature} — ${e.why}`)
  } else {
    L.push(
      'Not exercised at all in the browser (from the app map; `npm run ui-checks:electron` covers them):',
    )
    for (const e of map.electronOnly) L.push(`- ${e.feature} — ${e.skip}`)
  }
  const md = path.join(outDir, 'report.md')
  const json = path.join(outDir, 'report.json')
  fs.writeFileSync(md, `${L.join('\n')}\n`, 'utf8')
  fs.writeFileSync(json, JSON.stringify({ ...run, totals }, null, 2), 'utf8')
  return { md, json, totals }
}
