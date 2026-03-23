// Feature: websocket-scaffolding, Property 3: Ping produces pong
// Validates: Requirements 3.1

import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import { routeMessage } from '../ws/router.js'
import { LobbyRegistry } from '../ws/lobbyRegistry.js'
import type { Connection } from '../ws/lobbyRegistry.js'

function makeConn(uid: string): Connection {
  return {
    uid,
    ws: { send: vi.fn() } as unknown as Connection['ws'],
  }
}

// ─── Property test ────────────────────────────────────────────────────────────

describe('Property 3: Ping produces pong', () => {
  /**
   * Validates: Requirements 3.1
   * For any mock connection (varying uid), routeMessage({ type: 'ping' }, conn, registry)
   * always returns exactly { type: 'pong' }.
   */
  it('routeMessage with ping always returns { type: pong } for any connection', async () => {
    const registry = new LobbyRegistry()

    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (uid) => {
        const conn = makeConn(uid)
        const result = routeMessage({ type: 'ping' }, conn, registry)
        expect(result).toEqual({ type: 'pong' })
      }),
      { numRuns: 100 },
    )
  })
})

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('routeMessage unit tests', () => {
  it('returns { type: pong } for a fixed connection on ping', () => {
    const registry = new LobbyRegistry()
    const conn = makeConn('user-1')
    expect(routeMessage({ type: 'ping' }, conn, registry)).toEqual({ type: 'pong' })
  })

  it('returns { type: error, reason: unknown_message_type } for unknown type', () => {
    const registry = new LobbyRegistry()
    const conn = makeConn('user-1')
    const result = routeMessage({ type: 'unknown' } as never, conn, registry)
    expect(result).toEqual({ type: 'error', reason: 'unknown_message_type' })
  })

  it('calls registry.join and returns null for join_lobby', () => {
    const registry = new LobbyRegistry()
    const joinSpy = vi.spyOn(registry, 'join')
    const conn = makeConn('user-1')
    const result = routeMessage({ type: 'join_lobby', lobbyId: 'lobby-a' }, conn, registry)
    expect(joinSpy).toHaveBeenCalledWith('lobby-a', conn)
    expect(result).toBeNull()
  })

  it('calls registry.leave and returns null for leave_lobby', () => {
    const registry = new LobbyRegistry()
    const leaveSpy = vi.spyOn(registry, 'leave')
    const conn = makeConn('user-1')
    registry.join('lobby-a', conn)
    const result = routeMessage({ type: 'leave_lobby', lobbyId: 'lobby-a' }, conn, registry)
    expect(leaveSpy).toHaveBeenCalledWith('lobby-a', conn)
    expect(result).toBeNull()
  })
})
