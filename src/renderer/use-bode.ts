import { type MouseEvent as ReactMouseEvent, useCallback, useMemo, useState } from 'react'
import type { World } from '../cross-fk-validator.ts'
import { groundedComponent } from './canvas-to-world.ts'
import type { Tool } from './toolbar.tsx'

/**
 * The Bode (frequency-response) tool, lifted out of the Canvas component: the panel-open + output-net
 * + pick-mode state, the grounded world the AC sweep runs on, and the output-picking click handler
 * (in "pick" mode a terminal click sets the output node — the frequency-domain answer to the scope's
 * probe clicks — then leaves pick mode). Everything moved here VERBATIM; the couplings to the canvas —
 * the warm solved world and the active tool — are injected, so behaviour is unchanged.
 */
export function useBode(deps: { solvedWorld: World; tool: Tool }) {
  const { solvedWorld, tool } = deps
  const [bodeOpen, setBodeOpen] = useState(false)
  const [bodeOutputNet, setBodeOutputNet] = useState('')
  const [bodePicking, setBodePicking] = useState(false)
  // The grounded world for the AC engine — same one the other solvers run on; memoized so
  // the Bode sweep only re-runs when the circuit actually changes, not on every render.
  const bodeWorld = useMemo(() => groundedComponent(solvedWorld), [solvedWorld])
  // Bode output picking: while the Bode panel is in "pick" mode, a terminal click on the
  // canvas sets the output node (resolved through the same grounded world the sweep uses),
  // then leaves pick mode — the frequency-domain answer to the scope's probe clicks.
  const onBodeProbeClick = useCallback(
    (event: ReactMouseEvent): boolean => {
      if (!bodeOpen || !bodePicking || tool !== 'select') return false
      const handleEl = (event.target as Element).closest?.(
        '.react-flow__handle',
      ) as HTMLElement | null
      const nodeId = handleEl?.dataset.nodeid
      const handleId = handleEl?.dataset.handleid
      if (nodeId === undefined || handleId === undefined) return false
      const net = bodeWorld.instances
        .get(nodeId)
        ?.connects?.find((c) => c.terminal === handleId)?.net
      if (net === undefined) return false
      setBodeOutputNet(net)
      setBodePicking(false)
      event.stopPropagation()
      return true
    },
    [bodeOpen, bodePicking, tool, bodeWorld],
  )

  return {
    bodeOpen,
    setBodeOpen,
    bodeOutputNet,
    setBodeOutputNet,
    bodePicking,
    setBodePicking,
    bodeWorld,
    onBodeProbeClick,
  }
}
