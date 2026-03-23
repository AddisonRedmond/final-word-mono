// Feature: websocket-scaffolding, Property 11: Status changes sync to Zustand store
// Validates: Requirements 6.2

import { describe, it, expect, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import { useWsStore } from '../state/useWsStore'

type WsStatus = 'connecting' | 'open' | 'closing' | 'closed'

const validStatuses: WsStatus[] = ['connecting', 'open', 'closing', 'closed']

beforeEach(() => {
  useWsStore.setState({ status: 'closed', lastMessage: null, sendMessage: () => {} })
})

describe('useWsStore - Property 11: status syncing', () => {
  it('Property: _setStatus(s) results in store.status === s for any valid status', () => {
    fc.assert(
      fc.property(fc.constantFrom(...validStatuses), (s) => {
        useWsStore.getState()._setStatus(s)
        expect(useWsStore.getState().status).toBe(s)
      }),
      { numRuns: 100 },
    )
  })
})

describe('useWsStore - unit tests', () => {
  it('initial store state has status: closed and lastMessage: null', () => {
    const state = useWsStore.getState()
    expect(state.status).toBe('closed')
    expect(state.lastMessage).toBeNull()
  })

  it('_setLastMessage updates lastMessage in the store', () => {
    const msg = { type: 'pong' } as const
    useWsStore.getState()._setLastMessage(msg)
    expect(useWsStore.getState().lastMessage).toEqual(msg)
  })

  it('_setSend updates sendMessage so it delegates to the provided function', () => {
    const received: unknown[] = []
    useWsStore.getState()._setSend((msg) => received.push(msg))
    const pingMsg = { type: 'ping' } as const
    useWsStore.getState().sendMessage(pingMsg)
    expect(received).toEqual([pingMsg])
  })

  it('sendMessage is a no-op initially (calling it does not throw)', () => {
    expect(() => useWsStore.getState().sendMessage({ type: 'ping' })).not.toThrow()
  })
})
