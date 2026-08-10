/**
 * One handler per channel, and a way to give exactly that handler back — the one decision, on its own so it
 * can be tested.
 *
 * The renderer keeps every open project MOUNTED (switching tabs only hides one and shows another), so several
 * copies of the canvas are alive at once and each of them would like to hear the File menu. Only the one on
 * screen may. That makes handing the subscription from the outgoing tab to the incoming one the whole problem,
 * and it has to be right in both orders: React runs every effect's cleanup before it runs any new effect, but
 * nothing here should depend on that.
 *
 * Removing by IDENTITY is what makes it order-proof. If the outgoing tab's cleanup ran after the incoming
 * tab's subscription, a `removeAllListeners` in that cleanup would take the incoming tab's handler with it and
 * the channel would go dead — the menu item would then read a file and deliver it nowhere, which is the exact
 * failure this whole change exists to close.
 */

/** One IPC listener, in the shape Electron's `ipcRenderer` hands one over. */
// biome-ignore lint/suspicious/noExplicitAny: the value's type is the channel's, and Electron declares it any
type ChannelListener = (event: any, ...args: any[]) => void

/** The part of Electron's IPC this needs — named so a test can stand in for it. */
export type ChannelBus = {
  removeAllListeners: (channel: string) => unknown
  on: (channel: string, handler: ChannelListener) => unknown
  removeListener: (channel: string, handler: ChannelListener) => unknown
}

/** Listen on `channel`, replacing whatever was listening, and return the way to stop listening. */
export function subscribeOnly<T>(
  bus: ChannelBus,
  channel: string,
  callback: (value: T) => void,
): () => void {
  bus.removeAllListeners(channel)
  const handler: ChannelListener = (_event, value: T) => callback(value)
  bus.on(channel, handler)
  return () => {
    bus.removeListener(channel, handler)
  }
}
