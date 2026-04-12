import type { WSContext } from 'hono/ws'
import type { ClientMessage } from 'types/ws.js'
import type { Game } from 'types/game.js'
import { serializeMessage } from 'types/ws.js'
import { randomUUID } from 'crypto'
import {
  assignWords,
  applyHealthTick,
  computeFeedback,
  applyWordSolvedBonus,
  applyFailurePenalty,
  computeRevealedPositions,
} from './gameEngine.js'
import { FIVE_LETTER_WORDS } from 'words/five_letter_words.js'

export interface Connection {
  uid: string
  ws: WSContext
}

const MAX_PLAYERS = 4
const MIN_PLAYERS = 2
const COUNTDOWN_DURATION = 60_000 // 60 seconds

export class LobbyRegistry {
  private lobbies = new Map<string, Set<Connection>>()
  private games = new Map<string, Game>()
  private countdowns = new Map<string, ReturnType<typeof setInterval>>()
  private healthTicks = new Map<string, ReturnType<typeof setInterval>>()
  private botIntervals = new Map<string, ReturnType<typeof setInterval>>()
  private botCounter = 0

  findOrCreateLobby(conn: Connection): string {
    for (const [lobbyId, game] of this.games) {
      if (!game.started && this.getMembers(lobbyId).length < MAX_PLAYERS) {
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
      beginAtCountdown: Date.now() + COUNTDOWN_DURATION,
      maxPlayers: MAX_PLAYERS,
      minPlayers: MIN_PLAYERS,
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
        
        // Fill with bots if needed
        const currentPlayers = this.getMembers(lobbyId).length
        if (currentPlayers >= game.minPlayers) {
          this.fillBotsAndStart(lobbyId)
        } else {
          // Not enough players, add bots to reach minimum
          while (this.getMembers(lobbyId).length < game.minPlayers) {
            this.addBot(lobbyId)
          }
          this.fillBotsAndStart(lobbyId)
        }
      }
    }, 1000)
    this.countdowns.set(lobbyId, interval)
  }

  private addBot(lobbyId: string): void {
    const game = this.games.get(lobbyId)
    if (!game) return
    
    const botId = `bot_${this.botCounter++}`
    game.players[botId] = {
      word: '',
      guesses: [],
      endTimeStamp: 0,
      backlog: [],
      backlogGuesses: [],
      isBot: true,
      healthMs: 0,
      activeWord: '',
      activeWordGuesses: [],
      attackQueue: [],
      targetMode: 'random',
      targetUserId: '',
    }
  }

  private fillBotsAndStart(lobbyId: string): void {
    const game = this.games.get(lobbyId)
    if (!game) return

    // Fill remaining spots with bots
    while (this.getMembers(lobbyId).length < game.maxPlayers) {
      this.addBot(lobbyId)
    }

    // Mark game as started
    game.started = true

    // Assign words and initialize health for all players
    const playerIds = Object.keys(game.players)
    const wordMap = assignWords(playerIds, FIVE_LETTER_WORDS)
    for (const userId of playerIds) {
      const player = game.players[userId]!
      player.word = wordMap[userId]!
      player.healthMs = 120_000
      player.activeWord = wordMap[userId]!
      player.activeWordGuesses = []
      player.attackQueue = []
      player.targetMode = 'random'
      player.targetUserId = ''
    }

    // Broadcast game_started to all players
    this.broadcast(lobbyId, {
      type: 'game_started',
      lobbyId,
      players: Object.keys(game.players),
    })

    this.startHealthTick(lobbyId)
    this.startBotSimulation(lobbyId)
  }

  private startHealthTick(lobbyId: string): void {
    const interval = setInterval(() => {
      const game = this.games.get(lobbyId)
      if (!game) {
        clearInterval(interval)
        this.healthTicks.delete(lobbyId)
        return
      }

      const players = game.players
      let anyEliminated = false

      for (const userId of Object.keys(players)) {
        const player = players[userId]!
        if (player.endTimeStamp !== 0) continue // already eliminated

        player.healthMs = applyHealthTick(player.healthMs, 500)

        if (player.healthMs <= 0) {
          player.endTimeStamp = Date.now()
          anyEliminated = true
        }
      }

      // Broadcast health update for non-eliminated players
      const activePlayers = Object.entries(players)
        .filter(([, p]) => p.endTimeStamp === 0)
        .map(([userId, p]) => ({ userId, healthMs: p.healthMs }))

      this.broadcast(lobbyId, {
        type: 'player_health_update',
        lobbyId,
        players: activePlayers,
      })

      // If any player was eliminated this tick, broadcast game_state_update
      if (anyEliminated) {
        this.broadcast(lobbyId, {
          type: 'game_state_update',
          lobbyId,
          players: Object.entries(players).map(([userId, p]) => ({
            userId,
            guessCount: p.guesses.length,
            won: false,
            eliminated: p.endTimeStamp > 0,
            healthMs: p.healthMs,
          })),
        })

        // Check win condition
        if (activePlayers.length <= 1) {
          this.checkAndHandleGameOver(lobbyId)
        }
      }
    }, 500)

    this.healthTicks.set(lobbyId, interval)
  }

  private startBotSimulation(lobbyId: string): void {
    const game = this.games.get(lobbyId)
    if (!game) return

    const botIds = Object.entries(game.players)
      .filter(([, p]) => p.isBot === true)
      .map(([id]) => id)

    for (const botId of botIds) {
      const intervalMs = Math.floor(Math.random() * 5000) + 3000
      const key = `${lobbyId}:${botId}`
      const interval = setInterval(() => {
        const g = this.games.get(lobbyId)
        if (!g || !g.started) {
          clearInterval(interval)
          this.botIntervals.delete(key)
          return
        }
        const bot = g.players[botId]
        if (!bot || bot.endTimeStamp !== 0) {
          clearInterval(interval)
          this.botIntervals.delete(key)
          return
        }
        const word = FIVE_LETTER_WORDS[Math.floor(Math.random() * FIVE_LETTER_WORDS.length)]!
        this.processGuess(lobbyId, botId, word)
      }, intervalMs)
      this.botIntervals.set(key, interval)
    }
  }

  private checkAndHandleGameOver(lobbyId: string): void {
    const game = this.games.get(lobbyId)
    if (!game) return

    const players = game.players
    const nonEliminated = Object.entries(players).filter(([, p]) => p.endTimeStamp === 0)

    if (nonEliminated.length > 1) return

    // Stop the health tick
    const tick = this.healthTicks.get(lobbyId)
    if (tick) {
      clearInterval(tick)
      this.healthTicks.delete(lobbyId)
    }

    // Clear bot intervals
    for (const [key, interval] of this.botIntervals) {
      if (key.startsWith(`${lobbyId}:`)) {
        clearInterval(interval)
        this.botIntervals.delete(key)
      }
    }

    // Determine winner
    let winner = ''
    if (nonEliminated.length === 1) {
      winner = nonEliminated[0]![0]
    }

    game.winner = winner
    game.started = false

    this.broadcast(lobbyId, {
      type: 'game_over',
      lobbyId,
      winner,
      players: Object.entries(players).map(([userId, p]) => ({
        userId,
        secretWord: p.word,
        guesses: p.guesses,
        won: userId === winner,
      })),
    })
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
    
    // Add player to game if game exists
    const game = this.games.get(lobbyId)
    if (game && !game.players[conn.uid]) {
      game.players[conn.uid] = {
        word: '',
        guesses: [],
        endTimeStamp: 0,
        backlog: [],
        backlogGuesses: [],
        healthMs: 0,
        activeWord: '',
        activeWordGuesses: [],
        attackQueue: [],
        targetMode: 'random',
        targetUserId: '',
      }
    }
  }

  canJoinLobby(lobbyId: string): boolean {
    const game = this.games.get(lobbyId)
    if (!game || game.started) return false
    return this.getMembers(lobbyId).length < game.maxPlayers
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
        const healthTick = this.healthTicks.get(lobbyId)
        if (healthTick) {
          clearInterval(healthTick)
          this.healthTicks.delete(lobbyId)
        }
        for (const [key, interval] of this.botIntervals) {
          if (key.startsWith(`${lobbyId}:`)) {
            clearInterval(interval)
            this.botIntervals.delete(key)
          }
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

  private sendToPlayer(lobbyId: string, userId: string, msg: ClientMessage): void {
    const members = this.lobbies.get(lobbyId)
    if (!members) return
    const serialized = serializeMessage(msg)
    for (const conn of members) {
      if (conn.uid === userId) {
        conn.ws.send(serialized)
        return
      }
    }
  }

  private selectTarget(lobbyId: string, attackerId: string): string | null {
    const game = this.games.get(lobbyId)
    if (!game) return null

    const activePlayers = Object.entries(game.players)
      .filter(([uid, p]) => uid !== attackerId && p.endTimeStamp === 0)

    if (activePlayers.length === 0) return null

    const attacker = game.players[attackerId]
    if (!attacker) return null

    switch (attacker.targetMode) {
      case 'random': {
        const idx = Math.floor(Math.random() * activePlayers.length)
        return activePlayers[idx]![0]
      }
      case 'first': {
        // highest healthMs
        return activePlayers.reduce((best, cur) =>
          cur[1].healthMs > best[1].healthMs ? cur : best
        )[0]
      }
      case 'last': {
        // lowest healthMs
        return activePlayers.reduce((best, cur) =>
          cur[1].healthMs < best[1].healthMs ? cur : best
        )[0]
      }
      case 'specific': {
        const target = attacker.targetUserId
        if (target && activePlayers.some(([uid]) => uid === target)) {
          return target
        }
        // fall back to random
        const idx = Math.floor(Math.random() * activePlayers.length)
        return activePlayers[idx]![0]
      }
      default:
        return null
    }
  }

  private transitionActiveWord(lobbyId: string, userId: string): void {
    const game = this.games.get(lobbyId)
    if (!game) return
    const player = game.players[userId]
    if (!player) return

    if (player.attackQueue.length > 0) {
      const entry = player.attackQueue.shift()!
      player.activeWord = entry.word
      player.activeWordGuesses = []
    } else {
      const newWord = FIVE_LETTER_WORDS[Math.floor(Math.random() * FIVE_LETTER_WORDS.length)]!
      player.activeWord = newWord
      player.activeWordGuesses = []
    }
  }

  receiveAttack(lobbyId: string, targetUserId: string, attackEntry: { word: string; revealedPositions: number[] }, fromUserId: string): void {
    const game = this.games.get(lobbyId)
    if (!game) return
    const target = game.players[targetUserId]
    if (!target) return

    // Return early if target is already eliminated
    if (target.endTimeStamp !== 0) return

    let revealedPositions = attackEntry.revealedPositions

    if (target.attackQueue.length < 4) {
      target.attackQueue = [...target.attackQueue, { word: attackEntry.word, revealedPositions }]
    } else {
      // Overflow: decrement revealed count by 1 (min 0), replace oldest entry
      const decremented = Math.max(0, revealedPositions.length - 1)
      revealedPositions = revealedPositions.slice(0, decremented)
      target.attackQueue = [...target.attackQueue.slice(1), { word: attackEntry.word, revealedPositions }]
    }

    this.sendToPlayer(lobbyId, targetUserId, {
      type: 'attack_word',
      lobbyId,
      fromUserId,
      word: attackEntry.word,
      revealedPositions,
    })
  }

  processGuess(lobbyId: string, userId: string, guess: string): void {
    const game = this.games.get(lobbyId)
    if (!game || !game.started) return

    const player = game.players[userId]
    if (!player) return

    // 2. Player already eliminated
    if (player.endTimeStamp !== 0) {
      this.sendToPlayer(lobbyId, userId, { type: 'error', reason: 'game_already_ended' })
      return
    }

    // 3. Validate guess length
    if (guess.length !== 5) {
      this.sendToPlayer(lobbyId, userId, { type: 'error', reason: 'invalid_guess_length' })
      return
    }

    // 4. Validate guess in word list
    if (!FIVE_LETTER_WORDS.includes(guess.toUpperCase() as typeof FIVE_LETTER_WORDS[number])) {
      this.sendToPlayer(lobbyId, userId, { type: 'error', reason: 'invalid_guess_word' })
      return
    }

    // 5. Normalize
    const normalizedGuess = guess.toUpperCase()

    // 6. Compute feedback
    const feedback = computeFeedback(normalizedGuess, player.activeWord)

    // 7 & 8. Append to guesses
    player.activeWordGuesses.push(normalizedGuess)
    player.guesses.push(normalizedGuess)

    // 9. Send guess_result to submitting player only
    this.sendToPlayer(lobbyId, userId, {
      type: 'guess_result',
      lobbyId,
      guess: normalizedGuess,
      feedback,
    })

    const solved = feedback.every((f) => f === 'correct')

    // 10. Solved
    if (solved) {
      player.healthMs = applyWordSolvedBonus(player.healthMs)

      const targetUserId = this.selectTarget(lobbyId, userId)
      if (targetUserId) {
        const revealedPositions = computeRevealedPositions(
          player.activeWord,
          player.activeWordGuesses.length,
        )
        this.receiveAttack(lobbyId, targetUserId, {
          word: player.activeWord,
          revealedPositions,
        }, userId)
      }

      this.transitionActiveWord(lobbyId, userId)
    }
    // 11. 6th failed guess
    else if (player.activeWordGuesses.length >= 6) {
      player.healthMs = applyFailurePenalty(player.healthMs)
      this.transitionActiveWord(lobbyId, userId)
    }

    // 12. Broadcast game_state_update
    this.broadcast(lobbyId, {
      type: 'game_state_update',
      lobbyId,
      players: Object.entries(game.players).map(([uid, p]) => ({
        userId: uid,
        guessCount: p.guesses.length,
        won: false,
        eliminated: p.endTimeStamp > 0,
        healthMs: p.healthMs,
      })),
    })

    // 13. Check win condition
    const activePlayers = Object.values(game.players).filter((p) => p.endTimeStamp === 0)
    if (activePlayers.length === 0) {
      this.checkAndHandleGameOver(lobbyId)
    }
  }

  setTarget(lobbyId: string, userId: string, targetUserId: string): void {
    const game = this.games.get(lobbyId)
    if (!game) return

    const player = game.players[userId]
    if (!player) return

    player.targetMode = 'specific'
    player.targetUserId = targetUserId
  }
}
