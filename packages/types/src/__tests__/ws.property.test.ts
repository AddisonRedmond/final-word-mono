// Feature: websocket-scaffolding, Property 1: Message round-trip
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { serializeMessage, parseMessage } from '../ws'
import type { WsMessage } from '../ws'

// Arbitraries for each message variant
const pingArb = fc.constant({ type: 'ping' as const })
const joinLobbyArb = fc.record({ type: fc.constant('join_lobby' as const), lobbyId: fc.string() })
const leaveLobbyArb = fc.record({ type: fc.constant('leave_lobby' as const), lobbyId: fc.string() })
const pongArb = fc.constant({ type: 'pong' as const })
const errorArb = fc.record({ type: fc.constant('error' as const), reason: fc.string() })
const lobbyStateArb = fc.record({
  type: fc.constant('lobby_state' as const),
  lobbyId: fc.string(),
  members: fc.array(fc.string()),
  beginAtCountdown: fc.integer(),
})

const wsMessageArb: fc.Arbitrary<WsMessage> = fc.oneof(
  pingArb,
  joinLobbyArb,
  leaveLobbyArb,
  pongArb,
  errorArb,
  lobbyStateArb,
)

// Property 1: Message round-trip
describe('Property 1: Message round-trip', () => {
  it('parseMessage(serializeMessage(msg)) deeply equals msg for any valid WsMessage', () => {
    fc.assert(
      fc.property(wsMessageArb, (msg) => {
        const result = parseMessage(serializeMessage(msg))
        expect(result).toEqual(msg)
      }),
      { numRuns: 100 },
    )
  })
})

// Unit tests: all six MessageType values parse correctly (Req 2.3)
describe('Unit tests: all six MessageType values parse correctly', () => {
  it('parses ping', () => {
    const msg: WsMessage = { type: 'ping' }
    expect(parseMessage(serializeMessage(msg))).toEqual(msg)
  })

  it('parses join_lobby', () => {
    const msg: WsMessage = { type: 'join_lobby', lobbyId: 'room-1' }
    expect(parseMessage(serializeMessage(msg))).toEqual(msg)
  })

  it('parses leave_lobby', () => {
    const msg: WsMessage = { type: 'leave_lobby', lobbyId: 'room-1' }
    expect(parseMessage(serializeMessage(msg))).toEqual(msg)
  })

  it('parses pong', () => {
    const msg: WsMessage = { type: 'pong' }
    expect(parseMessage(serializeMessage(msg))).toEqual(msg)
  })

  it('parses error', () => {
    const msg: WsMessage = { type: 'error', reason: 'something went wrong' }
    expect(parseMessage(serializeMessage(msg))).toEqual(msg)
  })

  it('parses lobby_state', () => {
    const msg: WsMessage = { type: 'lobby_state', lobbyId: 'room-1', members: ['alice', 'bob'], beginAtCountdown: 5 }
    expect(parseMessage(serializeMessage(msg))).toEqual(msg)
  })
})

// Feature: websocket-scaffolding, Property 2: Invalid payload produces error
// Validates: Requirements 2.6, 3.5

// Arbitraries for invalid inputs
const nonJsonStringArb = fc.string().filter((s) => {
  try { JSON.parse(s); return false } catch { return true }
})

const unknownTypeArb = fc.record({
  type: fc.string().filter((s) => !['ping','join_lobby','leave_lobby','pong','error','lobby_state'].includes(s)),
})

const missingFieldArb = fc.oneof(
  fc.constant('{"type":"join_lobby"}'),
  fc.constant('{"type":"leave_lobby"}'),
  fc.constant('{"type":"error"}'),
  fc.constant('{"type":"lobby_state","lobbyId":"x"}'),
  fc.constant('{"type":"lobby_state","members":[]}'),
)

const nonObjectJsonArb = fc.oneof(
  fc.integer().map(String),
  fc.boolean().map((b) => JSON.stringify(b)),
  fc.constant('null'),
  fc.array(fc.string()).map((a) => JSON.stringify(a)),
)

