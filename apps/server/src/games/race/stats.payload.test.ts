import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RaceMatch, RacePlayer } from "types/race.types.js";

// Feature: round-based-elimination-race — unit tests for the persisted stats
// payload shape (Req 8.5) and failure resilience of the cleanup path (Req 8.8).
//
// The legacy `race_stats` dual-write has been retired; the sole write path is
// now the unified `player_mode_stats` upsert. `upsertPlayerStat`/`rankPlayers`
// are not exported, so we mock the `db` module and capture the arguments the
// code passes to `upsertModeStats(tx, { userId, mode, scope, outcome }, now)`.
// We assert the LIFETIME-scope call's outcome, which carries this game's result.
//
// Validates: Requirements 8.5, 8.8

type ModeStatsCall = {
  userId: string;
  mode: string;
  scope: string;
  outcome: Record<string, unknown>;
  now: Date;
};

// Every upsertModeStats call the code under test issues, in order.
let calls: ModeStatsCall[] = [];
// When set, the mocked upsertModeStats throws to simulate a write failure (Req 8.8).
let writeShouldThrow = false;

vi.mock("db", () => {
  return {
    db: {
      // writeModeStats runs the upserts inside db.transaction; passthrough so
      // the mocked upsertModeStats fires with a dummy tx.
      transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    },
    upsertModeStats: (
      _tx: unknown,
      args: { userId: string; mode: string; scope: string; outcome: Record<string, unknown> },
      now: Date,
    ) => {
      if (writeShouldThrow) {
        throw new Error("simulated db failure");
      }
      calls.push({ ...args, now });
      return Promise.resolve(undefined);
    },
    setWonLastRealtimeGame: () => Promise.resolve(undefined),
    matchPoints: () => 0,
    seasonKey: () => "2026-01",
    LIFETIME_SCOPE: "lifetime",
  };
});

// Import AFTER the mock is registered.
const { persistRaceStats } = await import("./stats.js");

/** The LIFETIME-scope call for a user, which carries this game's outcome. */
const lifetimeCall = (userId: string): ModeStatsCall | undefined =>
  calls.find((c) => c.userId === userId && c.scope === "lifetime");

// A real (UUID-keyed) player id so isRealPlayer() treats it as a persisted user.
const WINNER_ID = "11111111-1111-4111-8111-111111111111";

const makePlayer = (fields: Partial<RacePlayer> = {}): RacePlayer => ({
  name: "p",
  isBot: fields.isBot ?? false,
  isEliminated: fields.isEliminated ?? false,
  completedWords: fields.completedWords ?? 0,
  qualified: fields.qualified ?? false,
  roundGuesses: fields.roundGuesses ?? 0,
  totalGuesses: fields.totalGuesses ?? 0,
  correctGuesses: fields.correctGuesses ?? 0,
  eliminatedAt: fields.eliminatedAt,
});

// A finished match with exactly one real winner player (placement 1, won).
const makeWinnerMatch = (): RaceMatch => {
  const players = new Map<string, RacePlayer>();
  players.set(
    WINNER_ID,
    makePlayer({ totalGuesses: 7, correctGuesses: 3, completedWords: 5 }),
  );
  return {
    room: {
      matchId: "m1",
      phase: "finished",
      createdAt: 0,
      lobbyDeadline: 0,
      currentRoundIndex: 0,
      winnerId: WINNER_ID,
      isDraw: false,
    },
    players,
  };
};

describe("persistRaceStats unified write payload (Req 8.5)", () => {
  beforeEach(() => {
    calls = [];
    writeShouldThrow = false;
  });

  it("writes a lifetime and a seasonal row for the player, fixed to mode 'race'", async () => {
    await persistRaceStats(makeWinnerMatch());

    const scopes = calls
      .filter((c) => c.userId === WINNER_ID)
      .map((c) => c.scope)
      .sort();
    // One lifetime row + one seasonal row (seasonKey mocked to 2026-01).
    expect(scopes).toEqual(["2026-01", "lifetime"]);
    // Every write is fixed to the Race mode.
    for (const c of calls) {
      expect(c.mode).toBe("race");
    }
  });

  it("includes every outcome field the unified upsert needs", async () => {
    await persistRaceStats(makeWinnerMatch());

    const call = lifetimeCall(WINNER_ID);
    expect(call).toBeDefined();
    const outcome = (call as ModeStatsCall).outcome;

    for (const field of [
      "won",
      "isDraw",
      "totalGuesses",
      "correctGuesses",
      "placement",
      "points",
    ] as const) {
      expect(outcome).toHaveProperty(field);
    }
  });

  it("records reasonable values for a first-game winner", async () => {
    await persistRaceStats(makeWinnerMatch());

    const call = lifetimeCall(WINNER_ID);
    expect(call).toBeDefined();
    const { outcome, now } = call as ModeStatsCall;

    // Winner of a non-draw match, sole finisher -> placement 1.
    expect(outcome.won).toBe(true);
    expect(outcome.isDraw).toBe(false);
    expect(outcome.placement).toBe(1);
    // Guess totals carried straight from the player.
    expect(outcome.totalGuesses).toBe(7);
    expect(outcome.correctGuesses).toBe(3);
    // Timestamp is a Date.
    expect(now).toBeInstanceOf(Date);
  });
});

describe("persistRaceStats failure resilience (Req 8.8)", () => {
  beforeEach(() => {
    calls = [];
    writeShouldThrow = false;
  });

  it("does not throw when the stats write fails, so cleanup completes", async () => {
    writeShouldThrow = true;

    // The try/catch inside persistRaceStats must swallow the error and resolve.
    await expect(persistRaceStats(makeWinnerMatch())).resolves.toBeUndefined();

    // Nothing was captured because the write threw.
    expect(calls).toHaveLength(0);
  });
});
