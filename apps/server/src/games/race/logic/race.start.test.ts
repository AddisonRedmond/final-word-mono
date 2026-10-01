import { randomUUID } from "node:crypto";
import type { Namespace } from "socket.io";
import type { RaceConfig } from "shared/race.js";
import type { RaceMatch, RacePlayer } from "types/race.types.js";
import { describe, expect, it, vi } from "vitest";
import { type StartMatchDeps, startMatch } from "./race.js";

// Feature: round-based-elimination-race, Task 8.2: daily-limit seam unit test.
//
// `startMatch` isolates the Daily_Game_Counter interaction behind the injected
// `canStartMatch` / `recordMatchStart` seam (daily-limit.ts) and runs it per
// real (UUID-keyed) player before handing off to `beginRound`. These tests
// assert:
//   - `recordMatchStart` fires exactly once per REAL player and never for bots
//     (Req 11.1) — real players are UUID-keyed, bots are keyed bot0/bot1/…
//   - the beta `canStartMatch` (always permits) lets the match start: the
//     injected `beginRound` stub runs (Req 11.2)
//   - the seam is consulted per real player, so a future enforcing impl plugs
//     in behind the single seam with no Match/Round change (Req 11.3, 11.4)
//
// Validates: Requirements 11.1, 11.2, 11.3, 11.4

const config: RaceConfig = {
  rounds: [
    { timerMs: 60_000, wordLength: 4, qualifyingCount: 1, eliminationPct: 0 },
  ],
  minLobbySize: 2,
  maxLobbySize: 4,
  lobbyCountdownMs: 30_000,
  penaltyThresholdMs: 300,
  debounceAmountMs: 600,
  updateWindowMs: 250,
};

const makePlayer = (isBot: boolean): RacePlayer => ({
  name: isBot ? "bot" : "player",
  isBot,
  isEliminated: false,
  completedWords: 0,
  qualified: false,
  roundGuesses: 0,
  totalGuesses: 0,
  correctGuesses: 0,
  correctLetters: 0,
});

// A lobby-phase match seeded with `realCount` UUID-keyed real players and
// `botCount` bots keyed bot0/bot1/… (the non-UUID shape startMatch treats as
// bots and excludes from the daily-limit seam).
const makeLobbyMatch = (
  realCount: number,
  botCount: number,
): { match: RaceMatch; realIds: string[] } => {
  const players = new Map<string, RacePlayer>();
  const realIds: string[] = [];
  for (let i = 0; i < realCount; i++) {
    const id = randomUUID();
    realIds.push(id);
    players.set(id, makePlayer(false));
  }
  for (let i = 0; i < botCount; i++) {
    players.set(`bot${i}`, makePlayer(true));
  }
  const now = Date.now();
  const match: RaceMatch = {
    room: {
      matchId: randomUUID(),
      phase: "lobby",
      createdAt: now,
      lobbyDeadline: now + config.lobbyCountdownMs,
      currentRoundIndex: 0,
      isDraw: false,
    },
    players,
  };
  return { match, realIds };
};

// A stub Namespace: startMatch itself never touches it (only the injected
// beginRound would), but the signature requires one. `.to()` returns an object
// with a no-op `.emit()` so any incidental broadcast is inert.
const makeNamespace = (): Namespace => {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { to, emit } as unknown as Namespace;
};

