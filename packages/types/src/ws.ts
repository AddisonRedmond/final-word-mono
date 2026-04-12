import { z } from 'zod'

// Messages sent FROM the client TO the server
export type ServerMessage =
  | { type: 'ping' }
  | { type: 'find_or_create_lobby' }
  | { type: 'join_lobby'; lobbyId: string }
  | { type: 'leave_lobby'; lobbyId: string }
  | { type: 'submit_guess'; lobbyId: string; guess: string }
  | { type: 'set_target'; lobbyId: string; targetUserId: string }

// Messages sent FROM the server TO the client
export type ClientMessage =
  | { type: 'pong' }
  | { type: 'error'; reason: string }
  | { type: 'lobby_state'; lobbyId: string; members: string[]; beginAtCountdown: number }
  | { type: 'game_started'; lobbyId: string; players: string[] }
  | { type: 'guess_result'; lobbyId: string; guess: string; feedback: Array<'correct' | 'present' | 'absent'> }
  | { type: 'game_state_update'; lobbyId: string; players: Array<{ userId: string; guessCount: number; won: boolean; eliminated: boolean; healthMs: number }> }
  | { type: 'game_over'; lobbyId: string; winner: string; players: Array<{ userId: string; secretWord: string; guesses: string[]; won: boolean }> }
  | { type: 'attack_word'; lobbyId: string; fromUserId: string; word: string; revealedPositions: number[] }
  | { type: 'player_health_update'; lobbyId: string; players: Array<{ userId: string; healthMs: number }> }

// Union of all messages
export type WsMessage = ServerMessage | ClientMessage

// Zod schemas
export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('find_or_create_lobby') }),
  z.object({ type: z.literal('join_lobby'), lobbyId: z.string() }),
  z.object({ type: z.literal('leave_lobby'), lobbyId: z.string() }),
  z.object({ type: z.literal('submit_guess'), lobbyId: z.string(), guess: z.string() }),
  z.object({ type: z.literal('set_target'), lobbyId: z.string(), targetUserId: z.string() }),
])

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('error'), reason: z.string() }),
  z.object({ type: z.literal('lobby_state'), lobbyId: z.string(), members: z.array(z.string()), beginAtCountdown: z.number() }),
  z.object({ type: z.literal('game_started'), lobbyId: z.string(), players: z.array(z.string()) }),
  z.object({
    type: z.literal('guess_result'),
    lobbyId: z.string(),
    guess: z.string(),
    feedback: z.array(z.enum(['correct', 'present', 'absent'])),
  }),
  z.object({
    type: z.literal('game_state_update'),
    lobbyId: z.string(),
    players: z.array(z.object({
      userId: z.string(),
      guessCount: z.number(),
      won: z.boolean(),
      eliminated: z.boolean(),
      healthMs: z.number(),
    })),
  }),
  z.object({
    type: z.literal('game_over'),
    lobbyId: z.string(),
    winner: z.string(),
    players: z.array(z.object({
      userId: z.string(),
      secretWord: z.string(),
      guesses: z.array(z.string()),
      won: z.boolean(),
    })),
  }),
  z.object({
    type: z.literal('attack_word'),
    lobbyId: z.string(),
    fromUserId: z.string(),
    word: z.string(),
    revealedPositions: z.array(z.number()),
  }),
  z.object({
    type: z.literal('player_health_update'),
    lobbyId: z.string(),
    players: z.array(z.object({
      userId: z.string(),
      healthMs: z.number(),
    })),
  }),
])

export const WsMessageSchema = z.union([ServerMessageSchema, ClientMessageSchema])

export function serializeMessage(msg: WsMessage): string {
  return JSON.stringify(msg)
}

export function parseMessage(raw: string): WsMessage {
  const parsed = JSON.parse(raw)
  return WsMessageSchema.parse(parsed)
}
