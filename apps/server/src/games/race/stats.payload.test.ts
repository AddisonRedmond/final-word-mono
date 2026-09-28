import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RaceMatch, RacePlayer } from "types/race.types.js";

// Feature: round-based-elimination-race — unit tests for the persisted stats
// payload shape (Req 8.5) and failure resilience of the cleanup path (Req 8.8).
//
// `upsertPlayerStat`/`rankPlayers` are not exported, so we mock the `db` module
// and capture the arguments the code under test passes to
// `db.insert(raceStats).values({...}).onConflictDoUpdate({...})`.
//
// Validates: Requirements 8.5, 8.8

// Captured row from the most recent `.values(...)` call.
let capturedRow: Record<string, unknown> | undefined;
// Captured config object from the most recent `.onConflictDoUpdate(...)` call.
let capturedConflict: Record<string, unknown> | undefined;
// When set, the mocked insert() throws to simulate a DB failure (Req 8.8).
let insertShouldThrow = false;

vi.mock("db", () => {
  // Chainable stub mirroring db.insert(raceStats).values({...}).onConflictDoUpdate({...}).
  const insert = () => {
    if (insertShouldThrow) {
      throw new Error("simulated db failure");
    }
    return {
      values: (row: Record<string, unknown>) => {
        capturedRow = row;
        return {
          onConflictDoUpdate: (config: Record<string, unknown>) => {
            capturedConflict = config;
            return Promise.resolve(undefined);
          },
        };
      },
    };
  };

  // raceStats is only referenced for column identifiers; a Proxy returning the
  // accessed key name is enough. sql is a passthrough tag that never runs here.
  return {
    db: { insert },
    raceStats: new Proxy({}, { get: (_t, key) => key }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
  };
});

// Import AFTER the mock is registered.
const { persistRaceStats } = await import("./stats.js");

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

describe("persistRaceStats upsert payload shape (Req 8.5)", () => {
  beforeEach(() => {
    capturedRow = undefined;
    capturedConflict = undefined;
    insertShouldThrow = false;
  });

  it("includes every required stat field in the inserted row", async () => {
    await persistRaceStats(makeWinnerMatch());

    expect(capturedRow).toBeDefined();
    const row = capturedRow as Record<string, unknown>;

    // Req 8.5 required fields must all be present.
    for (const field of [
      "gamesPlayed",
      "wins",
      "draws",
      "averagePlacement",
      "bestPlacement",
      "totalGuesses",
      "totalCorrectGuesses",
      "currentWinStreak",
      "bestWinStreak",
      "wonLastGame",
      "lastPlayedAt",
    ] as const) {
      expect(row).toHaveProperty(field);
    }
  });

  it("records reasonable values for a first-game winner", async () => {
    await persistRaceStats(makeWinnerMatch());

    const row = capturedRow as Record<string, unknown>;

    expect(row.userId).toBe(WINNER_ID);
    expect(row.gamesPlayed).toBe(1);
    // Winner of a non-draw match.
    expect(row.wins).toBe(1);
    expect(row.draws).toBe(0);
    // Sole finisher / winner is placement 1.
    expect(row.averagePlacement).toBe(1);
    expect(row.bestPlacement).toBe(1);
    // Streaks start at this game's win.
    expect(row.currentWinStreak).toBe(1);
    expect(row.bestWinStreak).toBe(1);
    expect(row.wonLastGame).toBe(true);
    // Guess totals carried straight from the player.
    expect(row.totalGuesses).toBe(7);
    expect(row.totalCorrectGuesses).toBe(3);
    // Timestamp is a Date.
    expect(row.lastPlayedAt).toBeInstanceOf(Date);
  });

  it("configures onConflictDoUpdate so existing rows are upserted", async () => {
    await persistRaceStats(makeWinnerMatch());

    expect(capturedConflict).toBeDefined();
    const conflict = capturedConflict as Record<string, unknown>;
    // The upsert targets the userId column and supplies an update set.
    expect(conflict).toHaveProperty("target");
    expect(conflict).toHaveProperty("set");
  });
});

describe("persistRaceStats failure resilience (Req 8.8)", () => {
  beforeEach(() => {
    capturedRow = undefined;
    capturedConflict = undefined;
    insertShouldThrow = false;
  });

  it("does not throw when the DB insert fails, so cleanup completes", async () => {
    insertShouldThrow = true;

    // The try/catch inside persistRaceStats must swallow the error and resolve.
    await expect(persistRaceStats(makeWinnerMatch())).resolves.toBeUndefined();

    // Nothing was successfully captured because insert() threw.
    expect(capturedRow).toBeUndefined();
  });
});
