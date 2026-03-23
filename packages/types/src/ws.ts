import { z } from 'zod'

// Messages sent FROM the client TO the server
export type ServerMessage =
  | { type: 'ping' }
  | { type: 'join_lobby'; lobbyId: string }
  | { type: 'leave_lobby'; lobbyId: string }

// Messages sent FROM the server TO the client
export type ClientMessage =
  | { type: 'pong' }
  | { type: 'error'; reason: string }
  | { type: 'lobby_state'; lobbyId: string; members: string[] }

// Union of all messages
export type WsMessage = ServerMessage | ClientMessage

// Zod schemas
export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('join_lobby'), lobbyId: z.string() }),
  z.object({ type: z.literal('leave_lobby'), lobbyId: z.string() }),
])

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('error'), reason: z.string() }),
  z.object({ type: z.literal('lobby_state'), lobbyId: z.string(), members: z.array(z.string()) }),
])

export const WsMessageSchema = z.union([ServerMessageSchema, ClientMessageSchema])

export function serializeMessage(msg: WsMessage): string {
  return JSON.stringify(msg)
}

export function parseMessage(raw: string): WsMessage {
  const parsed = JSON.parse(raw)
  return WsMessageSchema.parse(parsed)
}
