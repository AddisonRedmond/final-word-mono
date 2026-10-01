import { randomUUID } from "node:crypto";
import type { Namespace } from "socket.io";
import type { RaceConfig } from "shared/race.js";
import type { RaceMatch, RacePlayer } from "types/race.types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RaceBotServerData,
  RaceRoomServerData,
} from "../state.js";
import { beginRound } from "./race.js";

// Feature: round-based-elimination-race — bots actually guess.
//
// `beginRound` must start the bot ticker for the round so bots race their own
// words, and each bot word completion must be mirrored onto the bot's DISPLAY
// player (completedWords/roundGuesses + qualification latch) so the rest of the
// field sees bot progress. This test drives a real room record with one bot,
// forces the bot's simulated guess to be "correct", advances fake timers past
// the bot's think window, and asserts the bot's display progress advanced.

const config: RaceConfig = {
  rounds: [
    { timerMs: 90_000, wordLength: 4, qualifyingCount: 3, eliminationPct: 0.3 },
    { timerMs: 75_000, wordLength: 5, qualifyingCount: 2, eliminationPct: 0.4 },
    { timerMs: 60_000, wordLength: 6, qualifyingCount: 1, eliminationPct: 0 },
  ],
  minLobbySize: 2,
  maxLobbySize: 99,
  lobbyCountdownMs: 30_000,
  penaltyThresholdMs: 300,
  debounceAmountMs: 600,
  updateWindowMs: 250,
};

const makePlayer = (fields: Partial<RacePlayer> = {}): RacePlayer => ({
  name: "p",
  isBot: false,
  isEliminated: false,
  completedWords: 0,
  qualified: false,
  roundGuesses: 0,
  totalGuesses: 0,
  correctGuesses: 0,
  correctLetters: 0,
  ...fields,
});

const makeNsp = (): Namespace => {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { to } as unknown as Namespace;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("beginRound starts the bot ticker and mirrors bot progress", () => {
  it("advances a bot's display completedWords when it completes a word", () => {
    vi.useFakeTimers();
    // Force every simulated bot guess to be "correct" (rollBotCorrect compares
    // Math.random()*100 < chance; 0 is always below the chance).
    vi.spyOn(Math, "random").mockReturnValue(0);

    const human = randomUUID();
    const match: RaceMatch = {
      room: {
        matchId: randomUUID(),
        phase: "lobby",
        createdAt: 0,
        lobbyDeadline: 0,
        currentRoundIndex: 0,
        isDraw: false,
      },
      players: new Map<string, RacePlayer>([
        [human, makePlayer({ name: "alice" })],
        ["bot0", makePlayer({ name: "bot0", isBot: true })],
      ]),
    };

    // A live room server record (needed for beginRound to arm timers + ticker)
    // and a bot simulation record for bot0.
    const botData: { [botId: string]: RaceBotServerData } = {
      bot0: {
        word: "WORD",
        level: 5,
        botCompletedWords: 0,
        botGuesses: 0,
      },
    };
    const roomServerData: RaceRoomServerData = {
      players: { [human]: { word: "", lastAcceptedGuessAt: 0 } },
      timers: {},
    };
    const serverOnlyData = new Map([[match.room.matchId, roomServerData]]);

    beginRound(match, makeNsp(), config, 0, { serverOnlyData, botData });

    // The ticker was armed.
    expect(roomServerData.timers.botTicker).toBeDefined();
    // The bot hasn't guessed yet (first tick only schedules its think time).
    expect(match.players.get("bot0")?.completedWords).toBe(0);

    // Advance well past the bot's max think window + tick interval so it takes
    // at least one "correct" guess.
    vi.advanceTimersByTime(20_000);

    // The bot's DISPLAY progress advanced (mirrored from the ticker).
    const bot = match.players.get("bot0");
    expect((bot?.completedWords ?? 0)).toBeGreaterThan(0);
    expect((bot?.roundGuesses ?? 0)).toBeGreaterThan(0);

    // Clean up the interval so it doesn't leak past the test.
    if (roomServerData.timers.botTicker) {
      clearInterval(roomServerData.timers.botTicker);
    }
  });

  it("does not arm a bot ticker when the room has no bots", () => {
    vi.useFakeTimers();
    const human = randomUUID();
    const match: RaceMatch = {
      room: {
        matchId: randomUUID(),
        phase: "lobby",
        createdAt: 0,
        lobbyDeadline: 0,
        currentRoundIndex: 0,
        isDraw: false,
      },
      players: new Map<string, RacePlayer>([[human, makePlayer()]]),
    };
    const roomServerData: RaceRoomServerData = {
      players: { [human]: { word: "", lastAcceptedGuessAt: 0 } },
      timers: {},
    };
    const serverOnlyData = new Map([[match.room.matchId, roomServerData]]);

    beginRound(match, makeNsp(), config, 0, { serverOnlyData, botData: {} });

    expect(roomServerData.timers.botTicker).toBeUndefined();

    if (roomServerData.timers.roundTimer) {
      clearTimeout(roomServerData.timers.roundTimer);
    }
  });
});

describe("bot final-round win", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("finishes the match immediately when a bot completes its word on the final round", () => {
    vi.useFakeTimers();
    // Force every simulated bot guess correct.
    vi.spyOn(Math, "random").mockReturnValue(0);

    const finalRoundIndex = config.rounds.length - 1;
    const human = randomUUID();
    const match: RaceMatch = {
      room: {
        matchId: randomUUID(),
        phase: "lobby",
        createdAt: 0,
        lobbyDeadline: 0,
        currentRoundIndex: 0,
        isDraw: false,
      },
      players: new Map<string, RacePlayer>([
        [human, makePlayer({ name: "alice" })],
        ["bot0", makePlayer({ name: "bot0", isBot: true })],
      ]),
    };

    const botData: { [botId: string]: RaceBotServerData } = {
      bot0: {
        word: "?".repeat(config.rounds[finalRoundIndex]?.wordLength ?? 6),
        level: 5,
        botCompletedWords: 0,
        botGuesses: 0,
      },
    };
    const roomServerData: RaceRoomServerData = {
      players: { [human]: { word: "", lastAcceptedGuessAt: 0 } },
      timers: {},
    };
    const serverOnlyData = new Map([[match.room.matchId, roomServerData]]);
    // Stub persistence + teardown so the real finishMatch (invoked by
    // handleFinalRoundWin) records the outcome on the room without touching the
    // DB or the module's global state maps.
    const persistRaceStats = vi.fn(async () => {});
    const cleanupMatch = vi.fn();

    // Begin the FINAL round directly. When the bot completes its word the
    // ticker callback declares the final-round win via handleFinalRoundWin.
    beginRound(match, makeNsp(), config, finalRoundIndex, {
      serverOnlyData,
      botData,
      persistRaceStats,
      cleanupMatch,
    });

    // Advance past the bot's think window so it completes its final-round word.
    vi.advanceTimersByTime(30_000);

    // The bot's completed word on the final round finishes the match with the
    // bot as the winner.
    expect(match.room.phase).toBe("finished");
    expect(match.room.winnerId).toBe("bot0");
    expect(cleanupMatch).toHaveBeenCalledWith(match.room.matchId);

    if (roomServerData.timers.botTicker) {
      clearInterval(roomServerData.timers.botTicker);
    }
  });
});
