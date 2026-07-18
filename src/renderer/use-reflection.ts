import { type MouseEvent as ReactMouseEvent, useCallback, useMemo, useState } from 'react'
import type { World } from '../cross-fk-validator.ts'
import { groundedComponent } from './canvas-to-world.ts'
import type { Tool } from './toolbar.tsx'

/**
 * The 1-port Reflection tool (analog-RF), the sibling of useBode: the panel-open + chosen-port + pick-mode
 * state, the grounded world the reflection sweep runs on, and the port-picking click handler. Where Bode's
 * probe picks an output NET, reflection's probe picks the PORT INSTANCE — a click on a source / reference-port
 * terminal selects that part as the port to look into — then leaves pick mode. Behaviour mirrors useBode so
 * the two tools feel identical.
 */
const PORT_DEFINITIONS = new Set(['power_source', 'reference_port'])

export function useReflection(deps: { solvedWorld: World; tool: Tool }) {
  const { solvedWorld, tool } = deps
  const [reflectionOpen, setReflectionOpen] = useState(false)
  const [reflectionPort, setReflectionPort] = useState('')
  const [reflectionPicking, setReflectionPicking] = useState(false)
  const reflectionWorld = useMemo(() => groundedComponent(solvedWorld), [solvedWorld])

  const onReflectionProbeClick = useCallback(
    (event: ReactMouseEvent): boolean => {
      if (!reflectionOpen || !reflectionPicking || tool !== 'select') return false
      const handleEl = (event.target as Element).closest?.(
        '.react-flow__handle',
      ) as HTMLElement | null
      const nodeId = handleEl?.dataset.nodeid
      if (nodeId === undefined) return false
      // The port must be a real driver (a source or a reference port) — those are the only parts the
      // reflection solve can energise. Clicking any other terminal is ignored (pick mode stays on).
      const inst = reflectionWorld.instances.get(nodeId)
      if (inst === undefined || !PORT_DEFINITIONS.has(inst.definition)) return false
      setReflectionPort(nodeId)
      setReflectionPicking(false)
      event.stopPropagation()
      return true
    },
    [reflectionOpen, reflectionPicking, tool, reflectionWorld],
  )

  return {
    reflectionOpen,
    setReflectionOpen,
    reflectionPort,
    setReflectionPort,
    reflectionPicking,
    setReflectionPicking,
    reflectionWorld,
    onReflectionProbeClick,
  }
}
