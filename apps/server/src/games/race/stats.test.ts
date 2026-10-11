import { beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type { RaceMatch, RacePlayer } from "types/race.types.js";

// Feature: round-based-elimination-race, Property 11: Only real players are persisted
//
// For any finished match whose field mixes UUID-keyed real players and non-UUID
// bot identifiers, the set of players written to `raceStats` contains exactly
// the UUID-keyed real players and no bots.
//
// `rankPlayers` is not exported, so we mock the `db` module and capture the
// `userId` on every unified `upsertModeStats` call `persistRaceStats` makes,
// then assert the captured set equals exactly the UUID-keyed ids.
//
// The stats pipeline writes two rows per player (lifetime + season). To keep the
// "exactly one per user" assertion meaningful we capture only the LIFETIME-scope
// call, which fires once per persisted player.
//
// Validates: Requirements 8.4

// Records the userId of every LIFETIME-scope upsertModeStats call.
const insertedUserIds: string[] = [];

vi.mock("db", () => {
  // The only write path is now the player_mode_stats transaction; capture the
  // lifetime-scope upsert per player.
  return {
    db: {
      // writeModeStats runs the upserts inside db.transaction; passthrough so
      // the mocked upsertModeStats fires with a dummy tx.
      transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    },
    upsertModeStats: (
      _tx: unknown,
      { userId, scope }: { userId: string; scope: string },
    ) => {
      if (scope === "lifetime") {
        insertedUserIds.push(userId);
      }
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A deterministic v4-shaped UUID from an integer seed, so generated real-player
// ids are guaranteed to pass the UUID check the code uses.
const uuidFromSeed = (seed: number): string => {
  const hex = seed.toString(16).padStart(12, "0").slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-000000000000`;
};

const makePlayer = (fields: Partial<RacePlayer>): RacePlayer => ({
  name: "p",
  isBot: fields.isBot ?? false,
  isEliminated: false,
  completedWords: fields.completedWords ?? 0,
  qualified: false,
  roundGuesses: fields.roundGuesses ?? 0,
  totalGuesses: fields.totalGuesses ?? 0,
  correctGuesses: fields.correctGuesses ?? 0,
  eliminatedAt: fields.eliminatedAt,
});

describe("persistRaceStats persists only real players (Property 11)", () => {
  beforeEach(() => {
    insertedUserIds.length = 0;
  });

  it("writes exactly the UUID-keyed players and no bots", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Distinct real-player seeds -> UUID ids (at least one so there is work).
        fc.uniqueArray(fc.integer({ min: 1, max: 100_000 }), {
          minLength: 1,
          maxLength: 6,
        }),
        // Number of bots mixed into the same field, keyed bot0, bot1, …
        fc.integer({ min: 0, max: 6 }),
        // Whether the match is a draw (exercises both ranking branches).
        fc.boolean(),
        // Per-player varied fields, plus which index wins.
        fc.record({
          eliminatedAt: fc.integer({ min: 0, max: 1_000_000 }),
          completedWords: fc.integer({ min: 0, max: 20 }),
          roundGuesses: fc.integer({ min: 0, max: 50 }),
          totalGuesses: fc.integer({ min: 0, max: 200 }),
          correctGuesses: fc.integer({ min: 0, max: 200 }),
          winnerPick: fc.integer({ min: 0, max: 100 }),
        }),
        async (realSeeds, botCount, isDraw, f) => {
          insertedUserIds.length = 0;

          const realIds = realSeeds.map(uuidFromSeed);
          const botIds = Array.from({ length: botCount }, (_, i) => `bot${i}`);

          const players = new Map<string, RacePlayer>();
          for (const id of realIds) {
            players.set(
              id,
              makePlayer({
                eliminatedAt: f.eliminatedAt,
                completedWords: f.completedWords,
                roundGuesses: f.roundGuesses,
                totalGuesses: f.totalGuesses,
                correctGuesses: f.correctGuesses,
              }),
            );
          }
          for (const id of botIds) {
            players.set(
              id,
              makePlayer({
                isBot: true,
                eliminatedAt: f.eliminatedAt,
                completedWords: f.completedWords,
                roundGuesses: f.roundGuesses,
                totalGuesses: f.totalGuesses,
                correctGuesses: f.correctGuesses,
              }),
            );
          }

          // Pick a winner across the full field (may be a bot or a real player)
          // when not a draw, to exercise the non-draw ranking branch.
          const allIds = [...realIds, ...botIds];
          const winnerId = isDraw
            ? undefined
            : allIds[f.winnerPick % allIds.length];

          const match: RaceMatch = {
            room: {
              matchId: "m1",
              phase: "finished",
              createdAt: 0,
              lobbyDeadline: 0,
              currentRoundIndex: 0,
              winnerId,
              isDraw,
            },
            players,
          };

          await persistRaceStats(match);

          const persisted = new Set(insertedUserIds);
          const expected = new Set(realIds);

          // Every persisted id is a real UUID (never a bot).
          for (const id of persisted) {
            expect(UUID_RE.test(id)).toBe(true);
          }
          // The persisted set equals exactly the real players.
          expect(persisted).toEqual(expected);
          // No duplicate writes per user.
          expect(insertedUserIds.length).toBe(realIds.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
