import {
  type AcLossSlot,
  partsDroppedFromAcSolve,
  partsSolvedAsPerfectReactance,
} from '../ac-analysis.ts'
import type { World } from '../cross-fk-validator.ts'
import { defaultParameters } from './part-defaults.ts'
import { THEME } from './theme.ts'

/**
 * The "no loss was declared" line the three AC panels (Bode, Reflection, S-parameters) carry.
 *
 * The AC engine reads whatever loss a part declares — a coil's winding resistance, a capacitor's ESR or
 * dissipation factor, a transformer's winding + core resistances, a line's series R and dielectric loss. A loss
 * that is NOT declared is solved as PERFECT, because inventing a plausible ESR for it would be a fabricated
 * value. But a circuit of perfect reactances returns numbers no physical circuit can reach (an unbounded return
 * loss, a VSWR of exactly 1, a Q with no ceiling), so the number alone would mislead. This names what is
 * responsible, right under the plot that is reading too good because of it.
 *
 * It reports per LOSS, not per part: a transformer that declares its core loss still has two windings being
 * solved as zero-resistance copper, and it is named for those.
 *
 * IT ALSO SEPARATES A ZERO SOMEONE CHOSE FROM A ZERO THAT SHIPPED. An instance carries no record of who set a
 * value, so the only evidence of intent available is whether the value DIFFERS from the part's shipped default:
 *   • a 0 where the part ships a real number (a coil zeroed from its 32 Ω datasheet DCR) — the user typed that
 *     zero to mean "ideal", and is not nagged about it;
 *   • a 0 that IS the shipped default (the transmission line's series_resistance, shunt_conductance and
 *     loss_tangent all ship as 0) — nobody chose anything, the part simply arrived lossless, and saying
 *     "the user meant ideal" about it would be putting words in their mouth. Those are called out.
 * The rule errs toward speaking up: a user who deliberately re-types the zero that was already there is told
 * something they already know, which is the harmless direction to be wrong in.
 */

/** The shipped default amount for a parameter, or undefined if the part ships no value for it. Cached per
 *  definition — defaultParameters deep-copies on every call. */
const defaultAmounts = new Map<string, Map<string, number>>()
function shippedDefaultAmount(definition: string, parameter: string): number | undefined {
  let amounts = defaultAmounts.get(definition)
  if (amounts === undefined) {
    amounts = new Map()
    for (const [key, param] of Object.entries(defaultParameters(definition))) {
      const value = param?.value as { kind?: string; amount?: number } | undefined
      if (value?.kind === 'scalar' && typeof value.amount === 'number')
        amounts.set(key, value.amount)
    }
    defaultAmounts.set(definition, amounts)
  }
  return amounts.get(parameter)
}

/**
 * How a loss that the engine will solve as perfect came to be that way — which decides whether the user hears
 * about it. 'chosen' is the only silent one: a zero typed over a shipped non-zero is a deliberate "ideal".
 */
function slotOrigin(definition: string, slot: AcLossSlot): 'absent' | 'shipped-zero' | 'chosen' {
  if (slot.declaredZero.length === 0) return 'absent'
  const overridesAShippedValue = slot.declaredZero.some((parameter) => {
    const shipped = shippedDefaultAmount(definition, parameter)
    return shipped !== undefined && shipped > 0
  })
  return overridesAShippedValue ? 'chosen' : 'shipped-zero'
}

const listOf = (names: string[]): string => {
  const shown = names.slice(0, 6).join(', ')
  return names.length > 6 ? `${shown} and ${names.length - 6} more` : shown
}
const partWithParameters = (id: string, slots: AcLossSlot[]): string =>
  `${id} (${slots.flatMap((s) => s.parameters).join(' / ')})`

/** The sentence(s) for everything the AC solve is treating as ideal or leaving out, or null when there is
 *  nothing to say — every reactive part declares every loss it can carry, and no part was dropped. */
export function acLossNoticeText(world: World): string | null {
  const undeclared: string[] = []
  const shippedZero: string[] = []
  for (const part of partsSolvedAsPerfectReactance(world)) {
    const byOrigin = (origin: 'absent' | 'shipped-zero') =>
      part.slots.filter((slot) => slotOrigin(part.definition, slot) === origin)
    const absent = byOrigin('absent')
    const shipped = byOrigin('shipped-zero')
    if (absent.length > 0) undeclared.push(partWithParameters(part.id, absent))
    if (shipped.length > 0) shippedZero.push(partWithParameters(part.id, shipped))
  }
  const dropped = partsDroppedFromAcSolve(world)

  const sentences: string[] = []
  if (undeclared.length > 0) {
    const plural = undeclared.length > 1
    sentences.push(
      `No loss declared for ${listOf(undeclared)} — solved as ${plural ? 'perfect reactances' : 'a perfect reactance'}, so these curves read better than any real part can. Nothing is assumed for ${plural ? 'them' : 'it'}: loss is used only where the part declares it.`,
    )
  }
  if (shippedZero.length > 0) {
    sentences.push(
      `${listOf(shippedZero)} ${shippedZero.length > 1 ? 'declare' : 'declares'} 0 there, which is the value the part SHIPPED with rather than a measured one — so ${shippedZero.length > 1 ? 'they are' : 'it is'} solved lossless by default, not by choice.`,
    )
  }
  for (const part of dropped) {
    sentences.push(
      `${part.id} is LEFT OUT of the AC solve entirely — ${part.reason}. Its impedance and every loss it declares are absent from these curves.`,
    )
  }
  return sentences.length === 0 ? null : sentences.join(' ')
}

export function AcLossNotice({ world, light }: { world: World; light: boolean }) {
  const text = acLossNoticeText(world)
  if (text === null) return null
  return (
    <div
      style={{
        color: light ? THEME.textFaint : THEME.textMuted,
        borderLeft: `2px solid ${THEME.lensTemp}`,
        paddingLeft: 6,
        fontSize: 10,
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  )
}
