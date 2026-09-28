import { randomUUID } from "node:crypto";
import fc from "fast-check";
import type { Namespace } from "socket.io";
import type { RaceConfig } from "shared/race.js";
import type { RaceMatch, RacePlayer } from "types/race.types.js";
import { describe, expect, it, vi } from "vitest";
import {
  type RoundLifecycleDeps,
  finishMatch,
  handleFinalRoundWin,
} from "./race.js";

// Feature: round-based-elimination-race, Task 7.8: final-round win + match finish.
//
// `finishMatch` sets the room to `finished`, places EVERY player (winner = 1,
// all others ranked behind — Req 6.3), broadcasts `match:result`
// { winnerId, placements } to the lobby (Req 6.6), fires persistRaceStats
// (fire-and-forget), and hands off to the injected cleanup. `handleFinalRoundWin`
// declares the first correct guesser the winner (Req 6.1, 6.2). All external
// side effects (stats persistence, cleanup) are injected here so no DB/timer is
// touched.
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.6

const config: RaceConfig = {
  rounds: [
    { timerMs: 60_000, wordLength: 4, qualifyingCount: 1, eliminationPct: 0.5 },
    { timerMs: 60_000, wordLength: 5, qualifyingCount: 1, eliminationPct: 0 },
  ],
  minLobbySize: 2,
  maxLobbySize: 8,
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
  qualifiedAt: undefined,
  roundGuesses: 0,
  totalGuesses: 0,
  correctGuesses: 0,
  correctLetters: 0,
  ...fields,
});

const makeMatch = (players: Map<string, RacePlayer>): RaceMatch => {
  const now = Date.now();
  return {
    room: {
      matchId: randomUUID(),
      phase: "round",
      createdAt: now,
      lobbyDeadline: now,
      currentRoundIndex: config.rounds.length - 1,
      isDraw: false,
    },
    players,
  };
};

// A mock Socket.IO Namespace exposing the `to(room).emit(event, payload)`
// chain, with `emit` a spy so a `match:result`/`race:update` broadcast can be
// inspected and its target room verified.
const makeNsp = () => {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { nsp: { to } as unknown as Namespace, to, emit };
};

// Deps with no real side effects: persistRaceStats/cleanupMatch are spies, and
// serverOnlyData is empty so no timers are looked up.
const makeDeps = (): {
  deps: RoundLifecycleDeps;
  persistRaceStats: ReturnType<typeof vi.fn>;
  cleanupMatch: ReturnType<typeof vi.fn>;
} => {
  const persistRaceStats = vi.fn(async () => {});
  const cleanupMatch = vi.fn();
  return {
    deps: {
      serverOnlyData: new Map(),
      persistRaceStats,
      cleanupMatch,
    },
    persistRaceStats,
    cleanupMatch,
  };
};

const resultCall = (emit: ReturnType<typeof vi.fn>) =>
  emit.mock.calls.find((c) => c[0] === "match:result");

describe("finishMatch result recording and broadcast (Req 6.3, 6.6)", () => {
  it("finishes with a winner: phase, winnerId, placement 1, and match:result", () => {
    const winnerId = randomUUID();
    const loserId = randomUUID();
    const players = new Map<string, RacePlayer>([
      [winnerId, makePlayer({ completedWords: 1 })],
      [loserId, makePlayer({ isEliminated: true, eliminatedAt: 10 })],
    ]);
    const match = makeMatch(players);
    const { nsp, to, emit } = makeNsp();
    const { deps, persistRaceStats, cleanupMatch } = makeDeps();

    finishMatch(match, nsp, config, winnerId, deps);

    // Room outcome.
    expect(match.room.phase).toBe("finished");
    expect(match.room.winnerId).toBe(winnerId);
    expect(match.room.isDraw).toBe(false);

    // Winner is placement 1; the other player is placed behind (Req 6.3).
    expect(players.get(winnerId)?.placement).toBe(1);
    expect(players.get(loserId)?.placement).toBe(2);

    // match:result broadcast to the lobby with winner + placements (Req 6.6).
    const call = resultCall(emit);
    expect(call).toBeDefined();
    expect(to).toHaveBeenCalledWith(match.room.matchId);
    const payload = call?.[1] as {
      winnerId?: string;
      placements: { playerId: string; placement: number }[];
    };
    expect(payload.winnerId).toBe(winnerId);
    expect(payload.placements).toEqual(
      expect.arrayContaining([
        { playerId: winnerId, placement: 1 },
        { playerId: loserId, placement: 2 },
      ]),
    );

    // Persist + cleanup handed off.
    expect(persistRaceStats).toHaveBeenCalledWith(match);
    expect(cleanupMatch).toHaveBeenCalledWith(match.room.matchId);
  });

  it("ranks non-winners by later elimination first (outlasting wins)", () => {
    const winnerId = randomUUID();
    const early = randomUUID(); // eliminated first → worst placement
    const late = randomUUID(); // eliminated later → better placement
    const players = new Map<string, RacePlayer>([
      [winnerId, makePlayer({ completedWords: 2 })],
      [early, makePlayer({ isEliminated: true, eliminatedAt: 5 })],
      [late, makePlayer({ isEliminated: true, eliminatedAt: 20 })],
    ]);
    const match = makeMatch(players);
    const { nsp } = makeNsp();
    const { deps } = makeDeps();

    finishMatch(match, nsp, config, winnerId, deps);

    expect(players.get(winnerId)?.placement).toBe(1);
    expect(players.get(late)?.placement).toBe(2);
    expect(players.get(early)?.placement).toBe(3);
  });

  it("finishes as a draw when no winner: isDraw, everyone placement 1, no winnerId", () => {
    const a = randomUUID();
    const b = randomUUID();
    const players = new Map<string, RacePlayer>([
      [a, makePlayer()],
      [b, makePlayer()],
    ]);
    const match = makeMatch(players);
    const { nsp, emit } = makeNsp();
    const { deps } = makeDeps();

    finishMatch(match, nsp, config, undefined, deps);

    expect(match.room.phase).toBe("finished");
    expect(match.room.isDraw).toBe(true);
    expect(match.room.winnerId).toBeUndefined();
    expect(players.get(a)?.placement).toBe(1);
    expect(players.get(b)?.placement).toBe(1);

    const call = resultCall(emit);
    const payload = call?.[1] as { winnerId?: string };
    expect(payload.winnerId).toBeUndefined();
  });

  it("is idempotent: a second finish does not re-broadcast or re-persist", () => {
    const winnerId = randomUUID();
    const players = new Map<string, RacePlayer>([
      [winnerId, makePlayer({ completedWords: 1 })],
      [randomUUID(), makePlayer({ isEliminated: true, eliminatedAt: 1 })],
    ]);
    const match = makeMatch(players);
    const { nsp, emit } = makeNsp();
    const { deps, persistRaceStats, cleanupMatch } = makeDeps();

    finishMatch(match, nsp, config, winnerId, deps);
    finishMatch(match, nsp, config, winnerId, deps);

    expect(emit.mock.calls.filter((c) => c[0] === "match:result")).toHaveLength(
      1,
    );
    expect(persistRaceStats).toHaveBeenCalledTimes(1);
    expect(cleanupMatch).toHaveBeenCalledTimes(1);
  });

  it("still finishes and broadcasts when no cleanup hook is wired (task 7.10 pending)", () => {
    const winnerId = randomUUID();
    const players = new Map<string, RacePlayer>([
      [winnerId, makePlayer({ completedWords: 1 })],
    ]);
    const match = makeMatch(players);
    const { nsp, emit } = makeNsp();
    const persistRaceStats = vi.fn(async () => {});

    // No cleanupMatch injected — finish/broadcast/persist must still complete.
    finishMatch(match, nsp, config, winnerId, {
      serverOnlyData: new Map(),
      persistRaceStats,
    });

    expect(match.room.phase).toBe("finished");
    expect(resultCall(emit)).toBeDefined();
    expect(persistRaceStats).toHaveBeenCalledWith(match);
  });
});

