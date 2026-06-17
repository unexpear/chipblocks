import { all, create } from 'mathjs'

/**
 * The one mathjs instance for the whole app. mathjs's create() builds its entire function table, so
 * every consumer — the equation evaluator, the unit-checking cross-FK validator, the complex-MNA AC
 * analyzer, and the time-domain solvers — shares this single configured instance rather than each
 * standing up its own identical copy.
 */
// biome-ignore lint/style/noNonNullAssertion: mathjs's `all` is always defined at runtime; its type declaration lists it as possibly undefined.
export const mathInstance = create(all!)
