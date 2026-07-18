import { type MouseEvent as ReactMouseEvent, useCallback, useMemo, useState } from 'react'
import type { World } from '../cross-fk-validator.ts'
import { groundedComponent } from './canvas-to-world.ts'
import type { Tool } from './toolbar.tsx'

/**
 * The large-signal Distortion tool (analog-RF), a sibling of useBode / useReflection: the panel-open state,
 * the chosen drive SOURCE (set from the panel dropdown) and measured OUTPUT NET (set by the canvas probe),
 * pick-mode, and the grounded world the transient+FFT engine runs on. Its probe mirrors Bode's — a terminal
 * click picks the output NET being analysed for harmonics/compression — while the source it drives is chosen
 * in the panel, so the two together define "drive here, measure the distortion there".
 */
export function useDistortion(deps: { solvedWorld: World; tool: Tool }) {
  const { solvedWorld, tool } = deps
  const [distortionOpen, setDistortionOpen] = useState(false)
  const [distortionSource, setDistortionSource] = useState('')
  const [distortionOutputNet, setDistortionOutputNet] = useState('')
  const [distortionPicking, setDistortionPicking] = useState(false)
  const distortionWorld = useMemo(() => groundedComponent(solvedWorld), [solvedWorld])

  const onDistortionProbeClick = useCallback(
    (event: ReactMouseEvent): boolean => {
      if (!distortionOpen || !distortionPicking || tool !== 'select') return false
      const handleEl = (event.target as Element).closest?.(
        '.react-flow__handle',
      ) as HTMLElement | null
      const nodeId = handleEl?.dataset.nodeid
      const handleId = handleEl?.dataset.handleid
      if (nodeId === undefined || handleId === undefined) return false
      const net = distortionWorld.instances
        .get(nodeId)
        ?.connects?.find((c) => c.terminal === handleId)?.net
      if (net === undefined) return false
      setDistortionOutputNet(net)
      setDistortionPicking(false)
      event.stopPropagation()
      return true
    },
    [distortionOpen, distortionPicking, tool, distortionWorld],
  )

  return {
    distortionOpen,
    setDistortionOpen,
    distortionSource,
    setDistortionSource,
    distortionOutputNet,
    setDistortionOutputNet,
    distortionPicking,
    setDistortionPicking,
    distortionWorld,
    onDistortionProbeClick,
  }
}
