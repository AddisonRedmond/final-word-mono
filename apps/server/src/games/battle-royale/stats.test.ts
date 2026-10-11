import { randomUUID } from "node:crypto";
import type { Game, PlayerDisplay } from "types/battle-royale.types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Record-at-outcome stats for Battle Royale. The legacy battle_royale_stats
// dual-write has been retired; the sole write path is the unified
// `player_mode_stats` upsert. `stats.ts` imports `db`, so mock it before
// importing the module under test and capture every LIFETIME-scope
// `upsertModeStats` call (one per persisted player).
type Row = {
  userId: string;
  won: boolean;
  isDraw: boolean;
  placement: number;
};
const insertedRows: Row[] = [];
vi.mock("db", () => {
  return {
    db: {
      // writeModeStats runs the upserts inside db.transaction; passthrough so
      // the mocked upsertModeStats fires with a dummy tx.
      transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    },
    upsertModeStats: (
      _tx: unknown,
      {
        userId,
        scope,
        outcome,
      }: {
        userId: string;
        scope: string;
        outcome: { won: boolean; isDraw?: boolean; placement: number };
      },
    ) => {
      // Capture only the lifetime row so per-player counts match the legacy
      // assertions (the pipeline also writes a seasonal row per player).
      if (scope === "lifetime") {
        insertedRows.push({
          userId,
          won: outcome.won,
          isDraw: outcome.isDraw ?? false,
          placement: outcome.placement,
        });
      }
      return Promise.resolve(undefined);
    },
    setWonLastRealtimeGame: () => Promise.resolve(undefined),
    matchPoints: () => 0,
    seasonKey: () => "2026-01",
    LIFETIME_SCOPE: "lifetime",
  };
});

const { persistBattleRoyaleStats, persistEliminatedAsLoss, persistLeaverAsLoss } =
  await import("./stats.js");

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
    isFinished: false,
    isDraw: false,
  },
  players: new Map(entries),
});

// Await the microtasks the fire-and-forget persist helpers schedule.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Battle Royale record-at-outcome stats", () => {
  beforeEach(() => {
    insertedRows.length = 0;
  });

  it("records real eliminated players as losses once and skips bots", async () => {
    const humanA = randomUUID();
    const humanB = randomUUID();
    const game = makeGame([
      [humanA, makePlayer({ isEliminated: true, endTimeStamp: 1 })],
      ["bot0", makePlayer({ isEliminated: true, endTimeStamp: 1 })],
      [humanB, makePlayer()], // still alive
      ["bot1", makePlayer()], // still alive
    ]);

    // Two players eliminated on this tick: one human, one bot.
    persistEliminatedAsLoss(game, [humanA, "bot0"]);
    await flush();

    // Only the human was recorded (bot excluded), as a loss.
    expect(insertedRows.map((r) => r.userId)).toEqual([humanA]);
    expect(insertedRows[0].won).toBe(false);
    // Placement = alive after sweep (humanB + bot1 = 2) + eliminated this tick
    // (2) = 4.
    expect(insertedRows[0].placement).toBe(4);
    // Flag latched so a later finish/leave won't double-write.
    expect(game.players.get(humanA)?.statsPersisted).toBe(true);
  });

  it("does not double-record a player already recorded at elimination", async () => {
    const human = randomUUID();
    const game = makeGame([
      [human, makePlayer({ isEliminated: true, endTimeStamp: 1 })],
    ]);

    persistEliminatedAsLoss(game, [human]);
    await flush();
    expect(insertedRows).toHaveLength(1);

    // A subsequent leave for the same (already-recorded) player is a no-op.
    persistLeaverAsLoss(game, human);
    await flush();
    expect(insertedRows).toHaveLength(1);
  });

  it("at finish, writes only unrecorded players (the winner) and skips the already-recorded", async () => {
    const winner = randomUUID();
    const loser = randomUUID();
    const game = makeGame([
      [winner, makePlayer({ correctGuesses: 5 })],
      [loser, makePlayer({ isEliminated: true, endTimeStamp: 1 })],
    ]);
    game.room.winnerId = winner;
    game.room.isFinished = true;

    // The loser was recorded at their elimination earlier.
    persistEliminatedAsLoss(game, [loser]);
    await flush();
    insertedRows.length = 0;

    // Finish persists the FULL real field ranking, but only writes unrecorded
    // players — here just the winner.
    await persistBattleRoyaleStats(game);

    expect(insertedRows.map((r) => r.userId)).toEqual([winner]);
    expect(insertedRows[0].won).toBe(true);
    expect(insertedRows[0].placement).toBe(1); // winner is placement 1
  });

  it("excludes bots from a finish persist", async () => {
    const human = randomUUID();
    const game = makeGame([
      [human, makePlayer({ correctGuesses: 3 })],
      ["bot0", makePlayer({ isEliminated: true, endTimeStamp: 1 })],
    ]);
    game.room.winnerId = human;
    game.room.isFinished = true;

    await persistBattleRoyaleStats(game);

    expect(insertedRows.map((r) => r.userId)).toEqual([human]);
  });
});
