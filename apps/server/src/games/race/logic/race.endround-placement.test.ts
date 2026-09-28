import { randomUUID } from "node:crypto";
import fc from "fast-check";
import type { Namespace } from "socket.io";
import type { RaceConfig } from "shared/race.js";
import { eliminationCount } from "shared/race.js";
import type { RaceMatch, RacePlayer } from "types/race.types.js";
import { describe, expect, it, vi } from "vitest";
import type { RaceRoomServerData } from "../state.js";
import { type RoundLifecycleDeps, endRound } from "./race.js";

// Feature: round-based-elimination-race, Property 7: Eliminated players receive a placement and elimination time
//
// For any round-end elimination on a NON-final round, every eliminated survivor
// is assigned a `placement` and an `eliminatedAt` (=== the elimination time),
// and no surviving (advancing) player is assigned an `eliminatedAt`.
//
// Validates: Requirements 5.5

// A two-round config: round 0 is NON-final (so endRound eliminates a suffix),
// round 1 is the final round. `eliminationPct = 0.5` guarantees
// `eliminationCount(n, 0.5) >= 1` for every field of n >= 2 survivors, so at
// least one survivor is always eliminated on round 0.
const config: RaceConfig = {
  rounds: [
    { timerMs: 60_000, wordLength: 4, qualifyingCount: 2, eliminationPct: 0.5 },
    { timerMs: 60_000, wordLength: 5, qualifyingCount: 1, eliminationPct: 0 },
  ],
  minLobbySize: 2,
  maxLobbySize: 8,
  lobbyCountdownMs: 30_000,
  penaltyThresholdMs: 300,
  debounceAmountMs: 600,
  updateWindowMs: 250,
};

// The fixed timestamp endRound stamps onto every player it eliminates this tick.
const NOW = 1_700_000_000_000;

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

// A match sitting on round 0 (the non-final round) in the `round` phase.
const makeMatch = (players: Map<string, RacePlayer>): RaceMatch => {
  const createdAt = NOW - 10_000;
  return {
    room: {
      matchId: randomUUID(),
      phase: "round",
      createdAt,
      lobbyDeadline: createdAt,
      currentRoundIndex: 0,
      isDraw: false,
    },
    players,
  };
};

// Mock Socket.IO Namespace exposing the `to(room).emit(event, payload)` chain
// so endRound's `round:transition` / `eliminated` broadcasts (and any
// emitRaceUpdate on continuation) don't touch a real namespace.
const makeNsp = (): Namespace => {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { to } as unknown as Namespace;
};

// Deterministic deps: fixed `now`, a stub `finishMatch` so the sole-survivor /
// draw continuation never runs the real finish, a stub `assignWord` so the
// >=2-survivor continuation into beginRound draws no real random word, and an
// empty serverOnlyData Map so no round/intermission timers are looked up.
const makeDeps = (): RoundLifecycleDeps => ({
  serverOnlyData: new Map<string, RaceRoomServerData>(),
  finishMatch: vi.fn(),
  now: () => NOW,
  assignWord: () => "test",
});

