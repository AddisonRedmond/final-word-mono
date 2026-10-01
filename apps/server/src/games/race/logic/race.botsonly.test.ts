import { randomUUID } from "node:crypto";
import type { Namespace } from "socket.io";
import type { RaceConfig } from "shared/race.js";
import type { RaceMatch, RacePlayer } from "types/race.types.js";
import { describe, expect, it, vi } from "vitest";
import type { RoundLifecycleDeps } from "./race.js";

// `endRound` -> `persistEliminatedAsLoss` transitively imports the stats module
// which imports `db`. Mock `db` before importing the code under test and
// capture every upserted row so we can assert eliminated real players are
// recorded (and bots are not).
const insertedRows: Array<{ userId: string; wins: number }> = [];
vi.mock("db", () => {
  const insert = () => ({
    values: (row: { userId: string; wins: number }) => {
      insertedRows.push(row);
      return { onConflictDoUpdate: () => Promise.resolve(undefined) };
    },
  });
  return {
    db: { insert },
    raceStats: new Proxy({}, { get: (_t, key) => key }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
  };
});

const { endRound } = await import("./race.js");

// Feature: round-based-elimination-race — record-at-outcome + bots-only.
//
// Two behaviours are asserted here:
//   1. `endRound` does NOT abandon a round just because every remaining
//      survivor is a bot. Per the presence-based flow, an eliminated-but-still-
//      connected human keeps spectating, so the match continues (or finishes)
//      normally. Cleanup for a bots-only room is driven by the LAST human
//      leaving (the `leave` handler), not by elimination — see handlers.test.ts.
//   2. When `endRound` eliminates real players it records each as a loss right
//      then (Option 1: record-at-outcome), with their stamped placement, and
//      skips bots.

const baseConfig: RaceConfig = {
  rounds: [
    // Round 0 eliminates ~30% so a multi-player field drops someone.
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

const makeMatch = (entries: Array<[string, RacePlayer]>): RaceMatch => {
  const now = Date.now();
  return {
    room: {
      matchId: randomUUID(),
      phase: "round",
      createdAt: now,
      lobbyDeadline: now,
      currentRoundIndex: 0,
      isDraw: false,
    },
    players: new Map(entries),
  };
};

const makeNsp = (): Namespace => {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { to } as unknown as Namespace;
};

const makeDeps = (): {
  deps: RoundLifecycleDeps;
  finishMatch: ReturnType<typeof vi.fn>;
  cleanupMatch: ReturnType<typeof vi.fn>;
} => {
  const finishMatch = vi.fn();
  const cleanupMatch = vi.fn();
  return {
    deps: {
      serverOnlyData: new Map(),
      finishMatch,
      cleanupMatch,
      now: () => 1_000,
      assignWord: () => "aaaa",
    },
    finishMatch,
    cleanupMatch,
  };
};

describe("Race endRound: presence-based continuation + record-at-outcome", () => {
  it("does NOT abandon when only bots survive a round — the match continues/finishes normally", () => {
    // Final round with a lone bot survivor and an eliminated (spectating) human
    // still in the room: endRound resolves through finishMatch, it does not
    // tear the room down. Cleanup is the last human's leave's job.
    const match = makeMatch([
      ["bot0", makePlayer({ isBot: true, completedWords: 1 })],
      [
        randomUUID(),
        makePlayer({ isEliminated: true, eliminatedAt: 1, statsPersisted: true }),
      ],
    ]);
    match.room.currentRoundIndex = baseConfig.rounds.length - 1;
    const { deps, finishMatch, cleanupMatch } = makeDeps();

    endRound(match, makeNsp(), baseConfig, deps);

    // Not abandoned by endRound.
    expect(cleanupMatch).not.toHaveBeenCalled();
    // Resolved through the normal finish hand-off.
    expect(finishMatch).toHaveBeenCalledTimes(1);
  });

  it("records each real eliminated player as a loss at elimination, skipping bots", () => {
    insertedRows.length = 0;

    // A 4-player non-final round: 2 real + 2 bots. eliminationPct 0.3 over 4
    // eliminates 2 (the lowest-ranked). We give the two real players the worst
    // progress so they are the ones eliminated, and assert both are recorded.
    const humanA = randomUUID();
    const humanB = randomUUID();
    const match = makeMatch([
      ["bot0", makePlayer({ isBot: true, completedWords: 5 })],
      ["bot1", makePlayer({ isBot: true, completedWords: 5 })],
      [humanA, makePlayer({ completedWords: 0, totalGuesses: 3 })],
      [humanB, makePlayer({ completedWords: 0, totalGuesses: 4 })],
    ]);
    const { deps } = makeDeps();

    endRound(match, makeNsp(), baseConfig, deps);

    // Exactly the two real eliminated players were recorded (bots excluded).
    const recorded = insertedRows.map((r) => r.userId).sort();
    expect(recorded).toEqual([humanA, humanB].sort());
    // Recorded as losses (no win).
    expect(insertedRows.every((r) => r.wins === 0)).toBe(true);
    // Their statsPersisted flag latched so a later finish won't double-write.
    expect(match.players.get(humanA)?.statsPersisted).toBe(true);
    expect(match.players.get(humanB)?.statsPersisted).toBe(true);
  });
});
