import { type ReactFlowState, useStore } from '@xyflow/react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Portalling into React Flow's label and viewport layers without asking the DOM where they are.
 *
 * THE DEFECT THIS EXISTS FOR, measured rather than reasoned. React Flow's own `EdgeLabelRenderer`
 * subscribes to its store with the selector `s.domNode?.querySelector('.react-flow__edgelabel-renderer')`
 * (node_modules/@xyflow/react/dist/esm/index.js:3694), and React re-runs every subscription's selector on
 * every store check. One `EdgeLabelRenderer` is mounted per wire that has anything to show, so the number
 * of depth-first walks of the whole document is (wires showing a label) x (store checks) — and each walk
 * grows with the document.
 *
 * A V8 sampling profile of the built app drawing 2,000 grouped blocks / 3,400 wires at grid pitch 10,
 * through the launcher (C:/Users/micha/AppData/Local/Temp/claude/qs/qs-before-b2000w3400p10.json): native
 * `querySelector` self time 27,064 ms of a 45,205 ms draw, of which 26,946 ms is attributed to that one
 * selector — 60 % of the whole draw in a line that asks the same question 295,227 times and gets the same
 * answer every time (call tally: .../qs/qs-count-b2000w3400p10.json).
 *
 * The answer cannot change without the container being replaced, so it is resolved once per flow element
 * and kept. What is subscribed to instead is `s.domNode` itself, which is an identity read: the selector
 * still re-runs on every store check, but it now returns the same reference without touching the DOM, so
 * React skips the re-render exactly as it did before. Nothing about what gets portalled, or where, changes.
 */

const containersByFlowElement = new WeakMap<object, Map<string, { isConnected: boolean }>>()

/**
 * The container of the given class inside one flow, looked up on first use and remembered after.
 *
 * WHY the cached element is re-checked for being connected rather than trusted outright: React Flow
 * re-uses the outer `.react-flow` element across a remount of its inner viewport, and a remount builds a
 * fresh container div while leaving the key we cache under unchanged. `isConnected` is a flag read, not a
 * tree walk, so a stale entry is caught for nothing and re-resolved. A miss is never cached, so a lookup
 * made before React Flow has committed its viewport behaves exactly as it does today: null, then resolved
 * on the re-render that setting `domNode` causes.
 */
export function resolveFlowContainer<ContainerType extends { isConnected: boolean }>(
  flowElement: { querySelector: (selectors: string) => ContainerType | null } | null | undefined,
  containerClassName: string,
): ContainerType | null {
  if (!flowElement) return null
  let containersByClassName = containersByFlowElement.get(flowElement)
  if (containersByClassName === undefined) {
    containersByClassName = new Map()
    containersByFlowElement.set(flowElement, containersByClassName)
  }
  const cached = containersByClassName.get(containerClassName)
  if (cached?.isConnected) return cached as ContainerType
  const found = flowElement.querySelector(`.${containerClassName}`)
  if (found === null) return null
  containersByClassName.set(containerClassName, found)
  return found
}

const selectFlowElement = (state: ReactFlowState) => state.domNode

/** Drop-in for React Flow's `EdgeLabelRenderer`: same container, same children, one lookup per canvas. */
export function EdgeLabelPortal({ children }: { children: ReactNode }) {
  const flowElement = useStore(selectFlowElement)
  const container = resolveFlowContainer(flowElement, 'react-flow__edgelabel-renderer')
  if (container === null) return null
  return createPortal(children, container)
}

/** Drop-in for React Flow's `ViewportPortal`: same container, same children, one lookup per canvas. */
export function FlowViewportPortal({ children }: { children: ReactNode }) {
  const flowElement = useStore(selectFlowElement)
  const container = resolveFlowContainer(flowElement, 'react-flow__viewport-portal')
  if (container === null) return null
  return createPortal(children, container)
}