describe('Property 2: Invalid payload produces error', () => {
  it('throws for random non-JSON strings', () => {
    fc.assert(
      fc.property(nonJsonStringArb, (s) => {
        expect(() => parseMessage(s)).toThrow()
      }),
      { numRuns: 100 },
    )
  })

  it('throws for valid JSON with unknown type', () => {
    fc.assert(
      fc.property(unknownTypeArb, (obj) => {
        expect(() => parseMessage(JSON.stringify(obj))).toThrow()
      }),
      { numRuns: 100 },
    )
  })

  it('throws for valid JSON objects missing required fields', () => {
    fc.assert(
      fc.property(missingFieldArb, (s) => {
        expect(() => parseMessage(s)).toThrow()
      }),
      { numRuns: 20 },
    )
  })

  it('throws for non-object JSON values (numbers, arrays, null, booleans)', () => {
    fc.assert(
      fc.property(nonObjectJsonArb, (s) => {
        expect(() => parseMessage(s)).toThrow()
      }),
      { numRuns: 100 },
    )
  })
})

// Unit test: parseMessage throws on a plain invalid string
describe('Unit test: parseMessage throws on invalid input', () => {
  it('throws on a plain invalid string "not-json"', () => {
    expect(() => parseMessage('not-json')).toThrow()
  })
})

// Feature: game-loop, Property: WS message round-trips for new game-loop message types
// Validates: Requirements 8.8

const feedbackArb = fc.array(fc.constantFrom('correct' as const, 'present' as const, 'absent' as const))

const submitGuessArb = fc.record({
  type: fc.constant('submit_guess' as const),
  lobbyId: fc.string(),
  guess: fc.string(),
})

const setTargetArb = fc.record({
  type: fc.constant('set_target' as const),
  lobbyId: fc.string(),
  targetUserId: fc.string(),
})

const guessResultArb = fc.record({
  type: fc.constant('guess_result' as const),
  lobbyId: fc.string(),
  guess: fc.string(),
  feedback: feedbackArb,
})

const gameStateUpdateArb = fc.record({
  type: fc.constant('game_state_update' as const),
  lobbyId: fc.string(),
  players: fc.array(fc.record({
    userId: fc.string(),
    guessCount: fc.integer({ min: 0 }),
    won: fc.boolean(),
    eliminated: fc.boolean(),
    healthMs: fc.integer({ min: 0 }),
  })),
})

const gameOverArb = fc.record({
  type: fc.constant('game_over' as const),
  lobbyId: fc.string(),
  winner: fc.string(),
  players: fc.array(fc.record({
    userId: fc.string(),
    secretWord: fc.string(),
    guesses: fc.array(fc.string()),
    won: fc.boolean(),
  })),
})

const attackWordArb = fc.record({
  type: fc.constant('attack_word' as const),
  lobbyId: fc.string(),
  fromUserId: fc.string(),
  word: fc.string(),
  revealedPositions: fc.array(fc.integer({ min: 0, max: 4 })),
})

const playerHealthUpdateArb = fc.record({
  type: fc.constant('player_health_update' as const),
  lobbyId: fc.string(),
  players: fc.array(fc.record({
    userId: fc.string(),
    healthMs: fc.integer({ min: 0 }),
  })),
})

const gameLoopMessageArb = fc.oneof(
  submitGuessArb,
  setTargetArb,
  guessResultArb,
  gameStateUpdateArb,
  gameOverArb,
  attackWordArb,
  playerHealthUpdateArb,
)

describe('Property: game-loop WS message round-trips', () => {
  it('parseMessage(serializeMessage(msg)) deeply equals msg for all new game-loop message types', () => {
    fc.assert(
      fc.property(gameLoopMessageArb, (msg) => {
        const result = parseMessage(serializeMessage(msg))
        expect(result).toEqual(msg)
      }),
      { numRuns: 200 },
    )
  })
})