describe("startMatch daily-limit seam (Task 8.2, Req 11)", () => {
  it("records a start for each real player and none for bots, and starts under the beta permit (Req 11.1, 11.2)", async () => {
    const { match, realIds } = makeLobbyMatch(3, 2);
    const nsp = makeNamespace();

    // Beta seam: canStartMatch always permits, recordMatchStart is a no-op.
    const canStartMatch = vi.fn(async () => true);
    const recordMatchStart = vi.fn(async () => {});
    // Stub beginRound so no real round timer runs; observe the hand-off and
    // advance the phase the way the real beginRound would.
    const beginRound = vi.fn((m: RaceMatch) => {
      m.room.phase = "round";
    });

    const deps: StartMatchDeps = {
      canStartMatch,
      recordMatchStart,
      beginRound,
    };

    await startMatch(match, nsp, config, deps);

    // Req 11.1: recordMatchStart called exactly once per real player, with
    // their userids — and never for a bot.
    expect(recordMatchStart).toHaveBeenCalledTimes(realIds.length);
    const recorded = recordMatchStart.mock.calls.map((c) => c[0]);
    expect(new Set(recorded)).toEqual(new Set(realIds));
    for (const call of recorded) {
      expect(call.startsWith("bot")).toBe(false);
    }

    // Req 11.2: the beta permit lets the match start — beginRound ran and the
    // room advanced out of the lobby phase.
    expect(beginRound).toHaveBeenCalledTimes(1);
    expect(beginRound.mock.calls[0][3]).toBe(0); // round 0
    expect(match.room.phase).toBe("round");
  });

  it("consults canStartMatch once per real player, never for bots, so enforcement wires in behind the single seam (Req 11.3, 11.4)", async () => {
    // Stubbed ENFORCING impl: one real player has reached the daily limit.
    const { match, realIds } = makeLobbyMatch(3, 2);
    const nsp = makeNamespace();

    const limitReached = realIds[1];
    const canStartMatch = vi.fn(async (userId: string) => userId !== limitReached);
    const recordMatchStart = vi.fn(async () => {});
    const beginRound = vi.fn((m: RaceMatch) => {
      m.room.phase = "round";
    });

    const deps: StartMatchDeps = {
      canStartMatch,
      recordMatchStart,
      beginRound,
    };

    await startMatch(match, nsp, config, deps);

    // Req 11.3 / 11.4: the daily-limit seam is consulted for every real player
    // and no bot, so the enforcing implementation plugs in behind this single
    // seam. Match/Round logic (startMatch) does not itself branch on the
    // result — enforcement (blocking a limit-reached player) is applied at the
    // seam/handler layer per the design, so startMatch stays unchanged when
    // enforcement is enabled.
    expect(canStartMatch).toHaveBeenCalledTimes(realIds.length);
    const consulted = canStartMatch.mock.calls.map((c) => c[0]);
    expect(new Set(consulted)).toEqual(new Set(realIds));
    for (const call of consulted) {
      expect(call.startsWith("bot")).toBe(false);
    }
    // The limit-reached player was consulted (the seam saw the false permit).
    expect(consulted).toContain(limitReached);
  });

  it("skips the seam entirely for an all-bot field (bots never count against the counter, Req 11.1)", async () => {
    const { match } = makeLobbyMatch(0, 3);
    const nsp = makeNamespace();

    const canStartMatch = vi.fn(async () => true);
    const recordMatchStart = vi.fn(async () => {});
    const beginRound = vi.fn((m: RaceMatch) => {
      m.room.phase = "round";
    });

    await startMatch(match, nsp, config, {
      canStartMatch,
      recordMatchStart,
      beginRound,
    });

    expect(canStartMatch).not.toHaveBeenCalled();
    expect(recordMatchStart).not.toHaveBeenCalled();
    // The match still starts — the field is at/above minLobbySize with bots.
    expect(beginRound).toHaveBeenCalledTimes(1);
    expect(match.room.phase).toBe("round");
  });

  it("is idempotent: a match already past the lobby phase does not re-run the seam (double-start guard)", async () => {
    const { match } = makeLobbyMatch(2, 0);
    match.room.phase = "round"; // already started
    const nsp = makeNamespace();

    const canStartMatch = vi.fn(async () => true);
    const recordMatchStart = vi.fn(async () => {});
    const beginRound = vi.fn();

    await startMatch(match, nsp, config, {
      canStartMatch,
      recordMatchStart,
      beginRound,
    });

    expect(canStartMatch).not.toHaveBeenCalled();
    expect(recordMatchStart).not.toHaveBeenCalled();
    expect(beginRound).not.toHaveBeenCalled();
  });
});
