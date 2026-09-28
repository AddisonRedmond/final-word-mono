import { randomUUID } from "node:crypto";
import type { Namespace } from "socket.io";
import type { RaceConfig } from "shared/race.js";
import type { RaceMatch, RacePlayer } from "types/race.types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RaceRoomServerData } from "../state.js";
import {
  type RoundLifecycleDeps,
  checkEarlyRoundEnd,
  endRound,
} from "./race.js";

// Feature: round-based-elimination-race — intermission countdown.
//
// When a non-final round ends with >= 2 survivors advancing, `endRound` puts
// the room into the `intermission` phase and stamps `room.nextRoundStartsAt`
// with the absolute time the next round begins, so the client can count down to
// it. This test seeds a real room server record (so the next round is deferred
// via the intermission timer rather than beginning synchronously) and asserts
// the phase + timestamp are set before the timer fires.

const config: RaceConfig = {
  rounds: [
    { timerMs: 90_000, wordLength: 4, qualifyingCount: 1, eliminationPct: 0.5 },
    { timerMs: 75_000, wordLength: 5, qualifyingCount: 1, eliminationPct: 0.6 },
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
});

describe("endRound intermission countdown", () => {
  it("enters intermission and stamps nextRoundStartsAt when >= 2 advance", () => {
    vi.useFakeTimers();

    // 4 survivors, round 0 eliminationPct 0.5 -> eliminate 2, so 2 advance.
    const matchId = randomUUID();
    const players = new Map<string, RacePlayer>();
    for (let i = 0; i < 4; i++) {
      players.set(randomUUID(), makePlayer({ completedWords: i }));
    }
    const match: RaceMatch = {
      room: {
        matchId,
        phase: "round",
        createdAt: 0,
        lobbyDeadline: 0,
        currentRoundIndex: 0,
        roundEndsAt: 1_000,
        isDraw: false,
      },
      players,
    };

    // A real room record so the next round is DEFERRED via the intermission
    // timer (not begun synchronously), leaving the room parked in intermission.
    const roomServerData: RaceRoomServerData = { players: {}, timers: {} };
    const serverOnlyData = new Map([[matchId, roomServerData]]);
    const deps: RoundLifecycleDeps = {
      serverOnlyData,
      now: () => 1_000,
      assignWord: () => "aaaa",
    };

    endRound(match, makeNsp(), config, deps);

    // Parked in intermission with the next-round countdown stamped. The
    // intermission window is 5s, so nextRoundStartsAt = now(1000) + 5000.
    expect(match.room.phase).toBe("intermission");
    expect(match.room.nextRoundStartsAt).toBe(6_000);

    // Clean up the deferred timer so it doesn't leak.
    if (roomServerData.timers.intermissionTimer) {
      clearTimeout(roomServerData.timers.intermissionTimer);
    }
  });
});

describe("checkEarlyRoundEnd", () => {
  it("ends the round early once enough survivors qualify to fill the advancing spots", () => {
    vi.useFakeTimers();

    // 4 survivors, round 0 pct 0.5 -> eliminate 2 -> 2 advancing spots. Two
    // players are qualified, which fills both spots, so the round should end
    // early without waiting for the timer.
    const matchId = randomUUID();
    const players = new Map<string, RacePlayer>();
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    players.set(ids[0]!, makePlayer({ qualified: true, qualifiedAt: 10 }));
    players.set(ids[1]!, makePlayer({ qualified: true, qualifiedAt: 20 }));
    players.set(ids[2]!, makePlayer());
    players.set(ids[3]!, makePlayer());

    const match: RaceMatch = {
      room: {
        matchId,
        phase: "round",
        createdAt: 0,
        lobbyDeadline: 0,
        currentRoundIndex: 0,
        roundEndsAt: 90_000,
        isDraw: false,
      },
      players,
    };

    // A live round timer we expect the early-end to clear.
    const roundTimer = setTimeout(() => {}, 90_000);
    const roomServerData: RaceRoomServerData = {
      players: {},
      timers: { roundTimer },
    };
    const serverOnlyData = new Map([[matchId, roomServerData]]);
    const deps: RoundLifecycleDeps = {
      serverOnlyData,
      finishMatch: vi.fn(),
      now: () => 1_000,
      assignWord: () => "test",
    };

    checkEarlyRoundEnd(match, makeNsp(), config, deps);

    // The round resolved early: it advanced past `round` (into intermission,
    // since >= 2 advanced) and the round timer was cleared.
    expect(match.room.phase).toBe("intermission");
    expect(roomServerData.timers.roundTimer).toBeUndefined();

    if (roomServerData.timers.intermissionTimer) {
      clearTimeout(roomServerData.timers.intermissionTimer);
    }
  });

  it("does not end the round early when fewer survivors are qualified than there are spots", () => {
    vi.useFakeTimers();

    // 4 survivors, 2 spots, but only 1 qualified -> keep waiting.
    const matchId = randomUUID();
    const players = new Map<string, RacePlayer>();
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    players.set(ids[0]!, makePlayer({ qualified: true, qualifiedAt: 10 }));
    players.set(ids[1]!, makePlayer());
    players.set(ids[2]!, makePlayer());
    players.set(ids[3]!, makePlayer());

    const match: RaceMatch = {
      room: {
        matchId,
        phase: "round",
        createdAt: 0,
        lobbyDeadline: 0,
        currentRoundIndex: 0,
        roundEndsAt: 90_000,
        isDraw: false,
      },
      players,
    };

    const roundTimer = setTimeout(() => {}, 90_000);
    const roomServerData: RaceRoomServerData = {
      players: {},
      timers: { roundTimer },
    };
    const serverOnlyData = new Map([[matchId, roomServerData]]);
    const deps: RoundLifecycleDeps = {
      serverOnlyData,
      finishMatch: vi.fn(),
      now: () => 1_000,
      assignWord: () => "test",
    };

    checkEarlyRoundEnd(match, makeNsp(), config, deps);

    // Still running: the round did not end and its timer is intact.
    expect(match.room.phase).toBe("round");
    expect(roomServerData.timers.roundTimer).toBe(roundTimer);

    clearTimeout(roundTimer);
  });
});
