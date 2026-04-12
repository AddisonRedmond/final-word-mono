import type { ServerMessage, ClientMessage } from 'types/ws.js'
import type { Connection, LobbyRegistry } from './lobbyRegistry.js'

export function routeMessage(
  msg: ServerMessage,
  conn: Connection,
  registry: LobbyRegistry
): ClientMessage | null {
  try {
    switch (msg.type) {
      case 'ping':
        console.log("ping")
        return { type: 'pong' }

      case 'find_or_create_lobby': {
        const lobbyId = registry.findOrCreateLobby(conn)
        const game = registry.getGame(lobbyId)
        registry.broadcast(lobbyId, {
          type: 'lobby_state',
          lobbyId,
          members: registry.getMembers(lobbyId),
          beginAtCountdown: game?.beginAtCountdown ?? 0,
        })
        return null
      }

      case 'join_lobby': {
        if (!registry.canJoinLobby(msg.lobbyId)) {
          return { type: 'error', reason: 'lobby_full_or_started' }
        }
        registry.join(msg.lobbyId, conn)
        registry.broadcast(msg.lobbyId, {
          type: 'lobby_state',
          lobbyId: msg.lobbyId,
          members: registry.getMembers(msg.lobbyId),
          beginAtCountdown: registry.getGame(msg.lobbyId)?.beginAtCountdown ?? 0,
        })
        return null
      }

      case 'leave_lobby':
        registry.leave(msg.lobbyId, conn)
        registry.broadcast(msg.lobbyId, {
          type: 'lobby_state',
          lobbyId: msg.lobbyId,
          members: registry.getMembers(msg.lobbyId),
          beginAtCountdown: registry.getGame(msg.lobbyId)?.beginAtCountdown ?? 0,
        })
        return null

      case 'submit_guess':
        registry.processGuess(msg.lobbyId, conn.uid, msg.guess)
        return null

      case 'set_target':
        registry.setTarget(msg.lobbyId, conn.uid, msg.targetUserId)
        return null

      default:
        // Exhaustiveness fallback for unknown message types
        console.error('Unknown message type:', (msg as { type: string }).type)
        return { type: 'error', reason: 'unknown_message_type' }
    }
  } catch (e) {
    console.error(e)
    return { type: 'error', reason: 'internal_server_error' }
  }
}
