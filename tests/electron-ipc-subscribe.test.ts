/**
 * A file the menu reads must reach the screen the user is looking at.
 *
 * THE DEFECT, confirmed by driving the real window: every open project stays mounted, and each mounted canvas
 * subscribed to "a chip file was opened". Only one subscription survives per channel, and it was whichever
 * canvas happened to subscribe LAST — not the one on screen. With two projects open and the first one showing,
 * picking "Read an FPGA Chip File…" put the recovered design (123 parts) into the SECOND project, over the top
 * of the design already in it, while the tab the user was watching showed nothing at all. With no project open
 * there was no subscriber whatsoever: the file chooser opened, the file was read, and nothing happened.
 *
 * The renderer now subscribes only while its tab is on screen, so the subscription is handed from the outgoing
 * tab to the incoming one on every switch. This is the handover, and it must not depend on which of the two
 * runs first.
 */

import { describe, expect, test } from 'vitest'
import { type ChannelBus, subscribeOnly } from '../electron/ipc-subscribe.ts'

function fakeBus() {
  const handlers = new Map<string, ((event: unknown, value: string) => void)[]>()
  const bus: ChannelBus = {
    removeAllListeners: (channel) => handlers.delete(channel),
    on: (channel, handler) => {
      const listed = handlers.get(channel)
      if (listed === undefined) handlers.set(channel, [handler])
      else listed.push(handler)
    },
    removeListener: (channel, handler) => {
      const listed = handlers.get(channel) ?? []
      const at = listed.indexOf(handler)
      if (at >= 0) listed.splice(at, 1)
    },
  }
  const deliver = (channel: string, value: string) => {
    for (const handler of [...(handlers.get(channel) ?? [])]) handler(null, value)
  }
  const count = (channel: string) => (handlers.get(channel) ?? []).length
  return { bus, deliver, count }
}

const CHANNEL = 'file:bitstream-opened'

describe('handing one channel from the tab leaving the screen to the tab arriving', () => {
  test('only one tab is listening at a time, however many have subscribed', () => {
    const { bus, deliver, count } = fakeBus()
    const first: string[] = []
    const second: string[] = []
    subscribeOnly<string>(bus, CHANNEL, (value) => first.push(value))
    subscribeOnly<string>(bus, CHANNEL, (value) => second.push(value))
    deliver(CHANNEL, 'a chip file')
    expect(count(CHANNEL)).toBe(1)
    expect(first).toEqual([])
    expect(second).toEqual(['a chip file'])
  })

  test('the tab that leaves takes its OWN handler away, not the one that replaced it', () => {
    // The order that breaks a removeAllListeners cleanup: the arriving tab subscribes, THEN the leaving tab
    // cleans up. Get this wrong and the channel is dead — the menu reads a file and delivers it nowhere.
    const { bus, deliver, count } = fakeBus()
    const leaving: string[] = []
    const arriving: string[] = []
    const stopLeaving = subscribeOnly<string>(bus, CHANNEL, (value) => leaving.push(value))
    subscribeOnly<string>(bus, CHANNEL, (value) => arriving.push(value))
    stopLeaving()
    deliver(CHANNEL, 'a chip file')
    expect(count(CHANNEL)).toBe(1)
    expect(arriving).toEqual(['a chip file'])
    expect(leaving).toEqual([])
  })

  test('the usual order works too: the leaving tab cleans up, then the arriving tab subscribes', () => {
    const { bus, deliver } = fakeBus()
    const leaving: string[] = []
    const arriving: string[] = []
    const stopLeaving = subscribeOnly<string>(bus, CHANNEL, (value) => leaving.push(value))
    stopLeaving()
    subscribeOnly<string>(bus, CHANNEL, (value) => arriving.push(value))
    deliver(CHANNEL, 'a chip file')
    expect(arriving).toEqual(['a chip file'])
    expect(leaving).toEqual([])
  })

  test('with every tab gone, nothing is listening — which is what the greyed-out menu item matches', () => {
    const { bus, deliver, count } = fakeBus()
    const only: string[] = []
    const stop = subscribeOnly<string>(bus, CHANNEL, (value) => only.push(value))
    stop()
    deliver(CHANNEL, 'a chip file')
    expect(count(CHANNEL)).toBe(0)
    expect(only).toEqual([])
  })
})
