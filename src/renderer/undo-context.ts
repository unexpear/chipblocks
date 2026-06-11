import { createContext } from 'react'

/**
 * The App's "record the canvas before this change" hook (S19-v3-73), shared
 * by components that mutate edges directly (NetEdge's corner add / drag) so
 * those edits land in the same undo timeline as everything else. The no-op
 * default keeps isolated renders (the block viewer's read-only canvas) safe.
 */
export const CheckpointContext = createContext<(tag: string) => void>(() => {})
