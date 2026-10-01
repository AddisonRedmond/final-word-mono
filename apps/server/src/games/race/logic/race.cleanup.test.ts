import { randomUUID } from "node:crypto";
import type { RaceMatch, RacePlayer } from "types/race.types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RaceRoomServerData,
  RaceServerBotData,
} from "../state.js";
import { cleanupMatch } from "./race.js";

// Feature: round-based-elimination-race, Task 7.11: match teardown (cleanupMatch).
//
// When the last Player leaves a Lobby or Match, the Race_Server clears the
// room's timers and deletes its in-memory state (Req 9.4). `cleanupMatch`
// clears all five room timers — the one-shot setTimeout handles
// (lobbyCountdown, roundTimer, intermissionTimer) via clearTimeout, and the
// setInterval-based tickers (botTicker, updateTicker) via clearInterval — then
// removes the match from `matches`, the room from `serverOnlyData`, and the
// room's bots from `serverOnlyBotData`. The state maps are injected so this is
// exercised without touching module globals.
//
// Validates: Requirements 9.4

const makePlayer = (): RacePlayer => ({
  name: "p",
  isBot: false,
  isEliminated: false,
  completedWords: 0,
  qualified: false,
  qualifiedAt: undefined,
  roundGuesses: 0,
  totalGuesses: 0,
  correctGuesses: 0,
  correctLetters: 0,
});

const makeMatch = (matchId: string): RaceMatch => {
  const now = Date.now();
  return {
    room: {
      matchId,
      phase: "round",
      createdAt: now,
      lobbyDeadline: now,
      currentRoundIndex: 0,
      isDraw: false,
    },
    players: new Map([[randomUUID(), makePlayer()]]),
  };
};

// A room whose timers object holds real setTimeout handles for the three
// one-shot timers and real setInterval handles for the two tickers, so cleanup
// has genuine handles to clear.
const makeRoomServerData = (): RaceRoomServerData => ({
  players: {},
  timers: {
    lobbyCountdown: setTimeout(() => {}, 60_000),
    roundTimer: setTimeout(() => {}, 60_000),
    intermissionTimer: setTimeout(() => {}, 60_000),
    botTicker: setInterval(() => {}, 60_000),
    updateTicker: setInterval(() => {}, 60_000),
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cleanupMatch clears timers and deletes room state (Req 9.4)", () => {
  it("clears all five timers and removes the match, room, and bots", () => {
    const matchId = randomUUID();
    const matches = new Map<string, RaceMatch>([[matchId, makeMatch(matchId)]]);
    const room = makeRoomServerData();
    const serverOnlyData = new Map<string, RaceRoomServerData>([
      [matchId, room],
    ]);
    const botData: RaceServerBotData = new Map([
      [
        matchId,
        {
          bot0: {
            word: "abcd",
            level: 3,
            botCompletedWords: 0,
            botGuesses: 0,
          },
        },
      ],
    ]);

    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");

    const { lobbyCountdown, roundTimer, intermissionTimer, botTicker, updateTicker } =
      room.timers;

    cleanupMatch(matchId, matches, serverOnlyData, botData);

    // The three one-shot timers are cleared with clearTimeout.
    expect(clearTimeoutSpy).toHaveBeenCalledWith(lobbyCountdown);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(roundTimer);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(intermissionTimer);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(3);

    // The two tickers are cleared with clearInterval.
    expect(clearIntervalSpy).toHaveBeenCalledWith(botTicker);
    expect(clearIntervalSpy).toHaveBeenCalledWith(updateTicker);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);

    // All room state is deleted.
    expect(matches.has(matchId)).toBe(false);
    expect(serverOnlyData.has(matchId)).toBe(false);
    expect(botData.has(matchId)).toBe(false);
  });

  it("no scheduled callback fires after cleanup (fake timers)", () => {
    vi.useFakeTimers();
    try {
      const matchId = randomUUID();
      const lobbyCb = vi.fn();
      const roundCb = vi.fn();
      const intermissionCb = vi.fn();
      const botCb = vi.fn();
      const updateCb = vi.fn();

      const room: RaceRoomServerData = {
        players: {},
        timers: {
          lobbyCountdown: setTimeout(lobbyCb, 1_000),
          roundTimer: setTimeout(roundCb, 1_000),
          intermissionTimer: setTimeout(intermissionCb, 1_000),
          botTicker: setInterval(botCb, 1_000),
          updateTicker: setInterval(updateCb, 1_000),
        },
      };

      const matches = new Map<string, RaceMatch>([
        [matchId, makeMatch(matchId)],
      ]);
      const serverOnlyData = new Map<string, RaceRoomServerData>([
        [matchId, room],
      ]);
      const botData: RaceServerBotData = new Map([[matchId, {}]]);

      cleanupMatch(matchId, matches, serverOnlyData, botData);

      // Advance well past every scheduled delay: nothing should fire because
      // every handle was cleared before state deletion (Req 9.4).
      vi.advanceTimersByTime(10_000);

      expect(lobbyCb).not.toHaveBeenCalled();
      expect(roundCb).not.toHaveBeenCalled();
      expect(intermissionCb).not.toHaveBeenCalled();
      expect(botCb).not.toHaveBeenCalled();
      expect(updateCb).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a no-op-safe when the room armed no timers", () => {
    const matchId = randomUUID();
    const room: RaceRoomServerData = { players: {}, timers: {} };
    const matches = new Map<string, RaceMatch>([[matchId, makeMatch(matchId)]]);
    const serverOnlyData = new Map<string, RaceRoomServerData>([
      [matchId, room],
    ]);
    const botData: RaceServerBotData = new Map([[matchId, {}]]);

    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");

    cleanupMatch(matchId, matches, serverOnlyData, botData);

    expect(clearTimeoutSpy).not.toHaveBeenCalled();
    expect(clearIntervalSpy).not.toHaveBeenCalled();
    expect(matches.has(matchId)).toBe(false);
    expect(serverOnlyData.has(matchId)).toBe(false);
    expect(botData.has(matchId)).toBe(false);
  });

  it("is safe to call for a match with no server-only record", () => {
    const matchId = randomUUID();
    const matches = new Map<string, RaceMatch>([[matchId, makeMatch(matchId)]]);
    const serverOnlyData = new Map<string, RaceRoomServerData>();
    const botData: RaceServerBotData = new Map();

    expect(() =>
      cleanupMatch(matchId, matches, serverOnlyData, botData),
    ).not.toThrow();
    expect(matches.has(matchId)).toBe(false);
  });
});
