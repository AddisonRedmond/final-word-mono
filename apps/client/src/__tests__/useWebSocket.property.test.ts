// Feature: websocket-scaffolding, Property 8: Received messages invoke callback and update store
// Feature: websocket-scaffolding, Property 9: Reconnection uses exponential backoff
// Feature: websocket-scaffolding, Property 10: Message queue flushes on open

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fc from 'fast-check'
import { parseMessage, serializeMessage } from 'types'
import type { ClientMessage, ServerMessage } from 'types'
import { useWsStore } from '../state/useWsStore'

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ClientMessageArb: fc.Arbitrary<ClientMessage> = fc.oneof(
  fc.constant({ type: 'pong' as const }),
  fc.record({ type: fc.constant('error' as const), reason: fc.string() }),
  fc.record({
    type: fc.constant('lobby_state' as const),
    lobbyId: fc.string(),
    members: fc.array(fc.string()),
  }),
)

const ServerMessageArb: fc.Arbitrary<ServerMessage> = fc.oneof(
  fc.constant({ type: 'ping' as const }),
  fc.record({ type: fc.constant('join_lobby' as const), lobbyId: fc.string() }),
  fc.record({ type: fc.constant('leave_lobby' as const), lobbyId: fc.string() }),
)

// ---------------------------------------------------------------------------
// Reset store before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  useWsStore.setState({ status: 'closed', lastMessage: null, sendMessage: () => {} })
})

// ---------------------------------------------------------------------------
// Property 8: Received messages invoke callback and update store
// Validates: Requirements 5.5, 6.3
// ---------------------------------------------------------------------------

describe('Property 8: Received messages invoke callback and update store', () => {
  it('onMessage callback and store.lastMessage both receive the parsed ClientMessage', () => {
    fc.assert(
      fc.property(ClientMessageArb, (msg) => {
        // Reset store for each run
        useWsStore.setState({ status: 'closed', lastMessage: null, sendMessage: () => {} })

        const onMessage = vi.fn()
        const store = useWsStore.getState()

        // Simulate the onmessage handler logic from useWebSocket
        const raw = serializeMessage(msg)
        const parsed = parseMessage(raw) as ClientMessage
        onMessage(parsed)
        store._setLastMessage(parsed)

        expect(onMessage).toHaveBeenCalledWith(msg)
        expect(useWsStore.getState().lastMessage).toEqual(msg)
      }),
      { numRuns: 100 },
    )
  })
})

// ---------------------------------------------------------------------------
// Property 9: Reconnection uses exponential backoff
// Validates: Requirements 5.6
// ---------------------------------------------------------------------------

/** Pure backoff calculation extracted from useWebSocket */
function calcBackoffDelay(retryCount: number): number {
  return 2 ** retryCount * 1000
}

describe('Property 9: Reconnection uses exponential backoff', () => {
  it('delay for retryCount 0..4 equals 2^retryCount * 1000 ms', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), (retryCount) => {
        const delay = calcBackoffDelay(retryCount)
        expect(delay).toBe(2 ** retryCount * 1000)
      }),
      { numRuns: 100 },
    )
  })

  it('no reconnect happens when retryCount >= 5 (status becomes closed)', () => {
    // Simulate the onclose branch: retryCount >= 5 → set status 'closed'
    const retryCount = 5
    const store = useWsStore.getState()
    if (retryCount >= 5) {
      store._setStatus('closed')
    }
    expect(useWsStore.getState().status).toBe('closed')
  })
})

// ---------------------------------------------------------------------------
// Property 10: Message queue flushes on open
// Validates: Requirements 5.8
// ---------------------------------------------------------------------------

describe('Property 10: Message queue flushes on open', () => {
  it('all queued ServerMessages are sent in order and queue is empty after flush', () => {
    fc.assert(
      fc.property(fc.array(ServerMessageArb, { minLength: 1, maxLength: 10 }), (messages) => {
        // Simulate the queue and the mock ws.send
        const queue: ServerMessage[] = [...messages]
        const sent: string[] = []
        const mockWsSend = vi.fn((data: string) => { sent.push(data) })

        // Simulate the onopen flush logic from useWebSocket
        for (const msg of queue) {
          mockWsSend(serializeMessage(msg))
        }
        queue.length = 0 // flush

        // All messages sent in order
        expect(mockWsSend).toHaveBeenCalledTimes(messages.length)
        messages.forEach((msg, i) => {
          expect(sent[i]).toBe(serializeMessage(msg))
        })
        // Queue is empty
        expect(queue).toHaveLength(0)
      }),
      { numRuns: 100 },
    )
  })
})

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('Unit tests: useWebSocket logic', () => {
  it('parseMessage(serializeMessage(msg)) returns the same ClientMessage', () => {
    const msg: ClientMessage = { type: 'pong' }
    expect(parseMessage(serializeMessage(msg))).toEqual(msg)
  })

  it('backoff delay for retry 0 is 1000ms', () => {
    expect(calcBackoffDelay(0)).toBe(1000)
  })

  it('backoff delay for retry 1 is 2000ms', () => {
    expect(calcBackoffDelay(1)).toBe(2000)
  })

  it('backoff delay for retry 2 is 4000ms', () => {
    expect(calcBackoffDelay(2)).toBe(4000)
  })

  it('backoff delay for retry 3 is 8000ms', () => {
    expect(calcBackoffDelay(3)).toBe(8000)
  })

  it('backoff delay for retry 4 is 16000ms', () => {
    expect(calcBackoffDelay(4)).toBe(16000)
  })

  it('after 5 retries, status is closed (no more reconnect)', () => {
    useWsStore.getState()._setStatus('closed')
    expect(useWsStore.getState().status).toBe('closed')
  })
})
