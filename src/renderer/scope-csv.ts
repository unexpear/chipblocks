/**
 * CSV export of a scope sweep (S19-v3-82; unit-aware S19-v3-83) — exactly the
 * displayed data, one row per sample: the time column counts from the trigger
 * instant (t = 0, pre-trigger history negative — matching the axis on
 * screen), then one column per trace with its unit in the header (volts for
 * probes, amps for clamps, watts for a V×I math trace). Numbers use
 * JavaScript's locale-independent representation ('.' decimal point), so the
 * file opens the same everywhere.
 */

export type CsvColumn = { label: string; unit: string; values: number[] }

/** Quote a header field the CSV way when it needs it. */
function csvField(text: string): string {
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function scopeCsv(timesSeconds: number[], tZero: number, columns: CsvColumn[]): string {
  const header = ['time_s', ...columns.map((c) => csvField(`${c.label} (${c.unit})`))].join(',')
  const rows = timesSeconds.map((time, i) => {
    const cells = [String(time - tZero), ...columns.map((c) => String(c.values[i] ?? 0))]
    return cells.join(',')
  })
  return [header, ...rows].join('\n')
}
