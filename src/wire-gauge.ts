/**
 * AWG (American Wire Gauge) → real conductor geometry — the single source of truth for
 * conductor cross-sections, shared by wire resistance (renderer/wire-length.ts) and the
 * motor winding's resistance (motor-model.ts). The gauge is geometric, not a lookup:
 * each step scales the diameter by the 39th root of 92, so d = 0.005 in · 92^((36 − n)/39)
 * and the area follows from π·d²/4 (ASTM B258 / the standard AWG ratio). Lower number =
 * thicker wire; −6 gauges is ≈ 4× the copper.
 */

export const INCH_M = 0.0254

export function awgDiameterM(awg: number): number {
  return 0.005 * 92 ** ((36 - awg) / 39) * INCH_M
}

export function awgAreaM2(awg: number): number {
  const d = awgDiameterM(awg)
  return (Math.PI / 4) * d ** 2
}

/** Annealed copper resistivity at 20 °C, Ω·m (CRC Handbook of Chemistry & Physics). */
export const COPPER_RESISTIVITY_OHM_M = 1.68e-8
