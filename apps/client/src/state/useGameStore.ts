import { create } from "zustand"
import type { ClientMessage, ServerMessage } from "@/types/ws"

export interface OpponentState {
  userId: string
  guessCount: number
  won: boolean
  eliminated: boolean
  healthMs: number
}

export interface GameOverPayload {
  winner: string
  players: Array<{ userId: string; secretWord: string; guesses: string[]; won: boolean }>
}

interface GameState {
  lobbyId: string | null
  myUserId: string | null
  guesses: string[]
  feedbacks: Array<Array<"correct" | "present" | "absent">>
  currentInput: string
  activeWordIsAttack: boolean
  revealedPositions: number[]
  attackQueueSize: number
  opponents: OpponentState[]
  targetMode: "random" | "first" | "last" | "specific"
  targetUserId: string
  gameOver: GameOverPayload | null
  error: string | null

  setInput: (letter: string) => void
  deleteLetter: () => void
  submitGuess: (sendMessage: (msg: ServerMessage) => void) => void
  setTarget: (targetUserId: string, sendMessage: (msg: ServerMessage) => void) => void
  applyGuessResult: (msg: Extract<ClientMessage, { type: "guess_result" }>) => void
  applyGameStateUpdate: (msg: Extract<ClientMessage, { type: "game_state_update" }>) => void
  applyHealthUpdate: (msg: Extract<ClientMessage, { type: "player_health_update" }>) => void
  applyAttackWord: (msg: Extract<ClientMessage, { type: "attack_word" }>) => void
  applyGameOver: (msg: Extract<ClientMessage, { type: "game_over" }>) => void
  setGameStarted: (lobbyId: string, myUserId: string, players: string[]) => void
  reset: () => void
}

const initialState = {
  lobbyId: null,
  myUserId: null,
  guesses: [],
  feedbacks: [],
  currentInput: "",
  activeWordIsAttack: false,
  revealedPositions: [],
  attackQueueSize: 0,
  opponents: [],
  targetMode: "random" as const,
  targetUserId: "",
  gameOver: null,
  error: null,
}

export const useGameStore = create<GameState>((set, get) => ({
  ...initialState,

  setInput: (letter) =>
    set((state) =>
      state.currentInput.length < 5
        ? { currentInput: state.currentInput + letter }
        : {}
    ),

  deleteLetter: () =>
    set((state) => ({ currentInput: state.currentInput.slice(0, -1) })),

  submitGuess: (sendMessage) => {
    const state = get()
    if (state.currentInput.length === 5 && state.lobbyId) {
      sendMessage({ type: "submit_guess", lobbyId: state.lobbyId, guess: state.currentInput })
      set({ currentInput: "" })
    }
  },

  setTarget: (targetUserId, sendMessage) => {
    const state = get()
    set({ targetMode: "specific", targetUserId })
    sendMessage({ type: "set_target", lobbyId: state.lobbyId!, targetUserId })
  },

  applyGuessResult: (msg) =>
    set((state) => ({
      guesses: [...state.guesses, msg.guess],
      feedbacks: [...state.feedbacks, msg.feedback],
      currentInput: "",
      error: null,
    })),

  applyGameStateUpdate: (msg) =>
    set({ opponents: msg.players }),

  applyHealthUpdate: (msg) =>
    set((state) => ({
      opponents: state.opponents.map((opp) => {
        const update = msg.players.find((p) => p.userId === opp.userId)
        return update ? { ...opp, healthMs: update.healthMs } : opp
      }),
    })),

  applyAttackWord: (msg) =>
    set({
      activeWordIsAttack: true,
      revealedPositions: msg.revealedPositions,
      attackQueueSize: get().attackQueueSize + 1,
      guesses: [],
      feedbacks: [],
      currentInput: "",
    }),

  applyGameOver: (msg) =>
    set({ gameOver: { winner: msg.winner, players: msg.players } }),

  setGameStarted: (lobbyId, myUserId, players) =>
    set({
      lobbyId,
      myUserId,
      opponents: players
        .filter((p) => p !== myUserId)
        .map((p) => ({ userId: p, guessCount: 0, won: false, eliminated: false, healthMs: 120000 })),
      guesses: [],
      feedbacks: [],
      currentInput: "",
      gameOver: null,
      error: null,
      attackQueueSize: 0,
      activeWordIsAttack: false,
      revealedPositions: [],
    }),

  reset: () => set(initialState),
}))
