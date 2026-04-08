import type { WSContext } from 'hono/ws'
import type { ClientMessage } from 'types/ws.js'
import type { Game } from 'types/game.js'
import { serializeMessage } from 'types/ws.js'
import { randomUUID } from 'crypto'

export interface Connection {
  uid: string
  ws: WSContext
}

export class LobbyRegistry {
  private lobbies = new Map<string, Set<Connection>>()
  private games = new Map<string, Game>()
  private countdowns = new Map<string, ReturnType<typeof setInterval>>()

  findOrCreateLobby(conn: Connection): string {
    for (const [lobbyId, game] of this.games) {
      if (!game.started) {
        this.join(lobbyId, conn)
        return lobbyId
      }
    }
    const lobbyId = randomUUID()
    const game: Game = {
      lobbyId,
      createdAt: Date.now(),
      started: false,
      winner: '',
      players: {},
      beginAtCountdown: Date.now() + 60_000,
    }
    this.games.set(lobbyId, game)
    this.join(lobbyId, conn)
    this.startCountdown(lobbyId)
    return lobbyId
  }

  private startCountdown(lobbyId: string): void {
    const interval = setInterval(() => {
      const game = this.games.get(lobbyId)
      if (!game) {
        clearInterval(interval)
        this.countdowns.delete(lobbyId)
        return
      }
      this.broadcast(lobbyId, {
        type: 'lobby_state',
        lobbyId,
        members: this.getMembers(lobbyId),
        beginAtCountdown: game.beginAtCountdown,
      })
      if (Date.now() >= game.beginAtCountdown) {
        clearInterval(interval)
        this.countdowns.delete(lobbyId)
        game.started = true
      }
    }, 1000)
    this.countdowns.set(lobbyId, interval)
  }

  join(lobbyId: string, conn: Connection): void {
    let members = this.lobbies.get(lobbyId)
    if (!members) {
      members = new Set()
      this.lobbies.set(lobbyId, members)
    }
    for (const member of members) {
      if (member.uid === conn.uid) {
        members.delete(member)
        break
      }
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
        const interval = this.countdowns.get(lobbyId)
        if (interval) {
          clearInterval(interval)
          this.countdowns.delete(lobbyId)
        }
        this.games.delete(lobbyId)
      } else {
        const game = this.games.get(lobbyId)
        this.broadcast(lobbyId, {
          type: 'lobby_state',
          lobbyId,
          members: this.getMembers(lobbyId),
          beginAtCountdown: game?.beginAtCountdown ?? 0,
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

  getGame(lobbyId: string): Game | undefined {
    return this.games.get(lobbyId)
  }

  getMembers(lobbyId: string): string[] {
    const members = this.lobbies.get(lobbyId)
    if (!members) return []
    return Array.from(members).map((conn) => conn.uid)
  }
}
