import { useMemo, useState } from 'react'
import type { World } from '../cross-fk-validator.ts'
import { groundedComponent } from './canvas-to-world.ts'

/**
 * The 2-port S-parameter tool (analog-RF), a sibling of useReflection but WITHOUT a canvas probe: a 2-port
 * measurement needs two named ports, chosen from dropdowns in the panel, so there is no terminal-pick click
 * chain to wire — only the panel-open state, the two chosen port ids, and the grounded world the sweep runs on.
 */
export function useSParam(deps: { solvedWorld: World }) {
  const { solvedWorld } = deps
  const [sparamOpen, setSparamOpen] = useState(false)
  const [sparamPort1, setSparamPort1] = useState('')
  const [sparamPort2, setSparamPort2] = useState('')
  const sparamWorld = useMemo(() => groundedComponent(solvedWorld), [solvedWorld])

  return {
    sparamOpen,
    setSparamOpen,
    sparamPort1,
    setSparamPort1,
    sparamPort2,
    setSparamPort2,
    sparamWorld,
  }
}
