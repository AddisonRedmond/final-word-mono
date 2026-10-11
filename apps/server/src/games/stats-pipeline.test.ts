import { randomUUID } from "node:crypto";
import type { Game, PlayerDisplay } from "types/battle-royale.types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Feature: retention-foundation, Task 2.5 — unified stats pipeline tests.
//
// These mirror the existing `persisted-stats` / `stats.payload` tests: they mock
// the `db` module and capture the rows the write path produces. Unlike those
// tests (which stub the unified writer to a no-op and only assert the legacy
// row), these exercise the REAL `upsertModeStats` from `db/stats` driven by the
// REAL Battle Royale dual-write, so the player_mode_stats rows are what's under
// test here.
//
// `apps/server`'s `battle-royale/stats.ts` imports `upsertModeStats`,
// `matchPoints`, `seasonKey`, `LIFETIME_SCOPE` from `db`. We re-export the GENUINE
// implementations of those from the real package while replacing only `db` with
// a capturing stub: `db.transaction` runs the real write callback against a `tx`
// whose `insert(...).values(...).onConflictDoUpdate(...)` records the inserted
// player_mode_stats payload. One game therefore surfaces exactly the lifetime +
// seasonal rows the pipeline writes. (The legacy battle_royale_stats dual-write
// has been removed; player_mode_stats is now the only write.)
//
// Validates: Requirements 1.5, 2A.6

// The real pipeline pieces, imported from the package under test so the SQL
// recurrences, the scored-mode/seasonal points gate, and the season key are the
// production code — not reimplementations.
import { LIFETIME_SCOPE, matchPoints, seasonKey } from "db";

// Every player_mode_stats row the real upsertModeStats inserts, in order, with
// the (userId, mode, scope) it targeted and the full values() payload.
type ModeStatsWrite = {
  mode: string;
  scope: string;
  values: Record<string, unknown>;
};

const modeStatsWrites: ModeStatsWrite[] = [];

// Every cross-mode champion-flag write the real `setWonLastRealtimeGame` issues
// via `tx.update(profiles).set({ wonLastRealtimeGame }).where(...)`. We capture
// the `set` payload so a test can assert the flag reflects this game's outcome.
const championFlagWrites: Array<{ wonLastRealtimeGame: boolean }> = [];

vi.mock("db", async (importActual) => {
  // Keep the genuine schema/helpers; only `db` is replaced with a capturing
  // stub so the real upsertModeStats runs against an in-memory transaction.
  const actual = await importActual<typeof import("db")>();
  // The real drizzle table the unified writer targets. Identity comparison on
  // this object is how we pick the player_mode_stats writes out of the stream.
  const realPlayerModeStats = actual.playerModeStats;

  // A capturing `tx`/`db` handle. The unified player_mode_stats upsert flows
  // through `insert(table).values()`; we record only the rows whose target
  // table IS the real player_mode_stats.
  const realProfiles = actual.profiles;

  const makeHandle = () => ({
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        if (table === realPlayerModeStats) {
          modeStatsWrites.push({
            mode: row.mode as string,
            scope: row.scope as string,
            values: row,
          });
        }
        return { onConflictDoUpdate: () => Promise.resolve(undefined) };
      },
    }),
    // The champion-flag write: setWonLastRealtimeGame does
    // update(profiles).set({ wonLastRealtimeGame }).where(...). Capture the set
    // payload for profiles updates; return the chainable shape it expects.
    update: (table: unknown) => ({
      set: (row: Record<string, unknown>) => {
        if (table === realProfiles) {
          championFlagWrites.push({
            wonLastRealtimeGame: row.wonLastRealtimeGame as boolean,
          });
        }
        return { where: () => Promise.resolve(undefined) };
      },
    }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(makeHandle()),
  });

  const db = makeHandle();

  return {
    ...actual,
    db,
    // sql is a passthrough tag; the real recurrences are never executed against
    // a live DB here (the capturing stub resolves immediately).
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
    // The genuine unified pipeline + scoring are the code under test, kept as-is
    // from `...actual`.
  };
});

const { persistBattleRoyaleStats } = await import("./battle-royale/stats.js");

const makePlayer = (fields: Partial<PlayerDisplay> = {}): PlayerDisplay => ({
  name: "p",
  isEliminated: false,
  life: 0,
  totalGuesses: 0,
  correctGuesses: 0,
  currentWordGuesses: 0,
  ...fields,
});

const makeGame = (entries: Array<[string, PlayerDisplay]>): Game => ({
  room: {
    lobbyId: randomUUID(),
    startTime: 0,
    isStarted: true,
    createdAt: 0,
    isFinished: true,
    isDraw: false,
  },
  players: new Map(entries),
});

