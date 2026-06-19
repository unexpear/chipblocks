import type { Instance } from './cross-fk-validator.ts'
import { readScalarParam } from './instance-params.ts'

/**
 * Electromagnet physics — the magnetic side of a coil, shared by the solvers (which
 * DERIVE its inductance from the same geometry that sets its field) and the renderer
 * (readings, Math card, the field lens). A coil is electrically an inductor; these
 * functions are what make it an electromagnet: the field it produces, the inductance
 * that field stores, and the mechanical pull that field exerts.
 */

/**
 * Vacuum permeability μ₀ (henry per metre). Since the 2019 SI redefinition it is a
 * measured constant, no longer exactly 4π×10⁻⁷ — CODATA gives 1.25663706×10⁻⁶ H/m (the
 * difference from 4π×10⁻⁷ is parts in 10⁹). The ONE magnetic-constant source for the
 * field lens, the electromagnet readings, and the coil-inductance derivation.
 */
export const MU_0 = 1.25663706e-6

/**
 * Magnetomotive force of a coil — the "ampere-turns" N·I (Ampère's law: the line
 * integral of H around the magnetic circuit equals the enclosed current, and N turns
 * each enclose I, so the total is N·I). This is what makes a coil an ELECTROMAGNET: a
 * single wire carries I, but winding it into N turns multiplies the driving force to
 * N·I — the whole point of the relay coil, the solenoid, the lifting magnet.
 */
export function magnetomotiveForceAmpereTurns(turns: number, amps: number): number {
  return Math.abs(turns * amps)
}

/**
 * Flux density B inside a long, cored solenoid — B = μ₀·μ_r·N·I / l_core (the MMF N·I
 * divided by the magnetic path length, scaled by the core's relative permeability μ_r:
 * ≈1 for air, hundreds–thousands for soft iron). The textbook solenoid result — the
 * same Ampère's law the field lens uses for a straight wire, closed around the core.
 *
 * Real iron SATURATES — its magnetic domains all line up and B stops climbing past
 * ~1.5–2 T no matter how much more current is pushed. When a saturation flux density
 * B_sat is given, the linear B is rolled off through B_sat·tanh(B_linear/B_sat):
 * identical to the linear law while B ≪ B_sat, then bending over toward the B_sat
 * asymptote. With no B_sat (an air core, which never saturates) the pure linear law is
 * returned.
 *
 * Honest scope: tanh is a smooth stand-in for a real B–H curve (which has a sharper
 * knee, plus hysteresis, not modeled here); assumes a long, uniformly-wound coil.
 */
export function solenoidFluxDensityTesla(
  turns: number,
  amps: number,
  relativePermeability: number,
  pathLengthMetres: number,
  saturationFluxDensityTesla?: number,
): number {
  if (!(pathLengthMetres > 0)) return 0
  const linear =
    (MU_0 * relativePermeability * magnetomotiveForceAmpereTurns(turns, amps)) / pathLengthMetres
  if (saturationFluxDensityTesla === undefined || !(saturationFluxDensityTesla > 0)) return linear
  return saturationFluxDensityTesla * Math.tanh(linear / saturationFluxDensityTesla)
}

/**
 * Self-inductance of a cored coil — L = μ₀·μ_r·N²·A / l (the standard solenoid result,
 * from the flux linkage N·Φ = N·B·A per unit current). ONE source of truth: the same N,
 * μ_r and geometry that set the field also set the inductance, so the two can never
 * disagree. This is the small-signal (unsaturated) inductance the linear solver uses;
 * real saturation lowers the large-signal L.
 */
export function coilInductanceHenries(
  turns: number,
  relativePermeability: number,
  coreAreaM2: number,
  pathLengthMetres: number,
): number {
  if (!(pathLengthMetres > 0)) return 0
  return (MU_0 * relativePermeability * turns * turns * coreAreaM2) / pathLengthMetres
}

/**
 * The pull an electromagnet exerts on a ferromagnetic armature across its pole face —
 * the Maxwell-stress / reluctance force F = B²·A / (2·μ₀), with A the pole area and B
 * the flux density at the gap. This is the HOLDING force, armature against the pole
 * (zero gap, the strongest case — an air gap drops B and so the force).
 */
export function magneticPullForceNewtons(fluxDensityTesla: number, poleAreaM2: number): number {
  if (!(poleAreaM2 > 0)) return 0
  return (fluxDensityTesla * fluxDensityTesla * poleAreaM2) / (2 * MU_0)
}

/**
 * The coil's inductance for the solver. An electromagnet DERIVES it from its geometry
 * (L = μ₀·μ_r·N²·A/l — one source of truth with its field); a plain inductor uses its
 * declared `inductance`. Returns undefined when the needed parameters are missing.
 */
export function coilInductanceFromInstance(inst: Instance): number | undefined {
  if (inst.definition === 'electromagnet') {
    const turns = readScalarParam(inst, 'turns')
    const relativePermeability = readScalarParam(inst, 'relative_permeability')
    const coreArea = readScalarParam(inst, 'core_area')
    const pathLength = readScalarParam(inst, 'magnetic_path_length')
    if (
      turns === undefined ||
      relativePermeability === undefined ||
      coreArea === undefined ||
      pathLength === undefined
    ) {
      return undefined
    }
    return coilInductanceHenries(turns, relativePermeability, coreArea, pathLength)
  }
  return readScalarParam(inst, 'inductance')
}
