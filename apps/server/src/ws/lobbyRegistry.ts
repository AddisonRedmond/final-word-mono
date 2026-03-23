import type { WSContext } from 'hono/ws'
import type { ClientMessage } from 'types/ws.js'
import { serializeMessage } from 'types/ws.js'

export interface Connection {
  uid: string
  ws: WSContext
}

export class LobbyRegistry {
  private lobbies = new Map<string, Set<Connection>>()

  join(lobbyId: string, conn: Connection): void {
    let members = this.lobbies.get(lobbyId)
    if (!members) {
      members = new Set()
      this.lobbies.set(lobbyId, members)
    }
    members.add(conn)
  }

  leave(lobbyId: string, conn: Connection): void {
    const members = this.lobbies.get(lobbyId)
    if (!members) return
    members.delete(conn)
    if (members.size === 0) {
      this.lobbies.delete(lobbyId)
    }
  }

  getLobbiesForConnection(conn: Connection): string[] {
    const result: string[] = []
    for (const [lobbyId, members] of this.lobbies) {
      if (members.has(conn)) result.push(lobbyId)
    }
    return result
  }

  removeAll(conn: Connection): void {
    for (const [lobbyId, members] of this.lobbies) {
      if (!members.has(conn)) continue
      members.delete(conn)
      if (members.size === 0) {
        this.lobbies.delete(lobbyId)
      } else {
        this.broadcast(lobbyId, {
          type: 'lobby_state',
          lobbyId,
          members: this.getMembers(lobbyId),
        })
      }
    }
  }

  broadcast(lobbyId: string, msg: ClientMessage): void {
    const members = this.lobbies.get(lobbyId)
    if (!members) return
    const serialized = serializeMessage(msg)
    for (const conn of members) {
      conn.ws.send(serialized)
    }
  }

  getMembers(lobbyId: string): string[] {
    const members = this.lobbies.get(lobbyId)
    if (!members) return []
    return Array.from(members).map((conn) => conn.uid)
  }
}