describe("stats pipeline — one game writes consistent lifetime + seasonal rows", () => {
  beforeEach(() => {
    modeStatsWrites.length = 0;
    championFlagWrites.length = 0;
  });

  it("writes one lifetime row and one seasonal row for the winner", async () => {
    const winner = randomUUID();
    const game = makeGame([
      [winner, makePlayer({ correctGuesses: 4, totalGuesses: 6 })],
    ]);
    game.room.winnerId = winner;

    await persistBattleRoyaleStats(game);

    const rows = modeStatsWrites.filter((w) => w.values.userId === winner);
    // Exactly two rows for one game: lifetime + current season.
    expect(rows).toHaveLength(2);

    const lifetime = rows.find((r) => r.scope === LIFETIME_SCOPE);
    const seasonal = rows.find((r) => r.scope !== LIFETIME_SCOPE);
    expect(lifetime).toBeDefined();
    expect(seasonal).toBeDefined();

    // Both rows are battle_royale and describe the SAME game outcome: identical
    // core counters, placement, and guess economy. The scope is the only split.
    for (const row of [lifetime, seasonal] as ModeStatsWrite[]) {
      expect(row.mode).toBe("battle_royale");
      expect(row.values.gamesPlayed).toBe(1);
      expect(row.values.wins).toBe(1); // sole finisher is the winner
      expect(row.values.draws).toBe(0);
      expect(row.values.averagePlacement).toBe(1);
      expect(row.values.bestPlacement).toBe(1);
      expect(row.values.totalGuesses).toBe(6);
      expect(row.values.totalCorrectGuesses).toBe(4);
      expect(row.values.wonLastGame).toBe(true);
    }

    // The seasonal row's scope is the current UTC-month key.
    expect(seasonal?.scope).toBe(seasonKey(new Date()));

    // Cross-mode champion flag: the winner's profile flag is set true exactly
    // once for this game (drives the gold "Final Word" header).
    expect(championFlagWrites).toEqual([{ wonLastRealtimeGame: true }]);
  });

  it("lands points ONLY on the seasonal scored row; the lifetime row keeps points at 0", async () => {
    const winner = randomUUID();
    const game = makeGame([
      [winner, makePlayer({ correctGuesses: 4, totalGuesses: 6 })],
    ]);
    game.room.winnerId = winner;

    await persistBattleRoyaleStats(game);

    const rows = modeStatsWrites.filter((w) => w.values.userId === winner);
    const lifetime = rows.find((r) => r.scope === LIFETIME_SCOPE);
    const seasonal = rows.find((r) => r.scope !== LIFETIME_SCOPE);

    // Winner at placement 1 with 4 correct guesses: the single source-of-truth
    // scoring function decides how many points that match is worth.
    const expectedPoints = matchPoints(1, 4);
    expect(expectedPoints).toBeGreaterThan(0); // a win is always worth points

    // Points land on the seasonal (scored-mode) row only.
    expect(seasonal?.values.seasonPoints).toBe(expectedPoints);
    expect(seasonal?.values.bestMatchPoints).toBe(expectedPoints);

    // The lifetime row never accrues points — there is no lifetime points total.
    expect(lifetime?.values.seasonPoints).toBe(0);
    expect(lifetime?.values.bestMatchPoints).toBe(0);
  });

  it("excludes bots: a bot winner never produces player_mode_stats rows", async () => {
    const human = randomUUID();
    const game = makeGame([
      [human, makePlayer({ isEliminated: true, endTimeStamp: 1 })],
      ["bot0", makePlayer({ correctGuesses: 9 })],
    ]);
    // Bot wins; the human is the only real finisher (a loss at placement 2).
    game.room.winnerId = "bot0";

    await persistBattleRoyaleStats(game);

    // No row is ever written for the bot id.
    expect(modeStatsWrites.some((w) => w.values.userId === "bot0")).toBe(false);
    // The human still gets their lifetime + seasonal rows.
    const humanRows = modeStatsWrites.filter((w) => w.values.userId === human);
    expect(humanRows).toHaveLength(2);
    // A non-winning finisher: no win, and (placement 2) earns no win bonus.
    for (const row of humanRows) {
      expect(row.values.wins).toBe(0);
    }

    // Cross-mode champion flag: the bot never writes one; the human — who lost
    // this game — has their flag set FALSE, so a prior win in another mode would
    // no longer keep the gold header lit.
    expect(championFlagWrites).toEqual([{ wonLastRealtimeGame: false }]);
  });
});
