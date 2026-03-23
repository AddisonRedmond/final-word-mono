// Feature: websocket-scaffolding, Property 4: Join then leave is a round-trip
// Feature: websocket-scaffolding, Property 5: Connection close removes from all lobbies
// Feature: websocket-scaffolding, Property 6: Lobby membership change broadcasts to all members

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import { LobbyRegistry } from '../ws/lobbyRegistry.js'
import type { Connection } from '../ws/lobbyRegistry.js'

// Minimal mock connection factory — ws only needs `send` for these tests
function makeConn(uid: string): Connection {
  return {
    uid,
    ws: { send: vi.fn() } as unknown as Connection['ws'],
  }
}

// ─── Unit tests ──────────────────────────────────────────────────────────────

describe('LobbyRegistry unit tests', () => {
  let registry: LobbyRegistry

  beforeEach(() => {
    registry = new LobbyRegistry()
  })

  it('join adds a connection to a lobby', () => {
    const conn = makeConn('user-1')
    registry.join('lobby-a', conn)
    expect(registry.getMembers('lobby-a')).toContain('user-1')
  })

  it('leave removes a connection from a lobby', () => {
    const conn = makeConn('user-1')
    registry.join('lobby-a', conn)
    registry.leave('lobby-a', conn)
    expect(registry.getMembers('lobby-a')).not.toContain('user-1')
  })

  it('removeAll removes a connection from multiple lobbies', () => {
    const conn = makeConn('user-1')
    registry.join('lobby-a', conn)
    registry.join('lobby-b', conn)
    registry.removeAll(conn)
    expect(registry.getMembers('lobby-a')).not.toContain('user-1')
    expect(registry.getMembers('lobby-b')).not.toContain('user-1')
  })

  it('broadcast calls ws.send on all members with serialized message', () => {
    const conn1 = makeConn('user-1')
    const conn2 = makeConn('user-2')
    registry.join('lobby-a', conn1)
    registry.join('lobby-a', conn2)
    const msg = { type: 'pong' as const }
    registry.broadcast('lobby-a', msg)
    expect(conn1.ws.send).toHaveBeenCalledOnce()
    expect(conn1.ws.send).toHaveBeenCalledWith(JSON.stringify(msg))
    expect(conn2.ws.send).toHaveBeenCalledOnce()
    expect(conn2.ws.send).toHaveBeenCalledWith(JSON.stringify(msg))
  })

  it('getMembers returns correct uid array', () => {
    const conn1 = makeConn('alice')
    const conn2 = makeConn('bob')
    registry.join('lobby-x', conn1)
    registry.join('lobby-x', conn2)
    const members = registry.getMembers('lobby-x')
    expect(members).toHaveLength(2)
    expect(members).toContain('alice')
    expect(members).toContain('bob')
  })
})

// ─── Property tests ───────────────────────────────────────────────────────────

describe('Property 4: Join then leave is a round-trip', () => {
  /**
   * Validates: Requirements 3.2
   * For any lobbyId and connection, after join(lobbyId, conn) then leave(lobbyId, conn),
   * the lobby's member set is identical to what it was before the join.
   */
  it('join then leave leaves the lobby unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        async (lobbyId, uid) => {
          const registry = new LobbyRegistry()
          const conn = makeConn(uid)

          const before = new Set(registry.getMembers(lobbyId))
          registry.join(lobbyId, conn)
          registry.leave(lobbyId, conn)
          const after = new Set(registry.getMembers(lobbyId))

          expect(after).toEqual(before)
          expect(after.has(uid)).toBe(before.has(uid))
        },
      ),
      { numRuns: 100 },
    )
  })
})

describe('Property 5: Connection close removes from all lobbies', () => {
  /**
   * Validates: Requirements 3.3
   * For any connection joined to multiple lobbies, after removeAll(conn),
   * the connection is absent from every lobby's member set.
   */
  it('removeAll removes the connection from every lobby it joined', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 1 }),
        async (lobbyIds, uid) => {
          const registry = new LobbyRegistry()
          const conn = makeConn(uid)

          for (const id of lobbyIds) {
            registry.join(id, conn)
          }

          registry.removeAll(conn)

          for (const id of lobbyIds) {
            expect(registry.getMembers(id)).not.toContain(uid)
          }
        },
      ),
      { numRuns: 100 },
    )
  })
})

describe('Property 6: Lobby membership change broadcasts to all members', () => {
  /**
   * Validates: Requirements 3.4
   * For any lobby with N members, when broadcast(lobbyId, msg) is called,
   * all N members' ws.send is called exactly once with the serialized message.
   */
  it('broadcast calls ws.send exactly once on every member with the serialized message', async () => {
    // Arbitraries for ClientMessage variants
    const clientMessageArb = fc.oneof(
      fc.constant({ type: 'pong' as const }),
      fc.string({ minLength: 1 }).map((reason) => ({ type: 'error' as const, reason })),
      fc.tuple(fc.string({ minLength: 1 }), fc.array(fc.string())).map(([lobbyId, members]) => ({
        type: 'lobby_state' as const,
        lobbyId,
        members,
      })),
    )

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        clientMessageArb,
        fc.string({ minLength: 1 }),
        async (n, msg, lobbyId) => {
          const registry = new LobbyRegistry()
          const conns = Array.from({ length: n }, (_, i) => makeConn(`user-${i}`))

          for (const conn of conns) {
            registry.join(lobbyId, conn)
          }

          registry.broadcast(lobbyId, msg)

          const serialized = JSON.stringify(msg)
          for (const conn of conns) {
            expect(conn.ws.send).toHaveBeenCalledOnce()
            expect(conn.ws.send).toHaveBeenCalledWith(serialized)
          }
        },
      ),
      { numRuns: 100 },
    )
  })
})
