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
        return { type: 'pong' }

      case 'join_lobby':
        registry.join(msg.lobbyId, conn)
        registry.broadcast(msg.lobbyId, {
          type: 'lobby_state',
          lobbyId: msg.lobbyId,
          members: registry.getMembers(msg.lobbyId),
        })
        return null

      case 'leave_lobby':
        registry.leave(msg.lobbyId, conn)
        registry.broadcast(msg.lobbyId, {
          type: 'lobby_state',
          lobbyId: msg.lobbyId,
          members: registry.getMembers(msg.lobbyId),
        })
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
