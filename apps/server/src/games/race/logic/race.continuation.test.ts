import { randomUUID } from "node:crypto";
import fc from "fast-check";
import type { Namespace } from "socket.io";
import { eliminationCount } from "shared/race.js";
import type { RaceConfig } from "shared/race.js";
import type { RaceMatch, RacePlayer } from "types/race.types.js";
import { describe, expect, it, vi } from "vitest";
import { type RoundLifecycleDeps, endRound } from "./race.js";

// Feature: round-based-elimination-race, Property 8: Post-elimination
// continuation matches the survivor count.
//
// For any post-elimination survivor set in a NON-final round, `endRound`'s
// resolution:
//   - begins the next round when >= 2 survivors advance (Req 5.6) — the match
//     is NOT finished (finishMatch is not called),
//   - declares the single remaining survivor the winner and finishes when
//     exactly one advances (Req 5.7),
//   - finishes as a draw with no winner (winnerId undefined) when none remain
//     (Req 5.8).
//
// The number of ADVANCING survivors is `n - eliminationCount(n, pct)` over the
// non-eliminated field. `finishMatch` is injected as a spy so the branch is
// observed without recording/broadcasting a real result; `serverOnlyData` is
// empty so the >= 2 branch begins the next round synchronously (setting the
// room back to the `round` phase) rather than scheduling an intermission timer.
//
// Validates: Requirements 5.6, 5.7, 5.8

// A three-round config so a non-final round (index 0) always has a next round
// to begin for the >= 2 branch. eliminationPct is set per-test via the round
// the match sits on; the values below are placeholders overridden by cloning.
const baseConfig: RaceConfig = {
  rounds: [
    { timerMs: 60_000, wordLength: 4, qualifyingCount: 1, eliminationPct: 0.3 },
    { timerMs: 60_000, wordLength: 5, qualifyingCount: 1, eliminationPct: 0.4 },
    { timerMs: 60_000, wordLength: 6, qualifyingCount: 1, eliminationPct: 0 },
  ],
  minLobbySize: 2,
  maxLobbySize: 32,
  lobbyCountdownMs: 30_000,
  penaltyThresholdMs: 300,
  debounceAmountMs: 600,
  updateWindowMs: 250,
};

// A config on a non-final round (index 0) with the round's eliminationPct set.
const configWithPct = (pct: number): RaceConfig => ({
  ...baseConfig,
  rounds: [
    { ...baseConfig.rounds[0], eliminationPct: pct },
    baseConfig.rounds[1],
    baseConfig.rounds[2],
  ],
});

const makePlayer = (fields: Partial<RacePlayer> = {}): RacePlayer => ({
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
  ...fields,
});

// A match parked at round index 0 (a non-final round) with `survivors`
// non-eliminated players plus `eliminatedBefore` already-eliminated players
// (which take no further part and must not affect the advancing count).
const makeMatch = (
  survivors: number,
  eliminatedBefore: number,
): { match: RaceMatch; survivorIds: string[] } => {
  const players = new Map<string, RacePlayer>();
  const survivorIds: string[] = [];
  for (let i = 0; i < survivors; i++) {
    const id = randomUUID();
    survivorIds.push(id);
    // Vary per-round progress so ranking has something to order by.
    players.set(id, makePlayer({ completedWords: i, roundGuesses: i }));
  }
  for (let i = 0; i < eliminatedBefore; i++) {
    players.set(
      randomUUID(),
      makePlayer({ isEliminated: true, eliminatedAt: 1 }),
    );
  }
  const now = Date.now();
  const match: RaceMatch = {
    room: {
      matchId: randomUUID(),
      phase: "round",
      createdAt: now,
      lobbyDeadline: now,
      currentRoundIndex: 0,
      isDraw: false,
    },
    players,
  };
  return { match, survivorIds };
};

// A mock Namespace exposing the `to(room).emit(event, payload)` chain with a
// no-op emit (broadcasts here are incidental to the branch under test).
const makeNsp = (): Namespace => {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { to } as unknown as Namespace;
};

// Deps with a spy finishMatch and an empty serverOnlyData map (so the >= 2
// branch begins the next round synchronously instead of arming a timer).
const makeDeps = (): {
  deps: RoundLifecycleDeps;
  finishMatch: ReturnType<typeof vi.fn>;
} => {
  const finishMatch = vi.fn();
  return {
    deps: {
      serverOnlyData: new Map(),
      finishMatch,
      now: () => 1_000,
      // Deterministic word so the synchronous beginRound in the >= 2 branch
      // never touches the real word list.
      assignWord: () => "aaaa",
    },
    finishMatch,
  };
};

const advancing = (n: number, pct: number): number =>
  n - eliminationCount(n, pct);

describe("post-elimination continuation matches the survivor count (Property 8)", () => {
  // >= 2 advancing → begin the next round, do NOT finish (Req 5.6). A small
  // pct with n >= 3 leaves at least two advancing.
  it("begins the next round without finishing when >= 2 survivors advance", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 20 }),
        fc.integer({ min: 0, max: 4 }),
        (n, elimBefore) => {
          const pct = 0.1; // ceil(n*0.1) eliminations → n - that stays >= 2
          fc.pre(advancing(n, pct) >= 2);
          const config = configWithPct(pct);
          const { match } = makeMatch(n, elimBefore);
          const { deps, finishMatch } = makeDeps();

          endRound(match, makeNsp(), config, deps);

          // Not finished: the match continues into the next round.
          expect(finishMatch).not.toHaveBeenCalled();
          // With no server-only record the next round begins synchronously,
          // putting the room back into the `round` phase at the next index.
          expect(match.room.phase).toBe("round");
          expect(match.room.currentRoundIndex).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Exactly 1 advancing → declare that survivor the winner and finish (Req 5.7).
  // pct = 1 eliminates all but one (eliminationCount = n - 1), so the top-ranked
  // survivor is the lone advancer.
  it("declares the single remaining survivor the winner and finishes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 20 }), (n) => {
        const pct = 1; // eliminationCount(n, 1) === n - 1 → exactly 1 advances
        fc.pre(advancing(n, pct) === 1);
        const config = configWithPct(pct);
        const { match } = makeMatch(n, 0);
        const { deps, finishMatch } = makeDeps();

        endRound(match, makeNsp(), config, deps);

        // Finished exactly once with a defined winner id drawn from the field.
        expect(finishMatch).toHaveBeenCalledTimes(1);
        const winnerId = finishMatch.mock.calls[0]?.[3] as string | undefined;
        expect(winnerId).toBeDefined();
        expect(match.players.has(winnerId as string)).toBe(true);
        // The declared winner is a survivor (not one eliminated this tick).
        expect(match.players.get(winnerId as string)?.isEliminated).toBe(false);
        // Room did not transition into the next round.
        expect(match.room.currentRoundIndex).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  // 0 advancing → finish as a draw with no winner (Req 5.8). Reachable in a
  // non-final round only when zero survivors enter resolution (the field is all
  // already eliminated), since eliminationCount clamps to leave >= 1 when n > 1.
  it("finishes as a draw with no winner when no survivors remain", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (elimBefore) => {
        const config = configWithPct(0.5);
        const { match } = makeMatch(0, elimBefore);
        const { deps, finishMatch } = makeDeps();

        endRound(match, makeNsp(), config, deps);

        // Finished as a draw: finishMatch called once with an undefined winner.
        expect(finishMatch).toHaveBeenCalledTimes(1);
        expect(finishMatch.mock.calls[0]?.[3]).toBeUndefined();
        expect(match.room.currentRoundIndex).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