describe("endRound stamps placement + eliminatedAt on eliminated survivors (Property 7)", () => {
  // A field of N (>= 2) non-eliminated survivors with varied ranking-relevant
  // fields (qualified / qualifiedAt / completedWords / roundGuesses) so the
  // ranking — and therefore which suffix gets eliminated — varies across runs.
  const fieldArb = fc
    .array(
      fc.record({
        qualified: fc.boolean(),
        qualifiedAt: fc.integer({ min: 1, max: 60_000 }),
        completedWords: fc.integer({ min: 0, max: 4 }),
        roundGuesses: fc.integer({ min: 0, max: 8 }),
      }),
      { minLength: 2, maxLength: 8 },
    )
    .map((records) => {
      const players = new Map<string, RacePlayer>();
      for (const r of records) {
        players.set(
          randomUUID(),
          makePlayer({
            qualified: r.qualified,
            qualifiedAt: r.qualified ? r.qualifiedAt : undefined,
            completedWords: r.completedWords,
            roundGuesses: r.roundGuesses,
          }),
        );
      }
      return players;
    });

  it("eliminated players get placement + eliminatedAt=now; advancing players get no eliminatedAt", () => {
    fc.assert(
      fc.property(fieldArb, (players) => {
        const survivorCount = players.size;
        const match = makeMatch(players);
        const nsp = makeNsp();
        const deps = makeDeps();

        endRound(match, nsp, config, deps);

        // At least one survivor must have been eliminated on this non-final
        // round (guards against a vacuous pass — pct 0.5 always eliminates
        // >= 1 for n >= 2).
        const eliminated = [...players.values()].filter((p) => p.isEliminated);
        const advancing = [...players.values()].filter(
          (p) => !p.isEliminated,
        );
        expect(eliminated.length).toBe(
          eliminationCount(survivorCount, config.rounds[0]!.eliminationPct),
        );
        expect(eliminated.length).toBeGreaterThanOrEqual(1);

        // Every eliminated survivor has a defined placement AND an
        // eliminatedAt equal to the injected elimination time (Req 5.5).
        for (const player of eliminated) {
          expect(player.placement).toBeDefined();
          expect(player.eliminatedAt).toBe(NOW);
        }

        // No advancing (still-alive) player carries an eliminatedAt.
        for (const player of advancing) {
          expect(player.eliminatedAt).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("orders placements within an elimination tick by correct guesses, then correct letters, then total guesses", () => {
    // 4 survivors, round 0 pct 0.5 -> eliminate the 2 lowest-ranked. Two
    // qualified players advance (they rank ahead of non-qualified); the two
    // non-qualified players are eliminated and share the tick, so their
    // placements are ordered by performance. Field size 4 -> eliminated take
    // places 3 and 4.
    const advA = "adv-a";
    const advB = "adv-b";
    const worse = "loser-worse";
    const better = "loser-better";

    const players = new Map<string, RacePlayer>([
      // Qualified -> advance (placements 1..2, order irrelevant here).
      [advA, makePlayer({ qualified: true, qualifiedAt: 10 })],
      [advB, makePlayer({ qualified: true, qualifiedAt: 20 })],
      // Both eliminated. `better` has more correct guesses -> better placement.
      [
        better,
        makePlayer({ correctGuesses: 2, correctLetters: 3, totalGuesses: 9 }),
      ],
      [
        worse,
        makePlayer({ correctGuesses: 1, correctLetters: 8, totalGuesses: 1 }),
      ],
    ]);

    const match = makeMatch(players);
    endRound(match, makeNsp(), config, makeDeps());

    // Field of 4, 2 eliminated -> eliminated occupy places 3 (best loser) and 4.
    expect(players.get(better)?.isEliminated).toBe(true);
    expect(players.get(worse)?.isEliminated).toBe(true);
    // `better` wins the correctGuesses comparison (2 > 1) despite fewer correct
    // letters, so it takes the better (lower) placement.
    expect(players.get(better)?.placement).toBe(3);
    expect(players.get(worse)?.placement).toBe(4);
  });

  it("breaks a correct-guess tie by correct letters, then by fewer total guesses", () => {
    // Two eliminated players tied on correctGuesses; correctLetters decides.
    const advA = "adv-a";
    const advB = "adv-b";
    const moreLetters = "more-letters";
    const fewerLetters = "fewer-letters";

    const players = new Map<string, RacePlayer>([
      [advA, makePlayer({ qualified: true, qualifiedAt: 10 })],
      [advB, makePlayer({ qualified: true, qualifiedAt: 20 })],
      [
        moreLetters,
        makePlayer({ correctGuesses: 1, correctLetters: 7, totalGuesses: 5 }),
      ],
      [
        fewerLetters,
        makePlayer({ correctGuesses: 1, correctLetters: 3, totalGuesses: 2 }),
      ],
    ]);

    const match = makeMatch(players);
    endRound(match, makeNsp(), config, makeDeps());

    // Same correctGuesses (1) -> more correct letters ranks ahead (place 3),
    // even though it made more total guesses.
    expect(players.get(moreLetters)?.placement).toBe(3);
    expect(players.get(fewerLetters)?.placement).toBe(4);
  });
});