describe("handleFinalRoundWin first-correct-guess win (Req 6.1, 6.2)", () => {
  it("declares the guesser the winner and finishes, ranking others behind", () => {
    const guesserId = randomUUID();
    const otherId = randomUUID();
    const players = new Map<string, RacePlayer>([
      [guesserId, makePlayer({ completedWords: 0 })],
      [otherId, makePlayer({ completedWords: 0 })],
    ]);
    const match = makeMatch(players);
    const { nsp, emit } = makeNsp();
    const { deps } = makeDeps();

    handleFinalRoundWin(match, nsp, config, guesserId, deps);

    expect(match.room.phase).toBe("finished");
    expect(match.room.winnerId).toBe(guesserId);
    expect(match.room.isDraw).toBe(false);
    expect(players.get(guesserId)?.placement).toBe(1);
    expect(players.get(otherId)?.placement).toBe(2);

    const call = resultCall(emit);
    const payload = call?.[1] as { winnerId?: string };
    expect(payload.winnerId).toBe(guesserId);
  });
});

// Property: for any final-round field and any declared winner drawn from it,
// finishMatch assigns every player a placement, the winner is placement 1, and
// the placements are a permutation of 1..N with no gaps (Req 6.3).
describe("finishMatch places every player behind the winner (Property, Req 6.3)", () => {
  const fieldArb = fc
    .array(
      fc.record({
        completedWords: fc.integer({ min: 0, max: 4 }),
        roundGuesses: fc.integer({ min: 0, max: 6 }),
        eliminated: fc.boolean(),
        eliminatedAt: fc.integer({ min: 1, max: 100 }),
      }),
      { minLength: 1, maxLength: 8 },
    )
    .map((records) => {
      const players = new Map<string, RacePlayer>();
      const ids: string[] = [];
      for (const r of records) {
        const id = randomUUID();
        ids.push(id);
        players.set(
          id,
          makePlayer({
            completedWords: r.completedWords,
            roundGuesses: r.roundGuesses,
            isEliminated: r.eliminated,
            eliminatedAt: r.eliminated ? r.eliminatedAt : undefined,
          }),
        );
      }
      return { players, ids };
    });

  it("assigns winner placement 1 and a full 1..N permutation to the field", () => {
    fc.assert(
      fc.property(
        fieldArb,
        fc.nat(),
        ({ players, ids }, winnerPick) => {
          const winnerId = ids[winnerPick % ids.length] as string;
          const match = makeMatch(players);
          const { nsp } = makeNsp();
          const { deps } = makeDeps();

          finishMatch(match, nsp, config, winnerId, deps);

          // Every player has a placement (Req 6.3 — no survivor unplaced).
          const placements: number[] = [];
          for (const player of players.values()) {
            expect(player.placement).toBeDefined();
            placements.push(player.placement as number);
          }

          // Winner is placement 1.
          expect(players.get(winnerId)?.placement).toBe(1);

          // Placements are exactly the permutation 1..N (no gaps, no dupes).
          expect([...placements].sort((a, b) => a - b)).toEqual(
            Array.from({ length: players.size }, (_, i) => i + 1),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
