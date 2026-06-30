/**
 * Newton-Raphson convergence constants, shared by the DC solver (dc-solver.ts) and the transient solver
 * (transient-solver.ts). They were defined identically in BOTH files; keeping one copy means tuning
 * convergence can't silently diverge the two — a real latent bug, since the DC operating point and the
 * transient final value must agree (the "transient settles to the DC solution" cross-check tests guard
 * exactly that). SPICE §20.6.
 */

/** Max Newton-Raphson iterations for one operating-point solve before declaring non-convergence. */
export const NR_MAX_ITERATIONS = 100

/** Node-voltage change (volts) below which a Newton step is converged (when no junction is still limited). */
export const NR_VOLTAGE_TOLERANCE = 1e-6
